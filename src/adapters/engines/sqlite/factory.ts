/**
 * createSqliteSchemaAdapter — factory for the SQLite schema extraction adapter.
 * Design §5.1 — the ONLY join point between core and the SQLite driver.
 *
 * Responsibilities:
 *   1. Explicit driver selection (default: better-sqlite3; NO silent auto-fallback).
 *   2. Dynamic import of the chosen driver (ADR-004: driver never pulled into core).
 *   3. Open read-only with fileMustExist flags.
 *   4. Map driver-level open errors to typed ConnectionError / PermissionError.
 *   5. Wrap the raw handle in ReadonlyDriver and return a SqliteSchemaAdapter.
 *
 * node:sqlite requires Node >= 22.5; requesting it on an older runtime throws
 * ConnectionError with an actionable message (design §2 — no silent downgrade).
 *
 * US-026 (first concrete adapter), US-031 (read-only by construction).
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { SqliteAdapterConfig } from '../../../core/ports/schema-adapter.js';
import { ConnectionError } from '../../../core/errors.js';
import {
  betterSqliteDriver,
  nodeSqliteDriver,
  isNodeSqliteAvailable,
} from './driver.js';
import { SqliteSchemaAdapter } from './sqlite-schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a SQLite source database in read-only mode and returns a SchemaAdapter.
 * The adapter is already-open — no `open()` call is needed (mirrors createSqliteGraphStore).
 *
 * @param config.file    - Absolute path to the source .db file.
 * @param config.driver  - 'better-sqlite3' (default) | 'node:sqlite'. Explicit selection,
 *                         no silent fallback.
 * @throws ConnectionError  if the file is missing, not a valid SQLite db, db is locked,
 *                          or the required driver package is not installed.
 * @throws ConnectionError  if node:sqlite is requested on Node < 22.5.
 */
export async function createSqliteSchemaAdapter(
  config: SqliteAdapterConfig,
): Promise<SchemaAdapter> {
  const driver = config.driver ?? 'better-sqlite3';

  if (driver === 'better-sqlite3') {
    return openWithBetterSqlite(config.file);
  } else {
    return openWithNodeSqlite(config.file);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// better-sqlite3 open path
// ─────────────────────────────────────────────────────────────────────────────

async function openWithBetterSqlite(file: string): Promise<SchemaAdapter> {
  // Dynamic import — ADR-004 seam, mirrors createSqliteGraphStore.
  // We type the module as unknown and cast to a constructor to stay compatible with
  // both CommonJS-style (mod.default is the constructor) and ESM-style resolutions.
  let mod: unknown;
  try {
    mod = await import('better-sqlite3');
  } catch (cause) {
    throw new ConnectionError(
      "Required driver 'better-sqlite3' is not installed. " +
        "Run: npm i better-sqlite3",
      cause,
    );
  }

  // The default export of better-sqlite3 IS the Database constructor.
  type BetterSqliteCtor = new(
    path: string,
    opts?: Record<string, unknown>,
  ) => import('better-sqlite3').Database;
  const DatabaseCtor: BetterSqliteCtor =
    ((mod as Record<string, unknown>)['default'] as BetterSqliteCtor | undefined) ??
    (mod as BetterSqliteCtor);

  let db: import('better-sqlite3').Database | null = null;
  try {
    db = new DatabaseCtor(file, { readonly: true, fileMustExist: true });
    // Validate the file is actually a SQLite database by issuing a cheap PRAGMA.
    // better-sqlite3 defers header validation until the first query.
    db.prepare('PRAGMA schema_version').all();
    const drv = betterSqliteDriver(db);
    return new SqliteSchemaAdapter(drv);
  } catch (cause) {
    // Close the handle if we opened it before the validation query threw
    if (db !== null) {
      try { db.close(); } catch { /* ignore */ }
    }
    throw mapOpenError(file, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// node:sqlite open path
// ─────────────────────────────────────────────────────────────────────────────

async function openWithNodeSqlite(file: string): Promise<SchemaAdapter> {
  // Version gate — design §2: explicit error, no silent downgrade.
  if (!isNodeSqliteAvailable()) {
    throw new ConnectionError(
      "Driver 'node:sqlite' requires Node.js >= 22.5. " +
        `Current version: ${process.versions['node']}. ` +
        "Use driver: 'better-sqlite3' or upgrade Node.js.",
    );
  }

  let DatabaseSync: { new(path: string, opts?: Record<string, unknown>): unknown };
  try {
    // node:sqlite is only available on Node >= 22 — dynamic import required to
    // avoid crashing on older runtimes where this factory is never called.
    const mod = await import('node:sqlite' as string);
    DatabaseSync = (mod as Record<string, unknown>)['DatabaseSync'] as typeof DatabaseSync;
  } catch (cause) {
    throw new ConnectionError(
      "Driver 'node:sqlite' could not be loaded. " +
        `Ensure Node.js >= 22.5. Current version: ${process.versions['node']}.`,
      cause,
    );
  }

  try {
    // node:sqlite open-flags: pass readOnly option
    // The exact option name varies by Node version; we use 'readOnly' (camelCase) which
    // is the documented API for Node 22.5+. See design open-question note.
    const db = new DatabaseSync(file, { readOnly: true });
    const drv = nodeSqliteDriver(db);
    return new SqliteSchemaAdapter(drv);
  } catch (cause) {
    throw mapOpenError(file, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error mapping (design §read-only enforcement + error mapping)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a raw driver open error to a typed ConnectionError with an actionable message.
 * Covers: missing file, not-a-database, locked/busy.
 */
function mapOpenError(file: string, cause: unknown): ConnectionError {
  const msg = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();

  if (
    msg.includes('no such file') ||
    msg.includes('cannot open') ||
    msg.includes('does not exist') ||
    msg.includes('file not found') ||
    // better-sqlite3 throws "SQLITE_CANTOPEN: unable to open database file" when fileMustExist
    msg.includes('cantopen') ||
    msg.includes('unable to open')
  ) {
    return new ConnectionError(
      `Source database not found at ${file}. Check the path.`,
      cause,
    );
  }

  if (
    msg.includes('not a database') ||
    msg.includes('file is not a database') ||
    msg.includes('malformed') ||
    msg.includes('notadb') ||
    msg.includes('corrupt')
  ) {
    return new ConnectionError(
      `${file} is not a valid SQLite database.`,
      cause,
    );
  }

  if (msg.includes('locked') || msg.includes('busy') || msg.includes('sqlite_busy')) {
    return new ConnectionError(
      `${file} is locked by another process. Close it and retry.`,
      cause,
    );
  }

  // Generic fallback — still actionable, still typed
  return new ConnectionError(
    `Failed to open source database at ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  );
}
