/**
 * Truthful CapabilityMatrix for PostgreSQL.
 * Design §CapabilityMatrix "Truthful PostgreSQL CapabilityMatrix".
 *
 * PG supports: schema, table, column, constraint, index, view,
 *   procedure, function, trigger, sequence.
 * PG does NOT support: collection, field (MongoDB-only concepts).
 *
 * supportsBodies: true  — pg_get_functiondef/pg_get_viewdef provide bodies
 *   for views, procedures, functions, triggers (level-gated).
 * supportsDependencyHints: false — Phase-8a derives edges from bodies ONLY
 *   (no pg_depend OID-graph edge list; body tokenizer is the SOLE edge source).
 *   pg_depend/pg_rewrite OID-graph mapping is recorded as a future enhancement.
 *   DOG-3: `information_schema.view_column_usage` is a DISTINCT, view-scoped column
 *   catalog — NOT a body dep-hint catalog — so this flag STAYS false even though
 *   supportsColumnLineage is now true (they answer different questions).
 * supportsColumnLineage: true — `information_schema.view_column_usage` sources the SET of
 *   source columns a REGULAR view consumes → attrs.dstColumns at confidence:'declared',
 *   merged onto the tokenizer-derived depends_on dep (parsed→declared flip, DOG-3 D5).
 *
 *   OWNER CAVEAT: the catalog surfaces only sources the VIEW OWNER also owns, and it does
 *   NOT cover MATERIALIZED views — either gap degrades the pair to the tokenizer's
 *   `parsed` object grain with NO `dstColumns` (degrade-by-absence, D4), never fabricated.
 *   This flag is an IMPLEMENTATION DETAIL that documents WHY the engine CAN carry
 *   column-grain view lineage; it is NEVER a per-edge coverage oracle — a covered edge
 *   (declared, with dstColumns) legitimately COEXISTS with an uncovered edge (parsed,
 *   without) on the SAME pg graph. Consumers read coverage from the EDGE's
 *   attrs.dstColumns present-or-absent, not from this flag (reconciler decision a).
 *
 * US-028 (PostgreSQL adapter), US-028b (matview without model change),
 * E5 common criterion (truthful matrix).
 */

import { DEFAULT_LEVELS } from '../../../core/model/capability.js';
import type { CapabilityMatrix } from '../../../core/model/capability.js';

export const PG_CAPABILITIES: CapabilityMatrix = {
  engine: 'pg',
  supported: new Set([
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
  ] as const),
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: true,
  supportsDependencyHints: false,
  supportsColumnLineage: true,
} as const;
