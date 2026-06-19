/**
 * Read-only SQL string constants for PostgreSQL schema extraction.
 * Design §queries.ts "catalog query set" — all strings are read-only SELECTs
 * over pg_catalog.* / information_schema. NO write verbs anywhere in this file.
 * US-031: write-verb scanner scans engines/** and WILL fail on write verbs.
 * ADR-008: every catalog query ends with an explicit ORDER BY for determinism.
 *
 * Catalog query strategy per design:
 *   - schemas/tables/cols     : pg_namespace, pg_class, pg_attribute, pg_attrdef
 *   - constraints             : pg_constraint + pg_get_constraintdef
 *   - indexes                 : pg_index + pg_get_indexdef
 *   - views / matviews        : pg_class relkind 'v'/'m' + pg_get_viewdef
 *   - functions / procedures  : pg_proc prokind 'f'/'p' + pg_get_functiondef
 *   - triggers                : pg_trigger (non-internal) + pg_get_triggerdef + tgtype
 *   - sequences               : pg_sequence + pg_class
 *   - comments                : obj_description / col_description
 *
 * Non-system filter: nspname NOT IN ('pg_catalog','information_schema')
 *   and excluding pg_toast / pg_temp_* namespaces.
 * Optional single-schema scope: AND nspname = $1 (when schema is provided).
 *
 * US-028 (PostgreSQL adapter), US-031 (read-only by construction),
 * ADR-008 (determinism — ORDER BY on every query).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Schema scope helper embedded as a comment here, NOT as a SQL fragment in scope,
// because the queries take the schema param directly as $1.
//
// All queries accept an optional $1 parameter for single-schema scoping.
// When $1 is NULL, all non-system schemas are returned.
// When $1 is a schema name, only that schema is returned.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User schemas from pg_namespace.
 * Excludes system namespaces: pg_catalog, information_schema, pg_toast, pg_temp_*.
 * Optional $1 scopes to a single schema (NULL = all).
 */
export const SQL_PG_SCHEMAS = `
SELECT
  n.nspname AS schema_name
FROM pg_catalog.pg_namespace n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Tables and Columns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User tables from pg_class where relkind = 'r' (ordinary table).
 * Excludes system/toast tables (nspname filter).
 * Optional $1 scopes to a single schema.
 */
export const SQL_PG_TABLES = `
SELECT
  n.nspname                                   AS schema_name,
  c.relname                                   AS table_name,
  c.oid                                       AS table_oid,
  obj_description(c.oid, 'pg_class')          AS comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, c.relname
`.trim();

/**
 * Columns for user tables from pg_attribute.
 * Joins pg_attrdef for default expressions, pg_type for declared type names.
 * attidentity: 'a' = ALWAYS, 'd' = BY DEFAULT, '' = not identity.
 * attgenerated: 's' = STORED, '' = not generated.
 * Excludes dropped columns (attisdropped = false) and system columns (attnum > 0).
 * Optional $1 scopes to a single schema.
 */
export const SQL_PG_COLUMNS = `
SELECT
  n.nspname                                         AS schema_name,
  c.relname                                         AS table_name,
  a.attnum                                          AS ordinal,
  a.attname                                         AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod)  AS data_type,
  NOT a.attnotnull                                  AS is_nullable,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid)       AS default_expr,
  a.attidentity                                     AS identity_kind,
  a.attgenerated                                    AS generated_kind,
  col_description(a.attrelid, a.attnum)             AS comment
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c     ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d
  ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE c.relkind = 'r'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, c.relname, a.attnum
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Constraints (PK, FK, UNIQUE, CHECK)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PK, FK, UNIQUE, and CHECK constraints from pg_constraint.
 * pg_get_constraintdef returns the human-readable definition (used for CHECK).
 * conkey / confkey are integer arrays of column positions (FK local/ref columns).
 * Optional $1 scopes to a single schema (by schema of the table).
 */
