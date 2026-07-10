/**
 * pg routine-parameter decode (dog2-routine-parameters, Batch 1 task 1.4).
 * Spec: pg-extraction "Decode routine parameters from pg_proc arrays" (PG-1..PG-4);
 *   schema-extraction SE-1. Design §4.2 D1/D5/D6 + §9 open-Q resolutions.
 *
 * DEDICATED map-unit fixtures — RoutineRow[] built INLINE with the new arg arrays, NOT the
 * golden-feeding rows/routines.json (which gains arg arrays only in Batch 2's re-bless), so
 * the committed aggregate goldens stay byte-identical.
 *
 * STRICT TDD, L-009 EXACT-set: .toStrictEqual the FULL RawParameter shape + negatives —
 * NULL proargmodes ⇒ ALL 'in' (never fabricated out/inout), 't' TABLE EXCLUDED, 'v' VARIADIC
 * → 'in', typmod-less dataType (numeric, never numeric(10,2)), trailing pronargdefaults only.
 */

import { describe, it, expect } from 'vitest';
import { buildPgRawCatalog } from '../../../../src/adapters/engines/pg/map.js';
import type { PgRowInput, RoutineRow } from '../../../../src/adapters/engines/pg/map.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawObject, RawParameter } from '../../../../src/core/model/catalog.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full', columns: 'full', constraints: 'full', indexes: 'full', views: 'full',
    procedures: 'full', functions: 'full', triggers: 'full', sequences: 'full',
    collections: 'off', fields: 'off', statistics: 'off', sampling: 'off',
  },
};

type ArgFields = Pick<RoutineRow, 'arg_names' | 'arg_modes' | 'arg_type_names' | 'num_defaults'>;

function routine(name: string, args?: ArgFields): RoutineRow {
  return {
    schema_name: 'app',
    routine_name: name,
    routine_kind: 'f',
    routine_def: null,
    comment: null,
    ...(args ?? {}),
  };
}

function build(routines: RoutineRow[]): readonly RawObject[] {
  const input: PgRowInput = {
    schemas: [], tables: [], columns: [], columnNames: [], constraints: [], indexes: [],
    views: [], routines, triggers: [], sequences: [],
  };
  return buildPgRawCatalog(input, FULL_SCOPE).objects;
}

function paramsOf(objects: readonly RawObject[], name: string): readonly RawParameter[] | undefined {
  const o = objects.find((x) => x.name === name);
  expect(o).toBeDefined();
  return o!.parameters;
}

describe('pg parameter decode — pg_proc arrays → RawObject.parameters (PG-1..PG-4, D1/D5/D6)', () => {
  it('zero-argument routines carry parameters:[] — real empty, NOT unset, no fabrication (PG-1)', () => {
    const objects = build([
      routine('fn_wrapper', { arg_names: null, arg_modes: null, arg_type_names: [], num_defaults: 0 }),
      routine('fn_inner', { arg_names: null, arg_modes: null, arg_type_names: [], num_defaults: 0 }),
    ]);
    expect(paramsOf(objects, 'fn_wrapper')).toStrictEqual([]);
    expect(paramsOf(objects, 'fn_inner')).toStrictEqual([]);
  });

  it('NULL proargmodes ⇒ ALL four params in, dataType integer, ordinals 1..4 (PG-2)', () => {
    const objects = build([
      routine('fn_place_order', {
        arg_names: ['p_order_id', 'p_customer_id', 'p_product_id', 'p_qty'],
        arg_modes: null, // NULL modes ⇒ all IN
        arg_type_names: ['integer', 'integer', 'integer', 'integer'],
        num_defaults: 0,
      }),
    ]);
    const params = paramsOf(objects, 'fn_place_order')!;
    expect(params).toStrictEqual([
      { name: 'p_order_id', dataType: 'integer', direction: 'in', ordinal: 1 },
      { name: 'p_customer_id', dataType: 'integer', direction: 'in', ordinal: 2 },
      { name: 'p_product_id', dataType: 'integer', direction: 'in', ordinal: 3 },
      { name: 'p_qty', dataType: 'integer', direction: 'in', ordinal: 4 },
    ]);
    // NEGATIVE: NULL modes NEVER fabricates out/inout.
    expect(params.some((p) => p.direction !== 'in')).toBe(false);
  });

  it('modes i/o/b decode to in/out/inout exactly', () => {
    const objects = build([
      routine('fn_modes', {
        arg_names: ['a', 'b', 'c'],
        arg_modes: ['i', 'o', 'b'],
        arg_type_names: ['integer', 'integer', 'integer'],
        num_defaults: 0,
      }),
    ]);
    expect(paramsOf(objects, 'fn_modes')).toStrictEqual([
      { name: 'a', dataType: 'integer', direction: 'in', ordinal: 1 },
      { name: 'b', dataType: 'integer', direction: 'out', ordinal: 2 },
      { name: 'c', dataType: 'integer', direction: 'inout', ordinal: 3 },
    ]);
  });

  it('VARIADIC v → in; RETURNS TABLE t EXCLUDED; ordinal contiguous after exclusion (PG-3, D6)', () => {
    const objects = build([
      routine('fn_variadic', {
        arg_names: ['items', 'result_col'],
        arg_modes: ['v', 't'], // v VARIADIC → in; t TABLE → excluded
        arg_type_names: ['integer', 'text'],
        num_defaults: 0,
      }),
    ]);
    const params = paramsOf(objects, 'fn_variadic')!;
    // Only the VARIADIC input survives; the t-mode result column is gone; ordinal stays 1..N.
    expect(params).toStrictEqual([
      { name: 'items', dataType: 'integer', direction: 'in', ordinal: 1 },
    ]);
    expect(params.some((p) => p.name === 'result_col')).toBe(false);
  });

  it('typmod-less dataType — numeric argument NEVER gains fabricated precision (PG-4)', () => {
    const objects = build([
      routine('fn_amount', {
        arg_names: ['amt'],
        arg_modes: null,
        arg_type_names: ['numeric'], // regtype decode is typmod-less; precision physically absent
        num_defaults: 0,
      }),
    ]);
    expect(paramsOf(objects, 'fn_amount')).toStrictEqual([
      { name: 'amt', dataType: 'numeric', direction: 'in', ordinal: 1 },
    ]);
  });

  it('hasDefault marks ONLY the trailing pronargdefaults input args (honesty, no over-claim)', () => {
    const objects = build([
      routine('fn_defaults', {
        arg_names: ['required', 'optional'],
        arg_modes: null,
        arg_type_names: ['integer', 'integer'],
        num_defaults: 1, // only the trailing 1 input arg has a default
      }),
    ]);
    const params = paramsOf(objects, 'fn_defaults')!;
    expect(params).toStrictEqual([
      { name: 'required', dataType: 'integer', direction: 'in', ordinal: 1 },
      { name: 'optional', dataType: 'integer', direction: 'in', ordinal: 2, hasDefault: true },
    ]);
    // NEGATIVE: the leading (non-defaulted) arg must NOT gain hasDefault.
    expect('hasDefault' in params[0]!).toBe(false);
  });

  it('a routine row WITHOUT arg arrays leaves parameters UNSET (backward-compat bridge)', () => {
    const objects = build([routine('fn_legacy')]); // no arg fields at all
    const o = objects.find((x) => x.name === 'fn_legacy');
    expect(o).toBeDefined();
    expect(o!.parameters).toBeUndefined();
    expect('parameters' in o!).toBe(false);
  });
});
