/**
 * normalizeCatalog — the main normalizer entry point.
 * Design §5 — pipeline: validate → filter → primary nodes → references → stubs → ordering.
 * Pure function; no I/O. ADR-004: imports only from src/core.
 * ADR-008: deterministic output (sorted by kind/qname/id; stableStringify for JSON).
 */

import type { RawCatalog, RawObject, RawColumn, RawConstraint, RawIndex } from '../model/catalog.js';
import type { ExtractionScope } from '../model/capability.js';
import type { GraphNode, NodeKind, NodePayload, IndexLevel } from '../model/node.js';
import type { GraphEdge, EdgeKind } from '../model/edge.js';
import type { NormalizedGraph, NormalizationResult, StubInfo, OmittedKindInfo } from '../model/graph.js';
import { NormalizationError } from '../errors.js';
import { nodeId, edgeId, canonicalQName } from './id.js';
import { applyLevel, LevelResult } from './levels.js';
import {
  NodeMap,
  nodeMapKey,
  buildFKEdges,
  buildFiresOnEdges,
  buildDependencyEdges,
} from './reference-resolver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a RawCatalog into a deterministic NormalizationResult.
 * Design §5.1 pipeline order is strictly followed.
 */
export function normalizeCatalog(
  raw: RawCatalog,
  scope: ExtractionScope,
): NormalizationResult {
  // ── Step 1: Input validation ──────────────────────────────────────────────
  validateInput(raw);

  // ── Step 2: Filter pass (exclude) ────────────────────────────────────────
  const { included, excludedQNames } = filterObjects(raw, scope);

  // ── Step 3: Primary node creation ────────────────────────────────────────
  const nodeMap: NodeMap = new Map();
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const stubs: StubInfo[] = [];

  for (const obj of included) {
    buildPrimaryNode(obj, scope, nodeMap, edges, warnings);
  }

  // ── Step 4 + 5: Reference resolution + stub creation ────────────────────
  for (const obj of included) {
    const qname = canonicalQName(obj.schema, obj.name);
    const srcNode = nodeMap.get(nodeMapKey(obj.kind, qname));
    if (srcNode === undefined) continue; // off-level objects were not added to nodeMap

    // 4a: FK constraints → references edges
    if (obj.constraints !== undefined) {
      for (const constraint of obj.constraints) {
        if (constraint.type !== 'FK' || constraint.references === undefined) continue;
        const fkResult = buildFKEdges(srcNode, constraint, nodeMap, excludedQNames);
        edges.push(...fkResult.edges);
        stubs.push(...fkResult.stubs);
      }
    }

    // 4b: Trigger targets → fires_on
    if (obj.kind === 'trigger' && obj.trigger !== undefined) {
      const trigResult = buildFiresOnEdges(srcNode, obj, nodeMap, excludedQNames);
      edges.push(...trigResult.edges);
      stubs.push(...trigResult.stubs);
    }

    // 4c: Dependencies → depends_on / reads_from / writes_to
    if (obj.dependencies !== undefined && obj.dependencies.length > 0) {
      const depResult = buildDependencyEdges(
        srcNode,
        obj.dependencies,
        nodeMap,
        excludedQNames,
      );
      edges.push(...depResult.edges);
      stubs.push(...depResult.stubs);
    }
  }

  // ── Step 6: Deterministic ordering ───────────────────────────────────────
  const nodes = sortNodes([...nodeMap.values()]);
  const sortedEdges = sortEdges(edges);
  const sortedStubs = sortStubs(stubs);

  // ── Step 7: Collect off-level kinds (W-1 / US-003) ───────────────────────
  const omitted = buildOmittedKinds(scope);

  const graph: NormalizedGraph = { nodes, edges: sortedEdges };
  return { graph, stubs: sortedStubs, warnings, omitted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateInput(raw: RawCatalog): void {
  if (!raw.engine || raw.engine.trim() === '') {
    throw new NormalizationError('RawCatalog.engine must be a non-empty string');
  }
  for (const obj of raw.objects) {
    if (!obj.name || obj.name.trim() === '') {
      throw new NormalizationError(
        `object in schema ${String(obj.schema)}: name must be non-empty`,
      );
    }
    if (obj.constraints !== undefined) {
      for (const c of obj.constraints) {
        if (c.type === 'FK' && c.references !== undefined) {
          if (c.columns.length !== c.references.columns.length) {
            throw new NormalizationError(
              `object ${canonicalQName(obj.schema, obj.name)}: constraint ${c.name} has misaligned columns ` +
                `(${c.columns.length} src, ${c.references.columns.length} dst)`,
            );
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Filter pass
// ─────────────────────────────────────────────────────────────────────────────

interface FilterResult {
  included: readonly RawObject[];
  excludedQNames: ReadonlySet<string>;
}

function filterObjects(raw: RawCatalog, scope: ExtractionScope): FilterResult {
  const excludePatterns = scope.exclude ?? [];
  const excludedQNames = new Set<string>();
  const included: RawObject[] = [];

  for (const obj of raw.objects) {
    const qname = canonicalQName(obj.schema, obj.name);
    if (isExcluded(qname, excludePatterns)) {
      excludedQNames.add(qname);
    } else {
      included.push(obj);
    }
  }
  return { included, excludedQNames };
}

/**
 * Checks if a qname matches any of the exclude glob patterns.
 * Supported: 'schema.*' (all objects in a schema) and exact qname matches.
 */
function isExcluded(qname: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (matchesGlob(qname, pattern)) return true;
  }
  return false;
}

function matchesGlob(qname: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  // schema.* → match all objects in schema
  if (p.endsWith('.*')) {
    const schemaPrefix = p.slice(0, -2);
    return qname.startsWith(`${schemaPrefix}.`);
  }
  // Exact match
  return qname === p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Primary node creation
// ─────────────────────────────────────────────────────────────────────────────

function buildPrimaryNode(
  obj: RawObject,
  scope: ExtractionScope,
  nodeMap: NodeMap,
  edges: GraphEdge[],
  warnings: string[],
): void {
  const level = getLevelForKind(obj.kind, scope);
  const levelResult = applyLevel({
    level,
    ...(obj.body !== undefined ? { body: obj.body } : {}),
    ...(obj.comment !== undefined ? { comment: obj.comment } : {}),
  });
  if (levelResult === null) {
    // off-level: no node produced
    return;
  }

  const qname = canonicalQName(obj.schema, obj.name);
  const id = nodeId(obj.kind, qname);

  // De-dup check
  const key = nodeMapKey(obj.kind, qname);
  if (nodeMap.has(key)) {
    warnings.push(`Duplicate object skipped: ${key}`);
    return;
  }

  // Build payload
  const payload = buildPayload(obj, levelResult);

  const node: GraphNode = {
    id,
    kind: obj.kind,
    schema: obj.schema,
    name: obj.name.toLowerCase(),
    qname,
    level,
    missing: false,
    excluded: false,
    bodyHash: levelResult.bodyHash,
    payload,
  };
  nodeMap.set(key, node);

  // Create child nodes (columns, constraints, indexes) with containment edges
  buildChildNodes(obj, node, scope, nodeMap, edges, warnings);
}

function buildPayload(
  obj: RawObject,
  levelResult: LevelResult,
): NodePayload {
  const base: Record<string, unknown> = {};

  // Common fields
  if (obj.comment !== undefined) base['comment'] = obj.comment;

  // Kind-specific payload fields
  if (obj.kind === 'procedure' || obj.kind === 'function') {
    if (obj.signature !== undefined) base['signature'] = obj.signature;
    if (obj.returns !== undefined) base['returns'] = obj.returns;
    if (levelResult.body !== undefined) base['body'] = levelResult.body;
    base['hasDynamicSql'] = obj.hasDynamicSql ?? false;
  } else if (obj.kind === 'trigger') {
    if (obj.trigger !== undefined) {
      base['timing'] = obj.trigger.timing;
      base['events'] = [...obj.trigger.events];
    }
    if (levelResult.body !== undefined) base['body'] = levelResult.body;
    base['hasDynamicSql'] = obj.hasDynamicSql ?? false;
  }
  // table / view / collection: no kind-specific fields beyond comment (structural payload handled by child nodes)

  return base as NodePayload;
}

function buildChildNodes(
  obj: RawObject,
  parentNode: GraphNode,
  scope: ExtractionScope,
  nodeMap: NodeMap,
  edges: GraphEdge[],
  warnings: string[],
): void {
  // Columns
  if (obj.columns !== undefined && scope.levels.columns !== 'off') {
    const colLevel: IndexLevel = scope.levels.columns;
    for (const col of obj.columns) {
      buildColumnNode(col, parentNode, colLevel, nodeMap, edges, warnings);
    }
  }

  // Constraints
  if (obj.constraints !== undefined && scope.levels.constraints !== 'off') {
    const constraintLevel: IndexLevel = scope.levels.constraints;
    for (const constraint of obj.constraints) {
      buildConstraintNode(constraint, parentNode, constraintLevel, nodeMap, edges, warnings);
    }
  }

  // Indexes
  if (obj.indexes !== undefined && scope.levels.indexes !== 'off') {
    const indexLevel: IndexLevel = scope.levels.indexes;
    for (const idx of obj.indexes) {
      buildIndexNode(idx, parentNode, indexLevel, nodeMap, edges, warnings);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Child node builder helpers (F-3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared helper for building column/constraint/index child nodes.
 * Creates the node at the given level and emits one containment edge from parent → child.
 * Returns the created GraphNode, or null if the level is 'off'.
 *
 * buildIndexNode uses this for the node + has_index edge,
 * then separately emits in_index edges.
 */
function buildChildNode(
  kind: NodeKind,
  localName: string,
  parentNode: GraphNode,
  level: IndexLevel,
  payload: NodePayload,
  edgeKind: EdgeKind,
  edgeAttrs: Record<string, unknown>,
  nodeMap: NodeMap,
  edges: GraphEdge[],
  warnings: string[],
): GraphNode | null {
  const levelResult = applyLevel({ level });
  if (levelResult === null) return null;

  const qname = `${parentNode.qname}.${localName}`;
  const id = nodeId(kind, qname);
  const key = nodeMapKey(kind, qname);
  if (nodeMap.has(key)) {
    warnings.push(`Duplicate ${kind} skipped: ${key}`);
    return null;
  }

  const childNode: GraphNode = {
    id,
    kind,
    schema: parentNode.schema,
    name: localName,
    qname,
    level,
    missing: false,
    excluded: false,
    bodyHash: null,
    payload,
  };
  nodeMap.set(key, childNode);

  const containmentEdgeId = edgeId(edgeKind, parentNode.id, id, '');
  edges.push({
    id: containmentEdgeId,
    kind: edgeKind,
    src: parentNode.id,
    dst: id,
    confidence: 'declared',
    score: null,
    attrs: edgeAttrs,
  });

  return childNode;
}

function buildColumnNode(
  col: RawColumn,
  parentNode: GraphNode,
  level: IndexLevel,
  nodeMap: NodeMap,
  edges: GraphEdge[],
  warnings: string[],
): void {
  const payload: NodePayload = {
    dataType: col.dataType,
    nullable: col.nullable,
    ordinal: col.ordinal,
    ...(col.default !== undefined ? { default: col.default } : {}),
    ...(col.comment !== undefined ? { comment: col.comment } : {}),
  };

  buildChildNode(
    'column',
    col.name.toLowerCase(),
    parentNode,
    level,
    payload,
    'has_column',
    { ordinal: col.ordinal },
    nodeMap,
    edges,
    warnings,
  );
}

function buildConstraintNode(
  constraint: RawConstraint,
  parentNode: GraphNode,
  level: IndexLevel,
  nodeMap: NodeMap,
  edges: GraphEdge[],
  warnings: string[],
): void {
  const payload: NodePayload = {
    type: constraint.type,
    columns: [...constraint.columns],
    ...(constraint.definition !== undefined ? { definition: constraint.definition } : {}),
  };

  buildChildNode(
    'constraint',
    constraint.name.toLowerCase(),
    parentNode,
    level,
    payload,
    'has_constraint',
    {},
    nodeMap,
    edges,
    warnings,
  );
}

function buildIndexNode(
  idx: RawIndex,
  parentNode: GraphNode,
  level: IndexLevel,
  nodeMap: NodeMap,
  edges: GraphEdge[],
  warnings: string[],
): void {
  const payload: NodePayload = {
    unique: idx.unique,
    columns: [...idx.columns],
    ...(idx.method !== undefined ? { method: idx.method } : {}),
  };

  const indexNode = buildChildNode(
    'index',
    idx.name.toLowerCase(),
    parentNode,
    level,
    payload,
    'has_index',
    {},
    nodeMap,
    edges,
    warnings,
  );

  if (indexNode === null) return; // level was 'off' — no in_index edges to emit

  // in_index edges (index → column) — separate from buildChildNode because they are
  // per-column, not a single containment edge
  idx.columns.forEach((colName, ordinal) => {
    const colQName = `${parentNode.qname}.${colName.toLowerCase()}`;
    const colKey = nodeMapKey('column', colQName);
    const colNode = nodeMap.get(colKey);
    if (colNode === undefined) return; // column may be off-level

    const inIndexId = edgeId('in_index', indexNode.id, colNode.id, String(ordinal));
    edges.push({
      id: inIndexId,
      kind: 'in_index',
      src: indexNode.id,
      dst: colNode.id,
      confidence: 'declared',
      score: null,
      attrs: { ordinal },
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Level resolution
// ─────────────────────────────────────────────────────────────────────────────

function getLevelForKind(kind: NodeKind, scope: ExtractionScope): IndexLevel {
  switch (kind) {
    case 'table':
      return scope.levels.tables;
    case 'column':
      return scope.levels.columns;
    case 'constraint':
      return scope.levels.constraints;
    case 'index':
      return scope.levels.indexes;
    case 'view':
      return scope.levels.views;
    case 'procedure':
      return scope.levels.procedures;
    case 'function':
      return scope.levels.functions;
    case 'trigger':
      return scope.levels.triggers;
    case 'sequence':
      return scope.levels.sequences;
    case 'collection':
      return scope.levels.collections;
    case 'field':
      return scope.levels.fields;
    default:
      return 'metadata';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic ordering (design §5.6, ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

function sortNodes(nodes: GraphNode[]): readonly GraphNode[] {
  return nodes.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.qname !== b.qname) return a.qname.localeCompare(b.qname);
    return a.id.localeCompare(b.id);
  });
}

function sortEdges(edges: GraphEdge[]): readonly GraphEdge[] {
  return edges.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.src !== b.src) return a.src.localeCompare(b.src);
    if (a.dst !== b.dst) return a.dst.localeCompare(b.dst);
    const aName = a.attrs.constraintName ?? '';
    const bName = b.attrs.constraintName ?? '';
    if (aName !== bName) return aName.localeCompare(bName);
    const aSrc = a.attrs.srcColumn ?? '';
    const bSrc = b.attrs.srcColumn ?? '';
    if (aSrc !== bSrc) return aSrc.localeCompare(bSrc);
    return a.id.localeCompare(b.id);
  });
}

function sortStubs(stubs: StubInfo[]): readonly StubInfo[] {
  return stubs.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.qname.localeCompare(b.qname);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Off-level kinds (W-1 / US-003)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collects which NodeKind categories are configured 'off' in the given scope.
 * Per spec "off level is an absence, not silence": each off kind produces a
 * queryable OmittedKindInfo with reason "not indexed by configuration".
 * Sorted deterministically by kind name (ADR-008).
 */
function buildOmittedKinds(scope: ExtractionScope): readonly OmittedKindInfo[] {
  const REASON = 'not indexed by configuration';
  const result: OmittedKindInfo[] = [];

  // Map from ExtractionScope level key → NodeKind
  const kindMap: ReadonlyArray<[keyof typeof scope.levels, NodeKind]> = [
    ['tables', 'table'],
    ['columns', 'column'],
    ['constraints', 'constraint'],
    ['indexes', 'index'],
    ['views', 'view'],
    ['procedures', 'procedure'],
    ['functions', 'function'],
    ['triggers', 'trigger'],
    ['sequences', 'sequence'],
    ['collections', 'collection'],
    ['fields', 'field'],
    // statistics and sampling don't map 1:1 to a NodeKind in the taxonomy —
    // they are off by default and there is no 'statistics' or 'sampling' NodeKind.
    // We omit them from the omitted list (they have no node kind to record against).
  ];

  for (const [levelKey, nodeKind] of kindMap) {
    if (scope.levels[levelKey] === 'off') {
      result.push({ kind: nodeKind, reason: REASON });
    }
  }

  // Deterministic sort by kind name (ADR-008)
  result.sort((a, b) => a.kind.localeCompare(b.kind));
  return result;
}

// Re-export stableStringify for consumers that need deterministic JSON (ADR-008)
export { stableStringify } from './id.js';
