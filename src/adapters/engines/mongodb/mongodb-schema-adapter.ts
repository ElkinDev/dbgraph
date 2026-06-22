/**
 * MongodbSchemaAdapter — concrete SchemaAdapter for MongoDB.
 * Design §"MongoDB mirrors the PG adapter SHAPE (thin class + single duck-typed driver seam)".
 *
 * Talks ONLY to MongodbReadonlyDriver (ADR-004) — never to mongodb directly.
 * Instantiated by createMongodbSchemaAdapter (factory.ts).
 *
 * Batch 3 skeleton: extract() and fingerprint() are stubs that throw
 * "not implemented" — filled in Batch 4.
 * The lifecycle (close(), _closed flag) is COMPLETE in this batch.
 *
 * US-030 (MongoDB adapter), US-009 (fingerprint), ADR-004 (seam),
 * ADR-006 (lazy optional import), ADR-008 (determinism).
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { MongodbAdapterConfig } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { MongodbReadonlyDriver } from './driver.js';
import { MONGODB_CAPABILITIES } from './capabilities.js';
import { ConnectionError } from '../../../core/errors.js';

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
   * STUB in Batch 3 — filled in Batch 4.
   *
   * @throws ConnectionError if close() was already called (lifecycle guard).
   * @throws Error if called before Batch 4 is implemented.
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    void scope; // stub — scope will be used in Batch 4
    if (this._closed) {
      throw new ConnectionError(
        'MongodbSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }

    // Batch 3 skeleton — real implementation in Batch 4.
    throw new Error(
      'MongodbSchemaAdapter.extract() is not yet implemented. ' +
        'This stub will be filled in Batch 4.',
    );
  }

  /**
   * Computes a DDL-sensitive fingerprint via dbStats.
   * Formula: sha256(`${collections}|${indexes}|${objects}`)
   * STUB in Batch 3 — filled in Batch 4.
   *
   * @throws ConnectionError if close() was already called.
   * @throws Error if called before Batch 4 is implemented.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'MongodbSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }

    // Batch 3 skeleton — real implementation in Batch 4.
    throw new Error(
      'MongodbSchemaAdapter.fingerprint() is not yet implemented. ' +
        'This stub will be filled in Batch 4.',
    );
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
