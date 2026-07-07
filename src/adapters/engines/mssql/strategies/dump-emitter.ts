/**
 * dump-emitter.ts — Compose a runnable .sql dump script from queries.ts constants.
 *
 * The emitter produces a single deterministic SQL script consisting of the 11
 * catalog catalog constants from queries.ts, each wrapped in FOR JSON PATH and
 * labeled with the corresponding MssqlRowInput key name. The operator runs this
 * script against a SQL Server instance (e.g. via `sqlcmd -E -S <server> -d <db>
 * -i dump.sql -o dump-output.json`) and saves the combined output as ONE JSON
 * file under .dbgraph/dumps/ (the gitignored directory).
 *
 * The combined JSON output file must match the MssqlRowInput shape:
 *   { "tables": [...], "columns": [...], "keyConstraints": [...], ... }
 *
 * Usage:
 *   The script is designed to be saved once and run against each target DB.
 *   Run via:
 *     sqlcmd -E -S <server> -d <database> -i dbgraph-dump.sql
 *   OR paste into SSMS and run, saving the output as JSON.
 *   The resulting output file goes into .dbgraph/dumps/mssql-dump.json.
 *
 * Security:
 *   - ONLY catalog SELECTs are emitted (no write verbs).
 *   - The output file (.dbgraph/dumps/) is gitignored — it contains sensitive
 *     schema and procedure source (R8).
 *
 * Spec mssql-extraction "Emitted dump script is read-only and output is gitignored".
 * connectivity-strategies Batch D, task D4.1.
 */

import {
  SQL_MSSQL_TABLES,
  SQL_MSSQL_COLUMNS,
  SQL_MSSQL_KEY_CONSTRAINTS,
  SQL_MSSQL_FOREIGN_KEYS,
  SQL_MSSQL_CHECK_CONSTRAINTS,
  SQL_MSSQL_INDEXES,
  SQL_MSSQL_MODULES,
  SQL_MSSQL_TRIGGER_EVENTS,
  SQL_MSSQL_PARAMETERS,
  SQL_MSSQL_SEQUENCES,
  SQL_MSSQL_EXTENDED_PROPERTIES,
  SQL_MSSQL_DEPENDENCIES,
} from '../queries.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — exported for use in ManualDumpStrategy and tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The gitignored directory where the operator places the combined JSON dump file.
 * This directory is covered by the .dbgraph/ entry in .gitignore.
 */
export const DUMP_DIR = '.dbgraph/dumps';

/**
 * The expected filename for the combined JSON dump produced by running the
 * emitted script and saving the output.
 */
export const DUMP_FILE = 'mssql-dump.json';

/**
 * The ordered list of MssqlRowInput family keys — one entry per catalog query.
 * This order is fixed and matches the MssqlRowInput interface in map.ts.
 */
export const CATALOG_FAMILY_KEYS: readonly string[] = [
  'tables',
  'columns',
  'keyConstraints',
  'foreignKeys',
  'checkConstraints',
  'indexes',
  'modules',
  'triggerEvents',
  'parameters',
  'sequences',
  'extendedProperties',
  'dependencies',
];

// ─────────────────────────────────────────────────────────────────────────────
// Internal: family definitions (key → query constant)
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG_FAMILIES: ReadonlyArray<{ key: string; sql: string }> = [
  { key: 'tables',             sql: SQL_MSSQL_TABLES },
  { key: 'columns',            sql: SQL_MSSQL_COLUMNS },
  { key: 'keyConstraints',     sql: SQL_MSSQL_KEY_CONSTRAINTS },
  { key: 'foreignKeys',        sql: SQL_MSSQL_FOREIGN_KEYS },
  { key: 'checkConstraints',   sql: SQL_MSSQL_CHECK_CONSTRAINTS },
  { key: 'indexes',            sql: SQL_MSSQL_INDEXES },
  { key: 'modules',            sql: SQL_MSSQL_MODULES },
  { key: 'triggerEvents',      sql: SQL_MSSQL_TRIGGER_EVENTS },
  { key: 'parameters',         sql: SQL_MSSQL_PARAMETERS },
  { key: 'sequences',          sql: SQL_MSSQL_SEQUENCES },
  { key: 'extendedProperties', sql: SQL_MSSQL_EXTENDED_PROPERTIES },
  { key: 'dependencies',       sql: SQL_MSSQL_DEPENDENCIES },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emits a labeled SQL block for one catalog family.
 *
 * FOR JSON PATH, INCLUDE_NULL_VALUES is appended DIRECTLY to the top-level
 * query (each queries.ts constant already ends with a top-level ORDER BY).
 * Top-level ORDER BY + FOR JSON PATH at the same level is valid SQL Server.
 *
 * The subquery-wrap pattern (SELECT * FROM (...) AS _rows FOR JSON PATH) is
 * intentionally NOT used because ORDER BY inside a derived table is illegal in
 * SQL Server (Msg 1033) unless TOP or OFFSET-FETCH is present.
 */
function wrapFamily(key: string, sql: string): string {
  return [
    `-- ── family: ${key} ───────────────────────────────────────────────────────`,
    sql,
    `FOR JSON PATH, INCLUDE_NULL_VALUES;`,
    `-- ── end: ${key} ─────────────────────────────────────────────────────────`,
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// emitDumpScript
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composes and returns a single deterministic runnable SQL script that extracts
 * all 12 catalog families from a SQL Server instance.
 *
 * The operator runs this script (e.g. via sqlcmd -E or SSMS) against the target
 * database and saves the output as ${DUMP_DIR}/${DUMP_FILE} (a combined JSON
 * object with one key per family). The ManualDumpStrategy then reads that file.
 *
 * The script contains ONLY catalog SELECTs — no write verb of any kind.
 * Output is deterministic (no dynamic SQL, no timestamps, no random values).
 *
 * @returns The .sql script as a UTF-8 string.
 */
export function emitDumpScript(): string {
  const parts: string[] = [];

  // ── Header comment ────────────────────────────────────────────────────────
  parts.push([
    '-- dbgraph MSSQL catalog dump script',
    '-- Generated by: dbgraph dump-emitter',
    '--',
    '-- HOW TO RUN:',
    '--   Option 1 — sqlcmd with Windows Integrated Security (-E):',
    '--     sqlcmd -E -S <server> -d <database> -i dbgraph-dump.sql -y 0 -h -1 -W',
    '--   Option 2 — SSMS: open this file, connect, run, save output as JSON.',
    '--',
    '-- OUTPUT:',
    `--   Save the combined JSON output to: ${DUMP_DIR}/${DUMP_FILE}`,
    '--   The file must be a JSON object with one key per family:',
    '--     { "tables": [...], "columns": [...], "keyConstraints": [...], ... }',
    '--',
    '-- SECURITY:',
    `--   The output file (${DUMP_DIR}/) is gitignored — it contains sensitive`,
    '--   schema and stored procedure source. DO NOT commit it.',
    '--',
    '-- CATALOG FAMILIES (12 total):',
    ...CATALOG_FAMILIES.map(({ key }) => `--   ${key}`),
    '',
  ].join('\n'));

  // ── One block per family ──────────────────────────────────────────────────
  for (const { key, sql } of CATALOG_FAMILIES) {
    parts.push(wrapFamily(key, sql));
  }

  return parts.join('\n');
}
