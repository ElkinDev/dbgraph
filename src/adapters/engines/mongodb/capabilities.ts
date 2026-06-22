/**
 * Truthful CapabilityMatrix for MongoDB.
 * Design §MONGODB_CAPABILITIES.
 *
 * MongoDB supports: collection, field, index ONLY.
 * MongoDB does NOT support: table, column, constraint, view, procedure,
 *   function, trigger, sequence (SQL-only concepts irrelevant to MongoDB).
 *
 * supportsBodies: false  — MongoDB has no procedure or view body to retrieve.
 * supportsDependencyHints: false — the body tokenizer is the SOLE edge source.
 *   (MongoDB has no analog to pg_depend or sys.sql_expression_dependencies.)
 *
 * US-030 (MongoDB adapter, Phase 9b), E5 common criterion (truthful matrix).
 */

import { DEFAULT_LEVELS } from '../../../core/model/capability.js';
import type { CapabilityMatrix } from '../../../core/model/capability.js';

export const MONGODB_CAPABILITIES: CapabilityMatrix = {
  engine: 'mongodb',
  supported: new Set([
    'collection',
    'field',
    'index',
  ] as const),
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: false,
  supportsDependencyHints: false,
} as const;
