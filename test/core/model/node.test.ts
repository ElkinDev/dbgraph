/**
 * Tests for FieldPayload (Batch 1, task 1.2 — phase-9b-mongodb).
 * TDD: RED phase written first; code in node.ts makes it GREEN.
 * Spec: "'field' node is consumable by inferReferences exactly as a 'column' node".
 * The NodeKind 'field', levels.fields, and getLevelForKind('field') ALREADY exist.
 * Only FieldPayload is missing.
 */

import { describe, it, expect } from 'vitest';
import type { FieldPayload, ColumnPayload, GraphNode, NodePayload } from '../../../src/core/model/node.js';

// ─────────────────────────────────────────────────────────────────────────────
// FieldPayload — shape guard
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldPayload', () => {
  it('can be constructed with required fields (dataType, frequency)', () => {
    const payload: FieldPayload = {
      dataType: 'objectId',
      frequency: 1.0,
    };
    expect(payload.dataType).toBe('objectId');
    expect(payload.frequency).toBe(1.0);
    expect(payload.nullable).toBeUndefined();
  });

  it('dataType is a string (union form like int|string — same contract as ColumnPayload)', () => {
    const payload: FieldPayload = {
      dataType: 'int|string',
      frequency: 0.87,
    };
    expect(typeof payload.dataType).toBe('string');
    expect(payload.dataType).toBe('int|string');
  });

  it('can be constructed with optional nullable', () => {
    const payload: FieldPayload = {
      dataType: 'string',
      frequency: 1.0,
      nullable: false,
    };
    expect(payload.nullable).toBe(false);
  });

  it('nullable is optional (may be absent)', () => {
    const payload: FieldPayload = {
      dataType: 'date',
      frequency: 0.5,
    };
    expect('nullable' in payload).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inferReferences compatibility — a 'field' node must be consumable by
// inferReferences exactly as a 'column' node (reads payload.dataType as string).
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldPayload — inferReferences compatibility with ColumnPayload', () => {
  /**
   * inferReferences reads payload.dataType as a string from both column and field nodes.
   * This test verifies that FieldPayload satisfies the same structural contract.
   * Design: "a 'field' node is consumable by inferReferences identically to a 'column' node".
   */
  it('FieldPayload.dataType is a string — same structural contract as ColumnPayload.dataType', () => {
    const colPayload: ColumnPayload = {
      dataType: 'int',
      nullable: false,
      ordinal: 1,
    };
    const fieldPayload: FieldPayload = {
      dataType: 'int',
      frequency: 1.0,
    };
    // Both expose dataType as a string
    expect(typeof colPayload.dataType).toBe('string');
    expect(typeof fieldPayload.dataType).toBe('string');
    expect(colPayload.dataType).toBe(fieldPayload.dataType);
  });

  it('a GraphNode of kind field with FieldPayload carries dataType consumable by inference', () => {
    // Simulate what inferReferences does: read payload.dataType from a field node
    const fieldNode: GraphNode = {
      id: 'field:orders.customer_id',
      kind: 'field',
      schema: 'mydb',
      name: 'customer_id',
      qname: 'orders.customer_id',
      level: 'metadata',
      missing: false,
      excluded: false,
      bodyHash: null,
      payload: {
        dataType: 'objectId',
        frequency: 1.0,
      } satisfies FieldPayload as NodePayload,
    };

    // inferReferences reads: (node.payload as Partial<ColumnPayload>).dataType
    const payload = fieldNode.payload as Partial<FieldPayload>;
    expect(typeof payload.dataType).toBe('string');
    expect(payload.dataType).toBe('objectId');
  });
});
