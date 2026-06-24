/**
 * SQLite DDL for the graph store.
 * Design §3.1 — nodes, edges, nodes_fts (FTS5), snapshots, meta tables.
 * ADR-005: .dbgraph/dbgraph.db schema.
 *
 * This file is intentionally side-effect-free: it exports constants and a helper
 * to open a raw Database handle. Callers (factory.ts) drive the lifecycle.
 *
 * Phase 9.5b: static `import Database from 'better-sqlite3'` REMOVED.
 * `openRawDb` dynamically imports better-sqlite3 inside its only path and
 * returns a `WritableSqliteHandle` so schema.ts, migrations.ts, and
 * sqlite-graph-store.ts never depend on a concrete driver type.
 */

import type { WritableSqliteHandle } from './handle.js';
import { betterSqliteHandle } from './handle.js';

// ─────────────────────────────────────────────────────────────────────────────
// DDL statements (design §3.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered DDL statements to create the full schema from scratch.
 * Applied in a single transaction inside runMigrations (design §3.3).
 */
export const SCHEMA_V1_DDL: readonly string[] = [
  // nodes: one row per graph node (real or stub).
  `CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    schema_name TEXT,
    name        TEXT NOT NULL,
    qname       TEXT NOT NULL,
    level       TEXT NOT NULL,
    missing     INTEGER NOT NULL DEFAULT 0,
    excluded    INTEGER NOT NULL DEFAULT 0,
    body_hash   TEXT,
    payload     TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_kind  ON nodes(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_qname ON nodes(qname)`,

  // edges: directed, typed relationship between two node IDs.
  `CREATE TABLE IF NOT EXISTS edges (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    src_id      TEXT NOT NULL REFERENCES nodes(id),
    dst_id      TEXT NOT NULL REFERENCES nodes(id),
    confidence  TEXT NOT NULL,
    score       REAL,
    attrs       TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_edges_src  ON edges(src_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_dst  ON edges(dst_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind)`,

  // nodes_fts: FTS5 search surface (design §3.2).
  // body is populated ONLY when node.level='full' (US-003/US-011).
  // tokenize: unicode61 with diacritic removal for accent/case-insensitive matching.
  `CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    qname,
    comment,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  )`,

  // snapshots: one row per sync (US-009 model).
  `CREATE TABLE IF NOT EXISTS snapshots (
    id              TEXT PRIMARY KEY,
    taken_at        TEXT NOT NULL,
    engine          TEXT NOT NULL,
    engine_version  TEXT,
    fingerprint     TEXT NOT NULL,
    counts          TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_taken_at ON snapshots(taken_at)`,

  // meta: key/value store for schema_version, engine, levels, etc.
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

// ─────────────────────────────────────────────────────────────────────────────
// DDL for v2 additions (phase-4-cli-config Batch F)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DDL for the snapshot_objects manifest table (schema version 2).
 * Stores one row per indexed object per snapshot, enabling per-object diff
 * without re-querying the target database. LOCAL index ONLY — never written
 * to the target DB. Includes the supporting index on snapshot_id.
 *
 * Design Decision 3 (phase-4-cli-config): populated by putSnapshot from the
 * store's own nodes table inside the same transaction.
 */
export const SNAPSHOT_OBJECTS_DDL = [
  `CREATE TABLE IF NOT EXISTS snapshot_objects (
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    node_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,
    qname       TEXT NOT NULL,
    body_hash   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snapshot_objects_snapshot ON snapshot_objects(snapshot_id)`,
].join(';\n');

// ─────────────────────────────────────────────────────────────────────────────
// Raw database factory (for migrations and tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a better-sqlite3 Database and returns it wrapped as a `WritableSqliteHandle`.
 * Enables WAL mode and foreign keys.
 * Exported for use by migrations.ts, factory.ts, and tests.
 *
 * No static `import Database from 'better-sqlite3'` — the import is DYNAMIC
 * inside this function so schema.ts never pulls a concrete driver into callers
 * that only need the type-level DDL constants (ADR-004).
 *
 * @param path - ':memory:' or an absolute filesystem path to the .db file.
 */
export async function openRawDb(path: string): Promise<WritableSqliteHandle> {
  // Dynamic import keeps better-sqlite3 out of core-only consumers (ADR-004).
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path);
  const handle = betterSqliteHandle(db);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  return handle;
}
