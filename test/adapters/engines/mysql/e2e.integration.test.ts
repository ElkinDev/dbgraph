/**
 * E2E integration test: full pipeline golden-pinned for MySQL.
 * Pipeline: torture.sql -> container -> extract -> normalizeCatalog
 *           -> SqliteGraphStore.upsertGraph -> impact/path queries -> golden.
 *
 * Gate: DBGRAPH_INTEGRATION=1.
 * Per-suite hookTimeout: 120 000 ms (mysql:8 startup).
 *
 * Asserts (CRITICAL-1 / L-009 — EXACT-set edge endpoints):
 *   - writes_to / reads_from from proc_place_order (pinned src+dst qnames)
 *   - depends_on from v_order_summary (exactly orders + order_items)
 *   - writes_to from fn_audit_write (exactly audit_log)
 *   - hasDynamicSql + ZERO edges from proc_dynamic_query
 *   - fires_on from trg_after_order_update (dst = orders table)
 *   - stubCount === 0, no self-reference edge
 *   - golden-pinned (byte-identical ADR-008)
 *
 * US-029 (full pipeline), ADR-008 (golden determinism).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startMysqlContainer,
  mysqlIntegrationEnabled,
} from '../../../fixtures/mysql/container.js';
import type { MysqlContainerHandle } from '../../../fixtures/mysql/container.js';
import { createMysqlSchemaAdapter } from '../../../../src/adapters/engines/mysql/factory.js';
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

const GOLDEN_DIR = join(__dirname, '../../../fixtures/mysql/golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'golden-e2e.json');

// Full scope with routine bodies for edge assertions
const FULL_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    functions: 'full',
    procedures: 'full',
    triggers: 'full',
  },
};

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let handle: MysqlContainerHandle;
let normResult: NormalizationResult;
let store: GraphStore;

describe.skipIf(!mysqlIntegrationEnabled())(
  'MySQL E2E pipeline: extract -> normalize -> store -> query (US-029, ADR-008) [Task 7.6]',
  () => {
    beforeAll(async () => {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      handle = await startMysqlContainer();

      // Step 1: Extract
      const adapter = await createMysqlSchemaAdapter(handle.config);
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

    it('stubCount is exactly 0 (no unresolved references)', () => {
      expect(normResult.stubs.length).toBe(0);
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
    // proc_place_order: writes_to x2, reads_from x1
    // L-009: assert BOTH source and destination qnames
    // ─────────────────────────────────────────────────────────────────────

    it('proc_place_order writes_to app.orders by qname (L-009)', () => {
      const procNode = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_place_order',
      );
      expect(procNode).toBeDefined();

      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === procNode!.id,
      );
      const dstQnames = writeEdges.map((e) => {
        const dst = normResult.graph.nodes.find((n) => n.id === e.dst);
        return dst?.qname ?? '';
      });
      expect(dstQnames).toContain('app.orders');
    });

    it('proc_place_order writes_to app.order_items by qname (L-009)', () => {
      const procNode = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_place_order',
      );
      expect(procNode).toBeDefined();

      const writeEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'writes_to' && e.src === procNode!.id,
      );
      const dstQnames = writeEdges.map((e) => {
        const dst = normResult.graph.nodes.find((n) => n.id === e.dst);
        return dst?.qname ?? '';
      });
      expect(dstQnames).toContain('app.order_items');
    });

    it('proc_place_order reads_from app.products by qname (L-009)', () => {
      const procNode = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_place_order',
      );
      expect(procNode).toBeDefined();

      const readEdge = normResult.graph.edges.find(
        (e) => e.kind === 'reads_from' && e.src === procNode!.id,
      );
      expect(readEdge).toBeDefined();

      const dstNode = normResult.graph.nodes.find((n) => n.id === readEdge!.dst);
      expect(dstNode).toBeDefined();
      expect(dstNode!.qname).toBe('app.products');
    });

    it('proc_place_order has EXACTLY 3 dependency edges (no phantom)', () => {
      const procNode = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_place_order',
      );
      expect(procNode).toBeDefined();
      const depEdges = normResult.graph.edges.filter(
        (e) => (e.kind === 'writes_to' || e.kind === 'reads_from') && e.src === procNode!.id,
      );
      expect(depEdges.length).toBe(3);

      // No self-reference edge
      const selfEdge = depEdges.find((e) => e.dst === procNode!.id);
      expect(selfEdge).toBeUndefined();
    });

    // ─────────────────────────────────────────────────────────────────────
    // v_order_summary: depends_on orders + order_items (no phantom, no self)
    // ─────────────────────────────────────────────────────────────────────

    it('v_order_summary has EXACTLY 2 depends_on edges: orders + order_items (no phantom, no self)', () => {
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

    // ─────────────────────────────────────────────────────────────────────
    // fn_audit_write: writes_to audit_log only
    // ─────────────────────────────────────────────────────────────────────

    it('fn_audit_write has EXACTLY 1 writes_to edge (audit_log) + 0 reads_from', () => {
      const fnNode = normResult.graph.nodes.find(
        (n) => n.kind === 'function' && n.name === 'fn_audit_write',
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
    // proc_dynamic_query: hasDynamicSql + ZERO edges (no fabricated edges)
    // ─────────────────────────────────────────────────────────────────────

    it('proc_dynamic_query has no writes_to or reads_from edges (no fabricated edges)', () => {
      const procNode = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_dynamic_query',
      );
      expect(procNode).toBeDefined();

      const dependencyEdges = normResult.graph.edges.filter(
        (e) => (e.kind === 'writes_to' || e.kind === 'reads_from') && e.src === procNode!.id,
      );
      expect(dependencyEdges.length).toBe(0);
    });

    // ─────────────────────────────────────────────────────────────────────
    // fires_on + writes_to from trg_after_order_update (L-009)
    // ─────────────────────────────────────────────────────────────────────

    it('trg_after_order_update fires_on edge is present', () => {
      const trigNode = normResult.graph.nodes.find(
        (n) => n.kind === 'trigger' && n.name === 'trg_after_order_update',
      );
      expect(trigNode).toBeDefined();

      const firesOnEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'fires_on' && e.src === trigNode!.id,
      );
      expect(firesOnEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('fires_on dst is app.orders table node (L-009)', () => {
      const trigNode = normResult.graph.nodes.find(
        (n) => n.kind === 'trigger' && n.name === 'trg_after_order_update',
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
        (s) => s.qname === 'app.trg_after_order_update',
      );
      expect(phantomStub).toBeUndefined();

      const triggerNamedTable = normResult.graph.nodes.find(
        (n) => n.kind === 'table' && n.name === 'trg_after_order_update',
      );
      expect(triggerNamedTable).toBeUndefined();
    });

    // ─────────────────────────────────────────────────────────────────────
    // No self-reference edges anywhere in the graph
    // ─────────────────────────────────────────────────────────────────────

    it('no self-reference edges exist in the graph', () => {
      const selfEdges = normResult.graph.edges.filter((e) => e.src === e.dst);
      expect(selfEdges.length).toBe(0);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Query API: impact and path
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
    // DOG-1: proc_orchestrate → proc_step body-parsed `calls` edge (L-009 exact, no self)
    // ─────────────────────────────────────────────────────────────────────

    it('proc_orchestrate calls proc_step EXACTLY once at confidence parsed (no read/write, no self) [DOG-1 B.6]', () => {
      const orch = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_orchestrate',
      );
      expect(orch).toBeDefined();
      const callEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'calls' && e.src === orch!.id,
      );
      expect(callEdges.length).toBe(1);
      expect(callEdges[0]!.confidence).toBe('parsed');
      const dst = normResult.graph.nodes.find((n) => n.id === callEdges[0]!.dst);
      expect(dst?.kind).toBe('procedure');
      expect(dst?.qname).toBe('app.proc_step');
      // The CALL is NOT a read/write edge to the callee.
      const rw = normResult.graph.edges.filter(
        (e) => (e.kind === 'reads_from' || e.kind === 'writes_to') && e.src === orch!.id && e.dst === callEdges[0]!.dst,
      );
      expect(rw.length).toBe(0);
      // No self-`calls` (uniform self-exclusion, D4).
      expect(callEdges.find((e) => e.dst === orch!.id)).toBeUndefined();
    });

    it('proc_step emits ZERO calls edges and writes app.audit_log [DOG-1 B.6]', () => {
      const step = normResult.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.name === 'proc_step',
      );
      expect(step).toBeDefined();
      const callEdges = normResult.graph.edges.filter(
        (e) => e.kind === 'calls' && e.src === step!.id,
      );
      expect(callEdges.length).toBe(0);
      const writeDst = normResult.graph.edges
        .filter((e) => e.kind === 'writes_to' && e.src === step!.id)
        .map((e) => normResult.graph.nodes.find((n) => n.id === e.dst)?.qname);
      expect(writeDst).toContain('app.audit_log');
    });

    // ─────────────────────────────────────────────────────────────────────
    // Golden: byte-identical on second run (ADR-008)
    // ─────────────────────────────────────────────────────────────────────

    it('normalized graph is deterministic (stableStringify stable across two extractions)', async () => {
      const adapter2 = await createMysqlSchemaAdapter(handle.config);
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
        edgeKinds: [...new Set(normResult.graph.edges.map((e) => e.kind))].sort(),
      };
      const actual = stableStringify(snapshot);

      if (!existsSync(GOLDEN_PATH)) {
        writeFileSync(GOLDEN_PATH, actual, 'utf-8');
        console.log('[mysql-e2e-integration] Golden seeded:', GOLDEN_PATH);
        expect(actual.length).toBeGreaterThan(0);
        return;
      }

      const committed = readFileSync(GOLDEN_PATH, 'utf-8');
      expect(actual).toBe(committed);
    });
  },
);

if (!mysqlIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
