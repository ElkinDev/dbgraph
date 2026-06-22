/**
 * Structural inference engine — emits scored `inferred_reference` edges
 * from column/field naming conventions and type compatibility.
 *
 * Design D1 (column→column endpoints) / D2 (PK via constraint nodes) /
 *        D4 (self-sort) / score formula with named constants.
 * ADR-004: imports only core model types + normalize/id.ts.
 * ADR-007: zero new npm dependencies.
 * ADR-008: deterministic (same input → same output).
 * dbgraph-security: reads ONLY node name/qname/payload.dataType/payload.columns/
 *   payload.type — never raw data values.
 * US-008
 */

import type { GraphNode, ConstraintPayload, ColumnPayload } from '../model/node.js';
import type { GraphEdge } from '../model/edge.js';
import { edgeId } from '../normalize/id.js';
import { extractEntity, candidateTargets } from './conventions.js';
import { compatible } from './type-compat.js';

// ─────────────────────────────────────────────────────────────────────────────
// Named constants (design §score formula, golden-pinned)
// ─────────────────────────────────────────────────────────────────────────────

/** Convention weight in the score formula (W_CONVENTION*conv). */
export const W_CONVENTION = 0.5;

/** Type-compatibility weight in the score formula (W_TYPE*typeCompat). */
export const W_TYPE = 0.3;

/** PK-target weight in the score formula (W_PK_TARGET*targetIsPk). */
export const W_PK_TARGET = 0.2;

/**
 * Minimum score for an edge to be emitted.
 * Candidates scoring below this threshold produce NO edge.
 */
