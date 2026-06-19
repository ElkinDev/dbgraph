/**
 * exhaustion.ts — thin SHIM delegating to core `formatOutcome`.
 *
 * Task 3.7 (resilient-connectivity Batch 3).
 * Design §"the legacy `cli/format/exhaustion.ts` becomes a thin shim" —
 *   this function builds a `ConnectivityOutcome` from the `StrategyExhaustionError.attempts`
 *   and delegates to the PURE core `formatOutcome`. It no longer hand-rolls option text.
 *
 * ADR-004: CLI layer imports ONLY from the public barrel (src/index.ts) and cli siblings.
 * The mssql catalog query strings are duplicated inline to avoid importing from src/adapters/**
 * (the boundary scanner enforces this — "Duplicate any needed constants inline").
 *
 * PURE function: no I/O, no process access. The caller (cli.ts or dispatch.ts)
 * decides where to write the output.
 *
 * Spec cli-config "Exhausted strategies present manual-dump and guided-install options".
 * connectivity-strategies Batch E, task E5.3 (legacy entry point kept for back-compat).
 * resilient-connectivity Batch 3, task 3.7.
 */

import type { StrategyExhaustionError } from '../../index.js';
import { formatOutcome, type ConnectivityOutcome, type ConnectivityOption } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants (inline copies — ADR-004: CLI must not import from src/adapters/**)
// ─────────────────────────────────────────────────────────────────────────────

const OFFICIAL_SQLCMD_URL = 'https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility';
const DUMP_OUTPUT_PATH = '.dbgraph/dumps/mssql-dump.json';

/**
 * The read-only mssql catalog SELECT strings surfaced in the run-it-yourself option.
 * These mirror the constants in src/adapters/engines/mssql/queries.ts — duplicated
 * inline here to comply with ADR-004 (CLI layer must not import from adapters/**).
 * Keep in sync with the adapter's queries.ts if catalog queries change.
 */
const MSSQL_CATALOG_QUERIES: readonly string[] = [
  // Tables
  `SELECT s.name AS schema_name, t.name AS table_name, t.object_id AS object_id FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name`,
  // Columns
  `SELECT s.name AS schema_name, t.name AS table_name, c.column_id, c.name AS column_name, tp.name AS data_type, c.is_nullable FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.columns c ON c.object_id = t.object_id JOIN sys.types tp ON tp.user_type_id = c.user_type_id WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name, c.column_id`,
  // Key constraints
  `SELECT s.name AS schema_name, t.name AS table_name, kc.name AS constraint_name, kc.type AS constraint_type, c.name AS column_name FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.name = kc.name JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id WHERE t.is_ms_shipped = 0 AND ic.is_included_column = 0 ORDER BY s.name, t.name, kc.name`,
];

// ─────────────────────────────────────────────────────────────────────────────
// formatExhaustionError — SHIM: delegates to core formatOutcome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a StrategyExhaustionError into a multi-line, user-facing actionable
 * message by building a ConnectivityOutcome and delegating to the core `formatOutcome`.
 *
 * The ≥3 options rendered are: run-it-yourself (mssql catalog SELECTs),
 * consented-install (sqlcmd + official MS URL), manual-dump (.dbgraph/dumps/mssql-dump.json).
 *
 * @param err - The StrategyExhaustionError thrown when all strategies are exhausted.
 * @returns A formatted string ready to be written to stderr or stdout.
 */
export function formatExhaustionError(err: StrategyExhaustionError): string {
  const summary =
    err.attempts.length === 0
      ? 'All mssql connectivity strategies were exhausted. No database connection could be established.'
      : `All mssql connectivity strategies exhausted. ${err.attempts.map((a) => `${a.id} — ${a.reason}`).join('; ')}`;

  const options: ConnectivityOption[] = [
    {
      kind: 'run-it-yourself',
      description: 'Run these read-only catalog SELECT statements in your own client.',
      queries: MSSQL_CATALOG_QUERIES,
    },
    {
      kind: 'consented-install',
      description: 'Install sqlcmd from the official Microsoft source. No install is performed automatically.',
      tool: 'sqlcmd',
      docUrl: OFFICIAL_SQLCMD_URL,
    },
    {
      kind: 'manual-dump',
      description: `Place a combined JSON dump at: ${DUMP_OUTPUT_PATH}`,
      outputPath: DUMP_OUTPUT_PATH,
    },
  ];

  const outcome: ConnectivityOutcome = {
    engine: 'mssql',
    summary,
    attempts: err.attempts,
    options,
  };

  return formatOutcome(outcome);
}
