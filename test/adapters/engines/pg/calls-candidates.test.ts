/**
 * DOG-1 B.1 — pg body-`parsed` `calls` candidate seam (tokenizer + map).
 *
 * The pg `buildRoutines` candidate list is EXTENDED to include ROUTINE nodes (carrying
 * `kind`), EXPLICITLY self-excluded (Design D4 — `pg_get_functiondef` emits the CREATE
 * FUNCTION header, so a body contains its OWN qname). The shared presence-gate
 * (`bodyContainsRef` over `maskDynamicStrings`) confirms the call; `tokenizePgBody`
 * carries the candidate `kind` straight to `target.kind` so the normalizer emits a
 * `calls` edge at `confidence: 'parsed'`.
 *
 * L-009 EXACT sets + explicit negatives — existence-only asserts are FORBIDDEN.
 * Spec: pg-extraction "Body-parsed calls edges for routine invocations" (S20/S21) + D3/D4.
 */

import { describe, it, expect } from 'vitest';
import { buildPgRawCatalog, type PgRowInput, type RoutineRow, type TableRow } from '../../../../src/adapters/engines/pg/map.js';
import { tokenizePgBody } from '../../../../src/adapters/engines/pg/tokenizer.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, tables: 'full', functions: 'full', procedures: 'full' },
};

// pg_get_functiondef-style body: INCLUDES the CREATE FUNCTION header (the D4 self-ref trap).
function fnDef(schema: string, name: string, sqlBody: string): string {
  return `CREATE OR REPLACE FUNCTION ${schema}.${name}()\n RETURNS bigint\n LANGUAGE sql\nAS $function$\n  ${sqlBody}\n$function$`;
}

function routine(name: string, kind: 'f' | 'p', def: string): RoutineRow {
  return { schema_name: 'app', routine_name: name, routine_kind: kind, routine_def: def, comment: null };
}

function ordersTable(): TableRow {
  return { schema_name: 'app', table_name: 'orders', table_oid: 1000, comment: null };
}

function baseInput(routines: RoutineRow[], tables: TableRow[] = [ordersTable()]): PgRowInput {
  return {
    schemas: [{ schema_name: 'app' }],
    tables,
    columns: tables.map((t) => ({
      schema_name: t.schema_name, table_name: t.table_name, ordinal: 1, column_name: 'id',
      data_type: 'integer', is_nullable: false, default_expr: null, identity_kind: '', generated_kind: '', comment: null,
    })),
    columnNames: [],
    constraints: [],
    indexes: [],
    views: [],
    routines,
    triggers: [],
    sequences: [],
  };
}

function findRoutine(objects: readonly RawObject[], name: string): RawObject | undefined {
  return objects.find((o) => (o.kind === 'function' || o.kind === 'procedure') && o.name === name);
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizePgBody carries the routine candidate kind to target.kind (parsed)
// ─────────────────────────────────────────────────────────────────────────────

describe('pg tokenizePgBody — routine candidate kind carry', () => {
  it('a referenced routine candidate yields EXACTLY one dep carrying target.kind (parsed)', () => {
    const body = fnDef('app', 'fn_wrapper', 'SELECT app.fn_inner();');
    const result = tokenizePgBody(body, [{ schema: 'app', name: 'fn_inner', kind: 'function' }]);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]).toStrictEqual({
      target: { schema: 'app', name: 'fn_inner', kind: 'function' },
      access: 'read',
      confidence: 'parsed',
    });
  });

  it('S20 negative: a builtin-only body naming no user routine yields ZERO deps', () => {
    const body = fnDef('app', 'fn_calc', 'SELECT now(), count(*);');
    const result = tokenizePgBody(body, [{ schema: 'app', name: 'fn_inner', kind: 'function' }]);
    expect(result.dependencies).toStrictEqual([]);
  });

  it('S21 negative: a routine named only inside a dynamic EXECUTE string yields ZERO deps + hasDynamicSql', () => {
    const body =
      'CREATE OR REPLACE FUNCTION app.fn_dyn()\n RETURNS void\n LANGUAGE plpgsql\nAS $function$\n' +
      "DECLARE v text;\nBEGIN\n  v := 'SELECT app.fn_inner()';\n  EXECUTE v;\nEND;\n$function$";
    const result = tokenizePgBody(body, [{ schema: 'app', name: 'fn_inner', kind: 'function' }]);
    expect(result.hasDynamicSql).toBe(true);
    expect(result.dependencies).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildRoutines candidate list += routines (self-excluded) — Design D4
// ─────────────────────────────────────────────────────────────────────────────

describe('pg buildRoutines — routine candidates self-excluded (D4)', () => {
  const input = baseInput([
    routine('fn_wrapper', 'f', fnDef('app', 'fn_wrapper', 'SELECT app.fn_inner();')),
    routine('fn_inner', 'f', fnDef('app', 'fn_inner', 'SELECT count(*) FROM app.orders;')),
  ]);

  it('fn_wrapper has EXACTLY one routine dep: calls app.fn_inner (kind=function, parsed)', () => {
    const catalog = buildPgRawCatalog(input, FULL_SCOPE);
    const wrapper = findRoutine(catalog.objects, 'fn_wrapper');
    const deps = wrapper?.dependencies ?? [];
    const routineDeps = deps.filter((d) => d.target.kind === 'function' || d.target.kind === 'procedure');
    expect(routineDeps).toStrictEqual([
      { target: { schema: 'app', name: 'fn_inner', kind: 'function' }, access: 'read', confidence: 'parsed' },
    ]);
  });

  it('NEGATIVE: fn_wrapper does NOT reference itself (self-exclusion despite header qname)', () => {
    const catalog = buildPgRawCatalog(input, FULL_SCOPE);
    const wrapper = findRoutine(catalog.objects, 'fn_wrapper');
    const deps = wrapper?.dependencies ?? [];
    expect(deps.find((d) => d.target.name === 'fn_wrapper')).toBeUndefined();
  });

  it('fn_inner reads app.orders and emits ZERO routine deps (no reverse/self calls)', () => {
    const catalog = buildPgRawCatalog(input, FULL_SCOPE);
    const inner = findRoutine(catalog.objects, 'fn_inner');
    const deps = inner?.dependencies ?? [];
    expect(deps).toStrictEqual([
      { target: { schema: 'app', name: 'orders' }, access: 'read', confidence: 'parsed' },
    ]);
  });

  it('routines only ADD candidates: a table-only routine keeps its read/write deps unchanged', () => {
    const tableOnly = baseInput([
      routine('fn_reader', 'f', fnDef('app', 'fn_reader', 'SELECT count(*) FROM app.orders;')),
    ]);
    const catalog = buildPgRawCatalog(tableOnly, FULL_SCOPE);
    const reader = findRoutine(catalog.objects, 'fn_reader');
    expect(reader?.dependencies ?? []).toStrictEqual([
      { target: { schema: 'app', name: 'orders' }, access: 'read', confidence: 'parsed' },
    ]);
  });
});
