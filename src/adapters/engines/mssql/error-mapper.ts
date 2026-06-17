/**
 * mssql / tedious error mapper.
 * Maps a caught error from a mssql pool connect or query call to a typed
 * ConnectionError or PermissionError per the design error-mapping table.
 *
 * Design §"Reuse existing ConnectionError/PermissionError — no new error types":
 *   ELOGIN / "Login failed"       → ConnectionError (credentials)
 *   ESOCKET / ETIMEOUT / ENOTFOUND → ConnectionError (server:port unreachable)
 *   self-signed / certificate      → ConnectionError (trustServerCertificate hint)
 *   Kerberos / SSPI               → ConnectionError (SSO unsupported, use SQL/NTLM)
 *   error 229 / "permission denied" → PermissionError (VIEW DEFINITION + docs link)
 *   MODULE_NOT_FOUND              → ConnectionError (npm i mssql — handled in factory)
 *   all other errors              → ConnectionError (generic actionable fallback)
 *
 * This function is PURE: same input → same output, no side effects.
 * US-033 (PermissionError for VIEW DEFINITION), ADR-006.
 */

import { ConnectionError, PermissionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error shape helpers (tedious/mssql errors carry code and number fields)
// ─────────────────────────────────────────────────────────────────────────────

function getCode(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown };
    return typeof e.code === 'string' ? e.code : '';
  }
  return '';
}

function getNumber(err: unknown): number {
  if (err instanceof Error) {
    const e = err as Error & { number?: unknown };
    return typeof e.number === 'number' ? e.number : 0;
  }
  return 0;
}

function getMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? '');
}

// ─────────────────────────────────────────────────────────────────────────────
// mapMssqlError — pure function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps any caught error from mssql/tedious to a typed ConnectionError
 * or PermissionError. Never re-throws — always returns a typed error.
 *
 * @param cause - The raw error caught from pool.connect() or pool.request().query()
 */
export function mapMssqlError(
  cause: unknown,
): ConnectionError | PermissionError {
  const code = getCode(cause);
  const number = getNumber(cause);
  const msg = getMessage(cause).toLowerCase();

  // ── Permission denied (VIEW DEFINITION) ──────────────────────────────────
  // SQL Server error 229: permission was denied on object.
  // Match by error number OR by message pattern.
  if (
    number === 229 ||
    msg.includes('permission was denied') ||
    (msg.includes('permission') && msg.includes('denied'))
  ) {
    return new PermissionError(
      'SQL Server permission denied. Grant VIEW DEFINITION + CONNECT to the login. ' +
        'See docs/permissions/mssql.md for the minimal permission script.',
      cause,
    );
  }

  // ── Login failure (ELOGIN / "Login failed") ───────────────────────────────
  if (code === 'ELOGIN' || msg.includes('login failed')) {
    return new ConnectionError(
      'SQL Server login failed. Check the user credentials (user/password) in MssqlAdapterConfig.',
      cause,
    );
  }

  // ── Network unreachable (ESOCKET / ETIMEOUT / ENOTFOUND) ─────────────────
  if (
    code === 'ESOCKET' ||
    code === 'ETIMEOUT' ||
    code === 'ENOTFOUND'
  ) {
    return new ConnectionError(
      'Cannot reach the SQL Server host. Verify the server address and port in MssqlAdapterConfig.',
      cause,
    );
  }

  // ── TLS / certificate errors ──────────────────────────────────────────────
  if (msg.includes('self-signed') || msg.includes('certificate')) {
    return new ConnectionError(
      'SQL Server TLS certificate error. For development, set trustServerCertificate: true in ' +
        'MssqlAdapterConfig. For production, install a valid TLS certificate on the server.',
      cause,
    );
  }

  // ── Kerberos / SSPI / SSO unsupported ────────────────────────────────────
  if (msg.includes('kerberos') || msg.includes('sspi')) {
    return new ConnectionError(
      'Kerberos/SSO authentication is not supported. Use SQL Server authentication ' +
        "(authentication.type: 'sql') or NTLM (authentication.type: 'ntlm') in MssqlAdapterConfig.",
      cause,
    );
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  const detail = cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
  return new ConnectionError(
    `SQL Server connection failed: ${detail}`,
    cause,
  );
}
