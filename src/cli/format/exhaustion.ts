/**
 * exhaustion.ts — CLI presenter for StrategyExhaustionError.
 *
 * When every connectivity strategy fails, the CLI surfaces TWO actionable options:
 *
 *   (a) MANUAL-DUMP PATH: run the emitted dump script against your SQL Server
 *       instance (via SSMS or sqlcmd -E) and place the combined JSON output at
 *       .dbgraph/dumps/mssql-dump.json — then re-run dbgraph sync.
 *
 *   (b) GUIDED INSTALL (B1): install the required tool from the official Microsoft
 *       source. Nothing is installed automatically. Instructions are printed behind
 *       an explicit consent notice.
 *
 * Automated installer execution (B2) is DEFERRED to a follow-up change.
 * This is an acknowledged limitation, not a hidden gap.
 *
 * PURE function: no I/O, no process access. The caller (cli.ts or dispatch.ts)
 * decides where to write the output.
 *
 * ADR-004: CLI-only formatter; imports only from the public barrel and cli layer.
 * Spec cli-config "Exhausted strategies present manual-dump and guided-install options".
 * connectivity-strategies Batch E, task E5.3.
 */

import type { StrategyExhaustionError } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OFFICIAL_SQLCMD_URL = 'https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility';

// These match the values exported by dump-emitter.ts — kept in sync here to
// avoid a cross-layer import violation (ADR-004: CLI must not import adapters).
const DUMP_DIR = '.dbgraph/dumps';
const DUMP_FILE = 'mssql-dump.json';
const DUMP_OUTPUT_PATH = `${DUMP_DIR}/${DUMP_FILE}`;

// ─────────────────────────────────────────────────────────────────────────────
// formatExhaustionError
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a StrategyExhaustionError into a multi-line, user-facing actionable
 * message with two clear recovery paths.
 *
 * @param err - The StrategyExhaustionError thrown when all strategies are exhausted.
 * @returns A formatted string ready to be written to stderr or stdout.
 */
export function formatExhaustionError(err: StrategyExhaustionError): string {
  const lines: string[] = [];

  lines.push('dbgraph: All connectivity strategies were exhausted. No database connection could be established.');
  lines.push('');

  // ── Strategy attempt summary ──────────────────────────────────────────────
  if (err.attempts.length > 0) {
    lines.push('Strategies tried (in order):');
    for (const attempt of err.attempts) {
      lines.push(`  - ${attempt.id}: ${attempt.reason}`);
    }
    lines.push('');
  }

  // ── Option (a): Manual-dump path ──────────────────────────────────────────
  lines.push('OPTION A — Manual-dump (offline path, works on air-gapped machines):');
  lines.push('');
  lines.push('  1. Generate the dump script:');
  lines.push('       dbgraph sync --emit-dump-script');
  lines.push('     (or find it at: .dbgraph/dumps/dbgraph-dump.sql after first run)');
  lines.push('');
  lines.push('  2. Run the emitted script against your SQL Server instance:');
  lines.push('       sqlcmd -E -S <server> -d <database> -i dbgraph-dump.sql -y 0 -h -1 -W');
  lines.push('     OR open the script in SSMS and run it, saving the output.');
  lines.push('');
  lines.push(`  3. Place the combined JSON output at: ${DUMP_OUTPUT_PATH}`);
  lines.push('     (this directory is gitignored — it contains sensitive schema source)');
  lines.push('');
  lines.push('  4. Re-run: dbgraph sync');
  lines.push('');

  // ── Option (b): Guided install (B1) ───────────────────────────────────────
  lines.push('OPTION B — Guided install (B1) — install sqlcmd from an official Microsoft source:');
  lines.push('');
  lines.push('  CONSENT NOTICE: dbgraph can guide you to install sqlcmd from an official');
  lines.push('  Microsoft source. Nothing is installed automatically by dbgraph.');
  lines.push('');
  lines.push('  Windows (winget):');
  lines.push('    winget install --id Microsoft.Sqlcmd');
  lines.push('');
  lines.push('  macOS (brew):');
  lines.push('    brew install microsoft/mssql-release/sqlcmd');
  lines.push('');
  lines.push('  Linux / other platforms:');
  lines.push(`    See: ${OFFICIAL_SQLCMD_URL}`);
  lines.push('');
  lines.push('  Official documentation: ' + OFFICIAL_SQLCMD_URL);
  lines.push('');
  lines.push('  After installing sqlcmd, re-run: dbgraph sync');
  lines.push('');

  // ── B2 deferred notice ────────────────────────────────────────────────────
  lines.push('NOTE: Automated installer execution (B2) is DEFERRED to a follow-up change.');
  lines.push('This is an acknowledged limitation. Manual installation via the official');
  lines.push('Microsoft source (winget / brew / docs URL) is the supported path today.');

  return lines.join('\n');
}
