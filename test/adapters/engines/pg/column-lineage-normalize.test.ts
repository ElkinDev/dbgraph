/**
 * DOG-3 B.4 — the pg map->normalize path flips covered view deps to `confidence:'declared'` and
 * stamps their sorted-unique `attrs.dstColumns` on the view->source-table `depends_on` edge
 * (design D1/D5/D4). SYNTHETIC in-memory `RawCatalog` (default CI, no container): a
 * torture-shaped `reporting.v_order_summary` reading `app.orders` + `app.order_items` via
 * recorded-shape `view_column_usage` rows, run through `buildPgRawCatalog` (map merge) then
 * `normalizeCatalog` (the A.2 sorted-unique stamp, reused byte-for-byte by pg).
 *
 * L-009 EXACT: the observable is EXACTLY the six source pairs; NEGATIVE `app.order_items.qty` /
 * `app.order_items.product_id` absent. `reporting.mv_product_stats` (materialized) -> edges to
 * `app.products`/`app.order_items` carry NO `dstColumns`, stay `parsed` (no flip, no
 * fabrication); a THIRD synthetic owner-gap view degrades identically (tokenizer dep exists,
 * but view_column_usage carries NO rows for that pair -> parsed object grain, no columns).
 *
 * Spec: pg-extraction "v_order_summary flips to declared and emits its EXACT consumed-column
 * set", "materialized view stays parsed object grain", "owner-visibility gap degrades
 * honestly". D5/D4.
 */

import { describe, it, expect } from 'vitest';
import { buildPgRawCatalog } from '../../../../src/adapters/engines/pg/map.js';
import type {
  PgRowInput,
  TableRow,
  ColumnRow,
  ViewRow,
  ViewColumnUsageRow,
} from '../../../../src/adapters/engines/pg/map.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { GraphEdge } from '../../../../src/core/model/edge.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';

const FULL_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, tables: 'full', views: 'full', functions: 'off', procedures: 'off', triggers: 'off', sequences: 'off' },
};

function col(table: string, name: string, ordinal: number): ColumnRow {
  return {
    schema_name: 'app', table_name: table, ordinal, column_name: name,
    data_type: 'integer', is_nullable: false, default_expr: null,
    identity_kind: '', generated_kind: '', comment: null,
  };
}

const TABLES: readonly TableRow[] = [
  { schema_name: 'app', table_name: 'orders', table_oid: 1, comment: null },
  { schema_name: 'app', table_name: 'order_items', table_oid: 2, comment: null },
  { schema_name: 'app', table_name: 'products', table_oid: 3, comment: null },
  { schema_name: 'app', table_name: 'external_events', table_oid: 4, comment: null }, // owner-gap source
];

const COLUMNS: readonly ColumnRow[] = [
  col('orders', 'order_id', 1), col('orders', 'customer_id', 2), col('orders', 'status', 3),
  col('order_items', 'item_id', 1), col('order_items', 'order_id', 2),
  col('order_items', 'product_id', 3), col('order_items', 'qty', 4), col('order_items', 'total_price', 5),
  col('products', 'product_id', 1), col('products', 'name', 2),
  col('external_events', 'event_id', 1),
];

const VIEWS: readonly ViewRow[] = [
  {
    schema_name: 'reporting', view_name: 'v_order_summary', rel_kind: 'v',
    view_def:
      'SELECT o.order_id, o.customer_id, o.status, COUNT(oi.item_id) AS item_count, SUM(oi.total_price) AS total_amount FROM app.orders o LEFT JOIN app.order_items oi ON oi.order_id = o.order_id GROUP BY o.order_id, o.customer_id, o.status',
    comment: null,
  },
  {
    schema_name: 'reporting', view_name: 'mv_product_stats', rel_kind: 'm',
    view_def:
      'SELECT p.product_id, p.name, COUNT(oi.item_id) AS order_count, SUM(oi.qty) AS total_qty FROM app.products p LEFT JOIN app.order_items oi ON oi.product_id = p.product_id GROUP BY p.product_id, p.name',
    comment: null,
  },
  {
    // Owner-visibility gap: the tokenizer parses a read dep to external_events (present in the
    // static body), but view_column_usage carries NO rows for this pair (owner does not own it).
    schema_name: 'reporting', view_name: 'v_owner_gap', rel_kind: 'v',
    view_def: 'SELECT e.event_id FROM app.external_events e',
    comment: null,
  },
];

