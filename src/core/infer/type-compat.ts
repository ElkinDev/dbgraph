/**
 * Type-family classification and compatibility check.
 * Design D-T — type-compat table.
 * Pure string functions; ZERO imports (no core model types needed).
 * ADR-004: no adapter/driver/cli/mcp/child_process/I/O.
 * ADR-007: zero new dependencies.
 * ADR-008: deterministic (same input → same output).
 * US-008
 */

// ─────────────────────────────────────────────────────────────────────────────
// Family table (case-folded input → family token)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a lowercased data type token to its canonical family string.
 * Returns `undefined` when the token is not in any known family,
 * which causes `typeFamily` to fall back to the token itself.
 */
const FAMILY_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  // int family
  ['int', 'int'],
  ['integer', 'int'],
  ['bigint', 'int'],
  ['smallint', 'int'],
  ['serial', 'int'],
  ['bigserial', 'int'],
  // oid family (MongoDB ObjectId + the canonical _id field name)
  ['objectid', 'oid'],
  ['_id', 'oid'],
  // uuid family
  ['uuid', 'uuid'],
  // str family
  ['varchar', 'str'],
  ['text', 'str'],
  ['char', 'str'],
  ['nvarchar', 'str'],
  ['string', 'str'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical type family for a data type string.
 * Input is case-folded before lookup.
 * Unknown types return their own lowercased token — never silently mapped to
 * a known family. This ensures that e.g. 'float' does not accidentally
 * become 'int', which would allow incorrect cross-family matches.
 *
 * @example
 *   typeFamily('INT')      // → 'int'
 *   typeFamily('bigint')   // → 'int'
 *   typeFamily('ObjectId') // → 'oid'
 *   typeFamily('money')    // → 'money'  (own token)
 */
export function typeFamily(dataType: string): string {
  const token = dataType.toLowerCase();
  return FAMILY_MAP.get(token) ?? token;
}

/**
 * Returns `true` when types `a` and `b` belong to the same type family.
 * This is the hard-reject gate for the inference engine:
 * type mismatch → incompatible → no edge emitted (not a score penalty).
 *
 * @example
 *   compatible('int', 'bigint')    // → true
 *   compatible('ObjectId', '_id')  // → true
 *   compatible('int', 'uuid')      // → false
 *   compatible('string', 'int')    // → false
 */
export function compatible(a: string, b: string): boolean {
  return typeFamily(a) === typeFamily(b);
}
