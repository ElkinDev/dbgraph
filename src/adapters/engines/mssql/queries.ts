/**
 * Read-only SQL string constants for SQL Server schema extraction.
 * Design §queries.ts "catalog query set" — all strings are read-only SELECTs
 * over sys.* catalog views. NO write verbs anywhere in this file.
 * US-031: write-verb scanner scans engines/** and WILL fail on write verbs.
 * ADR-008: every catalog query ends with an explicit ORDER BY for determinism.
 *
 * These constants are used in TWO paths:
 *   1. MssqlSchemaAdapter (native tedious/mssql driver) — queries run as
 *      tabular SELECTs; rows are returned as plain JS objects. Constants are
 *      used verbatim by driver.query().
 *   2. SqlcmdStrategy / dump-emitter.ts (sqlcmd CLI) — FOR JSON PATH,
 *      INCLUDE_NULL_VALUES is APPENDED DIRECTLY to each constant (not wrapped
 *      in a subquery), so that ORDER BY + FOR JSON coexist at the top level.
 *      Top-level ORDER BY + FOR JSON is valid SQL Server; ORDER BY inside a
 *      derived table is illegal (Msg 1033) unless TOP/OFFSET is present.
 *
 * These constants are passed to MssqlReadonlyDriver.query() in map.ts.
 * No DB execution in Batch A — string constants only, consumed in Batch B.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tables and columns (with types, nullability, defaults, computed columns)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tables: all user tables in the database, with schema name.
 * Excludes system tables (is_ms_shipped = 0).
 */
export const SQL_MSSQL_TABLES = `
SELECT
  s.name                          AS schema_name,
  t.name                          AS table_name,
  t.object_id                     AS object_id
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name
`.trim();

/**
 * Columns with type info, nullability, computed column flag, and default expression.
 * Joins: sys.columns → sys.types (for type name), sys.computed_columns,
 * sys.default_constraints.
 * One row per column; ordered by table schema/name then column ordinal.
 */
export const SQL_MSSQL_COLUMNS = `
SELECT
  s.name                          AS schema_name,
  t.name                          AS table_name,
  c.column_id                     AS column_id,
  c.name                          AS column_name,
  tp.name                         AS data_type,
  c.max_length                    AS max_length,
  c.precision                     AS precision,
  c.scale                         AS scale,
  c.is_nullable                   AS is_nullable,
  c.is_computed                   AS is_computed,
  cc.definition                   AS computed_definition,
  dc.definition                   AS default_definition
FROM sys.tables t
JOIN sys.schemas s          ON s.schema_id    = t.schema_id
JOIN sys.columns c          ON c.object_id    = t.object_id
JOIN sys.types tp           ON tp.user_type_id = c.user_type_id
LEFT JOIN sys.computed_columns cc
  ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints dc
  ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Primary key and unique key constraints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PK and UNIQUE key constraints with their column membership.
 * Grouped by constraint — multiple rows per composite constraint.
 * key_ordinal orders columns within the constraint.
 */
export const SQL_MSSQL_KEY_CONSTRAINTS = `
SELECT
  s.name                          AS schema_name,
  t.name                          AS table_name,
  kc.name                         AS constraint_name,
  kc.type                         AS constraint_type,
  c.name                          AS column_name,
  ic.key_ordinal                  AS key_ordinal
FROM sys.key_constraints kc
JOIN sys.tables t     ON t.object_id  = kc.parent_object_id
JOIN sys.schemas s    ON s.schema_id  = t.schema_id
JOIN sys.indexes i    ON i.object_id  = kc.parent_object_id
                      AND i.name      = kc.name
JOIN sys.index_columns ic
  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c
  ON c.object_id = t.object_id AND c.column_id = ic.column_id
WHERE t.is_ms_shipped = 0
  AND ic.is_included_column = 0
ORDER BY s.name, t.name, kc.name, ic.key_ordinal
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Foreign keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Foreign keys with local and referenced column pairs.
 * One row per FK column pair; grouped by FK id in map.ts.
 * constraint_column_id orders columns within the constraint.
 */
