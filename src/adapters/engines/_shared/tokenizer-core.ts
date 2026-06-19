/**
 * Engine-agnostic tokenizer primitives — shared by all SQL engine adapters.
 * Design §"_shared/tokenizer-core.ts" (US-028a).
 *
 * PURE functions — no driver imports, no core-outward imports.
 * Dialect-specific bits (hasDynamicSql, dialect quoting) are injected per engine
 * via the `canon` parameter of classifyAccess.
 *
 * Hexagonal ADR-004: this module imports nothing from core/ and nothing from any
 * engine-specific adapter. Engine adapters import from here, never the reverse.
 *
 * Functions exported:
 *   - canonicalizeQName   : strips bracket/double-quote delimiters, lowercases
 *   - WRITE_VERB_PATTERNS : write-verb regex array (exported for engine-level re-use)
 *   - extractWriteTargets : returns the set of write-verb operands in a normalized body
 *   - classifyAccess      : classifies a dep as 'read' | 'write'; canon is injectable
 *
 * ADR-007 (no grammar parsing — conservative tokenizer).
 * ADR-008 (determinism — regex-only, no external state).
 */

// ─────────────────────────────────────────────────────────────────────────────
// canonicalizeQName — bracket/quote stripping + lowercase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips bracket delimiters `[...]` and double-quote delimiters `"..."` from a
 * qualified name and lowercases the result.
 *
 * Handles both MSSQL-style `[schema].[name]` and ANSI/PG-style `"schema"."name"`.
 *
 * Examples:
 *   [dbo].[orders]  → dbo.orders
 *   "dbo"."orders"  → dbo.orders
 *   [DBO].Orders    → dbo.orders
 *   orders          → orders
 */
export function canonicalizeQName(rawName: string): string {
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
 *
 * NOTE: these are REGEX LITERALS — they are not SQL string literals and are
 * intentionally not scanned by the write-verb security scanner (US-031).
 */
export const WRITE_VERB_PATTERNS: RegExp[] = [
  /\binsert\s+into\s+([\w.]+)/gi,
  /\bupdate\s+([\w.]+)/gi,
  /\bdelete\s+from\s+([\w.]+)/gi,
  /\bmerge\s+into\s+([\w.]+)/gi,
  /\bmerge\s+([\w.]+)/gi,
  /\btruncate\s+table\s+([\w.]+)/gi,
];

// ─────────────────────────────────────────────────────────────────────────────
// extractWriteTargets — write-verb operand set
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the set of canonicalized qnames that appear as write-verb operands
 * in the given (already bracket-stripped + lowercased) body.
 *
 * The body MUST be pre-normalized via the engine's canonicalizer before calling
 * this function so that operand strings match what was extracted from dep rows.
 */
export function extractWriteTargets(normalizedBody: string): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const pattern of WRITE_VERB_PATTERNS) {
    pattern.lastIndex = 0; // reset stateful global regex
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(normalizedBody)) !== null) {
      if (m[1] !== undefined) {
        // m[1] is already lowercased because normalizedBody is lowercased;
        // brackets were already stripped at normalization time.
        targets.add(m[1]);
      }
    }
  }
  return targets;
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyAccess — per-target read/write classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the access mode for a single dependency target given a module body.
 *
 * The `canon` parameter is the dialect-specific canonicalizer:
 *   - MSSQL: canonicalizeQName (strips both brackets AND double-quotes, lowercases)
 *   - PG: a double-quote-only variant (no brackets)
 * Defaults to `canonicalizeQName` so existing MSSQL callers are unchanged.
 *
 * @param targetQName  Canonical qualified name of the target (e.g. 'dbo.orders').
 *                     Will be canonicalized internally via `canon`.
 * @param body         The module body (raw, un-normalized).
 * @param canon        Dialect-specific canonicalizer. Defaults to canonicalizeQName.
 * @returns 'write' if the target appears as a write-verb operand; 'read' otherwise.
 */
export function classifyAccess(
  targetQName: string,
  body: string,
  canon: (s: string) => string = canonicalizeQName,
): 'read' | 'write' {
  // Normalize body using the dialect canonicalizer so regex matching is uniform
  const normalizedBody = canon(body);
  const writeTargets = extractWriteTargets(normalizedBody);

  // Check both fully-qualified (schema.name) and simple-name matches
  // to handle bodies that reference objects without schema prefix.
  const canonicalTarget = canon(targetQName);
  const simpleName = canonicalTarget.includes('.')
    ? canonicalTarget.split('.').slice(1).join('.')
    : canonicalTarget;

  if (writeTargets.has(canonicalTarget) || writeTargets.has(simpleName)) {
    return 'write';
  }
  return 'read';
}
