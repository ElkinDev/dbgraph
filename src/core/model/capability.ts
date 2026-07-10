/**
 * CapabilityMatrix, ExtractionScope, and DEFAULT_LEVELS.
 * Design §4.3 — what an engine supports and the normalizer's second argument.
 * No adapter, driver, mcp, or cli imports (ADR-004).
 */

import type { NodeKind, ObjectTypeLevels } from './node.js';

export interface CapabilityMatrix {
  readonly engine: string;                  // 'mssql' | 'pg' | 'mysql' | 'mongodb' | 'sqlite' | …
  readonly supported: ReadonlySet<NodeKind>; // object types this engine can produce
  readonly defaultLevels: ObjectTypeLevels;  // ADR-003 defaults specialized per engine
  readonly supportsBodies: boolean;          // can it return proc/trigger source?
  readonly supportsDependencyHints: boolean; // can it report read/write deps cheaply?
  // DOG-3 (design D4): does this engine expose a VIEW-COLUMN catalog that can source the SET of
  // source columns a view consumes (→ `attrs.dstColumns` at `confidence: 'declared'`)? An
  // IMPLEMENTATION-DETAIL capability flag that documents WHY an engine can or cannot carry
  // column-grain view lineage — it is NEVER a per-edge coverage oracle (consumers read coverage
  // from the EDGE's `attrs.dstColumns` present-or-absent, not from this flag). OPTIONAL: an engine
  // that never supports it (e.g. mongodb — no views) leaves it UNSET rather than fabricating false.
  readonly supportsColumnLineage?: boolean;
}

export interface ExtractionScope {
  readonly levels: ObjectTypeLevels;        // effective (config-resolved) levels
  readonly include?: readonly string[];     // glob patterns (Phase 4 applies; model honors stubs)
  readonly exclude?: readonly string[];
  /**
   * Opt-in gate for structural inference (US-008).
   * When `true`, the normalizer calls `inferReferences` after step 4c.
   * When absent or `false` (the default), inference is skipped and the normalizer
   * output is byte-identical to pre-Phase-9a behavior (the four shipped SQL engines
   * stay unaffected). Design D3.
   */
  readonly inferRelationships?: boolean;
}

/**
 * ADR-003 / US-003 conservative default levels.
 * Spec "Default level resolution" scenario:
 *   triggers → full; procedures/functions → metadata; statistics/sampling → off;
 *   structural core (tables/columns/constraints/indexes/views) → full.
 *
 * Config-phase (Phase 4) may override these via CapabilityMatrix.defaultLevels.
 * These defaults are the model-layer baseline — they exist here so tests can assert them
 * directly without depending on the config phase (W-2 remediation).
 */
export const DEFAULT_LEVELS: Readonly<ObjectTypeLevels> = {
  tables: 'full',
  columns: 'full',
  constraints: 'full',
  indexes: 'full',
  views: 'full',
  procedures: 'metadata',
  functions: 'metadata',
  triggers: 'full',
  sequences: 'metadata',
  collections: 'metadata',
  fields: 'metadata',
  statistics: 'off',
  sampling: 'off',
} as const;
