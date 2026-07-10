/**
 * DOG-3 A.2 — normalizer stamps the consumed source-column set as sorted-unique
 * `attrs.dstColumns` on the EXISTING view→source-table `depends_on` edge (Model A, design D1/D3).
 * Strict TDD RED: `buildDependencyEdges` does not yet read `RawDependency.columns`, so the
 * assertion `edge.attrs.dstColumns` is `undefined` until the centralized ADR-008 stamp lands.
 *
 * Determinism (ADR-008): `[...new Set(cols)].sort()` code-point ASCENDING, deduplicated,
 * centralized in the normalizer — so ANY adapter row order yields the SAME serialized edge.
 * ABSENT set → `attrs {}`, byte-identical to the pre-DOG-3 object-grain edge.
 * NO per-column `depends_on` edge, NO column-node target (Model A — ZERO new edges).
 *
 * Spec: graph-normalization "buildDependencyEdges stamps the consumed source-column set as
 * sorted-unique attrs.dstColumns" (all 3 scenarios); graph-model "Non-sourced dependency stays
 * byte-identical object grain".
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog, stableStringify } from '../../../src/core/normalize/normalize.js';
import type { RawObject, RawDependency, RawColumn } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../src/core/model/graph.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full',
    views: 'full', procedures: 'full', functions: 'full', triggers: 'full',
    sequences: 'full', collections: 'full', fields: 'full',
    statistics: 'off', sampling: 'off',
  },
};

function col(name: string, ordinal: number): RawColumn {
  return { name, dataType: 'int', nullable: false, ordinal };
}

function table(name: string, columns: readonly string[]): RawObject {
  return {
    kind: 'table',
    schema: 'dbo',
    name,
    columns: columns.map((c, i) => col(c, i + 1)),
    constraints: [],
    indexes: [],
  };
}

function viewDep(
  targetName: string,
  columns?: readonly string[],
): RawDependency {
  return {
    target: { schema: 'dbo', name: targetName },
    access: 'read',
    confidence: columns !== undefined ? 'declared' : 'parsed',
    ...(columns !== undefined ? { columns } : {}),
  };
}

function view(name: string, dependencies: readonly RawDependency[]): RawObject {
  return {
    kind: 'view',
    schema: 'dbo',
    name,
    body: `CREATE VIEW dbo.${name} AS SELECT 1`,
    dependencies,
  };
}

function build(objects: readonly RawObject[]): NormalizationResult {
  return normalizeCatalog({ engine: 'mssql', schemas: ['dbo'], objects }, FULL_SCOPE);
}

/** The depends_on edges of the graph, resolved to src→dst qname with their attrs. */
function dependsOnEdges(result: NormalizationResult): {
  pair: string;
  edge: GraphEdge;
  dstKind: string;
}[] {
  const byId = new Map(result.graph.nodes.map((n) => [n.id, n]));
  return result.graph.edges
    .filter((e) => e.kind === 'depends_on')
    .map((e) => ({
      pair: `${byId.get(e.src)?.qname ?? e.src}→${byId.get(e.dst)?.qname ?? e.dst}`,
      edge: e,
      dstKind: byId.get(e.dst)?.kind ?? '?',
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: a source-column set stamps sorted-unique dstColumns
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDependencyEdges — stamps sorted-unique attrs.dstColumns (Model A, D3)', () => {
  it('an unsorted, duplicated columns set becomes sorted-unique dstColumns on the depends_on edge', () => {
    const result = build([
      table('orders', ['order_id', 'customer_id', 'status', 'total_amount']),
      view('v_order_summary', [
        // unsorted, WITH a duplicate — exactly the graph-normalization S1 fixture
        viewDep('orders', ['status', 'order_id', 'order_id', 'customer_id']),
      ]),
    ]);

    const edges = dependsOnEdges(result);
    const toOrders = edges.find((e) => e.pair === 'dbo.v_order_summary→dbo.orders');
    expect(toOrders).toBeDefined();
    expect(toOrders!.edge.attrs.dstColumns).toEqual([
      'customer_id',
      'order_id',
      'status',
    ]);
    expect(toOrders!.edge.confidence).toBe('declared');
  });

  it('emits NO per-column depends_on edge and NO column-node target (Model A)', () => {
    const result = build([
      table('orders', ['order_id', 'customer_id', 'status', 'total_amount']),
      table('order_items', ['order_id', 'product_id', 'region_id', 'qty']),
      view('v_order_summary', [
        viewDep('orders', ['order_id', 'customer_id', 'status', 'total_amount']),
        viewDep('order_items', ['order_id', 'product_id']),
      ]),
    ]);

    const edges = dependsOnEdges(result);
    // EXACTLY two depends_on edges — one per source TABLE, never one-per-column.
    expect(edges.map((e) => e.pair).sort()).toEqual([
      'dbo.v_order_summary→dbo.order_items',
      'dbo.v_order_summary→dbo.orders',
    ]);
    // Every depends_on edge points at a TABLE node — never a column node.
    for (const e of edges) {
      expect(e.dstKind).toBe('table');
    }
    // Exact per-edge sets, negatives included: region_id / qty are NOT consumed.
    const toOrderItems = edges.find(
      (e) => e.pair === 'dbo.v_order_summary→dbo.order_items',
    );
    expect(toOrderItems!.edge.attrs.dstColumns).toEqual(['order_id', 'product_id']);
    expect(toOrderItems!.edge.attrs.dstColumns).not.toContain('region_id');
    expect(toOrderItems!.edge.attrs.dstColumns).not.toContain('qty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: ordering is deterministic regardless of adapter row order (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDependencyEdges — determinism centralized in the normalizer (ADR-008)', () => {
  it('two DIFFERENT adapter row orders of the same set produce byte-identical dstColumns', () => {
    const orderA = build([
      table('orders', ['order_id', 'customer_id', 'status', 'total_amount']),
      view('v_order_summary', [
        viewDep('orders', ['total_amount', 'status', 'customer_id', 'order_id']),
      ]),
    ]);
    const orderB = build([
      table('orders', ['order_id', 'customer_id', 'status', 'total_amount']),
      view('v_order_summary', [
        viewDep('orders', ['order_id', 'status', 'total_amount', 'customer_id']),
      ]),
    ]);

    const a = dependsOnEdges(orderA).find(
      (e) => e.pair === 'dbo.v_order_summary→dbo.orders',
    )!;
    const b = dependsOnEdges(orderB).find(
      (e) => e.pair === 'dbo.v_order_summary→dbo.orders',
    )!;
    expect(a.edge.attrs.dstColumns).toEqual([
      'customer_id',
      'order_id',
      'status',
      'total_amount',
    ]);
    expect(stableStringify(a.edge)).toBe(stableStringify(b.edge));
  });

  it('normalizing the SAME catalog twice serializes byte-identically', () => {
    const objects = [
      table('orders', ['order_id', 'customer_id', 'status', 'total_amount']),
      view('v_order_summary', [
        viewDep('orders', ['status', 'order_id', 'customer_id', 'total_amount']),
      ]),
    ];
    expect(stableStringify(build(objects).graph)).toBe(
      stableStringify(build(objects).graph),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: no source-column set → byte-identical object grain (attrs {})
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDependencyEdges — a dependency with no columns stays object grain', () => {
  it('a view dependency with UNSET columns leaves attrs.dstColumns absent (attrs {})', () => {
    const result = build([
      table('orders', ['order_id', 'customer_id']),
      view('v_plain', [viewDep('orders')]), // no columns
    ]);
    const edge = dependsOnEdges(result).find(
      (e) => e.pair === 'dbo.v_plain→dbo.orders',
    )!;
    expect('dstColumns' in edge.edge.attrs).toBe(false);
    expect(edge.edge.attrs.dstColumns).toBeUndefined();
    expect(edge.edge.confidence).toBe('parsed');
  });

  it('the no-columns depends_on edge is byte-identical to a hand-built pre-DOG-3 edge attrs', () => {
    const result = build([
      table('orders', ['order_id']),
      view('v_plain', [viewDep('orders')]),
    ]);
    const edge = dependsOnEdges(result).find(
      (e) => e.pair === 'dbo.v_plain→dbo.orders',
    )!;
    // The pre-DOG-3 object-grain edge carried an empty attrs object.
    expect(stableStringify(edge.edge.attrs)).toBe(stableStringify({}));
  });
});
