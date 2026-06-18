/**
 * UnsupportedDialectError — pinned message update (Batch 5, task 5.4).
 * STRICT TDD: RED → GREEN
 *
 * The UnsupportedDialectError message MUST list 'pg' alongside 'sqlite' and 'mssql'.
 * This is a MESSAGE-ONLY change — the error class, code, and instanceof behaviour
 * are unchanged.
 *
 * Spec: schema-extraction "UnsupportedDialectError lists pg and maps to exit code 4".
 * Design: "change ONLY the UnsupportedDialectError message string in src/core/errors.ts:108".
 */

import { describe, it, expect } from 'vitest';
import { UnsupportedDialectError } from '../../src/core/errors.js';

describe('UnsupportedDialectError — pinned message includes pg (task 5.4)', () => {
  it('message lists "pg" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('pg');
  });

  it('message still lists "sqlite" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('sqlite');
  });

  it('message still lists "mssql" as an available dialect', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('mssql');
  });

  it('message contains "sqlite, mssql, pg" (exact pinned format)', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('sqlite, mssql, pg');
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
});
