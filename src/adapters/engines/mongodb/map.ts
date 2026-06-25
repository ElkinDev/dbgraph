/**
 * MongoDB schema extraction mapper.
 * Design §map.ts "buildMongodbRawCatalog(sampledCollections, indexes, validators)
 *   → deterministic RawCatalog".
 *
 * Mirrors buildPgRawCatalog / buildMssqlRawCatalog in structure and ordering contract.
 * Pure function — NO DB, NO driver. Testable with fake cursor inputs.
 *
 * Determinism (ADR-008):
 *   objects  : sorted by (KIND_RANK, schema, name) — mirrors pg/map.ts
 *   fields   : sorted by path (alphabetical)
 *   indexes  : sorted by name; compound key order preserved
 *   schemas  : single database name (schema == database for MongoDB)
 *
 * System collection exclusion: system.* / admin / local / config are filtered out.
 *
 * $jsonSchema validator: top-level required + properties only (deep nesting NOT walked).
 * schema = database name (NEVER null for MongoDB).
 *
 * US-030 (MongoDB adapter), ADR-008 (determinism), dbgraph-security (DISCARD invariant
 * — sampled values are already discarded by sample-walk.ts before reaching this function).
 */

import type { ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog, RawObject, RawIndex, RawField } from '../../../core/model/catalog.js';
import type { NodeKind } from '../../../core/model/node.js';

// ─────────────────────────────────────────────────────────────────────────────
// Kind rank for deterministic ordering (mirrors pg/map.ts KIND_RANK)
// ─────────────────────────────────────────────────────────────────────────────

const KIND_RANK: Record<NodeKind, number> = {
  database: 0,
  schema: 1,
  table: 2,
  view: 3,
  trigger: 4,
  column: 5,
  constraint: 6,
  index: 7,
  procedure: 8,
  function: 9,
  sequence: 10,
  collection: 11,
  field: 12,
};

function kindRank(k: NodeKind): number {
  return KIND_RANK[k] ?? 99;
}

