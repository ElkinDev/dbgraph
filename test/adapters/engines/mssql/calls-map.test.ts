/**
 * DOG-1 A.5 — mssql adapter classifies a routine-referenced dependency as a `calls` edge
 * carrying `target.kind` + `confidence:'declared'`, ROUTINE-gated (D2/D3).
 *
 * Strict TDD RED: `tokenizeModuleDeps` does not yet accept `ref_object_type` / a
 * source-is-routine gate, and does not yet set `target.kind`.
 *
 * L-009: exact-shape dependency assertions (target.kind + confidence + access), plus the
 * negatives — a table/view ref stays `parsed` with NO kind; a routine ref from a NON-routine
 * module (e.g. a view) is NOT declared; `sp_executesql`/variable-EXEC never enters the catalog
 * so it yields NO routine dependency.
 *
 * Spec: mssql-extraction "Catalog-declared calls edges" (S15/S16/S17 unit half).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizeModuleDeps } from '../../../../src/adapters/engines/mssql/tokenizer.js';
import { buildMssqlRawCatalog } from '../../../../src/adapters/engines/mssql/map.js';
import type { MssqlRowInput } from '../../../../src/adapters/engines/mssql/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject, RawDependency } from '../../../../src/core/model/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rowsDir = resolve(__dirname, '../../../fixtures/mssql/rows');
const rows = <T>(name: string): T => JSON.parse(readFileSync(resolve(rowsDir, name), 'utf8')) as T;

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full',
    views: 'full', procedures: 'full', functions: 'full', triggers: 'full',
    sequences: 'off', collections: 'off', fields: 'off', statistics: 'off', sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeModuleDeps — routine gating (unit)
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeModuleDeps — routine target from a routine module → declared calls', () => {
  it('proc → proc ref (P) sets target.kind procedure, confidence declared, access read', () => {
    const result = tokenizeModuleDeps(
      'CREATE PROCEDURE dbo.usp_refresh_totals @id INT AS BEGIN EXEC dbo.usp_log_change @id END',
      [{ ref_schema_name: 'dbo', ref_object_name: 'usp_log_change', ref_object_type: 'P ' }],
      { sourceIsRoutine: true },
    );
    expect(result.dependencies).toHaveLength(1);
    const d = result.dependencies[0]!;
    expect(d.target).toStrictEqual({ schema: 'dbo', name: 'usp_log_change', kind: 'procedure' });
    expect(d.confidence).toBe('declared');
    expect(d.access).toBe('read');
  });

  it('fn → fn ref (FN) sets target.kind function, confidence declared', () => {
    const result = tokenizeModuleDeps(
      'CREATE FUNCTION dbo.fn_net_amount(@g DECIMAL(12,2)) RETURNS DECIMAL(12,2) AS BEGIN RETURN dbo.fn_round_money(@g) END',
      [{ ref_schema_name: 'dbo', ref_object_name: 'fn_round_money', ref_object_type: 'FN' }],
      { sourceIsRoutine: true },
    );
    expect(result.dependencies).toHaveLength(1);
    const d = result.dependencies[0]!;
    expect(d.target).toStrictEqual({ schema: 'dbo', name: 'fn_round_money', kind: 'function' });
    expect(d.confidence).toBe('declared');
  });

  it('NEGATIVE: table ref (U) stays parsed with NO target.kind', () => {
    const result = tokenizeModuleDeps(
      'CREATE PROCEDURE dbo.usp_log_change @id INT AS BEGIN INSERT INTO dbo.audit_log (order_id) VALUES (@id) END',
      [{ ref_schema_name: 'dbo', ref_object_name: 'audit_log', ref_object_type: 'U ' }],
      { sourceIsRoutine: true },
    );
    const d = result.dependencies[0]!;
    expect(d.target).toStrictEqual({ schema: 'dbo', name: 'audit_log' });
    expect(d.confidence).toBe('parsed');
    expect(d.access).toBe('write');
  });

  it('NEGATIVE: view ref (V) stays parsed with NO target.kind', () => {
    const result = tokenizeModuleDeps(
      'CREATE PROCEDURE dbo.usp_x AS BEGIN SELECT * FROM dbo.v_order_summary END',
      [{ ref_schema_name: 'dbo', ref_object_name: 'v_order_summary', ref_object_type: 'V ' }],
      { sourceIsRoutine: true },
    );
    const d = result.dependencies[0]!;
    expect(d.target).toStrictEqual({ schema: 'dbo', name: 'v_order_summary' });
    expect(d.confidence).toBe('parsed');
  });

  it('NEGATIVE: a routine ref from a NON-routine module (view) is NOT declared (source gate)', () => {
    const result = tokenizeModuleDeps(
      'CREATE VIEW dbo.v_wrap AS SELECT dbo.fn_round_money(1) AS x',
      [{ ref_schema_name: 'dbo', ref_object_name: 'fn_round_money', ref_object_type: 'FN' }],
      { sourceIsRoutine: false },
    );
    const d = result.dependencies[0]!;
    expect(d.target).toStrictEqual({ schema: 'dbo', name: 'fn_round_money' });
    expect(d.confidence).toBe('parsed');
  });

  it('BACKWARD-COMPAT: called without opts / ref_object_type behaves unchanged (parsed, no kind)', () => {
    const result = tokenizeModuleDeps(
      'INSERT INTO dbo.audit_log (id) VALUES (1)',
      [{ ref_schema_name: 'dbo', ref_object_name: 'audit_log' }],
    );
    const d = result.dependencies[0]!;
    expect(d.target).toStrictEqual({ schema: 'dbo', name: 'audit_log' });
    expect(d.confidence).toBe('parsed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildMssqlRawCatalog — map.ts threads ref_object_type through, routine-gated
// ─────────────────────────────────────────────────────────────────────────────

function loadInput(): MssqlRowInput {
  return {
    tables: [], columns: [], keyConstraints: [], foreignKeys: [],
    checkConstraints: [], indexes: [], triggerEvents: [], sequences: [],
    extendedProperties: [],
    modules: rows('modules.json'),
    dependencies: rows('dependencies.json'),
  } as unknown as MssqlRowInput;
}

function depsOf(objects: readonly RawObject[], name: string): readonly RawDependency[] {
  const obj = objects.find((o) => o.name === name);
  expect(obj, `object ${name} must exist`).toBeDefined();
  return obj!.dependencies ?? [];
}

describe('buildMssqlRawCatalog — routine deps carry target.kind + declared (fixture rows)', () => {
  const catalog = buildMssqlRawCatalog(loadInput(), FULL_SCOPE);

  it('usp_refresh_totals EXACTLY { calls usp_log_change (declared, procedure), writes order_totals (parsed) }', () => {
    const deps = depsOf(catalog.objects, 'usp_refresh_totals');
    const callsDep = deps.find((d) => d.target.name === 'usp_log_change');
    expect(callsDep).toStrictEqual({
      target: { schema: 'dbo', name: 'usp_log_change', kind: 'procedure' },
      access: 'read',
      confidence: 'declared',
    });
    const writeDep = deps.find((d) => d.target.name === 'order_totals');
    expect(writeDep!.target).toStrictEqual({ schema: 'dbo', name: 'order_totals' });
    expect(writeDep!.confidence).toBe('parsed');
    expect(writeDep!.access).toBe('write');
    // NEGATIVE: no routine-kinded dependency other than usp_log_change
    const kinded = deps.filter((d) => d.target.kind !== undefined);
    expect(kinded.map((d) => d.target.name)).toStrictEqual(['usp_log_change']);
  });

  it('usp_log_change has { writes audit_log (parsed) } and ZERO routine-kinded deps', () => {
    const deps = depsOf(catalog.objects, 'usp_log_change');
    expect(deps.filter((d) => d.target.kind !== undefined)).toStrictEqual([]);
    const auditDep = deps.find((d) => d.target.name === 'audit_log');
    expect(auditDep!.confidence).toBe('parsed');
    expect(auditDep!.access).toBe('write');
  });

  it('fn_net_amount → fn_round_money is a declared function calls dep', () => {
    const deps = depsOf(catalog.objects, 'fn_net_amount');
    const callsDep = deps.find((d) => d.target.name === 'fn_round_money');
    expect(callsDep).toStrictEqual({
      target: { schema: 'dbo', name: 'fn_round_money', kind: 'function' },
      access: 'read',
      confidence: 'declared',
    });
  });

  it('NEGATIVE: usp_process_order (table-only proc) has ZERO routine-kinded deps', () => {
    const deps = depsOf(catalog.objects, 'usp_process_order');
    expect(deps.filter((d) => d.target.kind !== undefined)).toStrictEqual([]);
  });
});
