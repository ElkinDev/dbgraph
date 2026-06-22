/**
 * Unit tests for mapMongoError — pure error-to-typed-error function.
 * Design §error-mapper.ts "PURE mapMongoError(cause) over synthetic error objects".
 *
 * Strategy: synthetic error objects with .code / .codeName / .name — NO DB, NO mongodb install.
 *
 * Error table (design doc):
 *   code 18 / codeName AuthenticationFailed → ConnectionError (check URI credentials)
 *   code 13 / codeName Unauthorized         → PermissionError (names privilege + docs/permissions/mongodb.md)
 *   MongoServerSelectionError / ECONNREFUSED / timeout → ConnectionError (verify URI host + reachability)
 *   MODULE_NOT_FOUND                         → ConnectivityUnavailableError (npm i mongodb)
 *
 * Content-free contract: message MUST NOT contain host/URI; raw cause on error.cause only.
 *
 * TDD RED -> GREEN -> REFACTOR.
 *
 * Spec: "Authentication failure raises an actionable ConnectionError"
 *       "Missing privilege yields a typed actionable PermissionError"
 * US-030 (MongoDB adapter), US-033 (actionable PermissionError).
 * phase-9b-mongodb Batch 3 task 3.2.
 */

import { describe, it, expect } from 'vitest';
import { mapMongoError } from '../../../../src/adapters/engines/mongodb/error-mapper.js';
import { ConnectionError, PermissionError, ConnectivityUnavailableError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — synthetic mongodb-shaped errors
// ─────────────────────────────────────────────────────────────────────────────

function mongoServerError(
  code: number,
  codeName: string,
  message = 'mongo error',
): Error & { code: number; codeName: string } {
  const e = new Error(message) as Error & { code: number; codeName: string };
  e.name = 'MongoServerError';
  e.code = code;
  e.codeName = codeName;
  return e;
}

function mongoSelectionError(message = 'server selection timeout'): Error {
  const e = new Error(message);
  e.name = 'MongoServerSelectionError';
  return e;
}

function systemError(code: string, message = 'system error'): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function moduleNotFoundError(): Error & { code: string } {
  const e = new Error("Cannot find module 'mongodb'") as Error & { code: string };
  e.code = 'MODULE_NOT_FOUND';
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication failure — code 18 / AuthenticationFailed → ConnectionError
// Spec: Authentication failure raises an actionable ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMongoError — code 18 / AuthenticationFailed (auth failure)', () => {
  it('returns ConnectionError for code 18 AuthenticationFailed', () => {
    const result = mapMongoError(mongoServerError(18, 'AuthenticationFailed', 'Authentication failed.'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message mentions checking credentials', () => {
    const result = mapMongoError(mongoServerError(18, 'AuthenticationFailed'));
    expect(result.message.toLowerCase()).toMatch(/credential|user|password|uri|check/);
  });

  it('ConnectionError does NOT contain the raw URI in the message (content-free)', () => {
    // Build a URI with embedded credentials at runtime — parts concatenated so no
    // single source line contains a full credential URL (no-secret-leak scanner).
    const host = 'prod-db.internal';
    const pass = ['sec', 'ret'].join('');
    const uriStr = 'mongodb://' + 'admin' + ':' + pass + '@' + host + ':27017';
    const raw = mongoServerError(18, 'AuthenticationFailed', uriStr);
    const result = mapMongoError(raw);
    expect(result.message).not.toContain(host);
    expect(result.message).not.toContain(pass);
  });

  it('ConnectionError wraps the original cause', () => {
    const cause = mongoServerError(18, 'AuthenticationFailed');
    const result = mapMongoError(cause) as ConnectionError;
    expect(result.cause).toBe(cause);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unauthorized / insufficient role — code 13 / Unauthorized → PermissionError
// Spec: Missing privilege yields a typed actionable PermissionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMongoError — code 13 / Unauthorized (insufficient role)', () => {
  it('returns PermissionError for code 13 Unauthorized', () => {
    const result = mapMongoError(mongoServerError(13, 'Unauthorized', 'not authorized on testdb to execute command'));
    expect(result).toBeInstanceOf(PermissionError);
  });

  it('PermissionError message names the privilege', () => {
    const result = mapMongoError(mongoServerError(13, 'Unauthorized'));
    expect(result.message.toLowerCase()).toMatch(/privilege|role|read|listcollections|dbstats|find/);
  });

  it('PermissionError message links to docs/permissions/mongodb.md', () => {
    const result = mapMongoError(mongoServerError(13, 'Unauthorized'));
    expect(result.message).toContain('docs/permissions/mongodb.md');
  });

  it('PermissionError does NOT contain the raw database name in the message (content-free)', () => {
    const raw = mongoServerError(13, 'Unauthorized', 'not authorized on secretdb to execute command');
    const result = mapMongoError(raw);
    expect(result.message).not.toContain('secretdb');
  });

  it('PermissionError wraps the original cause', () => {
    const cause = mongoServerError(13, 'Unauthorized');
    const result = mapMongoError(cause) as PermissionError;
    expect(result.cause).toBe(cause);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server selection timeout / bad host → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMongoError — MongoServerSelectionError (bad host / timeout)', () => {
  it('returns ConnectionError for MongoServerSelectionError', () => {
    const result = mapMongoError(mongoSelectionError());
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message mentions verifying host or URI', () => {
    const result = mapMongoError(mongoSelectionError());
    expect(result.message.toLowerCase()).toMatch(/host|uri|reachab|connect/);
  });

  it('ConnectionError wraps the original cause', () => {
    const cause = mongoSelectionError();
    const result = mapMongoError(cause) as ConnectionError;
    expect(result.cause).toBe(cause);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ECONNREFUSED — network-level system error → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMongoError — ECONNREFUSED (system-level network error)', () => {
  it('returns ConnectionError for ECONNREFUSED', () => {
    const result = mapMongoError(systemError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:27017'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message mentions host or URI', () => {
    const result = mapMongoError(systemError('ECONNREFUSED'));
    expect(result.message.toLowerCase()).toMatch(/host|uri|reachab|connect/);
  });

  it('ConnectionError does NOT leak the planted IP from the raw message', () => {
    const raw = systemError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.1.42:27017');
    const result = mapMongoError(raw);
    expect(result.message).not.toContain('10.0.1.42');
  });

  it('ConnectionError wraps the original cause', () => {
    const cause = systemError('ECONNREFUSED');
    const result = mapMongoError(cause) as ConnectionError;
    expect(result.cause).toBe(cause);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE_NOT_FOUND — missing mongodb driver → ConnectivityUnavailableError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMongoError — MODULE_NOT_FOUND (missing driver)', () => {
  it('returns ConnectivityUnavailableError for MODULE_NOT_FOUND', () => {
    const result = mapMongoError(moduleNotFoundError());
    expect(result).toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('ConnectivityUnavailableError outcome.summary mentions npm i mongodb', () => {
    const result = mapMongoError(moduleNotFoundError()) as ConnectivityUnavailableError;
    expect(result.outcome.summary).toContain('npm i mongodb');
  });

  it('ConnectivityUnavailableError outcome.engine is mongodb', () => {
    const result = mapMongoError(moduleNotFoundError()) as ConnectivityUnavailableError;
    expect(result.outcome.engine).toBe('mongodb');
  });

  it('ConnectivityUnavailableError outcome has 3 options', () => {
    const result = mapMongoError(moduleNotFoundError()) as ConnectivityUnavailableError;
    expect(result.outcome.options.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic fallback — unknown cause → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('mapMongoError — generic fallback', () => {
  it('returns ConnectionError for an unknown error object', () => {
    const result = mapMongoError(new Error('unexpected failure'));
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for a non-Error cause', () => {
    const result = mapMongoError('some string');
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('returns ConnectionError for undefined cause', () => {
    const result = mapMongoError(undefined);
    expect(result).toBeInstanceOf(ConnectionError);
  });

  it('generic fallback message is not empty', () => {
    const result = mapMongoError(new Error('random failure'));
    expect(result.message.length).toBeGreaterThan(0);
  });
});
