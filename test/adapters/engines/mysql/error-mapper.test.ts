/**
 * Tests for mapMysqlError — pure function mapping mysql2 error shapes
 * to typed ConnectionError / PermissionError.
 *
 * Design §error-mapper.ts (Decision §5): reads err.errno (number) THEN
 * falls back to err.code (string) for system-level network errors.
 *
 * ALL tests use SYNTHETIC { errno, code, message } objects — NO DB, NO mysql2 install.
 *
 * TDD RED -> GREEN.
 * Spec: "Missing catalog privilege yields a typed, actionable PermissionError"
 * Spec: "Authentication failure raises an actionable ConnectionError"
 * Task 3.2.
 */

import { describe, it, expect } from 'vitest';
import { ConnectionError, PermissionError } from '../../../../src/core/errors.js';
import { mapMysqlError } from '../../../../src/adapters/engines/mysql/error-mapper.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — build synthetic mysql2-shaped error objects (no real mysql2 install)
// ─────────────────────────────────────────────────────────────────────────────

function mkErr(errno: number | undefined, code: string, message = 'synthetic error'): unknown {
  return Object.assign(new Error(message), { errno, code });
}

function mkCodeErr(code: string, message = 'synthetic error'): unknown {
  // Network-level errors have no errno — only a code string.
  return Object.assign(new Error(message), { code });
}

// ─────────────────────────────────────────────────────────────────────────────
// errno-keyed: ConnectionError cases
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMysqlError — errno 1045 (ER_ACCESS_DENIED_ERROR) → ConnectionError', () => {
  it('returns ConnectionError for errno 1045', () => {
    const err = mapMysqlError(mkErr(1045, 'ER_ACCESS_DENIED_ERROR', 'Access denied'));
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('message mentions user/password check', () => {
    const err = mapMysqlError(mkErr(1045, 'ER_ACCESS_DENIED_ERROR', 'Access denied'));
    expect(err.message.toLowerCase()).toMatch(/user|password/);
  });
});

