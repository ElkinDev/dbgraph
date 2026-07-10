/**
 * DOG-3 C.2 — getImpact resolves a COLUMN-node pivot to its owning TABLE, then applies
 * `filterReadersByColumn` at the view FIRST-HOP `depends_on` edges (design D6). A TABLE-node
 * pivot is UNCHANGED (unfiltered, object-grain, exactly the pre-DOG-3 behavior).
 *
 * Strict TDD RED: before this change, `getImpact` never resolves a column pivot to its owner,
 * so `getEdgesTo(columnId, ...)` returns nothing and no chain is ever produced — every
 * column-pivot assertion below fails until the resolution + first-hop filter lands.
 *
 * L-009 EXACT-set over a synthetic mssql-shaped graph (fake store, same pattern as
 * impact-calls.test.ts — no container, default-CI tier):
 *   - dropping a CONSUMED column surfaces the consuming view (exact set)
 *   - dropping a NON-consumed column of the SAME table excludes the view (negative, precision)
 *   - TABLE-pivot impact is UNCHANGED (object grain, regardless of attrs.dstColumns)
 *   - a DEGRADED engine (no attrs.dstColumns) keeps table-grain view impact (no false negative)
 *
 * Spec: graph-query "dropping a consumed column surfaces the consuming view (exact set)",
 * "dropping a non-consumed column of the same table excludes the view (negative, precision)",
 * "table pivot impact is unchanged", "degraded engine keeps table-grain view impact". D6.
 */

import { describe, it, expect } from 'vitest';
import { getImpact } from '../../../src/core/query/impact.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake store helpers (same pattern as impact-calls.test.ts / impact.test.ts)
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
  confidence: GraphEdge['confidence'],
  dstColumns?: readonly string[],
): GraphEdge {
  return {
    id,
    kind,
    src,
    dst,
    confidence,
    score: null,
    attrs: dstColumns !== undefined ? { dstColumns } : {},
  };
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
    getAllNodes: async () => nodes,
    getAllEdges: async () => [],
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
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
// Fixture A — a DECLARED (mssql-shaped) graph: v_order_summary depends_on order_items
// with attrs.dstColumns = ['order_id', 'product_id'] (region_id NOT consumed).
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_ITEMS = makeNode('n-order-items', 'table', 'dbo.order_items');
const PRODUCT_ID = makeNode('n-col-product-id', 'column', 'dbo.order_items.product_id');
const REGION_ID = makeNode('n-col-region-id', 'column', 'dbo.order_items.region_id');
const V_SUMMARY = makeNode('n-view-summary', 'view', 'dbo.v_order_summary');

const HC_PRODUCT = makeEdge('e-hc1', 'has_column', 'n-order-items', 'n-col-product-id', 'declared');
const HC_REGION = makeEdge('e-hc2', 'has_column', 'n-order-items', 'n-col-region-id', 'declared');
const DEP_SUMMARY = makeEdge(
  'e-dep1', 'depends_on', 'n-view-summary', 'n-order-items', 'declared', ['order_id', 'product_id'],
);

function buildDeclaredStore(): GraphStore {
  return makeFakeStore(
    [ORDER_ITEMS, PRODUCT_ID, REGION_ID, V_SUMMARY],
    {
      'n-col-product-id': [HC_PRODUCT],
      'n-col-region-id': [HC_REGION],
      'n-order-items': [DEP_SUMMARY],
      'n-view-summary': [],
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture B — a DEGRADED (mysql/sqlite-shaped) graph: a view depends_on order_items with
// NO attrs.dstColumns (object grain).
// ─────────────────────────────────────────────────────────────────────────────

const V_DEGRADED = makeNode('n-view-degraded', 'view', 'dbo.v_degraded');
const DEP_DEGRADED = makeEdge('e-dep2', 'depends_on', 'n-view-degraded', 'n-order-items', 'parsed'); // no dstColumns

function buildDegradedStore(): GraphStore {
  return makeFakeStore(
    [ORDER_ITEMS, PRODUCT_ID, REGION_ID, V_DEGRADED],
    {
      'n-col-product-id': [HC_PRODUCT],
      'n-col-region-id': [HC_REGION],
      'n-order-items': [DEP_DEGRADED],
      'n-view-degraded': [],
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getImpact — column-node pivot resolves to owning TABLE + first-hop filter (DOG-3 D6)', () => {
  it('dropping a CONSUMED column surfaces the consuming view (exact set, positive)', async () => {
    const store = buildDeclaredStore();
    const result = await getImpact(store, { nodeId: 'n-col-product-id' });

    const readViewIds = result.readImpact.flatMap((c) => c.nodes.slice(1));
    const readViews = await qnamesOf(store, readViewIds);
    expect(readViews).toStrictEqual(['dbo.v_order_summary']);

    // The chain reaches the view via the depends_on edge, resolved through the owning table.
    const chain = result.readImpact.find((c) => c.nodes.at(-1) === 'n-view-summary');
    expect(chain).toBeDefined();
    expect(chain!.nodes[0]).toBe('n-order-items'); // pivot resolved to the owning TABLE
    expect(chain!.edges).toStrictEqual(['depends_on']);
  });

  it('dropping a NON-consumed column of the SAME table excludes the view (negative, precision)', async () => {
    const store = buildDeclaredStore();
    const result = await getImpact(store, { nodeId: 'n-col-region-id' });

    const readViewIds = result.readImpact.flatMap((c) => c.nodes.slice(1));
    const readViews = await qnamesOf(store, readViewIds);
    expect(readViews).toStrictEqual([]); // v_order_summary is ABSENT — column-grain precision
    expect(readViews).not.toContain('dbo.v_order_summary');
  });

  it('TABLE pivot impact is UNCHANGED — the view is surfaced regardless of attrs.dstColumns', async () => {
    const store = buildDeclaredStore();
    const result = await getImpact(store, { nodeId: 'n-order-items' });

    const readViewIds = result.readImpact.flatMap((c) => c.nodes.slice(1));
    const readViews = await qnamesOf(store, readViewIds);
    expect(readViews).toStrictEqual(['dbo.v_order_summary']);
  });

  it('DEGRADED engine (no attrs.dstColumns) keeps table-grain view impact on EITHER column (no false negative)', async () => {
    const store = buildDegradedStore();

    const resultProduct = await getImpact(store, { nodeId: 'n-col-product-id' });
    const productViews = await qnamesOf(store, resultProduct.readImpact.flatMap((c) => c.nodes.slice(1)));
    expect(productViews).toStrictEqual(['dbo.v_degraded']);

    const resultRegion = await getImpact(store, { nodeId: 'n-col-region-id' });
    const regionViews = await qnamesOf(store, resultRegion.readImpact.flatMap((c) => c.nodes.slice(1)));
    expect(regionViews).toStrictEqual(['dbo.v_degraded']); // included on BOTH columns — degrade, no false negative
  });

  it('NEGATIVE: the excluded-column chain never appears in write-impact either', async () => {
    const store = buildDeclaredStore();
    const result = await getImpact(store, { nodeId: 'n-col-region-id' });
    expect(result.writeImpact).toStrictEqual([]);
  });

  it('output is byte-identical on re-run (ADR-008)', async () => {
    const store = buildDeclaredStore();
    const r1 = await getImpact(store, { nodeId: 'n-col-product-id' });
    const r2 = await getImpact(store, { nodeId: 'n-col-product-id' });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
