/**
 * Read-only SQL strings for SQLite schema extraction.
 * Design §mapping "queries.ts" — all strings are read-only SELECTs / PRAGMAs.
 * NO write verbs (INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/MERGE/REPLACE).
 * These constants are passed to ReadonlyDriver.all() and ReadonlyDriver.pragma().
 * US-031: write-verb scanner will fail if any write verb appears here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// sqlite_master queries (tables, views, triggers, indexes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects all user-defined tables from sqlite_master.
 * Excludes: sqlite_sequence, sqlite_stat*, and all other sqlite_* internals.
 */
export const SQL_TABLES =
  "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

/**
 * Selects all user-defined views from sqlite_master.
 */
export const SQL_VIEWS =
  "SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name NOT LIKE 'sqlite_%' ORDER BY name";

/**
 * Selects all user-defined triggers from sqlite_master.
 */
export const SQL_TRIGGERS =
  "SELECT name, sql, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' ORDER BY name";

/**
 * Selects all user-defined indexes from sqlite_master.
 * Used to retrieve the index SQL (needed for partial-index WHERE extraction).
 * Auto-indexes (sqlite_autoindex_*) are excluded; they are implementation
 * artifacts already modelled by PK/UNIQUE constraints and MUST NOT be double-counted.
 */
export const SQL_INDEXES_MASTER =
  "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name";

// ─────────────────────────────────────────────────────────────────────────────
// PRAGMA names (passed to ReadonlyDriver.pragma())
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns column information for a table.
 * Rows: cid, name, type, notnull, dflt_value, pk.
 * Usage: driver.pragma(`table_info(${tableName})`)
 */
export const PRAGMA_TABLE_INFO = (tableName: string): string =>
  `table_info(${tableName})`;

/**
 * Returns foreign key list for a table.
 * Rows: id, seq, table, from, to, on_update, on_delete, match.
 * Usage: driver.pragma(`foreign_key_list(${tableName})`)
 */
export const PRAGMA_FOREIGN_KEY_LIST = (tableName: string): string =>
  `foreign_key_list(${tableName})`;

/**
 * Returns index list for a table.
 * Rows: seq, name, unique, origin, partial.
 * Usage: driver.pragma(`index_list(${tableName})`)
 */
export const PRAGMA_INDEX_LIST = (tableName: string): string =>
  `index_list(${tableName})`;

/**
 * Returns column information for a named index.
 * Rows: seqno, cid, name (null for expressions).
 * Usage: driver.pragma(`index_info(${indexName})`)
 */
export const PRAGMA_INDEX_INFO = (indexName: string): string =>
  `index_info(${indexName})`;

/**
 * Returns the current schema version.
 * Increments on every DDL change; stable on data-only DML.
 * Used by fingerprint() (US-009).
 * Usage: driver.pragma('schema_version')
 */
export const PRAGMA_SCHEMA_VERSION = 'schema_version';
