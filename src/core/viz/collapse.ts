/**
 * collapse — change graph-viz, task 1.1. Pure column/heavy-kind collapse for viz.
 *
 * OPEN-Q1 (RESOLVED, conservative):
 *   - DEFAULT   → structural nodes only; columns AND other heavy kinds (constraint,
 *                 index, trigger, field) are folded into their parent table/view;
 *                 containment edges become self-loops and drop; cross-object edges
 *                 (references / depends_on / calls / …) are rewired to the parents.
 *   - --columns → structural + column/field nodes (still folds constraint/index/trigger).
 *   - --full    → pass-through: every kind incl. columns is kept.
 *   Pre-filters: --schema (scope one schema), --kinds (explicit allowlist overriding the
 *   tier keep-set), --min-degree (drop nodes below the incident-edge threshold).
 *
 * ADR-004: pure — imports only core model types, no I/O. ADR-008: ORDER-INDEPENDENT —
 * inputs are canonicalized before processing so the output is identical for any input
 * order (a deterministic prerequisite for the golden data block).
 */

import type { GraphNode, NodeKind } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';
import type { VizOptions } from './types.js';

export type { VizOptions } from './types.js';

/** Kinds that remain as top-level graph nodes in the default collapsed view. */
const STRUCTURAL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'database',
  'schema',
  'table',
  'view',
  'procedure',
  'function',
  'sequence',
  'collection',
]);

/** Column-grain kinds included by `--columns` (and `--full`), folded by default. */
const COLUMN_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(['column', 'field']);

/** Result of a collapse pass — a shaped node/edge subgraph (still GraphNode/GraphEdge). */
export interface CollapsedGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** Code-point string comparator (NOT locale-sensitive) — machine-independent order. */
function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Determines which node kinds survive as top-level nodes for the given options. */
function resolveKeepKinds(opts: VizOptions): ReadonlySet<NodeKind> {
  if (opts.kinds !== undefined) {
    return new Set<NodeKind>(opts.kinds);
  }
  if (opts.full) {
    // Every kind is kept — build from the structural + column sets plus the heavy kinds.
    return new Set<NodeKind>([
      ...STRUCTURAL_KINDS,
      ...COLUMN_KINDS,
      'constraint',
      'index',
      'trigger',
    ]);
  }
  const keep = new Set<NodeKind>(STRUCTURAL_KINDS);
  if (opts.columns === true) {
    for (const k of COLUMN_KINDS) keep.add(k);
  }
  return keep;
}

/**
 * Builds the child→parent structural map from containment edges, so a folded node
 * (column/constraint/index/trigger/field) resolves to the table/view it belongs to.
 */
function buildParentMap(edges: readonly GraphEdge[]): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    switch (e.kind) {
      case 'has_column':
      case 'has_constraint':
      case 'has_index':
        // src = table/view/collection, dst = child object
        if (!parentOf.has(e.dst)) parentOf.set(e.dst, e.src);
        break;
      case 'fires_on':
        // src = trigger, dst = table it fires on
        if (!parentOf.has(e.src)) parentOf.set(e.src, e.dst);
        break;
      default:
        break;
    }
  }
  return parentOf;
}

/**
 * Walks parentOf from `id` until a node whose kind is kept is reached.
 * Returns the kept ancestor id, or null if none exists (cycle-guarded).
 */
function resolveKept(
  id: string,
  keepKinds: ReadonlySet<NodeKind>,
  nodeById: ReadonlyMap<string, GraphNode>,
  parentOf: ReadonlyMap<string, string>,
): string | null {
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur !== undefined) {
    const node = nodeById.get(cur);
    if (node === undefined) return null;
    if (keepKinds.has(node.kind)) return cur;
    if (seen.has(cur)) return null;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return null;
}

/** Removes nodes below `minDegree` incident edges, iterating to a fixed point. */
function applyMinDegree(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  minDegree: number,
): CollapsedGraph {
  let keptNodes = [...nodes];
  let keptEdges = [...edges];
  for (;;) {
    const degree = new Map<string, number>();
    for (const n of keptNodes) degree.set(n.id, 0);
    for (const e of keptEdges) {
      degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
      degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
    }
    const survivors = keptNodes.filter((n) => (degree.get(n.id) ?? 0) >= minDegree);
    if (survivors.length === keptNodes.length) break;
    const survivorIds = new Set(survivors.map((n) => n.id));
    keptNodes = survivors;
    keptEdges = keptEdges.filter((e) => survivorIds.has(e.src) && survivorIds.has(e.dst));
  }
  return { nodes: keptNodes, edges: keptEdges };
}

/**
 * Collapses the graph to a viz-ready subgraph per the given options.
 * Pure and order-independent (ADR-004 / ADR-008).
 */
export function collapse(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: VizOptions,
): CollapsedGraph {
  const keepKinds = resolveKeepKinds(opts);
  const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const parentOf = buildParentMap(edges);

  // ── Kept node set (kind + optional schema filter) ──────────────────────────
  let keptNodes = nodes.filter((n) => keepKinds.has(n.kind));
  if (opts.schema !== undefined) {
    keptNodes = keptNodes.filter((n) => n.schema === opts.schema);
  }
  const keptIds = new Set(keptNodes.map((n) => n.id));

  // ── Rewire + dedupe edges (canonical input order → deterministic first-seen) ─
  const sortedEdges = [...edges].sort((a, b) => codePointCompare(a.id, b.id));
  const resultEdges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of sortedEdges) {
    const rs = resolveKept(e.src, keepKinds, nodeById, parentOf);
    const rt = resolveKept(e.dst, keepKinds, nodeById, parentOf);
    if (rs === null || rt === null) continue;
    if (!keptIds.has(rs) || !keptIds.has(rt)) continue;
    if (rs === rt) continue; // containment / intra-object edge folded away
    const key = `${e.kind}|${rs}|${rt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resultEdges.push(rs === e.src && rt === e.dst ? e : { ...e, src: rs, dst: rt });
  }

  let result: CollapsedGraph = { nodes: keptNodes, edges: resultEdges };

  // ── Min-degree pruning (fixed point) ───────────────────────────────────────
  if (opts.minDegree !== undefined && opts.minDegree > 0) {
    result = applyMinDegree(result.nodes, result.edges, opts.minDegree);
  }

  // ── Canonical output order (ADR-008) ───────────────────────────────────────
  const outNodes = [...result.nodes].sort((a, b) => {
    const c = codePointCompare(a.qname, b.qname);
    return c !== 0 ? c : codePointCompare(a.id, b.id);
  });
  const outEdges = [...result.edges].sort((a, b) => {
    const ck = codePointCompare(a.kind as string, b.kind as string);
    if (ck !== 0) return ck;
    const cs = codePointCompare(a.src, b.src);
    if (cs !== 0) return cs;
    const cd = codePointCompare(a.dst, b.dst);
    if (cd !== 0) return cd;
    return codePointCompare(a.id, b.id);
  });

  return { nodes: outNodes, edges: outEdges };
}
