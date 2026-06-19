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
} as const;
