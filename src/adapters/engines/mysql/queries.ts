/**
 * Read-only SQL string constants for MySQL schema extraction.
 * Design §queries.ts "catalog query strategy" — all strings are read-only SELECTs
 * over information_schema. NO write verbs anywhere in this file.
 * US-031: write-verb scanner scans engines/** and WILL fail on write verbs.
 * ADR-008: every catalog query ends with an explicit ORDER BY for determinism.
 * ADR-004: NO top-level mysql2 import; catalog queries are information_schema SELECTs.
 *
 * All queries are scoped to the connected database via DATABASE().
 * MySQL has no schema-vs-database distinction: schema == database.
 * No bind parameters are needed (DATABASE() is a function, not a bind).
 *
 * US-029 (MySQL adapter, Phase 8b), US-031 (read-only by construction),
 * ADR-008 (determinism — ORDER BY on every query).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base tables from information_schema.TABLES.
 * TABLE_TYPE = 'BASE TABLE' excludes views (handled separately).
 * TABLE_COMMENT surfaced inline.
 * Scoped to the connected database via DATABASE().
 * ADR-008: ORDER BY TABLE_NAME.
 */
export const SQL_MYSQL_TABLES = `
SELECT
  TABLE_SCHEMA   AS table_schema,
  TABLE_NAME     AS table_name,
  TABLE_COMMENT  AS table_comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Columns for all base tables and views in the connected database.
 * COLUMN_TYPE: declared MySQL type (e.g. int, varchar(255)).
 * IS_NULLABLE: YES/NO string from information_schema.
 * COLUMN_DEFAULT: expression or NULL when no default.
 * EXTRA: auto_increment / STORED GENERATED / VIRTUAL GENERATED / DEFAULT_GENERATED.
 * GENERATION_EXPRESSION: for generated columns.
 * COLUMN_COMMENT: inline column comment.
 * ADR-008: ORDER BY TABLE_NAME, ORDINAL_POSITION.
 */
export const SQL_MYSQL_COLUMNS = `
SELECT
  TABLE_SCHEMA          AS table_schema,
  TABLE_NAME            AS table_name,
  ORDINAL_POSITION      AS ordinal_position,
  COLUMN_NAME           AS column_name,
  COLUMN_TYPE           AS column_type,
  IS_NULLABLE           AS is_nullable,
  COLUMN_DEFAULT        AS column_default,
  EXTRA                 AS extra,
  GENERATION_EXPRESSION AS generation_expression,
  COLUMN_COMMENT        AS column_comment
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Constraints: PK, UNIQUE (TABLE_CONSTRAINTS + KEY_COLUMN_USAGE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PK and UNIQUE constraint column membership.
 * Joined TABLE_CONSTRAINTS + KEY_COLUMN_USAGE.
 * FK columns are fetched separately (SQL_MYSQL_FK_COLUMNS) with referential info.
 * ADR-008: ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION.
 */
export const SQL_MYSQL_PK_UK_COLUMNS = `
SELECT
  tc.TABLE_SCHEMA      AS table_schema,
  tc.TABLE_NAME        AS table_name,
  tc.CONSTRAINT_NAME   AS constraint_name,
  tc.CONSTRAINT_TYPE   AS constraint_type,
  kcu.COLUMN_NAME      AS column_name,
  kcu.ORDINAL_POSITION AS ordinal_position
FROM information_schema.TABLE_CONSTRAINTS tc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
  AND kcu.CONSTRAINT_NAME  = tc.CONSTRAINT_NAME
  AND kcu.TABLE_NAME        = tc.TABLE_NAME
WHERE tc.TABLE_SCHEMA = DATABASE()
  AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
`.trim();

/**
 * FK constraint column membership + referential info (referenced table/schema/column).
 * ORDINAL_POSITION: local column order.
 * POSITION_IN_UNIQUE_CONSTRAINT: aligned ref column order.
 * ON_DELETE / ON_UPDATE from REFERENTIAL_CONSTRAINTS.
 * ADR-008: ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION.
 */
export const SQL_MYSQL_FK_COLUMNS = `
SELECT
  kcu.TABLE_SCHEMA               AS table_schema,
  kcu.TABLE_NAME                 AS table_name,
  kcu.CONSTRAINT_NAME            AS constraint_name,
  kcu.COLUMN_NAME                AS column_name,
  kcu.ORDINAL_POSITION           AS ordinal_position,
  kcu.REFERENCED_TABLE_SCHEMA    AS referenced_table_schema,
  kcu.REFERENCED_TABLE_NAME      AS referenced_table_name,
  kcu.REFERENCED_COLUMN_NAME     AS referenced_column_name,
  kcu.POSITION_IN_UNIQUE_CONSTRAINT AS position_in_unique_constraint,
  rc.DELETE_RULE                 AS delete_rule,
  rc.UPDATE_RULE                 AS update_rule
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.TABLE_CONSTRAINTS tc
  ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
  AND tc.CONSTRAINT_NAME  = kcu.CONSTRAINT_NAME
  AND tc.TABLE_NAME        = kcu.TABLE_NAME
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
  AND rc.CONSTRAINT_NAME  = kcu.CONSTRAINT_NAME
WHERE kcu.TABLE_SCHEMA = DATABASE()
  AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// CHECK constraints (MySQL 8.0.16+)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CHECK constraints from information_schema.CHECK_CONSTRAINTS (MySQL 8.0.16+).
 * Joined to TABLE_CONSTRAINTS to get the table association.
 * CHECK_CLAUSE contains the predicate expression.
 * ADR-008: ORDER BY TABLE_NAME, CONSTRAINT_NAME.
 */
export const SQL_MYSQL_CHECK_CONSTRAINTS = `
SELECT
  tc.TABLE_SCHEMA    AS table_schema,
  tc.TABLE_NAME      AS table_name,
  cc.CONSTRAINT_NAME AS constraint_name,
  cc.CHECK_CLAUSE    AS check_clause
FROM information_schema.CHECK_CONSTRAINTS cc
JOIN information_schema.TABLE_CONSTRAINTS tc
  ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
  AND tc.CONSTRAINT_NAME  = cc.CONSTRAINT_NAME
WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
  AND tc.CONSTRAINT_TYPE = 'CHECK'
ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Indexes (STATISTICS — excludes PRIMARY KEY which is a constraint)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indexes from information_schema.STATISTICS.
 * Excludes PRIMARY KEY entries (INDEX_NAME = 'PRIMARY') — those are in constraints.
 * NON_UNIQUE: 0 = unique index, 1 = non-unique.
 * SEQ_IN_INDEX: column ordinal within the index (for composite index ordering).
 * EXPRESSION: non-null for functional/expression indexes (MySQL 8.0.13+).
 * SUB_PART: prefix length for prefix indexes (e.g. varchar prefix).
 * INDEX_TYPE: BTREE, HASH, FULLTEXT, SPATIAL.
 * ADR-008: ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX.
 */
export const SQL_MYSQL_STATISTICS = `
SELECT
  TABLE_SCHEMA  AS table_schema,
  TABLE_NAME    AS table_name,
  INDEX_NAME    AS index_name,
  NON_UNIQUE    AS non_unique,
  SEQ_IN_INDEX  AS seq_in_index,
  COLUMN_NAME   AS column_name,
  EXPRESSION    AS expression,
  SUB_PART      AS sub_part,
  INDEX_TYPE    AS index_type
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME != 'PRIMARY'
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Views from information_schema.VIEWS.
 * VIEW_DEFINITION: MySQL-reparsed/normalized body (caveat: may be truncated by
 * the server for very large views — D12; the tokenizer is presence-gated so a
 * normalized body still resolves real referenced names).
 * NOT using SHOW CREATE VIEW (not a plain catalog SELECT — ADR-007/US-031).
 * ADR-008: ORDER BY TABLE_NAME.
 */
export const SQL_MYSQL_VIEWS = `
SELECT
  TABLE_SCHEMA    AS table_schema,
  TABLE_NAME      AS table_name,
  VIEW_DEFINITION AS view_definition
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Routines (functions + procedures)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stored functions and procedures from information_schema.ROUTINES.
 * ROUTINE_TYPE: PROCEDURE or FUNCTION.
 * ROUTINE_DEFINITION: body text.
 * ROUTINE_COMMENT: optional comment.
 * Scoped to ROUTINE_SCHEMA = DATABASE() (not TABLE_SCHEMA).
 * ADR-008: ORDER BY ROUTINE_TYPE, ROUTINE_NAME.
 */
export const SQL_MYSQL_ROUTINES = `
SELECT
  ROUTINE_SCHEMA     AS routine_schema,
  ROUTINE_NAME       AS routine_name,
  ROUTINE_TYPE       AS routine_type,
  ROUTINE_DEFINITION AS routine_definition,
  ROUTINE_COMMENT    AS routine_comment
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE()
  AND ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
ORDER BY ROUTINE_TYPE, ROUTINE_NAME
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Triggers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Triggers from information_schema.TRIGGERS.
 * EVENT_MANIPULATION: INSERT, UPDATE, or DELETE.
 * ACTION_TIMING: BEFORE or AFTER.
 * EVENT_OBJECT_TABLE: the parent table the trigger fires on.
 * ACTION_STATEMENT: the trigger body.
 * Scoped to TRIGGER_SCHEMA = DATABASE().
 * ADR-008: ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME.
 */
export const SQL_MYSQL_TRIGGERS = `
SELECT
  TRIGGER_SCHEMA       AS trigger_schema,
  TRIGGER_NAME         AS trigger_name,
  EVENT_MANIPULATION   AS event_manipulation,
  ACTION_TIMING        AS action_timing,
  EVENT_OBJECT_TABLE   AS event_object_table,
  ACTION_STATEMENT     AS action_statement
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint (one cheap query — Decision §6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-query DDL-sensitive catalog change fingerprint (US-009, Decision §6).
 * Returns one row: table_count, column_count, routine_count.
 *
 * Marker components:
 *   table_count   — COUNT over TABLES;   moves on CREATE/DROP TABLE/VIEW
 *   column_count  — COUNT over COLUMNS;  moves on ADD COLUMN (SUGGESTION-2 fix)
 *   routine_count — COUNT over ROUTINES; moves on CREATE/DROP PROCEDURE/FUNCTION
 *
 * All three are stable under pure DML (no catalog row count changes).
 * Deliberately AVOIDS MAX(UPDATE_TIME) which is NULL for InnoDB until flush.
 *
 * sha256(table_count|column_count|routine_count) is computed by the adapter class.
 */
export const SQL_MYSQL_FINGERPRINT = `
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES   WHERE TABLE_SCHEMA   = DATABASE()) AS table_count,
  (SELECT COUNT(*) FROM information_schema.COLUMNS  WHERE TABLE_SCHEMA   = DATABASE()) AS column_count,
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()) AS routine_count
`.trim();
