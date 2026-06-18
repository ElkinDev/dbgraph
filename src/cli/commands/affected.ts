/**
 * affected command handler — task 4.5 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph affected <script.sql> — thin CLI wrapper over src/core/precheck/ core.
 * Design:
 *   - Reads a .sql file, extracts identifiers, matches to graph, aggregates impact.
 *   - Uses the SAME src/core/precheck/ engine as dbgraph_precheck (MCP) — via barrel.
 *   - --json: stable machine-readable output (PrecheckView as JSON).
 *   - Exit 1 when matched objects affected, exit 0 when none.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + Node builtins.
 *   NEVER imports src/mcp/** (the mcp boundary test enforces this).
 *   NEVER calls process.exit (cli.ts owns exit codes via HandlerOutcome).
 */

import { readFileSync } from 'node:fs';
import {
  runPrecheck,
  formatPrecheck,
  type GraphStore,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface AffectedOptions {
  readonly store: GraphStore;
  /** Absolute or relative path to a .sql file. */
  readonly sqlFile: string;
  /** When true, output is JSON (PrecheckView serialized). Default: false. */
  readonly json?: boolean;
  /** Detail level for text output. Default: 'normal'. */
  readonly detail?: 'brief' | 'normal' | 'full';
}

export interface AffectedOutcome {
  /**
   * 'success' → exit 0 (no affected objects found).
   * 'negative' → exit 1 (affected objects found — CI change-detection gate).
   */
  readonly type: 'success' | 'negative';
  /** Formatted string (text or JSON) to write to stdout. */
  readonly output: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// runAffected
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the SQL file at `options.sqlFile`, runs the precheck engine over it,
 * and returns the formatted output plus the exit-code-determining outcome type.
 *
 * Throws if the SQL file cannot be read.
 * Does NOT call process.exit — the caller (dispatch) maps outcome to exit code.
 */
export async function runAffected(options: AffectedOptions): Promise<AffectedOutcome> {
  const { store, sqlFile, json = false } = options;
  const detail = options.detail ?? 'normal';

  // Read the SQL file (throws ENOENT if not found — callers see a meaningful error)
  const ddl = readFileSync(sqlFile, 'utf-8');

  // Run the shared precheck core (neutral module — not mcp, not cli)
  const view = await runPrecheck(store, ddl);

  // Determine exit code: negative (exit 1) when any objects were matched
  // (meaning the DDL affects real graph nodes)
  const hasImpact = view.matchedObjects.length > 0;
  const outcomeType: 'success' | 'negative' = hasImpact ? 'negative' : 'success';

  let output: string;

  if (json) {
    // Stable JSON output — uses stableStringify for determinism
    output = JSON.stringify(view, null, 2) + '\n';
  } else {
    output = formatPrecheck(view, detail);
  }

  return { type: outcomeType, output };
}
