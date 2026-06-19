/**
 * Factory tests — createMssqlSchemaAdapter with strategy-backed registry.
 * Covers: successful construct, login-failed, Kerberos-attempted, exhaustion.
 *
 * After the Batch C rewrite, createMssqlSchemaAdapter calls buildMssqlStrategies
 * + selectStrategy. The NativeTediousStrategy does the lazy import('mssql') so
 * vi.mock('mssql') is still hoisted and intercepted at the right seam.
 *
 * SqlcmdStrategy is injected via the deps.Sqlcmd seam so tests remain deterministic
 * regardless of whether sqlcmd is present on the CI machine.
 *
 * Design §"factory.ts becomes the registry selector".
 * TDD: GREEN (seam adjustment). US-027 (SQL Server adapter).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectivityUnavailableError } from '../../../../src/core/errors.js';
import type { ConnectivityStrategy, DetectResult } from '../../../../src/core/ports/connectivity-strategy.js';
import type { MssqlAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock mssql with a controllable ConnectionPool (same as before — still used by
// NativeTediousStrategy._ensureConnected() which lazy-imports 'mssql')
// ─────────────────────────────────────────────────────────────────────────────

let connectBehavior: 'ok' | 'login-failed' | 'kerberos' = 'ok';
let lastPoolConfig: Record<string, unknown> | null = null;

vi.mock('mssql', () => {
  class ConnectionPool {
    constructor(config: Record<string, unknown>) {
      lastPoolConfig = config;
    }

    async connect(): Promise<this> {
      if (connectBehavior === 'login-failed') {
        const err = new Error('Login failed for user "testuser"') as Error & { code?: string };
        err.code = 'ELOGIN';
        throw err;
      }
      if (connectBehavior === 'kerberos') {
        const err = new Error('Kerberos authentication failed');
        throw err;
      }
      return this;
    }

    request() {
      return {
        async query(sql: string) {
          void sql;
          return { recordset: [] };
        },
      };
    }

    async close(): Promise<void> {}
  }

  return { ConnectionPool };
});

import { createMssqlSchemaAdapter } from '../../../../src/adapters/engines/mssql/factory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Stub SqlcmdStrategy — injected via deps.Sqlcmd to keep tests deterministic
// (avoids real 'where sqlcmd' / 'which sqlcmd' calls on CI machines).
// ─────────────────────────────────────────────────────────────────────────────

/** Creates a SqlcmdStrategy stub class whose detect() returns the given result. */
function makeSqlcmdStub(detectResult: DetectResult): new (config: MssqlAdapterConfig) => ConnectivityStrategy {
  return class StubSqlcmd implements ConnectivityStrategy {
    readonly id = 'sqlcmd';
    async detect(): Promise<DetectResult> { return detectResult; }
    async canConnect(): Promise<boolean> { return false; }
    async runCatalog(scope: ExtractionScope): Promise<RawCatalog> {
      void scope;
      throw new Error('StubSqlcmd.runCatalog not implemented');
    }
    async close(): Promise<void> {}
  };
}

/** Sqlcmd stub that reports unavailable — used in login-failed/kerberos/exhaustion tests. */
const SqlcmdUnavailable = makeSqlcmdStub({ available: false, detail: 'sqlcmd not installed (stubbed for test)' });

// ─────────────────────────────────────────────────────────────────────────────
// Test configs
// ─────────────────────────────────────────────────────────────────────────────

const SQL_CONFIG = {
  server: 'localhost',
  database: 'testdb',
  authentication: { type: 'sql' as const, user: 'sa', password: 'Pass1234!' },
  trustServerCertificate: true,
} as const;

const NTLM_CONFIG = {
  server: 'corpserver',
  database: 'proddb',
  authentication: {
    type: 'ntlm' as const,
    domain: 'CORP',
    user: 'svc_account',
    password: 'WinPass!',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Successful construct
// ─────────────────────────────────────────────────────────────────────────────

describe('createMssqlSchemaAdapter() — successful construct', () => {
  beforeEach(() => {
    connectBehavior = 'ok';
    lastPoolConfig = null;
  });

  it('returns a SchemaAdapter with dialect "mssql"', async () => {
    // SqlcmdStrategy injected but never reached: native wins when connectBehavior='ok'
    const adapter = await createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable });

    expect(adapter.dialect).toBe('mssql');

    await adapter.close();
  });

  it('returns an adapter with capabilities.engine "mssql"', async () => {
    const adapter = await createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable });

    expect(adapter.capabilities.engine).toBe('mssql');

    await adapter.close();
  });

  it('constructs pool with server from config', async () => {
    await createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable });

    expect(lastPoolConfig).not.toBeNull();
    expect(lastPoolConfig).toMatchObject({ server: 'localhost' });
  });

  it('constructs pool with database from config', async () => {
    await createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable });

    expect(lastPoolConfig).toMatchObject({ database: 'testdb' });
  });

  it('accepts NTLM authentication config', async () => {
    const adapter = await createMssqlSchemaAdapter(NTLM_CONFIG, { Sqlcmd: SqlcmdUnavailable });

    expect(adapter.dialect).toBe('mssql');

    await adapter.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login failed → native strategy skipped → all exhausted → StrategyExhaustionError
// ─────────────────────────────────────────────────────────────────────────────

describe('createMssqlSchemaAdapter() — login failed', () => {
  beforeEach(() => {
    connectBehavior = 'login-failed';
    lastPoolConfig = null;
  });

  it('throws ConnectivityUnavailableError when native login fails and sqlcmd unavailable (Batch 3)', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable }),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('ConnectivityUnavailableError.outcome.attempts lists native-tedious as an attempt (Batch 3)', async () => {
    const error = await createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectivityUnavailableError);
    const ex = error as ConnectivityUnavailableError;
    const ids = ex.outcome.attempts.map((a) => a.id);
    expect(ids).toContain('native-tedious');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kerberos attempted → native skipped → all exhausted → StrategyExhaustionError
// ─────────────────────────────────────────────────────────────────────────────

describe('createMssqlSchemaAdapter() — Kerberos / SSO unsupported', () => {
  beforeEach(() => {
    connectBehavior = 'kerberos';
    lastPoolConfig = null;
  });

  it('throws ConnectivityUnavailableError when Kerberos auth fails and sqlcmd unavailable (Batch 3)', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable }),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('ConnectivityUnavailableError.outcome.attempts lists native-tedious as an attempt (Batch 3)', async () => {
    const error = await createMssqlSchemaAdapter(SQL_CONFIG, { Sqlcmd: SqlcmdUnavailable })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectivityUnavailableError);
    const ex = error as ConnectivityUnavailableError;
    const ids = ex.outcome.attempts.map((a) => a.id);
    expect(ids).toContain('native-tedious');
  });
});
