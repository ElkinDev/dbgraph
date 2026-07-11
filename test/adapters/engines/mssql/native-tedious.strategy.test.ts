/**
 * Unit tests for NativeTediousStrategy interop-safe mssql resolution.
 *
 * Bug 2 (shipped-artifact-fixes): the bundled CJS dist resolves `await import('mssql')`
 * under Node's CJS→ESM interop, which exposes the CommonJS module ONLY under `.default`.
 * A raw `const { ConnectionPool } = mssqlMod` destructure yields `undefined` →
 * `new undefined()` for every SQL-auth config. The strategy MUST resolve
 * `ConnectionPool` interop-safely (namespace OR `.default`), matching the pg/mysql2/
 * mongodb factory pattern (ADR-006).
 *
 * Strategy: inject a fake `mssql` module via the `importModule` deps seam (routed
 * through loadOptionalDriver, mirroring pg's importPg). No real mssql install needed —
 * this is the Docker-free proxy for the dist-level RED (Batch 2 / dist-connect.integration).
 *
 * mssql-extraction spec:
 *   "ConnectionPool resolves when the driver arrives under `.default` (bundled-CJS shape)"
 *   "ConnectionPool resolves when the driver exposes a top-level named export (ESM/vitest shape)"
 *   "Absent driver still names the install command (unchanged behavior)"
 */

import { describe, it, expect } from 'vitest';
import type { MssqlAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import { NativeTediousStrategy } from '../../../../src/adapters/engines/mssql/strategies/native-tedious.strategy.js';
import { ConnectionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake mssql ConnectionPool constructor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal fake mssql.ConnectionPool. connect() resolves to itself (a REAL pool
 * object), so a successful build proves the constructor was resolved — never
 * `new undefined()`. Records every constructed instance + captured config.
 */
function makeFakePoolCtor(): {
  new (cfg: unknown): {
    connect(): Promise<unknown>;
    request(): { query(sql: string): Promise<{ recordset: Record<string, unknown>[] }> };
    close(): Promise<void>;
    _capturedConfig: unknown;
  };
  instances: Array<{ _capturedConfig: unknown }>;
} {
  const instances: Array<{ _capturedConfig: unknown }> = [];

  class FakePool {
    readonly _capturedConfig: unknown;
    constructor(cfg: unknown) {
      this._capturedConfig = cfg;
      instances.push(this);
    }
    async connect(): Promise<this> {
      return this;
    }
    request(): { query(sql: string): Promise<{ recordset: Record<string, unknown>[] }> } {
      return { query: async (): Promise<{ recordset: Record<string, unknown>[] }> => ({ recordset: [] }) };
    }
    async close(): Promise<void> {}
  }

  const ctor = FakePool as unknown as ReturnType<typeof makeFakePoolCtor>;
  ctor.instances = instances;
  return ctor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test config — SQL authentication (the shipped-artifact defect path)
// ─────────────────────────────────────────────────────────────────────────────

const SQL_CONFIG: MssqlAdapterConfig = {
  server: 'localhost',
  database: 'testdb',
  authentication: { type: 'sql', user: 'sa', password: 'resolvedPassword' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: bundled-CJS interop shape { default: { ConnectionPool } }
// This is the RED case — a raw `const { ConnectionPool } = mssqlMod` destructure
// yields undefined → `new undefined()`.
// ─────────────────────────────────────────────────────────────────────────────

describe('NativeTediousStrategy — bundled-CJS interop shape ({ default: { ConnectionPool } })', () => {
  it('resolves ConnectionPool from .default and builds a real pool (never new undefined())', async () => {
    const FakePool = makeFakePoolCtor();
    const strategy = new NativeTediousStrategy(SQL_CONFIG, {
      importModule: () => ({ default: { ConnectionPool: FakePool } }),
    });

    await expect(strategy.canConnect()).resolves.toBe(true);
    expect(FakePool.instances).toHaveLength(1);
  });

  it('passes the built pool config (server/database/user/password) to the resolved constructor', async () => {
    const FakePool = makeFakePoolCtor();
    const strategy = new NativeTediousStrategy(SQL_CONFIG, {
      importModule: () => ({ default: { ConnectionPool: FakePool } }),
    });

    await strategy.canConnect();

    const cfg = FakePool.instances[0]?._capturedConfig as Record<string, unknown>;
    expect(cfg['server']).toBe('localhost');
    expect(cfg['database']).toBe('testdb');
    expect(cfg['user']).toBe('sa');
    expect(cfg['password']).toBe('resolvedPassword');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: ESM / vitest top-level named-export shape { ConnectionPool }
// Must resolve WITHOUT relying on .default (no regression for the src/vitest path).
// ─────────────────────────────────────────────────────────────────────────────

describe('NativeTediousStrategy — ESM/vitest top-level shape ({ ConnectionPool })', () => {
  it('resolves ConnectionPool from the namespace top level and builds a real pool', async () => {
    const FakePool = makeFakePoolCtor();
    const strategy = new NativeTediousStrategy(SQL_CONFIG, {
      importModule: () => ({ ConnectionPool: FakePool }),
    });

    await expect(strategy.canConnect()).resolves.toBe(true);
    expect(FakePool.instances).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: absent mssql driver still names `npm i mssql` (unchanged behavior)
// ─────────────────────────────────────────────────────────────────────────────

describe('NativeTediousStrategy — absent mssql driver', () => {
  it('re-throws a ConnectionError whose message contains the exact `npm i mssql` command', async () => {
    const strategy = new NativeTediousStrategy(SQL_CONFIG, {
      importModule: () => {
        throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
      },
    });

    const err = await strategy.canConnect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as ConnectionError).message).toContain('npm i mssql');
  });
});
