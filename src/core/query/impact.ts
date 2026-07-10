/**
 * getImpact — US-014: depth-limited blast-radius traversal separating read/write impact.
 * Design §6.2 — BFS over inbound edges, read/write split, visible chains a→b→c,
 * depth cap + truncation warning, cycle safety (visited set), dynamic-SQL propagation.
 * ADR-004: imports only core. ADR-008: deterministic output.
 */

import type { GraphStore, ImpactQuery, ImpactResult, ImpactChain } from '../ports/graph-store.js';
import type { EdgeKind } from '../model/edge.js';
import { filterReadersByColumn } from './column-pivot.js';

/** Edge kinds that count as WRITE impact when walking inbound edges. */
const WRITE_KINDS = new Set<EdgeKind>(['writes_to']);

/** Edge kinds that count as READ impact when walking inbound edges (by exclusion of WRITE_KINDS). */
// Note: READ_KINDS is derived implicitly — any IMPACT_EDGE_KIND that is not in WRITE_KINDS is read.

/** Default BFS depth cap (design §6.2). */
const DEFAULT_DEPTH = 3;

/**
 * All edge kinds traversed for impact (union of read + write).
 * `calls` is a READ-impact kind (DOG-1 D6): it is NOT in `WRITE_KINDS`, so a caller
 * depends on its callee like a read — altering a called routine reaches its CALLERS
 * through inbound `calls` edges, while WRITE impact stays `writes_to`-only (a call is
 * not a mutation). SQLite/mongodb emit no `calls` edges → zero traversal drift there.
 */
const IMPACT_EDGE_KINDS: readonly EdgeKind[] = [
  'writes_to',
  'reads_from',
  'depends_on',
  'references',
  'calls',
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

  // DOG-3 (design D6): a COLUMN-node pivot resolves to its owning TABLE (via the inbound
  // has_column containment edge), remembering the pivot COLUMN NAME so the FIRST hop of
  // inbound depends_on edges can be filtered by attrs.dstColumns membership
  // (filterReadersByColumn). A TABLE-node (or any non-column) pivot is UNCHANGED — no
  // resolution, no filtering, byte-identical to pre-DOG-3 behavior.
  let startNodeId = q.nodeId;
  let pivotColumnName: string | undefined;
  const pivotNode = await store.getNode(q.nodeId);
  if (pivotNode !== null && pivotNode.kind === 'column') {
    // Defensive re-filter: some GraphStore implementations (and older test fakes predating
    // this kinds-filtered call) may not narrow by `kinds` — re-check the edge kind explicitly
    // so a column with NO real has_column containment edge falls through UNCHANGED rather than
    // mis-resolving to an unrelated inbound edge's source.
    const ownerEdges = (await store.getEdgesTo(q.nodeId, ['has_column'])).filter(
      (e) => e.kind === 'has_column',
    );
    const owner = ownerEdges[0];
    if (owner !== undefined) {
      startNodeId = owner.src;
      pivotColumnName = pivotNode.name;
    }
  }

  // ── BFS state ──────────────────────────────────────────────────────────────
  // Each frontier item carries the chain built so far (node ids + edge kinds).
  interface FrontierItem {
    nodeId: string;
    chainNodes: readonly string[];  // includes starting node
    chainEdges: readonly EdgeKind[];
  }

  const visited = new Set<string>([startNodeId]);
  let frontier: FrontierItem[] = [
    { nodeId: startNodeId, chainNodes: [startNodeId], chainEdges: [] },
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
      let sortedInbound = [...inbound]
        .filter((e) => IMPACT_EDGE_KINDS.includes(e.kind))
        .sort((a, b) => a.src.localeCompare(b.src));

      // DOG-3 (D6): at the FIRST hop from a resolved column pivot ONLY (item.nodeId ===
      // startNodeId), filter inbound depends_on edges by column membership — a view whose
      // edge lists the pivot column is affected; one whose edge excludes it is dropped
      // (precision); one with NO attrs.dstColumns (degraded engine) stays included (no false
      // negative). Deeper hops are UNCHANGED — column precision applies only at the view
      // first-hop, per design (the "Dependency bottlenecks" note in tasks.md).
      if (pivotColumnName !== undefined && item.nodeId === startNodeId) {
        const depOnly = sortedInbound.filter((e) => e.kind === 'depends_on');
        const nonDepOnly = sortedInbound.filter((e) => e.kind !== 'depends_on');
        sortedInbound = [...filterReadersByColumn(depOnly, pivotColumnName), ...nonDepOnly].sort(
          (a, b) => a.src.localeCompare(b.src),
        );
      }

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
