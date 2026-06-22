/**
 * Node kinds, graph nodes, indexing levels, and per-type level configuration.
 * Design §4.1 — engine-agnostic domain types.
 */

export type NodeKind =
  | 'database'
  | 'schema'
  | 'table'
  | 'column'
  | 'constraint'   // PK / FK / UNIQUE / CHECK (subtype in payload)
  | 'index'
  | 'view'
  | 'procedure'
  | 'function'
  | 'trigger'
  | 'sequence'
  | 'collection'   // MongoDB
  | 'field';       // MongoDB sampled field

/** Runtime-accessible tuple of all NodeKind values (used for validation and tests). */
export const NODE_KINDS: readonly NodeKind[] = [
  'database',
  'schema',
  'table',
  'column',
  'constraint',
  'index',
  'view',
  'procedure',
  'function',
  'trigger',
  'sequence',
  'collection',
  'field',
] as const;

export type IndexLevel = 'off' | 'metadata' | 'full';

/** Runtime-accessible tuple of all IndexLevel values. */
export const INDEX_LEVELS: readonly IndexLevel[] = ['off', 'metadata', 'full'] as const;

/**
 * Per-object-type level configuration.
 * ADR-003 defaults: triggers full; procedures/functions metadata; statistics/sampling off.
 */
export interface ObjectTypeLevels {
  tables: IndexLevel;
  columns: IndexLevel;
  constraints: IndexLevel;
  indexes: IndexLevel;
  views: IndexLevel;
  procedures: IndexLevel;
  functions: IndexLevel;
  triggers: IndexLevel;
  sequences: IndexLevel;
  collections: IndexLevel;
  fields: IndexLevel;
  statistics: IndexLevel;   // off by default (ADR-003)
  sampling: IndexLevel;     // off by default (ADR-003)
}

/**
 * Opaque per-kind JSON payload. Adapters may add engine-specific keys.
 * Typed accessor views (TablePayload, etc.) provide compile-time ergonomics.
 */
export type NodePayload = Readonly<Record<string, unknown>>;

// Typed accessor views — compile-time ergonomics over the JSON (design §4.4).
// These are the contract engines must honor; extra keys are tolerated.
export interface TablePayload {
  rowCountEstimate?: number;
  comment?: string;
}

export interface ColumnPayload {
  dataType: string;
  nullable: boolean;
  default?: string | null;
  ordinal: number;
  comment?: string;
}

export interface ConstraintPayload {
  type: 'PK' | 'FK' | 'UNIQUE' | 'CHECK';
  definition?: string;
  columns: readonly string[];
}

export interface IndexPayload {
  unique: boolean;
  columns: readonly string[];
  method?: string;
}

export interface RoutinePayload {
  signature?: string;
  returns?: string;
  body?: string;             // present only when level='full'
  hasDynamicSql: boolean;   // US-007 / US-014 propagation
  comment?: string;
}

export interface TriggerPayload {
  timing?: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  events: readonly ('INSERT' | 'UPDATE' | 'DELETE')[];
  body?: string;
  hasDynamicSql: boolean;
  comment?: string;
}

/**
 * Accessor view for a 'field' node (MongoDB sampled field).
 * Mirrors ColumnPayload structurally so inferReferences (which reads payload.dataType
 * as a string) consumes a 'field' node identically to a 'column' node (Design §D1).
 * dataType is a union string like 'int|string' (sorted) — NOT a types[] array.
 */
export interface FieldPayload {
  dataType: string;      // union form 'int|string' (sorted) — readable by inferReferences
  frequency: number;     // presence ratio 0.0–1.0 across sampled documents
  nullable?: boolean;
}

export interface GraphNode {
  readonly id: string;            // deterministic (design §3.4)
  readonly kind: NodeKind;
  readonly schema: string | null; // namespace; null for roots / engine-less kinds
  readonly name: string;          // local name
  readonly qname: string;         // canonical fully-qualified name
  readonly level: IndexLevel;     // level applied to THIS node
  readonly missing: boolean;      // stub for absent referenced object
  readonly excluded: boolean;     // stub for filtered-out object (US-004)
  readonly bodyHash: string | null;
  readonly payload: NodePayload;  // kind-specific structured fields
}
