/**
 * PG map.ts tests — buildPgRawCatalog from captured pg_catalog fixture rows.
 * Design §map.ts "rows → deterministic sorted RawCatalog".
 * US-028 (PostgreSQL adapter), ADR-008 (determinism — golden-pinned).
 *
 * Tests verify:
 *   - Tables with columns: identity columns, generated columns, comments
 *   - Constraints: PK, FK (composite), UNIQUE, CHECK
 *   - Indexes: partial, expression, INCLUDE
 *   - Views (kind:'view') and Materialized views (kind:'view'+extra.materialized:true)
 *   - Functions (kind:'function') and Procedures (kind:'procedure')
 *   - Triggers: tgtype bitmask decode → timing/events, fires_on = parent table
 *   - Sequences
 *   - Deterministic object ordering (KIND_RANK + schema + name)
 *   - Level gating: metadata (no body), off (object absent)
 *   - Dynamic SQL flagged; trigger EXECUTE FUNCTION NOT flagged
 *   - Edge classification: write + read at confidence:'parsed'
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPgRawCatalog, type PgRowInput } from '../../../../src/adapters/engines/pg/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject } from '../../../../src/core/model/catalog.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture loading helpers
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, '../../../fixtures/pg/rows');

function loadFixture<T>(name: string): T {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(raw) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full scope (all levels = 'full')
// ─────────────────────────────────────────────────────────────────────────────

const FULL_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    tables: 'full',
    views: 'full',
    functions: 'full',
    procedures: 'full',
    triggers: 'full',
    sequences: 'full',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Build the full row input from fixtures
// ─────────────────────────────────────────────────────────────────────────────

function buildFixtureInput(): PgRowInput {
  return {
    schemas: loadFixture('schemas'),
    tables: loadFixture('tables'),
    columns: loadFixture('columns'),
    columnNames: loadFixture('column-names'),
    constraints: loadFixture('constraints'),
    indexes: loadFixture('indexes'),
    views: loadFixture('views'),
    routines: loadFixture('routines'),
    triggers: loadFixture('triggers'),
    sequences: loadFixture('sequences'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function findObject(objects: readonly RawObject[], kind: string, name: string): RawObject | undefined {
  return objects.find((o) => o.kind === kind && o.name === name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPgRawCatalog', () => {
  describe('engine and schemas', () => {
    it('engine is pg', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      expect(catalog.engine).toBe('pg');
    });

    it('schemas are sorted and unique', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      expect(catalog.schemas).toEqual(['app', 'audit']);
    });
  });

  describe('tables and columns', () => {
    it('extracts all tables from fixtures', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const tables = catalog.objects.filter((o) => o.kind === 'table');
      expect(tables.length).toBe(4); // orders, order_items, products, audit_log
    });

    it('table has columns ordered by attnum', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      expect(orders).toBeDefined();
      const cols = orders!.columns!;
      expect(cols.map((c) => c.name)).toEqual(['id', 'customer_id', 'total']);
      expect(cols.map((c) => c.ordinal)).toEqual([1, 2, 3]);
    });

    it('identity column carries identity in extra', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      const idCol = orders!.columns!.find((c) => c.name === 'id');
      // RawColumn is extended with extra via intersection in map.ts
      const colWithExtra = idCol as unknown as { extra?: Record<string, unknown> };
      expect(colWithExtra?.extra).toMatchObject({ identity: true, identityKind: 'ALWAYS' });
    });

    it('generated column carries generated in extra', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const items = findObject(catalog.objects, 'table', 'order_items');
      const generatedCol = items!.columns!.find((c) => c.name === 'line_total');
      // RawColumn is extended with extra via intersection in map.ts
      const colWithExtra = generatedCol as unknown as { extra?: Record<string, unknown> };
      expect(colWithExtra?.extra).toMatchObject({ generated: true });
    });

    it('column comment is surfaced', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      const idCol = orders!.columns!.find((c) => c.name === 'id');
      expect(idCol?.comment).toBe('Primary key');
    });

    it('table comment is surfaced', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      expect(orders?.comment).toBe('Order records');
    });
  });

  describe('constraints', () => {
    it('orders has a PK constraint', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      const pk = orders!.constraints!.find((c) => c.type === 'PK');
      expect(pk).toBeDefined();
      expect(pk!.name).toBe('orders_pkey');
      expect(pk!.columns).toEqual(['id']);
    });

    it('orders has a CHECK constraint', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      const chk = orders!.constraints!.find((c) => c.type === 'CHECK');
      expect(chk).toBeDefined();
      expect(chk!.name).toBe('orders_total_positive');
    });

    it('order_items has a composite UNIQUE constraint', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const items = findObject(catalog.objects, 'table', 'order_items');
      const uniq = items!.constraints!.find((c) => c.name === 'order_items_order_id_product_id_key');
      expect(uniq).toBeDefined();
      expect(uniq!.type).toBe('UNIQUE');
      expect(uniq!.columns).toEqual(['order_id', 'product_id']);
    });

    it('FK constraint has references with local and ref columns', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const items = findObject(catalog.objects, 'table', 'order_items');
      const fk = items!.constraints!.find((c) => c.name === 'order_items_order_id_fkey');
      expect(fk).toBeDefined();
      expect(fk!.type).toBe('FK');
      expect(fk!.columns).toEqual(['order_id']);
      expect(fk!.references).toMatchObject({ schema: 'app', table: 'orders' });
    });

    it('composite FK preserves column pair ordering', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const items = findObject(catalog.objects, 'table', 'order_items');
      const compFk = items!.constraints!.find((c) => c.name === 'order_items_composite_fkey');
      expect(compFk).toBeDefined();
      expect(compFk!.columns).toEqual(['order_id', 'product_id']);
    });

    it('constraints are sorted by name within table', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const items = findObject(catalog.objects, 'table', 'order_items');
      const names = items!.constraints!.map((c) => c.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe('indexes', () => {
    it('partial index keeps WHERE predicate in extra', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const orders = findObject(catalog.objects, 'table', 'orders');
      const partialIdx = orders!.indexes!.find((i) => i.name === 'idx_orders_total_positive');
      expect(partialIdx).toBeDefined();
      // RawIndex is extended with extra via intersection in map.ts
      const idxWithExtra = partialIdx as unknown as { extra?: Record<string, unknown> };
      expect(idxWithExtra?.extra).toMatchObject({ where: expect.stringContaining('total') });
    });

    it('expression index key is represented in extra.expressionDef', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const products = findObject(catalog.objects, 'table', 'products');
      const exprIdx = products!.indexes!.find((i) => i.name === 'idx_products_lower_name');
      expect(exprIdx).toBeDefined();
      // RawIndex is extended with extra via intersection in map.ts
      const idxWithExtra = exprIdx as unknown as { extra?: Record<string, unknown> };
      // An expression index (key_columns includes 0) should mark it as an expression
      expect(idxWithExtra?.extra).toMatchObject({ isExpression: true });
    });

    it('INCLUDE index has includedColumns in extra', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const items = findObject(catalog.objects, 'table', 'order_items');
      const inclIdx = items!.indexes!.find((i) => i.name === 'idx_order_items_include');
      expect(inclIdx).toBeDefined();
      // RawIndex is extended with extra via intersection in map.ts
      const idxWithExtra = inclIdx as unknown as { extra?: Record<string, unknown> };
      expect(idxWithExtra?.extra).toMatchObject({ includedColumns: ['price'] });
    });

    it('unique flag is set correctly', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const products = findObject(catalog.objects, 'table', 'products');
      const exprIdx = products!.indexes!.find((i) => i.name === 'idx_products_lower_name');
      expect(exprIdx?.unique).toBe(true);
    });
  });

  describe('views and materialized views', () => {
    it('regular view has kind:view', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const view = findObject(catalog.objects, 'view', 'v_order_summary');
      expect(view).toBeDefined();
      expect(view!.kind).toBe('view');
      expect(view?.extra?.['materialized']).toBeUndefined();
    });

    it('regular view has body at full level', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const view = findObject(catalog.objects, 'view', 'v_order_summary');
      expect(view?.body).toBeDefined();
      expect(view?.body).toContain('orders');
    });

    it('view comment is surfaced', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const view = findObject(catalog.objects, 'view', 'v_order_summary');
      expect(view?.comment).toBe('Order summary view');
    });

    it('materialized view has kind:view and extra.materialized:true — NO new NodeKind', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const matview = findObject(catalog.objects, 'view', 'mv_product_stats');
      expect(matview).toBeDefined();
      expect(matview!.kind).toBe('view');
      expect(matview!.extra).toMatchObject({ materialized: true });
    });

    it('view at metadata level has no body', () => {
      const scope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, views: 'metadata' },
      };
      const catalog = buildPgRawCatalog(buildFixtureInput(), scope);
      const view = findObject(catalog.objects, 'view', 'v_order_summary');
      expect(view).toBeDefined();
      expect(view?.body).toBeUndefined();
    });

    it('matview at off level is absent', () => {
      const scope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, views: 'off' },
      };
      const catalog = buildPgRawCatalog(buildFixtureInput(), scope);
      const matview = findObject(catalog.objects, 'view', 'mv_product_stats');
      expect(matview).toBeUndefined();
    });

    it('view reads_from edges are classified at confidence:parsed', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const view = findObject(catalog.objects, 'view', 'v_order_summary');
      expect(view?.dependencies).toBeDefined();
      const deps = view!.dependencies!;
      expect(deps.length).toBeGreaterThan(0);
      for (const dep of deps) {
        expect(dep.confidence).toBe('parsed');
        expect(dep.access).toBe('read');
      }
    });

    // ── NEGATIVE / exact-set assertions (CRITICAL-1 regression guard) ──────────
    // Each routine/view below must have ONLY the deps that the body actually
    // references. Existence-only toBeDefined() assertions are INSUFFICIENT.

    it('v_order_summary has EXACTLY 2 deps: orders + order_items (no phantom, no self)', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const view = findObject(catalog.objects, 'view', 'v_order_summary');
      const deps = view!.dependencies ?? [];
      const names = deps.map((d) => d.target.name).sort();
      expect(names).toEqual(['order_items', 'orders']);
      // Must NOT include itself
      expect(deps.find((d) => d.target.name === 'v_order_summary')).toBeUndefined();
      // Must NOT include phantom objects that are absent from the body
      expect(deps.find((d) => d.target.name === 'audit_log')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'products')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'mv_product_stats')).toBeUndefined();
    });

    it('mv_product_stats has EXACTLY 2 deps: products + order_items (no phantom, no self)', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const matview = findObject(catalog.objects, 'view', 'mv_product_stats');
      const deps = matview!.dependencies ?? [];
      const names = deps.map((d) => d.target.name).sort();
      expect(names).toEqual(['order_items', 'products']);
      // Must NOT include itself
      expect(deps.find((d) => d.target.name === 'mv_product_stats')).toBeUndefined();
      // Must NOT include phantom objects absent from the body
      expect(deps.find((d) => d.target.name === 'audit_log')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'orders')).toBeUndefined();
    });
  });

  describe('functions and procedures', () => {
    it('function has kind:function', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'process_order');
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe('function');
    });

    it('procedure has kind:procedure', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const proc = findObject(catalog.objects, 'procedure', 'sync_products');
      expect(proc).toBeDefined();
      expect(proc!.kind).toBe('procedure');
    });

    // DOG-2: recorded routines.json arg arrays decode into parameters (regtype-name types, D5/D6).
    it('routine parameters are decoded from the recorded pg_proc arg arrays (L-009)', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      // process_order(p_order_id integer) → single IN integer
      expect(findObject(catalog.objects, 'function', 'process_order')!.parameters).toStrictEqual([
        { name: 'p_order_id', dataType: 'integer', direction: 'in', ordinal: 1 },
      ]);
      // dynamic_query(tbl text) → single IN text
      expect(findObject(catalog.objects, 'function', 'dynamic_query')!.parameters).toStrictEqual([
        { name: 'tbl', dataType: 'text', direction: 'in', ordinal: 1 },
      ]);
      // fn_inner()/fn_wrapper() → real empty signature []
      expect(findObject(catalog.objects, 'function', 'fn_inner')!.parameters).toStrictEqual([]);
      expect(findObject(catalog.objects, 'function', 'fn_wrapper')!.parameters).toStrictEqual([]);
    });

    it('function body is included at full level', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'process_order');
      expect(fn?.body).toBeDefined();
    });

    it('function writes to audit_log and reads from products', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'process_order');
      const deps = fn!.dependencies!;
      const writeDep = deps.find((d) => d.target.name === 'audit_log' && d.access === 'write');
      const readDep = deps.find((d) => d.target.name === 'products' && d.access === 'read');
      expect(writeDep).toBeDefined();
      expect(readDep).toBeDefined();
    });

    it('dynamic_query function has hasDynamicSql:true and no edges', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'dynamic_query');
      expect(fn?.hasDynamicSql).toBe(true);
    });

    // ── NEGATIVE / exact-set assertions (CRITICAL-1 regression guard) ──────────

    it('process_order has EXACTLY 2 deps: writes audit_log + reads products (no phantom)', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'process_order');
      const deps = fn!.dependencies ?? [];
      expect(deps.length).toBe(2);
      const writeAudit = deps.find((d) => d.target.name === 'audit_log' && d.access === 'write');
      const readProducts = deps.find((d) => d.target.name === 'products' && d.access === 'read');
      expect(writeAudit).toBeDefined();
      expect(readProducts).toBeDefined();
      // Must NOT include phantom reads to tables absent from the body
      expect(deps.find((d) => d.target.name === 'orders')).toBeUndefined();
      expect(deps.find((d) => d.target.name === 'order_items')).toBeUndefined();
    });

    it('audit_fn has EXACTLY 1 dep: writes audit_log, zero reads', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'audit_fn');
      const deps = fn!.dependencies ?? [];
      expect(deps.length).toBe(1);
      const writeAudit = deps.find((d) => d.target.name === 'audit_log' && d.access === 'write');
      expect(writeAudit).toBeDefined();
      // Must have ZERO reads
      expect(deps.filter((d) => d.access === 'read').length).toBe(0);
    });

    it('sync_products procedure has EXACTLY 1 dep: writes audit_log, zero reads', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const proc = findObject(catalog.objects, 'procedure', 'sync_products');
      const deps = proc!.dependencies ?? [];
      expect(deps.length).toBe(1);
      const writeAudit = deps.find((d) => d.target.name === 'audit_log' && d.access === 'write');
      expect(writeAudit).toBeDefined();
      expect(deps.filter((d) => d.access === 'read').length).toBe(0);
    });

    it('dynamic_query has ZERO dependency edges (refs are inside dynamic string)', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'dynamic_query');
      const deps = fn?.dependencies ?? [];
      expect(deps.length).toBe(0);
    });

    it('function at metadata level has no body', () => {
      const scope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, functions: 'metadata' },
      };
      const catalog = buildPgRawCatalog(buildFixtureInput(), scope);
      const fn = findObject(catalog.objects, 'function', 'process_order');
      expect(fn).toBeDefined();
      expect(fn?.body).toBeUndefined();
    });

    it('procedure at off level is absent', () => {
      const scope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, procedures: 'off' },
      };
      const catalog = buildPgRawCatalog(buildFixtureInput(), scope);
      const proc = findObject(catalog.objects, 'procedure', 'sync_products');
      expect(proc).toBeUndefined();
    });

    it('function comment is surfaced', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const fn = findObject(catalog.objects, 'function', 'process_order');
      expect(fn?.comment).toBe('Processes an order and logs to audit');
    });
  });

  describe('triggers', () => {
    it('trigger has kind:trigger', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const trg = findObject(catalog.objects, 'trigger', 'trg_orders_audit');
      expect(trg).toBeDefined();
      expect(trg!.kind).toBe('trigger');
    });

    it('trigger tgtype=21 decodes to AFTER INSERT+UPDATE', () => {
      // tgtype 21 = 0b10101 = bit0 (ROW=1) + bit2 (INSERT=4) + bit4 (UPDATE=16) = 21, bit1=0 → AFTER
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const trg = findObject(catalog.objects, 'trigger', 'trg_orders_audit');
      expect(trg?.trigger?.timing).toBe('AFTER');
      const events = trg!.trigger!.events;
      expect(events).toContain('INSERT');
      expect(events).toContain('UPDATE');
      expect(events).not.toContain('DELETE');
    });

    it('trigger fires_on resolves to PARENT TABLE (orders), not the trigger or the function', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const trg = findObject(catalog.objects, 'trigger', 'trg_orders_audit');
      expect(trg?.trigger?.table).toMatchObject({ schema: 'app', name: 'orders' });
    });

    it('trigger fires_on is the TABLE not the function name (audit_fn)', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const trg = findObject(catalog.objects, 'trigger', 'trg_orders_audit');
      expect(trg?.trigger?.table?.name).not.toBe('audit_fn');
      expect(trg?.trigger?.table?.name).not.toBe('trg_orders_audit');
    });

    it('EXECUTE FUNCTION in trigger def does NOT set hasDynamicSql', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const trg = findObject(catalog.objects, 'trigger', 'trg_orders_audit');
      expect(trg?.hasDynamicSql).toBeFalsy();
    });
  });

  describe('sequences', () => {
    it('sequence has kind:sequence', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const seq = findObject(catalog.objects, 'sequence', 'order_seq');
      expect(seq).toBeDefined();
      expect(seq!.kind).toBe('sequence');
    });

    it('sequence carries extra metadata', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const seq = findObject(catalog.objects, 'sequence', 'order_seq');
      expect(seq?.extra).toMatchObject({
        startValue: '1',
        increment: '1',
        isCycling: false,
      });
    });

    it('sequence comment is surfaced', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const seq = findObject(catalog.objects, 'sequence', 'order_seq');
      expect(seq?.comment).toBe('Sequence for order numbers');
    });

    it('sequences at off level are absent', () => {
      const scope: ExtractionScope = {
        levels: { ...DEFAULT_LEVELS, sequences: 'off' },
      };
      const catalog = buildPgRawCatalog(buildFixtureInput(), scope);
      const seq = findObject(catalog.objects, 'sequence', 'order_seq');
      expect(seq).toBeUndefined();
    });
  });

  describe('deterministic ordering (ADR-008)', () => {
    it('objects are sorted by kind rank then schema then name', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const objects = catalog.objects;

      // Verify ordering: tables before views before triggers, etc.
      const tables = objects.filter((o) => o.kind === 'table');
      const views = objects.filter((o) => o.kind === 'view');
      const triggers = objects.filter((o) => o.kind === 'trigger');

      if (tables.length > 0 && views.length > 0) {
        const lastTableIdx = objects.lastIndexOf(tables[tables.length - 1]!);
        const firstViewIdx = objects.indexOf(views[0]!);
        expect(lastTableIdx).toBeLessThan(firstViewIdx);
      }

      if (views.length > 0 && triggers.length > 0) {
        const lastViewIdx = objects.lastIndexOf(views[views.length - 1]!);
        const firstTriggerIdx = objects.indexOf(triggers[0]!);
        expect(lastViewIdx).toBeLessThan(firstTriggerIdx);
      }
    });

    it('tables within same kind are sorted by schema then name', () => {
      const catalog = buildPgRawCatalog(buildFixtureInput(), FULL_SCOPE);
      const tables = catalog.objects.filter((o) => o.kind === 'table');
      const names = tables.map((t) => `${t.schema}.${t.name}`);
      expect(names).toEqual([...names].sort());
    });
  });
});
