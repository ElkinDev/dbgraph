/**
 * formatPath — task 1.6 (phase-5-mcp-server).
 * Spec: dbgraph_path shortest join path or suggests neighbors; No route reports neighbors.
 * Design: PURE; PathView (PathResult + endpoint qnames); shortest route with exact join
 *   columns per hop; inferred-only route marked inferred; no-route message + closest neighbors.
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (PathView) → byte-identical string.
 *
 * Note: formatPath has a single implicit detail level (path has no meaningful brief/full split).
 */

import type { PathResult } from '../ports/graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input bundle for formatPath.
 * Assembled by the caller from findJoinPath() + node qname resolution.
 */
export interface PathView {
  readonly from: string;       // qname of the start endpoint
  readonly to: string;         // qname of the end endpoint
  readonly result: PathResult;
  readonly resolveTable: (id: string) => string;  // node id → qname for tables in hops
}

// ─────────────────────────────────────────────────────────────────────────────
// formatPath — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a PathView into a human-readable string.
 *
 * Output contract (ADR-008):
 *   - Same (view) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatPath(view: PathView): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`PATH: ${view.from}  →  ${view.to}`);
  lines.push('─'.repeat(Math.min(60, view.from.length + view.to.length + 8)));

  if (!view.result.found) {
    // No route found — suggest neighbors
    lines.push('  No join path found between these endpoints.');
    lines.push('');

    const nearest = view.result.nearest;
    if (nearest) {
      if (nearest.from.length > 0) {
        lines.push(`  Neighbors of ${view.from}:`);
        for (const id of nearest.from) {
          lines.push(`    → ${view.resolveTable(id)}`);
        }
      }
      if (nearest.to.length > 0) {
        lines.push('');
        lines.push(`  Neighbors of ${view.to}:`);
        for (const id of nearest.to) {
          lines.push(`    → ${view.resolveTable(id)}`);
        }
      }
    }

    lines.push('');
    return lines.join('\n') + '\n';
  }

  const hops = view.result.hops ?? [];

  if (hops.length === 0) {
    // Same-node trivial case
    lines.push(`  ${view.from}  (same node, no hops)`);
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Route hops ────────────────────────────────────────────────────────────
  if (view.result.inferred) {
    lines.push('  ⚠  Route uses inferred (non-declared) edges');
    lines.push('');
  }

  for (const hop of hops) {
    const fromQname = view.resolveTable(hop.fromTable);
    const toQname = view.resolveTable(hop.toTable);
    lines.push(`  ${fromQname}  →  ${toQname}`);

    if (hop.joinColumns.length > 0) {
      for (const col of hop.joinColumns) {
        lines.push(`      JOIN ON ${fromQname}.${col.from} = ${toQname}.${col.to}`);
      }
    } else {
      lines.push('      (join columns not resolved)');
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
