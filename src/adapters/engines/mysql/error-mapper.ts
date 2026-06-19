/**
 * MySQL error mapper.
 * Maps a caught error from a mysql2/promise connection or query call to a
 * typed ConnectionError or PermissionError per the design error-mapping table.
 *
 * Design §error-mapper.ts (Decision §5):
 *   1045 ER_ACCESS_DENIED_ERROR       → ConnectionError (auth: check user/password)
 *   1049 ER_BAD_DB_ERROR              → ConnectionError (database not found)
 *   1044 ER_DBACCESS_DENIED_ERROR     → PermissionError (database access denied)
 *   1142 ER_TABLEACCESS_DENIED_ERROR  → PermissionError (table access denied)
 *   1143 ER_COLUMNACCESS_DENIED_ERROR → PermissionError (column access denied)
 *   1370 ER_PROCACCESS_DENIED_ERROR   → PermissionError (routine access denied)
 *   1130 ER_HOST_NOT_PRIVILEGED       → ConnectionError (host not allowed)
 *   code ECONNREFUSED / ETIMEDOUT / ENOTFOUND → ConnectionError (network unreachable)
 *   else → ConnectionError (actionable fallback including cause.message)
 *
 * Switching order: errno FIRST (stable across locales/versions), then code fallback
 * for system-level network errors (ECONNREFUSED etc., which have no errno).
 *
 * This function is PURE: same input → same output, no side effects.
 * NO top-level mysql2 import (ADR-006). Reads only err.errno and err.code.
 *
 * US-029 (MySQL adapter, Phase 8b), US-033 (actionable PermissionError),
 * mysql-extraction spec "Missing privilege raises an actionable PermissionError",
 * mysql-extraction spec "Authentication failure raises an actionable ConnectionError".
 */

import { ConnectionError, PermissionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error shape helpers
// ─────────────────────────────────────────────────────────────────────────────

function getErrno(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return typeof e['errno'] === 'number' ? e['errno'] : undefined;
  }
  return undefined;
}

function getCode(err: unknown): string {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return typeof e['code'] === 'string' ? e['code'] : '';
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// mapMysqlError — pure function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps any caught error from a mysql2/promise connection or query to a typed
 * ConnectionError or PermissionError. Never re-throws — always returns a typed error.
 *
 * Reads err.errno (number) first, falls back to err.code (string) for network errors.
 *
 * @param cause - The raw error caught from createConnection() / connect() / query()
 */
export function mapMysqlError(
  cause: unknown,
): ConnectionError | PermissionError {
  const errno = getErrno(cause);
  const code = getCode(cause);

  // ── errno-keyed branch (stable across MySQL locales/versions) ────────────

  if (errno !== undefined) {
    switch (errno) {
      // ── Authentication / access errors → ConnectionError ─────────────────
      case 1045: // ER_ACCESS_DENIED_ERROR — wrong user or password
        return new ConnectionError(
          'MySQL authentication failed. Check the user and password in MysqlAdapterConfig.',
          cause,
        );

      case 1049: // ER_BAD_DB_ERROR — database does not exist
        return new ConnectionError(
          'MySQL database not found. Verify host, port and database in MysqlAdapterConfig.',
          cause,
        );

      case 1130: // ER_HOST_NOT_PRIVILEGED — host not allowed to connect
        return new ConnectionError(
          'MySQL host is not permitted to connect. Verify host/port are reachable and the user is allowed from this host.',
          cause,
        );

      // ── Privilege / permission errors → PermissionError ──────────────────
      case 1044: // ER_DBACCESS_DENIED_ERROR — user denied access to the database
        return new PermissionError(
          'MySQL permission denied: user lacks access to the database. ' +
            'Grant the required catalog read privileges. ' +
            'See docs/permissions/mysql.md for the minimal read-only user script.',
          cause,
        );

      case 1142: // ER_TABLEACCESS_DENIED_ERROR — missing privilege on a catalog table
        return new PermissionError(
          'MySQL permission denied: missing SELECT privilege on the required catalog table. ' +
            'Grant SELECT on information_schema or the specific table. ' +
            'See docs/permissions/mysql.md for the minimal read-only user script.',
          cause,
        );

      case 1143: // ER_COLUMNACCESS_DENIED_ERROR — missing column-level privilege
        return new PermissionError(
          'MySQL permission denied: missing column-level privilege on a catalog table. ' +
            'Grant the required column privilege. ' +
            'See docs/permissions/mysql.md for the minimal read-only user script.',
          cause,
        );

      case 1370: // ER_PROCACCESS_DENIED_ERROR — missing EXECUTE/privilege on a routine
        return new PermissionError(
          'MySQL permission denied: missing EXECUTE or catalog privilege on a routine. ' +
            'Grant SELECT on information_schema.ROUTINES. ' +
            'See docs/permissions/mysql.md for the minimal read-only user script.',
          cause,
        );

      default:
        break; // fall through to code fallback, then generic fallback
    }
  }

  // ── code-keyed fallback for network/system-level errors ──────────────────
  // These errors have no meaningful errno — only a POSIX-style code string.

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new ConnectionError(
      'MySQL connection failed: host/port unreachable or connection timed out. ' +
        'Verify host and port in MysqlAdapterConfig.',
      cause,
    );
  }

  // ── Generic fallback — actionable, always includes the original message ───
  const detail = cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
  return new ConnectionError(
    `MySQL connection error: ${detail}`,
    cause,
  );
}
