/**
 * mssql routine-parameter extraction (dog2-routine-parameters, Batch 1 task 1.3).
 * Spec: mssql-extraction "Extract routine parameters from sys.parameters" (MS-1, MS-2);
 *   schema-extraction SE-1. Design §4.1 D1/D5/D6.
 *
 * DEDICATED map-unit fixtures — constructed INLINE here, NOT the golden-feeding rows/*.json,
 * so the committed aggregate goldens stay byte-identical until Batch 2's single re-bless.
 *
 * STRICT TDD, L-009 EXACT-set: .toStrictEqual the FULL RawParameter shape
 * (name+dataType+direction+ordinal(+hasDefault)) PLUS negatives — no fabricated out/inout,
 * no fabricated hasDefault, parameter_id=0 return row EXCLUDED, BARE dataType (never decimal(12,2)).
 */

import { describe, it, expect } from 'vitest';
import { buildMssqlRawCatalog } from '../../../../src/adapters/engines/mssql/map.js';
import type { MssqlRowInput, ModuleRow, ParameterRow } from '../../../../src/adapters/engines/mssql/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject, RawParameter } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full', views: 'full',
    procedures: 'full', functions: 'full', triggers: 'full', sequences: 'full',
    collections: 'off', fields: 'off', statistics: 'off', sampling: 'off',
  },
};

function mod(object_id: number, name: string, type: string): ModuleRow {
  return { schema_name: 'dbo', object_name: name, object_type: type, object_id, definition: null };
}

function param(
  object_id: number,
  object_name: string,
  parameter_id: number,
  parameter_name: string,
  data_type: string,
  is_output = false,
  has_default_value = false,
): ParameterRow {
  return {
    schema_name: 'dbo', object_name, object_id, parameter_id,
    parameter_name, data_type, is_output, has_default_value,
  };
}

function build(modules: ModuleRow[], parameters: ParameterRow[]): RawCatalogObjects {
  const input: MssqlRowInput = {
    tables: [], columns: [], keyConstraints: [], foreignKeys: [], checkConstraints: [],
    indexes: [], modules, triggerEvents: [], sequences: [], extendedProperties: [],
    dependencies: [], parameters,
  };
  return buildMssqlRawCatalog(input, FULL_SCOPE).objects;
}

type RawCatalogObjects = readonly RawObject[];

function paramsOf(objects: RawCatalogObjects, name: string): readonly RawParameter[] | undefined {
  const o = objects.find((x) => x.name === name);
  expect(o).toBeDefined();
  return o!.parameters;
}

describe('SQL_MSSQL_PARAMETERS map — sys.parameters → RawObject.parameters (MS-1/MS-2, D1/D5/D6)', () => {
  it('usp_log_change parameters pinned exactly, BARE types, no hasDefault (MS-1)', () => {
    const objects = build(
      [mod(100, 'usp_log_change', 'P')],
      [
        param(100, 'usp_log_change', 1, '@order_id', 'int'),
        param(100, 'usp_log_change', 2, '@new_status', 'nvarchar'),
      ],
    );
    expect(paramsOf(objects, 'usp_log_change')).toStrictEqual([
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
    ]);
  });

  it('single-param proc and scalar functions pinned; parameter_id=0 return row EXCLUDED (MS-2)', () => {
    const objects = build(
      [mod(101, 'usp_refresh_totals', 'P'), mod(102, 'fn_net_amount', 'FN'), mod(103, 'fn_round_money', 'FN')],
      [
        param(101, 'usp_refresh_totals', 1, '@order_id', 'int'),
        // scalar functions expose a parameter_id=0 RETURN row (empty name) — MUST be excluded
        param(102, 'fn_net_amount', 0, '', 'decimal'),
        param(102, 'fn_net_amount', 1, '@gross', 'decimal'),
        param(103, 'fn_round_money', 0, '', 'decimal'),
        param(103, 'fn_round_money', 1, '@amount', 'decimal'),
      ],
    );
    expect(paramsOf(objects, 'usp_refresh_totals')).toStrictEqual([
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
    ]);
    // BARE decimal (never decimal(12,2)); the parameter_id=0 return row is gone.
    expect(paramsOf(objects, 'fn_net_amount')).toStrictEqual([
      { name: '@gross', dataType: 'decimal', direction: 'in', ordinal: 1 },
    ]);
    expect(paramsOf(objects, 'fn_round_money')).toStrictEqual([
      { name: '@amount', dataType: 'decimal', direction: 'in', ordinal: 1 },
    ]);
  });

  it('is_output→out (never inout) and has_default_value→hasDefault; unmarked params fabricate nothing', () => {
    const objects = build(
      [mod(105, 'usp_mixed', 'P')],
      [
        param(105, 'usp_mixed', 1, '@id', 'int', false, false),
        param(105, 'usp_mixed', 2, '@cnt', 'int', true, false),   // OUTPUT → out
        param(105, 'usp_mixed', 3, '@opt', 'int', false, true),   // has default → hasDefault
      ],
    );
    const params = paramsOf(objects, 'usp_mixed')!;
    expect(params).toStrictEqual([
      { name: '@id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: '@cnt', dataType: 'int', direction: 'out', ordinal: 2 },
      { name: '@opt', dataType: 'int', direction: 'in', ordinal: 3, hasDefault: true },
    ]);
    // NEGATIVES: never inout (sys.parameters has no INOUT), no fabricated hasDefault on @id/@cnt.
    expect(params.some((p) => p.direction === 'inout')).toBe(false);
    expect('hasDefault' in params[0]!).toBe(false);
    expect('hasDefault' in params[1]!).toBe(false);
  });

  it('a routine with no parameters carries an empty array (known-zero, not UNSET)', () => {
    const objects = build([mod(104, 'usp_noargs', 'P')], []);
    expect(paramsOf(objects, 'usp_noargs')).toStrictEqual([]);
  });

  it('ordinal is contiguous 1..N over EMITTED params after excluding the return row (D6)', () => {
    const objects = build(
      [mod(106, 'fn_calc', 'FN')],
      [
        param(106, 'fn_calc', 0, '', 'int'),      // return row excluded
        param(106, 'fn_calc', 1, '@a', 'int'),
        param(106, 'fn_calc', 2, '@b', 'int'),
      ],
    );
    expect(paramsOf(objects, 'fn_calc')!.map((p) => p.ordinal)).toStrictEqual([1, 2]);
  });
});
