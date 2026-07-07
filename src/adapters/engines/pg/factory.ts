/**
 * createPgSchemaAdapter — factory for the PostgreSQL schema extraction adapter.
 * Design §"PG mirrors the SQLite adapter SHAPE — collapse lazy-import + connect
 *   + fingerprint logic directly into factory.ts".
 *
 * Responsibilities:
 *   1. Lazy dynamic import('pg' as string) — ADR-006: NO top-level pg import.
 *   2. Build the pg connection config (host, port default 5432, database, user,
 *      password already resolved from ${env:VAR} by the caller, optional ssl).
 *   3. new Client(connConfig) + client.connect() — one short-lived Client per run.
 *   4. Map connect failures via mapPgError to typed errors (ConnectionError /
 *      PermissionError).
 *   5. Wrap the connected client in createPgReadonlyDriver → PgSchemaAdapter.
 *   6. Missing 'pg' package → ConnectionError('... npm i pg').
 *
 * NO strategy registry (that is SQL-Server-only machinery).
 * createPgSchemaAdapter is the ONLY join point (ADR-004).
 *
 * US-028 (PostgreSQL adapter), ADR-004 (seam), ADR-006 (lazy optional import),
 * pg-extraction spec "Absent pg driver names npm i pg".
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { PgAdapterConfig } from '../../../core/ports/schema-adapter.js';
import { ConnectivityUnavailableError } from '../../../core/errors.js';
import { createPgReadonlyDriver, type ClientLike } from './driver.js';
import { PgSchemaAdapter } from './pg-schema-adapter.js';
import { buildConnectivityOutcome } from '../_shared/connectivity-outcome.js';
import { loadOptionalDriver } from '../_shared/load-optional-driver.js';
import {
  SQL_PG_SCHEMAS,
  SQL_PG_TABLES,
  SQL_PG_COLUMNS,
  SQL_PG_CONSTRAINTS,
  SQL_PG_INDEXES,
  SQL_PG_VIEWS,
  SQL_PG_ROUTINES,
  SQL_PG_TRIGGERS,
  SQL_PG_SEQUENCES,
} from './queries.js';

// ─────────────────────────────────────────────────────────────────────────────
// pg catalog SELECTs surfaced in the run-it-yourself option (write-verb-free)
// ─────────────────────────────────────────────────────────────────────────────

const PG_CATALOG_QUERIES: readonly string[] = [
  SQL_PG_SCHEMAS,
  SQL_PG_TABLES,
  SQL_PG_COLUMNS,
  SQL_PG_CONSTRAINTS,
  SQL_PG_INDEXES,
  SQL_PG_VIEWS,
  SQL_PG_ROUTINES,
  SQL_PG_TRIGGERS,
  SQL_PG_SEQUENCES,
];

const PG_NPM_DOC_URL = 'https://www.npmjs.com/package/pg';
const PG_DUMP_PATH = '.dbgraph/dumps/pg-dump.json';

function buildPgConnectivityOutcome(summary: string): ConnectivityUnavailableError {
  const outcome = buildConnectivityOutcome({
    engine: 'pg',
    summary,
    attempts: [],
    runItYourselfQueries: PG_CATALOG_QUERIES,
    installTool: 'pg',
    installDocUrl: PG_NPM_DOC_URL,
    dumpPath: PG_DUMP_PATH,
  });
  return new ConnectivityUnavailableError(outcome);
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional deps (test seam — omit entirely for production use)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional dependencies for createPgSchemaAdapter.
 * All fields are optional — omit entirely for production use.
 *
 * - `Client`   — inject a fake pg.Client constructor in unit tests so no real
 *                pg install is required. Production code uses the lazily-imported
 *                pg.Client.
 * - `importPg` — inject a fake dynamic import function to test the missing-driver
 *                error path without actually uninstalling pg.
 */
