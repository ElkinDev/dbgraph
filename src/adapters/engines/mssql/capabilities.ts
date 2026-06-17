/**
 * Truthful CapabilityMatrix for Microsoft SQL Server.
 * Design §CapabilityMatrix "CapabilityMatrix (truthful SQL Server)".
 *
 * SQL Server supports: schema, table, column, constraint, index, view,
 *   procedure, function, trigger, sequence.
 * SQL Server does NOT support: collection, field (MongoDB-only concepts).
 *
 * supportsBodies: true  — sys.sql_modules.definition provides bodies
 *   for views, procedures, functions, triggers (level-gated).
 * supportsDependencyHints: true — sys.sql_expression_dependencies feeds the
 *   conservative body tokenizer to classify read/write edges (US-007, ADR-007).
 *
 * US-027 (SQL Server adapter), E5 common criterion (truthful matrix).
 */

import { DEFAULT_LEVELS } from '../../../core/model/capability.js';
import type { CapabilityMatrix } from '../../../core/model/capability.js';

export const MSSQL_CAPABILITIES: CapabilityMatrix = {
  engine: 'mssql',
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
  supportsDependencyHints: true,
} as const;
