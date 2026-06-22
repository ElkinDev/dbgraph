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
import {
  ConnectivityUnavailableError,
} from '../../../../src/core/errors.js';
import { createMysqlSchemaAdapter } from '../../../../src/adapters/engines/mysql/factory.js';
import type { MysqlAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import type { MysqlSchemaAdapterDeps } from '../../../../src/adapters/engines/mysql/factory.js';
import type { ConnectionLike } from '../../../../src/adapters/engines/mysql/driver.js';
import {
  SQL_MYSQL_TABLES,
  SQL_MYSQL_COLUMNS,
} from '../../../../src/adapters/engines/mysql/queries.js';

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
// Missing driver (MODULE_NOT_FOUND) → ConnectivityUnavailableError with ≥3 options
// Task 3.3 (resilient-connectivity Batch 3)
// Spec: connectivity-diagnostics "mysql driver absent yields the three-option outcome"
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — missing driver → ConnectivityUnavailableError (Batch 3)', () => {
  const moduleNotFound = Object.assign(new Error("Cannot find module 'mysql2/promise'"), {
    code: 'MODULE_NOT_FOUND',
  });

  const depsWithMissingImport: MysqlSchemaAdapterDeps = {
    importMysql: async () => {
      throw moduleNotFound;
    },
  };

  it('throws ConnectivityUnavailableError when importMysql rejects with MODULE_NOT_FOUND', async () => {
    await expect(
      createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('ConnectivityUnavailableError code is E_CONNECTIVITY_UNAVAILABLE', async () => {
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).code).toBe('E_CONNECTIVITY_UNAVAILABLE');
  });

  it('outcome.engine is "mysql"', async () => {
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.engine).toBe('mysql');
  });

  it('outcome has exactly 3 options', async () => {
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.options.length).toBe(3);
  });

  it('option kinds are exactly ["run-it-yourself","consented-install","manual-dump"]', async () => {
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    const outcome = (err as ConnectivityUnavailableError).outcome;
    expect(outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });

  it('run-it-yourself queries contain the shipped mysql catalog SELECTs (tables + columns)', async () => {
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    const outcome = (err as ConnectivityUnavailableError).outcome;
    const riyo = outcome.options[0];
    if (riyo?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    expect(riyo.queries).toContain(SQL_MYSQL_TABLES);
    expect(riyo.queries).toContain(SQL_MYSQL_COLUMNS);
  });

  it('run-it-yourself queries are write-verb-free', async () => {
    const writeVerbPattern = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i;
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    const outcome = (err as ConnectivityUnavailableError).outcome;
    const riyo = outcome.options[0];
    if (riyo?.kind !== 'run-it-yourself') throw new Error('wrong kind');
    for (const query of riyo.queries) {
      expect(query).not.toMatch(writeVerbPattern);
    }
  });

  it('consented-install option names "mysql2" as the tool', async () => {
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, depsWithMissingImport).catch((e: unknown) => e);
    const outcome = (err as ConnectivityUnavailableError).outcome;
    const install = outcome.options[1];
    if (install?.kind !== 'consented-install') throw new Error('wrong kind');
    expect(install.tool).toBe('mysql2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connect failure → ConnectivityUnavailableError with ≥3 options (Batch 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('createMysqlSchemaAdapter — connect failure → ConnectivityUnavailableError (Batch 3)', () => {
  it('maps connect failure to ConnectivityUnavailableError', async () => {
    const authErr = Object.assign(new Error('Access denied'), {
      errno: 1045,
      code: 'ER_ACCESS_DENIED_ERROR',
    });
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: authErr }),
    };
    await expect(createMysqlSchemaAdapter(BASE_CONFIG, deps)).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('connect-fail outcome has 3 options', async () => {
    const dbErr = Object.assign(new Error('Unknown database'), {
      errno: 1049,
      code: 'ER_BAD_DB_ERROR',
    });
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: dbErr }),
    };
    const err = await createMysqlSchemaAdapter(BASE_CONFIG, deps).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.options.length).toBe(3);
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
// C1 — content-free leak test (R1 remediation)
// The connect-FAILURE path must NOT leak host/user/db/password into the
// rendered formatOutcome output.
// ─────────────────────────────────────────────────────────────────────────────

import { formatOutcome } from '../../../../src/core/present/connectivity.js';

const PLANTED_MYSQL_HOST = 'mysql-prod.internal.company.com';
const PLANTED_MYSQL_USER = 'svc_reader_prod';
const PLANTED_MYSQL_DB   = 'billing_prod';
const PLANTED_MYSQL_PASS = 'MySuperS3cr3t!';

function makePlantedMysqlError(): unknown {
  const msg =
    `Access denied for user '${PLANTED_MYSQL_USER}'@'${PLANTED_MYSQL_HOST}' ` +
    `to database '${PLANTED_MYSQL_DB}' using password '${PLANTED_MYSQL_PASS}'`;
  return Object.assign(new Error(msg), { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' });
}

describe('createMysqlSchemaAdapter — C1: connect-failure must NOT leak planted identifiers', () => {
  it('formatted outcome does NOT contain the planted host when connect fails', async () => {
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: makePlantedMysqlError() }),
    };
    const err = await createMysqlSchemaAdapter(
      { host: PLANTED_MYSQL_HOST, database: PLANTED_MYSQL_DB, user: PLANTED_MYSQL_USER, password: PLANTED_MYSQL_PASS },
      deps,
    ).catch((e: unknown) => e) as import('../../../../src/core/errors.js').ConnectivityUnavailableError;

    const rendered = formatOutcome(err.outcome);
    expect(rendered).not.toContain(PLANTED_MYSQL_HOST);
  });

  it('formatted outcome does NOT contain the planted user when connect fails', async () => {
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: makePlantedMysqlError() }),
    };
    const err = await createMysqlSchemaAdapter(
      { host: PLANTED_MYSQL_HOST, database: PLANTED_MYSQL_DB, user: PLANTED_MYSQL_USER, password: PLANTED_MYSQL_PASS },
      deps,
    ).catch((e: unknown) => e) as import('../../../../src/core/errors.js').ConnectivityUnavailableError;

    const rendered = formatOutcome(err.outcome);
    expect(rendered).not.toContain(PLANTED_MYSQL_USER);
  });

  it('formatted outcome does NOT contain the planted db when connect fails', async () => {
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: makePlantedMysqlError() }),
    };
    const err = await createMysqlSchemaAdapter(
      { host: PLANTED_MYSQL_HOST, database: PLANTED_MYSQL_DB, user: PLANTED_MYSQL_USER, password: PLANTED_MYSQL_PASS },
      deps,
    ).catch((e: unknown) => e) as import('../../../../src/core/errors.js').ConnectivityUnavailableError;

    const rendered = formatOutcome(err.outcome);
    expect(rendered).not.toContain(PLANTED_MYSQL_DB);
  });

  it('formatted outcome does NOT contain the planted password when connect fails', async () => {
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: makePlantedMysqlError() }),
    };
    const err = await createMysqlSchemaAdapter(
      { host: PLANTED_MYSQL_HOST, database: PLANTED_MYSQL_DB, user: PLANTED_MYSQL_USER, password: PLANTED_MYSQL_PASS },
      deps,
    ).catch((e: unknown) => e) as import('../../../../src/core/errors.js').ConnectivityUnavailableError;

    const rendered = formatOutcome(err.outcome);
    expect(rendered).not.toContain(PLANTED_MYSQL_PASS);
  });

  it('outcome summary is content-free (does not contain planted host or user)', async () => {
    const deps: MysqlSchemaAdapterDeps = {
      createConnection: makeCreateConnection({ connectError: makePlantedMysqlError() }),
    };
    const err = await createMysqlSchemaAdapter(
      { host: PLANTED_MYSQL_HOST, database: PLANTED_MYSQL_DB, user: PLANTED_MYSQL_USER, password: PLANTED_MYSQL_PASS },
      deps,
    ).catch((e: unknown) => e) as import('../../../../src/core/errors.js').ConnectivityUnavailableError;

    expect(err.outcome.summary).not.toContain(PLANTED_MYSQL_HOST);
    expect(err.outcome.summary).not.toContain(PLANTED_MYSQL_USER);
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
