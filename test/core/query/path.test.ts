/**
 * Tests for findJoinPath — US-015.
 * Design §6.3: BFS over references edges, exact join columns per hop,
 * no-route → nearest neighbors suggestion, inferred flag (always false in P1).
 * AAA: Arrange / Act / Assert. One behaviour per test.
 */

import { describe, it, expect } from 'vitest';
import { findJoinPath } from '../../../src/core/query/path.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTable(id: string, qname: string): GraphNode {
  return {
    id,
    kind: 'table',
    schema: 'dbo',
    name: qname.split('.').pop() ?? qname,
    qname,
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: {},
  };
}

function makeRefEdge(
  id: string,
  src: string,
  dst: string,
  srcCol: string,
  dstCol: string,
  aggregate = false,
): GraphEdge {
  return {
    id,
    kind: 'references',
    src,
    dst,
    confidence: 'declared',
    score: null,
    // exactOptionalPropertyTypes: use conditional spread, never assign undefined explicitly
    attrs: {
      ...(aggregate ? { aggregate: true as const } : { srcColumn: srcCol, dstColumn: dstCol }),
    },
  };
}

function makeFakeStore(
  nodes: GraphNode[],
  edgesFrom: Record<string, GraphEdge[]>,
  edgesTo: Record<string, GraphEdge[]>,
): GraphStore {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return {
    close: async () => {},
    schemaVersion: async () => 1,
    upsertGraph: async () => ({ nodes: 0, edges: 0 }),
    deleteNodes: async () => 0,
    getNode: async (id) => nodeMap.get(id) ?? null,
    getNodesByKind: async () => [],
    getNodeByQName: async () => null,
    getEdgesFrom: async (id, kinds) => {
      const all = edgesFrom[id] ?? [];
      if (kinds === undefined || kinds.length === 0) return all;
      return all.filter((e) => kinds.includes(e.kind));
    },
    getEdgesTo: async (id, kinds) => {
      const all = edgesTo[id] ?? [];
      if (kinds === undefined || kinds.length === 0) return all;
      return all.filter((e) => kinds.includes(e.kind));
    },
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// customers ←─references─ orders ←─references─ shipments
// (orders.customer_id → customers.id)
// (shipments.order_id → orders.id)

const customers = makeTable('cust-id', 'dbo.customers');
const orders = makeTable('ord-id', 'dbo.orders');
const shipments = makeTable('ship-id', 'dbo.shipments');

// Aggregated table→table edges (no srcColumn/dstColumn; used for BFS traversal)
const aggOrdCust = makeRefEdge('agg-oc', 'ord-id', 'cust-id', '', '', true);
const aggShipOrd = makeRefEdge('agg-so', 'ship-id', 'ord-id', '', '', true);

// Per-column edges (used to extract join columns for each hop)
const colOrdCust = makeRefEdge('col-oc', 'ord-id', 'cust-id', 'customer_id', 'id');
const colShipOrd = makeRefEdge('col-so', 'ship-id', 'ord-id', 'order_id', 'id');

function buildLinearStore(): GraphStore {
  return makeFakeStore(
    [customers, orders, shipments],
    {
      'ord-id': [aggOrdCust, colOrdCust],
      'ship-id': [aggShipOrd, colShipOrd],
    },
    {
      'cust-id': [aggOrdCust, colOrdCust],
      'ord-id': [aggShipOrd, colShipOrd],
    },
  );
}

// Isolated node — no connections
const isolated = makeTable('iso-id', 'dbo.isolated');

function buildIsolatedStore(): GraphStore {
  return makeFakeStore(
    [customers, orders, isolated],
    {
      'ord-id': [aggOrdCust, colOrdCust],
    },
    {
      'cust-id': [aggOrdCust, colOrdCust],
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('findJoinPath', () => {
  describe('direct path', () => {
    it('returns found=true for directly connected tables', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'ord-id', to: 'cust-id' });
      expect(result.found).toBe(true);
    });

    it('returns one hop with exact join columns', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'ord-id', to: 'cust-id' });
      expect(result.hops).toBeDefined();
      expect(result.hops!.length).toBe(1);
       
      const hop = result.hops![0]!;
      expect(hop.fromTable).toBe('ord-id');
      expect(hop.toTable).toBe('cust-id');
      expect(hop.joinColumns).toHaveLength(1);
       
      expect(hop.joinColumns[0]!.from).toBe('customer_id');
       
      expect(hop.joinColumns[0]!.to).toBe('id');
    });

    it('works in both directions (join is bidirectional)', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'cust-id', to: 'ord-id' });
      expect(result.found).toBe(true);
      expect(result.hops!.length).toBe(1);
    });
  });

  describe('multi-hop path', () => {
    it('returns the shortest path through an intermediate node', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'ship-id', to: 'cust-id' });
      expect(result.found).toBe(true);
      expect(result.hops!.length).toBe(2);
    });

    it('each hop carries its own join columns', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'ship-id', to: 'cust-id' });
       
      const hop1 = result.hops![0]!;
       
      const hop2 = result.hops![1]!;
       
      expect(hop1.joinColumns[0]!.from).toBe('order_id');
       
      expect(hop1.joinColumns[0]!.to).toBe('id');
       
      expect(hop2.joinColumns[0]!.from).toBe('customer_id');
       
      expect(hop2.joinColumns[0]!.to).toBe('id');
    });
  });

  describe('same node path', () => {
    it('returns found=true with empty hops when from===to', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'ord-id', to: 'ord-id' });
      expect(result.found).toBe(true);
      expect(result.hops).toEqual([]);
    });
  });

  describe('no route', () => {
    it('returns found=false when no connecting route exists', async () => {
      const store = buildIsolatedStore();
      const result = await findJoinPath(store, { from: 'ord-id', to: 'iso-id' });
      expect(result.found).toBe(false);
    });

    it('suggests nearest neighbors of each endpoint when no route exists', async () => {
      const store = buildIsolatedStore();
      const result = await findJoinPath(store, { from: 'ord-id', to: 'iso-id' });
      expect(result.nearest).toBeDefined();
      // orders' neighbor is customers
      expect(result.nearest!.from).toContain('cust-id');
      // isolated has no neighbors
      expect(result.nearest!.to).toHaveLength(0);
    });
  });

  describe('inferred flag', () => {
    it('inferred is false in Phase 1 (no inferred_reference edges traversed)', async () => {
      const store = buildLinearStore();
      const result = await findJoinPath(store, { from: 'ord-id', to: 'cust-id' });
      expect(result.inferred).toBe(false);
    });
  });

  describe('determinism', () => {
    it('produces identical output on two calls', async () => {
      const store = buildLinearStore();
      const r1 = await findJoinPath(store, { from: 'ship-id', to: 'cust-id' });
      const r2 = await findJoinPath(store, { from: 'ship-id', to: 'cust-id' });
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
