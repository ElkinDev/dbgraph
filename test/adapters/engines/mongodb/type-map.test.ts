/**
 * Tests for BSON→dataType mapping and mergeDataTypes.
 * Spec: "A field with mixed BSON types carries the union of those types";
 *       "The pinned BSON→dataType table".
 *
 * TDD RED → GREEN.
 * Batch 4, task 4.1.
 * US-030, ADR-008 (determinism: sorted union).
 */

import { describe, it, expect } from 'vitest';
import { bsonToDataType, mergeDataTypes } from '../../../../src/adapters/engines/mongodb/type-map.js';

// ─────────────────────────────────────────────────────────────────────────────
// bsonToDataType — PINNED BSON→dataType table
// ─────────────────────────────────────────────────────────────────────────────

describe('bsonToDataType — BSON value → dataType string (PINNED)', () => {
  // objectId
  it('maps a MongoDB ObjectId (has _bsontype:ObjectId) to objectId', () => {
    const val = { _bsontype: 'ObjectId', id: Buffer.alloc(12) };
    expect(bsonToDataType(val)).toBe('objectId');
  });

  it('maps a plain object with _bsontype ObjectID (legacy) to objectId', () => {
    const val = { _bsontype: 'ObjectID' };
    expect(bsonToDataType(val)).toBe('objectId');
  });

  // int — Int32
  it('maps a MongoDB Int32 (_bsontype:Int32) to int', () => {
    const val = { _bsontype: 'Int32', value: 42 };
    expect(bsonToDataType(val)).toBe('int');
  });

  // long — Int64
  it('maps a MongoDB Long (_bsontype:Long) to int', () => {
    const val = { _bsontype: 'Long', low: 1, high: 0 };
    expect(bsonToDataType(val)).toBe('int');
  });

  // double — JS number (mongo driver maps double to plain JS number)
  it('maps a JavaScript number (double) to numeric', () => {
    expect(bsonToDataType(3.14)).toBe('numeric');
  });

  it('maps a JavaScript integer-valued number to numeric (driver gives us JS numbers for doubles)', () => {
    // JS numbers are mongo doubles unless wrapped in Int32/Long
    expect(bsonToDataType(0)).toBe('numeric');
  });

  // Decimal128
  it('maps a MongoDB Decimal128 (_bsontype:Decimal128) to numeric', () => {
    const val = { _bsontype: 'Decimal128', bytes: Buffer.alloc(16) };
    expect(bsonToDataType(val)).toBe('numeric');
  });

  // string
  it('maps a string to string', () => {
    expect(bsonToDataType('hello')).toBe('string');
  });

  // bool
  it('maps true to bool', () => {
    expect(bsonToDataType(true)).toBe('bool');
  });

  it('maps false to bool', () => {
    expect(bsonToDataType(false)).toBe('bool');
  });

  // date
  it('maps a JavaScript Date to date', () => {
    expect(bsonToDataType(new Date())).toBe('date');
  });

  // null
  it('maps null to null', () => {
    expect(bsonToDataType(null)).toBe('null');
  });

  // array — recurse element type
  it('maps an empty array to unknown[] (no element to detect type from)', () => {
    expect(bsonToDataType([])).toBe('unknown[]');
  });

  it('maps an array of strings to string[]', () => {
    expect(bsonToDataType(['a', 'b'])).toBe('string[]');
  });

  it('maps an array of numbers to numeric[]', () => {
    expect(bsonToDataType([1.1, 2.2])).toBe('numeric[]');
  });

  it('maps an array of subdocuments to object[]', () => {
    expect(bsonToDataType([{ x: 1 }, { y: 2 }])).toBe('object[]');
  });

  it('maps an array of Int32 to int[]', () => {
    const val = [{ _bsontype: 'Int32', value: 1 }, { _bsontype: 'Int32', value: 2 }];
    expect(bsonToDataType(val)).toBe('int[]');
  });

  // object — returns 'object' (nested handled by dotted-path recursion in the walk)
  it('maps a plain object (subdocument) to object', () => {
    expect(bsonToDataType({ a: 1 })).toBe('object');
  });

  // unknown BSON — NO throw
  it('maps an undefined value to unknown (no throw)', () => {
    expect(bsonToDataType(undefined)).toBe('unknown');
  });

  it('maps a Symbol to unknown (no throw)', () => {
    expect(bsonToDataType(Symbol('x'))).toBe('unknown');
  });

  it('maps a BigInt to unknown (no throw)', () => {
    expect(bsonToDataType(BigInt(1))).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeDataTypes — sorted union join
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeDataTypes — sorted union string', () => {
  it('returns a single type unchanged', () => {
    expect(mergeDataTypes(new Set(['string']))).toBe('string');
  });

  it('returns two types joined in sorted order (int|string, not string|int)', () => {
    expect(mergeDataTypes(new Set(['string', 'int']))).toBe('int|string');
  });

  it('returns three types sorted alphabetically', () => {
    expect(mergeDataTypes(new Set(['string', 'numeric', 'bool']))).toBe('bool|numeric|string');
  });

  it('returns null and string sorted: null|string', () => {
    expect(mergeDataTypes(new Set(['string', 'null']))).toBe('null|string');
  });

  it('returns int and null sorted: int|null', () => {
    expect(mergeDataTypes(new Set(['null', 'int']))).toBe('int|null');
  });

  it('handles an empty set by returning unknown', () => {
    expect(mergeDataTypes(new Set())).toBe('unknown');
  });

  it('sort is STABLE for known union: int|string (alphabetical: i < s)', () => {
    // Confirm the exact pinned form — design §type-map.ts
    expect(mergeDataTypes(new Set(['int', 'string']))).toBe('int|string');
  });
});