export interface PgSchemaAdapterDeps {
  /**
   * pg.Client constructor override — for unit testing only.
   * When provided, the factory skips the lazy import and uses this constructor.
   */
  readonly Client?: new (config: Record<string, unknown>) => ClientLike & { connect(): Promise<void> };
  /**
   * Dynamic import override — for testing the MODULE_NOT_FOUND path only.
   * When provided, the factory calls this instead of `import('pg' as string)`.
   */
  readonly importPg?: () => unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a PostgreSQL connection and returns a SchemaAdapter.
 * The adapter is already-connected — no open() call needed.
 *
 * @param config - PgAdapterConfig: host/port/database/user/password (resolved) + optional ssl/schema.
 * @param deps   - Optional deps for testing (Client constructor / importPg override).
 *
 * @throws ConnectionError if pg is not installed (`npm i pg` in message — ADR-006).
 * @throws ConnectionError if client.connect() fails (network / db missing / auth).
 * @throws PermissionError if client.connect() fails with insufficient privilege.
 */
export async function createPgSchemaAdapter(
  config: PgAdapterConfig,
  deps: PgSchemaAdapterDeps = {},
): Promise<SchemaAdapter> {
  // ── 1. Resolve the pg.Client constructor ─────────────────────────────────
  // In tests: deps.Client is provided → skip the lazy import.
  // In production: dynamically import pg and extract its Client class.
  let ClientCtor: new (connConfig: Record<string, unknown>) => ClientLike & { connect(): Promise<void> };

  if (deps.Client !== undefined) {
    ClientCtor = deps.Client;
  } else {
    // Lazy dynamic import via the centralized optional-driver seam (design D7).
    // Off-SEA this is byte-identical to `await import('pg')`; under SEA it resolves
    // via createRequire (CWD → NODE_PATH → global). The existing deps.importPg test
    // override is routed through loadOptionalDriver's import seam so the
    // MODULE_NOT_FOUND catch below still fires. ADR-006: no top-level pg import.
    let pgMod: unknown;
    try {
      pgMod = await loadOptionalDriver(
        'pg',
        deps.importPg !== undefined ? { importModule: deps.importPg } : {},
      );
    } catch {
      // MODULE_NOT_FOUND → build a ConnectivityOutcome with ≥3 options
      throw buildPgConnectivityOutcome(
        "Required driver 'pg' is not installed. Run: npm i pg",
      );
    }

    // pg exports { Client, Pool, ... } — we need Client (NOT Pool).
    // Handles both CJS default export and ESM named export shapes.
    const mod = pgMod as Record<string, unknown>;
    const pgClient =
      (mod['Client'] as (typeof ClientCtor) | undefined) ??
      ((mod['default'] as Record<string, unknown> | undefined)?.['Client'] as (typeof ClientCtor) | undefined);

    if (pgClient === undefined) {
      throw buildPgConnectivityOutcome(
        "Failed to load pg.Client from the 'pg' module. Try: npm i pg",
      );
    }
    ClientCtor = pgClient;
  }

  // ── 2. Build the pg connection config ────────────────────────────────────
  // password arrives already resolved (resolveSecrets was called by the caller).
  const connConfig: Record<string, unknown> = {
    host: config.host,
    port: config.port ?? 5432,
    database: config.database,
    user: config.user,
    password: config.password,
  };

  // Optional ssl — pass only when supplied (exactOptionalPropertyTypes — L-002).
  if (config.ssl !== undefined) {
    connConfig['ssl'] = config.ssl;
  }

  // ── 3. new Client + connect ───────────────────────────────────────────────
  const client = new ClientCtor(connConfig);

  try {
    await client.connect();
  } catch (cause) {
    // Connect failure → build a ConnectivityOutcome with ≥3 options (Batch 3).
    // CONTENT-FREE CONTRACT: the summary MUST NOT carry the raw driver error
    // (which routinely contains host/user/db in the message). Keep the raw
    // cause as error.cause only — never surfaced to the user.
    const err = buildPgConnectivityOutcome(
      'Could not connect to the PostgreSQL database. Verify the host, credentials, and network accessibility.',
    );
    // Attach the raw cause for debugging (not rendered by formatOutcome).
    err.cause = cause;
    throw err;
  }

  // ── 4. Wrap in the driver seam and return the adapter ────────────────────
  const driver = createPgReadonlyDriver(client);
  // Pass the optional schema scope to the adapter for per-query scoping.
  const schemaScope = config.schema ?? null;
  return new PgSchemaAdapter(driver, schemaScope);
}
