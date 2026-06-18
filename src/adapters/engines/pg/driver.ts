/**
 * PgReadonlyDriver — async engine-local seam over pg.Client.
 * Design §driver.ts "async engine-local driver seam, client-backed".
 *
 * The adapter and map.ts talk ONLY to this interface — never to pg directly.
 * This mirrors mssql/driver.ts but adapts to pg.Client (NOT a Pool): one
 * short-lived Client per extraction run, then end().
 *
 * PG result shape: { rows: Record<string, unknown>[] }
 * vs MSSQL shape:  { recordset: Record<string, unknown>[] }
 *
 * NO top-level `pg` import anywhere (ADR-006). The lazy import lives in factory.ts.
 * The adapter talks ONLY to PgReadonlyDriver (ADR-004).
 *
 * US-028 (PostgreSQL adapter), ADR-004 (seam keeps pg types out of core),
 * ADR-006 (lazy optional import).
 */

// ─────────────────────────────────────────────────────────────────────────────
// PgReadonlyDriver interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal async read-only handle for PostgreSQL catalog queries.
 *
 * query — execute a SELECT and return all rows as plain objects.
 * close — release the connection (calls client.end()).
 */
export interface PgReadonlyDriver {
  query(sql: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client shape (duck-typed to avoid importing pg in this file at module level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal duck-typed interface for a pg.Client.
 * Typed locally so we do not need to import pg here — the client instance
 * is created and connected by the factory and passed in.
 *
 * pg.Client.query returns { rows: Record<string, unknown>[] }
 * pg.Client.end   releases the connection socket.
 */
export interface ClientLike {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: wrap a connected pg.Client in PgReadonlyDriver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a connected pg.Client (or duck-typed fake in tests) in PgReadonlyDriver.
 * The client MUST already be connected (factory.ts calls client.connect() before
 * calling this function).
 *
 * @param client - A connected pg.Client (or duck-typed ClientLike fake in tests).
 */
export function createPgReadonlyDriver(client: ClientLike): PgReadonlyDriver {
  return {
    async query(sql: string): Promise<Record<string, unknown>[]> {
      const result = await client.query(sql);
      return result.rows;
    },

    async close(): Promise<void> {
      await client.end();
    },
  };
}
