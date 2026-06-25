/**
 * Unit tests for createMongodbSchemaAdapter — the ONLY join point for the MongoDB adapter.
 * Design §factory.ts "lazy import('mongodb' as string), MongoClient.connect(), error-map, driver-wrap".
 *
 * Strategy: inject a fake MongoClientLike constructor via deps.MongoClient so no real mongodb
 * install is needed. Tests for missing-driver use a fake importMongodb that throws
 * MODULE_NOT_FOUND — proves the "npm i mongodb" message without a real absent module.
 *
 * MongoDB shape (pg/mysql-mirror): createMongodbSchemaAdapter(config, deps?) → SchemaAdapter
 *   - NO strategy registry (that is MSSQL-only)
 *   - One short-lived MongoClient per adapter instance
 *   - Lazy import('mongodb' as string) so no top-level mongodb import (ADR-006)
 *   - Missing mongodb driver → error whose message contains "npm i mongodb"
 *
 * TDD RED -> GREEN -> REFACTOR.
 *
 * Spec: "Absent mongodb driver names npm i mongodb"
 *       "Connects with a URI reference and default sample size"
 * US-030 (MongoDB adapter), ADR-006 (lazy import).
 * phase-9b-mongodb Batch 3 task 3.3.
 */

import { describe, it, expect } from 'vitest';
import type { MongodbAdapterConfig } from '../../../../src/core/ports/schema-adapter.js';
import { createMongodbSchemaAdapter } from '../../../../src/adapters/engines/mongodb/factory.js';
import { ConnectivityUnavailableError, ConnectionError } from '../../../../src/core/errors.js';
import type { MongoClientLike, DbLike } from '../../../../src/adapters/engines/mongodb/driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake MongoClientLike helpers
// ─────────────────────────────────────────────────────────────────────────────

type ConnectBehavior = 'ok' | 'auth-fail' | 'unauthorized' | 'host-fail';

/** Minimal fake DbLike — all reads return empty results. */
function makeFakeDb(): DbLike {
  return {
    listCollections: () => ({ toArray: async () => [] }),
    command: async () => ({}),
    collection: (name: string) => {
      void name;
      return {
        aggregate: (pipeline: Record<string, unknown>[]) => {
          void pipeline;
          return { toArray: async () => [] };
        },
        listIndexes: () => ({ toArray: async () => [] }),
      };
    },
  };
}

/** Return type for the fake constructor — MongoClientLike + internal capture fields. */
type FakeClientInstance = MongoClientLike & {
  readonly _capturedUri: string;
  readonly _capturedOptions: Record<string, unknown>;
};

type FakeClientCtor = {
  new(uri: string, options?: Record<string, unknown>): FakeClientInstance;
  lastInstance?: FakeClientInstance;
};

