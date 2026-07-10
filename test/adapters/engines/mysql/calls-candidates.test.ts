/**
 * DOG-1 B.2 — mysql body-`parsed` `calls` candidate seam (tokenizer + map).
 *
 * Same seam as pg: the mysql `buildRoutines` candidate list is EXTENDED with ROUTINE
 * names (carrying `kind`), self-excluded UNIFORMLY (Design D4 — determinism). A
 * `CALL proc()` / `SELECT fn()` in a `ROUTINE_DEFINITION` body resolved against a REAL
 * routine node becomes a `calls` edge at `confidence: 'parsed'`, presence-gated over the
 * dynamic-string-MASKED body.
 *
 * L-009 EXACT sets + explicit negatives — existence-only asserts are FORBIDDEN.
 * Spec: mysql-extraction "Body-parsed calls edges … no phantom or self edges" (S24/S25) + D3/D4.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMysqlRawCatalog,
  type MysqlRowInput,
  type MysqlRoutineRow,
  type MysqlTableRow,
} from '../../../../src/adapters/engines/mysql/map.js';
import { tokenizeMysqlBody } from '../../../../src/adapters/engines/mysql/tokenizer.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = {
  levels: { ...DEFAULT_LEVELS, tables: 'full', functions: 'full', procedures: 'full' },
};

function routine(name: string, type: 'PROCEDURE' | 'FUNCTION', def: string): MysqlRoutineRow {
  return { routine_schema: 'app', routine_name: name, routine_type: type, routine_definition: def, routine_comment: '' };
}

function table(name: string): MysqlTableRow {
  return { table_schema: 'app', table_name: name, table_comment: '' };
}

function baseInput(routines: MysqlRoutineRow[], tables: MysqlTableRow[] = [table('audit_log'), table('orders')]): MysqlRowInput {
  return {
    database: 'app',
    tables,
    columns: tables.map((t) => ({
      table_schema: t.table_schema, table_name: t.table_name, ordinal_position: 1, column_name: 'id',
      column_type: 'int', is_nullable: 'NO', column_default: null, extra: '', generation_expression: null, column_comment: null,
    })),
    pkUkColumns: [],
    fkColumns: [],
    checkConstraints: [],
    statistics: [],
    views: [],
    routines,
    triggers: [],
  };
}

function findRoutine(objects: readonly RawObject[], name: string): RawObject | undefined {
  return objects.find((o) => (o.kind === 'function' || o.kind === 'procedure') && o.name === name);
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeMysqlBody carries the routine candidate kind to target.kind (parsed)
// ─────────────────────────────────────────────────────────────────────────────

describe('mysql tokenizeMysqlBody — routine candidate kind carry', () => {
  it('a referenced procedure candidate (CALL) yields EXACTLY one dep carrying target.kind (parsed)', () => {
    const result = tokenizeMysqlBody('BEGIN\n  CALL app.proc_step();\nEND', [
      { schema: 'app', name: 'proc_step', kind: 'procedure' },
    ]);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]).toStrictEqual({
      target: { schema: 'app', name: 'proc_step', kind: 'procedure' },
      access: 'read',
      confidence: 'parsed',
    });
  });

  it('S24 negative: a table-only body CALLing no routine yields ZERO routine deps', () => {
    const result = tokenizeMysqlBody('BEGIN\n  INSERT INTO app.audit_log (event_type) VALUES (1);\nEND', [
      { schema: 'app', name: 'proc_step', kind: 'procedure' },
    ]);
    expect(result.dependencies.filter((d) => d.target.kind !== undefined)).toStrictEqual([]);
  });

  it('S25 negative: a CALL only inside a masked PREPARE/EXECUTE string yields ZERO deps + hasDynamicSql', () => {
    const body =
      "BEGIN\n  SET @sql = CONCAT('CALL app.proc_step()');\n  PREPARE stmt FROM @sql;\n  EXECUTE stmt;\n  DEALLOCATE PREPARE stmt;\nEND";
    const result = tokenizeMysqlBody(body, [{ schema: 'app', name: 'proc_step', kind: 'procedure' }]);
    expect(result.hasDynamicSql).toBe(true);
    expect(result.dependencies).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildRoutines candidate list += routines (self-excluded uniformly) — Design D4
// ─────────────────────────────────────────────────────────────────────────────

describe('mysql buildRoutines — routine candidates self-excluded (D4, uniform)', () => {
  const input = baseInput([
    routine('proc_orchestrate', 'PROCEDURE', 'BEGIN\n  CALL app.proc_step();\nEND'),
    routine('proc_step', 'PROCEDURE', "BEGIN\n  INSERT INTO app.audit_log (event_type) VALUES ('step');\nEND"),
  ]);

  it('proc_orchestrate has EXACTLY one routine dep: calls app.proc_step (kind=procedure, parsed)', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orch = findRoutine(catalog.objects, 'proc_orchestrate');
    const deps = orch?.dependencies ?? [];
    const routineDeps = deps.filter((d) => d.target.kind === 'procedure' || d.target.kind === 'function');
    expect(routineDeps).toStrictEqual([
      { target: { schema: 'app', name: 'proc_step', kind: 'procedure' }, access: 'read', confidence: 'parsed' },
    ]);
  });

  it('NEGATIVE: proc_orchestrate does NOT reference itself (uniform self-exclusion)', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const orch = findRoutine(catalog.objects, 'proc_orchestrate');
    const deps = orch?.dependencies ?? [];
    expect(deps.find((d) => d.target.name === 'proc_orchestrate')).toBeUndefined();
  });

  it('proc_step writes app.audit_log and emits ZERO routine deps (no reverse/self calls)', () => {
    const catalog = buildMysqlRawCatalog(input, FULL_SCOPE);
    const step = findRoutine(catalog.objects, 'proc_step');
    const deps = step?.dependencies ?? [];
    expect(deps).toStrictEqual([
      { target: { schema: 'app', name: 'audit_log' }, access: 'write', confidence: 'parsed' },
    ]);
  });

  it('routines only ADD candidates: a table-only proc keeps its write deps unchanged', () => {
    const tableOnly = baseInput([
      routine('proc_writer', 'PROCEDURE', "BEGIN\n  INSERT INTO app.audit_log (event_type) VALUES ('x');\nEND"),
    ]);
    const catalog = buildMysqlRawCatalog(tableOnly, FULL_SCOPE);
    const writer = findRoutine(catalog.objects, 'proc_writer');
    expect(writer?.dependencies ?? []).toStrictEqual([
      { target: { schema: 'app', name: 'audit_log' }, access: 'write', confidence: 'parsed' },
    ]);
  });
});
