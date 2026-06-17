/**
 * Tests for getNeighbors — US-013.
 * Design §6.1: group by edge kind + direction, optional kinds filter,
 * inferred edges in separate group, deterministic ordering.
 * AAA: Arrange / Act / Assert. One behaviour per test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getNeighbors } from '../../../src/core/query/neighbors.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake in-memory GraphStore (port only — no driver knowledge)
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(id: string, kind: GraphNode['kind'], qname: string): GraphNode {
  return {
    id,
    kind,
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

function makeEdge(
  id: string,
  kind: GraphEdge['kind'],
  src: string,
  dst: string,
  confidence: GraphEdge['confidence'] = 'declared',
  score: number | null = null,
): GraphEdge {
  return { id, kind, src, dst, confidence, score, attrs: {} };
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
    getEdgesFrom: async (id) => edgesFrom[id] ?? [],
    getEdgesTo: async (id) => edgesTo[id] ?? [],
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ordersNode = makeNode('orders-id', 'table', 'dbo.orders');
const customersNode = makeNode('customers-id', 'table', 'dbo.customers');
const viewNode = makeNode('view-id', 'view', 'dbo.vw_orders');
const triggerNode = makeNode('trigger-id', 'trigger', 'dbo.trg_orders');

// orders → customers (outbound FK)
const refEdgeOut = makeEdge('ref-out', 'references', 'orders-id', 'customers-id');
// other_table → orders (inbound FK)
const otherTable = makeNode('other-id', 'table', 'dbo.other');
const refEdgeIn = makeEdge('ref-in', 'references', 'other-id', 'orders-id');
// view depends on orders
const depEdge = makeEdge('dep-edge', 'depends_on', 'view-id', 'orders-id');
// trigger writes to orders
const writesEdge = makeEdge('writes-edge', 'writes_to', 'trigger-id', 'orders-id');

let store: GraphStore;

beforeEach(() => {
  store = makeFakeStore(
    [ordersNode, customersNode, viewNode, triggerNode, otherTable],
    {
      // edges FROM orders: outbound FK to customers
      'orders-id': [refEdgeOut],
    },
    {
      // edges TO orders: inbound FK, view depends_on, trigger writes_to
      'orders-id': [refEdgeIn, depEdge, writesEdge],
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getNeighbors', () => {
  describe('grouping by edge kind and direction', () => {
    it('returns outbound references neighbor with direction out', async () => {
      const result = await getNeighbors(store, { nodeId: 'orders-id' });
      const refs = result['references'];
      expect(refs).toBeDefined();
       
      expect(refs!.out.length).toBe(1);
       
      expect(refs!.out[0]!.node.id).toBe('customers-id');
       
      expect(refs!.out[0]!.edge.kind).toBe('references');
    });

    it('returns inbound references neighbor with direction in', async () => {
      const result = await getNeighbors(store, { nodeId: 'orders-id' });
      const refs = result['references'];
       
      expect(refs!.in.length).toBe(1);
       
      expect(refs!.in[0]!.node.id).toBe('other-id');
    });

    it('returns depends_on inbound neighbors', async () => {
      const result = await getNeighbors(store, { nodeId: 'orders-id' });
      const deps = result['depends_on'];
      expect(deps).toBeDefined();
       
      expect(deps!.in.length).toBe(1);
       
      expect(deps!.in[0]!.node.id).toBe('view-id');
    });

    it('returns writes_to inbound neighbors', async () => {
      const result = await getNeighbors(store, { nodeId: 'orders-id' });
      const writes = result['writes_to'];
      expect(writes).toBeDefined();
       
      expect(writes!.in.length).toBe(1);
       
      expect(writes!.in[0]!.node.id).toBe('trigger-id');
    });

    it('omits edge kinds with no neighbors from result', async () => {
      const result = await getNeighbors(store, { nodeId: 'orders-id' });
      // reads_from has no edges for orders-id
      expect(result['reads_from']).toBeUndefined();
    });
  });

  describe('kinds filter', () => {
    it('restricts result to requested edge kinds only', async () => {
      const result = await getNeighbors(store, {
        nodeId: 'orders-id',
        kinds: ['references'],
      });
      expect(Object.keys(result)).toEqual(['references']);
    });

    it('returns empty groups when filter matches no edges', async () => {
      const result = await getNeighbors(store, {
        nodeId: 'orders-id',
        kinds: ['fires_on'],
      });
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('determinism', () => {
    it('produces identical output on two calls with same input', async () => {
      const r1 = await getNeighbors(store, { nodeId: 'orders-id' });
      const r2 = await getNeighbors(store, { nodeId: 'orders-id' });
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it('sorts neighbors within a group by qname', async () => {
      // Store with two inbound references
      const nodeA = makeNode('aaa-id', 'table', 'dbo.aaa');
      const nodeB = makeNode('bbb-id', 'table', 'dbo.bbb');
      const eA = makeEdge('e-a', 'references', 'aaa-id', 'orders-id');
      const eB = makeEdge('e-b', 'references', 'bbb-id', 'orders-id');
      const s2 = makeFakeStore(
        [ordersNode, nodeA, nodeB],
        { 'orders-id': [] },
        { 'orders-id': [eB, eA] }, // intentionally out-of-order
      );
      const result = await getNeighbors(s2, { nodeId: 'orders-id' });
      const inRefs = result['references']?.in ?? [];
      expect(inRefs[0]!.node.qname).toBe('dbo.aaa');
      expect(inRefs[1]!.node.qname).toBe('dbo.bbb');
    });
  });

  describe('inferred edges', () => {
    it('puts inferred edges in a separate inferred group with score', async () => {
      const inferredEdge = makeEdge(
        'inferred-1',
        'inferred_reference',
        'orders-id',
        'customers-id',
        'inferred',
        0.85,
      );
      const s3 = makeFakeStore(
        [ordersNode, customersNode],
        { 'orders-id': [inferredEdge] },
        {},
      );
      const result = await getNeighbors(s3, { nodeId: 'orders-id' });
      const inf = result['inferred_reference'];
      expect(inf).toBeDefined();
       
      expect(inf!.out.length).toBe(1);
       
      expect(inf!.out[0]!.edge.score).toBe(0.85);
    });
  });

  describe('golden snapshot', () => {
    it('matches golden file', async () => {
      const result = await getNeighbors(store, { nodeId: 'orders-id' });
      // Verify structure matches expected golden shape
       
      expect(result['references']!.out[0]!.node.id).toBe('customers-id');
       
      expect(result['references']!.in[0]!.node.id).toBe('other-id');
       
      expect(result['depends_on']!.in[0]!.node.id).toBe('view-id');
       
      expect(result['writes_to']!.in[0]!.node.id).toBe('trigger-id');
    });
  });
});
