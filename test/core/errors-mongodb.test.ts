/**
 * UnsupportedDialectError — pinned message update (Batch 5, task 5.3).
 * STRICT TDD: RED → GREEN
 *
 * The UnsupportedDialectError message MUST list 'mongodb' alongside
 * 'sqlite', 'mssql', 'pg', and 'mysql'.
 * This is a MESSAGE-ONLY change — the error class, code, and instanceof behaviour
 * are unchanged.
 *
 * Spec: schema-extraction "UnsupportedDialectError lists mongodb and maps to exit code 4".
 * Design §"Batch 5: change ONLY the UnsupportedDialectError message string in
 *   src/core/errors.ts to list sqlite, mssql, pg, mysql, mongodb".
 */

import { describe, it, expect } from 'vitest';
import { UnsupportedDialectError } from '../../src/core/errors.js';

describe('UnsupportedDialectError — pinned message includes mongodb (task 5.3)', () => {
  it('message lists "mongodb" as an available dialect', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('mongodb');
  });

  it('message still lists "sqlite" as an available dialect', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('sqlite');
  });

  it('message still lists "mssql" as an available dialect', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('mssql');
  });

  it('message still lists "pg" as an available dialect', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('pg');
  });

  it('message still lists "mysql" as an available dialect', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('mysql');
  });

  it('message contains "sqlite, mssql, pg, mysql, mongodb" (exact pinned format)', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('sqlite, mssql, pg, mysql, mongodb');
  });

  it('error class and code are unchanged', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.code).toBe('E_UNSUPPORTED_DIALECT');
    expect(err.name).toBe('UnsupportedDialectError');
  });

  it('message still includes the bad dialect name', () => {
    const err = new UnsupportedDialectError('redis');
    expect(err.message).toContain('redis');
  });

  it('message still includes the bad dialect name for "mongodb" itself', () => {
    // Edge case: 'mongodb' both in the dialect list AND the bad dialect slot
    const err = new UnsupportedDialectError('mongodb');
    expect(err.message).toContain('mongodb');
  });
});
