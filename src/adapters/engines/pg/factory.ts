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
import { ConnectionError } from '../../../core/errors.js';
import { mapPgError } from './error-mapper.js';
import { createPgReadonlyDriver, type ClientLike } from './driver.js';
import { PgSchemaAdapter } from './pg-schema-adapter.js';

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
    // Lazy dynamic import — ADR-006: no top-level pg import anywhere.
    // Use 'pg' as string to prevent bundlers from statically resolving it and
    // to mirror the pattern established in sqlite/factory.ts (node:sqlite path).
    let pgMod: unknown;
    try {
      pgMod = deps.importPg !== undefined
        ? deps.importPg()
        : await (import('pg' as string));
    } catch (cause) {
      // MODULE_NOT_FOUND → instruct the user to install the optional dep
      throw new ConnectionError(
        "Required driver 'pg' is not installed. Run: npm i pg",
        cause,
      );
    }

    // pg exports { Client, Pool, ... } — we need Client (NOT Pool).
    // Handles both CJS default export and ESM named export shapes.
    const mod = pgMod as Record<string, unknown>;
    const pgClient =
      (mod['Client'] as (typeof ClientCtor) | undefined) ??
      ((mod['default'] as Record<string, unknown> | undefined)?.['Client'] as (typeof ClientCtor) | undefined);

    if (pgClient === undefined) {
      throw new ConnectionError(
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
    // Map any pg driver error to a typed error (ConnectionError / PermissionError).
    throw mapPgError(cause);
  }

  // ── 4. Wrap in the driver seam and return the adapter ────────────────────
  const driver = createPgReadonlyDriver(client);
  return new PgSchemaAdapter(driver);
}
