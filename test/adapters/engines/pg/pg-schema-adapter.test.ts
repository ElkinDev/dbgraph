/**
 * PgSchemaAdapter — unit tests (Batch 5, task 5.1).
 * STRICT TDD: RED → GREEN → REFACTOR
 *
 * Tests use a FAKE PgReadonlyDriver that returns Batch-4 fixture rows
 * (no live pg, no DB connection). Verifies:
 *   - extract() calls driver with the catalog queries and returns a RawCatalog
 *   - extract() honours extraction levels (off / metadata / full)
 *   - fingerprint() runs exactly one query (SQL_PG_FINGERPRINT) and returns sha256
 *   - close() is idempotent
 *   - extract()/fingerprint() after close() throws ConnectionError
 *
 * US-028 (PostgreSQL adapter), US-009 (fingerprint), ADR-004, ADR-008.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PgSchemaAdapter } from '../../../../src/adapters/engines/pg/pg-schema-adapter.js';
import { ConnectionError } from '../../../../src/core/errors.js';
import type { PgReadonlyDriver } from '../../../../src/adapters/engines/pg/driver.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import { PG_CAPABILITIES } from '../../../../src/adapters/engines/pg/capabilities.js';
import {
  SQL_PG_SCHEMAS,
  SQL_PG_TABLES,
  SQL_PG_COLUMNS,
  SQL_PG_COLUMN_NAMES,
  SQL_PG_CONSTRAINTS,
  SQL_PG_INDEXES,
  SQL_PG_VIEWS,
  SQL_PG_ROUTINES,
  SQL_PG_TRIGGERS,
  SQL_PG_SEQUENCES,
  SQL_PG_FINGERPRINT,
} from '../../../../src/adapters/engines/pg/queries.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake driver
// ─────────────────────────────────────────────────────────────────────────────

/** Tracks every query call to verify fingerprint uses exactly 1 query */
function makeFakeDriver(opts: {
  fingerprintRow?: { max_oid: string; max_attnum: string; rel_count: string; attr_count: string };
  schema?: string | null;
}): PgReadonlyDriver & { queryCalls: Array<{ sql: string; params: readonly unknown[] }> } {
  const queryCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  // opts.schema is intentionally unused in the fake; real scoping is tested via queryCalls.params

  return {
    queryCalls,
    async query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]> {
      queryCalls.push({ sql, params: params ?? [] });

      if (sql === SQL_PG_FINGERPRINT) {
        const row = opts.fingerprintRow ?? { max_oid: '12345', max_attnum: '5', rel_count: '42', attr_count: '210' };
        return [row as Record<string, unknown>];
      }
      if (sql === SQL_PG_SCHEMAS) {
        return [{ schema_name: 'public' }];
      }
      if (sql === SQL_PG_TABLES) {
        return [
          { schema_name: 'public', table_name: 'users', table_oid: 1, comment: null },
        ];
      }
      if (sql === SQL_PG_COLUMNS) {
        return [
          {
            schema_name: 'public',
            table_name: 'users',
            ordinal: 1,
            column_name: 'id',
            data_type: 'integer',
            is_nullable: false,
            default_expr: null,
            identity_kind: 'a',
            generated_kind: '',
            comment: null,
          },
        ];
      }
      if (sql === SQL_PG_COLUMN_NAMES) {
        return [
          {
            schema_name: 'public',
            table_name: 'users',
            table_oid: 1,
            attnum: 1,
            column_name: 'id',
          },
        ];
      }
      if (sql === SQL_PG_CONSTRAINTS) return [];
      if (sql === SQL_PG_INDEXES) return [];
      if (sql === SQL_PG_VIEWS) return [];
      if (sql === SQL_PG_ROUTINES) return [];
      if (sql === SQL_PG_TRIGGERS) return [];
      if (sql === SQL_PG_SEQUENCES) return [];
      return [];
    },
    async close(): Promise<void> {
      // no-op
    },
  };
}

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    views: 'full',
    functions: 'full',
    procedures: 'full',
    triggers: 'full',
    sequences: 'full',
    constraints: 'full',
    indexes: 'full',
    collections: 'full',
    fields: 'full',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// dialect and capabilities getters
// ─────────────────────────────────────────────────────────────────────────────