export const SQL_PG_CONSTRAINTS = `
SELECT
  n.nspname                                              AS schema_name,
  cl.relname                                             AS table_name,
  co.conname                                             AS constraint_name,
  co.contype                                             AS constraint_type,
  co.conkey                                              AS column_positions,
  co.confkey                                             AS fk_ref_positions,
  fn.nspname                                             AS fk_ref_schema,
  ft.relname                                             AS fk_ref_table,
  pg_catalog.pg_get_constraintdef(co.oid, true)          AS constraint_def
FROM pg_catalog.pg_constraint co
JOIN pg_catalog.pg_class cl     ON cl.oid = co.conrelid
JOIN pg_catalog.pg_namespace n  ON n.oid = cl.relnamespace
LEFT JOIN pg_catalog.pg_class ft   ON ft.oid = co.confrelid
LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = ft.relnamespace
WHERE co.contype IN ('p', 'f', 'u', 'c')
  AND cl.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, cl.relname, co.conname
`.trim();

/**
 * Column name lookup for constraint membership resolution.
 * Joins pg_attribute to get column names by attnum for a given table oid.
 * Used in map.ts to resolve conkey/confkey integer arrays to column names.
 * Optional $1 scopes to a single schema.
 */
export const SQL_PG_COLUMN_NAMES = `
SELECT
  n.nspname   AS schema_name,
  c.relname   AS table_name,
  c.oid       AS table_oid,
  a.attnum    AS attnum,
  a.attname   AS column_name
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c     ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, c.relname, a.attnum
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indexes from pg_index + pg_get_indexdef.
 * pg_get_indexdef returns the full CREATE INDEX statement (for expression/partial/INCLUDE detection).
 * indisprimary / indisunique captured for classification.
 * indkey contains the ordered column position array (0 = expression column).
 * indnkeyatts (PG11+): number of key columns; columns beyond that are INCLUDED non-key columns.
 * Excludes primary key indexes (they are captured in pg_constraint).
 * Optional $1 scopes by table schema.
 */
export const SQL_PG_INDEXES = `
SELECT
  n.nspname                                                 AS schema_name,
  t.relname                                                 AS table_name,
  ix.relname                                                AS index_name,
  i.indisunique                                             AS is_unique,
  i.indisprimary                                            AS is_primary,
  i.indkey::int[]                                           AS key_columns,
  i.indnkeyatts                                             AS n_key_atts,
  pg_catalog.pg_get_indexdef(i.indexrelid, 0, true)         AS index_def
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ix  ON ix.oid = i.indexrelid
JOIN pg_catalog.pg_class t   ON t.oid  = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE t.relkind = 'r'
  AND NOT i.indisprimary
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, t.relname, ix.relname
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Views and Materialized Views
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Views (relkind='v') and materialized views (relkind='m') from pg_class.
 * pg_get_viewdef returns the SELECT body.
 * is_matview=true for relkind='m' — mapped to kind:'view'+extra.materialized:true in map.ts.
 * Optional $1 scopes to a single schema.
 */
export const SQL_PG_VIEWS = `
SELECT
  n.nspname                                         AS schema_name,
  c.relname                                         AS view_name,
  c.relkind                                         AS rel_kind,
  pg_catalog.pg_get_viewdef(c.oid, true)            AS view_def,
  obj_description(c.oid, 'pg_class')               AS comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, c.relname
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Functions and Procedures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Functions (prokind='f') and procedures (prokind='p') from pg_proc.
 * pg_get_functiondef returns the full CREATE FUNCTION/PROCEDURE body.
 * prokind: 'f'=function, 'p'=procedure, 'a'=aggregate, 'w'=window (a/w excluded).
 * Optional $1 scopes to a single schema.
 */
export const SQL_PG_ROUTINES = `
SELECT
  n.nspname                                         AS schema_name,
  p.proname                                         AS routine_name,
  p.prokind                                         AS routine_kind,
  pg_catalog.pg_get_functiondef(p.oid)              AS routine_def,
  obj_description(p.oid, 'pg_proc')                AS comment
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, p.proname
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Triggers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Non-internal triggers from pg_trigger.
 * tgtype is a bitmask:
 *   bit 0 (1): row-level (vs statement-level)
 *   bit 1 (2): BEFORE (set) / AFTER (clear)
 *   bit 2 (4): INSERT
 *   bit 3 (8): DELETE
 *   bit 4 (16): UPDATE
 *   bit 5 (32): TRUNCATE
 *   bit 6 (64): INSTEAD OF
 * tgfoid is the OID of the trigger function.
 * pg_get_triggerdef returns the full CREATE TRIGGER statement.
 * Optional $1 scopes to a single schema (by schema of the parent table).
 */
