/**
 * Unit tests for createPgSchemaAdapter — the ONLY join point for the PG adapter.
 * Design §factory.ts "lazy import('pg'), Client.connect(), error-map, driver-wrap".
 *
 * Strategy: inject a fake ClientLike constructor via deps.Client so no real pg
 * install is needed. Tests for missing-driver use a fake import that throws
 * MODULE_NOT_FOUND — proves the "npm i pg" message without a real absent module.
 *
 * PG shape (SQLite-mirror): createPgSchemaAdapter(config, deps?) → SchemaAdapter
 *   - NO strategy registry (that is MSSQL-only)
 *   - One short-lived pg.Client per adapter instance
 *   - Lazy import('pg' as string) so no top-level pg import (ADR-006)
 *   - Missing pg driver → ConnectionError whose message contains "npm i pg"
 *
 * TDD: RED (factory.ts does not exist yet) → GREEN → REFACTOR.
 *
 * Spec: "Absent pg driver names npm i pg"
 *       "Connects with explicit credentials and default port"
 *       "Authentication failure raises an actionable ConnectionError"
 * US-028 (PostgreSQL adapter), ADR-006 (lazy import).
 */

import { describe, it, expect } from 'vitest';
import type { PgAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import { createPgSchemaAdapter } from '../../../../src/adapters/engines/pg/factory.js';
import { ConnectionError, PermissionError } from '../../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake ClientLike helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fake pg.Client constructor that tracks calls and supports connect/query/end. */
function makeFakeClientCtor(opts: {
  connectBehavior?: 'ok' | 'auth-fail' | 'permission-fail' | 'db-missing' | 'network-fail';
  rows?: Record<string, unknown>[];
} = {}): {
  new(config: Record<string, unknown>): {
    connect(): Promise<void>;
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
    _capturedConfig: Record<string, unknown>;
  };
  lastInstance?: InstanceType<ReturnType<typeof makeFakeClientCtor>>;
} {
  const behavior = opts.connectBehavior ?? 'ok';
  const rows = opts.rows ?? [];

  class FakeClient {
    readonly _capturedConfig: Record<string, unknown>;
    static lastInstance: FakeClient | undefined;

    constructor(config: Record<string, unknown>) {
      this._capturedConfig = config;
      FakeClient.lastInstance = this;
    }

    async connect(): Promise<void> {
      if (behavior === 'auth-fail') {
        const e = new Error('password authentication failed') as Error & { code: string };
        e.code = '28P01';
        throw e;
      }
      if (behavior === 'permission-fail') {
        const e = new Error('permission denied') as Error & { code: string };
        e.code = '42501';
        throw e;
      }
      if (behavior === 'db-missing') {
        const e = new Error('database "nosuchdb" does not exist') as Error & { code: string };
        e.code = '3D000';
        throw e;
      }
      if (behavior === 'network-fail') {
        const e = new Error('connect ECONNREFUSED') as Error & { code: string };
        e.code = '08001';
        throw e;
      }
      // 'ok' — do nothing
    }

    async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
      void sql;
      return { rows };
    }

    async end(): Promise<void> {}
  }

  return FakeClient as ReturnType<typeof makeFakeClientCtor>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test config (password already resolved — factory receives a plain string)
// ─────────────────────────────────────────────────────────────────────────────

const MINIMAL_CONFIG: PgAdapterConfig = {
  host: 'localhost',
  database: 'testdb',
  user: 'pguser',
  password: 'resolvedPassword',
};

const CONFIG_WITH_PORT: PgAdapterConfig = {
  host: 'db.example.com',
  port: 5433,
  database: 'app',
  user: 'app_user',
  password: 'resolvedPassword',
};

const CONFIG_WITH_SSL: PgAdapterConfig = {
  host: 'db.example.com',
  database: 'app',
  user: 'u',
  password: 'resolvedPassword',
  ssl: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Successful construct
// ─────────────────────────────────────────────────────────────────────────────

describe('createPgSchemaAdapter() — successful connect', () => {
  it('returns a SchemaAdapter with dialect "pg"', async () => {
    const FakeClient = makeFakeClientCtor();
    const adapter = await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    expect(adapter.dialect).toBe('pg');

    await adapter.close();
  });

  it('returns an adapter with capabilities.engine "pg"', async () => {
    const FakeClient = makeFakeClientCtor();
    const adapter = await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    expect(adapter.capabilities.engine).toBe('pg');

    await adapter.close();
  });

  it('constructs client with host from config', async () => {
    const FakeClient = makeFakeClientCtor();
    await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    const cfg = FakeClient.lastInstance?._capturedConfig;
    expect(cfg?.['host']).toBe('localhost');
  });

  it('constructs client with database from config', async () => {
    const FakeClient = makeFakeClientCtor();
    await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    const cfg = FakeClient.lastInstance?._capturedConfig;
    expect(cfg?.['database']).toBe('testdb');
  });

  it('defaults port to 5432 when not supplied', async () => {
    const FakeClient = makeFakeClientCtor();
    await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    const cfg = FakeClient.lastInstance?._capturedConfig;
    expect(cfg?.['port']).toBe(5432);
  });

  it('uses explicit port when supplied', async () => {
    const FakeClient = makeFakeClientCtor();
    await createPgSchemaAdapter(CONFIG_WITH_PORT, { Client: FakeClient });

    const cfg = FakeClient.lastInstance?._capturedConfig;
    expect(cfg?.['port']).toBe(5433);
  });

  it('passes ssl when supplied', async () => {
    const FakeClient = makeFakeClientCtor();
    await createPgSchemaAdapter(CONFIG_WITH_SSL, { Client: FakeClient });

    const cfg = FakeClient.lastInstance?._capturedConfig;
    expect(cfg?.['ssl']).toBe(true);
  });

  it('passes user and password to client constructor', async () => {
    const FakeClient = makeFakeClientCtor();
    await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    const cfg = FakeClient.lastInstance?._capturedConfig;
    expect(cfg?.['user']).toBe('pguser');
    expect(cfg?.['password']).toBe('resolvedPassword');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing pg driver → ConnectionError with "npm i pg"
// Spec: "Absent pg driver names npm i pg"
// ─────────────────────────────────────────────────────────────────────────────

describe('createPgSchemaAdapter() — missing pg driver', () => {
  it('throws ConnectionError when pg module cannot be loaded', async () => {
    const err = await createPgSchemaAdapter(MINIMAL_CONFIG, {
      importPg: () => { throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' }); },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('ConnectionError message contains exactly "npm i pg"', async () => {
    const err = await createPgSchemaAdapter(MINIMAL_CONFIG, {
      importPg: () => { throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' }); },
    }).catch((e: unknown) => e);

    expect((err as ConnectionError).message).toContain('npm i pg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connect errors → typed errors via mapPgError
// Spec: "Authentication failure raises an actionable ConnectionError"
// ─────────────────────────────────────────────────────────────────────────────

describe('createPgSchemaAdapter() — connect errors', () => {
  it('throws ConnectionError when authentication fails (28P01)', async () => {
    const FakeClient = makeFakeClientCtor({ connectBehavior: 'auth-fail' });
    await expect(
      createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient }),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it('throws PermissionError when privilege missing (42501)', async () => {
    const FakeClient = makeFakeClientCtor({ connectBehavior: 'permission-fail' });
    await expect(
      createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('throws ConnectionError when database missing (3D000)', async () => {
    const FakeClient = makeFakeClientCtor({ connectBehavior: 'db-missing' });
    await expect(
      createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient }),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it('throws ConnectionError when network unreachable (08001)', async () => {
    const FakeClient = makeFakeClientCtor({ connectBehavior: 'network-fail' });
    await expect(
      createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient }),
    ).rejects.toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Adapter skeleton — close() is idempotent; extract/fingerprint after close → error
// ─────────────────────────────────────────────────────────────────────────────

describe('createPgSchemaAdapter() — adapter lifecycle', () => {
  it('close() does not throw on first call', async () => {
    const FakeClient = makeFakeClientCtor();
    const adapter = await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('close() is idempotent (second call does not throw)', async () => {
    const FakeClient = makeFakeClientCtor();
    const adapter = await createPgSchemaAdapter(MINIMAL_CONFIG, { Client: FakeClient });

    await adapter.close();
    await expect(adapter.close()).resolves.not.toThrow();
  });
});
