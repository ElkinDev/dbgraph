/**
 * Truthful CapabilityMatrix for SQLite.
 * Design §3 "CapabilityMatrix (truthful SQLite)".
 * SQLite supports: schema, table, column, constraint, index, view, trigger.
 * SQLite does NOT support: procedure, function, sequence, collection, field,
 *   statistics, sampling (these concepts do not exist in SQLite).
 * supportsBodies: true  — view + trigger SQL available from sqlite_master.
 * supportsDependencyHints: false — declared blindness (US-007); body parsing deferred.
 */

import { DEFAULT_LEVELS } from '../../../core/model/capability.js';
import type { CapabilityMatrix } from '../../../core/model/capability.js';

export const SQLITE_CAPABILITIES: CapabilityMatrix = {
  engine: 'sqlite',
  supported: new Set([
    'schema',
    'table',
    'column',
    'constraint',
    'index',
    'view',
    'trigger',
  ] as const),
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: true,
  supportsDependencyHints: false,
} as const;
