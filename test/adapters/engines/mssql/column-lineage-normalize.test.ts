/**
 * DOG-3 A.4 — the mssql map→normalize path stamps a view's EXACT declared consumed-column set
 * as sorted-unique `attrs.dstColumns` on the view→source-table `depends_on` edge (design D1/D5/D8).
 * SYNTHETIC in-memory `RawCatalog` (default CI, no container): a torture-shaped `v_order_summary`
 * reading `dbo.orders` + `dbo.order_items` via the recorded-shape TVF rows, run through
 * `buildMssqlRawCatalog` (map enrichment) then `normalizeCatalog` (the A.2 sorted-unique stamp).
 *
 * L-009 EXACT: the observable is EXACTLY the six source pairs; NEGATIVES (`not.toContainEqual`) —
 * `order_items.region_id`, `order_items.qty`, `orders.quantity`, `orders.unit_price` absent from
 * ANY `dstColumns`; NO edge to `dbo.products`/`dbo.regions` carrying columns; a COMPUTED
 * `total_amount` consumed as ITSELF (not expanded to base columns); NO per-column edge, NO
 * column-node target.
 *
 * Spec: mssql-extraction "v_order_summary emits its EXACT declared consumed-column set",
 * "Columns the view does NOT read are absent (negative)", "A computed source column is consumed
 * as itself (honesty)"; graph-model "A view carries attrs.dstColumns for its exact consumed
 * columns". D1/D5.
 */

import { describe, it, expect } from 'vitest';
import { buildMssqlRawCatalog } from '../../../../src/adapters/engines/mssql/map.js';
import type {
  MssqlRowInput,
  TableRow,
  ColumnRow,
  ModuleRow,
  DepRow,
  ViewReferencedColumnRow,
} from '../../../../src/adapters/engines/mssql/map.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { GraphEdge } from '../../../../src/core/model/edge.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full',
    views: 'full', procedures: 'full', functions: 'full', triggers: 'full',
    sequences: 'full', collections: 'off', fields: 'off', statistics: 'off', sampling: 'off',
  },
};

function col(table: string, name: string, id: number): ColumnRow {
  return {
    schema_name: 'dbo', table_name: table, column_id: id, column_name: name,
    data_type: 'int', max_length: 4, precision: 10, scale: 0,
    is_nullable: false, is_computed: name === 'total_amount',
    computed_definition: name === 'total_amount' ? '([quantity]*[unit_price])' : null,
    default_definition: null,
  };
}

const TABLES: readonly TableRow[] = [
  { schema_name: 'dbo', table_name: 'orders', object_id: 1001 },
  { schema_name: 'dbo', table_name: 'order_items', object_id: 1002 },
  { schema_name: 'dbo', table_name: 'products', object_id: 1003 },
  { schema_name: 'dbo', table_name: 'regions', object_id: 1004 },
];

const COLUMNS: readonly ColumnRow[] = [
  col('orders', 'order_id', 1), col('orders', 'customer_id', 2), col('orders', 'status', 3),
  col('orders', 'quantity', 4), col('orders', 'unit_price', 5), col('orders', 'total_amount', 6),
  col('order_items', 'order_id', 1), col('order_items', 'product_id', 2),
  col('order_items', 'region_id', 3), col('order_items', 'qty', 4),
  col('products', 'product_id', 1), col('regions', 'region_id', 1),
];

const MODULES: readonly ModuleRow[] = [
  {
    schema_name: 'dbo', object_name: 'v_order_summary', object_type: 'V', object_id: 3001,
    definition:
      'CREATE VIEW dbo.v_order_summary AS SELECT o.order_id, o.customer_id, o.status, o.total_amount, COUNT(oi.product_id) FROM dbo.orders o LEFT JOIN dbo.order_items oi ON oi.order_id = o.order_id GROUP BY o.order_id, o.customer_id, o.status, o.total_amount',
  },
];

const DEPS: readonly DepRow[] = [
  { schema_name: 'dbo', object_name: 'v_order_summary', object_type: 'V', ref_schema_name: 'dbo', ref_object_name: 'orders', ref_object_id: 1001, ref_object_type: 'U ' },
  { schema_name: 'dbo', object_name: 'v_order_summary', object_type: 'V', ref_schema_name: 'dbo', ref_object_name: 'order_items', ref_object_id: 1002, ref_object_type: 'U ' },
];

