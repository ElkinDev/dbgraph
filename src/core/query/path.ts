/**
 * findJoinPath — US-015: shortest join path over references edges with exact join columns.
 * Design §6.3 — BFS at table grain over aggregated references edges; per-column edges
 * supply the exact join columns for each hop. No-route → nearest neighbors suggestion.
 * ADR-004: imports only core. ADR-008: deterministic (BFS in sorted order; ties by qname/id).
 */

import type { GraphStore, PathQuery, PathResult, JoinHop } from '../ports/graph-store.js';
import type { GraphEdge } from '../model/edge.js';

/**
 * Finds the shortest join path between two table nodes over `references` edges.
 *
 * Algorithm:
 * 1. BFS over aggregated references edges (attrs.aggregate === true) in both directions.
 *    Using ONLY aggregated edges avoids traversing per-column edges during BFS;
 *    they are resolved separately for join columns.
 * 2. When the target node is found, reconstruct the path from the predecessor map.
 * 3. For each hop, collect the matching per-column references edges to emit exact join columns.
 * 4. If `allowInferred` is false (default), skip `inferred_reference` edges.
 * 5. No route: return `found:false` with the nearest one-hop neighbours of each endpoint.
 * 6. Same node (from === to): return `found:true` with empty hops array.
 *
 * Determinism (ADR-008): BFS explores neighbours in sorted (qname, id) order so the
 * chosen shortest path is stable across runs. Ties are broken by (qname, id).
 */