export const SQL_MSSQL_FOREIGN_KEYS = `
SELECT
  s.name                          AS schema_name,
  t.name                          AS table_name,
  fk.name                         AS constraint_name,
  fk.object_id                    AS fk_id,
  rs.name                         AS ref_schema_name,
  rt.name                         AS ref_table_name,
  cc.name                         AS local_column,
  rc.name                         AS ref_column,
  fkc.constraint_column_id        AS constraint_column_id
FROM sys.foreign_keys fk
JOIN sys.tables t           ON t.object_id   = fk.parent_object_id
JOIN sys.schemas s          ON s.schema_id   = t.schema_id
JOIN sys.tables rt          ON rt.object_id  = fk.referenced_object_id
JOIN sys.schemas rs         ON rs.schema_id  = rt.schema_id
JOIN sys.foreign_key_columns fkc
  ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns cc
  ON cc.object_id = t.object_id AND cc.column_id = fkc.parent_column_id
JOIN sys.columns rc
  ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Check constraints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check constraints with their predicate definition.
 */
export const SQL_MSSQL_CHECK_CONSTRAINTS = `
SELECT
  s.name                          AS schema_name,
  t.name                          AS table_name,
  chk.name                        AS constraint_name,
  chk.definition                  AS definition
FROM sys.check_constraints chk
JOIN sys.tables t  ON t.object_id = chk.parent_object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, chk.name
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Indexes (including clustered/nonclustered, filtered, included columns)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indexes with column membership.
 * Excludes heap pseudo-index (index_id = 0).
 * is_included_column distinguishes key columns from INCLUDE'd columns.
 * filter_definition is non-null for filtered (partial) indexes.
 * type_desc: 'CLUSTERED' | 'NONCLUSTERED' | 'XML' | 'SPATIAL' | etc.
 */
export const SQL_MSSQL_INDEXES = `
SELECT
  s.name                          AS schema_name,
  t.name                          AS table_name,
  i.name                          AS index_name,
  i.is_unique                     AS is_unique,
  i.is_primary_key                AS is_primary_key,
  i.is_unique_constraint          AS is_unique_constraint,
  i.type_desc                     AS type_desc,
  i.filter_definition             AS filter_definition,
  c.name                          AS column_name,
  ic.key_ordinal                  AS key_ordinal,
  ic.index_column_id              AS index_column_id,
  ic.is_included_column           AS is_included_column
FROM sys.indexes i
JOIN sys.tables t   ON t.object_id  = i.object_id
JOIN sys.schemas s  ON s.schema_id  = t.schema_id
JOIN sys.index_columns ic
  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c
  ON c.object_id = t.object_id AND c.column_id = ic.column_id
WHERE t.is_ms_shipped = 0
  AND i.index_id > 0
ORDER BY s.name, t.name, i.name, ic.index_column_id
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Views, procedures, functions, triggers (with bodies from sys.sql_modules)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All programmable modules: views (V), stored procedures (P), scalar
 * functions (FN), inline table-valued functions (IF), multi-statement
 * table-valued functions (TF), and triggers (TR).
 * Body (definition) is joined from sys.sql_modules.
 * type: 'V'=view, 'P'=procedure, 'FN'=scalar function,
 *       'IF'=inline TVF, 'TF'=multi-statement TVF, 'TR'=trigger.
 */
export const SQL_MSSQL_MODULES = `
SELECT
  s.name                          AS schema_name,
  o.name                          AS object_name,
  o.type                          AS object_type,
  o.object_id                     AS object_id,
  sm.definition                   AS definition
FROM sys.objects o
JOIN sys.schemas s  ON s.schema_id = o.schema_id
LEFT JOIN sys.sql_modules sm ON sm.object_id = o.object_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR')
ORDER BY s.name, o.name
`.trim();

/**
 * Trigger event and timing metadata.
 * is_instead_of_trigger: 1 = INSTEAD OF, 0 = AFTER.
 * type_desc on sys.trigger_events: 'INSERT' | 'UPDATE' | 'DELETE'.
 */
export const SQL_MSSQL_TRIGGER_EVENTS = `
SELECT
  tr.object_id                    AS trigger_id,
  tr.name                         AS trigger_name,
  tr.parent_id                    AS parent_object_id,
  tr.is_instead_of_trigger        AS is_instead_of_trigger,
  te.type_desc                    AS event_type
