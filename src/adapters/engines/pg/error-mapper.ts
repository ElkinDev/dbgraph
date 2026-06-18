/**
 * pg error mapper.
 * Maps a caught error from a pg.Client connect or query call to a typed
 * ConnectionError or PermissionError per the design error-mapping table.
 *
 * Design §"Reuse existing ConnectionError/PermissionError — no new error types":
 *   28P01, 28000                        → ConnectionError (auth: check user/password)
 *   42501 / insufficient_privilege       → PermissionError (names privilege + docs/permissions/pg.md)
 *   3D000 (invalid catalog / db missing) → ConnectionError (host/port/database unreachable)
 *   08* class (connection exceptions)    → ConnectionError (host/port/database unreachable)
 *   else                                 → ConnectionError (actionable fallback)
 *
 * This function is PURE: same input → same output, no side effects.
 * NO top-level `pg` import (ADR-006). Reads only err.code (SQLSTATE).
 *
 * US-028 (PostgreSQL adapter), US-033 (actionable PermissionError),
 * pg-extraction spec "Missing privilege raises an actionable PermissionError",
 * pg-extraction spec "Authentication failure raises an actionable ConnectionError".
 */

import { ConnectionError, PermissionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error shape helpers
// ─────────────────────────────────────────────────────────────────────────────

function getCode(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown };
    return typeof e.code === 'string' ? e.code : '';
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// mapPgError — pure function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps any caught error from pg.Client to a typed ConnectionError or
 * PermissionError. Never re-throws — always returns a typed error.
 *
 * @param cause - The raw error caught from client.connect() or client.query()
 */
export function mapPgError(
  cause: unknown,
): ConnectionError | PermissionError {
  const code = getCode(cause);

  // ── Authentication errors (28P01, 28000) ─────────────────────────────────
  // 28P01 — password authentication failed (invalid password for the role)
  // 28000 — invalid authorization specification (role does not exist, etc.)
  if (code === '28P01' || code === '28000') {
    return new ConnectionError(
      'PostgreSQL authentication failed. Check the user and password in PgAdapterConfig.',
      cause,
    );
  }

  // ── Insufficient privilege (42501) ───────────────────────────────────────
  // 42501 — insufficient_privilege: the role lacks SELECT on a catalog object.
  // The message names the privilege and links to the minimal-role doc (US-033).
  if (code === '42501') {
    return new PermissionError(
      'PostgreSQL permission denied. Grant SELECT on the required catalog objects to the role. ' +
        'See docs/permissions/pg.md for the minimal read-only role script.',
      cause,
    );
  }

  // ── Invalid catalog name (3D000 — database does not exist) ───────────────
  if (code === '3D000') {
    return new ConnectionError(
      'PostgreSQL database not found. Verify host, port and database in PgAdapterConfig.',
      cause,
    );
  }

  // ── Connection exception class 08* ───────────────────────────────────────
  // 08000, 08001, 08003, 08004, 08006, 08007, 08P01, etc.
  // All indicate a network-level connection failure.
  if (code.startsWith('08')) {
    return new ConnectionError(
      'PostgreSQL connection failed. Verify host, port and database are reachable in PgAdapterConfig.',
      cause,
    );
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  const detail = cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
  return new ConnectionError(
    `PostgreSQL connection error: ${detail}`,
    cause,
  );
}