describe('PgSchemaAdapter — dialect and capabilities', () => {
  it('dialect is "pg"', () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    expect(adapter.dialect).toBe('pg');
  });

  it('capabilities is PG_CAPABILITIES', () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    expect(adapter.capabilities).toBe(PG_CAPABILITIES);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extract() — returns a RawCatalog (no longer throws stub)
// ─────────────────────────────────────────────────────────────────────────────

describe('PgSchemaAdapter — extract()', () => {
  let driver: ReturnType<typeof makeFakeDriver>;
  let adapter: PgSchemaAdapter;

  beforeEach(() => {
    driver = makeFakeDriver({});
    adapter = new PgSchemaAdapter(driver);
  });

  it('returns a RawCatalog with engine "pg"', async () => {
    const catalog = await adapter.extract(FULL_SCOPE);
    expect(catalog.engine).toBe('pg');
  });

  it('returns schemas from the database', async () => {
    const catalog = await adapter.extract(FULL_SCOPE);
    expect(catalog.schemas).toContain('public');
  });

  it('returns the users table from the database', async () => {
    const catalog = await adapter.extract(FULL_SCOPE);
    const table = catalog.objects.find(
      (o) => o.kind === 'table' && o.name === 'users',
    );
    expect(table).toBeDefined();
  });

  it('issues all catalog queries (schemas, tables, columns, etc.)', async () => {
    await adapter.extract(FULL_SCOPE);
    const sqls = driver.queryCalls.map((c) => c.sql);
    expect(sqls).toContain(SQL_PG_SCHEMAS);
    expect(sqls).toContain(SQL_PG_TABLES);
    expect(sqls).toContain(SQL_PG_COLUMNS);
  });

  it('does NOT throw "not yet implemented" (stub replaced)', async () => {
    await expect(adapter.extract(FULL_SCOPE)).resolves.not.toThrow();
  });

  it('passes schema param to all queries when scope has schema', async () => {
    const driverWithSchema = makeFakeDriver({ schema: 'myschema' });
    const adapterWithSchema = new PgSchemaAdapter(driverWithSchema, 'myschema');
    await adapterWithSchema.extract(FULL_SCOPE);
    // Every query should have been called with the schema param
    for (const call of driverWithSchema.queryCalls) {
      expect(call.params).toContain('myschema');
    }
  });

  it('passes null schema param when no schema is set', async () => {
    await adapter.extract(FULL_SCOPE);
    for (const call of driver.queryCalls) {
      expect(call.params).toContain(null);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fingerprint() — exactly one query, returns sha256 hex
// ─────────────────────────────────────────────────────────────────────────────

describe('PgSchemaAdapter — fingerprint()', () => {
  it('returns a sha256 hex string (64 chars)', async () => {
    const driver = makeFakeDriver({ fingerprintRow: { max_oid: '99999', max_attnum: '10', rel_count: '100', attr_count: '500' } });
    const adapter = new PgSchemaAdapter(driver);
    const fp = await adapter.fingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues exactly ONE query (SQL_PG_FINGERPRINT)', async () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    await adapter.fingerprint();
    expect(driver.queryCalls).toHaveLength(1);
    expect(driver.queryCalls[0]?.sql).toBe(SQL_PG_FINGERPRINT);
  });

  it('same row values produce the same fingerprint (deterministic)', async () => {
    const row = { max_oid: '42', max_attnum: '3', rel_count: '7', attr_count: '35' };
    const d1 = makeFakeDriver({ fingerprintRow: row });
    const d2 = makeFakeDriver({ fingerprintRow: row });
    const fp1 = await new PgSchemaAdapter(d1).fingerprint();
    const fp2 = await new PgSchemaAdapter(d2).fingerprint();
    expect(fp1).toBe(fp2);
  });

  it('different max_oid values produce different fingerprints', async () => {
    const d1 = makeFakeDriver({ fingerprintRow: { max_oid: '1', max_attnum: '5', rel_count: '7', attr_count: '35' } });
    const d2 = makeFakeDriver({ fingerprintRow: { max_oid: '2', max_attnum: '5', rel_count: '7', attr_count: '35' } });
    const fp1 = await new PgSchemaAdapter(d1).fingerprint();
    const fp2 = await new PgSchemaAdapter(d2).fingerprint();
    expect(fp1).not.toBe(fp2);
  });

  it('different max_attnum values produce different fingerprints (ADD COLUMN detection)', async () => {
    const d1 = makeFakeDriver({ fingerprintRow: { max_oid: '100', max_attnum: '5', rel_count: '7', attr_count: '35' } });
    const d2 = makeFakeDriver({ fingerprintRow: { max_oid: '100', max_attnum: '6', rel_count: '7', attr_count: '36' } });
    const fp1 = await new PgSchemaAdapter(d1).fingerprint();
    const fp2 = await new PgSchemaAdapter(d2).fingerprint();
    expect(fp1).not.toBe(fp2);
  });

  it('does NOT throw "not yet implemented" (stub replaced)', async () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    await expect(adapter.fingerprint()).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// close() — idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe('PgSchemaAdapter — close()', () => {
  it('close() is idempotent (second call is a no-op)', async () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    await adapter.close();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extract() / fingerprint() after close() → ConnectionError
// ─────────────────────────────────────────────────────────────────────────────

describe('PgSchemaAdapter — lifecycle guard (after close)', () => {
  it('extract() after close() throws ConnectionError', async () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    await adapter.close();
    await expect(adapter.extract(FULL_SCOPE)).rejects.toBeInstanceOf(ConnectionError);
  });

  it('fingerprint() after close() throws ConnectionError', async () => {
    const driver = makeFakeDriver({});
    const adapter = new PgSchemaAdapter(driver);
    await adapter.close();
    await expect(adapter.fingerprint()).rejects.toBeInstanceOf(ConnectionError);
  });
});
