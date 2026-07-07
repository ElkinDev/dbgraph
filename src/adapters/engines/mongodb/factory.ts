/**
 * createMongodbSchemaAdapter — factory for the MongoDB schema extraction adapter.
 * Design §"collapse lazy-import + connect + error mapping directly into factory.ts"
 *   (pg/mysql shape — no strategy registry; MongoDB uses URI-based config).
 *
 * Responsibilities:
 *   1. Lazy dynamic import('mongodb' as string) — ADR-006: NO top-level mongodb import.
 *   2. Instantiate MongoClient with the resolved URI + optional tls flag.
 *   3. client.connect() — one short-lived MongoClient per extraction run.
 *   4. Map connect failures via mapMongoError to typed errors
 *      (ConnectionError / PermissionError / ConnectivityUnavailableError).
 *   5. Wrap the connected client in createMongodbReadonlyDriver → MongodbSchemaAdapter.
 *   6. Missing 'mongodb' package → ConnectivityUnavailableError with "npm i mongodb" in summary.
 *
 * NO strategy registry (that is SQL-Server-only machinery).
 * createMongodbSchemaAdapter is the ONLY join point (ADR-004, ADR-006).
 *
 * US-030 (MongoDB adapter), ADR-004 (seam), ADR-006 (lazy optional import),
 * mongodb-extraction spec "Absent mongodb driver names npm i mongodb".
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { MongodbAdapterConfig } from '../../../core/ports/schema-adapter.js';
import { mapMongoError } from './error-mapper.js';
import { createMongodbReadonlyDriver, type MongoClientLike } from './driver.js';
import { MongodbSchemaAdapter } from './mongodb-schema-adapter.js';
import { loadOptionalDriver } from '../_shared/load-optional-driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Optional deps (test seam — omit entirely for production use)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional dependencies for createMongodbSchemaAdapter.
 * All fields are optional — omit entirely for production use.
 *
 * - `MongoClient`   — inject a fake MongoClient constructor in unit tests so no real
 *                     mongodb install is required. Production code uses the lazily-imported
 *                     mongodb MongoClient.
 * - `importMongodb` — inject a fake dynamic import function to test the missing-driver
 *                     error path without actually uninstalling mongodb.
 */
