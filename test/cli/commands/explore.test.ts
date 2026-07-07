/**
 * Tests for src/cli/commands/explore.ts — task 5.2 (phase-4-cli-config).
 * Spec: cli-config "explore output comes from a pure formatter shared with the MCP tool"
 * Design: explore resolves qname → GraphNode + getNeighbors → ExploreView → formatExplore.
 *   --detail defaults to 'normal'; brief|normal|full all render via the SAME formatter.
 *   Output is deterministic, golden-pinned (ADR-008).
 *
 * Tests use fake GraphStore (no real DB, no file I/O).
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import type {
  GraphNode,
  GraphStore,
  SnapshotRecord,
  UpsertResult,
  GraphEdge,
  SearchHit,
} from '../../../src/index.js';
import { runExplore, type ExploreOptions } from '../../../src/cli/commands/explore.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  kind: GraphNode['kind'] = 'table',
  qname?: string,
): GraphNode {
  return {
    id,
    kind,
    schema: 'dbo',
    name: id,
    qname: qname ?? `dbo.${id}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: `hash-${id}`,
    payload: {},
  };
}

function makeFakeStore(opts: {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
} = {}): GraphStore {
  const nodes = opts.nodes ?? [];
  const edges = opts.edges ?? [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeByQname = new Map(nodes.map((n) => [n.qname, n]));

  return {
    async close() {},
    async schemaVersion() { return 1; },
    async upsertGraph() { return { nodes: 0, edges: 0 } as UpsertResult; },
    async deleteNodes() { return 0; },
    async getNodesByKind(kind) { return nodes.filter((n) => n.kind === kind); },
    async getNode(id) { return nodeById.get(id) ?? null; },
    async getNodeByQName(kind, qname) {
      const n = nodeByQname.get(qname);
      return n?.kind === kind ? n : null;
    },
    async getEdgesFrom(nodeId) {
      return edges.filter((e) => e.src === nodeId);
    },
    async getEdgesTo(nodeId) {
      return edges.filter((e) => e.dst === nodeId);
    },
    async searchFts() { return { hits: [] as readonly SearchHit[], total: 0 }; },
    async putSnapshot() {},
    async listSnapshots() { return [] as readonly SnapshotRecord[]; },
    async getSnapshotObjects() { return []; },
    async getMeta() { return null; },
    async setMeta() {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ORDERS = makeNode('orders', 'table', 'dbo.orders');
const CUSTOMERS = makeNode('customers', 'table', 'dbo.customers');
const ORDER_ID_COL = makeNode('order_id', 'column', 'dbo.orders.order_id');

const FK_EDGE: GraphEdge = {
  id: 'edge-fk',
  kind: 'references',
  src: ORDERS.id,
  dst: CUSTOMERS.id,
  confidence: 'declared',
  score: null,
  attrs: {},
};

const HAS_COL_EDGE: GraphEdge = {
  id: 'edge-col',
  kind: 'has_column',
  src: ORDERS.id,
  dst: ORDER_ID_COL.id,
  confidence: 'declared',
  score: null,
  attrs: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// runExplore — basic behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('runExplore — resolves qname and formats output', () => {
  it('resolves by qname and includes it in the output', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'normal' };

    const result = await runExplore(opts);

    expect(result.type).toBe('success');
    expect(result.output).toContain('dbo.orders');
  });

  it('includes kind in the output', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'normal' };

    const result = await runExplore(opts);

    expect(result.output).toContain('table');
  });

  it('output includes neighbor qnames when edges exist', async () => {
    const store = makeFakeStore({
      nodes: [ORDERS, CUSTOMERS, ORDER_ID_COL],
      edges: [FK_EDGE, HAS_COL_EDGE],
    });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'normal' };

    const result = await runExplore(opts);

    expect(result.output).toContain('dbo.customers');
    expect(result.output).toContain('dbo.orders.order_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --detail levels
// ─────────────────────────────────────────────────────────────────────────────

describe('runExplore — detail levels', () => {
  it('brief: does NOT include bodyHash', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'brief' };

    const result = await runExplore(opts);

    expect(result.output).not.toContain('hash-orders');
  });

  it('normal: default detail resolves correctly', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'normal' };

    const result = await runExplore(opts);

    expect(result.output).toContain('dbo.orders');
    expect(result.output).not.toContain('hash-orders');
  });

  it('full: includes bodyHash', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'full' };

    const result = await runExplore(opts);

    expect(result.output).toContain('hash-orders');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Not-found case
// ─────────────────────────────────────────────────────────────────────────────

describe('runExplore — not-found', () => {
  it('throws NotFoundError when qname does not exist in the store', async () => {
    const store = makeFakeStore({ nodes: [] });
    const opts: ExploreOptions = { store, qname: 'dbo.nonexistent', detail: 'normal' };

    await expect(runExplore(opts)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('runExplore — determinism (ADR-008)', () => {
  it('same store + qname + detail → byte-identical output on two calls', async () => {
    const store = makeFakeStore({
      nodes: [ORDERS, CUSTOMERS, ORDER_ID_COL],
      edges: [FK_EDGE, HAS_COL_EDGE],
    });
    const opts: ExploreOptions = { store, qname: 'dbo.orders', detail: 'normal' };

    const run1 = await runExplore(opts);
    const run2 = await runExplore(opts);

    expect(run1.output).toBe(run2.output);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return type
// ─────────────────────────────────────────────────────────────────────────────

describe('runExplore — return type', () => {
  it('returns { type: success, output: string } on success', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const result = await runExplore({ store, qname: 'dbo.orders', detail: 'normal' });

    expect(result.type).toBe('success');
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D3 — [view] resolution fix: prefer a real node over a phantom stub with the
// same qname (explore-payloads B.5). Torture mints a phantom `table` stub for the
// active_departments view (INSTEAD OF trigger target); the real `view` must win.
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_QNAME = 'main.active_departments';

/** A store where the qname resolves to a phantom table STUB and a real VIEW. */
function makeViewStubStore(): GraphStore {
  const realView: GraphNode = {
    ...makeNode('active_departments', 'view', VIEW_QNAME),
    id: 'real-view',
    schema: 'main',
    missing: false,
  };
  const phantomTable: GraphNode = {
    ...makeNode('active_departments', 'table', VIEW_QNAME),
    id: 'phantom-table',
    schema: 'main',
    missing: true,
  };
  return {
    ...makeFakeStore(),
    async getNodeByQName(kind, qname) {
      if (qname !== VIEW_QNAME) return null;
      if (kind === 'table') return phantomTable; // NODE_KINDS visits 'table' before 'view'
      if (kind === 'view') return realView;
      return null;
    },
  };
}

describe('runExplore — D3 [view] resolution (explore-payloads B.5)', () => {
  it('prefers the real view over the phantom table stub → header reads [view]', async () => {
    const store = makeViewStubStore();
    const result = await runExplore({ store, qname: VIEW_QNAME, detail: 'brief' });

    expect(result.output).toContain(`${VIEW_QNAME}  [view]`);
    expect(result.output).not.toContain('[table]');
  });
});