describe('mapMysqlError — errno 1049 (ER_BAD_DB_ERROR) → ConnectionError', () => {
  it('returns ConnectionError for errno 1049', () => {
    const err = mapMysqlError(mkErr(1049, 'ER_BAD_DB_ERROR', 'Unknown database'));
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('message mentions database not found', () => {
    const err = mapMysqlError(mkErr(1049, 'ER_BAD_DB_ERROR', 'Unknown database'));
    expect(err.message.toLowerCase()).toMatch(/database|not found|unknown/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// errno-keyed: PermissionError cases
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMysqlError — errno 1044 (ER_DBACCESS_DENIED_ERROR) → PermissionError', () => {
  it('returns PermissionError for errno 1044', () => {
    const err = mapMysqlError(mkErr(1044, 'ER_DBACCESS_DENIED_ERROR', 'Access denied to database'));
    expect(err).toBeInstanceOf(PermissionError);
  });

  it('message links to docs/permissions/mysql.md', () => {
    const err = mapMysqlError(mkErr(1044, 'ER_DBACCESS_DENIED_ERROR', 'Access denied to database'));
    expect(err.message).toContain('docs/permissions/mysql.md');
  });
});

describe('mapMysqlError — errno 1142 (ER_TABLEACCESS_DENIED_ERROR) → PermissionError', () => {
  it('returns PermissionError for errno 1142', () => {
    const err = mapMysqlError(mkErr(1142, 'ER_TABLEACCESS_DENIED_ERROR', 'SELECT command denied'));
    expect(err).toBeInstanceOf(PermissionError);
  });

  it('message links to docs/permissions/mysql.md', () => {
    const err = mapMysqlError(mkErr(1142, 'ER_TABLEACCESS_DENIED_ERROR', 'SELECT command denied'));
    expect(err.message).toContain('docs/permissions/mysql.md');
  });
});

describe('mapMysqlError — errno 1143 (ER_COLUMNACCESS_DENIED_ERROR) → PermissionError', () => {
  it('returns PermissionError for errno 1143', () => {
    const err = mapMysqlError(mkErr(1143, 'ER_COLUMNACCESS_DENIED_ERROR', 'Column access denied'));
    expect(err).toBeInstanceOf(PermissionError);
  });

  it('message links to docs/permissions/mysql.md', () => {
    const err = mapMysqlError(mkErr(1143, 'ER_COLUMNACCESS_DENIED_ERROR', 'Column access denied'));
    expect(err.message).toContain('docs/permissions/mysql.md');
  });
});

describe('mapMysqlError — errno 1370 (ER_PROCACCESS_DENIED_ERROR) → PermissionError', () => {
  it('returns PermissionError for errno 1370', () => {
    const err = mapMysqlError(mkErr(1370, 'ER_PROCACCESS_DENIED_ERROR', 'Execute command denied'));
    expect(err).toBeInstanceOf(PermissionError);
  });

  it('message links to docs/permissions/mysql.md', () => {
    const err = mapMysqlError(mkErr(1370, 'ER_PROCACCESS_DENIED_ERROR', 'Execute command denied'));
    expect(err.message).toContain('docs/permissions/mysql.md');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// code-keyed: network/host errors → ConnectionError
// errno is absent or not in the table — falls back to code string
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMysqlError — code ECONNREFUSED → ConnectionError', () => {
  it('returns ConnectionError for code ECONNREFUSED', () => {
    const err = mapMysqlError(mkCodeErr('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3306'));
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('message mentions host/port or unreachable', () => {
    const err = mapMysqlError(mkCodeErr('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3306'));
    expect(err.message.toLowerCase()).toMatch(/host|port|unreachable|connect/);
  });
});

describe('mapMysqlError — code ETIMEDOUT → ConnectionError', () => {
  it('returns ConnectionError for code ETIMEDOUT', () => {
    const err = mapMysqlError(mkCodeErr('ETIMEDOUT', 'Connection timeout'));
    expect(err).toBeInstanceOf(ConnectionError);
  });
});

describe('mapMysqlError — code ENOTFOUND → ConnectionError', () => {
  it('returns ConnectionError for code ENOTFOUND', () => {
    const err = mapMysqlError(mkCodeErr('ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.com'));
    expect(err).toBeInstanceOf(ConnectionError);
  });
});

describe('mapMysqlError — errno 1130 (ER_HOST_NOT_PRIVILEGED) → ConnectionError', () => {
  it('returns ConnectionError for errno 1130', () => {
    const err = mapMysqlError(mkErr(1130, 'ER_HOST_NOT_PRIVILEGED', 'Host not allowed'));
    expect(err).toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: unknown error → ConnectionError with cause.message
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMysqlError — unknown error → ConnectionError (actionable fallback)', () => {
  it('returns ConnectionError for an unknown errno', () => {
    const err = mapMysqlError(mkErr(9999, 'ER_UNKNOWN', 'Something unexpected'));
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('fallback message includes the original error message', () => {
    const err = mapMysqlError(mkErr(9999, 'ER_UNKNOWN', 'Something unexpected'));
    expect(err.message).toContain('Something unexpected');
  });

  it('returns ConnectionError for a plain Error object with no errno/code', () => {
    const err = mapMysqlError(new Error('plain error'));
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for a non-Error thrown value', () => {
    const err = mapMysqlError('string thrown');
    expect(err).toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// errno takes precedence over code (Decision §5: switch on errno FIRST)
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMysqlError — errno takes precedence over code', () => {
  it('errno 1045 beats code ECONNREFUSED → ConnectionError (auth, not network)', () => {
    // If both errno and code are present, errno wins.
    const err = mapMysqlError(
      Object.assign(new Error('mixed'), { errno: 1045, code: 'ECONNREFUSED' }),
    );
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.message.toLowerCase()).toMatch(/user|password/);
  });

  it('errno 1044 beats code ECONNREFUSED → PermissionError (not network)', () => {
    const err = mapMysqlError(
      Object.assign(new Error('mixed'), { errno: 1044, code: 'ECONNREFUSED' }),
    );
    expect(err).toBeInstanceOf(PermissionError);
    expect(err.message).toContain('docs/permissions/mysql.md');
  });
});
