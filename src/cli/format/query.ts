/**
 * Query formatter — task 5.3 (phase-4-cli-config).
 * Spec: cli-config "query is backed by core search with a stable JSON contract"
 * Design: CLI-only PURE formatter for search results. Two output modes:
 *   - Text (default): one line per hit with kind + qname.
 *   - JSON (--json): deterministic, byte-identical JSON (ADR-008).
 *
 * ADR-004: CLI-only — lives under src/cli/format/ (query is NOT the shared explore formatter).
 * ADR-008: deterministic output — same input → always same bytes.
 *   No process.env / Date.now() / adapter imports — pure function.
 */

import type { SearchHit } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// QueryResultView — input shape
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryResultView {
  /** The original search term. */
  readonly term: string;
  /** Hits returned by core search(). */
  readonly hits: readonly SearchHit[];
  /** Total hits count. */
  readonly total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatQueryText — human-readable text output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats query results as human-readable text.
 * One line per hit: "  kind       qname"
 * Ends with a trailing newline.
 */
export function formatQueryText(view: QueryResultView): string {
  const lines: string[] = [];

  if (view.hits.length === 0) {
    lines.push(`No results for "${view.term}".`);
  } else {
    lines.push(`Results for "${view.term}" (${view.total} found):`);
    lines.push('');
    for (const hit of view.hits) {
      lines.push(`  ${hit.kind.padEnd(14)} ${hit.qname}`);
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// formatQueryJson — stable machine-parseable JSON output
// ─────────────────────────────────────────────────────────────────────────────

/** Stable JSON shape for --json output (ADR-008 contract). */
interface QueryJsonOutput {
  readonly term: string;
  readonly total: number;
  readonly hits: readonly {
    readonly kind: string;
    readonly qname: string;
    readonly id: string;
    readonly score: number;
  }[];
}

/**
 * Formats query results as stable, deterministic JSON.
 * Fields are in a FIXED key order (ADR-008: byte-identical on re-run).
 * Ends with a trailing newline.
 */
export function formatQueryJson(view: QueryResultView): string {
  const payload: QueryJsonOutput = {
    term: view.term,
    total: view.total,
    hits: view.hits.map((h) => ({
      kind: h.kind,
      qname: h.qname,
      id: h.id,
      score: h.score,
    })),
  };

  return JSON.stringify(payload, null, 2) + '\n';
}
