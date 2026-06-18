/**
 * formatSearch — task 1.2 (phase-5-mcp-server).
 * Spec: dbgraph_search ranked paginated hits; Pagination.
 * Design: PURE, core-types-only, golden-pinned. Lives in src/core/present/ per ADR-004.
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 *   The existing test/core/boundaries.test.ts enforces this at CI.
 * ADR-008: deterministic output — same (SearchView, SearchDetail) → byte-identical string.
 *   No process.env / Date.now() / Math.random() / I/O anywhere in this file.
 *
 * --detail levels:
 *   brief  — type + qname per hit, pagination footer
 *   normal — brief + match column indicator
 *   full   — normal + match column (body/comment/qname) explicitly labeled
 */

import type { SearchHit } from '../ports/graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The detail level for search results. */
export type SearchDetail = 'brief' | 'normal' | 'full';

/**
 * Input bundle for formatSearch.
 * Assembled by the caller from the search() result.
 */
export interface SearchView {
  readonly hits: readonly SearchHit[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatSearch — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a SearchView into a human-readable string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view, detail) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatSearch(view: SearchView, detail: SearchDetail): string {
  const lines: string[] = [];

  // ── Header (all levels) ───────────────────────────────────────────────────
  lines.push(`SEARCH RESULTS`);
  lines.push('─'.repeat(40));

  // ── Empty case ────────────────────────────────────────────────────────────
  if (view.hits.length === 0) {
    lines.push('  No results found.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Hit lines ─────────────────────────────────────────────────────────────
  for (const hit of view.hits) {
    if (detail === 'brief') {
      lines.push(`  [${hit.kind}]  ${hit.qname}`);
    } else if (detail === 'normal') {
      lines.push(`  [${hit.kind}]  ${hit.qname}`);
    } else {
      // full: include match column
      lines.push(`  [${hit.kind}]  ${hit.qname}  (matched: ${hit.column})`);
    }
  }

  // ── Pagination footer ─────────────────────────────────────────────────────
  lines.push('');
  const hasMore = (view.offset + view.hits.length) < view.total;
  if (hasMore) {
    lines.push(`--- ${view.total} results | offset ${view.offset} | hasMore: true ---`);
  } else {
    lines.push(`--- ${view.total} results (total) | offset ${view.offset} ---`);
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