export const SQL_PG_TRIGGERS = `
SELECT
  n.nspname                                                   AS schema_name,
  cl.relname                                                  AS table_name,
  tr.tgname                                                   AS trigger_name,
  tr.tgtype                                                   AS tgtype,
  tr.tgfoid                                                   AS function_oid,
  tf.relname                                                  AS function_schema_class,
  fn.nspname                                                  AS function_schema,
  pf.proname                                                  AS function_name,
  pg_catalog.pg_get_triggerdef(tr.oid, true)                  AS trigger_def
FROM pg_catalog.pg_trigger tr
JOIN pg_catalog.pg_class cl     ON cl.oid = tr.tgrelid
JOIN pg_catalog.pg_namespace n  ON n.oid  = cl.relnamespace
JOIN pg_catalog.pg_proc pf      ON pf.oid = tr.tgfoid
JOIN pg_catalog.pg_namespace fn ON fn.oid = pf.pronamespace
LEFT JOIN pg_catalog.pg_class tf ON tf.oid = tr.tgfoid
WHERE NOT tr.tgisinternal
  AND cl.relkind IN ('r', 'v')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, cl.relname, tr.tgname
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Sequences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-defined sequences from pg_sequence + pg_class.
 * Richer than information_schema.sequences (captures start/min/max/increment/cycle).
 * Optional $1 scopes to a single schema.
 */
export const SQL_PG_SEQUENCES = `
SELECT
  n.nspname                                    AS schema_name,
  c.relname                                    AS sequence_name,
  s.seqstart                                   AS start_value,
  s.seqincrement                               AS increment,
  s.seqmin                                     AS minimum_value,
  s.seqmax                                     AS maximum_value,
  s.seqcycle                                   AS is_cycling,
  obj_description(c.oid, 'pg_class')           AS comment
FROM pg_catalog.pg_sequence s
JOIN pg_catalog.pg_class c     ON c.oid = s.seqrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
ORDER BY n.nspname, c.relname
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-query catalog change fingerprint (US-009).
 * Returns {m: MAX(oid_and_attnum), c: COUNT(*)} over non-system pg_class + pg_attribute entries.
 *
 * Marker components:
 *   MAX(c.oid)                — moves on CREATE TABLE/VIEW/INDEX/SEQUENCE (OIDs advance on DDL)
 *   MAX(a.attnum)             — moves when a column is added (attnum = column ordinal, advances
 *                                per-table on ALTER TABLE ADD COLUMN; does not regress on DROP)
 *   COUNT(DISTINCT c.oid)     — moves on CREATE/DROP of any relation
 *   COUNT(a.attnum)           — moves on ADD COLUMN or DROP COLUMN (row count in pg_attribute)
 *
 * Together these detect both ADD OBJECT and ADD COLUMN, which MAX(oid)+COUNT(*) alone would miss
 * when ALTER TABLE ADD COLUMN adds no new relation oid. (SUGGESTION-2 fix.)
 *
 * sha256(`${maxOid}|${maxAttnum}|${relCount}|${attrCount}`) is computed by the adapter class.
 *
 * Optional $1 scopes to a single schema (NULL = all non-system schemas).
 */
export const SQL_PG_FINGERPRINT = `
SELECT
  MAX(c.oid)          AS max_oid,
  COALESCE(MAX(a.attnum), 0) AS max_attnum,
  COUNT(DISTINCT c.oid) AS rel_count,
  COUNT(a.attnum)     AS attr_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid
  AND a.attnum > 0
  AND NOT a.attisdropped
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
  AND ($1::text IS NULL OR n.nspname = $1::text)
`.trim();
