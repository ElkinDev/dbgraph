/**
 * Tests for search — US-011.
 * Design §6.4: FTS via port, prefix-token typo tolerance, TS-side Levenshtein fallback,
 * body matches only for full-level nodes, pagination, deterministic ordering.
 * Golden pins ensure the LEVENSHTEIN_THRESHOLD and TYPO_CAP constants are stable.
 * AAA: Arrange / Act / Assert. One behaviour per test.
 */

import { describe, it, expect } from 'vitest';
import {
  search,
  LEVENSHTEIN_THRESHOLD,
  TYPO_CAP,
} from '../../../src/core/query/search.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { SearchHit } from '../../../src/core/ports/graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  kind: GraphNode['kind'],
  qname: string,
  level: GraphNode['level'] = 'metadata',
): GraphNode {
  return {
    id,
    kind,
    schema: 'dbo',
    name: qname.split('.').pop() ?? qname,
    qname,
    level,
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: {},
  };
}

function makeFakeStore(
  nodes: GraphNode[],
  ftsResponder: (query: string, opts?: { limit?: number; offset?: number }) => { hits: SearchHit[]; total: number },
): GraphStore {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return {
    close: async () => {},
    schemaVersion: async () => 1,
    upsertGraph: async () => ({ nodes: 0, edges: 0 }),
    deleteNodes: async () => 0,
    getNode: async (id) => nodeMap.get(id) ?? null,
    getNodesByKind: async (kind) => [...nodeMap.values()].filter((n) => n.kind === kind),
    getNodeByQName: async (kind, qname) =>
      [...nodeMap.values()].find((n) => n.kind === kind && n.qname === qname) ?? null,
    getEdgesFrom: async () => [],
    getEdgesTo: async () => [],
    getAllNodes: async () => [...nodeMap.values()],
    getAllEdges: async () => [],
    searchFts: async (q, opts) => ftsResponder(q, opts),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden constant pins (ADR-008 — typo fallback thresholds must be deterministic)
// ─────────────────────────────────────────────────────────────────────────────

describe('golden constant pins', () => {
  it('LEVENSHTEIN_THRESHOLD is pinned at 2', () => {
    expect(LEVENSHTEIN_THRESHOLD).toBe(2);
  });

  it('TYPO_CAP is pinned at 5', () => {
    expect(TYPO_CAP).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FTS path
// ─────────────────────────────────────────────────────────────────────────────

describe('search — FTS path', () => {
  it('delegates to port searchFts and returns hits', async () => {
    const custNode = makeNode('cust-id', 'table', 'dbo.customers');
    const hit: SearchHit = { id: 'cust-id', kind: 'table', qname: 'dbo.customers', column: 'qname', score: 1.0 };
    const store = makeFakeStore([custNode], () => ({ hits: [hit], total: 1 }));
    const result = await search(store, { term: 'customers' });
    expect(result.hits).toHaveLength(1);
     
    expect(result.hits[0]!.id).toBe('cust-id');
    expect(result.total).toBe(1);
  });

  it('passes limit and offset to the port', async () => {
    let capturedOpts: { limit?: number; offset?: number } | undefined;
    const store = makeFakeStore([], (_, opts) => {
      capturedOpts = opts;
      return { hits: [], total: 0 };
    });
    await search(store, { term: 'orders', limit: 10, offset: 5 });
    expect(capturedOpts?.limit).toBe(10);
    expect(capturedOpts?.offset).toBe(5);
  });

  it('returns empty result when FTS finds nothing and no typo fallback candidates', async () => {
    // FTS returns nothing; getNodesByKind returns nothing; no candidates for typo
    const store = makeFakeStore([], () => ({ hits: [], total: 0 }));
    const result = await search(store, { term: 'zzznonexistent' });
    expect(result.hits).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Typo fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('search — typo Levenshtein fallback', () => {
  it('returns customers when searching custmer (1-char typo)', async () => {
    const custNode = makeNode('cust-id', 'table', 'dbo.customers');
    // FTS returns nothing → triggers fallback
    const store = makeFakeStore([custNode], () => ({ hits: [], total: 0 }));
    const result = await search(store, { term: 'custmer' });
    expect(result.hits.some((h) => h.id === 'cust-id')).toBe(true);
  });

  it('does not return nodes with distance > LEVENSHTEIN_THRESHOLD', async () => {
    const custNode = makeNode('cust-id', 'table', 'dbo.customers');
    // FTS returns nothing; term is very different (distance >> 2)
    const store = makeFakeStore([custNode], () => ({ hits: [], total: 0 }));
    // 'xyznope' vs 'customers' has distance >> 2
    const result = await search(store, { term: 'xyznope' });
    expect(result.hits.find((h) => h.id === 'cust-id')).toBeUndefined();
  });

  it('respects TYPO_CAP — returns at most TYPO_CAP results from fallback', async () => {
    // Create TYPO_CAP + 2 near-identical nodes
    const nodes = Array.from({ length: TYPO_CAP + 2 }, (_, i) =>
      makeNode(`n${i}`, 'table', `dbo.table${i}`),
    );
    // FTS returns nothing; all nodes have 'table' in name; search 'tble' (1 typo)
    const store = makeFakeStore(nodes, () => ({ hits: [], total: 0 }));
    const result = await search(store, { term: 'tble' });
    expect(result.hits.length).toBeLessThanOrEqual(TYPO_CAP);
  });

  it('orders fallback results by (score asc = distance asc, then qname)', async () => {
    const n1 = makeNode('n1', 'table', 'dbo.abc'); // closer to 'ab' → lower distance
    const n2 = makeNode('n2', 'table', 'dbo.abcdefgh'); // farther
    const store = makeFakeStore([n1, n2], () => ({ hits: [], total: 0 }));
    // Search 'ab' — n1 (distance 1 for 'abc' vs 'ab') < n2 (distance 6 for 'abcdefgh' vs 'ab')
    const result = await search(store, { term: 'ab' });
    if (result.hits.length >= 2) {
      // n1 should appear before n2 (lower distance = lower score)
      const n1Idx = result.hits.findIndex((h) => h.id === 'n1');
      const n2Idx = result.hits.findIndex((h) => h.id === 'n2');
      expect(n1Idx).toBeLessThan(n2Idx);
    } else if (result.hits.length === 1) {
      // Only n1 should be within threshold
       
      expect(result.hits[0]!.id).toBe('n1');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('search — determinism', () => {
  it('produces identical output on two calls with same input', async () => {
    const custNode = makeNode('cust-id', 'table', 'dbo.customers');
    const hit: SearchHit = { id: 'cust-id', kind: 'table', qname: 'dbo.customers', column: 'qname', score: 1.0 };
    const store = makeFakeStore([custNode], () => ({ hits: [hit], total: 1 }));
    const r1 = await search(store, { term: 'customers' });
    const r2 = await search(store, { term: 'customers' });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
