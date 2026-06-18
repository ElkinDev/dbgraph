/**
 * PgSchemaAdapter — minimal skeleton for the PostgreSQL SchemaAdapter.
 * Design §"PG mirrors the SQLite adapter SHAPE (thin class + single duck-typed driver seam)".
 *
 * This skeleton satisfies the SchemaAdapter port contract so factory.ts can
 * return a correctly-typed adapter in Batch 3. The full extract() and fingerprint()
 * bodies (catalog queries + map) are implemented in Batch 5 (task 5.1).
 *
 * The adapter talks ONLY to PgReadonlyDriver (ADR-004) — never to pg directly.
 * Instantiation happens via createPgSchemaAdapter (factory.ts) which owns the
 * lazy import and client.connect() (ADR-006).
 *
 * US-028 (PostgreSQL adapter), ADR-004 (seam), ADR-006 (lazy optional import).
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { PgReadonlyDriver } from './driver.js';
import { PG_CAPABILITIES } from './capabilities.js';
import { ConnectionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// PgSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a connected PgReadonlyDriver.
 * The driver is created exactly once by the factory and closed by close().
 *
 * extract() and fingerprint() are STUBS in Batch 3; full implementation
 * arrives in Batch 5 (queries.ts + map.ts + fingerprint query).
 */
export class PgSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'pg' as const;
  readonly capabilities: CapabilityMatrix = PG_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(private readonly _driver: PgReadonlyDriver) {}

  /**
   * Extracts the source database schema into a deterministic RawCatalog.
   * STUB: full implementation (queries.ts + map.ts) arrives in Batch 5.
   *
   * @throws ConnectionError if close() was already called.
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    void scope;
    if (this._closed) {
      throw new ConnectionError(
        'PgSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }
    // Batch 5 (task 5.1) replaces this stub with the real catalog queries + map.
    throw new ConnectionError(
      'PgSchemaAdapter.extract() is not yet implemented (arrives in Batch 5).',
    );
  }

  /**
   * Computes a cheap drift fingerprint via a single catalog query.
   * STUB: full implementation arrives in Batch 5 (task 5.1).
   *
   * @throws ConnectionError if close() was already called.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'PgSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }
    // Batch 5 (task 5.1) replaces this stub with the real fingerprint query.
    throw new ConnectionError(
      'PgSchemaAdapter.fingerprint() is not yet implemented (arrives in Batch 5).',
    );
  }

  /**
   * Releases the underlying driver connection.
   * Idempotent — a second call is a no-op (port contract).
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._driver.close();
  }
}
