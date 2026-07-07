/**
 * neighbor-index — change graph-viz, task 1.3. Pure in-memory neighbor-group builder.
 *
 * Builds a `NeighborGroups` per node from the FULL bulk node/edge arrays — with NO
 * per-node store lookup — grouping neighbors by edge kind + direction and sorting each
 * group by (qname, id) EXACTLY as `src/core/query/neighbors.ts#getNeighbors` does. Feeding
 * the identical structure to `formatObject` guarantees the viz node-detail text is
 * byte-identical to `dbgraph object <qname>` (same-source-same-truth; the "no second
 * renderer" contract, finished by the task 1.5 parity test).
 *
 * The index is built from the FULL edge set, so a collapsed table's groups still list its
 * COLUMN members and its detail panel keeps the columns section.
 *
 * ADR-004: pure — core types only, no I/O. ADR-008: order-independent + deterministic.
 */

import type { GraphNode } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';
import type { NeighborGroups } from '../ports/graph-store.js';

interface MutableEntry {
  node: GraphNode;
  edge: GraphEdge;
}

interface MutableGroup {
  out: MutableEntry[];
  in: MutableEntry[];
}

/**
 * Sort comparator matching getNeighbors: by neighbor qname then neighbor id (both
 * localeCompare). getNeighbors applies this as a STABLE sort over the store's
 * `getEdgesFrom`/`getEdgesTo` order (`ORDER BY kind, dst_id|src_id, id`), so when two
 * edges connect the SAME neighbor node the surviving tiebreak is the edge id. Encoding
 * that edge-id tertiary here makes the index INPUT-ORDER-INDEPENDENT while reproducing
 * getNeighbors byte-for-byte (formatObject parity does not drift).
 */
function neighborCompare(a: MutableEntry, b: MutableEntry): number {
  const cmp = a.node.qname.localeCompare(b.node.qname);
  if (cmp !== 0) return cmp;
  const idCmp = a.node.id.localeCompare(b.node.id);
  if (idCmp !== 0) return idCmp;
  return a.edge.id.localeCompare(b.edge.id);
}

/**
 * Builds `nodeId → NeighborGroups` for every node touched by at least one edge.
 *
 * - Outbound edge (src = nodeId): neighbor is the edge's `dst`, filed under `.out`.
 * - Inbound edge  (dst = nodeId): neighbor is the edge's `src`, filed under `.in`.
 * - Entries whose neighbor node is absent from `nodes` are skipped (mirrors getNeighbors,
 *   which drops a null getNode result).
 */
export function buildNeighborIndex(
  edges: readonly GraphEdge[],
  nodes: readonly GraphNode[],
): ReadonlyMap<string, NeighborGroups> {
  const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const index = new Map<string, Record<string, MutableGroup>>();

  function ensureGroup(nodeId: string, kind: string): MutableGroup {
    let groups = index.get(nodeId);
    if (groups === undefined) {
      groups = {};
      index.set(nodeId, groups);
    }
    let group = groups[kind];
    if (group === undefined) {
      group = { out: [], in: [] };
      groups[kind] = group;
    }
    return group;
  }

  for (const edge of edges) {
    const srcNode = nodeById.get(edge.src);
    const dstNode = nodeById.get(edge.dst);

    // Outbound from src: neighbor = dst.
    if (srcNode !== undefined && dstNode !== undefined) {
      ensureGroup(edge.src, edge.kind).out.push({ node: dstNode, edge });
    }
    // Inbound to dst: neighbor = src.
    if (dstNode !== undefined && srcNode !== undefined) {
      ensureGroup(edge.dst, edge.kind).in.push({ node: srcNode, edge });
    }
  }

  // Deterministic order within each group (ADR-008), matching getNeighbors.
  for (const groups of index.values()) {
    for (const group of Object.values(groups)) {
      group.out.sort(neighborCompare);
      group.in.sort(neighborCompare);
    }
  }

  return index as ReadonlyMap<string, NeighborGroups>;
}
