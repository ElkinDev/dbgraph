/**
 * getNeighbors — US-013: direct neighbors grouped by edge kind and direction.
 * Design §6.1 — pure orchestration over the GraphStore port.
 * ADR-004: imports only core model and ports, never adapters/drivers/mcp/cli.
 * ADR-008: deterministic output (groups in fixed kind order; neighbors sorted by qname, id).
 */

import type { GraphStore, NeighborQuery, NeighborGroups } from '../ports/graph-store.js';
import type { GraphNode } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';

interface NeighborEntry {
  node: GraphNode;
  edge: GraphEdge;
}

interface NeighborGroup {
  out: NeighborEntry[];
  in: NeighborEntry[];
}

/**
 * Returns all direct neighbors of a node grouped by edge kind and direction.
 *
 * - Outbound edges (getEdgesFrom): the neighbour is the edge's `dst`.
 * - Inbound  edges (getEdgesTo):   the neighbour is the edge's `src`.
 * - If `q.kinds` is provided, only edges matching those kinds are included.
 * - Inferred edges appear under their own kind group (`inferred_reference`)
 *   — they are NOT mixed with declared/parsed edges.
 * - Deterministic: within each (kind, direction) group, neighbours are sorted
 *   by (qname, id).
 */
export async function getNeighbors(
  store: GraphStore,
  q: NeighborQuery,
): Promise<NeighborGroups> {
  const [edgesFrom, edgesTo] = await Promise.all([
    store.getEdgesFrom(q.nodeId, q.kinds),
    store.getEdgesTo(q.nodeId, q.kinds),
  ]);

  // Accumulate: kind → { out, in }
  const result: Record<string, NeighborGroup> = {};

  function ensureGroup(kind: string): NeighborGroup {
    if (result[kind] === undefined) {
      result[kind] = { out: [], in: [] };
    }
    return result[kind]!;
  }

  // Apply kinds filter defensively (the store MAY already filter, but we enforce here)
  const kindsSet = q.kinds !== undefined ? new Set<string>(q.kinds) : null;

  const filteredFrom = kindsSet !== null ? edgesFrom.filter((e) => kindsSet.has(e.kind)) : edgesFrom;
  const filteredTo = kindsSet !== null ? edgesTo.filter((e) => kindsSet.has(e.kind)) : edgesTo;

  // Outbound edges: neighbour is dst
  for (const edge of filteredFrom) {
    const node = await store.getNode(edge.dst);
    if (node === null) continue;
    ensureGroup(edge.kind).out.push({ node, edge });
  }

  // Inbound edges: neighbour is src
  for (const edge of filteredTo) {
    const node = await store.getNode(edge.src);
    if (node === null) continue;
    ensureGroup(edge.kind).in.push({ node, edge });
  }

  // Sort neighbours within each group by (qname, id) — ADR-008 determinism
  for (const group of Object.values(result)) {
    group.out.sort((a, b) => {
      const cmp = a.node.qname.localeCompare(b.node.qname);
      if (cmp !== 0) return cmp;
      return a.node.id.localeCompare(b.node.id);
    });
    group.in.sort((a, b) => {
      const cmp = a.node.qname.localeCompare(b.node.qname);
      if (cmp !== 0) return cmp;
      return a.node.id.localeCompare(b.node.id);
    });
  }

  return result as NeighborGroups;
}
