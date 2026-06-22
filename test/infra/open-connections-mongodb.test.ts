/**
 * open-connections.ts — unit tests for mongodb dispatch branch (Batch 5, task 5.1).
 * STRICT TDD: RED → GREEN
 *
 * Verifies that openConnections() for a 'mongodb' config calls createMongodbSchemaAdapter
 * and returns an AdapterAndStore with a MongodbSchemaAdapter.
 *
 * Uses a fake fs + fake mongodb factory to avoid live DB connections.
 * The mongodb branch must NOT throw the Batch-2 "not wired yet" error.
 *
 * Spec: composition-root wiring (schema-extraction "Supported dialects recognize mongodb").
 * US-030, ADR-004.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted is required for values used inside vi.mock() factory functions,
// because vi.mock() is hoisted to the top of the file by Vitest.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const fakeMongodbAdapterShape = {
    dialect: 'mongodb' as const,
    get capabilities() { return {} as import('../../src/core/model/capability.js').CapabilityMatrix; },
    async extract() { return { engine: 'mongodb', schemas: [], objects: [] }; },
    async fingerprint() { return 'deadbeef01234567deadbeef01234567deadbeef01234567deadbeef01234567'; },
    async close() { /* no-op */ },
  };

  const fakeStore = {
    async close(): Promise<void> { /* no-op */ },
    async upsertGraph(): Promise<void> { /* no-op */ },
  };

  const createMongodbSchemaAdapterMock = vi.fn().mockResolvedValue(fakeMongodbAdapterShape);
  const createSqliteGraphStoreMock = vi.fn().mockResolvedValue(fakeStore);

  const configJson = JSON.stringify({
    dialect: 'mongodb',
    source: {
      uri: '${env:MONGODB_URI}',
      database: 'testdb',
    },
  });

  return {
    fakeMongodbAdapterShape,
    fakeStore,
    createMongodbSchemaAdapterMock,
    createSqliteGraphStoreMock,
    configJson,
  };
});

vi.mock('../../src/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/index.js')>();
  return {
    ...real,
    createMongodbSchemaAdapter: mocks.createMongodbSchemaAdapterMock,
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

// Set env var for URI resolution
process.env['MONGODB_URI'] = 'mongodb://localhost:27017';

import { openConnections } from '../../src/infra/open-connections.js';

describe('openConnections — mongodb dialect wiring (task 5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['MONGODB_URI'] = 'mongodb://localhost:27017';
    mocks.createMongodbSchemaAdapterMock.mockResolvedValue(mocks.fakeMongodbAdapterShape);
    mocks.createSqliteGraphStoreMock.mockResolvedValue(mocks.fakeStore);
  });

  it('does NOT throw "not wired yet" for mongodb dialect', async () => {
    await expect(openConnections('/fake/project')).resolves.toBeDefined();
  });

  it('calls createMongodbSchemaAdapter for mongodb dialect', async () => {
    await openConnections('/fake/project');
    expect(mocks.createMongodbSchemaAdapterMock).toHaveBeenCalledOnce();
  });

  it('returns an adapter with dialect "mongodb"', async () => {
    const { adapter } = await openConnections('/fake/project');
    expect(adapter.dialect).toBe('mongodb');
  });

  it('returns a store alongside the mongodb adapter', async () => {
    const { store } = await openConnections('/fake/project');
    expect(store).toBeDefined();
    expect(typeof store.close).toBe('function');
  });

  it('passes resolved uri (not env ref) to createMongodbSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createMongodbSchemaAdapterMock.mock.calls[0] as [{ uri: string }];
    // uri must be the resolved value, not the ${env:MONGODB_URI} literal
    expect(config.uri).toBe('mongodb://localhost:27017');
  });

  it('passes the correct database to createMongodbSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createMongodbSchemaAdapterMock.mock.calls[0] as [{ database: string }];
    expect(config.database).toBe('testdb');
  });
});
