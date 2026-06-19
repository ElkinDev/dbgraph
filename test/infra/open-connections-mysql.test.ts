/**
 * open-connections.ts — unit tests for mysql dispatch branch (Batch 5, task 5.1).
 * STRICT TDD: RED → GREEN
 *
 * Verifies that openConnections() for a 'mysql' config calls createMysqlSchemaAdapter
 * and returns an AdapterAndStore with a MysqlSchemaAdapter.
 *
 * Uses a fake fs + fake mysql factory to avoid live DB connections.
 * The mysql branch must NOT throw the Batch-2 "not wired yet" error.
 *
 * Spec: composition-root wiring (schema-extraction "Supported dialects recognize mysql").
 * US-029, ADR-004.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted is required for values used inside vi.mock() factory functions,
// because vi.mock() is hoisted to the top of the file by Vitest.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const fakeMysqlDriver = {
    async query(): Promise<Record<string, unknown>[]> { return []; },
    async close(): Promise<void> { /* no-op */ },
  };

  // We can't import MysqlSchemaAdapter here (hoisted context), so we build a plain
  // object with the correct shape and cast it when needed in tests.
  const fakeMysqlAdapterShape = {
    dialect: 'mysql' as const,
    get capabilities() { return {} as import('../../src/core/model/capability.js').CapabilityMatrix; },
    async extract() { return { engine: 'mysql', schemas: [], objects: [] }; },
    async fingerprint() { return 'abc123'; },
    async close() { /* no-op */ },
    _driver: fakeMysqlDriver,
    _database: 'testdb',
    _closed: false,
  };

  const fakeStore = {
    async close(): Promise<void> { /* no-op */ },
    async upsertGraph(): Promise<void> { /* no-op */ },
  };

  const createMysqlSchemaAdapterMock = vi.fn().mockResolvedValue(fakeMysqlAdapterShape);
  const createSqliteGraphStoreMock = vi.fn().mockResolvedValue(fakeStore);

  const configJson = JSON.stringify({
    dialect: 'mysql',
    source: {
      host: 'localhost',
      database: 'testdb',
      user: 'testuser',
      password: '${env:MYSQL_PASSWORD}',
    },
  });

  return {
    fakeMysqlAdapterShape,
    fakeStore,
    createMysqlSchemaAdapterMock,
    createSqliteGraphStoreMock,
    configJson,
  };
});

vi.mock('../../src/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/index.js')>();
  return {
    ...real,
    createMysqlSchemaAdapter: mocks.createMysqlSchemaAdapterMock,
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
process.env['MYSQL_PASSWORD'] = 'mysecret456';

import { openConnections } from '../../src/infra/open-connections.js';

describe('openConnections — mysql dialect wiring (task 5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['MYSQL_PASSWORD'] = 'mysecret456';
    mocks.createMysqlSchemaAdapterMock.mockResolvedValue(mocks.fakeMysqlAdapterShape);
    mocks.createSqliteGraphStoreMock.mockResolvedValue(mocks.fakeStore);
  });

  it('does NOT throw "not wired yet" for mysql dialect', async () => {
    await expect(openConnections('/fake/project')).resolves.toBeDefined();
  });

  it('calls createMysqlSchemaAdapter for mysql dialect', async () => {
    await openConnections('/fake/project');
    expect(mocks.createMysqlSchemaAdapterMock).toHaveBeenCalledOnce();
  });

  it('returns an adapter with dialect "mysql"', async () => {
    const { adapter } = await openConnections('/fake/project');
    expect(adapter.dialect).toBe('mysql');
  });

  it('returns a store alongside the mysql adapter', async () => {
    const { store } = await openConnections('/fake/project');
    expect(store).toBeDefined();
    expect(typeof store.close).toBe('function');
  });

  it('passes resolved host to createMysqlSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createMysqlSchemaAdapterMock.mock.calls[0] as [{ host: string }];
    expect(config.host).toBe('localhost');
  });

  it('passes resolved password (not env ref) to createMysqlSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createMysqlSchemaAdapterMock.mock.calls[0] as [{ password: string }];
    // password must be the resolved value, not the ${env:MYSQL_PASSWORD} literal
    expect(config.password).toBe('mysecret456');
  });

  it('passes the correct database to createMysqlSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createMysqlSchemaAdapterMock.mock.calls[0] as [{ database: string }];
    expect(config.database).toBe('testdb');
  });

  it('passes the correct user to createMysqlSchemaAdapter', async () => {
    await openConnections('/fake/project');
    const [config] = mocks.createMysqlSchemaAdapterMock.mock.calls[0] as [{ user: string }];
    expect(config.user).toBe('testuser');
  });
});
