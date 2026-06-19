/**
 * Tests for PG_CAPABILITIES — the truthful CapabilityMatrix for PostgreSQL.
 * Design §CapabilityMatrix "Truthful PostgreSQL CapabilityMatrix".
 *
 * PG supports: schema, table, column, constraint, index, view,
 *   procedure, function, trigger, sequence.
 * PG does NOT support: collection, field (MongoDB-only concepts).
 *
 * supportsBodies: true  — pg_get_functiondef/pg_get_viewdef provide bodies.
 * supportsDependencyHints: false — body tokenizer is the SOLE edge source (Phase-8a);
 *   pg_depend OID-graph is deferred.
 *
 * TDD RED → GREEN.
 * Spec: "Truthful PostgreSQL CapabilityMatrix" (US-028, pg-extraction spec).
 */

import { describe, it, expect } from 'vitest';
import { PG_CAPABILITIES } from '../../../../src/adapters/engines/pg/capabilities.js';

// ─────────────────────────────────────────────────────────────────────────────
// Engine identity
// ─────────────────────────────────────────────────────────────────────────────

describe('PG_CAPABILITIES — engine identity', () => {
  it('engine identifier is pg', () => {
    expect(PG_CAPABILITIES.engine).toBe('pg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Supported types — PG CAN extract these
// ─────────────────────────────────────────────────────────────────────────────

describe('PG_CAPABILITIES — supported types', () => {
  it('declares schema as supported', () => {
    expect(PG_CAPABILITIES.supported.has('schema')).toBe(true);
  });

  it('declares table as supported', () => {
    expect(PG_CAPABILITIES.supported.has('table')).toBe(true);
  });

  it('declares column as supported', () => {
    expect(PG_CAPABILITIES.supported.has('column')).toBe(true);
  });

  it('declares constraint as supported', () => {
    expect(PG_CAPABILITIES.supported.has('constraint')).toBe(true);
  });

  it('declares index as supported', () => {
    expect(PG_CAPABILITIES.supported.has('index')).toBe(true);
  });

  it('declares view as supported', () => {
    expect(PG_CAPABILITIES.supported.has('view')).toBe(true);
  });

  it('declares procedure as supported', () => {
    expect(PG_CAPABILITIES.supported.has('procedure')).toBe(true);
  });

  it('declares function as supported', () => {
    expect(PG_CAPABILITIES.supported.has('function')).toBe(true);
  });

  it('declares trigger as supported', () => {
    expect(PG_CAPABILITIES.supported.has('trigger')).toBe(true);
  });

  it('declares sequence as supported', () => {
    expect(PG_CAPABILITIES.supported.has('sequence')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported types — PG has no collection or field (MongoDB-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('PG_CAPABILITIES — unsupported types', () => {
  it('collection is NOT in the supported set', () => {
    expect(PG_CAPABILITIES.supported.has('collection')).toBe(false);
  });

  it('field is NOT in the supported set', () => {
    expect(PG_CAPABILITIES.supported.has('field')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Body and dependency hints flags
// Spec: Matrix reports supportsBodies true and supportsDependencyHints false
// ─────────────────────────────────────────────────────────────────────────────

describe('PG_CAPABILITIES — body and dependency flags', () => {
  it('supportsBodies is true (pg_get_functiondef/pg_get_viewdef available)', () => {
    expect(PG_CAPABILITIES.supportsBodies).toBe(true);
  });

  it('supportsDependencyHints is false (pg_depend deferred; body tokenizer is sole edge source)', () => {
    expect(PG_CAPABILITIES.supportsDependencyHints).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultLevels present and valid
// ─────────────────────────────────────────────────────────────────────────────

describe('PG_CAPABILITIES — defaultLevels present', () => {
  it('defaultLevels is an object', () => {
    expect(typeof PG_CAPABILITIES.defaultLevels).toBe('object');
    expect(PG_CAPABILITIES.defaultLevels).not.toBeNull();
  });

  it('defaultLevels.tables is a valid level string', () => {
    const validLevels = ['off', 'metadata', 'full'];
    expect(validLevels).toContain(PG_CAPABILITIES.defaultLevels.tables);
  });
});
