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
 */

import type { RawDependency } from '../../../core/model/catalog.js';

// ─────────────────────────────────────────────────────────────────────────────
// canonicalizeQName — bracket/quote stripping + lowercase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips bracket delimiters `[...]` and double-quote delimiters `"..."` from a
 * qualified name and lowercases the result.
 *
 * Examples:
 *   [dbo].[orders]  → dbo.orders
 *   "dbo"."orders"  → dbo.orders
 *   [DBO].Orders    → dbo.orders
 *   orders          → orders
 */
export function canonicalizeQName(rawName: string): string {
  // Remove bracket pairs and double-quote pairs around each segment
  return rawName
    .replace(/\[([^\]]*)\]/g, '$1')   // [schema] → schema
    .replace(/"([^"]*)"/g, '$1')       // "schema" → schema
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Write-verb patterns (with capturing group for the operand position)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regex patterns that identify write-verb operands.
 * Each pattern captures the target table qualified name IMMEDIATELY AFTER the verb.
 * Operates on a normalized (lowercased, bracket-stripped) body.
 *
 * Write-verb operand patterns:
 *   - INSERT INTO followed by target
 *   - UPDATE followed by target
 *   - DELETE FROM followed by target
 *   - MERGE INTO followed by target (with and without INTO)
 *   - TRUNCATE TABLE followed by target
 */
const WRITE_VERB_PATTERNS: RegExp[] = [
  /\binsert\s+into\s+([\w.]+)/gi,
  /\bupdate\s+([\w.]+)/gi,
  /\bdelete\s+from\s+([\w.]+)/gi,
  /\bmerge\s+into\s+([\w.]+)/gi,
  /\bmerge\s+([\w.]+)/gi,
  /\btruncate\s+table\s+([\w.]+)/gi,
];

/**
 * Extracts the set of canonicalized qnames that appear as write-verb operands
 * in the given (already bracket-stripped + lowercased) body.
 */
function extractWriteTargets(normalizedBody: string): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const pattern of WRITE_VERB_PATTERNS) {
    pattern.lastIndex = 0; // reset stateful global regex
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(normalizedBody)) !== null) {
      if (m[1] !== undefined) {
        // m[1] is already lowercased because normalizedBody is lowercased;
        // but brackets were already stripped at normalization time.
        targets.add(m[1]);
      }
    }
  }
  return targets;
}

// ─────────────────────────────────────────────────────────────────────────────
// hasDynamicSql — EXEC / sp_executesql presence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the body contains EXEC or sp_executesql (case-insensitive).
 * Presence indicates dynamic SQL that the conservative tokenizer cannot analyze.
 * US-007: declared blindness — flag and stop, never guess.
 */
export function hasDynamicSql(body: string): boolean {
  return /\b(exec|sp_executesql)\b/i.test(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyAccess — per-target read/write classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the access mode for a single dependency target given a module body.
 *
 * @param targetQName  Canonical qualified name of the target (e.g. 'dbo.orders').
 *                     Must already be canonicalized via canonicalizeQName().
 * @param body         The module body (sys.sql_modules.definition).
 * @returns 'write' if the target appears as a write-verb operand; 'read' otherwise.
 */
export function classifyAccess(targetQName: string, body: string): 'read' | 'write' {
  // Normalize body: strip brackets and lowercase so regex matching is uniform
  const normalizedBody = canonicalizeQName(body);
  const writeTargets = extractWriteTargets(normalizedBody);

  // Check both fully-qualified (schema.name) and simple-name matches
  // to handle bodies that reference objects without schema prefix.
  const canonicalTarget = canonicalizeQName(targetQName);
  const simpleName = canonicalTarget.includes('.')
    ? canonicalTarget.split('.').slice(1).join('.')
    : canonicalTarget;

  if (writeTargets.has(canonicalTarget) || writeTargets.has(simpleName)) {
    return 'write';
  }
  return 'read';
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeModuleDeps — full dependency resolution
// ─────────────────────────────────────────────────────────────────────────────

interface DepRef {
  ref_schema_name: string | null;
  ref_object_name: string | null;
}

interface TokenizerResult {
  readonly hasDynamicSql: boolean;
  readonly dependencies: readonly RawDependency[];
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
export function tokenizeModuleDeps(body: string, deps: readonly DepRef[]): TokenizerResult {
  const dynamic = hasDynamicSql(body);

  const dependencies: RawDependency[] = [];

  for (const dep of deps) {
    // Skip unresolved refs (cross-database, unresolvable, or missing)
    if (dep.ref_schema_name === null || dep.ref_object_name === null) {
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
