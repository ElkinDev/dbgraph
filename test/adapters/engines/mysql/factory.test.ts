/**
 * Tests for createMysqlSchemaAdapter — the factory for the MySQL schema adapter.
 * Design §factory.ts (Decision §1, §5): lazy import, connect, map errors, wrap driver.
 *
 * ALL tests use INJECTED fakes — NO real mysql2 install needed.
 * The ConnectionLike seam allows unit-testing the factory in isolation.
 *
 * Test structure (mirrors pg factory test pattern):
 *  1. Missing driver (MODULE_NOT_FOUND) → error message contains "npm i mysql2"
 *  2. Connect failure → typed ConnectionError / PermissionError via mapMysqlError
 *  3. Successful connect → returns SchemaAdapter
 *  4. Default port (3306) is used when config.port is omitted
 *  5. ssl config is forwarded when provided
 *
 * TDD RED -> GREEN.
 * Spec: "Absent mysql2 driver names npm i mysql2"
 * Spec: "Authentication failure raises an actionable ConnectionError"
 * Spec: "Connects with explicit credentials and default port"
 * Task 3.3.
 */

import { describe, it, expect, vi } from 'vitest';
import { ConnectionError, PermissionError } from '../../../../src/core/errors.js';
import { createMysqlSchemaAdapter } from '../../../../src/adapters/engines/mysql/factory.js';
import type { MysqlAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import type { MysqlSchemaAdapterDeps } from '../../../../src/adapters/engines/mysql/factory.js';
import type { ConnectionLike } from '../../../../src/adapters/engines/mysql/driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BASE_CONFIG: MysqlAdapterConfig = {
  host: 'localhost',
  database: 'testdb',
  user: 'reader',
  password: '${env:MYSQL_PASSWORD}',
};

type CreateConnectionFn = Required<MysqlSchemaAdapterDeps>['createConnection'];

/**
 * A fake ConnectionLike — query/end only (auto-connected, no .connect() method).
 * Mirrors the real mysql2/promise.Connection returned by createConnection().
 */
function makeFakeConn(): ConnectionLike {
  return {
    query: vi.fn(async (sql: string) => { void sql; return [[], undefined] as [Record<string, unknown>[], unknown]; }),
    end: vi.fn(async () => undefined),
  };
}

/**
 * Build a fake createConnection function that matches mysql2/promise's API:
 *   createConnection(config) => Promise<Connection> (auto-connected)
 *
 * - If connectError is provided, the Promise rejects with that error
 *   (simulates connection failure during createConnection).
 * - If captureConfig is provided, it receives the config before resolving.
 */
function makeCreateConnection(
  opts: { connectError?: unknown; captureConfig?: (cfg: Record<string, unknown>) => void } = {},
): CreateConnectionFn {
  const fn = async (cfg: Record<string, unknown>): Promise<ConnectionLike> => {
    if (opts.captureConfig !== undefined) opts.captureConfig(cfg);
    if (opts.connectError !== undefined) throw opts.connectError;
    return makeFakeConn();
  };
  return fn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing driver (MODULE_NOT_FOUND)
// Spec: "Absent mysql2 driver names npm i mysql2"
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — missing driver', () => {
  const moduleNotFound = Object.assign(new Error("Cannot find module 'mysql2/promise'"), {
    code: 'MODULE_NOT_FOUND',
  });

  const depsWithMissingImport: MysqlSchemaAdapterDeps = {
    importMysql: async () => {
      throw moduleNotFound;
    },
  };

  it('throws a ConnectionError when importMysql rejects with MODULE_NOT_FOUND', async () => {
    await expect(
      createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it('error message contains the exact npm i mysql2 install command', async () => {
    await expect(
      createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof Error && e.message.includes('npm i mysql2'),
    );
  });

  it('error message also names the mysql2 package', async () => {
    await expect(
      createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof Error && e.message.includes('mysql2'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connect failure → typed errors via mapMysqlError
// Spec: "Authentication failure raises an actionable ConnectionError"
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — connect failure → typed error', () => {
  it('maps errno 1045 (auth denied) to ConnectionError', async () => {
    const authErr = Object.assign(new Error('Access denied'), {
      errno: 1045,
      code: 'ER_ACCESS_DENIED_ERROR',
    });
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: authErr }),
    };
    await expect(createMysqlSchemaAdapter(BASE_CONFIG, deps)).rejects.toBeInstanceOf(ConnectionError);
  });

  it('maps errno 1044 (db access denied) to PermissionError', async () => {
    const permErr = Object.assign(new Error('Access denied to database'), {
      errno: 1044,
      code: 'ER_DBACCESS_DENIED_ERROR',
    });
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: permErr }),
    };
    await expect(createMysqlSchemaAdapter(BASE_CONFIG, deps)).rejects.toBeInstanceOf(PermissionError);
  });

  it('maps errno 1049 (unknown database) to ConnectionError', async () => {
    const dbErr = Object.assign(new Error('Unknown database'), {
      errno: 1049,
      code: 'ER_BAD_DB_ERROR',
    });
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: dbErr }),
    };
    await expect(createMysqlSchemaAdapter(BASE_CONFIG, deps)).rejects.toBeInstanceOf(ConnectionError);
  });

  it('maps ECONNREFUSED to ConnectionError', async () => {
    const netErr = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: netErr }),
    };
    await expect(createMysqlSchemaAdapter(BASE_CONFIG, deps)).rejects.toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Successful connect → returns a SchemaAdapter
