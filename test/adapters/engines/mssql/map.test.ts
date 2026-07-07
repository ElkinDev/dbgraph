/**
 * Tests for the mssql map module.
 * Design §map.ts "rows → RawObject[]" per every sys.* family.
 * Pure unit tests — uses captured JSON row fixtures (no DB, no mocks).
 * US-027 (SQL Server extraction), US-007 (tokenizer wiring for deps).
 *
 * TDD RED → GREEN → REFACTOR
 * Fixtures under test/fixtures/mssql/rows/*.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMssqlRawCatalog } from '../../../../src/adapters/engines/mssql/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject } from '../../../../src/core/model/catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '../../../fixtures/mssql/rows');

// ─────────────────────────────────────────────────────────────────────────────
// Fixture loader helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf-8')) as T;
}

interface TableRow { schema_name: string; table_name: string; object_id: number }
interface ColumnRow { schema_name: string; table_name: string; column_id: number; column_name: string; data_type: string; max_length: number; precision: number; scale: number; is_nullable: boolean; is_computed: boolean; computed_definition: string | null; default_definition: string | null }
interface KeyConstraintRow { schema_name: string; table_name: string; constraint_name: string; constraint_type: string; column_name: string; key_ordinal: number }
interface FkRow { schema_name: string; table_name: string; constraint_name: string; fk_id: number; ref_schema_name: string; ref_table_name: string; local_column: string; ref_column: string; constraint_column_id: number }
interface CheckRow { schema_name: string; table_name: string; constraint_name: string; definition: string }
interface IndexRow { schema_name: string; table_name: string; index_name: string; is_unique: boolean; is_primary_key: boolean; is_unique_constraint: boolean; type_desc: string; filter_definition: string | null; column_name: string; key_ordinal: number; index_column_id: number; is_included_column: boolean }
interface ModuleRow { schema_name: string; object_name: string; object_type: string; object_id: number; definition: string | null }
interface TriggerEventRow { trigger_id: number; trigger_name: string; parent_object_id: number; is_instead_of_trigger: boolean; event_type: string }
interface SequenceRow { schema_name: string; sequence_name: string; data_type: string; start_value: string; increment: string; minimum_value: string; maximum_value: string; is_cycling: boolean }
interface ExtendedPropRow { schema_name: string; object_name: string; column_id: number; column_name: string | null; description: string }
interface DepRow { schema_name: string; object_name: string; object_type: string; ref_schema_name: string | null; ref_object_name: string | null; ref_object_id: number | null; ref_object_type: string | null }

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

const META_SCOPE: ExtractionScope = {
  levels: {
    ...FULL_SCOPE.levels,
    procedures: 'metadata',
    functions: 'metadata',
    triggers: 'metadata',
    views: 'metadata',
  },
};

const OFF_PROC_SCOPE: ExtractionScope = {
  levels: {
    ...FULL_SCOPE.levels,
    procedures: 'off',
    functions: 'off',
  },
};

// Build the shared fixture input
const fixtureInput = {
  tables: loadFixture<TableRow[]>('tables.json'),
  columns: loadFixture<ColumnRow[]>('columns.json'),
  keyConstraints: loadFixture<KeyConstraintRow[]>('key-constraints.json'),
  foreignKeys: loadFixture<FkRow[]>('foreign-keys.json'),
  checkConstraints: loadFixture<CheckRow[]>('check-constraints.json'),
  indexes: loadFixture<IndexRow[]>('indexes.json'),
  modules: loadFixture<ModuleRow[]>('modules.json'),
  triggerEvents: loadFixture<TriggerEventRow[]>('trigger-events.json'),
  sequences: loadFixture<SequenceRow[]>('sequences.json'),
  extendedProperties: loadFixture<ExtendedPropRow[]>('extended-properties.json'),
  dependencies: loadFixture<DepRow[]>('dependencies.json'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — tables', () => {
  it('extracts all user tables', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const tables = catalog.objects.filter((o) => o.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(4);
    const names = tables.map((t) => t.name);
    expect(names).toContain('orders');
    expect(names).toContain('order_items');
  });

  it('engine is mssql', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    expect(catalog.engine).toBe('mssql');
  });

  it('schemas list contains dbo', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    expect(catalog.schemas).toContain('dbo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — columns', () => {
  it('orders table has expected columns', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find(
      (o) => o.kind === 'table' && o.name === 'orders',
    );
    expect(orders).toBeDefined();
    const colNames = orders!.columns!.map((c) => c.name);
    expect(colNames).toContain('order_id');
    expect(colNames).toContain('customer_name');
    expect(colNames).toContain('created_at');
  });

  it('nullable column is correctly marked', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const customerName = orders.columns!.find((c) => c.name === 'customer_name')!;
    expect(customerName.nullable).toBe(true);
  });

  it('non-nullable column is correctly marked', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const orderId = orders.columns!.find((c) => c.name === 'order_id')!;
    expect(orderId.nullable).toBe(false);
  });

  it('default expression is captured', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const createdAt = orders.columns!.find((c) => c.name === 'created_at')!;
    expect(createdAt.default).toBe('(getdate())');
  });

  it('computed column is represented as computed in extra', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const items = catalog.objects.find(
      (o) => o.kind === 'table' && o.name === 'order_items',
    )!;
    const total = items.columns!.find((c) => c.name === 'total')!;
    // RawColumn is extended with extra via intersection in map.ts
    const totalWithExtra = total as unknown as { extra?: Record<string, unknown> };
    expect(totalWithExtra.extra).toBeDefined();
    expect(totalWithExtra.extra!['computed']).toBe(true);
  });

  it('columns are ordered by ordinal (column_id)', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const ordinals = orders.columns!.map((c) => c.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constraints (PK, FK, UNIQUE, CHECK)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — PK constraint', () => {
  it('orders has a PK constraint', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const pk = orders.constraints!.find((c) => c.type === 'PK');
    expect(pk).toBeDefined();
    expect(pk!.columns).toContain('order_id');
  });
});

describe('buildMssqlRawCatalog — UNIQUE constraint', () => {
  it('products has a UNIQUE constraint on sku', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products')!;
    const uq = products?.constraints?.find((c) => c.type === 'UNIQUE');
    expect(uq).toBeDefined();
    expect(uq!.columns).toContain('sku');
  });
});

describe('buildMssqlRawCatalog — FK constraint', () => {
  it('order_items has a simple FK to orders', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const items = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items')!;
    const fk = items.constraints!.find(
      (c) => c.type === 'FK' && c.name === 'FK_order_items_orders',
    );
    expect(fk).toBeDefined();
    expect(fk!.columns).toContain('order_id');
    expect(fk!.references!.table).toBe('orders');
  });

  it('composite FK is represented as ONE constraint with both column pairs', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const items = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items')!;
    const compositeFk = items.constraints!.find(
      (c) => c.type === 'FK' && c.name === 'FK_composite',
    );
    expect(compositeFk).toBeDefined();
    expect(compositeFk!.columns).toHaveLength(2);
    expect(compositeFk!.references!.columns).toHaveLength(2);
  });
});

describe('buildMssqlRawCatalog — CHECK constraint', () => {
  it('order_items has CHECK constraints with definition', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const items = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items')!;
    const checks = items.constraints!.filter((c) => c.type === 'CHECK');
    expect(checks.length).toBeGreaterThanOrEqual(2);
    const qtyCheck = checks.find((c) => c.name === 'CK_order_items_qty');
    expect(qtyCheck).toBeDefined();
    expect(qtyCheck!.definition).toBe('([qty]>(0))');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — indexes', () => {
  it('orders has a nonclustered index', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const idx = orders.indexes!.find((i) => i.name === 'IX_orders_customer');
    expect(idx).toBeDefined();
  });

  it('filtered index captures the WHERE predicate in extra', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const filtered = orders.indexes!.find((i) => i.name === 'IX_orders_filtered');
    expect(filtered).toBeDefined();
    // RawIndex is extended with extra via intersection in map.ts
    const filteredWithExtra = filtered as unknown as { extra?: Record<string, unknown> };
    expect(filteredWithExtra.extra?.['where']).toBe('([created_at] IS NOT NULL)');
  });

  it('included column is distinguished from key column via extra.includedColumns', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const filtered = orders.indexes!.find((i) => i.name === 'IX_orders_filtered');
    expect(filtered).toBeDefined();
    const filteredWithExtra = filtered as unknown as { extra?: Record<string, unknown> };
    const includedCols = filteredWithExtra.extra?.['includedColumns'] as string[] | undefined;
    expect(includedCols).toBeDefined();
    expect(includedCols).toContain('customer_name');
    // key columns array should NOT contain the included column
    expect(filtered!.columns).not.toContain('customer_name');
  });

  it('clustered index has type_desc in extra', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products')!;
    const clustered = products?.indexes?.find((i) => i.name === 'CX_products');
    expect(clustered).toBeDefined();
    const clusteredWithExtra = clustered as unknown as { extra?: Record<string, unknown> };
    expect(clusteredWithExtra.extra?.['typeDesc']).toBe('CLUSTERED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — views', () => {
  it('view is extracted at full scope with body', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const view = catalog.objects.find(
      (o) => o.kind === 'view' && o.name === 'v_active_orders',
    );
    expect(view).toBeDefined();
    expect(view!.body).toBeDefined();
    expect(view!.body).toContain('v_active_orders');
  });

  it('view at metadata scope has no body', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, META_SCOPE);
    const view = catalog.objects.find(
      (o) => o.kind === 'view' && o.name === 'v_active_orders',
    );
    expect(view).toBeDefined();
    expect(view!.body).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Procedures
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — procedures', () => {
  it('procedure is extracted at full scope', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const proc = catalog.objects.find(
      (o) => o.kind === 'procedure' && o.name === 'usp_process_order',
    );
    expect(proc).toBeDefined();
    expect(proc!.body).toBeDefined();
  });

  it('procedure at metadata scope has no body', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, META_SCOPE);
    const proc = catalog.objects.find(
      (o) => o.kind === 'procedure' && o.name === 'usp_process_order',
    );
    expect(proc).toBeDefined();
    expect(proc!.body).toBeUndefined();
  });

  it('procedure at off level is absent', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, OFF_PROC_SCOPE);
    const proc = catalog.objects.find(
      (o) => o.kind === 'procedure' && o.name === 'usp_process_order',
    );
    expect(proc).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Functions (scalar vs TVF distinguishable)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — functions', () => {
  it('scalar function (FN) and inline TVF (IF) are both present and distinguishable', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const scalarFn = catalog.objects.find(
      (o) => o.kind === 'function' && o.name === 'fn_total',
    );
    const tvf = catalog.objects.find(
      (o) => o.kind === 'function' && o.name === 'tvf_order_details',
    );
    expect(scalarFn).toBeDefined();
    expect(tvf).toBeDefined();
    // They are distinguishable via extra.functionType
    const scalarExtra = scalarFn!.extra as Record<string, unknown> | undefined;
    const tvfExtra = tvf!.extra as Record<string, unknown> | undefined;
    expect(scalarExtra?.['functionType']).toBe('FN');
    expect(tvfExtra?.['functionType']).toBe('IF');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Triggers
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — triggers', () => {
  it('trigger carries event and timing in trigger info', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const trigger = catalog.objects.find(
      (o) => o.kind === 'trigger' && o.name === 'tr_audit_orders',
    );
    expect(trigger).toBeDefined();
    expect(trigger!.trigger).toBeDefined();
    expect(trigger!.trigger!.events).toContain('UPDATE');
    expect(trigger!.trigger!.timing).toBe('AFTER');
  });

  // W-2 / C-1: RawTriggerInfo.table MUST be the PARENT TABLE, not the trigger itself.
  // Before the C-1 fix, map.ts:541 used mod.object_name (= trigger name) as table.name,
  // so this test goes RED until the fix lands (parent_object_id=1001 → orders).
  it('trigger.table resolves to the parent TABLE (orders), NOT the trigger name (W-2)', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const trigger = catalog.objects.find(
      (o) => o.kind === 'trigger' && o.name === 'tr_audit_orders',
    );
    expect(trigger).toBeDefined();
    expect(trigger!.trigger).toBeDefined();
    // MUST be the parent table (orders, object_id=1001), NOT the trigger itself
    expect(trigger!.trigger!.table.name).toBe('orders');
    expect(trigger!.trigger!.table.schema).toBe('dbo');
  });

  // W-2: no phantom stub node named after the trigger should appear in the catalog.
  // After the fix, the parent table is resolved and no trigger-named table is created.
  it('no phantom stub table named after the trigger exists in catalog objects', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const triggerNamedTable = catalog.objects.find(
      (o) => o.kind === 'table' && o.name === 'tr_audit_orders',
    );
    expect(triggerNamedTable).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequences
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — sequences', () => {
  it('sequences are extracted', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const seqs = catalog.objects.filter((o) => o.kind === 'sequence');
    expect(seqs.length).toBeGreaterThanOrEqual(2);
    const names = seqs.map((s) => s.name);
    expect(names).toContain('seq_order_id');
    expect(names).toContain('seq_batch_id');
  });

  it('sequence carries type info in extra', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const seq = catalog.objects.find(
      (o) => o.kind === 'sequence' && o.name === 'seq_order_id',
    );
    expect(seq).toBeDefined();
    const extra = seq!.extra as Record<string, unknown> | undefined;
    expect(extra?.['dataType']).toBe('int');
    expect(extra?.['startValue']).toBe('1');
    expect(extra?.['increment']).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Comments (MS_Description → .comment)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — MS_Description as comment', () => {
  it('table comment from MS_Description', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    expect(orders).toBeDefined();
    expect(orders!.comment).toBe('Stores customer orders');
  });

  it('column comment from MS_Description', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders')!;
    const orderIdCol = orders.columns!.find((c) => c.name === 'order_id');
    expect(orderIdCol).toBeDefined();
    expect(orderIdCol!.comment).toBe('Primary key for orders');
  });

  it('object without MS_Description has no comment', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const items = catalog.objects.find(
      (o) => o.kind === 'table' && o.name === 'order_items',
    );
    expect(items).toBeDefined();
    expect(items!.comment).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies (tokenizer wiring)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — dependency classification via tokenizer', () => {
  it('usp_process_order writes audit_log and orders, reads order_items', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const proc = catalog.objects.find(
      (o) => o.kind === 'procedure' && o.name === 'usp_process_order',
    );
    expect(proc).toBeDefined();
    const deps = proc!.dependencies!;
    const auditDep = deps.find((d) => d.target.name === 'audit_log');
    const ordersDep = deps.find((d) => d.target.name === 'orders');
    const itemsDep = deps.find((d) => d.target.name === 'order_items');
    expect(auditDep?.access).toBe('write');
    expect(ordersDep?.access).toBe('write');
    expect(itemsDep?.access).toBe('read');
  });

  it('dynamic proc sets hasDynamicSql: true', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const dynProc = catalog.objects.find(
      (o) => o.kind === 'procedure' && o.name === 'usp_dynamic',
    );
    expect(dynProc).toBeDefined();
    expect(dynProc!.hasDynamicSql).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMssqlRawCatalog — deterministic ordering', () => {
  it('objects are sorted by (kindRank, schema, name)', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const objects = catalog.objects as RawObject[];

    // Tables should come before views, views before procedures, etc.
    const tableIdx = objects.findIndex((o) => o.kind === 'table');
    const viewIdx = objects.findIndex((o) => o.kind === 'view');
    const procIdx = objects.findIndex((o) => o.kind === 'procedure');
    const seqIdx = objects.findIndex((o) => o.kind === 'sequence');

    expect(tableIdx).toBeLessThan(viewIdx);
    expect(viewIdx).toBeLessThan(procIdx);
    // sequences (rank 10) after procedures (rank 8) and functions (rank 9)
    expect(procIdx).toBeLessThan(seqIdx);
  });

  it('tables are alphabetically sorted within kind', () => {
    const catalog = buildMssqlRawCatalog(fixtureInput, FULL_SCOPE);
    const tables = catalog.objects.filter((o) => o.kind === 'table');
    const names = tables.map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