export async function findJoinPath(
  store: GraphStore,
  q: PathQuery,
): Promise<PathResult> {
  // Same-node trivial case
  if (q.from === q.to) {
    return { found: true, hops: [], inferred: false };
  }

  // ── BFS state ──────────────────────────────────────────────────────────────
  // predecessor[nodeId] = { from: parentId, via: edgeSrcId→edgeDstId }
  const predecessor = new Map<string, { parentId: string; edgeSrc: string; edgeDst: string }>();
  predecessor.set(q.from, { parentId: '', edgeSrc: '', edgeDst: '' }); // sentinel for start

  const visited = new Set<string>([q.from]);
  let frontier: string[] = [q.from];
  let found = false;

  while (frontier.length > 0 && !found) {
    // Sort frontier for determinism
    const sortedFrontier = await sortByQname(store, frontier);
    const nextFrontier: string[] = [];

    for (const nodeId of sortedFrontier) {
      if (found) break;

      // Get neighbours in both directions via aggregated references edges
      const [edgesFrom, edgesTo] = await Promise.all([
        store.getEdgesFrom(nodeId, ['references']),
        store.getEdgesTo(nodeId, ['references']),
      ]);

      // Collect aggregated neighbours (both directions = join works either way)
      const neighbours: Array<{ neighbourId: string; edgeSrc: string; edgeDst: string }> = [];

      for (const e of edgesFrom) {
        if (!isTraversable(e)) continue;
        if (!visited.has(e.dst)) {
          neighbours.push({ neighbourId: e.dst, edgeSrc: e.src, edgeDst: e.dst });
        }
      }
      for (const e of edgesTo) {
        if (!isTraversable(e)) continue;
        if (!visited.has(e.src)) {
          neighbours.push({ neighbourId: e.src, edgeSrc: e.dst, edgeDst: e.src });
        }
      }

      // Sort neighbours for determinism
      const sortedNeighbours = await sortNeighboursByQname(store, neighbours);

      for (const nb of sortedNeighbours) {
        if (visited.has(nb.neighbourId)) continue;
        visited.add(nb.neighbourId);
        predecessor.set(nb.neighbourId, {
          parentId: nodeId,
          edgeSrc: nb.edgeSrc,
          edgeDst: nb.edgeDst,
        });
        nextFrontier.push(nb.neighbourId);

        if (nb.neighbourId === q.to) {
          found = true;
          break;
        }
      }
    }

    frontier = nextFrontier;
  }

  if (!found) {
    // No route — suggest nearest neighbours of each endpoint
    const [fromEdgesFrom, fromEdgesTo, toEdgesFrom, toEdgesTo] = await Promise.all([
      store.getEdgesFrom(q.from, ['references']),
      store.getEdgesTo(q.from, ['references']),
      store.getEdgesFrom(q.to, ['references']),
      store.getEdgesTo(q.to, ['references']),
    ]);

    const fromNeighbours = new Set<string>();
    for (const e of fromEdgesFrom) fromNeighbours.add(e.dst);
    for (const e of fromEdgesTo) fromNeighbours.add(e.src);

    const toNeighbours = new Set<string>();
    for (const e of toEdgesFrom) toNeighbours.add(e.dst);
    for (const e of toEdgesTo) toNeighbours.add(e.src);

    return {
      found: false,
      nearest: {
        from: [...fromNeighbours].sort(),
        to: [...toNeighbours].sort(),
      },
    };
  }

  // ── Reconstruct path ───────────────────────────────────────────────────────
  const pathNodeIds: string[] = [];
  let current = q.to;
  while (current !== '') {
    pathNodeIds.unshift(current);
    const pred = predecessor.get(current);
    if (pred === undefined || pred.parentId === '') break;
    current = pred.parentId;
  }

  // ── Build hops with exact join columns ────────────────────────────────────
  const hops: JoinHop[] = [];
  for (let i = 0; i < pathNodeIds.length - 1; i++) {
    const fromId = pathNodeIds[i] as string;  // bounds-checked by loop condition
    const toId = pathNodeIds[i + 1] as string; // i+1 < length guaranteed

    // Find all per-column references edges between these two tables
    const [fromEdges] = await Promise.all([store.getEdgesFrom(fromId, ['references'])]);
    const perColumnEdges = fromEdges.filter(
      (e) => e.dst === toId && e.attrs['aggregate'] !== true && e.attrs['srcColumn'] !== undefined,
    );

    // Also check reverse direction
    const [toEdges] = await Promise.all([store.getEdgesFrom(toId, ['references'])]);
    const reverseEdges = toEdges.filter(
      (e) => e.dst === fromId && e.attrs['aggregate'] !== true && e.attrs['srcColumn'] !== undefined,
    );

    const joinColumns: Array<{ from: string; to: string }> = [];

    if (perColumnEdges.length > 0) {
      for (const e of perColumnEdges) {
        const srcCol = e.attrs['srcColumn'] as string | undefined;
        const dstCol = e.attrs['dstColumn'] as string | undefined;
        if (srcCol !== undefined && dstCol !== undefined) {
          joinColumns.push({ from: srcCol, to: dstCol });
        }
      }
    } else if (reverseEdges.length > 0) {
      // Reverse hop: swap columns
      for (const e of reverseEdges) {
        const srcCol = e.attrs['srcColumn'] as string | undefined;
        const dstCol = e.attrs['dstColumn'] as string | undefined;
        if (srcCol !== undefined && dstCol !== undefined) {
          joinColumns.push({ from: dstCol, to: srcCol });
        }
      }
    }

    // Sort join columns for determinism
    joinColumns.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

    hops.push({ fromTable: fromId, toTable: toId, joinColumns });
  }

  return { found: true, hops, inferred: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a references edge should be traversed during BFS.
 * Design §6.3: BFS follows ONLY aggregated references edges (attrs.aggregate === true).
 * Per-column edges (srcColumn/dstColumn) are excluded from BFS traversal; they are resolved
 * separately in the hop join-column reconstruction step.
 *
 * This is the Phase 9 seam: when inferred_reference edges exist, allowInferred logic
 * will be added here to optionally include them in traversal.
 */
function isTraversable(edge: GraphEdge): boolean {
  return edge.attrs['aggregate'] === true;
}

async function sortByQname(store: GraphStore, ids: string[]): Promise<string[]> {
  const pairs = await Promise.all(
    ids.map(async (id) => ({ id, node: await store.getNode(id) })),
  );
  return pairs
    .sort((a, b) => {
      const qa = a.node?.qname ?? a.id;
      const qb = b.node?.qname ?? b.id;
      if (qa !== qb) return qa.localeCompare(qb);
      return a.id.localeCompare(b.id);
    })
    .map((p) => p.id);
}

async function sortNeighboursByQname(
  store: GraphStore,
  neighbours: Array<{ neighbourId: string; edgeSrc: string; edgeDst: string }>,
): Promise<typeof neighbours> {
  const withQname = await Promise.all(
    neighbours.map(async (nb) => ({
      nb,
      node: await store.getNode(nb.neighbourId),
    })),
  );
  return withQname
    .sort((a, b) => {
      const qa = a.node?.qname ?? a.nb.neighbourId;
      const qb = b.node?.qname ?? b.nb.neighbourId;
      if (qa !== qb) return qa.localeCompare(qb);
      return a.nb.neighbourId.localeCompare(b.nb.neighbourId);
    })
    .map((x) => x.nb);
}
