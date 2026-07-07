/**
 * Tests for the routine-parameter model contract (dog2-routine-parameters, Batch 1 task 1.1).
 * Spec: graph-model "Routine parameters payload contract" (GM-1/GM-2/GM-3).
 * Design §3.1 D2 — RoutineParameter accessor view (node.ts) mirrors RawParameter durable
 *   adapter→core contract (catalog.ts); same shape, ordinal-ordered, honest-optional hasDefault.
 *
 * STRICT TDD: the shape is asserted EXACTLY (.toStrictEqual) and compiles under strict TS with
 *   exactOptionalPropertyTypes (hasDefault OMITTED, never `false`; parameters UNSET, never `[]`).
 *   RED is the tsc failure before the two types exist; GREEN is tsc clean + these runtime pins.
 */

import { describe, it, expect } from 'vitest';
import type {
  RoutineParameter,
  RoutinePayload,
  GraphNode,
} from '../../../src/core/model/node.js';
import type { RawParameter, RawObject } from '../../../src/core/model/catalog.js';

describe('RoutineParameter / RawParameter model contract (GM-1/GM-2/GM-3, D2)', () => {
  it('RoutineParameter carries name, dataType, direction and ordinal (GM-1)', () => {
    const p: RoutineParameter = {
      name: '@order_id',
      dataType: 'int',
      direction: 'in',
      ordinal: 1,
    };
    // Exact-set: exactly these four keys, no fabricated hasDefault (exactOptionalPropertyTypes).
    expect(p).toStrictEqual({
      name: '@order_id',
      dataType: 'int',
      direction: 'in',
      ordinal: 1,
    });
    expect('hasDefault' in p).toBe(false);
  });

  it('direction is exactly the three-member union in/out/inout', () => {
    const directions: RoutineParameter['direction'][] = ['in', 'out', 'inout'];
    const params: RoutineParameter[] = directions.map((direction, i) => ({
      name: `p${i}`,
      dataType: 'int',
      direction,
      ordinal: i + 1,
    }));
    expect(params.map((p) => p.direction)).toStrictEqual(['in', 'out', 'inout']);
  });

  it('hasDefault is OPTIONAL — present only when a real catalog flag sources it (GM-3)', () => {
    const withDefault: RoutineParameter = {
      name: '@amount',
      dataType: 'decimal',
      direction: 'in',
      ordinal: 1,
      hasDefault: true,
    };
    expect(withDefault.hasDefault).toBe(true);

    // A parameter with no catalog default flag OMITS the field (never `hasDefault: false`).
    const withoutDefault: RoutineParameter = {
      name: '@amount',
      dataType: 'decimal',
      direction: 'in',
      ordinal: 1,
    };
    expect('hasDefault' in withoutDefault).toBe(false);
  });

  it('RoutinePayload.parameters is an OPTIONAL readonly RoutineParameter[] (GM-1)', () => {
    const payload: RoutinePayload = {
      hasDynamicSql: false,
      parameters: [
        { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
        { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
      ],
    };
    expect(payload.parameters).toStrictEqual([
      { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
      { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
    ]);
  });

  it('RoutinePayload.parameters is UNSET (undefined), never [] for a no-catalog routine (GM-2)', () => {
    const payload: RoutinePayload = { hasDynamicSql: false };
    expect(payload.parameters).toBeUndefined();
    expect('parameters' in payload).toBe(false);
  });

  it('a routine payload round-trips through GraphNode.payload preserving ordinal order', () => {
    const node: GraphNode = {
      id: 'node-procedure-usp_log_change',
      kind: 'procedure',
      schema: 'dbo',
      name: 'usp_log_change',
      qname: 'dbo.usp_log_change',
      level: 'metadata',
      missing: false,
      excluded: false,
      bodyHash: null,
      payload: {
        hasDynamicSql: false,
        parameters: [
          { name: '@order_id', dataType: 'int', direction: 'in', ordinal: 1 },
          { name: '@new_status', dataType: 'nvarchar', direction: 'in', ordinal: 2 },
        ],
      } satisfies RoutinePayload,
    };
    const params = node.payload['parameters'] as readonly RoutineParameter[];
    expect(params.map((p) => p.ordinal)).toStrictEqual([1, 2]);
    expect(params[0]!.name).toBe('@order_id');
  });

  it('RawParameter mirrors RoutineParameter and RawObject.parameters is OPTIONAL (D2)', () => {
    const raw: RawParameter = {
      name: 'p_order_id',
      dataType: 'integer',
      direction: 'in',
      ordinal: 1,
    };
    const obj: RawObject = {
      kind: 'function',
      schema: 'app',
      name: 'fn_place_order',
      parameters: [raw],
    };
    expect(obj.parameters).toStrictEqual([
      { name: 'p_order_id', dataType: 'integer', direction: 'in', ordinal: 1 },
    ]);

    // An engine with no parameter catalog leaves the field UNSET (honest absence, GM-2).
    const noCatalog: RawObject = { kind: 'procedure', schema: 'main', name: 'x' };
    expect(noCatalog.parameters).toBeUndefined();
    expect('parameters' in noCatalog).toBe(false);
  });
});