function compareObjects(a: RawObject, b: RawObject): number {
  const rankDiff = kindRank(a.kind) - kindRank(b.kind);
  if (rankDiff !== 0) return rankDiff;
  const schemaDiff = (a.schema ?? '').localeCompare(b.schema ?? '');
  if (schemaDiff !== 0) return schemaDiff;
  return a.name.localeCompare(b.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Input shapes (fake cursor / raw driver output)
// ─────────────────────────────────────────────────────────────────────────────

/** A sampled collection with pre-computed fields from sample-walk.ts. */
export interface SampledCollection {
  readonly name: string;
  readonly fields: readonly RawField[];
}

/**
 * Raw MongoDB index document shape (from listIndexes().toArray()).
 * The 'key' field is an ordered Record<fieldName, sort> (1 = asc, -1 = desc).
 */
export interface MongoIndexDoc {
  readonly name: string;
  readonly key: Record<string, unknown>;
  readonly unique?: boolean;
  readonly [k: string]: unknown;
}

/**
 * Raw MongoDB validator document — the value of collectionInfo.options.validator.
 * May contain a $jsonSchema key at the top level.
 */
export interface MongoValidatorDoc {
  readonly $jsonSchema?: {
    readonly required?: readonly string[];
    readonly properties?: Record<string, unknown>;
    readonly [k: string]: unknown;
  };
  readonly [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input to buildMongodbRawCatalog
// ─────────────────────────────────────────────────────────────────────────────

export interface MongodbRawCatalogInput {
  /** The database name — becomes schema for every collection. */
  readonly database: string;
  /** Per-collection sampled+merged fields (from sample-walk.ts). */
  readonly sampledCollections: readonly SampledCollection[];
  /** Map from collection name → listIndexes output. */
  readonly indexes: Readonly<Record<string, readonly MongoIndexDoc[]>>;
  /** Map from collection name → validator document (from collMod/listCollections). */
  readonly validators: Readonly<Record<string, MongoValidatorDoc>>;
  /** Extraction scope controlling which levels to include. */
  readonly scope: ExtractionScope;
}

// ─────────────────────────────────────────────────────────────────────────────
// System collection filter
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PREFIXES = ['system.'];
const SYSTEM_DB_NAMES = new Set(['admin', 'local', 'config']);

/**
 * Returns true if a collection name is a system/internal collection.
 * System collections (system.* prefix) must always be excluded.
 */
function isSystemCollection(name: string): boolean {
  for (const prefix of SYSTEM_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Index mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts raw MongoDB index documents to RawIndex[].
 * Deduplicates by name (handles the _id_ double-listing case).
 * Preserves compound key order (Object.keys preserves insertion order in JS).
 */
function buildIndexes(rawIndexes: readonly MongoIndexDoc[]): RawIndex[] {
  const seen = new Set<string>();
  const result: RawIndex[] = [];

  // Sort by name for determinism first, then deduplicate
  const sorted = [...rawIndexes].sort((a, b) => a.name.localeCompare(b.name));

  for (const idx of sorted) {
    if (seen.has(idx.name)) continue; // deduplicate _id_ double-listing
    seen.add(idx.name);

    const columns = Object.keys(idx.key);
    result.push({
      name: idx.name,
      unique: idx.unique === true,
      columns,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator extra extraction (top-level $jsonSchema only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts top-level required + properties from a $jsonSchema validator.
 * Deep nesting beyond the top level is NOT walked (out of scope).
 * Returns undefined if no $jsonSchema is present.
 */
function extractValidatorExtra(
  validator: MongoValidatorDoc | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (validator === undefined) return undefined;

  const schema = validator['$jsonSchema'];
  if (schema === undefined) return undefined;

  const extra: Record<string, unknown> = {};
  let hasAny = false;

  if (schema['required'] !== undefined) {
    extra['required'] = schema['required'];
    hasAny = true;
  }
  if (schema['properties'] !== undefined) {
    extra['properties'] = schema['properties'];
    hasAny = true;
  }

  return hasAny ? extra : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildMongodbRawCatalog — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a deterministic RawCatalog from pre-computed MongoDB extraction data.
 * Mirrors buildPgRawCatalog() from pg/map.ts in structure and ordering contract.
 *
 * @param input - Pre-computed sampled fields, index docs, validator docs, scope.
 * @returns Deterministic RawCatalog (engine: 'mongodb').
 */
export function buildMongodbRawCatalog(input: MongodbRawCatalogInput): RawCatalog {
  const { database, sampledCollections, indexes, validators, scope } = input;

  // Early exit: collections level is 'off'
  if (scope.levels.collections === 'off') {
    return {
      engine: 'mongodb',
      schemas: [database],
      objects: [],
    };
  }

  const objects: RawObject[] = [];

  for (const collection of sampledCollections) {
    // Exclude system.* collections
    if (isSystemCollection(collection.name)) continue;

    // Also exclude if the collection is from a system database name
    // (edge case: if somehow admin/local/config collections appear)
    if (SYSTEM_DB_NAMES.has(collection.name)) continue;

    // Sort fields by path (determinism — ADR-008)
    const sortedFields = [...collection.fields].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    // Build indexes for this collection
    const rawIndexes = indexes[collection.name] ?? [];
    const builtIndexes = buildIndexes(rawIndexes);

    // Extract validator extra (top-level $jsonSchema only)
    const validatorDoc = validators[collection.name];
    const extra = extractValidatorExtra(validatorDoc);

    const obj: RawObject = {
      kind: 'collection',
      schema: database, // schema == database for MongoDB (NEVER null)
      name: collection.name,
      // Conditional spreads (exactOptionalPropertyTypes compliance)
      ...(sortedFields.length > 0 ? { fields: sortedFields } : {}),
      ...(builtIndexes.length > 0 ? { indexes: builtIndexes } : {}),
      ...(extra !== undefined ? { extra } : {}),
    };
    objects.push(obj);
  }

  // Sort deterministically by (kindRank, schema, name) — ADR-008
  // For MongoDB all objects are 'collection' kind, so this reduces to schema+name sort
  objects.sort(compareObjects);

  return {
    engine: 'mongodb',
    schemas: [database],
    objects,
  };
}
