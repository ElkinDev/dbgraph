/**
 * query command handler — task 5.3 (phase-4-cli-config).
 * Spec: cli-config "query is backed by core search with a stable JSON contract"
 * Design: search(store, {term}) → formatQueryText | formatQueryJson.
 *   Zero results → outcome.type = 'negative' (exit code 1 via exitCodeFor, US-020).
 *   --json → deterministic JSON output (ADR-008).
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + node builtins.
 * No adapter imports, no process.exit (cli.ts owns that).
 */

import type { GraphStore } from '../../index.js';
import { search } from '../../index.js';
import {
  formatQueryText,
  formatQueryJson,
  type QueryResultView,
} from '../format/query.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryOptions {
  readonly store: GraphStore;
  /** Search term. */
  readonly term: string;
  /** When true, emit stable JSON output instead of text. */
  readonly json: boolean;
}

export interface QueryOutcome {
  /** 'success' → exit 0; 'negative' → exit 1 (US-020 zero-hit contract). */
  readonly type: 'success' | 'negative';
  /** Formatted output string to write to stdout. */
  readonly output: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// runQuery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a search against the store and formats the results.
 * Returns QueryOutcome — caller (cli.ts / dispatch handler) writes output and maps exit code.
 *
 * Zero hits → outcome.type = 'negative' (maps to exit 1 via exitCodeFor, US-020).
 * --json → deterministic JSON (ADR-008).
 */
export async function runQuery(options: QueryOptions): Promise<QueryOutcome> {
  const { store, term, json } = options;

  const result = await search(store, { term });

  const view: QueryResultView = {
    term,
    hits: result.hits,
    total: result.total,
  };

  const output = json ? formatQueryJson(view) : formatQueryText(view);

  // US-020: zero results signal exit 1
  if (result.hits.length === 0) {
    return { type: 'negative', output };
  }

  return { type: 'success', output };
}
