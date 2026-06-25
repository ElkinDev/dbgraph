/**
 * BSON value → dataType string mapping.
 * Design §type-map.ts "PINNED BSON→dataType table".
 *
 * bsonToDataType(value)  — maps a single BSON value to its canonical dataType string.
 * mergeDataTypes(types)  — merges a Set of dataType strings into a sorted union (e.g. 'int|string').
 *
 * PINNED mappings (single source of truth):
 *   objectId (ObjectId/_bsontype)       → 'objectId'
 *   int / long  (Int32/Long/_bsontype)  → 'int'
 *   double / Decimal128                 → 'numeric'
 *   JS number                           → 'numeric'
 *   string                              → 'string'
 *   bool                                → 'bool'
 *   Date                                → 'date'
 *   null                                → 'null'
 *   array                               → '<elemType>[]'  (recurse first element)
 *   plain object (subdocument)          → 'object' (dotted-path recursion in the walk)
 *   unknown / unrecognized BSON         → 'unknown' (NO throw)
 *
 * NO top-level mongodb import (ADR-006). Uses _bsontype duck-typing.
 *
 * US-030 (MongoDB adapter), ADR-008 (determinism: sorted union join).
 */

// ─────────────────────────────────────────────────────────────────────────────
// bsonToDataType — PINNED BSON value → dataType string
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a BSON value (as returned by the mongodb driver) to its canonical dataType string.
 * Uses duck-typing on _bsontype to detect mongodb BSON wrappers — NO mongodb import needed.
 *
 * @param value - Any JavaScript/BSON value from a sampled document field.
 * @returns A canonical dataType string (never throws).
 */
export function bsonToDataType(value: unknown): string {
  // null
  if (value === null) return 'null';

  // undefined / unrecognized primitive
  if (value === undefined) return 'unknown';

  // boolean
  if (typeof value === 'boolean') return 'bool';

  // JavaScript number — MongoDB driver maps double to plain JS number
  if (typeof value === 'number') return 'numeric';

  // string
  if (typeof value === 'string') return 'string';

  // Date
  if (value instanceof Date) return 'date';

  // array — recurse element type from the first element
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    const firstElem = value[0];
    const elemType = bsonToDataType(firstElem);
    return `${elemType}[]`;
  }

  // object — check _bsontype duck-typing first (BSON wrappers), then plain subdocument
  if (typeof value === 'object') {
    const bsonObj = value as Record<string, unknown>;
    const bsonType = bsonObj['_bsontype'];

    if (typeof bsonType === 'string') {
      // ObjectId variants (ObjectId / ObjectID legacy)
      if (bsonType === 'ObjectId' || bsonType === 'ObjectID') return 'objectId';

      // Int32
      if (bsonType === 'Int32') return 'int';

      // Long (Int64)
      if (bsonType === 'Long') return 'int';

      // Decimal128
      if (bsonType === 'Decimal128') return 'numeric';

      // Double (some driver versions wrap Double)
      if (bsonType === 'Double') return 'numeric';

      // Binary / UUID / etc. — fall through to unknown
    }

    // Plain subdocument (no _bsontype) → 'object'
    // Dotted-path recursion is handled by the walk (sample-walk.ts), not here.
    if (bsonType === undefined) return 'object';

    // Known BSON type we did not handle → unknown (no throw)
    return 'unknown';
  }

  // Everything else (symbol, bigint, function) → unknown (no throw)
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeDataTypes — sorted union join
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merges a Set of dataType strings into a SORTED union string.
 * Deterministic (ADR-008): types are sorted alphabetically before joining with '|'.
 *
 * Examples:
 *   {'string', 'int'} → 'int|string'
 *   {'bool', 'numeric', 'string'} → 'bool|numeric|string'
 *   {'string'} → 'string'
 *   {} → 'unknown'
 *
 * @param types - Set of dataType strings observed for a field path.
 * @returns Sorted union string, or 'unknown' if the set is empty.
 */
export function mergeDataTypes(types: ReadonlySet<string>): string {
  if (types.size === 0) return 'unknown';
  const sorted = Array.from(types).sort();
  return sorted.join('|');
}
