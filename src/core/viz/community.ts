/**
 * community — change graph-viz, task 1.2. Seeded label-propagation community
 * assignment + dominant-prefix naming (Q6, RESOLVED).
 *
 * ASSIGNMENT: each node seeds with its own label (its index in stable node-id order).
 * Per round, in stable id order, every node adopts the MOST FREQUENT label among its
 * undirected neighbors; ties break to the SMALLEST label id. Iterate to convergence
 * (bounded by MAX_ROUNDS). Communities are then re-numbered 0..k-1 by FIRST APPEARANCE
 * over the stable id order.
 *
 * NAMING: prefixKey(node) = node.schema when the graph has >1 distinct schema, else the
 * first `_`-delimited token of node.name (raw, no case folding). A community's name is the
 * prefixKey with the highest member count; ties break to the LEXICOGRAPHICALLY SMALLEST
 * key by CODE-POINT compare (NOT localeCompare). No resolvable prefix → `community-<index>`.
 *
 * ADR-004: pure — core types only, no I/O. ADR-008: byte-deterministic + order-independent.
 */

import type { GraphNode } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';
import type { CommunityInfo } from './types.js';

export type { CommunityInfo } from './types.js';

/** Convergence ceiling — label propagation on a finite graph settles well within this. */
const MAX_ROUNDS = 100;

/** The result of a community assignment pass. */
export interface CommunityAssignment {
  /** node id → community index (0..k-1). */
  readonly communityOf: ReadonlyMap<string, number>;
  /** community metadata, ordered by id (first-appearance order). */
  readonly communities: readonly CommunityInfo[];
}

/** Code-point string comparator (NOT locale-sensitive). */
function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the undirected adjacency (id → neighbor ids) restricted to the given nodes.
 * Self-loops and edges to absent nodes are ignored.
 */
function buildAdjacency(
  nodeIds: ReadonlySet<string>,
  edges: readonly GraphEdge[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (e.src === e.dst) continue;
    if (!nodeIds.has(e.src) || !nodeIds.has(e.dst)) continue;
    adj.get(e.src)!.push(e.dst);
    adj.get(e.dst)!.push(e.src);
  }
  return adj;
}

/**
 * Picks the most frequent neighbor label, breaking ties toward the smallest label id.
 * Returns the node's current label when it has no neighbors.
 */
function dominantLabel(
  neighbors: readonly string[],
  labelOf: ReadonlyMap<string, number>,
  currentLabel: number,
): number {
  if (neighbors.length === 0) return currentLabel;
  const freq = new Map<number, number>();
  for (const nb of neighbors) {
    const l = labelOf.get(nb);
    if (l === undefined) continue;
    freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  if (freq.size === 0) return currentLabel;
  let best = currentLabel;
  let bestCount = -1;
  for (const [label, count] of freq) {
    if (count > bestCount || (count === bestCount && label < best)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Derives each node's prefixKey per Q6:
 *   - multi-schema graph → node.schema (or '' when null)
 *   - single-schema graph → first '_'-delimited token of node.name
 */
function prefixKeyOf(node: GraphNode, multiSchema: boolean): string {
  if (multiSchema) {
    return node.schema ?? '';
  }
  const token = node.name.split('_')[0];
  return token ?? node.name;
}

/**
 * Assigns communities via seeded label propagation and names them by dominant prefix.
 * Pure, deterministic, and order-independent (ADR-008).
 */
export function assignCommunities(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): CommunityAssignment {
  // Stable node-id order is the seed — the ONLY source of determinism.
  const ordered = [...nodes].sort((a, b) => codePointCompare(a.id, b.id));
  const nodeIds = new Set(ordered.map((n) => n.id));
  const adj = buildAdjacency(nodeIds, edges);

  // Seed: each node's label = its index in stable id order.
  const labelOf = new Map<string, number>();
  ordered.forEach((n, i) => labelOf.set(n.id, i));

  // Propagate: adopt the dominant neighbor label until convergence (bounded).
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const n of ordered) {
      const neighbors = adj.get(n.id) ?? [];
      const next = dominantLabel(neighbors, labelOf, labelOf.get(n.id)!);
      if (next !== labelOf.get(n.id)) {
        labelOf.set(n.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Re-number labels 0..k-1 by first appearance over the stable id order.
  const labelToCommunity = new Map<number, number>();
  const communityOf = new Map<string, number>();
  for (const n of ordered) {
    const raw = labelOf.get(n.id)!;
    let c = labelToCommunity.get(raw);
    if (c === undefined) {
      c = labelToCommunity.size;
      labelToCommunity.set(raw, c);
    }
    communityOf.set(n.id, c);
  }

  // ── Naming: dominant prefixKey, code-point tie-break ───────────────────────
  const distinctSchemas = new Set(nodes.map((n) => n.schema).filter((s) => s !== null));
  const multiSchema = distinctSchemas.size > 1;

  const k = labelToCommunity.size;
  const members: GraphNode[][] = Array.from({ length: k }, () => []);
  for (const n of ordered) {
    members[communityOf.get(n.id)!]!.push(n);
  }

  const communities: CommunityInfo[] = members.map((mem, id) => {
    const keyCount = new Map<string, number>();
    for (const n of mem) {
      const key = prefixKeyOf(n, multiSchema);
      if (key === '') continue;
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
    }
    let name = `community-${id}`;
    let bestCount = 0;
    for (const [key, count] of keyCount) {
      if (count > bestCount || (count === bestCount && codePointCompare(key, name) < 0)) {
        name = key;
        bestCount = count;
      }
    }
    return { id, name, count: mem.length };
  });

  return { communityOf, communities };
}
