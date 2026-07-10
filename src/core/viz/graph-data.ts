/**
 * graph-data — change graph-viz, task 1.4. Builds the deterministic embedded data block.
 *
 * Pipeline (design §Data Flow):
 *   1. buildNeighborIndex over the FULL node/edge arrays (so a collapsed table's detail
 *      still lists its columns).
 *   2. collapse(nodes, edges, opts) → the VISIBLE structural subgraph.
 *   3. assignCommunities over the collapsed subgraph.
 *   4. emit VizNode/VizEdge with STABLE indices (nodes canonically ordered by qname, id;
 *      edges by s, t, kind), per-node detail = formatObject(view, 'full') — the SAME
 *      presenter that backs `dbgraph object` (no second renderer, ADR-004/ADR-008).
 *
 * The output serializes byte-identically across runs (stable key + element order).
 *
 * ADR-004: pure — core types + core presenter only, NO I/O, NO adapters/cli.
 */

import type { GraphNode } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';
import type { NeighborGroups } from '../ports/graph-store.js';
import { formatObject } from '../present/object.js';
import { collapse } from './collapse.js';
import { assignCommunities } from './community.js';
import { buildNeighborIndex } from './neighbor-index.js';
import type { VizOptions, VizNode, VizEdge, VizGraphData, CommunityInfo } from './types.js';

export type {
  VizOptions,
  VizNode,
  VizEdge,
  VizGraphData,
  CommunityInfo,
} from './types.js';

/** Code-point string comparator (NOT locale-sensitive) — machine-independent order. */
function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const EMPTY_GROUPS: NeighborGroups = {};

/**
 * Builds the deterministic viz data block from the full node/edge arrays.
 * Pure and order-independent (ADR-008).
 */
export function buildVizData(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: VizOptions,
): VizGraphData {
  // Detail + neighbor groups come from the FULL graph (pre-collapse).
  const neighborIndex = buildNeighborIndex(edges, nodes);

  // Visible structural subgraph.
  const collapsed = collapse(nodes, edges, opts);
  const assignment = assignCommunities(collapsed.nodes, collapsed.edges);

  // Canonical node order → stable indices.
  const orderedNodes = [...collapsed.nodes].sort((a, b) => {
    const c = codePointCompare(a.qname, b.qname);
    return c !== 0 ? c : codePointCompare(a.id, b.id);
  });
  const indexOf = new Map<string, number>();
  orderedNodes.forEach((n, i) => indexOf.set(n.id, i));

  // Degree over the visible (collapsed) edge set.
  const degree = new Map<string, number>();
  for (const n of orderedNodes) degree.set(n.id, 0);
  for (const e of collapsed.edges) {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }

  const vizNodes: VizNode[] = orderedNodes.map((n, i) => {
    const groups = neighborIndex.get(n.id) ?? EMPTY_GROUPS;
    const detail = formatObject({ node: n, neighbors: groups }, 'full');
    return {
      i,
      label: n.qname,
      kind: n.kind,
      community: assignment.communityOf.get(n.id) ?? 0,
      degree: degree.get(n.id) ?? 0,
      detail,
    };
  });

  // Canonical edge order (s, t, kind); endpoints mapped to node indices.
  const vizEdges: VizEdge[] = collapsed.edges
    .map((e): VizEdge | null => {
      const s = indexOf.get(e.src);
      const t = indexOf.get(e.dst);
      if (s === undefined || t === undefined) return null;
      return { s, t, kind: e.kind };
    })
    .filter((e): e is VizEdge => e !== null)
    .sort((a, b) => {
      if (a.s !== b.s) return a.s - b.s;
      if (a.t !== b.t) return a.t - b.t;
      return codePointCompare(a.kind as string, b.kind as string);
    });

  const communities: readonly CommunityInfo[] = assignment.communities;

  return { nodes: vizNodes, edges: vizEdges, communities };
}
