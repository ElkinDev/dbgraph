/**
 * Edge kinds, confidence classification, edge attributes, and graph edges.
 * Design §4.2 — engine-agnostic domain types.
 */

export type EdgeKind =
  | 'references'          // FK column→column AND aggregated table→table (attrs.aggregate=true)
  | 'depends_on'          // view/proc depends on object (e.g. view → table)
  | 'calls'               // routine → routine INVOCATION (EXEC/CALL/SELECT fn()); confidence declared(mssql)/parsed(pg,mysql) (US-007)
  | 'reads_from'          // proc/trigger/view READS a table/column (US-007)
  | 'writes_to'           // proc/trigger WRITES a table/column (US-007)
  | 'fires_on'            // trigger → table, attrs.event = INSERT|UPDATE|DELETE
  | 'has_column'          // table/view → column (containment)
  | 'has_index'           // table → index
  | 'has_constraint'      // table → constraint
  | 'in_index'            // index → column (membership, ordered)
  | 'inferred_reference'; // TYPE ONLY in Phase 1; populated by Phase 9 (US-008)

/** Runtime-accessible tuple of all EdgeKind values. */
export const EDGE_KINDS: readonly EdgeKind[] = [
  'references',
  'depends_on',
  'calls',
  'reads_from',
  'writes_to',
  'fires_on',
  'has_column',
  'has_index',
  'has_constraint',
  'in_index',
  'inferred_reference',
] as const;

export type EdgeConfidence = 'declared' | 'parsed' | 'inferred';

/** Runtime-accessible tuple of all EdgeConfidence values. */
export const EDGE_CONFIDENCE_VALUES: readonly EdgeConfidence[] = [
  'declared',
  'parsed',
  'inferred',
] as const;

export interface EdgeAttrs {
  readonly srcColumn?: string;       // references / reads_from / writes_to at column grain
  readonly dstColumn?: string;       // references target column
  readonly event?: 'INSERT' | 'UPDATE' | 'DELETE';  // fires_on
  readonly aggregate?: boolean;      // true on the single table→table references edge
  readonly ordinal?: number;         // in_index / has_column ordering
  readonly constraintName?: string;  // groups the per-column edges of one composite FK
  // DOG-3 (Model A / design D1,D2): the sorted-unique SET of SOURCE-table columns a view
  // CONSUMES, carried on the EXISTING view→source-table `depends_on` edge. A SOURCE-column
  // SET only — the columns the view READS — NEVER an output↔source MAPPING (ADR-006/007).
  // OPTIONAL and honest: OMITTED (unset) ≠ `[]` — a dependency the catalog does not source at
  // column grain leaves this ABSENT → the edge is byte-identical to the pre-DOG-3 object grain.
  // Sorted CODE-POINT ASCENDING and deduplicated by the normalizer (ADR-008) — the singular
  // `srcColumn`/`dstColumn` above stay `references`-scoped and untouched.
  readonly dstColumns?: readonly string[];
}

export interface GraphEdge {
  readonly id: string;             // deterministic (design §3.4)
  readonly kind: EdgeKind;
  readonly src: string;            // node id
  readonly dst: string;            // node id
  readonly confidence: EdgeConfidence;
  readonly score: number | null;   // only when confidence='inferred'
  readonly attrs: EdgeAttrs;       // join columns, event, aggregate flag, ordinal…
}
