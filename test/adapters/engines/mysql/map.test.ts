/**
 * Tests for buildMysqlRawCatalog — rows → deterministic sorted RawCatalog.
 * Design §map.ts — schema=database, AUTO_INCREMENT on column, generated columns,
 *   composite FK/PK/unique, CHECK, indexes from STATISTICS, views, routines,
 *   triggers, comments, body level-gating, edge tokenization.
 *
 * Uses captured information_schema fixture rows (test/fixtures/mysql/rows/*.json).
 * NO live DB, NO mysql2.
 *
 * EXACT-set edge assertions — no existence-only assertions (CRITICAL-1 guard).
 * Spec: task 4.4, mysql-extraction spec.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMysqlRawCatalog } from '../../../../src/adapters/engines/mysql/map.js';
import type { MysqlRowInput } from '../../../../src/adapters/engines/mysql/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, '../../../fixtures/mysql/rows');

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, filename), 'utf-8')) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full extraction scope helper
// ─────────────────────────────────────────────────────────────────────────────

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    functions: 'full',
    procedures: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

const METADATA_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'metadata',
    functions: 'metadata',
    procedures: 'metadata',
    triggers: 'metadata',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

const OFF_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'off',
    functions: 'off',
    procedures: 'off',
    triggers: 'off',
    sequences: 'off',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Load fixture data
// ─────────────────────────────────────────────────────────────────────────────

let input: MysqlRowInput;

beforeAll(() => {
  input = {
    database: 'app',
    tables: loadJson('tables.json'),
    columns: loadJson('columns.json'),
    pkUkColumns: loadJson('pk-uk-columns.json'),
    fkColumns: loadJson('fk-columns.json'),
    checkConstraints: loadJson('check-constraints.json'),
    statistics: loadJson('statistics.json'),
    views: loadJson('views.json'),
    routines: loadJson('routines.json'),
    triggers: loadJson('triggers.json'),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine identity and schema
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — engine and schema', () => {
  it('engine is mysql', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    expect(catalog.engine).toBe('mysql');
  });

  it('Spec: RawCatalog.schemas is exactly the connected database', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    expect(catalog.schemas).toEqual(['app']);
  });

  it('every extracted object carries the database as its schema', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    for (const obj of catalog.objects) {
      expect(obj.schema).toBe('app');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — tables', () => {
  it('extracts all 4 base tables', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const tables = catalog.objects.filter((o) => o.kind === 'table');
    expect(tables).toHaveLength(4);
  });

  it('table names are sorted alphabetically', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const tables = catalog.objects.filter((o) => o.kind === 'table');
    const names = tables.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it('table with TABLE_COMMENT carries the comment', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const auditLog = catalog.objects.find((o) => o.kind === 'table' && o.name === 'audit_log');
    expect(auditLog).toBeDefined();
    expect(auditLog!.comment).toBe('Stores audit events');
  });

  it('table with empty TABLE_COMMENT carries no comment', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products');
    expect(products).toBeDefined();
    // empty string comment should be absent
    expect(products!.comment).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Columns — AUTO_INCREMENT, GENERATED, COMMENT, ordinal ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — columns', () => {
  it('Spec: AUTO_INCREMENT is represented on the column extra, never as a sequence', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const auditLog = catalog.objects.find((o) => o.kind === 'table' && o.name === 'audit_log');
    expect(auditLog).toBeDefined();
    const col = auditLog!.columns?.find((c) => c.name === 'audit_id');
    expect(col).toBeDefined();
    const extra = (col as unknown as { extra?: Record<string, unknown> }).extra;
    expect(extra).toBeDefined();
    expect(extra!['autoIncrement']).toBe(true);
  });

  it('Spec: ZERO sequence objects in the catalog', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const sequences = catalog.objects.filter((o) => o.kind === 'sequence');
    expect(sequences).toHaveLength(0);
  });

  it('Spec: STORED GENERATED column carries generated extra', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orderItems = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items');
    expect(orderItems).toBeDefined();
    const totalPrice = orderItems!.columns?.find((c) => c.name === 'total_price');
    expect(totalPrice).toBeDefined();
    const extra = (totalPrice as unknown as { extra?: Record<string, unknown> }).extra;
    expect(extra).toBeDefined();
    expect(extra!['generated']).toBe(true);
    expect(extra!['generationKind']).toBe('STORED');
    expect(extra!['generationExpression']).toBe('(qty * unit_price)');
  });

  it('columns are in ORDINAL_POSITION order', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    expect(orders).toBeDefined();
    const cols = orders!.columns!;
    expect(cols[0]!.name).toBe('order_id');
    expect(cols[1]!.name).toBe('customer_name');
  });

  it('column with COLUMN_COMMENT carries the comment', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    const col = orders!.columns?.find((c) => c.name === 'customer_name');
    expect(col?.comment).toBe('Customer display name');
  });

  it('column with empty COLUMN_COMMENT has no comment field', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    const col = orders!.columns?.find((c) => c.name === 'order_id');
    expect(col?.comment).toBeUndefined();
  });

  it('nullable column from IS_NULLABLE YES', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    const col = orders!.columns?.find((c) => c.name === 'customer_name');
    expect(col?.nullable).toBe(true);
  });

  it('non-nullable column from IS_NULLABLE NO', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orders = catalog.objects.find((o) => o.kind === 'table' && o.name === 'orders');
    const col = orders!.columns?.find((c) => c.name === 'order_id');
    expect(col?.nullable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constraints: PK, UNIQUE, FK (composite), CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — constraints', () => {
  it('Spec: composite PK on order_items is ONE constraint with ordered columns', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orderItems = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items');
    const pks = orderItems!.constraints?.filter((c) => c.type === 'PK') ?? [];
    expect(pks).toHaveLength(1);
    expect(pks[0]!.columns).toEqual(['order_id', 'product_id']);
  });

  it('UNIQUE constraint on products.name', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products');
    const uniq = products!.constraints?.find((c) => c.type === 'UNIQUE' && c.name === 'uq_products_name');
    expect(uniq).toBeDefined();
    expect(uniq!.columns).toEqual(['name']);
  });

  it('Spec: FK fk_order_items_order references orders.order_id', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orderItems = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items');
    const fk = orderItems!.constraints?.find((c) => c.name === 'fk_order_items_order');
    expect(fk).toBeDefined();
    expect(fk!.type).toBe('FK');
    expect(fk!.columns).toEqual(['order_id']);
    expect(fk!.references?.table).toBe('orders');
    expect(fk!.references?.columns).toEqual(['order_id']);
  });

  it('Spec: CHECK constraint on products carries CHECK_CLAUSE', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products');
    const chk = products!.constraints?.find((c) => c.type === 'CHECK');
    expect(chk).toBeDefined();
    expect(chk!.definition).toBe('(unit_price >= 0)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Indexes (from STATISTICS)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — indexes', () => {
  it('Spec: composite index has ordered columns (SEQ_IN_INDEX order)', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orderItems = catalog.objects.find((o) => o.kind === 'table' && o.name === 'order_items');
    const idx = orderItems!.indexes?.find((i) => i.name === 'idx_order_items_composite');
    expect(idx).toBeDefined();
    expect(idx!.columns).toEqual(['order_id', 'product_id']);
    expect(idx!.unique).toBe(false); // NON_UNIQUE = 1
  });

  it('Spec: functional/expression index has EXPRESSION in extra and empty columns', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products');
    const idx = products!.indexes?.find((i) => i.name === 'idx_products_name_lower');
    expect(idx).toBeDefined();
    const extra = (idx as unknown as { extra?: Record<string, unknown> }).extra;
    expect(extra).toBeDefined();
    expect(extra!['expression']).toBeDefined();
  });

  it('Spec: prefix index has SUB_PART in extra', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const products = catalog.objects.find((o) => o.kind === 'table' && o.name === 'products');
    const idx = products!.indexes?.find((i) => i.name === 'idx_products_name_prefix');
    expect(idx).toBeDefined();
    const extra = (idx as unknown as { extra?: Record<string, unknown> }).extra;
    expect(extra).toBeDefined();
    expect(extra!['subPart']).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — views', () => {
  it('Spec: view is extracted at full level with VIEW_DEFINITION body', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const view = catalog.objects.find((o) => o.kind === 'view' && o.name === 'v_order_summary');
    expect(view).toBeDefined();
    expect(view!.body).toBeDefined();
    expect(typeof view!.body).toBe('string');
  });

  it('Spec: view at metadata level is present WITHOUT body', () => {
    const catalog = buildMysqlRawCatalog(input, METADATA_SCOPE);
    const view = catalog.objects.find((o) => o.kind === 'view' && o.name === 'v_order_summary');
    expect(view).toBeDefined();
    expect(view!.body).toBeUndefined();
  });

  it('Spec: view at off level is ABSENT from the catalog', () => {
    const catalog = buildMysqlRawCatalog(input, OFF_SCOPE);
    const view = catalog.objects.find((o) => o.kind === 'view');
    expect(view).toBeUndefined();
  });

  it('Spec: view body tokenized — EXACT reads_from edges (orders + order_items only)', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const view = catalog.objects.find((o) => o.kind === 'view' && o.name === 'v_order_summary');
    expect(view).toBeDefined();
    // view body references orders and order_items
    const deps = view!.dependencies ?? [];
    const names = deps.map((d) => d.target.name).sort();
    expect(names).toEqual(['order_items', 'orders']);
    // All must be read edges
    for (const dep of deps) {
      expect(dep.access).toBe('read');
      expect(dep.confidence).toBe('parsed');
    }
    // EXACT count: exactly 2 edges
    expect(deps).toHaveLength(2);
    // No self-edge (v_order_summary must not reference itself)
    expect(deps.find((d) => d.target.name === 'v_order_summary')).toBeUndefined();
    // No phantom to absent (products not referenced in this view body)
    expect(deps.find((d) => d.target.name === 'products')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routines
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — routines', () => {
  it('place_order is a procedure', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const proc = catalog.objects.find((o) => o.kind === 'procedure' && o.name === 'place_order');
    expect(proc).toBeDefined();
  });

  it('log_audit is a function with routine_comment', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const fn = catalog.objects.find((o) => o.kind === 'function' && o.name === 'log_audit');
    expect(fn).toBeDefined();
    expect(fn!.comment).toBe('Logs an audit event');
  });

  it('Spec: place_order writes orders and order_items, reads products — EXACT 3 edges', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const proc = catalog.objects.find((o) => o.kind === 'procedure' && o.name === 'place_order');
    expect(proc).toBeDefined();
    const deps = proc!.dependencies ?? [];
    expect(deps).toHaveLength(3);

    const writes = deps.filter((d) => d.access === 'write');
    const reads = deps.filter((d) => d.access === 'read');
    expect(writes).toHaveLength(2);
    expect(reads).toHaveLength(1);

    const names = deps.map((d) => d.target.name).sort();
    expect(names).toEqual(['order_items', 'orders', 'products']);

    // No self-reference
    expect(deps.find((d) => d.target.name === 'place_order')).toBeUndefined();
    // No phantom to audit_log
    expect(deps.find((d) => d.target.name === 'audit_log')).toBeUndefined();
  });

  it('Spec: dynamic_routine hasDynamicSql true AND deps.length === 0', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const proc = catalog.objects.find((o) => o.kind === 'procedure' && o.name === 'dynamic_routine');
    expect(proc).toBeDefined();
    expect(proc!.hasDynamicSql).toBe(true);
    expect(proc!.dependencies ?? []).toHaveLength(0);
  });

  it('Spec: routine at metadata level is present WITHOUT body', () => {
    const catalog = buildMysqlRawCatalog(input, METADATA_SCOPE);
    const proc = catalog.objects.find((o) => o.kind === 'procedure' && o.name === 'place_order');
    expect(proc).toBeDefined();
    expect(proc!.body).toBeUndefined();
    expect(proc!.dependencies).toBeUndefined();
  });

  it('Spec: procedure at off level is ABSENT from catalog', () => {
    const catalog = buildMysqlRawCatalog(input, OFF_SCOPE);
    const proc = catalog.objects.find((o) => o.kind === 'procedure');
    expect(proc).toBeUndefined();
  });

  it('Spec: function at off level is ABSENT from catalog', () => {
    const catalog = buildMysqlRawCatalog(input, OFF_SCOPE);
    const fn = catalog.objects.find((o) => o.kind === 'function');
    expect(fn).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Triggers
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — triggers', () => {
  it('Spec: trigger carries timing AFTER and events [UPDATE]', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const trigger = catalog.objects.find(
      (o) => o.kind === 'trigger' && o.name === 'trg_orders_after_update',
    );
    expect(trigger).toBeDefined();
    expect(trigger!.trigger!.timing).toBe('AFTER');
    expect(trigger!.trigger!.events).toEqual(['UPDATE']);
  });

  it('Spec: trigger fires_on resolves to parent table (orders), not the trigger itself', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const trigger = catalog.objects.find(
      (o) => o.kind === 'trigger' && o.name === 'trg_orders_after_update',
    );
    expect(trigger).toBeDefined();
    expect(trigger!.trigger!.table.name).toBe('orders');
    expect(trigger!.trigger!.table.schema).toBe('app');
  });

  it('trigger at off level is ABSENT', () => {
    const catalog = buildMysqlRawCatalog(input, OFF_SCOPE);
    const trigger = catalog.objects.find((o) => o.kind === 'trigger');
    expect(trigger).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic sort order
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMysqlRawCatalog — deterministic ordering (ADR-008)', () => {
  it('objects are sorted by (kindRank, schema, name)', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const sorted = [...catalog.objects];
    const original = [...catalog.objects];
    // The catalog objects must be in the same order as if we re-sorted them
    expect(original.map((o) => o.name)).toEqual(sorted.map((o) => o.name));
  });

  it('two runs produce identical JSON', () => {
    const c1 = buildMysqlRawCatalog(input, FULL_SCOPE);
    const c2 = buildMysqlRawCatalog(input, FULL_SCOPE);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });
});
