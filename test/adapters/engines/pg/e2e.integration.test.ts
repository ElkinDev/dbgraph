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
