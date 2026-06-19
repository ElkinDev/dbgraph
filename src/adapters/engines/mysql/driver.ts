/**
 * MysqlReadonlyDriver — async engine-local seam over mysql2/promise connection.
 * Design §driver.ts — "single duck-typed MysqlReadonlyDriver seam".
 *
 * The adapter and map.ts talk ONLY to this interface — never to mysql2 directly.
 * Mirrors pg/driver.ts but adapts to mysql2/promise createConnection (NOT a pool):
 * one short-lived connection per extraction run, then conn.end().
 *
 * mysql2/promise result shape: [rows, fields] (tuple)
 * vs PG shape:                 { rows: Record<string, unknown>[] }
 *
 * The seam normalizes [rows, fields] → rows so the adapter and map.ts consume
 * a uniform Record<string, unknown>[] shape — identical to the PG driver surface.
 * (Decision D2: the seam absorbs the dialect shape difference.)
 *
 * query() accepts an optional params array for parameterized queries (? params).
 * All catalog queries in mysql use DATABASE() (a function, not a bind param), so
 * params will generally be undefined — but the signature matches the pg seam.
 *
 * NO top-level mysql2 import anywhere (ADR-006). The lazy import lives in factory.ts.
 * The adapter talks ONLY to MysqlReadonlyDriver (ADR-004).
 *
 * US-029 (MySQL adapter, Phase 8b), ADR-004 (seam keeps mysql2 out of core),
 * ADR-006 (lazy optional import).
 */

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionLike — duck-typed mysql2/promise connection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal duck-typed interface for a mysql2/promise connection.
 * Typed locally so we do NOT import mysql2 in this file at module level.
 * The connection instance is created and connected by the factory and passed in.
 *
 * mysql2/promise connection.query(sql, params?) returns [rows, fields].
 * connection.end() releases the connection socket.
 *
 * Decision D3: we use query() (text protocol, zero params for DATABASE() scoped
 * queries) rather than execute() (prepared/binary), matching the conservative
 * read-only posture and avoiding prepared-statement protocol restrictions.
 */
export interface ConnectionLike {
  query(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[], unknown]>;
  end(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MysqlReadonlyDriver interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal async read-only handle for MySQL catalog queries.
 *
 * query — execute a SELECT (with optional params) and return all rows as plain objects.
 *         Normalizes mysql2 [rows, fields] → rows (Decision D2).
 * close — release the connection (calls conn.end()).
 */
export interface MysqlReadonlyDriver {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: wrap a connected mysql2/promise connection in MysqlReadonlyDriver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a connected mysql2/promise connection (or duck-typed fake in tests)
 * in MysqlReadonlyDriver.
 * The connection MUST already be connected (factory.ts calls createConnection
 * which auto-connects, or calls .connect() before passing it in).
 *
 * Normalizes mysql2 [rows, fields] tuple → rows[] so map.ts sees the same
 * Record<string, unknown>[] surface as the pg driver returns.
 *
 * @param conn - A connected mysql2/promise connection (or duck-typed ConnectionLike fake).
 */
export function createMysqlReadonlyDriver(conn: ConnectionLike): MysqlReadonlyDriver {
  return {
    async query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]> {
      // mysql2/promise returns [rows, fields]; destructure to normalize to rows only.
      // params: spread readonly to mutable for mysql2 compatibility.
      const [rows] = await conn.query(sql, params !== undefined ? [...params] : undefined);
      return rows;
    },

    async close(): Promise<void> {
      await conn.end();
    },
  };
}
