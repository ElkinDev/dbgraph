/**
 * MssqlReadonlyDriver — async engine-local seam over mssql.ConnectionPool.
 * Design §driver.ts "async engine-local driver seam, pool-backed".
 *
 * The adapter and map.ts talk ONLY to this interface — never to mssql directly.
 * This mirrors sqlite/driver.ts ReadonlyDriver but is async (network I/O).
 *
 * US-027 (SQL Server adapter), ADR-004 (seam keeps mssql types out of core).
 */

// ─────────────────────────────────────────────────────────────────────────────
// MssqlReadonlyDriver interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal async read-only handle for SQL Server catalog queries.
 *
 * query — execute a SELECT and return all rows as plain readonly objects.
 * close — release the connection pool.
 */
export interface MssqlReadonlyDriver {
  query(sql: string): Promise<readonly Record<string, unknown>[]>;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool shape (duck-typed to avoid importing mssql in this file at module level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal duck-typed interface for a mssql.ConnectionPool.
 * Typed locally so we do not need to import mssql here — the pool instance
 * is created by the factory and passed in.
 */
interface PoolLike {
  request(): {
    query(sql: string): Promise<{ recordset: Record<string, unknown>[] }>;
  };
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: wrap a pool in MssqlReadonlyDriver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a connected mssql.ConnectionPool in the MssqlReadonlyDriver interface.
 * The pool MUST already be connected (factory.ts calls pool.connect() before
 * calling this function).
 *
 * @param pool - A connected mssql.ConnectionPool (or duck-typed fake in tests).
 */
export function createMssqlReadonlyDriver(pool: PoolLike): MssqlReadonlyDriver {
  return {
    async query(sql: string): Promise<readonly Record<string, unknown>[]> {
      const result = await pool.request().query(sql);
      return result.recordset as readonly Record<string, unknown>[];
    },

    async close(): Promise<void> {
      await pool.close();
    },
  };
}
