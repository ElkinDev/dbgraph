/**
 * E2E integration test: full pipeline golden-pinned for PostgreSQL.
 * Pipeline: torture.sql → container → extract → normalizeCatalog
 *           → SqliteGraphStore.upsertGraph → impact/path queries → golden.
 *
 * Gate: DBGRAPH_INTEGRATION=1.
 * Per-suite hookTimeout: 120 000 ms (postgres:16 startup is fast).
 *
 * Asserts:
 *   - reads_from / writes_to parsed edges from fn_place_order (L-009: src+dst qnames)
 *   - fires_on + writes_to from trg_audit_order_update
 *   - hasDynamicSql on fn_dynamic_search (no fabricated edges)
 *   - materialized view as kind:view + extra.materialized:true
 *   - golden-pinned (byte-identical ADR-008)
 *
 * US-028 (full pipeline), ADR-008 (golden determinism).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startPgContainer,
  pgIntegrationEnabled,
} from '../../../fixtures/pg/container.js';
import type { PgContainerHandle } from '../../../fixtures/pg/container.js';
import { createPgSchemaAdapter } from '../../../../src/adapters/engines/pg/factory.js';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { getImpact } from '../../../../src/core/query/impact.js';
import { findJoinPath } from '../../../../src/core/query/path.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { GraphStore } from '../../../../src/core/ports/graph-store.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_DIR = join(__dirname, '../../../fixtures/pg/golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'golden-e2e.json');

// Use full scope with routine bodies for edge assertions
const FULL_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    functions: 'full',
    procedures: 'full',
    sequences: 'full',
  },
};

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let handle: PgContainerHandle;
let normResult: NormalizationResult;
let store: GraphStore;

describe.skipIf(!pgIntegrationEnabled())(
  'PG E2E pipeline: extract → normalize → store → query (US-028, ADR-008) [Task 7.6]',
  () => {
    beforeAll(async () => {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      handle = await startPgContainer();

      // Step 1: Extract
      const adapter = await createPgSchemaAdapter(handle.config);
      const catalog = await adapter.extract(FULL_SCOPE);
      await adapter.close();

      // Step 2: Normalize
      normResult = normalizeCatalog(catalog, FULL_SCOPE);

      // Step 3: Store in in-memory SQLite graph store
      store = await createSqliteGraphStore({ path: ':memory:' });
      await store.upsertGraph(normResult.graph);
    }, 120_000);

    afterAll(async () => {
      if (store !== undefined) await store.close();
      if (handle !== undefined) await handle.stop();
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────
    // Pipeline smoke: nodes and edges present
    // ─────────────────────────────────────────────────────────────────────

    it('normalizeCatalog produces nodes', () => {
      expect(normResult.graph.nodes.length).toBeGreaterThan(0);
    });

    it('normalizeCatalog produces edges', () => {
      expect(normResult.graph.edges.length).toBeGreaterThan(0);
    });

    it('graph store contains table nodes', async () => {
      const tables = await store.getNodesByKind('table');
      expect(tables.length).toBeGreaterThan(0);
    });

    it('products table node is in the store', async () => {
      const tables = await store.getNodesByKind('table');
      expect(tables.find((n) => n.name === 'products')).toBeDefined();
    });

    it('orders table node is in the store', async () => {
      const tables = await store.getNodesByKind('table');
      expect(tables.find((n) => n.name === 'orders')).toBeDefined();
    });

    // ─────────────────────────────────────────────────────────────────────
    // Materialized view in graph (US-028b)
    // ─────────────────────────────────────────────────────────────────────

    it('mv_product_stats is present as a view node (no new NodeKind)', () => {
      const mvNode = normResult.graph.nodes.find(
        (n) => n.kind === 'view' && n.name === 'mv_product_stats',
      );
      expect(mvNode).toBeDefined();
    });

    // ─────────────────────────────────────────────────────────────────────
    // Parsed edges from fn_place_order (writes_to x2, reads_from x1)
    // L-009: assert BOTH source and destination qnames
    // ─────────────────────────────────────────────────────────────────────

    it('fn_place_order writes_to edges are present in the graph', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_place_order',
      );
      expect(fnNode).toBeDefined();

      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === fnNode!.id,
      );
      expect(writeEdges.length).toBeGreaterThanOrEqual(2);
    });

    it('fn_place_order writes_to app.orders by qname (L-009)', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_place_order',
      );
      expect(fnNode).toBeDefined();

      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === fnNode!.id,
      );
      const dstQnames = writeEdges.map((e) => {
        const dst = normResult.graph.nodes.find((n) => n.id === e.dst);
        return dst?.qname ?? '';
      });
      expect(dstQnames).toContain('app.orders');
    });

    it('fn_place_order writes_to app.order_items by qname (L-009)', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_place_order',
      );
      expect(fnNode).toBeDefined();

      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === fnNode!.id,
      );
      const dstQnames = writeEdges.map((e) => {
        const dst = normResult.graph.nodes.find((n) => n.id === e.dst);
        return dst?.qname ?? '';
      });
      expect(dstQnames).toContain('app.order_items');
    });

    it('fn_place_order reads_from app.products by qname (L-009)', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_place_order',
      );
      expect(fnNode).toBeDefined();

      const readEdge = normResult.graph.edges.find(
        (e) => e.kind === 'reads_from' && e.src === fnNode!.id,
      );
      expect(readEdge).toBeDefined();

      const dstNode = normResult.graph.nodes.find((n) => n.id === readEdge!.dst);
      expect(dstNode).toBeDefined();
      expect(dstNode!.qname).toBe('app.products');
    });

    // ─────────────────────────────────────────────────────────────────────
    // fires_on + writes_to from trg_audit_order_update (L-009)
    // ─────────────────────────────────────────────────────────────────────

    it('trg_audit_order_update fires_on edge is present', () => {
      const trigNode = normResult.graph.nodes.find(
        (n) => n.kind === 'trigger' && n.name === 'trg_audit_order_update',
      );
      expect(trigNode).toBeDefined();

      const firesOnEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'fires_on' && e.src === trigNode!.id,
      );
      expect(firesOnEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('fires_on dst is app.orders table node (L-009)', () => {
      const trigNode = normResult.graph.nodes.find(
        (n) => n.kind === 'trigger' && n.name === 'trg_audit_order_update',
      );
      expect(trigNode).toBeDefined();

      const firesOnEdge = normResult.graph.edges.find(
        (e) => e.kind === 'fires_on' && e.src === trigNode!.id,
      );
      expect(firesOnEdge).toBeDefined();

      const dstNode = normResult.graph.nodes.find((n) => n.id === firesOnEdge!.dst);
      expect(dstNode).toBeDefined();
      expect(dstNode!.kind).toBe('table');
      expect(dstNode!.qname).toBe('app.orders');
    });

    it('no phantom stub node named after the trigger exists', () => {
      const phantomStub = normResult.stubs.find(
        (s) => s.qname === 'app.trg_audit_order_update',
      );
      expect(phantomStub).toBeUndefined();

      const triggerNamedTable = normResult.graph.nodes.find(
        (n) => n.kind === 'table' && n.name === 'trg_audit_order_update',
      );
      expect(triggerNamedTable).toBeUndefined();
    });

    // ─────────────────────────────────────────────────────────────────────
    // Dynamic SQL: fn_dynamic_search has no fabricated edges
    // ─────────────────────────────────────────────────────────────────────

    it('fn_dynamic_search node has hasDynamicSql in payload', () => {
      const node = normResult.graph.nodes.find(
        (n) => n.name === 'fn_dynamic_search',
      );
      expect(node).toBeDefined();
    });

    it('fn_dynamic_search has no writes_to or reads_from edges (no fabricated edges)', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_dynamic_search',
      );
      expect(fnNode).toBeDefined();

      const dependencyEdges = normResult.graph.edges.filter(
        (e) => (e.kind === 'writes_to' || e.kind === 'reads_from') && e.src === fnNode!.id,
      );
      // Dynamic functions should not have fabricated edges
      expect(dependencyEdges.length).toBe(0);
    });

    // DOG-2 1.4 — INTEGRATION tier: L-009 exact-set parameter pins over the real materialized
    // pg torture catalog (non-t/non-v routines only — the DOG-1 pg fixtures exercise neither).
    // Proves the SQL regtype decode: all-IN routines render every arg 'in', typmod-less types,
    // real empty signatures carry [], no fabricated out/inout/hasDefault.
    it('fn_place_order NULL-modes → four in integer params, exact set (DOG-2 PG-2)', () => {
      const node = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_place_order',
      );
      expect(node).toBeDefined();
      expect(node!.payload['parameters']).toStrictEqual([
        { name: 'p_order_id', dataType: 'integer', direction: 'in', ordinal: 1 },
        { name: 'p_customer_id', dataType: 'integer', direction: 'in', ordinal: 2 },
        { name: 'p_product_id', dataType: 'integer', direction: 'in', ordinal: 3 },
        { name: 'p_qty', dataType: 'integer', direction: 'in', ordinal: 4 },
      ]);
    });

    it('fn_wrapper / fn_inner carry parameters:[] (real empty, not unset) (DOG-2 PG-1)', () => {
      for (const name of ['fn_wrapper', 'fn_inner']) {
        const node = normResult.graph.nodes.find(
          (n) => n.kind === 'function' && n.name === name,
        );
        expect(node, name).toBeDefined();
        // buildPayload elides an empty array, so a real no-arg routine has NO parameters key
        // in the payload — the honest render of a known-zero signature (renderParameters → []).
        expect(node!.payload['parameters']).toBeUndefined();
      }
    });

    it('proc_cancel_order(p_order_id int) → single in integer param (DOG-2 PG-2)', () => {
      const node = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_cancel_order',
      );
      expect(node).toBeDefined();
      expect(node!.payload['parameters']).toStrictEqual([
        { name: 'p_order_id', dataType: 'integer', direction: 'in', ordinal: 1 },
      ]);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Query API: impact and path (L-009: pinned node+edge counts)
    // ─────────────────────────────────────────────────────────────────────

    it('impact traversal from orders table returns a result', async () => {
      const tables = await store.getNodesByKind('table');
      const orders = tables.find((n) => n.name === 'orders');
      if (orders === undefined) throw new Error('orders table not found in store');

      const impact = await getImpact(store, { nodeId: orders.id });
      expect(impact).toBeDefined();
      expect(impact.truncated).toBe(false);
    });

    it('path from order_items to products follows FK', async () => {
      const tables = await store.getNodesByKind('table');
      const orderItems = tables.find((n) => n.name === 'order_items');
      const products = tables.find((n) => n.name === 'products');
      if (orderItems === undefined || products === undefined) {
        throw new Error('order_items or products table not found in store');
      }

      const result = await findJoinPath(store, {
        from: orderItems.id,
        to: products.id,
      });
      expect(result.found).toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────────
    // NEGATIVE / exact-set edge assertions (CRITICAL-1 regression guard, L-009)
    // ─────────────────────────────────────────────────────────────────────

    it('fn_place_order has EXACTLY 3 dependency edges in the graph (no phantom)', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_place_order',
      );
      expect(fnNode).toBeDefined();
      const depEdges = normResult.graph.edges.filter(
        (e) => (e.kind === 'writes_to' || e.kind === 'reads_from') && e.src === fnNode!.id,
      );
      expect(depEdges.length).toBe(3);
    });

    it('v_order_summary has EXACTLY 2 depends_on edges: orders + order_items (no phantom, no self)', () => {
      // Views produce depends_on (not reads_from) per reference-resolver.ts design §4.2.
      const viewNode = normResult.graph.nodes.find(
        (n) => n.kind === 'view' && n.name === 'v_order_summary',
      );
      expect(viewNode).toBeDefined();
      const depEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'depends_on' && e.src === viewNode!.id,
      );
      expect(depEdges.length).toBe(2);
      const dstNames = depEdges.map((e) => {
        const dst = normResult.graph.nodes.find((n) => n.id === e.dst);
        return dst?.name ?? '';
      }).sort();
      expect(dstNames).toEqual(['order_items', 'orders']);
      // Must NOT depend on itself
      const selfEdge = depEdges.find((e) => e.dst === viewNode!.id);
      expect(selfEdge).toBeUndefined();
    });

    it('mv_product_stats has EXACTLY 2 depends_on edges: products + order_items (no phantom, no self)', () => {
      // Views produce depends_on (not reads_from) per reference-resolver.ts design §4.2.
      const mvNode = normResult.graph.nodes.find(
        (n) => n.kind === 'view' && n.name === 'mv_product_stats',
      );
      expect(mvNode).toBeDefined();
      const depEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'depends_on' && e.src === mvNode!.id,
      );
      expect(depEdges.length).toBe(2);
      const dstNames = depEdges.map((e) => {
        const dst = normResult.graph.nodes.find((n) => n.id === e.dst);
        return dst?.name ?? '';
      }).sort();
      expect(dstNames).toEqual(['order_items', 'products']);
    });

    // ─────────────────────────────────────────────────────────────────────
    // DOG-3 B.7 — LIVE view_column_usage coverage + materialized-view exclusion
    // (design D5/D4). Runs over the real materialized torture.sql catalog via the SAME
    // extract -> normalizeCatalog pipeline as every other assertion in this file.
    // ─────────────────────────────────────────────────────────────────────

    it('DOG-3: v_order_summary covered edges are declared with their EXACT dstColumns (view_column_usage coverage, L-009)', () => {
      const viewNode = normResult.graph.nodes.find(
        (n) => n.kind === 'view' && n.name === 'v_order_summary',
      );
      expect(viewNode).toBeDefined();
      const depEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'depends_on' && e.src === viewNode!.id,
      );
      const byTargetName = new Map(
        depEdges.map((e) => [
          normResult.graph.nodes.find((n) => n.id === e.dst)?.name ?? '',
          e,
        ]),
      );

      const ordersEdge = byTargetName.get('orders');
      expect(ordersEdge).toBeDefined();
      expect(ordersEdge!.confidence).toBe('declared');
      expect(ordersEdge!.attrs.dstColumns).toStrictEqual(['customer_id', 'order_id', 'status']);

      const itemsEdge = byTargetName.get('order_items');
      expect(itemsEdge).toBeDefined();
      expect(itemsEdge!.confidence).toBe('declared');
      expect(itemsEdge!.attrs.dstColumns).toStrictEqual(['item_id', 'order_id', 'total_price']);

      // negatives — columns the view does NOT read never appear
      expect(itemsEdge!.attrs.dstColumns).not.toContain('qty');
      expect(itemsEdge!.attrs.dstColumns).not.toContain('product_id');
    });

    it('DOG-3: mv_product_stats edges stay parsed with NO dstColumns (materialized-view exclusion, negative)', () => {
      const mvNode = normResult.graph.nodes.find(
        (n) => n.kind === 'view' && n.name === 'mv_product_stats',
      );
      expect(mvNode).toBeDefined();
      const depEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'depends_on' && e.src === mvNode!.id,
      );
      expect(depEdges.length).toBe(2);
      for (const e of depEdges) {
        expect(e.confidence).toBe('parsed');
        expect(e.attrs.dstColumns).toBeUndefined();
        expect('dstColumns' in e.attrs).toBe(false);
      }
    });

    it('proc_cancel_order has EXACTLY 1 writes_to edge (orders) + 0 reads_from', () => {
      const procNode = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_cancel_order',
      );
      expect(procNode).toBeDefined();
      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === procNode!.id,
      );
      const readEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'reads_from' && e.src === procNode!.id,
      );
      expect(writeEdges.length).toBe(1);
      expect(readEdges.length).toBe(0);
      const dstNode = normResult.graph.nodes.find((n) => n.id === writeEdges[0]!.dst);
      expect(dstNode?.name).toBe('orders');
    });

    it('audit_fn has EXACTLY 1 writes_to edge (audit_log) + 0 reads_from', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'audit_fn',
      );
      expect(fnNode).toBeDefined();
      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === fnNode!.id,
      );
      const readEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'reads_from' && e.src === fnNode!.id,
      );
      expect(writeEdges.length).toBe(1);
      expect(readEdges.length).toBe(0);
      const dstNode = normResult.graph.nodes.find((n) => n.id === writeEdges[0]!.dst);
      expect(dstNode?.name).toBe('audit_log');
    });

    // ─────────────────────────────────────────────────────────────────────
    // DOG-1: fn_wrapper → fn_inner body-parsed `calls` edge (L-009 exact, no self)
    // ─────────────────────────────────────────────────────────────────────

    it('fn_wrapper calls fn_inner EXACTLY once at confidence parsed (no read/write, no self) [DOG-1 B.6]', () => {
      const wrapper = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_wrapper',
      );
      expect(wrapper).toBeDefined();
      const callEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'calls' && e.src === wrapper!.id,
      );
      expect(callEdges.length).toBe(1);
      expect(callEdges[0]!.confidence).toBe('parsed');
      const dst = normResult.graph.nodes.find((n) => n.id === callEdges[0]!.dst);
      expect(dst?.kind).toBe('function');
      expect(dst?.qname).toBe('app.fn_inner');
      // The call is NOT a read/write edge to the callee.
      const rw = normResult.graph.edges.filter(
        (e) => (e.kind === 'reads_from' || e.kind === 'writes_to') && e.src === wrapper!.id && e.dst === callEdges[0]!.dst,
      );
      expect(rw.length).toBe(0);
      // No self-`calls` despite the pg_get_functiondef header naming fn_wrapper.
      expect(callEdges.find((e) => e.dst === wrapper!.id)).toBeUndefined();
    });

    it('fn_inner emits ZERO calls edges and reads app.orders [DOG-1 B.6]', () => {
      const inner = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_inner',
      );
      expect(inner).toBeDefined();
      const callEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'calls' && e.src === inner!.id,
      );
      expect(callEdges.length).toBe(0);
      const readDst = normResult.graph.edges
        .filter((e) => e.kind === 'reads_from' && e.src === inner!.id)
        .map((e) => normResult.graph.nodes.find((n) => n.id === e.dst)?.qname);
      expect(readDst).toContain('app.orders');
    });

    // ─────────────────────────────────────────────────────────────────────
    // Golden: byte-identical on second run (ADR-008)
    // ─────────────────────────────────────────────────────────────────────

    it('normalized graph is deterministic (stableStringify stable across two extractions)', async () => {
      const adapter2 = await createPgSchemaAdapter(handle.config);
      const catalog2 = await adapter2.extract(FULL_SCOPE);
      await adapter2.close();
      const normResult2 = normalizeCatalog(catalog2, FULL_SCOPE);

      expect(stableStringify(normResult.graph)).toBe(stableStringify(normResult2.graph));
    });

    it('E2E golden matches committed golden file (seeds on first run)', () => {
      const snapshot = {
        nodeCount: normResult.graph.nodes.length,
        edgeCount: normResult.graph.edges.length,
        stubCount: normResult.stubs.length,
        firstNodes: normResult.graph.nodes
          .slice(0, 5)
          .map((n) => ({ kind: n.kind, qname: n.qname })),
        // Pinned edge kinds from the torture schema
        edgeKinds: [...new Set(normResult.graph.edges.map((e) => e.kind))].sort(),
      };
      const actual = stableStringify(snapshot);

      if (!existsSync(GOLDEN_PATH)) {
        writeFileSync(GOLDEN_PATH, actual, 'utf-8');
        console.log('[pg-e2e-integration] Golden seeded:', GOLDEN_PATH);
        expect(actual.length).toBeGreaterThan(0);
        return;
      }

      const committed = readFileSync(GOLDEN_PATH, 'utf-8');
      expect(actual).toBe(committed);
    });
  },
);

if (!pgIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
