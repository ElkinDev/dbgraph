/**
 * DOG-3 Batch B — pg `information_schema.view_column_usage` sources the per-view SOURCE-COLUMN
 * set, merged onto the tokenizer-derived view deps (design D5/D4). Strict TDD RED:
 * `buildPgRawCatalog` does not yet read `PgRowInput.viewColumnUsage`, so a covered dep stays
 * `parsed` with NO `columns` until the merge lands.
 *
 * B.1 — the recorded rows shape: `groupViewColumnUsage` coerces flat `view_column_usage` rows
 * into a `(view, table) → columns` set; materialized views are STRUCTURALLY ABSENT from the
 * result (the catalog never returns matview rows — pinned as a negative).
 *
 * B.2 — the merge: for each COVERED (view, table) pair, the existing tokenizer `depends_on` dep
 * FLIPS `parsed`→`declared` and GAINS `columns`; UNCOVERED sources (materialized / owner-gap /
 * unresolved) KEEP `parsed` object grain with NO `columns` (degrade-by-absence, no marker);
 * NEVER fabricate a column from the body.
 *
 * B.3 — `PG_CAPABILITIES.supportsColumnLineage: true`, `supportsDependencyHints` STAYS `false`;
 * RECONCILER (a): a COVERED edge (declared, with dstColumns) COEXISTS with an UNCOVERED edge
 * (parsed, without) on the SAME pg engine — coverage read from the EDGE, never the capability flag.
 *
 * Spec: pg-extraction "Declared consumed-column set for regular views via view_column_usage" +
 * "Sources absent from view_column_usage stay parsed object grain" + "capability note corrected";
 * schema-extraction "An adapter with a view-column catalog populates columns". D5/D4.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPgRawCatalog, groupViewColumnUsage } from '../../../../src/adapters/engines/pg/map.js';
import type {
  PgRowInput,
  TableRow,
  ColumnRow,
  ColumnNameRow,
  ViewRow,
  ViewColumnUsageRow,
} from '../../../../src/adapters/engines/pg/map.js';
import { PG_CAPABILITIES } from '../../../../src/adapters/engines/pg/capabilities.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject, RawDependency } from '../../../../src/core/model/catalog.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '../../../fixtures/pg/rows');

const RECORDED_ROWS: readonly ViewColumnUsageRow[] = JSON.parse(
  readFileSync(resolve(fixturesDir, 'view-column-usage.json'), 'utf-8'),
) as ViewColumnUsageRow[];

const FULL_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, tables: 'full', views: 'full', functions: 'off', procedures: 'off', triggers: 'off', sequences: 'off' },
};

// ─────────────────────────────────────────────────────────────────────────────
// B.1 — recorded-rows shape: grouping + materialized-view structural absence
// ─────────────────────────────────────────────────────────────────────────────

describe('groupViewColumnUsage — recorded rows coerce to a (view, table) -> columns set (B.1)', () => {
  const groups = groupViewColumnUsage(RECORDED_ROWS);

  it('v_order_summary -> orders group is EXACTLY the three covered columns', () => {
    const byTarget = groups.get('reporting.v_order_summary');
    expect(byTarget).toBeDefined();
    const orders = byTarget!.get('app.orders');
    expect(orders).toBeDefined();
    expect([...orders!].sort()).toStrictEqual(['customer_id', 'order_id', 'status']);
  });

  it('v_order_summary -> order_items group is EXACTLY the three covered columns', () => {
    const byTarget = groups.get('reporting.v_order_summary');
    const items = byTarget!.get('app.order_items');
    expect(items).toBeDefined();
    expect([...items!].sort()).toStrictEqual(['item_id', 'order_id', 'total_price']);
  });

  it('mv_product_stats is STRUCTURALLY ABSENT from the grouped result (negative)', () => {
    expect(groups.has('reporting.mv_product_stats')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.2 — merge onto buildPgRawCatalog view deps (parsed -> declared flip + columns)
// ─────────────────────────────────────────────────────────────────────────────

const TABLES: readonly TableRow[] = [
  { schema_name: 'app', table_name: 'orders', table_oid: 1, comment: null },
  { schema_name: 'app', table_name: 'order_items', table_oid: 2, comment: null },
  { schema_name: 'app', table_name: 'products', table_oid: 3, comment: null },
];

function col(table: string, name: string, ordinal: number): ColumnRow {
  return {
    schema_name: 'app', table_name: table, ordinal, column_name: name,
    data_type: 'integer', is_nullable: false, default_expr: null,
    identity_kind: '', generated_kind: '', comment: null,
  };
}

const COLUMNS: readonly ColumnRow[] = [
  col('orders', 'order_id', 1), col('orders', 'customer_id', 2), col('orders', 'status', 3),
  col('order_items', 'item_id', 1), col('order_items', 'order_id', 2), col('order_items', 'total_price', 3),
  col('products', 'product_id', 1),
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
      'SELECT p.product_id, COUNT(oi.item_id) AS order_count FROM app.products p LEFT JOIN app.order_items oi ON oi.product_id = p.product_id GROUP BY p.product_id',
    comment: null,
  },
];

function input(overrides: Partial<PgRowInput> = {}): PgRowInput {
  return {
    schemas: [{ schema_name: 'app' }, { schema_name: 'reporting' }],
    tables: TABLES,
    columns: COLUMNS,
    columnNames: [] as readonly ColumnNameRow[],
    constraints: [],
    indexes: [],
    views: VIEWS,
    routines: [],
    triggers: [],
    sequences: [],
    ...overrides,
  };
}

function viewOf(objects: readonly RawObject[], name: string): RawObject {
  const v = objects.find((o) => o.kind === 'view' && o.name === name);
  expect(v, `view ${name}`).toBeDefined();
  return v!;
}

function depTo(view: RawObject, target: string): RawDependency | undefined {
  return (view.dependencies ?? []).find((d) => d.target.name === target);
}

describe('buildPgRawCatalog — view_column_usage merges onto tokenizer deps (B.2, D5)', () => {
  const catalog = buildPgRawCatalog(input({ viewColumnUsage: RECORDED_ROWS }), FULL_SCOPE);
  const summary = viewOf(catalog.objects, 'v_order_summary');
  const stats = viewOf(catalog.objects, 'mv_product_stats');

  it('covered v_order_summary -> orders dep FLIPS to declared and gains its exact columns', () => {
    const dep = depTo(summary, 'orders');
    expect(dep).toBeDefined();
    expect(dep!.confidence).toBe('declared');
    expect([...dep!.columns!].sort()).toStrictEqual(['customer_id', 'order_id', 'status']);
    expect(dep!.access).toBe('read');
  });

  it('covered v_order_summary -> order_items dep FLIPS to declared and gains its exact columns', () => {
    const dep = depTo(summary, 'order_items');
    expect(dep).toBeDefined();
    expect(dep!.confidence).toBe('declared');
    expect([...dep!.columns!].sort()).toStrictEqual(['item_id', 'order_id', 'total_price']);
  });

  it('columns the view does NOT read never appear (negative, exact-set)', () => {
    const orders = depTo(summary, 'orders')!;
    const items = depTo(summary, 'order_items')!;
    expect(orders.columns).not.toContain('product_id');
    expect(items.columns).not.toContain('product_id');
    expect(items.columns).not.toContain('qty');
  });

  it('mv_product_stats deps stay parsed object grain — NO flip, NO columns, NO fabrication (negative)', () => {
    const productsDep = depTo(stats, 'products');
    const itemsDep = depTo(stats, 'order_items');
    expect(productsDep).toBeDefined();
    expect(itemsDep).toBeDefined();
    expect(productsDep!.confidence).toBe('parsed');
    expect(itemsDep!.confidence).toBe('parsed');
    expect('columns' in productsDep!).toBe(false);
    expect('columns' in itemsDep!).toBe(false);
    expect(productsDep!.columns).toBeUndefined();
    expect(itemsDep!.columns).toBeUndefined();
  });

  it('RECONCILER (a): a covered edge (declared+columns) coexists with an uncovered edge (parsed, no columns) on the SAME pg engine', () => {
    // summary.orders is covered (declared+columns); stats.products is uncovered (parsed, no columns) — same catalog, same engine.
    const covered = depTo(summary, 'orders')!;
    const uncovered = depTo(stats, 'products')!;
    expect(covered.confidence).toBe('declared');
    expect(covered.columns).toBeDefined();
    expect(uncovered.confidence).toBe('parsed');
    expect(uncovered.columns).toBeUndefined();
  });
});

describe('buildPgRawCatalog — no viewColumnUsage input -> object grain, byte-identical to pre-DOG-3', () => {
  it('when viewColumnUsage is UNSET, every view dep stays parsed with NO columns', () => {
    const catalog = buildPgRawCatalog(input(), FULL_SCOPE); // viewColumnUsage omitted entirely
    const summary = viewOf(catalog.objects, 'v_order_summary');
    for (const dep of summary.dependencies ?? []) {
      expect('columns' in dep).toBe(false);
      expect(dep.confidence).toBe('parsed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.3 — capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('PG_CAPABILITIES — supportsColumnLineage (view_column_usage catalog, owner caveat)', () => {
  it('supportsColumnLineage is true', () => {
    expect(PG_CAPABILITIES.supportsColumnLineage).toBe(true);
  });

  it('supportsDependencyHints STAYS false (view_column_usage is a distinct view-scoped catalog, not a body dep-hint)', () => {
    expect(PG_CAPABILITIES.supportsDependencyHints).toBe(false);
  });
});
