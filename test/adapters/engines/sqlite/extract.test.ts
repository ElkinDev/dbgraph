/**
 * Extraction mapper tests — tasks 4.2 through 4.7.
 * Tests mappers in map.ts against the materialized torture fixture.
 * Design §mapping "object by object → RawCatalog".
 * TDD: RED → fails until src/adapters/engines/sqlite/map.ts is created.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import {
  extractTables,
  extractColumns,
  extractPrimaryKeys,
  extractForeignKeys,
  extractIndexes,
  extractUniqueConstraints,
  extractViews,
  extractTriggers,
  buildRawCatalog,
} from '../../../../src/adapters/engines/sqlite/map.js';
import { betterSqliteDriver } from '../../../../src/adapters/engines/sqlite/driver.js';
import type { ReadonlyDriver } from '../../../../src/adapters/engines/sqlite/driver.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture setup
// ─────────────────────────────────────────────────────────────────────────────

let mat: MaterializedDb;
let driver: ReadonlyDriver;

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };
const METADATA_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    views: 'metadata',
    triggers: 'metadata',
  },
};

beforeAll(() => {
  mat = materializeTorture();
  const db = new Database(mat.path, { readonly: true });
  driver = betterSqliteDriver(db);
});

afterAll(() => {
  driver.close();
  mat.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 — Tables and columns
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTables()', () => {
  it('returns RawObjects for every user table', () => {
    const tables = extractTables(driver);
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain('departments');
    expect(names).toContain('employees');
    expect(names).toContain('projects');
    expect(names).toContain('assignments');
    expect(names).toContain('audit_log');
    expect(names).toContain('counters');
  });

  it('each table has kind = table and schema = main', () => {
    const tables = extractTables(driver);
    for (const t of tables) {
      expect(t.kind).toBe('table');
      expect(t.schema).toBe('main');
    }
  });

  it('excludes sqlite_* system tables', () => {
    const tables = extractTables(driver);
    for (const t of tables) {
      expect(t.name).not.toMatch(/^sqlite_/);
    }
  });

  it('WITHOUT ROWID table (counters) has extra.withoutRowid = true', () => {
    const tables = extractTables(driver);
    const counters = tables.find((t) => t.name === 'counters');
    expect(counters).toBeDefined();
    expect(counters!.extra?.['withoutRowid']).toBe(true);
  });

  it('normal table (employees) does NOT have extra.withoutRowid', () => {
    const tables = extractTables(driver);
    const emp = tables.find((t) => t.name === 'employees');
    expect(emp).toBeDefined();
    expect(emp!.extra?.['withoutRowid']).toBeFalsy();
  });
});

describe('extractColumns()', () => {
  it('employees table has expected columns with correct properties', () => {
    const cols = extractColumns(driver, 'employees');
    const names = cols.map((c) => c.name);
    expect(names).toContain('emp_id');
    expect(names).toContain('full_name');
    expect(names).toContain('email');
    expect(names).toContain('dept_id');
    expect(names).toContain('salary');
  });

  it('column ordinals are sequential starting from 0', () => {
    const cols = extractColumns(driver, 'employees');
    const ordinals = cols.map((c) => c.ordinal);
    expect(ordinals[0]).toBe(0);
    expect(ordinals[ordinals.length - 1]).toBe(cols.length - 1);
  });

  it('NOT NULL column is marked nullable = false', () => {
    const cols = extractColumns(driver, 'employees');
    const fullName = cols.find((c) => c.name === 'full_name');
    expect(fullName).toBeDefined();
    expect(fullName!.nullable).toBe(false);
  });

  it('nullable column is marked nullable = true', () => {
    const cols = extractColumns(driver, 'employees');
    const email = cols.find((c) => c.name === 'email');
    expect(email).toBeDefined();
    expect(email!.nullable).toBe(true);
  });

  it('column with default carries the default value', () => {
    const cols = extractColumns(driver, 'employees');
    const salary = cols.find((c) => c.name === 'salary');
    expect(salary).toBeDefined();
    expect(salary!.default).toBe('0.0');
  });

  it('column without default has null default', () => {
    const cols = extractColumns(driver, 'employees');
    const email = cols.find((c) => c.name === 'email');
    expect(email).toBeDefined();
    expect(email!.default).toBeNull();
  });

  it('declared type is preserved as-is (no invention)', () => {
    const cols = extractColumns(driver, 'employees');
    const salary = cols.find((c) => c.name === 'salary');
    expect(salary).toBeDefined();
    expect(salary!.dataType).toBe('REAL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.3 — Foreign keys (single + composite)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractForeignKeys()', () => {
  it('employees table has single-column FK to departments', () => {
    const fks = extractForeignKeys(driver, 'employees');
    expect(fks).toHaveLength(1);
    const fk = fks[0]!;
    expect(fk.type).toBe('FK');
    expect(fk.columns).toEqual(['dept_id']);
    expect(fk.references?.table).toBe('departments');
    expect(fk.references?.columns).toEqual(['dept_id']);
  });

  it('assignments table has ONE composite FK over (emp_id, dept_id)', () => {
    const fks = extractForeignKeys(driver, 'assignments');
    // One FK id = one constraint, even though it spans two column pairs.
    expect(fks).toHaveLength(1);
    const fk = fks[0]!;
    expect(fk.type).toBe('FK');
    expect(fk.columns).toContain('emp_id');
    expect(fk.columns).toContain('dept_id');
    expect(fk.references?.table).toBe('employees');
    expect(fk.references?.columns).toContain('emp_id');
    expect(fk.references?.columns).toContain('dept_id');
  });

  it('projects table has no FKs', () => {
    const fks = extractForeignKeys(driver, 'projects');
    expect(fks).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.4 — Indexes (plain, unique, partial, expression)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractIndexes()', () => {
  it('plain multi-column index is present', () => {
    const indexes = extractIndexes(driver, 'employees');
    const idx = indexes.find((i) => i.name === 'idx_emp_dept');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(false);
    expect(idx!.columns).toContain('dept_id');
    expect(idx!.columns).toContain('hire_date');
  });

  it('unique index is marked unique = true', () => {
    const indexes = extractIndexes(driver, 'employees');
    const idx = indexes.find((i) => i.name === 'idx_emp_email');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(true);
  });

  it('partial index has extra.where populated', () => {
    const indexes = extractIndexes(driver, 'employees');
    const idx = indexes.find((i) => i.name === 'idx_emp_active_dept');
    expect(idx).toBeDefined();
    expect(typeof idx!.extra?.['where']).toBe('string');
    expect((idx!.extra?.['where'] as string).toLowerCase()).toContain('not null');
  });

  it('expression index column is mapped to (expr) placeholder', () => {
    const indexes = extractIndexes(driver, 'employees');
    const idx = indexes.find((i) => i.name === 'idx_emp_email_lower');
    expect(idx).toBeDefined();
    expect(idx!.columns).toContain('(expr)');
    // Must NOT contain a fake column name
    expect(idx!.columns).not.toContain('lower(email)');
  });

  it('sqlite_autoindex_* indexes are skipped', () => {
    // The PK on assignments creates an autoindex — should not appear
    const indexes = extractIndexes(driver, 'assignments');
    for (const idx of indexes) {
      expect(idx.name).not.toMatch(/^sqlite_autoindex_/);
    }
  });
});

describe('extractUniqueConstraints()', () => {
  it('unique index on employees also produces a UNIQUE RawConstraint', () => {
    const constraints = extractUniqueConstraints(driver, 'employees');
    const uc = constraints.find((c) => c.name === 'idx_emp_email');
    expect(uc).toBeDefined();
    expect(uc!.type).toBe('UNIQUE');
    expect(uc!.columns).toContain('email');
  });
});

describe('extractPrimaryKeys()', () => {
  it('single-column PK produces one PK constraint', () => {
    const pks = extractPrimaryKeys(driver, 'employees');
    expect(pks).toHaveLength(1);
    expect(pks[0]!.type).toBe('PK');
    expect(pks[0]!.columns).toEqual(['emp_id']);
  });

  it('composite PK (assignments) produces ONE constraint with all PK columns', () => {
    const pks = extractPrimaryKeys(driver, 'assignments');
    expect(pks).toHaveLength(1);
    expect(pks[0]!.columns).toContain('project_id');
    expect(pks[0]!.columns).toContain('emp_id');
    expect(pks[0]!.columns).toContain('dept_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.5 — Views (body level-gated)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractViews()', () => {
  it('returns RawObjects for all user views', () => {
    const views = extractViews(driver, FULL_SCOPE);
    const names = views.map((v) => v.name);
    expect(names).toContain('active_departments');
    expect(names).toContain('employee_summary');
  });

  it('each view has kind = view and schema = main', () => {
    const views = extractViews(driver, FULL_SCOPE);
    for (const v of views) {
      expect(v.kind).toBe('view');
      expect(v.schema).toBe('main');
    }
  });

  it('at full scope, view body is included', () => {
    const views = extractViews(driver, FULL_SCOPE);
    const v = views.find((x) => x.name === 'active_departments');
    expect(v).toBeDefined();
    expect(typeof v!.body).toBe('string');
    expect(v!.body!.length).toBeGreaterThan(0);
  });

  it('at metadata scope, view body is absent', () => {
    const views = extractViews(driver, METADATA_SCOPE);
    const v = views.find((x) => x.name === 'active_departments');
    expect(v).toBeDefined();
    expect(v!.body).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.6 — Triggers (body level-gated, timing + events parsed)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTriggers()', () => {
  it('returns RawObjects for all user triggers', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const names = triggers.map((t) => t.name);
    expect(names).toContain('trg_emp_before_insert');
    expect(names).toContain('trg_emp_after_insert');
    expect(names).toContain('trg_emp_before_update');
    expect(names).toContain('trg_emp_after_delete');
    expect(names).toContain('trg_active_dept_instead_insert');
  });

  it('each trigger has kind = trigger', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    for (const t of triggers) {
      expect(t.kind).toBe('trigger');
    }
  });

  it('BEFORE INSERT trigger has timing = BEFORE and events = [INSERT]', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_before_insert');
    expect(t).toBeDefined();
    expect(t!.trigger?.timing).toBe('BEFORE');
    expect(t!.trigger?.events).toContain('INSERT');
  });

  it('AFTER DELETE trigger has timing = AFTER and events = [DELETE]', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_after_delete');
    expect(t).toBeDefined();
    expect(t!.trigger?.timing).toBe('AFTER');
    expect(t!.trigger?.events).toContain('DELETE');
  });

  it('INSTEAD OF trigger has timing = INSTEAD OF', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_active_dept_instead_insert');
    expect(t).toBeDefined();
    expect(t!.trigger?.timing).toBe('INSTEAD OF');
  });

  it('trigger carries the target table name', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_before_insert');
    expect(t!.trigger?.table.name).toBe('employees');
  });

  it('trigger has empty dependencies (no guessing)', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    for (const t of triggers) {
      expect(t.dependencies).toEqual([]);
    }
  });

  it('at full scope, trigger body is included', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_before_insert');
    expect(t).toBeDefined();
    expect(typeof t!.body).toBe('string');
    expect(t!.body!.length).toBeGreaterThan(0);
  });

  it('at metadata scope, trigger body is absent', () => {
    const triggers = extractTriggers(driver, METADATA_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_before_insert');
    expect(t).toBeDefined();
    expect(t!.body).toBeUndefined();
  });

  // S-1: UPDATE OF <col> trigger normalises the event to UPDATE
  // map.ts parseTriggerInfo: UPDATE OF <col> header contains \bUPDATE\b → events.add('UPDATE').
  // This branch was previously unexercised (torture.sql had no UPDATE OF trigger).
  it('UPDATE OF trigger is present in torture fixture (S-1)', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const names = triggers.map((t) => t.name);
    expect(names).toContain('trg_emp_salary_update');
  });

  it('UPDATE OF <col> trigger maps to events = [UPDATE] (S-1 branch coverage)', () => {
    // Spec: UPDATE OF <col> normalises to the UPDATE event — no column-level event.
    // The type of events is Array<'INSERT' | 'UPDATE' | 'DELETE'> — the TypeScript type
    // proves 'UPDATE OF' is structurally impossible; the runtime assertion proves the
    // value is present and is exactly 'UPDATE'.
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_salary_update');
    expect(t).toBeDefined();
    expect(t!.trigger?.events).toContain('UPDATE');
    // Events must have exactly one entry for this trigger (UPDATE OF salary fires on UPDATE only)
    expect(t!.trigger?.events).toHaveLength(1);
    expect(t!.trigger?.events[0]).toBe('UPDATE');
  });

  it('UPDATE OF trigger timing is BEFORE (S-1)', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_salary_update');
    expect(t).toBeDefined();
    expect(t!.trigger?.timing).toBe('BEFORE');
  });

  it('UPDATE OF trigger target table is employees (S-1)', () => {
    const triggers = extractTriggers(driver, FULL_SCOPE);
    const t = triggers.find((x) => x.name === 'trg_emp_salary_update');
    expect(t).toBeDefined();
    expect(t!.trigger?.table.name).toBe('employees');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.7 — Deterministic ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRawCatalog() — deterministic ordering (ADR-008)', () => {
  it('produces schemas = [main]', () => {
    const catalog = buildRawCatalog(driver, FULL_SCOPE);
    expect(catalog.schemas).toEqual(['main']);
  });

  it('engine is sqlite', () => {
    const catalog = buildRawCatalog(driver, FULL_SCOPE);
    expect(catalog.engine).toBe('sqlite');
  });

  it('objects are sorted by (kind rank, schema, name)', () => {
    const catalog = buildRawCatalog(driver, FULL_SCOPE);
    // Kind rank: table < view < trigger < index (etc. — deterministic)
    // Within same kind: alphabetical by name
    const tableObjects = catalog.objects.filter((o) => o.kind === 'table');
    const tableNames = tableObjects.map((o) => o.name);
    const sorted = [...tableNames].sort((a, b) => a.localeCompare(b));
    expect(tableNames).toEqual(sorted);
  });

  it('columns within a table are sorted by ordinal', () => {
    const catalog = buildRawCatalog(driver, FULL_SCOPE);
    const emp = catalog.objects.find((o) => o.kind === 'table' && o.name === 'employees');
    expect(emp).toBeDefined();
    const ordinals = emp!.columns!.map((c) => c.ordinal);
    const sorted = [...ordinals].sort((a, b) => a - b);
    expect(ordinals).toEqual(sorted);
  });

  it('indexes within a table are sorted by name', () => {
    const catalog = buildRawCatalog(driver, FULL_SCOPE);
    const emp = catalog.objects.find((o) => o.kind === 'table' && o.name === 'employees');
    expect(emp).toBeDefined();
    const indexNames = (emp!.indexes ?? []).map((i) => i.name);
    const sorted = [...indexNames].sort((a, b) => a.localeCompare(b));
    expect(indexNames).toEqual(sorted);
  });

  it('stableStringify is identical across two calls (byte-stable)', () => {
    const catalog1 = buildRawCatalog(driver, FULL_SCOPE);
    const catalog2 = buildRawCatalog(driver, FULL_SCOPE);
    expect(stableStringify(catalog1)).toBe(stableStringify(catalog2));
  });

  it('off-scope type is absent from the catalog', () => {
    const offScope: ExtractionScope = {
      levels: { ...DEFAULT_LEVELS, triggers: 'off' },
    };
    const catalog = buildRawCatalog(driver, offScope);
    const triggers = catalog.objects.filter((o) => o.kind === 'trigger');
    expect(triggers).toHaveLength(0);
  });
});
