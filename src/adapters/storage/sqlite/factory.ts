/**
 * Factory for the SQLite GraphStore adapter.
 * Design §2 (factory join point) + §10 (sequence diagram).
 *
 * createSqliteGraphStore(opts) is the ONLY place where:
 *  1. The driver is selected and opened (ADR-004: driver never pulled into core).
 *  2. The raw DB is opened + migrations are run.
 *  3. A GraphStore-conforming adapter is returned.
 *
 * Phase 9.5b: the standalone `await import('better-sqlite3')` is REMOVED — the
 * dynamic import now lives inside `openRawDb`'s better-sqlite3 path in schema.ts.
 * factory.ts calls `openRawDb(path)` (now async, returns `WritableSqliteHandle`),
 * passes the handle to `runMigrations` and `new SqliteGraphStore`. Default driver
 * stays better-sqlite3; no `driver` option yet (added in Batch 2).
 *
 * Note: this adapter is under src/adapters/storage/sqlite/ — it is EXEMPT from
 * the write-verb security scan that targets src/adapters/engines/* (source-extraction
 * paths). The local index MUST write (CREATE TABLE, INSERT/UPSERT, DELETE) to its
 * own .dbgraph database file by design (ADR-005). This exemption is documented here
 * so Batch D boundary/security tests can scope correctly.
 *
 * Imports allowed: core types/ports only + storage-layer modules.
 */

import type { GraphStore } from '../../../core/ports/graph-store.js';
import { openRawDb } from './schema.js';
import { runMigrations } from './migrations.js';
import { SqliteGraphStore } from './sqlite-graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory options
// ─────────────────────────────────────────────────────────────────────────────

export interface SqliteGraphStoreOptions {
  /** Filesystem path to the SQLite database file, or ':memory:' for in-memory. */
  readonly path: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the SQLite graph store at `opts.path`, runs forward migrations if needed,
 * and returns a GraphStore-conforming adapter.
 *
 * @param opts.path - ':memory:' or an absolute path to the .dbgraph/dbgraph.db file.
 * @throws SchemaVersionError if the on-disk schema is newer than supported.
 * @throws StorageError if the database cannot be opened.
 */
export async function createSqliteGraphStore(
  opts: SqliteGraphStoreOptions,
): Promise<GraphStore> {
  // openRawDb dynamically imports better-sqlite3, opens the db, enables WAL + foreign keys,
  // and returns a WritableSqliteHandle. This is the ADR-004 seam.
  const handle = await openRawDb(opts.path);
  runMigrations(handle);
  return new SqliteGraphStore(handle);
}
