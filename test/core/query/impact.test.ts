/**
 * Tests for getImpact — US-014.
 * Design §6.2: BFS blast-radius, read/write split, visible chains, depth cap,
 * cycle safety via visited set, dynamic-SQL warning propagation.
 * AAA: Arrange / Act / Assert. One behaviour per test.
 */

import { describe, it, expect } from 'vitest';
import { getImpact } from '../../../src/core/query/impact.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake store helpers (same pattern as neighbors test)
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  kind: GraphNode['kind'],
  qname: string,
  hasDynamicSql = false,
): GraphNode {
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
    payload: hasDynamicSql ? { hasDynamicSql: true } : {},
  };
}

function makeEdge(
  id: string,
  kind: GraphEdge['kind'],
  src: string,
  dst: string,
): GraphEdge {
  return { id, kind, src, dst, confidence: 'declared', score: null, attrs: {} };
}

/**
 * Build a fake GraphStore where edgesTo[nodeId] = edges whose dst is nodeId.
 * getEdgesFrom is also supplied so the store is well-formed.
 */
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
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Simple read chain: proc reads view reads orders.status column
const colNode = makeNode('col-id', 'column', 'dbo.orders.status');
const viewNode = makeNode('view-id', 'view', 'dbo.vw_orders');
const procNode = makeNode('proc-id', 'procedure', 'dbo.sp_report');

// view reads_from (depends_on) orders.status → inbound edge to col-id
const viewReadsCol = makeEdge('e1', 'reads_from', 'view-id', 'col-id');
// proc reads_from view → inbound edge to view-id
const procReadsView = makeEdge('e2', 'reads_from', 'proc-id', 'view-id');

// Write chain: trigger writes to orders.status
const trigNode = makeNode('trig-id', 'trigger', 'dbo.trg_orders');
const trigWritesCol = makeEdge('e3', 'writes_to', 'trig-id', 'col-id');

// Dynamic SQL node
const dynNode = makeNode('dyn-id', 'procedure', 'dbo.sp_dynamic', true);
const dynReadsCol = makeEdge('e4', 'reads_from', 'dyn-id', 'col-id');

// Cyclic graph: viewA depends on viewB, viewB depends on viewA
const viewA = makeNode('va', 'view', 'dbo.vw_a');
const viewB = makeNode('vb', 'view', 'dbo.vw_b');
const aDepB = makeEdge('e-ab', 'depends_on', 'va', 'vb');
const bDepA = makeEdge('e-ba', 'depends_on', 'vb', 'va');

