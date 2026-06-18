/**
 * formatImpact — task 1.5 (phase-5-mcp-server).
 * Spec: dbgraph_impact read/write blast radius; Depth truncation and dynamic-SQL warn.
 * Design: PURE; ImpactView { node; result: ImpactResult; resolve(id)→qname };
 *   visible chain a→b→c, READ separated from WRITE, depth-truncation warning,
 *   "impact possibly incomplete" when any node has_dynamic_sql.
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (ImpactView, ImpactDetail) → byte-identical string.
 *
 * --detail levels:
 *   brief  — chain summary counts only
 *   normal — full chain (a→b→c), read/write split
 *   full   — normal + node kinds, dynamic-SQL / truncation warnings
 */

import type { GraphNode } from '../model/node.js';
import type { ImpactResult } from '../ports/graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The detail level for impact output. */
export type ImpactDetail = 'brief' | 'normal' | 'full';

/**
 * Input bundle for formatImpact.
 * Assembled by the caller from getImpact().
 * resolve(id) maps node IDs in the chains to their qualified names.
 */
export interface ImpactView {
  readonly node: GraphNode;
  readonly result: ImpactResult;
  readonly resolve: (id: string) => string;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatImpact — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats an ImpactView into a human-readable string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view, detail) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatImpact(view: ImpactView, detail: ImpactDetail): string {
  const lines: string[] = [];
  const { result } = view;

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`IMPACT: ${view.node.qname}  [${view.node.kind}]`);
  lines.push('─'.repeat(Math.min(60, view.node.qname.length + view.node.kind.length + 10)));

  const totalRead = result.readImpact.length;
  const totalWrite = result.writeImpact.length;

  if (detail === 'brief') {
    lines.push(`  READ impact:   ${totalRead} chain${totalRead !== 1 ? 's' : ''}`);
    lines.push(`  WRITE impact:  ${totalWrite} chain${totalWrite !== 1 ? 's' : ''}`);

    if (result.truncated) {
      lines.push('  ⚠  Result truncated at depth limit — full impact may be larger');
    }
    if (result.dynamicSqlWarning) {
      lines.push('  ⚠  Impact possibly incomplete — chain contains dynamic SQL');
    }

    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── READ chains ───────────────────────────────────────────────────────────
  lines.push('');
  lines.push('READ IMPACT');
  if (totalRead === 0) {
    lines.push('  (none)');
  } else {
    for (const chain of result.readImpact) {
      const qnames = chain.nodes.map((id) => view.resolve(id));
      lines.push(`  ${qnames.join(' → ')}`);
    }
  }

  // ── WRITE chains ──────────────────────────────────────────────────────────
  lines.push('');
  lines.push('WRITE IMPACT');
  if (totalWrite === 0) {
    lines.push('  (none)');
  } else {
    for (const chain of result.writeImpact) {
      const qnames = chain.nodes.map((id) => view.resolve(id));
      lines.push(`  ${qnames.join(' → ')}`);
    }
  }

  // ── Warnings (normal + full) ───────────────────────────────────────────────
  if (result.truncated) {
    lines.push('');
    lines.push('  ⚠  Result truncated at depth limit — full impact may be larger');
  }
  if (result.dynamicSqlWarning) {
    lines.push('');
    lines.push('  ⚠  Impact possibly incomplete — chain contains dynamic SQL');
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