export const THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface InferOptions {
  /** Override the minimum score threshold (default: THRESHOLD = 0.5). */
  readonly threshold?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal index types
// ─────────────────────────────────────────────────────────────────────────────

/** Lightweight record of a target column with its data type and PK status. */
interface TargetColumn {
  readonly colNode: GraphNode;
  readonly dataType: string;
  readonly isPk: boolean;
}

/**
 * Index of target tables/collections, keyed by lowercased local name.
 * Each entry maps to a list of columns in that table + their PK status.
 * Multiple tables may share the same local name in different schemas —
 * all are tried (producing multiple candidate edges; dedup via (src,dst,id)).
 */
type TargetIndex = Map<string, TargetColumn[]>;

// ─────────────────────────────────────────────────────────────────────────────
// PK indexing (D2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the parent table/collection qname from a constraint node's qname.
 * Convention: constraint qname = "<table_qname>.<constraint_name>".
 * Returns null when the qname has fewer than two dot-separated segments
 * (malformed or root-level — should not occur in practice).
 */
function parentQNameOf(constraintQName: string): string | null {
  const lastDot = constraintQName.lastIndexOf('.');
  if (lastDot <= 0) return null;
  return constraintQName.slice(0, lastDot);
}

/**
 * Builds a map from table qname → Set of PK column local names (lowercased).
 * Iterates all nodes once; only processes `constraint` nodes with type='PK'.
 */
function buildPkIndex(nodes: ReadonlyMap<string, GraphNode>): Map<string, Set<string>> {
  const pkIndex = new Map<string, Set<string>>();
  for (const node of nodes.values()) {
    if (node.kind !== 'constraint') continue;
    const payload = node.payload as Partial<ConstraintPayload>;
    if (payload.type !== 'PK') continue;
    const parentQName = parentQNameOf(node.qname);
    if (parentQName === null) continue;
    const cols = payload.columns;
    if (!Array.isArray(cols) || cols.length === 0) continue;
    let colSet = pkIndex.get(parentQName);
    if (colSet === undefined) {
      colSet = new Set<string>();
      pkIndex.set(parentQName, colSet);
    }
    for (const col of cols) {
      if (typeof col === 'string') {
        colSet.add(col.toLowerCase());
      }
    }
  }
  return pkIndex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Target index (table/collection name → columns)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the parent table qname for a column/field node.
 * Convention: column qname = "<table_qname>.<column_name>".
 * Returns null when the qname has fewer than two segments.
 */
function columnParentQName(colQName: string): string | null {
  const lastDot = colQName.lastIndexOf('.');
  if (lastDot <= 0) return null;
  return colQName.slice(0, lastDot);
}

/**
 * Builds the target index: lowercased table/collection name → list of columns.
 * PK status is determined from the pkIndex.
 * Only `column` and `field` nodes are indexed as targets (D1 — column grain).
 */
function buildTargetIndex(
  nodes: ReadonlyMap<string, GraphNode>,
  pkIndex: Map<string, Set<string>>,
): TargetIndex {
  const index: TargetIndex = new Map();

  for (const node of nodes.values()) {
    if (node.kind !== 'column' && node.kind !== 'field') continue;
    const payload = node.payload as Partial<ColumnPayload>;
    const dataType = typeof payload.dataType === 'string' ? payload.dataType : '';
    if (dataType === '') continue; // no type → cannot check compat

    const tableQName = columnParentQName(node.qname);
    if (tableQName === null) continue;

    // Look up PK columns for this table
    const pkCols = pkIndex.get(tableQName);
    const isPk = pkCols !== undefined && pkCols.has(node.name.toLowerCase());

    // Index by the local name of the PARENT table/collection.
    // The parent table node's `name` is the last segment of its qname.
    const tableLocalName = tableQName.includes('.')
      ? tableQName.slice(tableQName.lastIndexOf('.') + 1).toLowerCase()
      : tableQName.toLowerCase();

    let cols = index.get(tableLocalName);
    if (cols === undefined) {
      cols = [];
      index.set(tableLocalName, cols);
    }
    cols.push({ colNode: node, dataType, isPk });
  }

  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// existingEdges dedup (skip columns that already have a `references` edge)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the set of source column node IDs that already carry a declared
 * `references` edge (inferred/declared overlap prevention).
 */
function buildDedupSet(existingEdges: readonly GraphEdge[]): Set<string> {
  const dedup = new Set<string>();
  for (const edge of existingEdges) {
    if (edge.kind === 'references') {
      dedup.add(edge.src);
    }
  }
  return dedup;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-sort (D4)
// sort by: src ASC, dst ASC, score DESC, srcColumn ASC, id ASC
// ─────────────────────────────────────────────────────────────────────────────

function selfSort(edges: GraphEdge[]): GraphEdge[] {
  return edges.sort((a, b) => {
    const cmpSrc = a.src.localeCompare(b.src);
    if (cmpSrc !== 0) return cmpSrc;
    const cmpDst = a.dst.localeCompare(b.dst);
    if (cmpDst !== 0) return cmpDst;
    // score DESC (higher score first)
    const aScore = a.score ?? 0;
    const bScore = b.score ?? 0;
    if (bScore !== aScore) return bScore - aScore;
    const cmpCol = (a.attrs.srcColumn ?? '').localeCompare(b.attrs.srcColumn ?? '');
    if (cmpCol !== 0) return cmpCol;
    return a.id.localeCompare(b.id);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infers `inferred_reference` edges from column naming conventions and type
 * compatibility. Returns a self-sorted array (D4) of scored edges.
 *
 * @param nodes       The live NodeMap (from normalize or a test fixture).
 * @param existingEdges  Already-built edges — used to skip FK-linked columns (dedup).
 * @param options     Optional override for the score threshold.
 * @returns Deterministic array of `inferred_reference` GraphEdge objects.
 *
 * ADR-004: no adapter/driver/cli/mcp/child_process/I/O.
 * dbgraph-security: reads only node name/qname/payload.dataType/payload.columns/payload.type.
 */
export function inferReferences(
  nodes: ReadonlyMap<string, GraphNode>,
  existingEdges: readonly GraphEdge[],
  options?: InferOptions,
): GraphEdge[] {
  const threshold = options?.threshold ?? THRESHOLD;

  // ── One-pass indexing ───────────────────────────────────────────────────
  const pkIndex = buildPkIndex(nodes);
  const targetIndex = buildTargetIndex(nodes, pkIndex);
  const dedupSrcIds = buildDedupSet(existingEdges);

  // ── Match loop ──────────────────────────────────────────────────────────
  const emitted: GraphEdge[] = [];

  for (const srcNode of nodes.values()) {
    if (srcNode.kind !== 'column' && srcNode.kind !== 'field') continue;

    // Skip if already FK-linked (existingEdges dedup)
    if (dedupSrcIds.has(srcNode.id)) continue;

    const srcPayload = srcNode.payload as Partial<ColumnPayload>;
    const srcDataType = typeof srcPayload.dataType === 'string' ? srcPayload.dataType : '';
    if (srcDataType === '') continue;

    // Extract entity name from the column's local name
    const match = extractEntity(srcNode.name);
    if (match === null) continue;

    const { entity, conv } = match;

    // Resolve candidate target table names
    const candidates = candidateTargets(entity);

    for (const candidate of candidates) {
      const targetCols = targetIndex.get(candidate);
      if (targetCols === undefined) continue; // no real table with this name

      for (const target of targetCols) {
        // HARD REJECT: incompatible types (before scoring — D design note)
        if (!compatible(srcDataType, target.dataType)) continue;

        // Score
        const typeCompat = 1; // compatible() passed above
        const targetIsPk = target.isPk ? 1 : 0;
        const score =
          W_CONVENTION * conv + W_TYPE * typeCompat + W_PK_TARGET * targetIsPk;

        // Below threshold → no edge
        if (score < threshold) continue;

        // Emit inferred_reference edge (D1: column→column)
        const srcId = srcNode.id;
        const dstId = target.colNode.id;
        const srcColumn = srcNode.name;
        const dstColumn = target.colNode.name;
        const discriminator = `${srcColumn}>${dstColumn}`;

        const edge: GraphEdge = {
          id: edgeId('inferred_reference', srcId, dstId, discriminator),
          kind: 'inferred_reference',
          src: srcId,
          dst: dstId,
          confidence: 'inferred',
          score,
          attrs: { srcColumn, dstColumn },
        };

        emitted.push(edge);
      }
    }
  }

  // ── Self-sort (D4) ──────────────────────────────────────────────────────
  return selfSort(emitted);
}
