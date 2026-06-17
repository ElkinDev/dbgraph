/**
 * Tests for capabilitiesFor(dialect) — task 1.3 (phase-4-cli-config).
 * Spec: "Interactive init is capability-driven" — wizard reads matrix without
 * connecting or importing adapters. Design Decision 6.
 * TDD: RED → GREEN — write tests first, then implement.
 */

import { describe, it, expect } from 'vitest';
import { capabilitiesFor, UnsupportedDialectError } from '../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Known dialects
// ─────────────────────────────────────────────────────────────────────────────

describe('capabilitiesFor — sqlite', () => {
  it('returns a CapabilityMatrix for sqlite', () => {
    const matrix = capabilitiesFor('sqlite');
    expect(matrix).toBeDefined();
    expect(typeof matrix).toBe('object');
  });

  it('engine is sqlite', () => {
    const matrix = capabilitiesFor('sqlite');
    expect(matrix.engine).toBe('sqlite');
  });

  it('supported does not include procedure (sqlite has no procedures)', () => {
    const matrix = capabilitiesFor('sqlite');
    expect(matrix.supported.has('procedure')).toBe(false);
  });

  it('supported includes table', () => {
    const matrix = capabilitiesFor('sqlite');
    expect(matrix.supported.has('table')).toBe(true);
  });

  it('supported includes trigger', () => {
    const matrix = capabilitiesFor('sqlite');
    expect(matrix.supported.has('trigger')).toBe(true);
  });

  it('has a defaultLevels object', () => {
    const matrix = capabilitiesFor('sqlite');
    expect(typeof matrix.defaultLevels).toBe('object');
    expect(matrix.defaultLevels).not.toBeNull();
  });
});

describe('capabilitiesFor — mssql', () => {
  it('returns a CapabilityMatrix for mssql', () => {
    const matrix = capabilitiesFor('mssql');
    expect(matrix).toBeDefined();
  });

  it('engine is mssql', () => {
    const matrix = capabilitiesFor('mssql');
    expect(matrix.engine).toBe('mssql');
  });

  it('supported includes procedure', () => {
    const matrix = capabilitiesFor('mssql');
    expect(matrix.supported.has('procedure')).toBe(true);
  });

  it('supported includes function', () => {
    const matrix = capabilitiesFor('mssql');
    expect(matrix.supported.has('function')).toBe(true);
  });

  it('supported includes table', () => {
    const matrix = capabilitiesFor('mssql');
    expect(matrix.supported.has('table')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown dialect → UnsupportedDialectError
// ─────────────────────────────────────────────────────────────────────────────

describe('capabilitiesFor — unknown dialect', () => {
  it('throws UnsupportedDialectError for unknown dialect', () => {
    expect(() => capabilitiesFor('oracle')).toThrow(UnsupportedDialectError);
  });

  it('thrown error carries code E_UNSUPPORTED_DIALECT', () => {
    let caught: unknown;
    try {
      capabilitiesFor('oracle');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsupportedDialectError);
    if (caught instanceof UnsupportedDialectError) {
      expect(caught.code).toBe('E_UNSUPPORTED_DIALECT');
    }
  });

  it('throws UnsupportedDialectError for empty string', () => {
    expect(() => capabilitiesFor('')).toThrow(UnsupportedDialectError);
  });

  it('throws UnsupportedDialectError for postgres (not yet supported)', () => {
    expect(() => capabilitiesFor('postgres')).toThrow(UnsupportedDialectError);
  });
});