const TVF_ROWS: readonly ViewReferencedColumnRow[] = [
  { referencing_schema: 'dbo', referencing_view: 'v_order_summary', referenced_schema: 'dbo', referenced_entity: 'order_items', referenced_column: 'order_id' },
  { referencing_schema: 'dbo', referencing_view: 'v_order_summary', referenced_schema: 'dbo', referenced_entity: 'order_items', referenced_column: 'product_id' },
  { referencing_schema: 'dbo', referencing_view: 'v_order_summary', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'customer_id' },
  { referencing_schema: 'dbo', referencing_view: 'v_order_summary', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'order_id' },
  { referencing_schema: 'dbo', referencing_view: 'v_order_summary', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'status' },
  { referencing_schema: 'dbo', referencing_view: 'v_order_summary', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'total_amount' },
];

const INPUT: MssqlRowInput = {
  tables: TABLES, columns: COLUMNS, keyConstraints: [], foreignKeys: [], checkConstraints: [],
  indexes: [], modules: MODULES, triggerEvents: [], sequences: [], extendedProperties: [],
  dependencies: DEPS, viewReferencedColumns: TVF_ROWS,
};

function build(): NormalizationResult {
  return normalizeCatalog(buildMssqlRawCatalog(INPUT, FULL_SCOPE), FULL_SCOPE);
}

function dependsOnEdges(result: NormalizationResult): { pair: string; edge: GraphEdge; dstKind: string }[] {
  const byId = new Map(result.graph.nodes.map((n) => [n.id, n]));
  return result.graph.edges
    .filter((e) => e.kind === 'depends_on')
    .map((e) => ({
      pair: `${byId.get(e.src)?.qname ?? e.src}→${byId.get(e.dst)?.qname ?? e.dst}`,
      edge: e,
      dstKind: byId.get(e.dst)?.kind ?? '?',
    }));
}

describe('mssql column lineage — synthetic normalize (D1/D5/D8, Model A)', () => {
  const result = build();
  const edges = dependsOnEdges(result);

  it('v_order_summary→orders carries the EXACT sorted-unique set at declared', () => {
    const e = edges.find((x) => x.pair === 'dbo.v_order_summary→dbo.orders');
    expect(e).toBeDefined();
    expect(e!.edge.attrs.dstColumns).toStrictEqual(['customer_id', 'order_id', 'status', 'total_amount']);
    expect(e!.edge.confidence).toBe('declared');
    expect(e!.dstKind).toBe('table');
  });

  it('v_order_summary→order_items carries the EXACT sorted-unique set at declared', () => {
    const e = edges.find((x) => x.pair === 'dbo.v_order_summary→dbo.order_items');
    expect(e).toBeDefined();
    expect(e!.edge.attrs.dstColumns).toStrictEqual(['order_id', 'product_id']);
    expect(e!.edge.confidence).toBe('declared');
  });

  it('the observable consumed set is EXACTLY the six source pairs', () => {
    const observable = edges
      .flatMap((e) => (e.edge.attrs.dstColumns ?? []).map((c) => `${e.pair.split('→')[1]}.${c}`))
      .sort();
    expect(observable).toStrictEqual([
      'dbo.order_items.order_id',
      'dbo.order_items.product_id',
      'dbo.orders.customer_id',
      'dbo.orders.order_id',
      'dbo.orders.status',
      'dbo.orders.total_amount',
    ]);
  });

  it('columns the view does NOT read never appear (negative, exact-set)', () => {
    const allCols = edges.flatMap((e) => e.edge.attrs.dstColumns ?? []);
    expect(allCols).not.toContain('region_id');
    expect(allCols).not.toContain('qty');
    expect(allCols).not.toContain('quantity');
    expect(allCols).not.toContain('unit_price');
  });

  it('a COMPUTED total_amount is consumed as itself, base columns never fabricated (honesty)', () => {
    const e = edges.find((x) => x.pair === 'dbo.v_order_summary→dbo.orders')!;
    expect(e.edge.attrs.dstColumns).toContain('total_amount');
    expect(e.edge.attrs.dstColumns).not.toContain('quantity');
    expect(e.edge.attrs.dstColumns).not.toContain('unit_price');
  });

  it('NO depends_on edge to products or regions is emitted (unreferenced tables)', () => {
    const pairs = edges.map((e) => e.pair).sort();
    expect(pairs).toStrictEqual([
      'dbo.v_order_summary→dbo.order_items',
      'dbo.v_order_summary→dbo.orders',
    ]);
  });

  it('every depends_on edge targets a TABLE node — NO per-column edge, NO column-node target (Model A)', () => {
    for (const e of edges) expect(e.dstKind).toBe('table');
    // exactly two edges total — one per source table, never one-per-column
    expect(edges).toHaveLength(2);
  });
});