function buildSimpleStore(): GraphStore {
  return makeFakeStore(
    [colNode, viewNode, procNode, trigNode, dynNode],
    {},
    {
      'col-id': [viewReadsCol, trigWritesCol, dynReadsCol],
      'view-id': [procReadsView],
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getImpact', () => {
  describe('read/write separation', () => {
    it('classifies reads_from/depends_on as readImpact', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      const readIds = result.readImpact.flatMap((c) => c.nodes);
      expect(readIds).toContain('view-id');
    });

    it('classifies writes_to as writeImpact', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      const writeIds = result.writeImpact.flatMap((c) => c.nodes);
      expect(writeIds).toContain('trig-id');
    });

    it('trigger does not appear in readImpact', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      const readIds = result.readImpact.flatMap((c) => c.nodes);
      expect(readIds).not.toContain('trig-id');
    });
  });

  describe('visible dependency chains', () => {
    it('returns a chain for a multi-hop read path', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      // Expected chains: col→view and col→view→proc
      const chains = result.readImpact;
      const procChain = chains.find((c) => c.nodes.at(-1) === 'proc-id');
      expect(procChain).toBeDefined();
      expect(procChain!.nodes).toEqual(['col-id', 'view-id', 'proc-id']);
      expect(procChain!.edges).toHaveLength(2);
    });

    it('chain nodes length = edges length + 1', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      for (const chain of [...result.readImpact, ...result.writeImpact]) {
        expect(chain.nodes.length).toBe(chain.edges.length + 1);
      }
    });

    it('first node of every chain is the queried nodeId', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      for (const chain of [...result.readImpact, ...result.writeImpact]) {
        expect(chain.nodes[0]).toBe('col-id');
      }
    });
  });

  describe('depth cap', () => {
    it('does not return chains deeper than depth', async () => {
      const store = buildSimpleStore();
      // depth:1 — only direct neighbors
      const result = await getImpact(store, { nodeId: 'col-id', depth: 1 });
      const maxLen = Math.max(
        ...result.readImpact.map((c) => c.nodes.length),
        ...result.writeImpact.map((c) => c.nodes.length),
        0,
      );
      // depth:1 means 1 hop — chain has at most 2 nodes
      expect(maxLen).toBeLessThanOrEqual(2);
    });

    it('sets truncated=true when depth cap cuts off expansion', async () => {
      const store = buildSimpleStore();
      // depth:1 cuts off proc-id (2 hops away from col-id)
      const result = await getImpact(store, { nodeId: 'col-id', depth: 1 });
      expect(result.truncated).toBe(true);
    });

    it('truncated=false when all reachable nodes fit within depth', async () => {
      const store = buildSimpleStore();
      // depth:10 — well beyond the 2-hop max in this fixture
      const result = await getImpact(store, { nodeId: 'col-id', depth: 10 });
      expect(result.truncated).toBe(false);
    });
  });

  describe('cycle safety', () => {
    it('terminates on a cyclic graph without infinite loop', async () => {
      const store = makeFakeStore(
        [viewA, viewB],
        {},
        {
          va: [bDepA], // vb depends_on va → inbound to va
          vb: [aDepB], // va depends_on vb → inbound to vb
        },
      );
      // Should not hang; just resolves
      const result = await getImpact(store, { nodeId: 'va' });
      expect(result).toBeDefined();
    });

    it('does not revisit nodes already in visited set', async () => {
      const store = makeFakeStore(
        [viewA, viewB],
        {},
        {
          va: [bDepA],
          vb: [aDepB],
        },
      );
      const result = await getImpact(store, { nodeId: 'va' });
      // Each nodeId appears at most once across all chain terminations
      const allNodes = [...result.readImpact, ...result.writeImpact].flatMap(
        (c) => c.nodes.slice(1), // skip start node
      );
      const seen = new Set(allNodes);
      // vb should appear at most once
      expect(allNodes.filter((id) => id === 'vb').length).toBeLessThanOrEqual(1);
      expect(seen.size).toBeLessThanOrEqual(allNodes.length);
    });
  });

  describe('dynamic SQL warning', () => {
    it('sets dynamicSqlWarning=true when a node in a chain has hasDynamicSql', async () => {
      const store = buildSimpleStore();
      const result = await getImpact(store, { nodeId: 'col-id' });
      // sp_dynamic has hasDynamicSql:true and reads col-id
      expect(result.dynamicSqlWarning).toBe(true);
    });

    it('dynamicSqlWarning=false when no node has hasDynamicSql', async () => {
      // Store without dyn node
      const store = makeFakeStore(
        [colNode, viewNode, procNode, trigNode],
        {},
        {
          'col-id': [viewReadsCol, trigWritesCol],
          'view-id': [procReadsView],
        },
      );
      const result = await getImpact(store, { nodeId: 'col-id' });
      expect(result.dynamicSqlWarning).toBe(false);
    });
  });

  describe('determinism', () => {
    it('produces identical output on two calls', async () => {
      const store = buildSimpleStore();
      const r1 = await getImpact(store, { nodeId: 'col-id' });
      const r2 = await getImpact(store, { nodeId: 'col-id' });
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });

  describe('default depth', () => {
    it('uses depth 3 when not specified', async () => {
      // Build a 4-hop chain: a→b→c→d→e
      const na = makeNode('a', 'view', 'dbo.a');
      const nb = makeNode('b', 'view', 'dbo.b');
      const nc = makeNode('c', 'view', 'dbo.c');
      const nd = makeNode('d', 'view', 'dbo.d');
      const ne = makeNode('e', 'view', 'dbo.e');
      const store = makeFakeStore(
        [na, nb, nc, nd, ne],
        {},
        {
          a: [makeEdge('ab', 'depends_on', 'b', 'a')],
          b: [makeEdge('bc', 'depends_on', 'c', 'b')],
          c: [makeEdge('cd', 'depends_on', 'd', 'c')],
          d: [makeEdge('de', 'depends_on', 'e', 'd')],
        },
      );
      const result = await getImpact(store, { nodeId: 'a' });
      // With depth 3, node 'e' (4 hops away) should NOT appear
      const allNodes = [...result.readImpact, ...result.writeImpact].flatMap((c) => c.nodes);
      expect(allNodes).not.toContain('e');
      expect(result.truncated).toBe(true);
    });
  });
});
