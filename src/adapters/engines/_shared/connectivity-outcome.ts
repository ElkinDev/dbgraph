/**
 * connectivity-outcome.ts — engine-agnostic ConnectivityOutcome builder.
 *
 * Task 3.1 (resilient-connectivity Batch 3).
 * Design §"ONE `buildConnectivityOutcome` source" — every engine (pg, mysql, mssql)
 *   calls this SINGLE builder so the ≥3-options shape is assembled identically
 *   regardless of which engine is failing. This is what makes the parity suite (3.5)
 *   a PROOF rather than three hand-rolled shapes.
 *
 * The three options in order:
 *   1. run-it-yourself  — the exact catalog SELECTs (write-verb-free, paste-able)
 *   2. consented-install — driver/tool install offer (no silent install)
 *   3. manual-dump      — import a combined JSON dump
 *
 * ADR-004: imports only core types from the public barrel (driver-free).
 * US-041 (engine-agnostic ≥3-options), connectivity-diagnostics spec.
 */

import type {
  ConnectivityOutcome,
  ConnectivityOption,
} from '../../../core/errors.js';
import type { StrategyAttempt } from '../../../core/ports/connectivity-strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// buildConnectivityOutcome — args interface
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildConnectivityOutcomeArgs {
  /** Stable engine identifier (e.g. 'pg', 'mysql', 'mssql'). */
  readonly engine: string;
  /** Content-free summary — MUST NOT contain schema/identifier/secret. */
  readonly summary: string;
  /** Ordered list of strategies attempted and the reason each was skipped. */
  readonly attempts: readonly StrategyAttempt[];
  /**
   * The EXACT read-only catalog SELECT queries for the run-it-yourself option.
   * MUST be write-verb-free (no INSERT/UPDATE/DELETE/MERGE/DDL).
   * Sourced from each engine's queries.ts constants.
   */
  readonly runItYourselfQueries: readonly string[];
  /** Driver or CLI tool name for the consented-install option (e.g. 'pg', 'sqlcmd'). */
  readonly installTool: string;
  /** Official documentation URL for the install option. */
  readonly installDocUrl: string;
  /** The path where the user should place the manual JSON dump. */
  readonly dumpPath: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildConnectivityOutcome — the SINGLE engine-agnostic builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a `ConnectivityOutcome` with exactly three options in the canonical order:
 *   1. run-it-yourself
 *   2. consented-install
 *   3. manual-dump
 *
 * This is the ONLY place the ≥3-options shape is built. Every engine calls this
 * function — pg, mysql, and mssql — ensuring the parity suite (3.5) proves
 * engine-agnostic behaviour by construction.
 *
 * @param args - Engine-agnostic outcome parameters.
 * @returns A fully-assembled ConnectivityOutcome ready to be thrown as
 *          ConnectivityUnavailableError(outcome).
 */
export function buildConnectivityOutcome(
  args: BuildConnectivityOutcomeArgs,
): ConnectivityOutcome {
  const options: ConnectivityOption[] = [
    {
      kind: 'run-it-yourself',
      description:
        'Run these read-only catalog SELECT statements in your own client to extract the schema.',
      queries: args.runItYourselfQueries,
    },
    {
      kind: 'consented-install',
      description:
        `Install the '${args.installTool}' driver or tool from the official source. ` +
        'Nothing is installed automatically — explicit consent required.',
      tool: args.installTool,
      docUrl: args.installDocUrl,
    },
    {
      kind: 'manual-dump',
      description:
        'Import a combined JSON dump you produced externally. ' +
        `Place the file at: ${args.dumpPath}`,
      outputPath: args.dumpPath,
    },
  ];

  return {
    engine: args.engine,
    summary: args.summary,
    attempts: args.attempts,
    options,
  };
}