// Spec: "Connects with explicit credentials and default port"
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — successful connect', () => {
  it('returns an object with dialect mysql', async () => {
    const deps: MysqlSchemaAdapterDeps = { createConnection: makeCreateConnection() };
    const adapter = await createMysqlSchemaAdapter(BASE_CONFIG, deps);
    expect(adapter.dialect).toBe('mysql');
  });

  it('returns an object with capabilities (MYSQL_CAPABILITIES)', async () => {
    const deps: MysqlSchemaAdapterDeps = { createConnection: makeCreateConnection() };
    const adapter = await createMysqlSchemaAdapter(BASE_CONFIG, deps);
    expect(adapter.capabilities).toBeDefined();
    expect(adapter.capabilities.engine).toBe('mysql');
  });

  it('adapter has extract, fingerprint and close methods', async () => {
    const deps: MysqlSchemaAdapterDeps = { createConnection: makeCreateConnection() };
    const adapter = await createMysqlSchemaAdapter(BASE_CONFIG, deps);
    expect(typeof adapter.extract).toBe('function');
    expect(typeof adapter.fingerprint).toBe('function');
    expect(typeof adapter.close).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default port 3306
// Spec: "Connects with explicit credentials and default port"
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — default port 3306', () => {
  it('uses port 3306 when config.port is omitted', async () => {
    let capturedPort: unknown;
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({
        captureConfig: (cfg) => { capturedPort = cfg['port']; },
      }),
    };
    await createMysqlSchemaAdapter(BASE_CONFIG, deps);
    expect(capturedPort).toBe(3306);
  });

  it('uses the provided port when config.port is set', async () => {
    let capturedPort: unknown;
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({
        captureConfig: (cfg) => { capturedPort = cfg['port']; },
      }),
    };
    await createMysqlSchemaAdapter({ ...BASE_CONFIG, port: 33306 }, deps);
    expect(capturedPort).toBe(33306);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ssl config forwarding
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — ssl config', () => {
  it('passes ssl boolean to the connection config when provided', async () => {
    let capturedSsl: unknown;
    let hasSsl = false;
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({
        captureConfig: (cfg) => {
          hasSsl = 'ssl' in cfg;
          capturedSsl = cfg['ssl'];
        },
      }),
    };
    await createMysqlSchemaAdapter({ ...BASE_CONFIG, ssl: true }, deps);
    expect(hasSsl).toBe(true);
    expect(capturedSsl).toBe(true);
  });

  it('does not include ssl key when config.ssl is omitted', async () => {
    let hasSsl = false;
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({
        captureConfig: (cfg) => { hasSsl = 'ssl' in cfg; },
      }),
    };
    await createMysqlSchemaAdapter(BASE_CONFIG, deps);
    expect(hasSsl).toBe(false);
  });

  it('passes ssl object with rejectUnauthorized when provided', async () => {
    let capturedSsl: unknown;
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({
        captureConfig: (cfg) => { capturedSsl = cfg['ssl']; },
      }),
    };
    await createMysqlSchemaAdapter({ ...BASE_CONFIG, ssl: { rejectUnauthorized: false } }, deps);
    expect(capturedSsl).toEqual({ rejectUnauthorized: false });
  });
});
