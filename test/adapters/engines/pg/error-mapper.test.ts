/**
 * Unit tests for mapPgError — pure SQLSTATE-to-typed-error function.
 * Design §error-mapper.ts "Pure mapPgError(cause) SQLSTATE→typed-error".
 *
 * Strategy: synthetic error objects with .code set to the relevant SQLSTATE —
 * NO live DB, NO pg install required.
 *
 * SQLSTATE table (design doc):
 *   28P01, 28000              → ConnectionError (auth: check user/password)
 *   42501 / insufficient_privilege → PermissionError (names privilege + docs/permissions/pg.md)
 *   3D000 (bad db)            → ConnectionError (host/port/database unreachable)
 *   08* (connection class)    → ConnectionError (host/port/database unreachable)
 *   else                      → ConnectionError (actionable fallback)
 *
 * TDD: RED (error-mapper.ts does not exist yet) → GREEN → REFACTOR.
 *
 * Spec: "Missing catalog privilege yields a typed, actionable PermissionError"
 *       "Authentication failure raises an actionable ConnectionError"
 * US-028 (PostgreSQL adapter), US-033 (PermissionError for missing privileges).
 */

import { describe, it, expect } from 'vitest';
import { mapPgError } from '../../../../src/adapters/engines/pg/error-mapper.js';
import { ConnectionError, PermissionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — synthetic pg-shaped errors
// ─────────────────────────────────────────────────────────────────────────────

function pgError(code: string, message = 'pg error'): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth errors → ConnectionError
// Spec: Authentication failure raises an actionable ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapPgError — 28P01 auth (wrong password)', () => {
  it('returns ConnectionError for SQLSTATE 28P01', () => {
    const result = mapPgError(pgError('28P01', 'password authentication failed for user "app"'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message mentions checking credentials', () => {
    const result = mapPgError(pgError('28P01'));
    expect(result.message.toLowerCase()).toMatch(/user|password|credential|check/);
  });

  it('ConnectionError wraps the original cause', () => {
    const cause = pgError('28P01', 'password authentication failed');
    const result = mapPgError(cause);
    expect((result as ConnectionError).cause).toBe(cause);
  });
});

describe('mapPgError — 28000 auth (invalid authorization)', () => {
  it('returns ConnectionError for SQLSTATE 28000', () => {
    const result = mapPgError(pgError('28000', 'role "app" does not exist'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message mentions checking credentials', () => {
    const result = mapPgError(pgError('28000'));
    expect(result.message.toLowerCase()).toMatch(/user|password|credential|check/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission error → PermissionError
// Spec: Missing catalog privilege yields a typed, actionable PermissionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapPgError — 42501 insufficient_privilege', () => {
  it('returns PermissionError for SQLSTATE 42501', () => {
    const result = mapPgError(pgError('42501', 'permission denied for table pg_catalog'));
    expect(result).toBeInstanceOf(PermissionError);
  });

  it('PermissionError message names the privilege', () => {
    const result = mapPgError(pgError('42501'));
    expect(result.message.toLowerCase()).toMatch(/select|privilege|grant/);
  });

  it('PermissionError message links to docs/permissions/pg.md', () => {
    const result = mapPgError(pgError('42501'));
    expect(result.message).toContain('docs/permissions/pg.md');
  });

  it('PermissionError wraps the original cause', () => {
    const cause = pgError('42501');
    const result = mapPgError(cause);
    expect((result as PermissionError).cause).toBe(cause);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing DB → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapPgError — 3D000 invalid catalog (db missing)', () => {
  it('returns ConnectionError for SQLSTATE 3D000', () => {
    const result = mapPgError(pgError('3D000', 'database "missingdb" does not exist'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message mentions host/port/database', () => {
    const result = mapPgError(pgError('3D000'));
    expect(result.message.toLowerCase()).toMatch(/host|port|database|unreachable|connect/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection class 08* → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapPgError — 08* connection class', () => {
  it('returns ConnectionError for 08001 (unable to establish connection)', () => {
    const result = mapPgError(pgError('08001'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for 08006 (connection failure)', () => {
    const result = mapPgError(pgError('08006'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for 08P01 (protocol violation)', () => {
    const result = mapPgError(pgError('08P01'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('08* ConnectionError message mentions host/port/database', () => {
    const result = mapPgError(pgError('08001'));
    expect(result.message.toLowerCase()).toMatch(/host|port|database|unreachable|connect/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic fallback → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapPgError — generic fallback', () => {
  it('returns ConnectionError for unknown SQLSTATE', () => {
    const result = mapPgError(pgError('XX000', 'internal error'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for non-Error cause', () => {
    const result = mapPgError('something went wrong');
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for undefined cause', () => {
    const result = mapPgError(undefined);
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('generic fallback message is not empty', () => {
    const result = mapPgError(pgError('ZZ999'));
    expect(result.message.length).toBeGreaterThan(0);
  });
});
