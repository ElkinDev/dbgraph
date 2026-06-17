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
}

export interface ExtractionScope {
  readonly levels: ObjectTypeLevels;        // effective (config-resolved) levels
  readonly include?: readonly string[];     // glob patterns (Phase 4 applies; model honors stubs)
  readonly exclude?: readonly string[];
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
