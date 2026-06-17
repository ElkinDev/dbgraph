/**
 * Unit tests for MssqlReadonlyDriver — async seam over mssql.ConnectionPool.
 * Design §driver.ts "async engine-local driver seam".
 *
 * Strategy: fake pool object (plain object, no vi.mock needed) — tests verify
 * the wrapper delegates query/close correctly without a live DB.
 *
 * TDD: RED (driver.ts does not exist yet) → GREEN → REFACTOR.
 *
 * US-027 (SQL Server adapter), ADR-004 (seam keeps mssql out of core).
 */

import { describe, it, expect } from 'vitest';
import {
  createMssqlReadonlyDriver,
  type MssqlReadonlyDriver,
} from '../../../../src/adapters/engines/mssql/driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake pool helpers
// ─────────────────────────────────────────────────────────────────────────────

type FakeRequest = {
  query(sql: string): Promise<{ recordset: Record<string, unknown>[] }>;
};

function makeFakePool(rows: Record<string, unknown>[]): {
  request(): FakeRequest;
  close(): Promise<void>;
  closed: boolean;
} {
  let closed = false;
  return {
    closed,
    request(): FakeRequest {
      return {
        // sql parameter required by FakeRequest interface; not used in stub
        async query(sql: string) {
          void sql;
          return { recordset: rows };
        },
      };
    },
    async close() {
      closed = true;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MssqlReadonlyDriver — query()
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlReadonlyDriver — query()', () => {
  it('returns recordset rows from pool.request().query()', async () => {
    const rows = [{ id: 1, name: 'orders' }, { id: 2, name: 'customers' }];
    const pool = makeFakePool(rows);
    const driver: MssqlReadonlyDriver = createMssqlReadonlyDriver(pool);

    const result = await driver.query('SELECT id, name FROM sys.tables');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, name: 'orders' });
    expect(result[1]).toMatchObject({ id: 2, name: 'customers' });
  });

  it('returns empty array when pool returns no rows', async () => {
    const pool = makeFakePool([]);
    const driver = createMssqlReadonlyDriver(pool);

    const result = await driver.query('SELECT id FROM sys.tables WHERE 1=0');

    expect(result).toHaveLength(0);
  });

  it('passes the SQL string unchanged to pool.request().query()', async () => {
    const capturedSql: string[] = [];
    const pool = {
      request() {
        return {
          async query(sql: string) {
            capturedSql.push(sql);
            return { recordset: [] };
          },
        };
      },
      async close() {},
    };

    const driver = createMssqlReadonlyDriver(pool);
    const sql = 'SELECT schema_name, table_name FROM sys.tables ORDER BY schema_name, table_name';
    await driver.query(sql);

    expect(capturedSql).toHaveLength(1);
    expect(capturedSql[0]).toBe(sql);
  });

  it('result rows are readonly (readonly array of readonly records)', async () => {
    const rows = [{ col: 'value' }];
    const pool = makeFakePool(rows);
    const driver = createMssqlReadonlyDriver(pool);

    const result = await driver.query('SELECT col FROM t');

    // TypeScript enforces readonly — runtime check: it is still an array
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ col: 'value' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MssqlReadonlyDriver — close()
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlReadonlyDriver — close()', () => {
  it('delegates to pool.close()', async () => {
    let closeCalled = false;
    const pool = {
      request() {
        return {
          async query(sql: string) {
            void sql;
            return { recordset: [] };
          },
        };
      },
      async close() {
        closeCalled = true;
      },
    };

    const driver = createMssqlReadonlyDriver(pool);
    await driver.close();

    expect(closeCalled).toBe(true);
  });

  it('does not throw when close() is called once', async () => {
    const pool = makeFakePool([]);
    const driver = createMssqlReadonlyDriver(pool);

    await expect(driver.close()).resolves.not.toThrow();
  });
});
