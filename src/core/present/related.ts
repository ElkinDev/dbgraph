/**
 * formatRelated — task 1.4 (phase-5-mcp-server).
 * Spec: dbgraph_related grouped by edge kind and direction; inferred edges separate group.
 * Design: PURE, core-types-only, reuses ExploreView. Lives in src/core/present/ per ADR-004.
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (ExploreView, RelatedDetail) → byte-identical string.
 *
 * --detail levels:
 *   brief  — grouped edge kinds with in+out counts
 *   normal — brief + qnames per group (sorted)
 *   full   — normal + inferred score for inferred edges
 *
 * Reuses ExploreView (node + neighbors map) — same shape as formatExplore input.
 * Inferred edges (confidence='inferred') appear in a SEPARATE group with score.
 */

import type { GraphNode } from '../model/node.js';
import type { ExploreView } from './explore.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: deduplicate entries by qname at display grain.
// The graph stores one edge per FK column pair PLUS one aggregate table→table edge.
// For display purposes, only unique (qname) entries per direction are shown.
// ─────────────────────────────────────────────────────────────────────────────

function uniqueByQname<T extends { node: GraphNode }>(entries: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
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

/** The detail level for related output. */
export type RelatedDetail = 'brief' | 'normal' | 'full';

// Re-export ExploreView for use as RelatedView (same shape, different semantic name)
export type { ExploreView as RelatedView } from './explore.js';

// ─────────────────────────────────────────────────────────────────────────────
// formatRelated — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats an ExploreView into a related-neighbors string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view, detail) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatRelated(view: ExploreView, detail: RelatedDetail): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`RELATED: ${view.node.qname}  [${view.node.kind}]`);
  lines.push('─'.repeat(Math.min(60, view.node.qname.length + view.node.kind.length + 12)));

  const edgeKinds = Object.keys(view.neighbors).sort();

  if (edgeKinds.length === 0) {
    lines.push('  (no neighbors)');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Separate declared vs inferred edges ───────────────────────────────────
  interface DeclaredEntry { node: GraphNode; direction: 'out' | 'in'; kind: string }
  interface InferredEntry { node: GraphNode; direction: 'out' | 'in'; kind: string; score: number | null }

  const declaredByKind = new Map<string, DeclaredEntry[]>();
  const inferredEntries: InferredEntry[] = [];

  for (const kind of edgeKinds) {
    const group = view.neighbors[kind]!;

    for (const entry of group.out) {
      if (entry.edge.confidence === 'inferred') {
        inferredEntries.push({ node: entry.node, direction: 'out', kind, score: entry.edge.score });
      } else {
        const arr = declaredByKind.get(kind) ?? [];
        arr.push({ node: entry.node, direction: 'out', kind });
        declaredByKind.set(kind, arr);
      }
    }
    for (const entry of group.in) {
      if (entry.edge.confidence === 'inferred') {
        inferredEntries.push({ node: entry.node, direction: 'in', kind, score: entry.edge.score });
      } else {
        const arr = declaredByKind.get(kind) ?? [];
        arr.push({ node: entry.node, direction: 'in', kind });
        declaredByKind.set(kind, arr);
      }
    }
  }

  // ── Declared edges grouped by kind ────────────────────────────────────────
  const declaredKinds = [...declaredByKind.keys()].sort();

  for (const kind of declaredKinds) {
    const entries = declaredByKind.get(kind)!;
    const allOut = entries.filter((e) => e.direction === 'out');
    const allIn = entries.filter((e) => e.direction === 'in');
    // Deduplicate by qname at display grain — multiple per-column FK edges and one
    // aggregate edge all point to the same table; only unique qnames are shown.
    const outEntries = uniqueByQname(allOut);
    const inEntries = uniqueByQname(allIn);

    if (detail === 'brief') {
      const parts: string[] = [];
      if (outEntries.length > 0) parts.push(`${outEntries.length} out`);
      if (inEntries.length > 0) parts.push(`${inEntries.length} in`);
      lines.push(`  ${kind.padEnd(22)} ${parts.join(', ')}`);
    } else {
      // normal + full: show qnames
      lines.push('');
      lines.push(`  ${kind}`);

      if (outEntries.length > 0) {
        lines.push('    out:');
        const sorted = [...outEntries].sort((a, b) => a.node.qname.localeCompare(b.node.qname));
        for (const e of sorted) {
          lines.push(`      → ${e.node.qname}  [${e.node.kind}]`);
        }
      }
      if (inEntries.length > 0) {
        lines.push('    in:');
        const sorted = [...inEntries].sort((a, b) => a.node.qname.localeCompare(b.node.qname));
        for (const e of sorted) {
          lines.push(`      ← ${e.node.qname}  [${e.node.kind}]`);
        }
      }
    }
  }

  // ── Inferred edges — separate group ───────────────────────────────────────
  if (inferredEntries.length > 0) {
    if (detail === 'brief') {
      lines.push(`  ${'inferred'.padEnd(22)} ${inferredEntries.length} total`);
    } else {
      lines.push('');
      lines.push('  inferred  (confidence: inferred)');

      const sorted = [...inferredEntries].sort((a, b) => a.node.qname.localeCompare(b.node.qname));
      for (const e of sorted) {
        const arrow = e.direction === 'out' ? '→' : '←';
        const scoreStr = detail === 'full' && e.score !== null ? `  score=${e.score.toFixed(2)}` : '';
        lines.push(`      ${arrow} ${e.node.qname}  [${e.node.kind}]${scoreStr}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
