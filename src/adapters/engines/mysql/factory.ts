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
import { ConnectivityUnavailableError } from '../../../core/errors.js';
import { createMysqlReadonlyDriver, type ConnectionLike } from './driver.js';
import { MysqlSchemaAdapter } from './mysql-schema-adapter.js';
import { buildConnectivityOutcome } from '../_shared/connectivity-outcome.js';
import { loadOptionalDriver } from '../_shared/load-optional-driver.js';
import {
  SQL_MYSQL_TABLES,
  SQL_MYSQL_COLUMNS,
  SQL_MYSQL_PK_UK_COLUMNS,
  SQL_MYSQL_FK_COLUMNS,
  SQL_MYSQL_CHECK_CONSTRAINTS,
  SQL_MYSQL_STATISTICS,
  SQL_MYSQL_VIEWS,
  SQL_MYSQL_ROUTINES,
  SQL_MYSQL_TRIGGERS,
} from './queries.js';

// ─────────────────────────────────────────────────────────────────────────────
// mysql catalog SELECTs surfaced in the run-it-yourself option (write-verb-free)
// ─────────────────────────────────────────────────────────────────────────────

const MYSQL_CATALOG_QUERIES: readonly string[] = [
  SQL_MYSQL_TABLES,
  SQL_MYSQL_COLUMNS,
  SQL_MYSQL_PK_UK_COLUMNS,
  SQL_MYSQL_FK_COLUMNS,
  SQL_MYSQL_CHECK_CONSTRAINTS,
  SQL_MYSQL_STATISTICS,
  SQL_MYSQL_VIEWS,
  SQL_MYSQL_ROUTINES,
  SQL_MYSQL_TRIGGERS,
];

const MYSQL_NPM_DOC_URL = 'https://www.npmjs.com/package/mysql2';
const MYSQL_DUMP_PATH = '.dbgraph/dumps/mysql-dump.json';

function buildMysqlConnectivityOutcome(summary: string): ConnectivityUnavailableError {
  const outcome = buildConnectivityOutcome({
    engine: 'mysql',
    summary,
    attempts: [],
    runItYourselfQueries: MYSQL_CATALOG_QUERIES,
    installTool: 'mysql2',
    installDocUrl: MYSQL_NPM_DOC_URL,
    dumpPath: MYSQL_DUMP_PATH,
  });
  return new ConnectivityUnavailableError(outcome);
}

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
    // Lazy dynamic import via the centralized optional-driver seam (design D7).
    // Off-SEA this is byte-identical to `await import('mysql2/promise')`; under SEA
    // it resolves via createRequire (CWD → NODE_PATH → global). The existing
    // deps.importMysql test override is routed through loadOptionalDriver's import
    // seam so the MODULE_NOT_FOUND catch below still fires. ADR-006: no top-level import.
    let mysqlMod: unknown;
    try {
      mysqlMod = await loadOptionalDriver(
        'mysql2/promise',
        deps.importMysql !== undefined ? { importModule: deps.importMysql } : {},
      );
    } catch {
      // MODULE_NOT_FOUND → build a ConnectivityOutcome with ≥3 options (Batch 3)
      throw buildMysqlConnectivityOutcome(
        "Required driver 'mysql2' is not installed. Run: npm i mysql2",
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
      throw buildMysqlConnectivityOutcome(
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
    // Connection failure → build a ConnectivityOutcome with ≥3 options (Batch 3).
    // CONTENT-FREE CONTRACT: the summary MUST NOT carry the raw driver error
    // (which routinely contains host/user/db in the message). Keep the raw
    // cause as error.cause only — never surfaced to the user.
    const err = buildMysqlConnectivityOutcome(
      'Could not connect to the MySQL database. Verify the host, credentials, and network accessibility.',
    );
    // Attach the raw cause for debugging (not rendered by formatOutcome).
    err.cause = cause;
    throw err;
  }

  // ── 4. Wrap in the driver seam and return the adapter ─────────────────────
  const driver = createMysqlReadonlyDriver(conn);
  // Pass the database name so the adapter can populate RawCatalog.schemas.
  return new MysqlSchemaAdapter(driver, config.database);
}
