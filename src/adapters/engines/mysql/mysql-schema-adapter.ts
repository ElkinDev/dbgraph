/**
 * MysqlSchemaAdapter — concrete SchemaAdapter for MySQL.
 * Design §"MysqlSchemaAdapter mirrors PgSchemaAdapter SHAPE (thin class + single
 *   duck-typed MysqlReadonlyDriver seam)".
 *
 * Talks ONLY to MysqlReadonlyDriver (ADR-004) — never to mysql2 directly.
 * Instantiated by createMysqlSchemaAdapter (factory.ts).
 *
 * SKELETON for Batch 3: extract() and fingerprint() throw "not yet implemented"
 * honest errors. Real bodies land in Batch 4/5 once queries.ts and map.ts exist.
 *
 * US-029 (MySQL adapter, Phase 8b), US-009 (fingerprint), ADR-004 (seam),
 * ADR-006 (lazy optional import), ADR-008 (determinism).
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { MysqlReadonlyDriver } from './driver.js';
import { MYSQL_CAPABILITIES } from './capabilities.js';
import { ConnectionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// MysqlSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a connected MysqlReadonlyDriver.
 * The driver is created exactly once by the factory and closed by close().
 *
 * @param _driver - Connected MysqlReadonlyDriver.
 */
export class MysqlSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'mysql' as const;
  readonly capabilities: CapabilityMatrix = MYSQL_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(
    private readonly _driver: MysqlReadonlyDriver,
  ) {}

  /**
   * Extracts the source database schema into a deterministic RawCatalog.
   * SKELETON — not yet implemented (Batch 4).
   * Issues parallel information_schema SELECTs via the driver.
   *
   * @throws ConnectionError if close() was already called (lifecycle guard).
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    void scope; // Batch 4 implements the real body
    if (this._closed) {
      throw new ConnectionError(
        'MysqlSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }
    // Batch 4 implements the real body (queries.ts + map.ts).
    throw new ConnectionError(
      'MysqlSchemaAdapter.extract() is not yet implemented (Batch 4).',
    );
  }

  /**
   * Computes a cheap DDL-sensitive fingerprint.
   * SKELETON — not yet implemented (Batch 4).
   * Formula: sha256(`${table_count}|${column_count}|${routine_count}`)
   *
   * @throws ConnectionError if close() was already called.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'MysqlSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }
    // Batch 4 implements the real body (SQL_MYSQL_FINGERPRINT query).
    throw new ConnectionError(
      'MysqlSchemaAdapter.fingerprint() is not yet implemented (Batch 4).',
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
