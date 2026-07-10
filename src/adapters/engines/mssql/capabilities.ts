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
 * supportsColumnLineage: true — the engine exposes a view-column catalog
 *   (sys.dm_sql_referenced_entities) that sources the SET of source columns a view
 *   consumes → attrs.dstColumns at confidence:'declared' (DOG-3, US-007/US-027).
 *
 *   NATIVE-DRIVER ONLY (design D8): the per-object TVF is called in a JS-side per-view
 *   loop on the native tedious/mssql driver. The sqlcmd/manual-dump strategies carry NO
 *   view-columns family (the fixed single-SELECT-per-family dump contract, DOG-2), so
 *   extraction via sqlcmd/manual-dump yields OBJECT GRAIN — the project's FIRST
 *   strategy-dependent coverage difference. This flag is an IMPLEMENTATION DETAIL that
 *   documents WHY the engine CAN carry column-grain view lineage; it is NEVER a per-edge
 *   coverage oracle — consumers read coverage from the EDGE's attrs.dstColumns
 *   present-or-absent, not from this flag (reconciler decision a).
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
  supportsColumnLineage: true,
} as const;
