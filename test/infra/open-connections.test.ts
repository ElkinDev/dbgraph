/**
 * open-connections.ts — unit tests for pg dispatch branch (Batch 5, task 5.2).
 * STRICT TDD: RED → GREEN
 *
 * Verifies that openConnections() for a 'pg' config calls createPgSchemaAdapter
 * and returns an AdapterAndStore with a PgSchemaAdapter.
 *
 * Uses a fake fs + fake pg factory to avoid live DB connections.
 * The pg branch must NOT throw the Batch-2 "not wired yet" error.
 *
 * Spec: composition-root wiring (schema-extraction "Supported dialects recognize pg").
 * US-028, ADR-004.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted is required for values used inside vi.mock() factory functions,
// because vi.mock() is hoisted to the top of the file by Vitest.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const fakePgDriver = {
    async query(): Promise<Record<string, unknown>[]> { return []; },
    async close(): Promise<void> { /* no-op */ },
  };

  // We can't import PgSchemaAdapter here (hoisted context), so we build a plain
  // object with the correct shape and cast it when needed in tests.
  const fakePgAdapterShape = {
    dialect: 'pg' as const,
    get capabilities() { return {} as import('../../src/core/model/capability.js').CapabilityMatrix; },
    async extract() { return { engine: 'pg', schemas: [], objects: [] }; },
    async fingerprint() { return 'abc123'; },
    async close() { /* no-op */ },
    _driver: fakePgDriver,
    _schema: null,
    _closed: false,
  };

  const fakeStore = {
    async close(): Promise<void> { /* no-op */ },
    async upsertGraph(): Promise<void> { /* no-op */ },
  };

  const createPgSchemaAdapterMock = vi.fn().mockResolvedValue(fakePgAdapterShape);
  const createSqliteGraphStoreMock = vi.fn().mockResolvedValue(fakeStore);

  const configJson = JSON.stringify({
    dialect: 'pg',
    source: {
      host: 'localhost',
      database: 'testdb',
      user: 'testuser',
      password: '${env:PG_PASSWORD}',
    },
  });

  return {
    fakePgAdapterShape,
    fakeStore,
    createPgSchemaAdapterMock,
    createSqliteGraphStoreMock,
    configJson,
  };
});

vi.mock('../../src/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/index.js')>();
  return {
    ...real,
    createPgSchemaAdapter: mocks.createPgSchemaAdapterMock,
    createSqliteGraphStore: mocks.createSqliteGraphStoreMock,
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    readFileSync: vi.fn((path: string) => {
      if (String(path).endsWith('dbgraph.config.json')) {
        return mocks.configJson;
      }
      throw new Error(`ENOENT: ${path}`);
    }),
    mkdirSync: vi.fn(),
  };
});

// Set env var for password resolution
process.env['PG_PASSWORD'] = 'secret123';

import { openConnections } from '../../src/infra/open-connections.js';

describe('openConnections — pg dialect wiring (task 5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['PG_PASSWORD'] = 'secret123';
    mocks.createPgSchemaAdapterMock.mockResolvedValue(mocks.fakePgAdapterShape);
    mocks.createSqliteGraphStoreMock.mockResolvedValue(mocks.fakeStore);
  });

  it('does NOT throw "not wired yet" for pg dialect', async () => {
    await expect(openConnections('/fake/project')).resolves.toBeDefined();
  });

  it('calls createPgSchemaAdapter for pg dialect', async () => {
    await openConnections('/fake/project');
    expect(mocks.createPgSchemaAdapterMock).toHaveBeenCalledOnce();
  });

  it('returns an adapter with dialect "pg"', async () => {
    const { adapter } = await openConnections('/fake/project');
    expect(adapter.dialect).toBe('pg');
  });

  it('returns a store alongside the pg adapter', async () => {
    const { store } = await openConnections('/fake/project');
    expect(store).toBeDefined();
    expect(typeof store.close).toBe('function');
  });

  it('passes resolved host to createPgSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createPgSchemaAdapterMock.mock.calls[0] as [{ host: string }];
    expect(config.host).toBe('localhost');
  });

  it('passes resolved password (not env ref) to createPgSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createPgSchemaAdapterMock.mock.calls[0] as [{ password: string }];
    // password must be the resolved value, not the ${env:PG_PASSWORD} literal
    expect(config.password).toBe('secret123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase-9.5c task 1.6 — SEA store-driver flip (design D2)
// Under a SEA binary the local store MUST open on the in-binary node:sqlite driver;
// off-SEA the default stays better-sqlite3 (byte-identical, ADR-008). isSea is an
// INJECTABLE seam. The store flip is dialect-independent (asserted via the pg config).
// ─────────────────────────────────────────────────────────────────────────────

describe('openConnections — SEA store-driver flip (design D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['PG_PASSWORD'] = 'secret123';
    mocks.createPgSchemaAdapterMock.mockResolvedValue(mocks.fakePgAdapterShape);
    mocks.createSqliteGraphStoreMock.mockResolvedValue(mocks.fakeStore);
  });

  it('passes driver:"node:sqlite" to createSqliteGraphStore when isSea() is true', async () => {
    await openConnections('/fake/project', undefined, { isSea: () => true });
    const [opts] = mocks.createSqliteGraphStoreMock.mock.calls[0] as [{ path: string; driver?: string }];
    expect(opts.driver).toBe('node:sqlite');
    expect(opts.path.endsWith('dbgraph.db')).toBe(true);
  });

  it('passes NO driver key when isSea() is false (npm default better-sqlite3 preserved)', async () => {
    await openConnections('/fake/project', undefined, { isSea: () => false });
    const [opts] = mocks.createSqliteGraphStoreMock.mock.calls[0] as [{ path: string; driver?: string }];
    // exactOptionalPropertyTypes: the key must be ABSENT (not `driver: undefined`).
    expect('driver' in opts).toBe(false);
    expect(opts.path.endsWith('dbgraph.db')).toBe(true);
  });
});
