/**
 * Conservative body tokenizer for SQL Server module dependencies.
 * Design §tokenizer "Conservative body tokenizer, never a T-SQL grammar (ADR-007)".
 *
 * Classifies a dependency edge target as:
 *   write — if the bracket-normalized canonicalQName appears as the write-verb operand.
 *   read  — otherwise (SELECT, FROM, JOIN, etc.).
 *
 * Sets hasDynamicSql: true if EXEC or sp_executesql appears anywhere in the body.
 * Case-insensitive throughout.
 *
 * Deliberately NOT attempted: control flow, variable/temp-table resolution,
 * synonym expansion, cross-database refs, CTE write-back, dynamic-SQL content
 * parsing — those produce hasDynamicSql: true (declared blindness).
 *
 * US-007 (reads_from / writes_to classification, dynamic SQL flagged not guessed).
 * ADR-007 (no T-SQL grammar; conservative classification + honest dynamic-SQL flag).
 *
 * The three engine-agnostic primitives (canonicalizeQName, classifyAccess,
 * extractWriteTargets) and WRITE_VERB_PATTERNS are now defined in _shared/tokenizer-core.ts
 * and re-exported here for backwards compatibility with existing callers.
 */

import type { RawDependency } from '../../../core/model/catalog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Re-export shared primitives — public surface preserved for existing callers
// ─────────────────────────────────────────────────────────────────────────────

export {
  canonicalizeQName,
  WRITE_VERB_PATTERNS,
  extractWriteTargets,
  classifyAccess,
} from '../_shared/tokenizer-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// Local import for internal use within this module
// ─────────────────────────────────────────────────────────────────────────────

import { canonicalizeQName, classifyAccess } from '../_shared/tokenizer-core.js';

// ─────────────────────────────────────────────────────────────────────────────
// hasDynamicSql — EXEC / sp_executesql presence (MSSQL-specific)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the body contains EXEC or sp_executesql (case-insensitive).
 * Presence indicates dynamic SQL that the conservative tokenizer cannot analyze.
 * US-007: declared blindness — flag and stop, never guess.
 *
 * MSSQL-specific: PG uses a different dynamic-SQL marker (bare EXECUTE statement
 * vs EXECUTE FUNCTION trigger clause).
 */
export function hasDynamicSql(body: string): boolean {
  return /\b(exec|sp_executesql)\b/i.test(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeModuleDeps — full dependency resolution
// ─────────────────────────────────────────────────────────────────────────────

interface DepRef {
  ref_schema_name: string | null;
  ref_object_name: string | null;
  // sys.objects.type (CHAR(2)) of the referenced object (DOG-1 / D2). Trailing-padded
  // (`'P '`, `'FN'`, `'U '`); the routine gate trims. Undefined/null for legacy callers and
  // NULL-referenced_id rows → never a routine → the existing `parsed` classification stands.
  ref_object_type?: string | null;
}

/** Options for tokenizeModuleDeps (DOG-1). */
interface TokenizeOptions {
  // True only when the REFERENCING module is itself a routine (procedure/function). A `calls`
  // edge is strictly routine→routine, so a routine-typed ref from a view/trigger stays `parsed`.
  readonly sourceIsRoutine?: boolean;
}

interface TokenizerResult {
  readonly hasDynamicSql: boolean;
  readonly dependencies: readonly RawDependency[];
}

/**
 * Maps a referenced object's sys.objects.type (CHAR(2), possibly padded) to the ROUTINE
 * NodeKind it denotes, or null for any non-routine type (tables `U`, views `V`, triggers `TR`,
 * unresolved). A routine-only subset of map.ts `moduleTypeToKind`, co-located here with the
 * `target.kind` assignment to avoid a map↔tokenizer import cycle.
 */
function refTypeToRoutineKind(type: string | null | undefined): 'procedure' | 'function' | null {
  if (type === null || type === undefined) return null;
  switch (type.trim()) {
    case 'P':
      return 'procedure';
    case 'FN':
    case 'IF':
    case 'TF':
      return 'function';
    default:
      return null;
  }
}

/**
 * Combines sys.sql_expression_dependencies rows with the module body tokenizer
 * to produce classified RawDependency edges.
 *
 * - Skips rows with null ref_schema_name / ref_object_name (unresolved cross-db refs).
 * - Sets hasDynamicSql: true if EXEC/sp_executesql is present in the body.
 * - Classifies each resolved dep as 'read' or 'write' via classifyAccess().
 * - All edges carry confidence: 'parsed'.
 *
 * US-007: null refs are skipped honestly (no speculative edges invented).
 */
export function tokenizeModuleDeps(
  body: string,
  deps: readonly DepRef[],
  opts: TokenizeOptions = {},
): TokenizerResult {
  const dynamic = hasDynamicSql(body);
  const sourceIsRoutine = opts.sourceIsRoutine ?? false;

  const dependencies: RawDependency[] = [];

  for (const dep of deps) {
    // Skip unresolved refs (cross-database, unresolvable, or missing)
    if (dep.ref_schema_name === null || dep.ref_object_name === null) {
      continue;
    }

    // DOG-1 (D2/D3): a routine→routine invocation is a catalog-DECLARED `calls` edge. Set
    // target.kind + confidence:'declared' ONLY when the referenced object is a routine AND the
    // referencing module is itself a routine. A call has no access dimension → 'read' placeholder.
    const routineKind = sourceIsRoutine ? refTypeToRoutineKind(dep.ref_object_type) : null;
    if (routineKind !== null) {
      dependencies.push({
        target: { schema: dep.ref_schema_name, name: dep.ref_object_name, kind: routineKind },
        access: 'read',
        confidence: 'declared',
      });
      continue;
    }

    const canonicalTarget = canonicalizeQName(
      `${dep.ref_schema_name}.${dep.ref_object_name}`,
    );
    const access = classifyAccess(canonicalTarget, body);

    dependencies.push({
      target: {
        schema: dep.ref_schema_name,
        name: dep.ref_object_name,
      },
      access,
      confidence: 'parsed',
    });
  }

  return { hasDynamicSql: dynamic, dependencies };
}
