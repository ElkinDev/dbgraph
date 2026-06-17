/**
 * Factory tests — createMssqlSchemaAdapter with vi.mock('mssql').
 * Covers: successful construct, login-failed, Kerberos-attempted.
 *
 * vi.mock is hoisted by Vitest so the factory sees the mock when it calls
 * await import('mssql'). Factory is in a separate test file from the
 * missing-driver test to avoid mock contamination.
 *
 * Design §"factory.ts: lazy import('mssql'), pool connect, error map".
 * TDD: RED → GREEN. US-027 (SQL Server adapter).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock mssql with a controllable ConnectionPool
// ─────────────────────────────────────────────────────────────────────────────

// Mutable state for the mock — modified per-test via connectBehavior
let connectBehavior: 'ok' | 'login-failed' | 'kerberos' = 'ok';

// Track the last constructed pool for inspection
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
    const adapter = await createMssqlSchemaAdapter(SQL_CONFIG);

    expect(adapter.dialect).toBe('mssql');

    await adapter.close();
  });

  it('returns an adapter with capabilities.engine "mssql"', async () => {
    const adapter = await createMssqlSchemaAdapter(SQL_CONFIG);

    expect(adapter.capabilities.engine).toBe('mssql');

    await adapter.close();
  });

  it('constructs pool with server from config', async () => {
    await createMssqlSchemaAdapter(SQL_CONFIG);

    expect(lastPoolConfig).not.toBeNull();
    expect(lastPoolConfig).toMatchObject({ server: 'localhost' });
  });

  it('constructs pool with database from config', async () => {
    await createMssqlSchemaAdapter(SQL_CONFIG);

    expect(lastPoolConfig).toMatchObject({ database: 'testdb' });
  });

  it('accepts NTLM authentication config', async () => {
    const adapter = await createMssqlSchemaAdapter(NTLM_CONFIG);

    expect(adapter.dialect).toBe('mssql');

    await adapter.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login failed → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('createMssqlSchemaAdapter() — login failed', () => {
  beforeEach(() => {
    connectBehavior = 'login-failed';
    lastPoolConfig = null;
  });

  it('throws ConnectionError (E_CONNECTION) on ELOGIN', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('ConnectionError message mentions credentials', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError &&
        /credential|login|password|user/i.test(e.message),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kerberos attempted → ConnectionError (SSO unsupported)
// ─────────────────────────────────────────────────────────────────────────────

describe('createMssqlSchemaAdapter() — Kerberos / SSO unsupported', () => {
  beforeEach(() => {
    connectBehavior = 'kerberos';
    lastPoolConfig = null;
  });

  it('throws ConnectionError when Kerberos auth is attempted', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError && e.code === 'E_CONNECTION',
    );
  });

  it('ConnectionError message mentions SSO or Kerberos', async () => {
    await expect(
      createMssqlSchemaAdapter(SQL_CONFIG),
    ).rejects.toSatisfy(
      (e: unknown): e is ConnectionError =>
        e instanceof ConnectionError &&
        /sso|kerberos|sql|ntlm|unsupported/i.test(e.message),
    );
  });
});
