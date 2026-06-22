/**
 * Tests for RawField + RawObject.fields? (Batch 1, task 1.1 — phase-9b-mongodb).
 * TDD: RED phase written first; code in catalog.ts makes it GREEN.
 * Spec: "Optional RawField model path for schemaless field structure".
 * ADR-008: determinism; ADR-004: no adapter imports.
 */

import { describe, it, expect } from 'vitest';
import type { RawField, RawObject, RawCatalog } from '../../../src/core/model/catalog.js';

// ─────────────────────────────────────────────────────────────────────────────
// RawField — shape guard
// ─────────────────────────────────────────────────────────────────────────────

describe('RawField', () => {
  it('can be constructed with required fields only', () => {
    const field: RawField = {
      name: 'customer_id',
      dataType: 'objectId',
      frequency: 1.0,
    };
    expect(field.name).toBe('customer_id');
    expect(field.dataType).toBe('objectId');
    expect(field.frequency).toBe(1.0);
    expect(field.nullable).toBeUndefined();
  });

  it('dataType is typed as string (union form like int|string — NOT a types[] array)', () => {
    const field: RawField = {
      name: 'mixed_field',
      dataType: 'int|string',
      frequency: 0.87,
    };
    // EXACT type assertion: must be a string, not an array
    expect(typeof field.dataType).toBe('string');
    expect(field.dataType).toBe('int|string');
  });

  it('can be constructed with optional nullable', () => {
    const field: RawField = {
      name: 'email',
      dataType: 'string',
      frequency: 1.0,
      nullable: true,
    };
    expect(field.nullable).toBe(true);
  });

  it('nullable is optional (may be absent)', () => {
    const field: RawField = {
      name: 'address',
      dataType: 'object',
      frequency: 0.5,
    };
    expect('nullable' in field).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RawObject.fields? — shape guard for kind:'collection'
// ─────────────────────────────────────────────────────────────────────────────

describe('RawObject fields property', () => {
  it('RawObject of kind collection accepts fields', () => {
    const obj: RawObject = {
      kind: 'collection',
      schema: 'mydb',
      name: 'orders',
      fields: [
        { name: 'customer_id', dataType: 'objectId', frequency: 1.0 },
        { name: 'amount', dataType: 'numeric', frequency: 1.0 },
      ],
    };
    expect(obj.fields).toHaveLength(2);
    expect(obj.fields?.[0]?.name).toBe('customer_id');
    expect(obj.fields?.[1]?.name).toBe('amount');
  });

  it('RawObject without fields (SQL engines) leaves fields undefined', () => {
    const obj: RawObject = {
      kind: 'table',
      schema: 'dbo',
      name: 'orders',
      columns: [
        { name: 'id', dataType: 'int', nullable: false, ordinal: 1 },
      ],
    };
    expect(obj.fields).toBeUndefined();
  });

  it('fields is readonly (type-level — verified by constructing with as const)', () => {
    const fields = [
      { name: 'path', dataType: 'string', frequency: 0.9 },
    ] as const satisfies readonly RawField[];
    const obj: RawObject = {
      kind: 'collection',
      schema: 'db',
      name: 'events',
      fields,
    };
    expect(obj.fields).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RawCatalog with fields — integration shape guard
// ─────────────────────────────────────────────────────────────────────────────

describe('RawCatalog with collection + fields', () => {
  it('can be constructed with a collection object carrying RawField entries', () => {
    const catalog: RawCatalog = {
      engine: 'mongodb',
      schemas: ['mydb'],
      objects: [
        {
          kind: 'collection',
          schema: 'mydb',
          name: 'customers',
          fields: [
            { name: '_id', dataType: 'objectId', frequency: 1.0 },
            { name: 'email', dataType: 'string', frequency: 1.0 },
            { name: 'score', dataType: 'int|numeric', frequency: 0.5, nullable: true },
          ],
        },
      ],
    };
    const col = catalog.objects[0];
    expect(col?.kind).toBe('collection');
    expect(col?.fields).toHaveLength(3);
    // dataType is a STRING, not an array — EXACT type check
    expect(typeof col?.fields?.[2]?.dataType).toBe('string');
    expect(col?.fields?.[2]?.dataType).toBe('int|numeric');
  });
});
