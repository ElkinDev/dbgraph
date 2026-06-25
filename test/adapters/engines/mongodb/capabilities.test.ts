/**
 * Tests for MONGODB_CAPABILITIES — the truthful CapabilityMatrix for MongoDB.
 * Design §CapabilityMatrix "Truthful MongoDB CapabilityMatrix".
 *
 * MongoDB supports: collection, field, index ONLY.
 * MongoDB does NOT support: table, column, constraint, view, procedure,
 *   function, trigger, sequence (SQL-only concepts).
 *
 * supportsBodies: false  — MongoDB has no procedure/view body to retrieve.
 * supportsDependencyHints: false — body tokenizer is the SOLE edge source.
 *
 * TDD RED → GREEN.
 * Spec: "Matrix declares collection/field/index supported and the SQL types
 * unsupported; Matrix reports supportsBodies false and supportsDependencyHints false."
 * US-030 (MongoDB adapter), phase-9b-mongodb Batch 2 task 2.1.
 */

import { describe, it, expect } from 'vitest';
import { MONGODB_CAPABILITIES } from '../../../../src/adapters/engines/mongodb/capabilities.js';

// ─────────────────────────────────────────────────────────────────────────────
// Engine identity
// ─────────────────────────────────────────────────────────────────────────────

describe('MONGODB_CAPABILITIES — engine identity', () => {
  it('engine identifier is mongodb', () => {
    expect(MONGODB_CAPABILITIES.engine).toBe('mongodb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Supported types — MongoDB CAN extract these
// Spec: Matrix declares collection/field/index supported
// ─────────────────────────────────────────────────────────────────────────────

describe('MONGODB_CAPABILITIES — supported types', () => {
  it('declares collection as supported', () => {
    expect(MONGODB_CAPABILITIES.supported.has('collection')).toBe(true);
  });

  it('declares field as supported', () => {
    expect(MONGODB_CAPABILITIES.supported.has('field')).toBe(true);
  });

  it('declares index as supported', () => {
    expect(MONGODB_CAPABILITIES.supported.has('index')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported types — SQL-only concepts absent from MongoDB
// Spec: Matrix declares the SQL types unsupported
// ─────────────────────────────────────────────────────────────────────────────

describe('MONGODB_CAPABILITIES — unsupported SQL types', () => {
  it('table is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('table')).toBe(false);
  });

  it('column is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('column')).toBe(false);
  });

  it('constraint is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('constraint')).toBe(false);
  });

  it('view is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('view')).toBe(false);
  });

  it('procedure is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('procedure')).toBe(false);
  });

  it('function is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('function')).toBe(false);
  });

  it('trigger is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('trigger')).toBe(false);
  });

  it('sequence is NOT in the supported set', () => {
    expect(MONGODB_CAPABILITIES.supported.has('sequence')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Body and dependency hints flags
// Spec: Matrix reports supportsBodies false and supportsDependencyHints false
// ─────────────────────────────────────────────────────────────────────────────

describe('MONGODB_CAPABILITIES — body and dependency flags', () => {
  it('supportsBodies is false (MongoDB has no procedure/view body retrieval)', () => {
    expect(MONGODB_CAPABILITIES.supportsBodies).toBe(false);
  });

  it('supportsDependencyHints is false (body tokenizer is sole edge source)', () => {
    expect(MONGODB_CAPABILITIES.supportsDependencyHints).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultLevels present and valid
// ─────────────────────────────────────────────────────────────────────────────

describe('MONGODB_CAPABILITIES — defaultLevels present', () => {
  it('defaultLevels is an object', () => {
    expect(typeof MONGODB_CAPABILITIES.defaultLevels).toBe('object');
    expect(MONGODB_CAPABILITIES.defaultLevels).not.toBeNull();
  });

  it('defaultLevels.collections is a valid level string', () => {
    const validLevels = ['off', 'metadata', 'full'];
    expect(validLevels).toContain(MONGODB_CAPABILITIES.defaultLevels.collections);
  });

  it('defaultLevels.fields is a valid level string', () => {
    const validLevels = ['off', 'metadata', 'full'];
    expect(validLevels).toContain(MONGODB_CAPABILITIES.defaultLevels.fields);
  });
});
