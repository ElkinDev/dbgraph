/**
 * Tests for MYSQL_CAPABILITIES — the truthful CapabilityMatrix for MySQL.
 * Design §MYSQL_CAPABILITIES.
 *
 * MySQL supports: table, column, constraint, index, view, procedure, function, trigger.
 * MySQL does NOT support: sequence (AUTO_INCREMENT is a column attr, not a sequence object).
 * MySQL does NOT expose a standalone schema kind (schema == database, not a separate object).
 *
 * supportsBodies: true  — VIEW_DEFINITION + ROUTINE_DEFINITION provide bodies.
 * supportsDependencyHints: false — body tokenizer is the SOLE edge source;
 *   MySQL has no information_schema dependency view.
 *
 * TDD RED -> GREEN.
 * Spec: "Truthful MySQL CapabilityMatrix" (US-029, mysql-extraction spec).
 * Task 2.1: MYSQL_CAPABILITIES declaration.
 */

import { describe, it, expect } from 'vitest';
import { MYSQL_CAPABILITIES } from '../../../../src/adapters/engines/mysql/capabilities.js';

// ─────────────────────────────────────────────────────────────────────────────
// Engine identity
// ─────────────────────────────────────────────────────────────────────────────

describe('MYSQL_CAPABILITIES — engine identity', () => {
  it('engine identifier is mysql', () => {
    expect(MYSQL_CAPABILITIES.engine).toBe('mysql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Supported types — MySQL CAN extract these
// Spec: Matrix declares the supported object types
// ─────────────────────────────────────────────────────────────────────────────

describe('MYSQL_CAPABILITIES — supported types', () => {
  it('declares table as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('table')).toBe(true);
  });

  it('declares column as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('column')).toBe(true);
  });

  it('declares constraint as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('constraint')).toBe(true);
  });

  it('declares index as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('index')).toBe(true);
  });

  it('declares view as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('view')).toBe(true);
  });

  it('declares procedure as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('procedure')).toBe(true);
  });

  it('declares function as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('function')).toBe(true);
  });

  it('declares trigger as supported', () => {
    expect(MYSQL_CAPABILITIES.supported.has('trigger')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported types — explicitly excluded
// Spec: Matrix reports no sequence and no standalone schema kind
// ─────────────────────────────────────────────────────────────────────────────

describe('MYSQL_CAPABILITIES — unsupported types', () => {
  it('sequence is NOT in the supported set (AUTO_INCREMENT is a column attr)', () => {
    expect(MYSQL_CAPABILITIES.supported.has('sequence')).toBe(false);
  });

  it('schema is NOT in the supported set (connected database IS the namespace)', () => {
    expect(MYSQL_CAPABILITIES.supported.has('schema')).toBe(false);
  });

  it('collection is NOT in the supported set (MongoDB-only)', () => {
    expect(MYSQL_CAPABILITIES.supported.has('collection')).toBe(false);
  });

  it('field is NOT in the supported set (MongoDB-only)', () => {
    expect(MYSQL_CAPABILITIES.supported.has('field')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Body and dependency hints flags
// Spec: Matrix reports supportsBodies true and supportsDependencyHints false
// ─────────────────────────────────────────────────────────────────────────────

describe('MYSQL_CAPABILITIES — body and dependency flags', () => {
  it('supportsBodies is true (VIEW_DEFINITION + ROUTINE_DEFINITION available)', () => {
    expect(MYSQL_CAPABILITIES.supportsBodies).toBe(true);
  });

  it('supportsDependencyHints is false (no MySQL dependency view; body tokenizer is sole edge source)', () => {
    expect(MYSQL_CAPABILITIES.supportsDependencyHints).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultLevels present and valid (reuses DEFAULT_LEVELS)
// ─────────────────────────────────────────────────────────────────────────────

describe('MYSQL_CAPABILITIES — defaultLevels present', () => {
  it('defaultLevels is an object', () => {
    expect(typeof MYSQL_CAPABILITIES.defaultLevels).toBe('object');
    expect(MYSQL_CAPABILITIES.defaultLevels).not.toBeNull();
  });

  it('defaultLevels.tables is a valid level string', () => {
    const validLevels = ['off', 'metadata', 'full'];
    expect(validLevels).toContain(MYSQL_CAPABILITIES.defaultLevels.tables);
  });
});
