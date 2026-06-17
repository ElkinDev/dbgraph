/**
 * getImpact — US-014: depth-limited blast-radius traversal separating read/write impact.
 * Design §6.2 — BFS over inbound edges, read/write split, visible chains a→b→c,
 * depth cap + truncation warning, cycle safety (visited set), dynamic-SQL propagation.
 * ADR-004: imports only core. ADR-008: deterministic output.
 */

import type { GraphStore, ImpactQuery, ImpactResult, ImpactChain } from '../ports/graph-store.js';
import type { EdgeKind } from '../model/edge.js';

/** Edge kinds that count as WRITE impact when walking inbound edges. */
const WRITE_KINDS = new Set<EdgeKind>(['writes_to']);

/** Edge kinds that count as READ impact when walking inbound edges (by exclusion of WRITE_KINDS). */
// Note: READ_KINDS is derived implicitly — any IMPACT_EDGE_KIND that is not in WRITE_KINDS is read.

/** Default BFS depth cap (design §6.2). */
const DEFAULT_DEPTH = 3;

/** All edge kinds traversed for impact (union of read + write). */
const IMPACT_EDGE_KINDS: readonly EdgeKind[] = [
  'writes_to',
  'reads_from',
  'depends_on',
  'references',
];

/**
 * Computes the transitive impact closure of a node as visible dependency chains.
 *
 * Algorithm (BFS):
 * 1. Start from `q.nodeId`; add it to `visited`.
 * 2. For each frontier node, fetch inbound impact edges (who points AT it).
 * 3. For each new (unvisited) neighbour create a new chain by extending the
 *    predecessor chain and enqueue.
 * 4. Stop expanding when `depth` is reached; set `truncated` if any cut-off
 *    node had unexpanded inbound edges.
 * 5. After BFS, classify each chain into readImpact or writeImpact based on
 *    the last hop's edge kind. A chain may contribute to both if its edges mix
 *    (the terminal hop decides the bucket).
 * 6. Set `dynamicSqlWarning` if any node in any surfaced chain has
 *    `payload.hasDynamicSql === true`.
 * 7. Sort chains and their nodes deterministically.
 */
export async function getImpact(
  store: GraphStore,
  q: ImpactQuery,
): Promise<ImpactResult> {
  const depth = q.depth ?? DEFAULT_DEPTH;

  // ── BFS state ──────────────────────────────────────────────────────────────
  // Each frontier item carries the chain built so far (node ids + edge kinds).
  interface FrontierItem {
    nodeId: string;
    chainNodes: readonly string[];  // includes starting node
    chainEdges: readonly EdgeKind[];
  }

  const visited = new Set<string>([q.nodeId]);
  let frontier: FrontierItem[] = [
    { nodeId: q.nodeId, chainNodes: [q.nodeId], chainEdges: [] },
  ];

  const completedChains: { chainNodes: readonly string[]; chainEdges: readonly EdgeKind[]; lastEdgeKind: EdgeKind | null }[] = [];
  let truncated = false;

  // ── BFS ───────────────────────────────────────────────────────────────────
  while (frontier.length > 0) {
    // Process frontier in sorted order for determinism (ADR-008)
    frontier.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

    const nextFrontier: FrontierItem[] = [];

    for (const item of frontier) {
      const currentDepth = item.chainNodes.length - 1; // hops taken so far

      if (currentDepth >= depth) {
        // At the depth boundary — check if this node has unexpanded impact edges.
        // getEdgesTo already filters by IMPACT_EDGE_KINDS; no need to re-check kind here.
        const inbound = await store.getEdgesTo(item.nodeId, IMPACT_EDGE_KINDS);
        const hasUnvisitedNeighbors = inbound.some((e) => !visited.has(e.src));
        if (hasUnvisitedNeighbors) {
          truncated = true;
        }
        // Record chain if it has at least one hop
        if (item.chainEdges.length > 0) {
          completedChains.push({
            chainNodes: item.chainNodes,
            chainEdges: item.chainEdges,
            lastEdgeKind: item.chainEdges.at(-1) ?? null,
          });
        }
        continue;
      }

      // Fetch inbound edges (who points AT this node)
      const inbound = await store.getEdgesTo(item.nodeId, IMPACT_EDGE_KINDS);

      // Sort for determinism
      const sortedInbound = [...inbound]
        .filter((e) => IMPACT_EDGE_KINDS.includes(e.kind))
        .sort((a, b) => a.src.localeCompare(b.src));

      for (const edge of sortedInbound) {
        if (visited.has(edge.src)) continue;
        visited.add(edge.src);

        const newChain: FrontierItem = {
          nodeId: edge.src,
          chainNodes: [...item.chainNodes, edge.src],
          chainEdges: [...item.chainEdges, edge.kind],
        };
        nextFrontier.push(newChain);

        // Also record as a completed chain (each hop is a chain endpoint)
        completedChains.push({
          chainNodes: newChain.chainNodes,
          chainEdges: newChain.chainEdges,
          lastEdgeKind: edge.kind,
        });
      }
    }

    frontier = nextFrontier;
  }

  // ── Classify chains into read vs write ─────────────────────────────────────
  // A chain's classification is based on the LAST edge kind (the terminal hop).
  // Chains whose last edge is a write kind → writeImpact; otherwise → readImpact.
  const readImpact: ImpactChain[] = [];
  const writeImpact: ImpactChain[] = [];

  // Deduplicate chains by their node sequence (BFS can produce duplicates)
  const seen = new Set<string>();
  for (const c of completedChains) {
    if (c.chainEdges.length === 0) continue; // skip start-only
    const key = c.chainNodes.join('>');
    if (seen.has(key)) continue;
    seen.add(key);

    const chain: ImpactChain = {
      nodes: c.chainNodes,
      edges: c.chainEdges,
    };

    if (c.lastEdgeKind !== null && WRITE_KINDS.has(c.lastEdgeKind)) {
      writeImpact.push(chain);
    } else {
      readImpact.push(chain);
    }
  }

  // ── Dynamic-SQL warning ────────────────────────────────────────────────────
  let dynamicSqlWarning = false;
  const allNodeIds = new Set(
    completedChains.flatMap((c) => c.chainNodes),
  );
  for (const nodeId of allNodeIds) {
    if (dynamicSqlWarning) break;
    const node = await store.getNode(nodeId);
    if (node !== null && node.payload['hasDynamicSql'] === true) {
      dynamicSqlWarning = true;
    }
  }

  // ── Sort chains deterministically (ADR-008) ────────────────────────────────
  const chainSortKey = (c: ImpactChain): string => c.nodes.join('>');
  readImpact.sort((a, b) => chainSortKey(a).localeCompare(chainSortKey(b)));
  writeImpact.sort((a, b) => chainSortKey(a).localeCompare(chainSortKey(b)));

  return { readImpact, writeImpact, truncated, dynamicSqlWarning };
}