FROM sys.triggers tr
JOIN sys.trigger_events te ON te.object_id = tr.object_id
WHERE tr.is_ms_shipped = 0
ORDER BY tr.name, te.type_desc
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Routine parameters (DOG-2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Routine (procedure / function) call parameters from sys.parameters.
 * One row per parameter — a SEPARATE family joined to modules by object_id in map.ts
 * (mirrors SQL_MSSQL_TRIGGER_EVENTS). DOG-2 §4.1.
 *
 * - is_output: 1 → 'out', 0 → 'in'. sys.parameters has NO explicit INOUT concept, so the
 *   map NEVER emits 'inout' — honest to the catalog's expressiveness.
 * - data_type = sys.types.name, the BARE type name (int / nvarchar / decimal — NOT
 *   decimal(12,2)), composed IDENTICALLY to the mssql COLUMN dataType (queries.ts:53).
 * - has_default_value (bit) → hasDefault.
 * - parameter_id = 0 (scalar-function return value, empty name) is EXCLUDED here (WHERE
 *   p.parameter_id > 0) — it is not a call parameter (the return is captured by `returns`).
 *
 * FOR JSON safety (§4.1 F-1..F-7): single top-level SELECT + top-level ORDER BY → the
 * dump-emitter appends `FOR JSON PATH, INCLUDE_NULL_VALUES` unchanged. No subquery wrap,
 * no nested FOR JSON, all columns nvarchar/int/bit (no sql_variant) → no coercion issue.
 * Read-only catalog SELECT (US-031 write-verb scanner stays green).
 */
export const SQL_MSSQL_PARAMETERS = `
SELECT
  s.name                          AS schema_name,
  o.name                          AS object_name,
  o.object_id                     AS object_id,
  p.parameter_id                  AS parameter_id,
  p.name                          AS parameter_name,
  tp.name                         AS data_type,
  p.is_output                     AS is_output,
  p.has_default_value             AS has_default_value
FROM sys.parameters p
JOIN sys.objects o ON o.object_id = p.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types tp  ON tp.user_type_id = p.user_type_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('P', 'FN', 'IF', 'TF')
  AND p.parameter_id > 0
ORDER BY s.name, o.name, p.parameter_id
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Sequences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-defined sequences.
 * Captures type, start, increment, min/max, and cycle flag in extra.
 */
export const SQL_MSSQL_SEQUENCES = `
SELECT
  s.name                          AS schema_name,
  seq.name                        AS sequence_name,
  tp.name                         AS data_type,
  seq.start_value                 AS start_value,
  seq.increment                   AS increment,
  seq.minimum_value               AS minimum_value,
  seq.maximum_value               AS maximum_value,
  seq.is_cycling                  AS is_cycling
FROM sys.sequences seq
JOIN sys.schemas s  ON s.schema_id   = seq.schema_id
JOIN sys.types tp   ON tp.user_type_id = seq.user_type_id
WHERE seq.is_ms_shipped = 0
ORDER BY s.name, seq.name
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Extended properties (MS_Description comments)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MS_Description extended properties for objects and columns.
 * class 1 = object; minor_id 0 = object itself, > 0 = column.
 * Joins sys.objects and sys.schemas to resolve names.
 */
export const SQL_MSSQL_EXTENDED_PROPERTIES = `
SELECT
  s.name                          AS schema_name,
  o.name                          AS object_name,
  ep.minor_id                     AS column_id,
  c.name                          AS column_name,
  CAST(ep.value AS NVARCHAR(MAX)) AS description
FROM sys.extended_properties ep
JOIN sys.objects o   ON o.object_id = ep.major_id
JOIN sys.schemas s   ON s.schema_id = o.schema_id
LEFT JOIN sys.columns c
  ON c.object_id = ep.major_id AND c.column_id = ep.minor_id
WHERE ep.class = 1
  AND ep.name = 'MS_Description'
  AND o.is_ms_shipped = 0
ORDER BY s.name, o.name, ep.minor_id
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// SQL expression dependencies (for the body tokenizer / dependency hints)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Object-to-object dependencies from sys.sql_expression_dependencies.
 * referencing_id: the module (proc/func/view/trigger) that contains the ref.
 * referenced_schema_name / referenced_entity_name: the target.
 * referenced_id may be NULL for unresolved cross-database refs.
 * ref_object_type: sys.objects.type (CHAR(2)) of the REFERENCED object, via a
 *   LEFT JOIN on referenced_id — NULL for a NULL referenced_id (cross-db / unresolved).
 *   DOG-1 (D2): a routine referenced_id (`P`/`FN`/`IF`/`TF`) drives a `calls` edge; the
 *   LEFT JOIN keeps NULL-referenced_id rows, already skipped by the null-name guard.
 * Feeds the body tokenizer in map.ts (US-007, ADR-007).
 */
export const SQL_MSSQL_DEPENDENCIES = `
SELECT
  s.name                          AS schema_name,
  o.name                          AS object_name,
  o.type                          AS object_type,
  dep.referenced_schema_name      AS ref_schema_name,
  dep.referenced_entity_name      AS ref_object_name,
  dep.referenced_id               AS ref_object_id,
  ref.type                        AS ref_object_type
FROM sys.sql_expression_dependencies dep
JOIN sys.objects o   ON o.object_id = dep.referencing_id
JOIN sys.schemas s   ON s.schema_id = o.schema_id
LEFT JOIN sys.objects ref ON ref.object_id = dep.referenced_id
WHERE dep.referenced_class = 1
  AND o.is_ms_shipped = 0
ORDER BY s.name, o.name, dep.referenced_schema_name, dep.referenced_entity_name
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// View consumed-column set (DOG-3 D8) — NATIVE driver path only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-view source-column lineage via the `sys.dm_sql_referenced_entities` table-valued
 * function (DOG-3 design D8; live finding 2026-07-07). `sys.sql_expression_dependencies`
 * (SQL_MSSQL_DEPENDENCIES) reports whole-object grain only — its `referenced_minor_id` is 0
 * for NON-schemabound views (the common case), so it is INERT for column lineage. The
 * per-object TVF is the TRUTH source: called ONCE per view (@view), it returns one row per
 * referenced entity, with `referenced_minor_id > 0` / `referenced_minor_name` naming a
 * specific SOURCE COLUMN the view consumes.
 *
 * `@view` is a bound T-SQL variable (see buildViewReferencedColumnsQuery) — NEVER string
 * interpolation into the SQL body. The `referenced_minor_id > 0` filter keeps ONLY
 * column-level references: a whole-object `SELECT *` reference (minor_id = 0) yields NO row,
 * so it contributes NO column (degrade-by-absence, D4). Catalog SELECT only (US-031 write-verb
 * scanner). ADR-008: explicit ORDER BY for a stable per-view row order.
 *
 * NATIVE-driver only: the sqlcmd/manual-dump strategies carry NO view-columns family (the
 * fixed single-SELECT-per-family dump contract, DOG-2), so mssql-via-sqlcmd/dump yields OBJECT
 * grain — the project's FIRST strategy-dependent coverage difference (design D8).
 */
export const SQL_MSSQL_VIEW_REFERENCED_COLUMNS = `
SELECT
  ref.referenced_schema_name      AS referenced_schema,
  ref.referenced_entity_name      AS referenced_entity,
  ref.referenced_minor_name       AS referenced_column
FROM sys.dm_sql_referenced_entities(@view, @class) AS ref
WHERE ref.referenced_minor_id > 0
  AND ref.referenced_entity_name IS NOT NULL
  AND ref.referenced_minor_name IS NOT NULL
ORDER BY ref.referenced_schema_name, ref.referenced_entity_name, ref.referenced_minor_name
`.trim();

// Single-quote character built via fromCharCode so this source file carries NO literal single
// quote in the DOG-3 view-column additions — the US-031 write-verb scanner's naive quote pairing
// stays balanced (a stray unbalanced quote could bracket SQL text with a downstream identifier
// and false-positive on a word boundary).
const TSQL_QUOTE = String.fromCharCode(0x27);

/**
 * Binds the escaped view qname to the `@view` T-SQL variable (and the entity class to `@class`)
 * and prepends both to the TVF query. The qname is escaped for the string literal (single quotes
 * doubled) — object names come from sys.objects (not user input), escaping is defensive-in-depth.
 * NVARCHAR(520) accommodates schema.name (each up to 128 → up to 257 chars, plus headroom).
 * `@view`/`@class` are genuine bound T-SQL variables — no identifier is interpolated into the
 * executable SQL body.
 *
 * Used ONLY on the native driver path (MssqlSchemaAdapter.extract), once per view, EACH call
 * individually try/caught so an unbindable view is skipped (D8).
 */
export function buildViewReferencedColumnsQuery(viewQName: string): string {
  const escaped = viewQName.split(TSQL_QUOTE).join(TSQL_QUOTE + TSQL_QUOTE);
  return (
    `DECLARE @view NVARCHAR(520) = N${TSQL_QUOTE}${escaped}${TSQL_QUOTE};\n` +
    `DECLARE @class NVARCHAR(20) = N${TSQL_QUOTE}OBJECT${TSQL_QUOTE};\n` +
    SQL_MSSQL_VIEW_REFERENCED_COLUMNS
  );
}

/**
 * Fingerprint query: one cheap aggregate over sys.objects.
 * Returns {m: MAX(modify_date), c: COUNT(*)} for non-shipped objects.
 * sha256(`${m}|${c}`) in the adapter class (US-009).
 */
export const SQL_MSSQL_FINGERPRINT = `
SELECT
  MAX(modify_date) AS m,
  COUNT(*)         AS c
FROM sys.objects
WHERE is_ms_shipped = 0
`.trim();
