/**
 * mysql routine-parameter extraction (dog2-routine-parameters, Batch 1 task 1.5).
 * Spec: mysql-extraction "Extract routine parameters from information_schema.PARAMETERS"
 *   (MY-1, MY-2); schema-extraction SE-1. Design §4.3 D1/D5/D6.
 *
 * DEDICATED map-unit fixtures — MysqlParameterRow[]/MysqlRoutineRow[] built INLINE, NOT the
 * golden-feeding rows/*.json (rows/parameters.json is added only in Batch 2's re-bless), so
 * the committed aggregate goldens stay byte-identical.
 *
 * STRICT TDD, L-009 EXACT-set: .toStrictEqual the FULL RawParameter shape + negatives —
 * NULL mode (function params) ⇒ 'in', ORDINAL_POSITION=0 return row EXCLUDED, FULL
 * DTD_IDENTIFIER (varchar(20)), hasDefault NEVER emitted for ANY mysql parameter.
 */

import { describe, it, expect } from 'vitest';
import { buildMysqlRawCatalog } from '../../../../src/adapters/engines/mysql/map.js';
import type { MysqlRowInput, MysqlRoutineRow, MysqlParameterRow } from '../../../../src/adapters/engines/mysql/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject, RawParameter } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full', views: 'full',
    procedures: 'full', functions: 'full', triggers: 'full', sequences: 'full',
    collections: 'off', fields: 'off', statistics: 'off', sampling: 'off',
  },
};

function routine(name: string, type: 'PROCEDURE' | 'FUNCTION'): MysqlRoutineRow {
  return {
    routine_schema: 'app', routine_name: name, routine_type: type,
    routine_definition: null, routine_comment: null,
  };
}

function param(
  routine_name: string,
  ordinal_position: number,
  parameter_name: string | null,
  parameter_mode: string | null,
  data_type: string,
): MysqlParameterRow {
  return { routine_schema: 'app', routine_name, ordinal_position, parameter_name, parameter_mode, data_type };
}

function build(routines: MysqlRoutineRow[], parameters: MysqlParameterRow[]): readonly RawObject[] {
  const input: MysqlRowInput = {
    database: 'app', tables: [], columns: [], pkUkColumns: [], fkColumns: [],
    checkConstraints: [], statistics: [], views: [], routines, triggers: [], parameters,
  };
  return buildMysqlRawCatalog(input, FULL_SCOPE).objects;
}

function paramsOf(objects: readonly RawObject[], name: string): readonly RawParameter[] | undefined {
  const o = objects.find((x) => x.name === name);
  expect(o).toBeDefined();
  return o!.parameters;
}

describe('SQL_MYSQL_PARAMETERS map — information_schema.PARAMETERS → RawObject.parameters (MY-1/MY-2)', () => {
  it('zero-parameter procedures carry parameters:[]; NO hasDefault anywhere (MY-1)', () => {
    const objects = build(
      [routine('proc_orchestrate', 'PROCEDURE'), routine('proc_step', 'PROCEDURE')],
      [],
    );
    expect(paramsOf(objects, 'proc_orchestrate')).toStrictEqual([]);
    expect(paramsOf(objects, 'proc_step')).toStrictEqual([]);
  });

  it('fn_audit_write: return row (ordinal 0) EXCLUDED; FULL types; all in; no hasDefault (MY-2)', () => {
    const objects = build(
      [routine('fn_audit_write', 'FUNCTION')],
      [
        // ORDINAL_POSITION=0 (FUNCTION return, NULL name, NULL mode) → EXCLUDED
        param('fn_audit_write', 0, null, null, 'int'),
        param('fn_audit_write', 1, 'p_order_id', null, 'int'),
        param('fn_audit_write', 2, 'p_old_status', null, 'varchar(20)'),
        param('fn_audit_write', 3, 'p_new_status', null, 'varchar(20)'),
      ],
    );
    const params = paramsOf(objects, 'fn_audit_write')!;
    expect(params).toStrictEqual([
      { name: 'p_order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: 'p_old_status', dataType: 'varchar(20)', direction: 'in', ordinal: 2 },
      { name: 'p_new_status', dataType: 'varchar(20)', direction: 'in', ordinal: 3 },
    ]);
    // NEGATIVES: no fabricated hasDefault, return row gone, NULL mode never becomes out/inout.
    expect(params.some((p) => 'hasDefault' in p)).toBe(false);
    expect(params.some((p) => p.direction !== 'in')).toBe(false);
  });

  it('PARAMETER_MODE IN/OUT/INOUT decode exactly (procedure params)', () => {
    const objects = build(
      [routine('proc_mixed', 'PROCEDURE')],
      [
        param('proc_mixed', 1, 'a', 'IN', 'int'),
        param('proc_mixed', 2, 'b', 'OUT', 'int'),
        param('proc_mixed', 3, 'c', 'INOUT', 'int'),
      ],
    );
    expect(paramsOf(objects, 'proc_mixed')).toStrictEqual([
      { name: 'a', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: 'b', dataType: 'int', direction: 'out', ordinal: 2 },
      { name: 'c', dataType: 'int', direction: 'inout', ordinal: 3 },
    ]);
  });

  it('ordinal is contiguous 1..N over EMITTED params after the ordinal-0 exclusion (D6)', () => {
    const objects = build(
      [routine('fn_calc', 'FUNCTION')],
      [
        param('fn_calc', 0, null, null, 'int'),        // return row excluded
        param('fn_calc', 1, 'x', null, 'decimal(10,2)'),
        param('fn_calc', 2, 'y', null, 'decimal(10,2)'),
      ],
    );
    const params = paramsOf(objects, 'fn_calc')!;
    expect(params.map((p) => p.ordinal)).toStrictEqual([1, 2]);
    // FULL DTD_IDENTIFIER retains precision for mysql (unlike pg's typmod-less args).
    expect(params[0]!.dataType).toBe('decimal(10,2)');
  });
});
