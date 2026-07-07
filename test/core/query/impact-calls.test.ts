/**
 * DOG-1 C.1 — getImpact traverses `calls` as a READ-impact edge kind.
 * Spec graph-query "Depth-limited impact closure" (S14): `IMPACT_EDGE_KINDS += 'calls'`,
 *   a caller depends on its callee like a READ (not a write), so the impact closure of a
 *   called routine reaches its CALLERS through inbound `calls` edges; WRITE impact stays
 *   `writes_to`-only. Design D6.
 *
 * STRICT TDD — this test PRECEDES the `IMPACT_EDGE_KINDS` change (RED: without `calls` in
 *   the traversed kinds, getImpact(usp_log_change) surfaces NO caller → readImpact empty).
 * L-009 EXACT-set: the caller reached is EXACTLY `{dbo.usp_refresh_totals}` via a `calls`
 *   edge, absent from every write-impact set; explicit negatives; byte-identical re-run (ADR-008).
 *
 * Synthetic in-memory mssql routine chain — NO container (default-CI tier, design §Testing Q2).
 * Neutral fixture names only.
 */

import { describe, it, expect } from 'vitest';
import { getImpact } from '../../../src/core/query/impact.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake store helpers (same pattern as impact.test.ts / neighbors.test.ts)
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
): GraphEdge {
  return { id, kind, src, dst, confidence, score: null, attrs: {} };
}

function makeFakeStore(
  nodes: GraphNode[],
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
    getEdgesFrom: async () => [],
    getEdgesTo: async (id, kinds) => {
      const all = edgesTo[id] ?? [];
      return kinds === undefined ? all : all.filter((e) => kinds.includes(e.kind));
    },
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic mssql routine chain (neutral names, mirrors torture.sql A.6 fixture):
//   dbo.usp_refresh_totals  --calls-->      dbo.usp_log_change   (declared)
//   dbo.usp_refresh_totals  --writes_to-->  dbo.order_totals     (parsed)
//   dbo.usp_log_change      --writes_to-->  dbo.audit_log        (parsed)
// getImpact walks INBOUND edges (getEdgesTo) — so the inbound map keys on the callee/target.
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH = makeNode('n-refresh', 'procedure', 'dbo.usp_refresh_totals');
const LOG = makeNode('n-log', 'procedure', 'dbo.usp_log_change');
const TOTALS = makeNode('n-totals', 'table', 'dbo.order_totals');
const AUDIT = makeNode('n-audit', 'table', 'dbo.audit_log');

const CALLS_REFRESH_TO_LOG = makeEdge('e-calls', 'calls', 'n-refresh', 'n-log', 'declared');
const WRITES_REFRESH_TOTALS = makeEdge('e-w1', 'writes_to', 'n-refresh', 'n-totals', 'parsed');
const WRITES_LOG_AUDIT = makeEdge('e-w2', 'writes_to', 'n-log', 'n-audit', 'parsed');

function buildSingleCallerStore(): GraphStore {
  return makeFakeStore(
    [REFRESH, LOG, TOTALS, AUDIT],
    {
      'n-log': [CALLS_REFRESH_TO_LOG],   // usp_refresh_totals CALLS usp_log_change
      'n-totals': [WRITES_REFRESH_TOTALS],
      'n-audit': [WRITES_LOG_AUDIT],
      'n-refresh': [],                    // nothing invokes usp_refresh_totals
    },
  );
}

// Two-level call chain for TRIANGULATION: daily → refresh → log.
const DAILY = makeNode('n-daily', 'procedure', 'dbo.usp_daily_rollup');
const CALLS_DAILY_TO_REFRESH = makeEdge('e-calls2', 'calls', 'n-daily', 'n-refresh', 'declared');

function buildTwoLevelCallStore(): GraphStore {
  return makeFakeStore(
    [REFRESH, LOG, DAILY],
    {
      'n-log': [CALLS_REFRESH_TO_LOG],       // refresh calls log
      'n-refresh': [CALLS_DAILY_TO_REFRESH], // daily calls refresh
      'n-daily': [],
    },
  );
}

async function qnamesOf(store: GraphStore, ids: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const n = await store.getNode(id);
    if (n !== null) out.push(n.qname);
  }
  return [...new Set(out)].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getImpact — calls traversal as READ-impact (DOG-1 C.1, S14)', () => {
  it('READ impact of a called routine is EXACTLY {dbo.usp_refresh_totals} via the inbound calls edge', async () => {
    const store = buildSingleCallerStore();
    const result = await getImpact(store, { nodeId: 'n-log' });

    // The callee's READ closure reaches its caller through the inbound `calls` edge.
    const readCallerIds = result.readImpact.flatMap((c) => c.nodes.slice(1));
    const readCallers = await qnamesOf(store, readCallerIds);
    expect(readCallers).toStrictEqual(['dbo.usp_refresh_totals']);

    // The caller is reached SPECIFICALLY through a `calls` edge (not reads_from/writes_to).
    const chain = result.readImpact.find((c) => c.nodes.at(-1) === 'n-refresh');
    expect(chain).toBeDefined();
    expect(chain!.edges).toStrictEqual(['calls']);
  });

  it('NEGATIVE: dbo.usp_refresh_totals appears in NO write-impact set (a calls edge is READ-impact)', async () => {
    const store = buildSingleCallerStore();
    const result = await getImpact(store, { nodeId: 'n-log' });

    expect(result.writeImpact).toStrictEqual([]);
    const writeNodes = new Set(result.writeImpact.flatMap((c) => c.nodes));
    expect(writeNodes.has('n-refresh')).toBe(false);
  });

  it('TRIANGULATION: multi-hop calls chain surfaces EVERY transitive caller through inbound calls', async () => {
    // daily → refresh → log ; getImpact(log) must reach BOTH refresh AND daily via `calls`.
    const store = buildTwoLevelCallStore();
    const result = await getImpact(store, { nodeId: 'n-log', depth: 3 });

    const readCallerIds = result.readImpact.flatMap((c) => c.nodes.slice(1));
    const readCallers = await qnamesOf(store, readCallerIds);
    expect(readCallers).toStrictEqual(['dbo.usp_daily_rollup', 'dbo.usp_refresh_totals']);

    // The two-hop chain is entirely `calls` edges.
    const dailyChain = result.readImpact.find((c) => c.nodes.at(-1) === 'n-daily');
    expect(dailyChain).toBeDefined();
    expect(dailyChain!.edges).toStrictEqual(['calls', 'calls']);
    expect(result.writeImpact).toStrictEqual([]);
  });

  it('MIXED: a calls edge stays READ-impact even downstream of a write hop', async () => {
    // getImpact(audit_log): log WRITES audit (write hop), refresh CALLS log (read hop beyond).
    const store = buildSingleCallerStore();
    const result = await getImpact(store, { nodeId: 'n-audit' });

    // log is a WRITER of audit_log (writes_to).
    const writeNodes = new Set(result.writeImpact.flatMap((c) => c.nodes));
    expect(writeNodes.has('n-log')).toBe(true);

    // refresh is reached beyond log through a `calls` hop → READ impact, never WRITE.
    const readNodes = new Set(result.readImpact.flatMap((c) => c.nodes));
    expect(readNodes.has('n-refresh')).toBe(true);
    expect(writeNodes.has('n-refresh')).toBe(false);
  });

  it('byte-identical on re-run (ADR-008 determinism)', async () => {
    const store = buildSingleCallerStore();
    const r1 = await getImpact(store, { nodeId: 'n-log' });
    const r2 = await getImpact(store, { nodeId: 'n-log' });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