export interface MongodbSchemaAdapterDeps {
  /**
   * MongoClient constructor override — for unit testing only.
   * When provided, the factory skips the lazy import and uses this constructor.
   */
  readonly MongoClient?: new (uri: string, options?: Record<string, unknown>) => MongoClientLike;
  /**
   * Dynamic import override — for testing the MODULE_NOT_FOUND path only.
   * When provided, the factory calls this instead of import('mongodb' as string).
   */
  readonly importMongodb?: () => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a MongoDB connection and returns a SchemaAdapter.
 * The adapter is already-connected — no open() call needed.
 *
 * @param config - MongodbAdapterConfig: uri/database (resolved) + optional sampleSize/tls.
 * @param deps   - Optional deps for testing (MongoClient constructor / importMongodb override).
 *
 * @throws ConnectivityUnavailableError if mongodb is not installed (summary has "npm i mongodb").
 * @throws ConnectivityUnavailableError if client.connect() fails (network / auth / role).
 */
export async function createMongodbSchemaAdapter(
  config: MongodbAdapterConfig,
  deps: MongodbSchemaAdapterDeps = {},
): Promise<SchemaAdapter> {
  // ── 1. Resolve the MongoClient constructor ────────────────────────────────
  // In tests: deps.MongoClient is provided → skip the lazy import.
  // In production: dynamically import mongodb and extract its MongoClient class.
  let MongoClientCtor: new (uri: string, options?: Record<string, unknown>) => MongoClientLike;

  if (deps.MongoClient !== undefined) {
    MongoClientCtor = deps.MongoClient;
  } else {
    // Lazy dynamic import via the centralized optional-driver seam (design D7).
    // Off-SEA this is byte-identical to `await import('mongodb')`; under SEA it
    // resolves via createRequire (CWD → NODE_PATH → global). The existing
    // deps.importMongodb test override is routed through loadOptionalDriver's import
    // seam so the MODULE_NOT_FOUND catch below still fires. ADR-006: no top-level import.
    let mongoMod: unknown;
    try {
      mongoMod = await loadOptionalDriver(
        'mongodb',
        deps.importMongodb !== undefined ? { importModule: deps.importMongodb } : {},
      );
    } catch (importErr: unknown) {
      // MODULE_NOT_FOUND → forward to mapMongoError which builds the ConnectivityOutcome.
      throw mapMongoError(importErr);
    }

    // mongodb exports { MongoClient, Db, ... }
    // Handle both CJS default export and ESM named export shapes.
    const mod = mongoMod as Record<string, unknown>;
    const ClientCtor =
      (mod['MongoClient'] as (typeof MongoClientCtor) | undefined) ??
      ((mod['default'] as Record<string, unknown> | undefined)?.['MongoClient'] as
        | (typeof MongoClientCtor)
        | undefined);

    if (ClientCtor === undefined) {
      // Module loaded but MongoClient not found — emit the same connectivity outcome.
      throw mapMongoError(
        Object.assign(new Error("Failed to load mongodb.MongoClient. Try: npm i mongodb"), {
          code: 'MODULE_NOT_FOUND',
        }),
      );
    }
    MongoClientCtor = ClientCtor;
  }

  // ── 2. Build the MongoClient options ─────────────────────────────────────
  // uri arrives already resolved (resolveSecrets was called by the caller).
  const clientOptions: Record<string, unknown> = {};

  // Optional tls — pass only when supplied (exactOptionalPropertyTypes — L-002).
  if (config.tls !== undefined) {
    clientOptions['tls'] = config.tls;
  }

  // ── 3. new MongoClient + connect ──────────────────────────────────────────
  const client = new MongoClientCtor(config.uri, clientOptions);

  try {
    await client.connect();
  } catch (cause: unknown) {
    // Connect failure → map the error (content-free contract).
    // The raw cause with potentially sensitive info (host/user in the error message)
    // is preserved on error.cause only — never surfaced in the summary.
    const mapped = mapMongoError(cause);

    // If mapMongoError returned a ConnectivityUnavailableError, throw it directly.
    // If it returned a ConnectionError or PermissionError, we wrap it in a
    // ConnectivityUnavailableError to present the three-option outcome.
    // This matches the pg/mysql factory pattern (Batch 3 resilient-connectivity).
    const { ConnectivityUnavailableError } = await import('../../../core/errors.js');
    if (mapped instanceof ConnectivityUnavailableError) {
      throw mapped;
    }

    // For ConnectionError/PermissionError from connect(): re-build the connectivity outcome
    // so callers always receive a ConnectivityUnavailableError (three options).
    const { buildConnectivityOutcome } = await import('../_shared/connectivity-outcome.js');
    const outcome = buildConnectivityOutcome({
      engine: 'mongodb',
      summary: mapped.message,
      attempts: [],
      runItYourselfQueries: [
        'db.runCommand({ listCollections: 1 })',
        'db.getCollectionNames().forEach(c => { db[c].aggregate([{ $sample: { size: 100 } }]) })',
        'db.getCollectionNames().forEach(c => { db[c].getIndexes() })',
        'db.runCommand({ dbStats: 1 })',
      ],
      installTool: 'mongodb',
      installDocUrl: 'https://www.npmjs.com/package/mongodb',
      dumpPath: '.dbgraph/dumps/mongodb-dump.json',
    });
    const err = new ConnectivityUnavailableError(outcome);
    err.cause = cause;
    throw err;
  }

  // ── 4. Wrap in the driver seam and return the adapter ─────────────────────
  const driver = createMongodbReadonlyDriver(client, config.database);
  return new MongodbSchemaAdapter(driver, config);
}
