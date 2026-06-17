/**
 * SQLite DDL for the graph store.
 * Design §3.1 — nodes, edges, nodes_fts (FTS5), snapshots, meta tables.
 * ADR-005: .dbgraph/dbgraph.db schema.
 *
 * This file is intentionally side-effect-free: it exports constants and a helper
 * to open a raw Database instance. Callers (factory.ts) drive the lifecycle.
 * Imports: better-sqlite3 only (no core model imports needed at DDL level).
 */

// Dynamic import of better-sqlite3 keeps the driver out of core (ADR-004).
// schema.ts itself is only ever imported from the adapters subtree.
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';

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
 * Opens a raw better-sqlite3 Database instance.
 * Enables WAL mode and foreign keys.
 * Exported for use by migrations.ts and for testing schema manipulation.
 *
 * @param path - ':memory:' or an absolute filesystem path to the .db file.
 */
export function openRawDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