function makeFakeMongoClientCtor(opts: { connectBehavior?: ConnectBehavior } = {}): FakeClientCtor {
  const behavior = opts.connectBehavior ?? 'ok';

  class FakeMongoClient implements FakeClientInstance {
    readonly _capturedUri: string;
    readonly _capturedOptions: Record<string, unknown>;
    static lastInstance: FakeMongoClient | undefined;

    constructor(uri: string, options: Record<string, unknown> = {}) {
      this._capturedUri = uri;
      this._capturedOptions = options;
      FakeMongoClient.lastInstance = this;
    }

    async connect(): Promise<void> {
      if (behavior === 'auth-fail') {
        const e = new Error('Authentication failed.') as Error & { code: number; codeName: string };
        e.name = 'MongoServerError';
        e.code = 18;
        e.codeName = 'AuthenticationFailed';
        throw e;
      }
      if (behavior === 'unauthorized') {
        const e = new Error('not authorized') as Error & { code: number; codeName: string };
        e.name = 'MongoServerError';
        e.code = 13;
        e.codeName = 'Unauthorized';
        throw e;
      }
      if (behavior === 'host-fail') {
        const e = new Error('server selection timeout') as Error;
        e.name = 'MongoServerSelectionError';
        throw e;
      }
    }

    db(name: string): DbLike {
      void name;
      return makeFakeDb();
    }

    async close(): Promise<void> {}
  }

  return FakeMongoClient as unknown as FakeClientCtor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test configs
// ─────────────────────────────────────────────────────────────────────────────

const MINIMAL_CONFIG: MongodbAdapterConfig = {
  uri: 'mongodb://localhost:27017',
  database: 'testdb',
};

const CONFIG_WITH_TLS: MongodbAdapterConfig = {
  uri: 'mongodb://localhost:27017',
  database: 'testdb',
  tls: true,
};

const CONFIG_WITH_SAMPLE_SIZE: MongodbAdapterConfig = {
  uri: 'mongodb://localhost:27017',
  database: 'testdb',
  sampleSize: 250,
};

// ─────────────────────────────────────────────────────────────────────────────
// Successful construct
// ─────────────────────────────────────────────────────────────────────────────

describe('createMongodbSchemaAdapter() — successful connect', () => {
  it('returns a SchemaAdapter with dialect "mongodb"', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    const adapter = await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient });

    expect(adapter.dialect).toBe('mongodb');

    await adapter.close();
  });

  it('returns an adapter with capabilities.engine "mongodb"', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    const adapter = await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient });

    expect(adapter.capabilities.engine).toBe('mongodb');

    await adapter.close();
  });

  it('constructs client with the URI from config', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient });

    expect(FakeClient.lastInstance?._capturedUri).toBe('mongodb://localhost:27017');
  });

  it('passes tls option when supplied', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    await createMongodbSchemaAdapter(CONFIG_WITH_TLS, { MongoClient: FakeClient });

    expect(FakeClient.lastInstance?._capturedOptions?.['tls']).toBe(true);
  });

  it('does NOT pass tls option when omitted (exactOptionalPropertyTypes)', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient });

    expect(FakeClient.lastInstance?._capturedOptions?.['tls']).toBeUndefined();
  });

  it('accepts sampleSize in config without error', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    const adapter = await createMongodbSchemaAdapter(CONFIG_WITH_SAMPLE_SIZE, { MongoClient: FakeClient });

    expect(adapter.dialect).toBe('mongodb');
    await adapter.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing mongodb driver → ConnectivityUnavailableError (Batch 3)
// Spec: "Absent mongodb driver names npm i mongodb"
// ─────────────────────────────────────────────────────────────────────────────

function makeDriverAbsentDeps() {
  return {
    importMongodb: (): Promise<unknown> => {
      const e = Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
      return Promise.reject(e);
    },
  };
}

describe('createMongodbSchemaAdapter() — mongodb driver absent → ConnectivityUnavailableError', () => {
  it('throws ConnectivityUnavailableError when mongodb module cannot be loaded', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('ConnectivityUnavailableError code is E_CONNECTIVITY_UNAVAILABLE', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).code).toBe('E_CONNECTIVITY_UNAVAILABLE');
  });

  it('outcome.engine is "mongodb"', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.engine).toBe('mongodb');
  });

  it('outcome has exactly 3 options', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.options.length).toBe(3);
  });

  it('option kinds are exactly ["run-it-yourself","consented-install","manual-dump"]', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    const outcome = (err as ConnectivityUnavailableError).outcome;
    expect(outcome.options.map((o) => o.kind)).toEqual([
      'run-it-yourself',
      'consented-install',
      'manual-dump',
    ]);
  });

  it('consented-install option names "mongodb" as the tool', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    const outcome = (err as ConnectivityUnavailableError).outcome;
    const install = outcome.options[1];
    if (install?.kind !== 'consented-install') throw new Error('wrong kind');
    expect(install.tool).toBe('mongodb');
  });

  it('summary contains "npm i mongodb"', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.summary).toContain('npm i mongodb');
  });

  it('is NOT instanceof ConnectionError (replaced, not wrapped)', async () => {
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, makeDriverAbsentDeps()).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connect errors → ConnectivityUnavailableError (Batch 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('createMongodbSchemaAdapter() — connect errors → ConnectivityUnavailableError', () => {
  it('throws ConnectivityUnavailableError when authentication fails (code 18)', async () => {
    const FakeClient = makeFakeMongoClientCtor({ connectBehavior: 'auth-fail' });
    await expect(
      createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient }),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('throws ConnectivityUnavailableError when unauthorized (code 13)', async () => {
    const FakeClient = makeFakeMongoClientCtor({ connectBehavior: 'unauthorized' });
    await expect(
      createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient }),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('throws ConnectivityUnavailableError when host not reachable (MongoServerSelectionError)', async () => {
    const FakeClient = makeFakeMongoClientCtor({ connectBehavior: 'host-fail' });
    await expect(
      createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient }),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('connect-fail outcome has 3 options', async () => {
    const FakeClient = makeFakeMongoClientCtor({ connectBehavior: 'auth-fail' });
    const err = await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient }).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.options.length).toBe(3);
  });

  it('connect-fail outcome does NOT contain the URI in the summary (content-free)', async () => {
    const FakeClient = makeFakeMongoClientCtor({ connectBehavior: 'auth-fail' });
    const err = await createMongodbSchemaAdapter(
      { uri: 'mongodb://secret-host:27017', database: 'proddb' },
      { MongoClient: FakeClient },
    ).catch((e: unknown) => e);
    expect((err as ConnectivityUnavailableError).outcome.summary).not.toContain('secret-host');
    expect((err as ConnectivityUnavailableError).outcome.summary).not.toContain('proddb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Adapter lifecycle — close() is idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe('createMongodbSchemaAdapter() — adapter lifecycle', () => {
  it('close() does not throw on first call', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    const adapter = await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient });

    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('close() is idempotent (second call does not throw)', async () => {
    const FakeClient = makeFakeMongoClientCtor();
    const adapter = await createMongodbSchemaAdapter(MINIMAL_CONFIG, { MongoClient: FakeClient });

    await adapter.close();
    await expect(adapter.close()).resolves.not.toThrow();
  });
});
