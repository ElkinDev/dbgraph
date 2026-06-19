/**
 * UnsupportedDialectError — pinned message update (Batch 5, task 5.3).
 * STRICT TDD: RED → GREEN
 *
 * The UnsupportedDialectError message MUST list 'mysql' alongside 'sqlite', 'mssql', and 'pg'.
 * This is a MESSAGE-ONLY change — the error class, code, and instanceof behaviour
 * are unchanged.
 *
 * Spec: schema-extraction "UnsupportedDialectError lists mysql and maps to exit code 4".
 * Design §8: "change ONLY the UnsupportedDialectError message string in src/core/errors.ts
 *   to 'Available dialects: sqlite, mssql, pg, mysql.'".
 */

import { describe, it, expect } from 'vitest';
import { UnsupportedDialectError } from '../../src/core/errors.js';

describe('UnsupportedDialectError — pinned message includes mysql (task 5.3)', () => {
  it('message lists "mysql" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('mysql');
  });

  it('message still lists "sqlite" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('sqlite');
  });

  it('message still lists "mssql" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('mssql');
  });

  it('message still lists "pg" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('pg');
  });

  it('message contains "sqlite, mssql, pg, mysql" (exact pinned format)', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('sqlite, mssql, pg, mysql');
  });

  it('error class and code are unchanged', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.code).toBe('E_UNSUPPORTED_DIALECT');
    expect(err.name).toBe('UnsupportedDialectError');
  });

  it('message still includes the bad dialect name', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('oracle');
  });

  it('message still includes the bad dialect name for "mysql" itself', () => {
    // Edge case: 'mysql' both in the dialect list AND the bad dialect slot
    const err = new UnsupportedDialectError('mysql');
    expect(err.message).toContain('mysql');
  });
});
