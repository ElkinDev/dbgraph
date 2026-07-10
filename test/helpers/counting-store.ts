/**
 * CountingStore — a GraphStore decorator that COUNTS every port method call.
 *
 * Introduced by graph-viz Batch 2 (task 2.3) and REUSED by Batch 3 (task 3.7) to pin the
 * bounded-query ceiling: the whole-graph export issues EXACTLY 2 whole-graph reads
 * (`getAllNodes` + `getAllEdges`), ≤ 3 total store reads, and NEVER a per-node/per-edge
 * read (`getNode`/`getNodesByKind`/`getEdgesFrom`/`getEdgesTo`) — independent of node count.
 *
 * It delegates faithfully to the wrapped store; it only observes call counts. Test-only
 * utility (no production import). ADR-004: wraps the core port, imports no adapter internals.
 */

import type {
  GraphStore,
  UpsertResult,
  SearchHit,
  SnapshotRecord,
  SnapshotObjectRow,
} from '../../src/core/ports/graph-store.js';
import type { GraphNode, NodeKind } from '../../src/core/model/node.js';
import type { GraphEdge, EdgeKind } from '../../src/core/model/edge.js';
import type { NormalizedGraph } from '../../src/core/model/graph.js';

/** Per-method invocation counters for a wrapped GraphStore. */
export interface StoreCounts {
  close: number;
  schemaVersion: number;
  upsertGraph: number;
  deleteNodes: number;
  getNode: number;
  getNodesByKind: number;
  getNodeByQName: number;
  getEdgesFrom: number;
  getEdgesTo: number;
  searchFts: number;
  putSnapshot: number;
  listSnapshots: number;
  getSnapshotObjects: number;
  getMeta: number;
  setMeta: number;
  getAllNodes: number;
  getAllEdges: number;
}

function zeroCounts(): StoreCounts {
  return {
    close: 0,
    schemaVersion: 0,
    upsertGraph: 0,
    deleteNodes: 0,
    getNode: 0,
    getNodesByKind: 0,
    getNodeByQName: 0,
    getEdgesFrom: 0,
    getEdgesTo: 0,
    searchFts: 0,
    putSnapshot: 0,
    listSnapshots: 0,
    getSnapshotObjects: 0,
    getMeta: 0,
    setMeta: 0,
    getAllNodes: 0,
    getAllEdges: 0,
  };
}

export class CountingStore implements GraphStore {
  readonly counts: StoreCounts = zeroCounts();

  constructor(private readonly inner: GraphStore) {}

  /** Sum of all READ-method calls (the "total store reads" ceiling for Q3). */
  get totalReads(): number {
    const c = this.counts;
    return (
      c.schemaVersion +
      c.getNode +
      c.getNodesByKind +
      c.getNodeByQName +
      c.getEdgesFrom +
      c.getEdgesTo +
      c.searchFts +
      c.listSnapshots +
      c.getSnapshotObjects +
      c.getMeta +
      c.getAllNodes +
      c.getAllEdges
    );
  }

  /** Whole-graph bulk reads only (must be exactly 2 for a viz export). */
  get wholeGraphReads(): number {
    return this.counts.getAllNodes + this.counts.getAllEdges;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  close(): Promise<void> {
    this.counts.close++;
    return this.inner.close();
  }
  schemaVersion(): Promise<number> {
    this.counts.schemaVersion++;
    return this.inner.schemaVersion();
  }

  // ── writes ────────────────────────────────────────────────────────────────────
  upsertGraph(graph: NormalizedGraph): Promise<UpsertResult> {
    this.counts.upsertGraph++;
    return this.inner.upsertGraph(graph);
  }
  deleteNodes(ids: readonly string[]): Promise<number> {
    this.counts.deleteNodes++;
    return this.inner.deleteNodes(ids);
  }

  // ── per-id / per-kind reads ─────────────────────────────────────────────────
  getNode(id: string): Promise<GraphNode | null> {
    this.counts.getNode++;
    return this.inner.getNode(id);
  }
  getNodesByKind(kind: NodeKind): Promise<readonly GraphNode[]> {
    this.counts.getNodesByKind++;
    return this.inner.getNodesByKind(kind);
  }
  getNodeByQName(kind: NodeKind, qname: string): Promise<GraphNode | null> {
    this.counts.getNodeByQName++;
    return this.inner.getNodeByQName(kind, qname);
  }

  // ── edges ────────────────────────────────────────────────────────────────────
  getEdgesFrom(nodeId: string, kinds?: readonly EdgeKind[]): Promise<readonly GraphEdge[]> {
    this.counts.getEdgesFrom++;
    return this.inner.getEdgesFrom(nodeId, kinds);
  }
  getEdgesTo(nodeId: string, kinds?: readonly EdgeKind[]): Promise<readonly GraphEdge[]> {
    this.counts.getEdgesTo++;
    return this.inner.getEdgesTo(nodeId, kinds);
  }

  // ── bulk whole-graph seam (graph-viz Batch 2) ──────────────────────────────
  getAllNodes(): Promise<readonly GraphNode[]> {
    this.counts.getAllNodes++;
    return this.inner.getAllNodes();
  }
  getAllEdges(): Promise<readonly GraphEdge[]> {
    this.counts.getAllEdges++;
    return this.inner.getAllEdges();
  }

  // ── FTS ───────────────────────────────────────────────────────────────────────
  searchFts(
    query: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ hits: readonly SearchHit[]; total: number }> {
    this.counts.searchFts++;
    return this.inner.searchFts(query, opts);
  }

  // ── snapshots ─────────────────────────────────────────────────────────────────
  putSnapshot(s: SnapshotRecord): Promise<void> {
    this.counts.putSnapshot++;
    return this.inner.putSnapshot(s);
  }
  listSnapshots(): Promise<readonly SnapshotRecord[]> {
    this.counts.listSnapshots++;
    return this.inner.listSnapshots();
  }
  getSnapshotObjects(snapshotId: string): Promise<readonly SnapshotObjectRow[]> {
    this.counts.getSnapshotObjects++;
    return this.inner.getSnapshotObjects(snapshotId);
  }

  // ── meta ──────────────────────────────────────────────────────────────────────
  getMeta(key: string): Promise<string | null> {
    this.counts.getMeta++;
    return this.inner.getMeta(key);
  }
  setMeta(key: string, value: string): Promise<void> {
    this.counts.setMeta++;
    return this.inner.setMeta(key, value);
  }
}
