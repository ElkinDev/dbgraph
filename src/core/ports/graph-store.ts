/**
 * GraphStore port — the driven port for graph persistence.
 * Design §11 — async signatures so the port is the seam for node:sqlite / bun:sqlite (ADR-005).
 * The SQLite adapter wraps synchronous calls in resolved Promises (zero runtime cost).
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 */

import type { GraphNode, NodeKind } from '../model/node.js';
import type { GraphEdge, EdgeKind } from '../model/edge.js';
import type { NormalizedGraph } from '../model/graph.js';

// ─────────────────────────────────────────────────────────────────────────────
// Supporting param / result types
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertResult {
  readonly nodes: number;
  readonly edges: number;
}

export interface SearchHit {
  readonly id: string;
  readonly kind: NodeKind;
  readonly qname: string;
  readonly column: 'qname' | 'comment' | 'body';
  readonly score: number;
}

export interface SnapshotRecord {
  readonly id: string;
  readonly takenAt: string;                          // ISO-8601 UTC
  readonly engine: string;
  readonly engineVersion?: string;
  readonly fingerprint: string;
  readonly counts: Readonly<Record<string, number>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query param types (for query engine functions — not the port itself)
// ─────────────────────────────────────────────────────────────────────────────

export interface NeighborQuery {
  readonly nodeId: string;
  readonly kinds?: readonly EdgeKind[];
}

export interface NeighborGroups {
  readonly [kind: string]: {
    readonly out: readonly { node: GraphNode; edge: GraphEdge }[];
    readonly in: readonly { node: GraphNode; edge: GraphEdge }[];
  };
}

export interface ImpactQuery {
  readonly nodeId: string;
  readonly depth?: number;    // default 3
}

export interface ImpactChain {
  readonly nodes: readonly string[];    // node ids a→b→c (start … impacted)
  readonly edges: readonly EdgeKind[];  // edge kind per hop (length = nodes.length - 1)
}

export interface ImpactResult {
  readonly readImpact: readonly ImpactChain[];
  readonly writeImpact: readonly ImpactChain[];
  readonly truncated: boolean;
  readonly dynamicSqlWarning: boolean;
}

export interface PathQuery {
  readonly from: string;      // table node id
  readonly to: string;        // table node id
  readonly allowInferred?: boolean; // default false; inferred_reference edges not traversed in P1
}

export interface JoinHop {
  readonly fromTable: string;
  readonly toTable: string;
  readonly joinColumns: readonly { from: string; to: string }[];
}

export interface PathResult {
  readonly found: boolean;
  readonly hops?: readonly JoinHop[];         // present when found
  readonly inferred?: boolean;
  readonly nearest?: {
    from: readonly string[];
    to: readonly string[];
  };                                           // when not found
}

export interface SearchQuery {
  readonly term: string;
  readonly limit?: number;
  readonly offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphStore port
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphStore {
  // lifecycle
  close(): Promise<void>;
  schemaVersion(): Promise<number>;

  // bulk write — upsert a whole normalized graph in one transaction (idempotent on deterministic ids)
  upsertGraph(graph: NormalizedGraph): Promise<UpsertResult>;
  deleteNodes(ids: readonly string[]): Promise<number>;  // cascades edges + fts (Phase 4 incremental)

  // reads — per id / per kind
  getNode(id: string): Promise<GraphNode | null>;
  getNodesByKind(kind: NodeKind): Promise<readonly GraphNode[]>;
  getNodeByQName(kind: NodeKind, qname: string): Promise<GraphNode | null>;

  // edges / traversal
  getEdgesFrom(nodeId: string, kinds?: readonly EdgeKind[]): Promise<readonly GraphEdge[]>;
  getEdgesTo(nodeId: string, kinds?: readonly EdgeKind[]): Promise<readonly GraphEdge[]>;

  // FTS
  searchFts(
    query: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ hits: readonly SearchHit[]; total: number }>;

  // snapshots (US-009 model; written in Phase 4)
  putSnapshot(s: SnapshotRecord): Promise<void>;
  listSnapshots(): Promise<readonly SnapshotRecord[]>;

  // meta
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}
