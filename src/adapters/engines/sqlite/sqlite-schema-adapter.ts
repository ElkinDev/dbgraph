/**
 * SqliteSchemaAdapter — the concrete SchemaAdapter for SQLite source databases.
 * Design §5.2 — lifecycle: extract(scope), fingerprint(), close() idempotent.
 *
 * This class is engine-local; it lives under src/adapters/engines/sqlite/.
 * It talks ONLY to ReadonlyDriver (never to better-sqlite3 or node:sqlite directly).
 * Instantiation happens via createSqliteSchemaAdapter (factory.ts) which owns
 * dynamic import + read-only open.
 *
 * US-026 (first concrete adapter), US-009 (fingerprint), US-031 (read-only by construction).
 */

import { createHash } from 'node:crypto';
import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { ReadonlyDriver } from './driver.js';
import { SQLITE_CAPABILITIES } from './capabilities.js';
import { buildRawCatalog } from './map.js';
import { PRAGMA_SCHEMA_VERSION } from './queries.js';
import { ConnectionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// SqliteSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a read-only ReadonlyDriver.
 * The driver is opened exactly once by the factory and closed by close().
 * All methods are async to satisfy the port contract (and for symmetry with
 * networked engines, as decided in design §1).
 */
export class SqliteSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'sqlite' as const;
  readonly capabilities: CapabilityMatrix = SQLITE_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(private readonly _driver: ReadonlyDriver) {}

  /**
   * Test-only accessor to the underlying ReadonlyDriver instance.
   * Enables W-2 spec compliance tests that must exercise the SAME connection
   * that the factory opened (not a parallel connection). Never call this in
   * production code — the driver is engine-local and not part of the port.
   *
   * @internal
   */
  get _testOnlyDriver(): ReadonlyDriver {
    return this._driver;
  }

  /**
   * Extracts the source database schema into a deterministic RawCatalog.
   * Delegates entirely to buildRawCatalog (map.ts) which handles all PRAGMA queries.
   * Honours ExtractionScope levels (off / metadata / full).
   *
   * @throws ConnectionError if close() was already called (defense-in-depth lifecycle guard).
   *   The factory-owned lifecycle makes this state normally unreachable via the public API
   *   (the factory returns an already-open adapter and the caller is expected to close it only
   *   once). The guard exists so that close()-then-extract() produces a typed error rather than
   *   a cryptic driver-level failure. (W-3 spec note: by-construction guarantee plus guard.)
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    if (this._closed) {
      throw new ConnectionError(
        'SqliteSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }
    return buildRawCatalog(this._driver, scope);
  }

  /**
   * Computes a cheap drift fingerprint.
   * Formula: sha256(String(PRAGMA schema_version)) — hex.
   * Increments on every DDL; stable on data-only DML (US-009).
   * Issues exactly ONE PRAGMA query — never walks objects.
   */
  async fingerprint(): Promise<string> {
    const rows = this._driver.pragma(PRAGMA_SCHEMA_VERSION) as Array<Record<string, unknown>>;
    // PRAGMA schema_version returns [{schema_version: N}]
    const row = rows[0];
    const version = row !== undefined ? String(row['schema_version'] ?? '0') : '0';
    return createHash('sha256').update(version).digest('hex');
  }

  /**
   * Releases the underlying driver connection.
   * Idempotent — a second call is a no-op (design §1 lifecycle contract).
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._driver.close();
  }
}
