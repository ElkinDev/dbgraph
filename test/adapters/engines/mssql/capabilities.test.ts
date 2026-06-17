/**
 * Tests for MSSQL_CAPABILITIES — the truthful CapabilityMatrix for SQL Server.
 * Design §CapabilityMatrix "CapabilityMatrix (truthful SQL Server)".
 * Story: mssql-extraction "Truthful SQL Server CapabilityMatrix" (US-027).
 * TDD RED → fails until src/adapters/engines/mssql/capabilities.ts is created.
 */

import { describe, it, expect } from 'vitest';
import { MSSQL_CAPABILITIES } from '../../../../src/adapters/engines/mssql/capabilities.js';
import { SQLITE_CAPABILITIES } from '../../../../src/adapters/engines/sqlite/capabilities.js';

// ─────────────────────────────────────────────────────────────────────────────
// Engine identity
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — engine identity', () => {
  it('engine identifier is mssql', () => {
    expect(MSSQL_CAPABILITIES.engine).toBe('mssql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Supported types — SQL Server CAN extract these
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — supported types', () => {
  it('declares schema as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('schema')).toBe(true);
  });

  it('declares table as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('table')).toBe(true);
  });

  it('declares column as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('column')).toBe(true);
  });

  it('declares constraint as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('constraint')).toBe(true);
  });

  it('declares index as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('index')).toBe(true);
  });

  it('declares view as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('view')).toBe(true);
  });

  it('declares trigger as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('trigger')).toBe(true);
  });

  it('declares procedure as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('procedure')).toBe(true);
  });

  it('declares function as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('function')).toBe(true);
  });

  it('declares sequence as supported', () => {
    expect(MSSQL_CAPABILITIES.supported.has('sequence')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported types — SQL Server has NO collection or field (MongoDB-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — unsupported types', () => {
  it('collection is NOT in supported set', () => {
    expect(MSSQL_CAPABILITIES.supported.has('collection')).toBe(false);
  });

  it('field is NOT in supported set', () => {
    expect(MSSQL_CAPABILITIES.supported.has('field')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Body and dependency hints flags
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — body and dependency flags', () => {
  it('supportsBodies is true (sys.sql_modules.definition available)', () => {
    expect(MSSQL_CAPABILITIES.supportsBodies).toBe(true);
  });

  it('supportsDependencyHints is true (sys.sql_expression_dependencies + tokenizer)', () => {
    expect(MSSQL_CAPABILITIES.supportsDependencyHints).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: matrix differs from SQLite on procedure/function/sequence
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — differs from SQLite on routines and sequences', () => {
  it('mssql reports procedure SUPPORTED while SQLite does NOT', () => {
    expect(MSSQL_CAPABILITIES.supported.has('procedure')).toBe(true);
    expect(SQLITE_CAPABILITIES.supported.has('procedure')).toBe(false);
  });

  it('mssql reports function SUPPORTED while SQLite does NOT', () => {
    expect(MSSQL_CAPABILITIES.supported.has('function')).toBe(true);
    expect(SQLITE_CAPABILITIES.supported.has('function')).toBe(false);
  });

  it('mssql reports sequence SUPPORTED while SQLite does NOT', () => {
    expect(MSSQL_CAPABILITIES.supported.has('sequence')).toBe(true);
    expect(SQLITE_CAPABILITIES.supported.has('sequence')).toBe(false);
  });

  it('mssql supportsDependencyHints is true while SQLite is false', () => {
    expect(MSSQL_CAPABILITIES.supportsDependencyHints).toBe(true);
    expect(SQLITE_CAPABILITIES.supportsDependencyHints).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultLevels present and valid
// ─────────────────────────────────────────────────────────────────────────────

describe('MSSQL_CAPABILITIES — defaultLevels present', () => {
  it('defaultLevels is an object', () => {
    expect(typeof MSSQL_CAPABILITIES.defaultLevels).toBe('object');
    expect(MSSQL_CAPABILITIES.defaultLevels).not.toBeNull();
  });

  it('defaultLevels.tables is a valid level string', () => {
    const validLevels = ['off', 'metadata', 'full'];
    expect(validLevels).toContain(MSSQL_CAPABILITIES.defaultLevels.tables);
  });
});
