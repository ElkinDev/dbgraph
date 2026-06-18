/**
 * formatExplore — task 5.1 (phase-4-cli-config).
 * Spec: cli-config "explore output comes from a pure formatter shared with the MCP tool"
 * Design: PURE, core-types-only, golden-pinned. Lives in src/core/present/ per orchestrator
 *   override (supersedes design.md Decision 2 which placed it in src/cli/format/).
 *   Reused by CLI (phase-4) AND Phase-5 MCP tool — "same source, same golden" (US-021).
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 *   The existing test/core/boundaries.test.ts enforces this at CI.
 * ADR-008: deterministic output — same (ExploreView, ExploreDetail) → byte-identical string.
 *   No process.env / Date.now() / Math.random() / I/O anywhere in this file.
 *
 * --detail levels:
 *   brief  — qname + kind + 1-line neighbor-kind counts
 *   normal — brief + grouped neighbors (edge kind / direction / qname-sorted)
 *   full   — normal + bodyHash + level + dynamic-SQL warning when payload.hasDynamicSql=true
 */

import type { GraphNode } from '../model/node.js';
import type { NeighborGroups } from '../ports/graph-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: deduplicate neighbor entries by qname at display grain.
// The graph stores one edge per FK column pair PLUS one aggregate table→table edge.
// For display purposes, only unique (qname) entries per direction matter.
// ─────────────────────────────────────────────────────────────────────────────

function uniqueByQname(entries: readonly { node: GraphNode }[]): { node: GraphNode }[] {
  const seen = new Set<string>();
  const result: { node: GraphNode }[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.node.qname)) {
      seen.add(entry.node.qname);
      result.push(entry);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The detail level requested by the caller (--detail flag). */
export type ExploreDetail = 'brief' | 'normal' | 'full';

/**
 * Input bundle for formatExplore.
 * Assembled by the caller from getNeighbors() + GraphNode (both core types).
 * Design intentionally mirrors the future MCP ExploreToolInput.
 */
export interface ExploreView {
  readonly node: GraphNode;
  readonly neighbors: NeighborGroups;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatExplore — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats an ExploreView into a human-readable string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view, detail) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatExplore(view: ExploreView, detail: ExploreDetail): string {
  const lines: string[] = [];

  // ── Header (all levels) ───────────────────────────────────────────────────
  lines.push(`${view.node.qname}  [${view.node.kind}]`);
  lines.push('─'.repeat(Math.min(60, view.node.qname.length + view.node.kind.length + 4)));

  // ── Neighbor summary ──────────────────────────────────────────────────────
  const edgeKinds = Object.keys(view.neighbors).sort();

  if (detail === 'brief') {
    // Brief: one line per edge kind with in+out total counts (deduplicated by qname)
    if (edgeKinds.length === 0) {
      lines.push('  (no neighbors)');
    } else {
      for (const kind of edgeKinds) {
        const group = view.neighbors[kind]!;
        const outCount = uniqueByQname(group.out).length;
        const inCount = uniqueByQname(group.in).length;
        const parts: string[] = [];
        if (outCount > 0) parts.push(`${outCount} out`);
        if (inCount > 0) parts.push(`${inCount} in`);
        lines.push(`  ${kind.padEnd(22)} ${parts.join(', ')}`);
      }
    }
  } else {
    // normal + full: grouped neighbors by edge kind and direction (deduplicated by qname)
    if (edgeKinds.length === 0) {
      lines.push('  (no neighbors)');
    } else {
      for (const kind of edgeKinds) {
        const group = view.neighbors[kind]!;
        const outEntries = uniqueByQname(group.out);
        const inEntries = uniqueByQname(group.in);
        lines.push('');
        lines.push(`  ${kind}`);

        if (outEntries.length > 0) {
          lines.push('    out:');
          for (const entry of outEntries) {
            lines.push(`      → ${entry.node.qname}  [${entry.node.kind}]`);
          }
        }
        if (inEntries.length > 0) {
          lines.push('    in:');
          for (const entry of inEntries) {
            lines.push(`      ← ${entry.node.qname}  [${entry.node.kind}]`);
          }
        }
      }
    }
  }

  // ── Full-only extras ──────────────────────────────────────────────────────
  if (detail === 'full') {
    lines.push('');
    lines.push('  Details');
    lines.push(`  bodyHash  ${view.node.bodyHash !== null ? view.node.bodyHash : '(none)'}`);
    lines.push(`  level     ${view.node.level}`);

    // Dynamic-SQL warning: present when payload carries hasDynamicSql=true
    const payload = view.node.payload as Record<string, unknown>;
    if (payload['hasDynamicSql'] === true) {
      lines.push('  ⚠  hasDynamicSql — impact analysis may be incomplete');
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
