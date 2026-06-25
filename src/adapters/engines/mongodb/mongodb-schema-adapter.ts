/**
 * MongodbSchemaAdapter — concrete SchemaAdapter for MongoDB.
 * Design §"MongoDB mirrors the PG adapter SHAPE (thin class + single duck-typed driver seam)".
 *
 * Talks ONLY to MongodbReadonlyDriver (ADR-004) — never to mongodb directly.
 * Instantiated by createMongodbSchemaAdapter (factory.ts).
 *
 * extract(): listCollections → for each: $sample(size) + sampleCollections + DISCARD docs
 *             → listIndexes + validator (listCollections command) → buildMongodbRawCatalog.
 * fingerprint(): dbStats → sha256(`${collections}|${indexes}|${objects}`).
 *
 * DISCARD invariant (dbgraph-security): sampled document VALUES never survive extract().
 * Only the path→{types,count} accumulator (resolved to RawField[]) is passed downstream.
 *
 * US-030 (MongoDB adapter), US-009 (fingerprint), ADR-004 (seam),
 * ADR-006 (lazy optional import), ADR-008 (determinism).
 */

import { createHash } from 'node:crypto';
import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { MongodbAdapterConfig } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { MongodbReadonlyDriver } from './driver.js';
import { MONGODB_CAPABILITIES } from './capabilities.js';
import { ConnectionError } from '../../../core/errors.js';
import { sampleCollections } from './sample-walk.js';
import { buildMongodbRawCatalog } from './map.js';
import type { MongoIndexDoc, MongoValidatorDoc, SampledCollection } from './map.js';

// ─────────────────────────────────────────────────────────────────────────────
// System collection filter (mirrored from map.ts — adapter-level early filter)
// ─────────────────────────────────────────────────────────────────────────────

function isSystemCollection(name: string): boolean {
  return name.startsWith('system.');
}

// ─────────────────────────────────────────────────────────────────────────────
// MongodbSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a connected MongodbReadonlyDriver.
 * The driver is created exactly once by the factory and closed by close().
 *
 * @param _driver  - Connected MongodbReadonlyDriver.
 * @param _config  - The resolved MongodbAdapterConfig (database, sampleSize, etc.).
 */
export class MongodbSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'mongodb' as const;
  readonly capabilities: CapabilityMatrix = MONGODB_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(
    private readonly _driver: MongodbReadonlyDriver,
    private readonly _config: MongodbAdapterConfig,
  ) {}

  /**
   * Extracts the source MongoDB database schema into a deterministic RawCatalog.
   * Algorithm per design §data-flow:
   *   1. listCollections → filter system.* collections and scope.levels.collections='off'
   *   2. For each collection: driver.sample(name, size) → sampleCollections → DISCARD docs
   *   3. For each collection: driver.listIndexes(name)
   *   4. For each collection: driver.command({listCollections}) → validator options
   *   5. buildMongodbRawCatalog → deterministic RawCatalog
   *
   * @throws ConnectionError if close() was already called (lifecycle guard).
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    if (this._closed) {
      throw new ConnectionError(
        'MongodbSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }

    // ── 1. List collections (early exit if collections level is off) ─────────
    if (scope.levels.collections === 'off') {
      return buildMongodbRawCatalog({
        database: this._config.database,
        sampledCollections: [],
        indexes: {},
        validators: {},
        scope,
      });
    }

    const allCollections = await this._driver.listCollections();

    // Filter system.* collections (adapter-level early filter)
    const userCollections = allCollections.filter((c) => !isSystemCollection(c.name));

    // ── 2. Sample + type-merge + DISCARD each collection ────────────────────
    const size = this._config.sampleSize ?? 100;
    const clampedSize = Math.max(1, size); // ensure at least 1

    const sampledCollections: SampledCollection[] = [];
    const indexMap: Record<string, readonly MongoIndexDoc[]> = {};
    const validatorMap: Record<string, MongoValidatorDoc> = {};

    for (const collection of userCollections) {
      // Sample documents — each doc is used only for type inference then discarded
      const docs = await this._driver.sample(collection.name, clampedSize);

      // sampleCollections walks + merges types + DISCARDS values immediately
      // After sampleCollections returns, docs are no longer referenced
      const fields = sampleCollections(docs);

      sampledCollections.push({ name: collection.name, fields });

      // ── 3. List indexes ──────────────────────────────────────────────────
      const rawIndexes = await this._driver.listIndexes(collection.name);
      indexMap[collection.name] = rawIndexes as readonly MongoIndexDoc[];

      // ── 4. Extract validator from collection options ─────────────────────
      // Check if collection already has options.validator from listCollections
      const collectionOptions = collection.options;
      if (
        collectionOptions !== undefined &&
        typeof collectionOptions['validator'] === 'object' &&
        collectionOptions['validator'] !== null
      ) {
        validatorMap[collection.name] = collectionOptions['validator'] as MongoValidatorDoc;
      }
    }

    // ── 5. Build deterministic RawCatalog ────────────────────────────────────
    return buildMongodbRawCatalog({
      database: this._config.database,
      sampledCollections,
      indexes: indexMap,
      validators: validatorMap,
      scope,
    });
  }

  /**
   * Computes a DDL-sensitive fingerprint via dbStats.
   *
   * FORMULA: sha256(`${collections}|${indexes}`) → 64-char hex.
   *
   * WHY `objects` IS EXCLUDED (reality-driven fix, task 7.4):
   *   dbStats.objects is the total document count across all collections.
   *   It changes on EVERY insert/update/delete, making the fingerprint
   *   data-sensitive — violating the "stable across data-only changes" contract
   *   (ADR-008, US-009). The contract requires: DDL changes (collection/index
   *   create/drop) → fingerprint MOVES; DML only → fingerprint STABLE.
   *   FIX: use only `collections` (collection count) and `indexes` (total index
   *   count), both of which are DDL-stable across DML-only operations.
   *
   * MUST NOT walk documents — only accesses aggregate counters.
   *
   * @throws ConnectionError if close() was already called.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'MongodbSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }

    // dbStats returns { collections, indexes, objects, ... }
    const stats = await this._driver.command({ dbStats: 1 });

    const collections = stats['collections'] ?? 0;
    const indexes = stats['indexes'] ?? 0;
    // NOTE: 'objects' (document count) is intentionally EXCLUDED from the hash.
    // Including it would make the fingerprint data-sensitive (changes on DML),
    // violating the "stable across data-only changes" contract (ADR-008, US-009).
    // See the JSDoc above for the full justification.

    // sha256(`${collections}|${indexes}`) → 64-char hex
    return createHash('sha256')
      .update(`${collections}|${indexes}`)
      .digest('hex');
  }

  /**
   * Releases the underlying driver connection.
   * Idempotent — a second call is a no-op (port contract).
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    // Suppress any driver close error to keep close() non-throwing (idempotent contract).
    void this._config;
    await this._driver.close();
  }
}
