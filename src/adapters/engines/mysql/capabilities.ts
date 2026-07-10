/**
 * Truthful CapabilityMatrix for MySQL.
 * Design §MYSQL_CAPABILITIES.
 *
 * MySQL supports: table, column, constraint, index, view,
 *   procedure, function, trigger.
 * MySQL does NOT support: sequence (AUTO_INCREMENT is a per-table column
 *   property, not a first-class sequence object — MYSQL_CAPABILITIES omits
 *   'sequence'; golden asserts ZERO sequence objects).
 * MySQL does NOT expose a standalone schema kind: the connected database IS
 *   the namespace (schema == database), surfaced via RawCatalog.schemas.
 *
 * supportsBodies: true  — VIEW_DEFINITION + ROUTINE_DEFINITION provide bodies.
 * supportsDependencyHints: false — MySQL has no information_schema dependency
 *   view (no pg_depend / sys.sql_expression_dependencies equivalent).
 *   The body tokenizer is the SOLE edge source.
 * supportsColumnLineage: false — MySQL exposes NO view-column catalog (no
 *   VIEW_COLUMN_USAGE, no dependency view). View depends_on edges stay object
 *   grain; the tokenizer is NEVER extended to mint a column from the body text
 *   (ADR-007). Degradation is expressed by ABSENCE of attrs.dstColumns — no
 *   per-edge marker (DOG-3 design D4).
 *
 * US-029 (MySQL adapter, Phase 8b), E5 common criterion (truthful matrix).
 */

import { DEFAULT_LEVELS } from '../../../core/model/capability.js';
import type { CapabilityMatrix } from '../../../core/model/capability.js';

export const MYSQL_CAPABILITIES: CapabilityMatrix = {
  engine: 'mysql',
  supported: new Set([
    'table',
    'column',
    'constraint',
    'index',
    'view',
    'procedure',
    'function',
    'trigger',
  ] as const),
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: true,
  supportsDependencyHints: false,
  supportsColumnLineage: false,
} as const;
