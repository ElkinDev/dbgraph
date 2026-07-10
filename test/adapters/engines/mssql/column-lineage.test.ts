/**
 * DOG-3 A.3 — mssql map.ts GROUPS the per-view `sys.dm_sql_referenced_entities` TVF rows
 * onto `RawDependency.columns` and flips the covered view→table `depends_on` dep to
 * `confidence: 'declared'` (design D5/D8). Strict TDD RED: `buildMssqlRawCatalog` does not yet
 * read `MssqlRowInput.viewReferencedColumns`, so a covered dep carries NO `columns` until the
 * grouping lands.
 *
 * L-009 EXACT sets: the positive consumed-column set PLUS explicit negatives — a column the
 * view does NOT read is absent; an unbindable view (its TVF call raised → SKIPPED by extract →
 * NO rows in the collected array) keeps object grain; a whole-object `SELECT *` reference (no
 * column-level row) contributes NO column; a NULL/unresolved referenced entity is skipped.
 *
 * The TVF rows are the RECORDED offline fixture `rows/view-referenced-columns.json` (A.5).
 * The surrounding catalog (tables/modules/deps) is built inline because the shared
 * `modules.json` fixture carries `v_active_orders` with no view deps.
 *
 * Spec: mssql-extraction "Declared consumed-column set stamped on view depends_on via
 * dm_sql_referenced_entities (native path)" + "An unbindable view is skipped and extraction
 * completes" + "Extraction via sqlcmd or manual dump yields object grain"; schema-extraction
 * "An adapter with a view-column catalog populates columns". D5/D8.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMssqlRawCatalog } from '../../../../src/adapters/engines/mssql/map.js';
import type {
  MssqlRowInput,
  TableRow,
  ColumnRow,
  ModuleRow,
  DepRow,
  ViewReferencedColumnRow,
} from '../../../../src/adapters/engines/mssql/map.js';
import { MSSQL_CAPABILITIES } from '../../../../src/adapters/engines/mssql/capabilities.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject, RawDependency } from '../../../../src/core/model/catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '../../../fixtures/mssql/rows');

const RECORDED_TVF_ROWS: readonly ViewReferencedColumnRow[] = JSON.parse(
  readFileSync(resolve(fixturesDir, 'view-referenced-columns.json'), 'utf-8'),
) as ViewReferencedColumnRow[];

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full',
    views: 'full', procedures: 'full', functions: 'full', triggers: 'full',
    sequences: 'full', collections: 'off', fields: 'off', statistics: 'off', sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Minimal row builders — a controlled torture-shaped catalog
// ─────────────────────────────────────────────────────────────────────────────

let nextObjectId = 1000;

function tableRow(name: string): TableRow {
  return { schema_name: 'dbo', table_name: name, object_id: nextObjectId++ };
}

function colRow(table: string, name: string, id: number): ColumnRow {
  return {
    schema_name: 'dbo', table_name: table, column_id: id, column_name: name,
    data_type: 'int', max_length: 4, precision: 10, scale: 0,
    is_nullable: false, is_computed: false, computed_definition: null, default_definition: null,
  };
}

function viewModule(name: string, objectId: number): ModuleRow {
  return {
    schema_name: 'dbo', object_name: name, object_type: 'V', object_id: objectId,
    definition: `CREATE VIEW dbo.${name} AS SELECT 1`,
  };
}

function readDep(view: string, target: string): DepRow {
  return {
    schema_name: 'dbo', object_name: view, object_type: 'V',
    ref_schema_name: 'dbo', ref_object_name: target, ref_object_id: 1, ref_object_type: 'U ',
  };
}

/** Assembles a full MssqlRowInput from the pieces a view-lineage test needs. */
function input(overrides: {
  tables: readonly TableRow[];
  columns: readonly ColumnRow[];
  modules: readonly ModuleRow[];
  dependencies: readonly DepRow[];
  viewReferencedColumns?: readonly ViewReferencedColumnRow[];
}): MssqlRowInput {
  return {
    tables: overrides.tables,
    columns: overrides.columns,
    keyConstraints: [],
    foreignKeys: [],
    checkConstraints: [],
    indexes: [],
    modules: overrides.modules,
    triggerEvents: [],
    sequences: [],
    extendedProperties: [],
    dependencies: overrides.dependencies,
    ...(overrides.viewReferencedColumns !== undefined
      ? { viewReferencedColumns: overrides.viewReferencedColumns }
      : {}),
  };
}

