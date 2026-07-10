/**
 * Shared B1 test helper — loads the SQLite torture graph as pure node/edge arrays.
 *
 * The pure `src/core/viz/**` modules (collapse, community, neighbor-index, graph-data,
 * mermaid) are ORDER-INDEPENDENT: they impose their own canonical ordering (ADR-008),
 * so this loader only needs to return the COMPLETE set of nodes and edges — the order
 * it collects them in does not affect any golden.
 *
 * It uses ONLY the existing GraphStore port (getNodesByKind + getEdgesFrom), so B1 is
 * self-contained and green at gate 1.8 WITHOUT depending on the B2 bulk-read seam.
 *
 * The `store` is also returned so detail-parity (1.5) can call getNeighbors against the
 * SAME persisted graph, proving the in-memory neighbor index matches the store path.
 */

import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';
import { NODE_KINDS } from '../../../src/core/model/node.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';

export interface TortureGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly store: GraphStore;
  cleanup(): Promise<void>;
}

/**
 * Materializes + syncs the torture fixture, then reads every node (via getNodesByKind
 * over all NODE_KINDS) and every edge (via getEdgesFrom over every node — every edge has
 * a src that is one of those nodes, so the union is complete).
 */
export async function loadTortureGraph(): Promise<TortureGraph> {
  const fx: FixtureStore = await openFixtureStore();

  const nodes: GraphNode[] = [];
  for (const kind of NODE_KINDS) {
    const kindNodes = await fx.store.getNodesByKind(kind);
    nodes.push(...kindNodes);
  }

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    const outEdges = await fx.store.getEdgesFrom(node.id);
    edges.push(...outEdges);
  }

  return {
    nodes,
    edges,
    store: fx.store,
    cleanup: fx.cleanup,
  };
}
