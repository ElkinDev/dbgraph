/**
 * Unit tests for mssql error-mapper.
 * Verifies that synthetic tedious/mssql error objects (err.code/number/message)
 * are correctly mapped to ConnectionError or PermissionError per design table.
 *
 * NO live DB — purely synthetic error shapes.
 * Design §"Reuse existing ConnectionError/PermissionError" table.
 * TDD: RED → GREEN → REFACTOR. US-033 (PermissionError), ADR-006.
 */

import { describe, it, expect } from 'vitest';
import { mapMssqlError } from '../../../../src/adapters/engines/mssql/error-mapper.js';
import { ConnectionError } from '../../../../src/core/errors.js';
import { PermissionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to build synthetic error objects
// ─────────────────────────────────────────────────────────────────────────────

function makeErr(overrides: Partial<{
  code: string;
  number: number;
  message: string;
}>): Error & { code?: string; number?: number } {
  const err = new Error(overrides.message ?? 'generic error') as Error & {
    code?: string;
    number?: number;
  };
  if (overrides.code !== undefined) err.code = overrides.code;
  if (overrides.number !== undefined) err.number = overrides.number;
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Login failures (ELOGIN / "Login failed")
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMssqlError — login failure', () => {
  it('ELOGIN code → ConnectionError with credential guidance', () => {
    const err = makeErr({ code: 'ELOGIN', message: 'Login failed for user "sa"' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
    expect(mapped.code).toBe('E_CONNECTION');
  });

  it('ELOGIN ConnectionError message mentions credentials', () => {
    const err = makeErr({ code: 'ELOGIN', message: 'Login failed for user "sa"' });
    const mapped = mapMssqlError(err);

    expect(mapped.message.toLowerCase()).toMatch(/credential|login|password|user/);
  });

  it('message containing "Login failed" (without ELOGIN code) → ConnectionError', () => {
    const err = makeErr({ message: 'Login failed for user "bob"' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Network unreachable (ESOCKET / ETIMEOUT / ENOTFOUND)
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMssqlError — network unreachable', () => {
  it('ESOCKET → ConnectionError mentioning server or port', () => {
    const err = makeErr({ code: 'ESOCKET', message: 'Could not connect to host' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
    expect(mapped.message.toLowerCase()).toMatch(/server|host|port|unreachable|connect/);
  });

  it('ETIMEOUT → ConnectionError', () => {
    const err = makeErr({ code: 'ETIMEOUT', message: 'Connection timeout' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });

  it('ENOTFOUND → ConnectionError', () => {
    const err = makeErr({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND db.example.com' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TLS / certificate errors
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMssqlError — TLS certificate errors', () => {
  it('message containing "self-signed" → ConnectionError with trustServerCertificate hint', () => {
    const err = makeErr({ message: 'self-signed certificate in certificate chain' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
    expect(mapped.message).toMatch(/trustServerCertificate/);
  });

  it('message containing "certificate" → ConnectionError', () => {
    const err = makeErr({ message: 'unable to verify the first certificate' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kerberos / SSO unsupported
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMssqlError — Kerberos / SSO unsupported', () => {
  it('message containing "Kerberos" → ConnectionError stating SSO unsupported', () => {
    const err = makeErr({ message: 'Kerberos authentication failed' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
    expect(mapped.message.toLowerCase()).toMatch(/sso|kerberos|unsupported|sql|ntlm/i);
  });

  it('message containing "sspi" → ConnectionError (Windows SSPI = Kerberos/NTLM auto-negotiation)', () => {
    const err = makeErr({ message: 'SSPI handshake failed' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission denied (error 229 / EREQUEST)
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMssqlError — permission denied (VIEW DEFINITION)', () => {
  it('error number 229 → PermissionError', () => {
    const err = makeErr({
      code: 'EREQUEST',
      number: 229,
      message: 'The SELECT permission was denied on the object',
    });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(PermissionError);
    expect(mapped.code).toBe('E_PERMISSION');
  });

  it('PermissionError message mentions VIEW DEFINITION', () => {
    const err = makeErr({
      code: 'EREQUEST',
      number: 229,
      message: 'The SELECT permission was denied on the object',
    });
    const mapped = mapMssqlError(err);

    expect(mapped.message).toMatch(/VIEW DEFINITION/i);
  });

  it('PermissionError message links to docs/permissions/mssql.md', () => {
    const err = makeErr({
      code: 'EREQUEST',
      number: 229,
      message: 'permission was denied',
    });
    const mapped = mapMssqlError(err);

    expect(mapped.message).toMatch(/docs\/permissions\/mssql\.md/);
  });

  it('message containing "permission was denied" (no error number) → PermissionError', () => {
    const err = makeErr({ message: 'The SELECT permission was denied on the object sys.tables' });
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(PermissionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing driver (MODULE_NOT_FOUND) — handled upstream in factory
// but error-mapper must handle a plain Error fallback too
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMssqlError — generic / unknown error fallback', () => {
  it('unknown Error → ConnectionError (generic fallback)', () => {
    const err = new Error('Something unexpected happened');
    const mapped = mapMssqlError(err);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });

  it('non-Error thrown value → ConnectionError', () => {
    const mapped = mapMssqlError('some string error');

    expect(mapped).toBeInstanceOf(ConnectionError);
  });

  it('null thrown → ConnectionError', () => {
    const mapped = mapMssqlError(null);

    expect(mapped).toBeInstanceOf(ConnectionError);
  });
});
