/**
 * createMysqlSchemaAdapter — factory for the MySQL schema extraction adapter.
 * Design §"collapse lazy-import + connect + error mapping directly into factory.ts"
 *   (pg/SQLite shape — no strategy registry; MySQL has flat host/port/user/password + ssl).
 *
 * Responsibilities:
 *   1. Lazy dynamic import('mysql2/promise' as string) — ADR-006: NO top-level mysql2 import.
 *   2. Build the mysql2 connection config (host, port default 3306, database, user,
 *      password already resolved from ${env:VAR} by the caller, optional ssl).
 *   3. createConnection(connConfig) + connection.connect() — one short-lived connection per run.
 *   4. Map connect failures via mapMysqlError to typed errors (ConnectionError / PermissionError).
 *   5. Wrap the connected connection in createMysqlReadonlyDriver → MysqlSchemaAdapter.
 *   6. Missing 'mysql2' package → ConnectionError('... npm i mysql2').
 *
 * NO strategy registry (that is SQL-Server-only machinery).
 * createMysqlSchemaAdapter is the ONLY join point (ADR-004, ADR-006).
 *
 * US-029 (MySQL adapter, Phase 8b), ADR-004 (seam), ADR-006 (lazy optional import),
 * mysql-extraction spec "Absent mysql2 driver names npm i mysql2".
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { MysqlAdapterConfig } from '../../../core/ports/schema-adapter.js';
import { ConnectionError } from '../../../core/errors.js';
import { mapMysqlError } from './error-mapper.js';
import { createMysqlReadonlyDriver, type ConnectionLike } from './driver.js';
import { MysqlSchemaAdapter } from './mysql-schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Optional deps (test seam — omit entirely for production use)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional dependencies for createMysqlSchemaAdapter.
 * All fields are optional — omit entirely for production use.
 *
 * - `createConnection` — inject a fake mysql2 createConnection function in unit
 *                        tests so no real mysql2 install is required. Production code
 *                        uses the lazily-imported mysql2/promise.createConnection.
 * - `importMysql`      — inject a fake dynamic import function to test the missing-driver
 *                        error path without actually uninstalling mysql2.
 */
export interface MysqlSchemaAdapterDeps {
  /**
   * mysql2/promise createConnection override — for unit testing only.
   * When provided, the factory skips the lazy import and uses this function.
   *
   * Matches the real mysql2/promise.createConnection() signature:
   *   createConnection(config) => Promise<Connection>
   * The Promise resolves with an already-connected ConnectionLike (no .connect() call needed).
   */
  readonly createConnection?: (config: Record<string, unknown>) => Promise<ConnectionLike>;
  /**
   * Dynamic import override — for testing the MODULE_NOT_FOUND path only.
   * When provided, the factory calls this instead of import('mysql2/promise' as string).
   */
  readonly importMysql?: () => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a MySQL connection and returns a SchemaAdapter.
 * The adapter is already-connected — no open() call needed.
 *
 * @param config - MysqlAdapterConfig: host/port/database/user/password (resolved) + optional ssl.
 * @param deps   - Optional deps for testing (createConnection override / importMysql override).
 *
 * @throws ConnectionError if mysql2 is not installed (`npm i mysql2` in message — ADR-006).
 * @throws ConnectionError if connection.connect() fails (network / db missing / auth).
 * @throws PermissionError if connection.connect() fails with insufficient privilege.
 */
export async function createMysqlSchemaAdapter(
  config: MysqlAdapterConfig,
  deps: MysqlSchemaAdapterDeps = {},
): Promise<SchemaAdapter> {
  // ── 1. Resolve the mysql2/promise createConnection function ───────────────
  // In tests: deps.createConnection is provided → skip the lazy import.
  // In production: dynamically import mysql2/promise and extract createConnection.
  //
  // mysql2/promise.createConnection(config) returns Promise<Connection>.
  // The connection is auto-connected when the Promise resolves — no .connect() call.
  let createConnectionFn: (config: Record<string, unknown>) => Promise<ConnectionLike>;

  if (deps.createConnection !== undefined) {
    createConnectionFn = deps.createConnection;
  } else {
    // Lazy dynamic import — ADR-006: no top-level mysql2 import anywhere.
    // Use 'mysql2/promise' as string to prevent bundlers from statically resolving it
    // and to mirror the pattern established in pg/factory.ts.
    let mysqlMod: unknown;
    try {
      mysqlMod = deps.importMysql !== undefined
        ? await deps.importMysql()
        : await (import('mysql2/promise' as string));
    } catch (cause) {
      // MODULE_NOT_FOUND → instruct the user to install the optional dep
      throw new ConnectionError(
        "Required driver 'mysql2' is not installed. Run: npm i mysql2",
        cause,
      );
    }

    // mysql2/promise exports { createConnection, createPool, ... }.
    // Handles both CJS default export and ESM named export shapes.
    const mod = mysqlMod as Record<string, unknown>;
    const createConnFn =
      (mod['createConnection'] as ((cfg: Record<string, unknown>) => Promise<ConnectionLike>) | undefined) ??
      ((mod['default'] as Record<string, unknown> | undefined)?.['createConnection'] as
        | ((cfg: Record<string, unknown>) => Promise<ConnectionLike>)
        | undefined);

    if (createConnFn === undefined) {
      throw new ConnectionError(
        "Failed to load mysql2/promise.createConnection. Try: npm i mysql2",
      );
    }
    createConnectionFn = createConnFn;
  }

  // ── 2. Build the mysql2 connection config ─────────────────────────────────
  // password arrives already resolved (resolveSecrets was called by the caller).
  const connConfig: Record<string, unknown> = {
    host: config.host,
    port: config.port ?? 3306,
    database: config.database,
    user: config.user,
    password: config.password,
  };

  // Optional ssl — pass only when supplied (exactOptionalPropertyTypes — L-002).
  if (config.ssl !== undefined) {
    connConfig['ssl'] = config.ssl;
  }

  // ── 3. createConnection (auto-connects on Promise resolution) ────────────
  // mysql2/promise.createConnection returns a Promise that resolves with an
  // already-connected Connection — no explicit .connect() call is needed.
  let conn: ConnectionLike;
  try {
    conn = await createConnectionFn(connConfig);
  } catch (cause) {
    // Connection failure (wrong host, auth denied, etc.) → map to typed error.
    throw mapMysqlError(cause);
  }

  // ── 4. Wrap in the driver seam and return the adapter ─────────────────────
  const driver = createMysqlReadonlyDriver(conn);
  // Pass the database name so the adapter can populate RawCatalog.schemas.
  return new MysqlSchemaAdapter(driver, config.database);
}