const ORDERS_COLS: readonly ColumnRow[] = [
  colRow('orders', 'order_id', 1),
  colRow('orders', 'customer_id', 2),
  colRow('orders', 'status', 3),
  colRow('orders', 'quantity', 4),
  colRow('orders', 'unit_price', 5),
  colRow('orders', 'total_amount', 6),
];
const ORDER_ITEMS_COLS: readonly ColumnRow[] = [
  colRow('order_items', 'order_id', 1),
  colRow('order_items', 'product_id', 2),
  colRow('order_items', 'region_id', 3),
  colRow('order_items', 'qty', 4),
];

function viewOf(catalog: ReturnType<typeof buildMssqlRawCatalog>, name: string): RawObject {
  const v = catalog.objects.find((o) => o.kind === 'view' && o.name === name);
  expect(v, `view ${name}`).toBeDefined();
  return v!;
}

function depTo(view: RawObject, target: string): RawDependency | undefined {
  return (view.dependencies ?? []).find((d) => d.target.name === target);
}

// ─────────────────────────────────────────────────────────────────────────────
// Positive — the recorded TVF rows group onto RawDependency.columns (declared)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — view-referenced columns group onto RawDependency.columns (D5/D8)', () => {
  const orders = tableRow('orders');
  const orderItems = tableRow('order_items');
  const catalog = buildMssqlRawCatalog(
    input({
      tables: [orders, orderItems],
      columns: [...ORDERS_COLS, ...ORDER_ITEMS_COLS],
      modules: [viewModule('v_order_summary', 3001)],
      dependencies: [readDep('v_order_summary', 'orders'), readDep('v_order_summary', 'order_items')],
      viewReferencedColumns: RECORDED_TVF_ROWS,
    }),
    FULL_SCOPE,
  );
  const view = viewOf(catalog, 'v_order_summary');

  it('the orders dep gains its EXACT consumed-column set at confidence declared', () => {
    const dep = depTo(view, 'orders');
    expect(dep).toBeDefined();
    expect(dep!.columns).toStrictEqual(['customer_id', 'order_id', 'status', 'total_amount']);
    expect(dep!.confidence).toBe('declared');
    expect(dep!.access).toBe('read');
  });

  it('the order_items dep gains its EXACT consumed-column set at confidence declared', () => {
    const dep = depTo(view, 'order_items');
    expect(dep).toBeDefined();
    expect(dep!.columns).toStrictEqual(['order_id', 'product_id']);
    expect(dep!.confidence).toBe('declared');
  });

  it('columns the view does NOT read are absent (negative, exact-set)', () => {
    const orders = depTo(view, 'orders')!;
    const items = depTo(view, 'order_items')!;
    expect(orders.columns).not.toContain('quantity');
    expect(orders.columns).not.toContain('unit_price');
    expect(items.columns).not.toContain('region_id');
    expect(items.columns).not.toContain('qty');
  });

  it('a COMPUTED source column is consumed as itself, never expanded to its base columns (honesty)', () => {
    const orders = depTo(view, 'orders')!;
    expect(orders.columns).toContain('total_amount');
    // total_amount = (quantity * unit_price) — the base columns MUST NOT be fabricated
    expect(orders.columns).not.toContain('quantity');
    expect(orders.columns).not.toContain('unit_price');
  });

  it('NO edge to an unreferenced table (products/regions) is fabricated', () => {
    const deps = (view.dependencies ?? []).map((d) => d.target.name).sort();
    expect(deps).toStrictEqual(['order_items', 'orders']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unbindable-view skip — a view absent from the collected array keeps object grain
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — unbindable view skipped keeps object grain (D8, degrade-by-absence)', () => {
  it('the covered view is exact while the skipped view stays object grain', () => {
    const orders = tableRow('orders');
    const orderItems = tableRow('order_items');
    // v_broken has a dep to orders but NO rows in the collected array (extract skipped it).
    const catalog = buildMssqlRawCatalog(
      input({
        tables: [orders, orderItems],
        columns: [...ORDERS_COLS, ...ORDER_ITEMS_COLS],
        modules: [viewModule('v_order_summary', 3001), viewModule('v_broken', 3002)],
        dependencies: [
          readDep('v_order_summary', 'orders'),
          readDep('v_order_summary', 'order_items'),
          readDep('v_broken', 'orders'),
        ],
        viewReferencedColumns: RECORDED_TVF_ROWS, // only v_order_summary rows
      }),
      FULL_SCOPE,
    );

    const summary = viewOf(catalog, 'v_order_summary');
    expect(depTo(summary, 'orders')!.columns).toStrictEqual([
      'customer_id', 'order_id', 'status', 'total_amount',
    ]);

    const broken = viewOf(catalog, 'v_broken');
    const brokenDep = depTo(broken, 'orders')!;
    expect('columns' in brokenDep).toBe(false);
    expect(brokenDep.columns).toBeUndefined();
    expect(brokenDep.confidence).toBe('parsed'); // object grain, unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whole-object (SELECT *) and NULL/unresolved negatives
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — whole-object and NULL references contribute NO column', () => {
  it('a target with NO column-level row (whole-object SELECT *) stays object grain', () => {
    const orders = tableRow('orders');
    const products = tableRow('products');
    // v_mixed reads orders columns AND references products whole-object (no column rows).
    const rows: ViewReferencedColumnRow[] = [
      { referencing_schema: 'dbo', referencing_view: 'v_mixed', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'order_id' },
      { referencing_schema: 'dbo', referencing_view: 'v_mixed', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'status' },
    ];
    const catalog = buildMssqlRawCatalog(
      input({
        tables: [orders, products],
        columns: [...ORDERS_COLS, colRow('products', 'product_id', 1)],
        modules: [viewModule('v_mixed', 3003)],
        dependencies: [readDep('v_mixed', 'orders'), readDep('v_mixed', 'products')],
        viewReferencedColumns: rows,
      }),
      FULL_SCOPE,
    );
    const view = viewOf(catalog, 'v_mixed');
    expect(depTo(view, 'orders')!.columns).toStrictEqual(['order_id', 'status']);
    expect(depTo(view, 'orders')!.confidence).toBe('declared');
    // products referenced whole-object → NO columns, object grain
    const products_dep = depTo(view, 'products')!;
    expect('columns' in products_dep).toBe(false);
    expect(products_dep.confidence).toBe('parsed');
  });

  it('a NULL/unresolved referenced entity is skipped, never a speculative column', () => {
    const orders = tableRow('orders');
    const rows = [
      { referencing_schema: 'dbo', referencing_view: 'v_null', referenced_schema: 'dbo', referenced_entity: 'orders', referenced_column: 'order_id' },
      // unresolved: null entity + null column — MUST be ignored, no crash
      { referencing_schema: 'dbo', referencing_view: 'v_null', referenced_schema: null, referenced_entity: null, referenced_column: null },
    ] as unknown as readonly ViewReferencedColumnRow[];
    const catalog = buildMssqlRawCatalog(
      input({
        tables: [orders],
        columns: [...ORDERS_COLS],
        modules: [viewModule('v_null', 3004)],
        dependencies: [readDep('v_null', 'orders')],
        viewReferencedColumns: rows,
      }),
      FULL_SCOPE,
    );
    const view = viewOf(catalog, 'v_null');
    expect(depTo(view, 'orders')!.columns).toStrictEqual(['order_id']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Absence of the collected array → byte-identical object grain (dump/sqlcmd path)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — no viewReferencedColumns input → object grain (strategy coverage difference, D8)', () => {
  it('when viewReferencedColumns is UNSET, view deps stay parsed with NO columns (dump/sqlcmd path)', () => {
    const orders = tableRow('orders');
    const orderItems = tableRow('order_items');
    const catalog = buildMssqlRawCatalog(
      input({
        tables: [orders, orderItems],
        columns: [...ORDERS_COLS, ...ORDER_ITEMS_COLS],
        modules: [viewModule('v_order_summary', 3001)],
        dependencies: [readDep('v_order_summary', 'orders'), readDep('v_order_summary', 'order_items')],
        // viewReferencedColumns intentionally omitted (dump/sqlcmd carries no view-columns family)
      }),
      FULL_SCOPE,
    );
    const view = viewOf(catalog, 'v_order_summary');
    for (const dep of view.dependencies ?? []) {
      expect('columns' in dep).toBe(false);
      expect(dep.confidence).toBe('parsed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capability — mssql exposes a view-column catalog (native path)
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — supportsColumnLineage (native-driver view-column catalog)', () => {
  it('supportsColumnLineage is true (sys.dm_sql_referenced_entities on the native driver)', () => {
    expect(MSSQL_CAPABILITIES.supportsColumnLineage).toBe(true);
  });
});
