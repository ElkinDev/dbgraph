/**
 * Unit tests for MysqlSchemaAdapter.extract() and fingerprint() —
 * using an INJECTED FAKE driver returning Batch-4 fixture rows (NO live mysql2).
 *
 * Verifies:
 *   - extract() returns a RawCatalog with engine:'mysql'
 *   - RawCatalog.schemas = ['app']  (schema == database)
 *   - ZERO sequence objects
 *   - fingerprint() returns a 64-char hex string from a single mocked query
 *   - close() is idempotent; extract/fingerprint after close() throw ConnectionError
 *
 * Task 4.5, mysql-extraction spec §lifecycle.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MysqlSchemaAdapter } from '../../../../src/adapters/engines/mysql/mysql-schema-adapter.js';
import type { MysqlReadonlyDriver } from '../../../../src/adapters/engines/mysql/driver.js';
import { ConnectionError } from '../../../../src/core/errors.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, '../../../fixtures/mysql/rows');

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, filename), 'utf-8')) as T;
}

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    functions: 'full',
    procedures: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'off',
    fields: 'off',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Build a fake driver from fixture rows
// ─────────────────────────────────────────────────────────────────────────────

function buildFakeDriver(opts: {
  fingerprintRow?: Record<string, unknown>;
  queryError?: Error;
} = {}): MysqlReadonlyDriver {
  const tables = loadJson('tables.json');
  const columns = loadJson('columns.json');
  const pkUk = loadJson('pk-uk-columns.json');
  const fk = loadJson('fk-columns.json');
  const check = loadJson('check-constraints.json');
  const stats = loadJson('statistics.json');
  const views = loadJson('views.json');
  const routines = loadJson('routines.json');
  const triggers = loadJson('triggers.json');

  const fingerprintRow = opts.fingerprintRow ?? {
    table_count: 4,
    column_count: 12,
    routine_count: 3,
  };

  // Map SQL constants to fixture data by SQL content keywords
  const queryFn = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
    if (opts.queryError !== undefined) throw opts.queryError;

    if (sql.includes('TABLE_TYPE') && sql.includes('TABLE_COMMENT')) return tables as Record<string, unknown>[];
    if (sql.includes('ORDINAL_POSITION') && sql.includes('COLUMN_TYPE')) return columns as Record<string, unknown>[];
    if (sql.includes('PRIMARY KEY') && sql.includes('ORDINAL_POSITION') && !sql.includes('REFERENCED')) return pkUk as Record<string, unknown>[];
    if (sql.includes('REFERENCED_TABLE_NAME')) return fk as Record<string, unknown>[];
    if (sql.includes('CHECK_CLAUSE')) return check as Record<string, unknown>[];
    if (sql.includes('SEQ_IN_INDEX')) return stats as Record<string, unknown>[];
    if (sql.includes('VIEW_DEFINITION')) return views as Record<string, unknown>[];
    if (sql.includes('ROUTINE_TYPE') && sql.includes('ROUTINE_DEFINITION')) return routines as Record<string, unknown>[];
    if (sql.includes('ACTION_TIMING')) return triggers as Record<string, unknown>[];
    if (sql.includes('table_count') && sql.includes('column_count')) return [fingerprintRow];

    return [];
  });

  return {
    query: queryFn,
    close: vi.fn(async () => undefined),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// extract() tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MysqlSchemaAdapter.extract()', () => {
  it('returns a RawCatalog with engine:mysql', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    const catalog = await adapter.extract(FULL_SCOPE);
    expect(catalog.engine).toBe('mysql');
  });

  it('Spec: RawCatalog.schemas = [database] (schema == database)', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    const catalog = await adapter.extract(FULL_SCOPE);
    expect(catalog.schemas).toEqual(['app']);
  });

  it('Spec: ZERO sequence objects in the catalog', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    const catalog = await adapter.extract(FULL_SCOPE);
    expect(catalog.objects.filter((o) => o.kind === 'sequence')).toHaveLength(0);
  });

  it('catalog contains tables from fixture', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    const catalog = await adapter.extract(FULL_SCOPE);
    const tables = catalog.objects.filter((o) => o.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(4);
  });

  it('throws ConnectionError after close()', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    await adapter.close();
    await expect(adapter.extract(FULL_SCOPE)).rejects.toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fingerprint() tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MysqlSchemaAdapter.fingerprint()', () => {
  it('Spec: returns a 64-char hex string', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    const fp = await adapter.fingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Spec: fingerprint changes when table_count changes', async () => {
    const driver1 = buildFakeDriver({ fingerprintRow: { table_count: 4, column_count: 12, routine_count: 3 } });
    const driver2 = buildFakeDriver({ fingerprintRow: { table_count: 5, column_count: 12, routine_count: 3 } });
    const fp1 = await new MysqlSchemaAdapter(driver1, 'app').fingerprint();
    const fp2 = await new MysqlSchemaAdapter(driver2, 'app').fingerprint();
    expect(fp1).not.toBe(fp2);
  });

  it('Spec: fingerprint changes when column_count changes (ADD COLUMN sensitivity)', async () => {
    const driver1 = buildFakeDriver({ fingerprintRow: { table_count: 4, column_count: 12, routine_count: 3 } });
    const driver2 = buildFakeDriver({ fingerprintRow: { table_count: 4, column_count: 13, routine_count: 3 } });
    const fp1 = await new MysqlSchemaAdapter(driver1, 'app').fingerprint();
    const fp2 = await new MysqlSchemaAdapter(driver2, 'app').fingerprint();
    expect(fp1).not.toBe(fp2);
  });

  it('Spec: fingerprint is stable when counts do not change (DML stability)', async () => {
    const driver1 = buildFakeDriver({ fingerprintRow: { table_count: 4, column_count: 12, routine_count: 3 } });
    const driver2 = buildFakeDriver({ fingerprintRow: { table_count: 4, column_count: 12, routine_count: 3 } });
    const fp1 = await new MysqlSchemaAdapter(driver1, 'app').fingerprint();
    const fp2 = await new MysqlSchemaAdapter(driver2, 'app').fingerprint();
    expect(fp1).toBe(fp2);
  });

  it('throws ConnectionError after close()', async () => {
    const driver = buildFakeDriver();
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    await adapter.close();
    await expect(adapter.fingerprint()).rejects.toBeInstanceOf(ConnectionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// close() idempotence
// ─────────────────────────────────────────────────────────────────────────────

describe('MysqlSchemaAdapter.close()', () => {
  it('close() is idempotent — second call is a no-op', async () => {
    const closeMock = vi.fn(async () => undefined);
    const driver: MysqlReadonlyDriver = {
      query: vi.fn(async () => []),
      close: closeMock,
    };
    const adapter = new MysqlSchemaAdapter(driver, 'app');
    await adapter.close();
    await adapter.close(); // second call must not throw
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
