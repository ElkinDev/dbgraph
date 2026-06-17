/**
 * Forward-only migration runner for the SQLite graph store.
 * Design §3.3 — reads schema_version from meta, applies any pending migrations,
 * writes the new version. No downward migrations (the index is a derived cache).
 *
 * ADR-005: meta.schema_version tracks the integer schema version.
 * ADR-008: determinism — migration is inside a single transaction.
 *
 * Imports: better-sqlite3 types only (no core model imports needed here).
 * This file is only ever imported from the adapters subtree (ADR-004).
 */

import type { Database as Db } from 'better-sqlite3';
import { SchemaVersionError } from '../../../core/errors.js';
import { SCHEMA_V1_DDL } from './schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Current version constant
// ─────────────────────────────────────────────────────────────────────────────

/** The highest schema version this build of dbgraph knows about. */
export const CURRENT_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Migration descriptors
// ─────────────────────────────────────────────────────────────────────────────

interface Migration {
  readonly version: number;
  readonly up: (db: Db) => void;
}

/**
 * Ordered list of forward migrations.
 * Each migration brings the schema from (version - 1) to version.
 * New migrations are APPENDED to this array — never reordered.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up(db: Db): void {
      // Create all tables and indexes from scratch (fresh database at v0 → v1).
      for (const stmt of SCHEMA_V1_DDL) {
        db.exec(stmt);
      }
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Migration runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the current schema version from meta, runs all pending migrations in a
 * single transaction, then writes the new version to meta.
 *
 * Throws SchemaVersionError if the DB was written by a newer version of dbgraph
 * than CURRENT_SCHEMA_VERSION (observed > supported).
 *
 * Safe to call on an already-current DB — no migrations run, no-op.
 *
 * @param db - An open better-sqlite3 Database instance with foreign_keys + WAL enabled.
 */
export function runMigrations(db: Db): void {
  // Read current version. The meta table may not exist yet (v0 database).
  // We detect this by catching the "no such table" error and treating it as version 0.
  let current = 0;

  try {
    // If meta table exists, read schema_version.
    const metaExists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`,
      )
      .get();

    if (metaExists) {
      const row = db
        .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
        .get() as { value: string } | undefined;
      if (row !== undefined) {
        current = parseInt(row.value, 10);
      }
    }
  } catch {
    // Treat any read error as version 0 — let migrations create the schema.
    current = 0;
  }

  // Sanity check: if observed > supported, this DB was written by a newer dbgraph.
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(current, CURRENT_SCHEMA_VERSION);
  }

  // Collect pending migrations.
  const pending = MIGRATIONS.filter((m) => m.version > current);

  if (pending.length === 0) {
    // Already at current version — no-op.
    return;
  }

  // Run all pending migrations in a single transaction.
  const migrate = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
    }
    // Write the new schema version to meta.
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(CURRENT_SCHEMA_VERSION));
  });

  migrate();
}
