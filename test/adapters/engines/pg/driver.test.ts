/**
 * Unit tests for PgReadonlyDriver — async seam over pg.Client.
 * Design §driver.ts "async engine-local driver seam, client-backed".
 *
 * Strategy: fake ClientLike object (plain object, no vi.mock needed) — tests
 * verify the wrapper delegates query/close correctly without a live DB.
 *
 * PG uses pg.Client (NOT a Pool): one short-lived Client per extraction run.
 * The seam maps pg.Client's { rows } result shape to a plain record array.
 *
 * TDD: RED (driver.ts does not exist yet) → GREEN → REFACTOR.
 *
 * US-028 (PostgreSQL adapter), ADR-004 (seam keeps pg types out of core),
 * ADR-006 (NO top-level pg import).
 */

import { describe, it, expect } from 'vitest';
import {
  createPgReadonlyDriver,
  type PgReadonlyDriver,
} from '../../../../src/adapters/engines/pg/driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake client helpers (duck-typed ClientLike — no real pg install needed)
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeClient(rows: Record<string, unknown>[]): {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
  endCalled: boolean;
} {
  let endCalled = false;
  return {
    get endCalled() { return endCalled; },
    async query(sql: string) {
      void sql;
      return { rows };
    },
    async end() {
      endCalled = true;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PgReadonlyDriver — query()
// ─────────────────────────────────────────────────────────────────────────────

describe('PgReadonlyDriver — query()', () => {
  it('returns rows from client.query() result', async () => {
    const rows = [{ id: 1, nspname: 'public' }, { id: 2, nspname: 'app' }];
    const client = makeFakeClient(rows);
    const driver: PgReadonlyDriver = createPgReadonlyDriver(client);

    const result = await driver.query('SELECT oid, nspname FROM pg_namespace');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, nspname: 'public' });
    expect(result[1]).toMatchObject({ id: 2, nspname: 'app' });
  });

  it('returns empty array when client returns no rows', async () => {
    const client = makeFakeClient([]);
    const driver = createPgReadonlyDriver(client);

    const result = await driver.query('SELECT oid FROM pg_class WHERE 1=0');

    expect(result).toHaveLength(0);
  });

  it('passes the SQL string unchanged to client.query()', async () => {
    const capturedSql: string[] = [];
    const client = {
      async query(sql: string) {
        capturedSql.push(sql);
        return { rows: [] };
      },
      async end() {},
    };

    const driver = createPgReadonlyDriver(client);
    const sql = 'SELECT nspname FROM pg_namespace ORDER BY nspname';
    await driver.query(sql);

    expect(capturedSql).toHaveLength(1);
    expect(capturedSql[0]).toBe(sql);
  });

  it('result is an array of plain record objects', async () => {
    const rows = [{ relname: 'orders', relkind: 'r' }];
    const client = makeFakeClient(rows);
    const driver = createPgReadonlyDriver(client);

    const result = await driver.query('SELECT relname, relkind FROM pg_class');

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ relname: 'orders', relkind: 'r' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PgReadonlyDriver — close()
// ─────────────────────────────────────────────────────────────────────────────

describe('PgReadonlyDriver — close()', () => {
  it('delegates to client.end()', async () => {
    const client = makeFakeClient([]);
    const driver = createPgReadonlyDriver(client);

    await driver.close();

    expect(client.endCalled).toBe(true);
  });

  it('does not throw when close() is called once', async () => {
    const client = makeFakeClient([]);
    const driver = createPgReadonlyDriver(client);

    await expect(driver.close()).resolves.not.toThrow();
  });
});
