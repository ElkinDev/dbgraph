/**
 * Reference resolution, stub creation, and edge emission for FK/trigger/dependency references.
 * Design §5.1–§5.3 — pipeline steps 4 and 5.
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 */

import type { GraphNode, NodeKind } from '../model/node.js';
import type { GraphEdge, EdgeKind } from '../model/edge.js';
import type { RawObject, RawConstraint, RawDependency } from '../model/catalog.js';
import type { StubInfo } from '../model/graph.js';
import { nodeId, edgeId, canonicalQName } from './id.js';

/** Read-only map from qname to the already-built GraphNode (by kind+qname key). */
export type NodeMap = Map<string, GraphNode>;

/** Key for the node map: kind + ':' + qname */
export function nodeMapKey(kind: NodeKind, qname: string): string {
  return `${kind}:${qname}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve or create a stub
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveResult {
  node: GraphNode;
  isStub: boolean;
  stubInfo?: StubInfo;
}

/**
 * Resolves a reference target against the node map.
 * If the target is not found, creates a stub with the appropriate reason.
 *
 * @param targetKind     - The NodeKind we expect for the target.
 * @param targetSchema   - Schema of the target object.
 * @param targetName     - Name of the target object.
 * @param nodeMap        - Current node map (includes primary nodes and stubs built so far).
 * @param excludedQNames - Set of qnames that were filtered out by scope (→ excluded:true stubs).
 * @param referencedById - ID of the node that is pointing at this target.
 */
export function resolveOrStub(
  targetKind: NodeKind,
  targetSchema: string | null,
  targetName: string,
  nodeMap: NodeMap,
  excludedQNames: ReadonlySet<string>,
  referencedById: string,
): ResolveResult {
  const qname = canonicalQName(targetSchema, targetName);
  const key = nodeMapKey(targetKind, qname);
  const existing = nodeMap.get(key);
  if (existing !== undefined) {
    return { node: existing, isStub: existing.missing || existing.excluded };
  }

  // Not found — create a stub
  const reason: 'missing' | 'excluded' = excludedQNames.has(qname) ? 'excluded' : 'missing';
  const id = nodeId(targetKind, qname);
  const stub: GraphNode = {
    id,
    kind: targetKind,
    schema: targetSchema,
    name: targetName.toLowerCase(),
    qname,
    level: 'off',
    missing: reason === 'missing',
    excluded: reason === 'excluded',
    bodyHash: null,
    payload: {},
  };
  nodeMap.set(key, stub);

  const stubInfo: StubInfo = {
    id,
    qname,
    kind: targetKind,
    reason,
    referencedBy: referencedById,
  };
  return { node: stub, isStub: true, stubInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// FK constraint → references edges (design §5.2)
// ─────────────────────────────────────────────────────────────────────────────

/** Result type shared by buildFKEdges, buildFiresOnEdges, and buildDependencyEdges. */
export interface EdgeBuildResult {
  edges: GraphEdge[];
  stubs: StubInfo[];
}

/**
 * Emits per-column references edges AND one aggregated table→table edge for an FK constraint.
 * Design §5.2: one edge per column pair + one aggregate.
 */
export function buildFKEdges(
  srcTableNode: GraphNode,
  constraint: RawConstraint,
  nodeMap: NodeMap,
  excludedQNames: ReadonlySet<string>,
): EdgeBuildResult {
  const { references } = constraint;
  if (references === undefined) {
    return { edges: [], stubs: [] };
  }

  const stubs: StubInfo[] = [];
  const edges: GraphEdge[] = [];

  // Resolve target table (resolveOrStub handles both existing nodes and stubs internally)
  const targetResult = resolveOrStub(
    'table',
    references.schema,
    references.table,
    nodeMap,
    excludedQNames,
    srcTableNode.id,
  );
  const targetNode = targetResult.node;
  if (targetResult.stubInfo !== undefined) {
    stubs.push(targetResult.stubInfo);
  }

  // Per-column references edges
  const numCols = constraint.columns.length;
  for (let i = 0; i < numCols; i++) {
    const srcCol = constraint.columns[i];
    const dstCol = references.columns[i];
    if (srcCol === undefined || dstCol === undefined) continue;

    const discriminator = `${srcCol}>${dstCol}`;
    const id = edgeId('references', srcTableNode.id, targetNode.id, discriminator);
    const edge: GraphEdge = {
      id,
      kind: 'references',
      src: srcTableNode.id,
      dst: targetNode.id,
      confidence: 'declared',
      score: null,
      attrs: {
        srcColumn: srcCol,
        dstColumn: dstCol,
        constraintName: constraint.name,
      },
    };
    edges.push(edge);
  }

  // Aggregated table→table edge (discriminator = 'aggregate')
  const aggId = edgeId('references', srcTableNode.id, targetNode.id, 'aggregate');
  const aggEdge: GraphEdge = {
    id: aggId,
    kind: 'references',
    src: srcTableNode.id,
    dst: targetNode.id,
    confidence: 'declared',
    score: null,
    attrs: {
      aggregate: true,
      constraintName: constraint.name,
    },
  };
  edges.push(aggEdge);

  return { edges, stubs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger fires_on edge (design §5.1 step 4b)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds fires_on edges for each event a trigger fires on.
 * Design §5.1 step 4b: trigger targets → fires_on.
 */
export function buildFiresOnEdges(
  triggerNode: GraphNode,
  rawObj: RawObject,
  nodeMap: NodeMap,
  excludedQNames: ReadonlySet<string>,
): EdgeBuildResult {
  const { trigger } = rawObj;
  if (trigger === undefined) {
    return { edges: [], stubs: [] };
  }

  const stubs: StubInfo[] = [];
  const edges: GraphEdge[] = [];

  const targetResult = resolveOrStub(
    'table',
    trigger.table.schema,
    trigger.table.name,
    nodeMap,
    excludedQNames,
    triggerNode.id,
  );
  if (targetResult.stubInfo !== undefined) {
    stubs.push(targetResult.stubInfo);
  }
  const targetNode = targetResult.node;

  for (const event of trigger.events) {
    const id = edgeId('fires_on', triggerNode.id, targetNode.id, event);
    const edge: GraphEdge = {
      id,
      kind: 'fires_on',
      src: triggerNode.id,
      dst: targetNode.id,
      confidence: 'declared',
      score: null,
      attrs: { event },
    };
    edges.push(edge);
  }

  return { edges, stubs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency edges (reads_from / writes_to / depends_on) — design §5.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds dependency edges from a RawDependency list.
 * access:'read' → reads_from or depends_on (based on edge kind semantics).
 * access:'write' → writes_to.
 * For views, uses depends_on for read dependencies (design §4.2: "view/proc depends on object").
 */
export function buildDependencyEdges(
  srcNode: GraphNode,
  dependencies: readonly RawDependency[],
  nodeMap: NodeMap,
  excludedQNames: ReadonlySet<string>,
): EdgeBuildResult {
  const stubs: StubInfo[] = [];
  const edges: GraphEdge[] = [];

  for (const dep of dependencies) {
    const targetKind: NodeKind = dep.target.kind ?? 'table';
    const targetResult = resolveOrStub(
      targetKind,
      dep.target.schema,
      dep.target.name,
      nodeMap,
      excludedQNames,
      srcNode.id,
    );
    if (targetResult.stubInfo !== undefined) {
      stubs.push(targetResult.stubInfo);
    }
    const targetNode = targetResult.node;

    // Determine edge kind:
    // - view read → depends_on (design §4.2: "view/proc depends on object")
    // - other read (proc/trigger) → reads_from
    // - write → writes_to
    let edgeKind: EdgeKind;
    if (dep.access === 'write') {
      edgeKind = 'writes_to';
    } else if (srcNode.kind === 'view') {
      edgeKind = 'depends_on';
    } else {
      edgeKind = 'reads_from';
    }

    const id = edgeId(edgeKind, srcNode.id, targetNode.id, '');
    const edge: GraphEdge = {
      id,
      kind: edgeKind,
      src: srcNode.id,
      dst: targetNode.id,
      confidence: dep.confidence,
      score: null,
      attrs: {},
    };
    edges.push(edge);
  }

  return { edges, stubs };
}