// Recorded-shape view_column_usage rows: ONLY v_order_summary is covered (matches live catalog
// behavior — materialized views and owner-invisible sources are structurally absent).
const VIEW_COLUMN_USAGE: readonly ViewColumnUsageRow[] = [
  { view_schema: 'reporting', view_name: 'v_order_summary', table_schema: 'app', table_name: 'orders', column_name: 'customer_id' },
  { view_schema: 'reporting', view_name: 'v_order_summary', table_schema: 'app', table_name: 'orders', column_name: 'order_id' },
  { view_schema: 'reporting', view_name: 'v_order_summary', table_schema: 'app', table_name: 'orders', column_name: 'status' },
  { view_schema: 'reporting', view_name: 'v_order_summary', table_schema: 'app', table_name: 'order_items', column_name: 'item_id' },
  { view_schema: 'reporting', view_name: 'v_order_summary', table_schema: 'app', table_name: 'order_items', column_name: 'order_id' },
  { view_schema: 'reporting', view_name: 'v_order_summary', table_schema: 'app', table_name: 'order_items', column_name: 'total_price' },
];

const INPUT: PgRowInput = {
  schemas: [{ schema_name: 'app' }, { schema_name: 'reporting' }],
  tables: TABLES,
  columns: COLUMNS,
  columnNames: [],
  constraints: [],
  indexes: [],
  views: VIEWS,
  routines: [],
  triggers: [],
  sequences: [],
  viewColumnUsage: VIEW_COLUMN_USAGE,
};

function build(): NormalizationResult {
  return normalizeCatalog(buildPgRawCatalog(INPUT, FULL_SCOPE), FULL_SCOPE);
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

describe('pg column lineage — synthetic normalize (D1/D5/D4, Model A)', () => {
  const result = build();
  const edges = dependsOnEdges(result);

  it('v_order_summary->orders carries the EXACT sorted-unique set at declared', () => {
    const e = edges.find((x) => x.pair === 'reporting.v_order_summary→app.orders');
    expect(e).toBeDefined();
    expect(e!.edge.attrs.dstColumns).toStrictEqual(['customer_id', 'order_id', 'status']);
    expect(e!.edge.confidence).toBe('declared');
    expect(e!.dstKind).toBe('table');
  });

  it('v_order_summary->order_items carries the EXACT sorted-unique set at declared', () => {
    const e = edges.find((x) => x.pair === 'reporting.v_order_summary→app.order_items');
    expect(e).toBeDefined();
    expect(e!.edge.attrs.dstColumns).toStrictEqual(['item_id', 'order_id', 'total_price']);
    expect(e!.edge.confidence).toBe('declared');
  });

  it('the observable consumed set is EXACTLY the six source pairs', () => {
    const observable = edges
      .filter((e) => e.pair.startsWith('reporting.v_order_summary→'))
      .flatMap((e) => (e.edge.attrs.dstColumns ?? []).map((c) => `${e.pair.split('→')[1]}.${c}`))
      .sort();
    expect(observable).toStrictEqual([
      'app.order_items.item_id',
      'app.order_items.order_id',
      'app.order_items.total_price',
      'app.orders.customer_id',
      'app.orders.order_id',
      'app.orders.status',
    ]);
  });

  it('columns the view does NOT read never appear (negative, exact-set)', () => {
    const allCols = edges
      .filter((e) => e.pair.startsWith('reporting.v_order_summary→'))
      .flatMap((e) => e.edge.attrs.dstColumns ?? []);
    expect(allCols).not.toContain('qty');
    expect(allCols).not.toContain('product_id');
  });

  it('mv_product_stats edges carry NO dstColumns and stay parsed (materialized, no flip, no fabrication)', () => {
    const productsEdge = edges.find((x) => x.pair === 'reporting.mv_product_stats→app.products');
    const itemsEdge = edges.find((x) => x.pair === 'reporting.mv_product_stats→app.order_items');
    expect(productsEdge).toBeDefined();
    expect(itemsEdge).toBeDefined();
    expect(productsEdge!.edge.attrs.dstColumns).toBeUndefined();
    expect(itemsEdge!.edge.attrs.dstColumns).toBeUndefined();
    expect(productsEdge!.edge.confidence).toBe('parsed');
    expect(itemsEdge!.edge.confidence).toBe('parsed');
  });

  it('v_owner_gap degrades identically: parsed dep to external_events, NO dstColumns (owner-visibility gap)', () => {
    const e = edges.find((x) => x.pair === 'reporting.v_owner_gap→app.external_events');
    expect(e).toBeDefined();
    expect(e!.edge.confidence).toBe('parsed');
    expect(e!.edge.attrs.dstColumns).toBeUndefined();
    expect('dstColumns' in e!.edge.attrs).toBe(false);
  });

  it('every depends_on edge targets a TABLE node — NO per-column edge, NO column-node target (Model A)', () => {
    for (const e of edges) expect(e.dstKind).toBe('table');
  });
});
