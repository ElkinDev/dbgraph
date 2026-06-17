/**
 * MssqlSchemaAdapter — concrete SchemaAdapter for SQL Server.
 * Design §adapter class "extract(scope), fingerprint(), close() idempotent".
 *
 * Talks ONLY to MssqlReadonlyDriver (never to mssql directly).
 * Instantiated by createMssqlSchemaAdapter (factory.ts).
 *
 * US-027 (SQL Server adapter), US-009 (fingerprint), US-031 (read-only by construction).
 */

import { createHash } from 'node:crypto';
import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { MssqlReadonlyDriver } from './driver.js';
import { MSSQL_CAPABILITIES } from './capabilities.js';
import { buildMssqlRawCatalog } from './map.js';
import {
  SQL_MSSQL_TABLES,
  SQL_MSSQL_COLUMNS,
  SQL_MSSQL_KEY_CONSTRAINTS,
  SQL_MSSQL_FOREIGN_KEYS,
  SQL_MSSQL_CHECK_CONSTRAINTS,
  SQL_MSSQL_INDEXES,
  SQL_MSSQL_MODULES,
  SQL_MSSQL_TRIGGER_EVENTS,
  SQL_MSSQL_SEQUENCES,
  SQL_MSSQL_EXTENDED_PROPERTIES,
  SQL_MSSQL_DEPENDENCIES,
  SQL_MSSQL_FINGERPRINT,
} from './queries.js';
import { ConnectionError } from '../../../core/errors.js';
import type {
  TableRow,
  ColumnRow,
  KeyConstraintRow,
  FkRow,
  CheckRow,
  IndexRow,
  ModuleRow,
  TriggerEventRow,
  SequenceRow,
  ExtendedPropRow,
  DepRow,
} from './map.js';

// ─────────────────────────────────────────────────────────────────────────────
// MssqlSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a MssqlReadonlyDriver (pool-backed seam).
 * The driver is connected exactly once by the factory and closed by close().
 * All methods are async (network I/O) and satisfy the port contract.
 */
export class MssqlSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'mssql' as const;
  readonly capabilities: CapabilityMatrix = MSSQL_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(private readonly _driver: MssqlReadonlyDriver) {}

  /**
   * Test-only accessor to the underlying driver.
   * @internal
   */
  get _testOnlyDriver(): MssqlReadonlyDriver {
    return this._driver;
  }

  /**
   * Extracts the source database schema into a deterministic RawCatalog.
   * Issues multiple sys.* SELECTs via the driver, assembles via buildMssqlRawCatalog.
   * Honours ExtractionScope levels (off / metadata / full).
   *
   * @throws ConnectionError if close() was already called (lifecycle guard).
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    if (this._closed) {
      throw new ConnectionError(
        'MssqlSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }

    // Fetch all sys.* rows in parallel for efficiency
    const [
      tables,
      columns,
      keyConstraints,
      foreignKeys,
      checkConstraints,
      indexes,
      modules,
      triggerEvents,
      sequences,
      extendedProperties,
      dependencies,
    ] = await Promise.all([
      this._driver.query(SQL_MSSQL_TABLES),
      this._driver.query(SQL_MSSQL_COLUMNS),
      this._driver.query(SQL_MSSQL_KEY_CONSTRAINTS),
      this._driver.query(SQL_MSSQL_FOREIGN_KEYS),
      this._driver.query(SQL_MSSQL_CHECK_CONSTRAINTS),
      this._driver.query(SQL_MSSQL_INDEXES),
      this._driver.query(SQL_MSSQL_MODULES),
      this._driver.query(SQL_MSSQL_TRIGGER_EVENTS),
      this._driver.query(SQL_MSSQL_SEQUENCES),
      this._driver.query(SQL_MSSQL_EXTENDED_PROPERTIES),
      this._driver.query(SQL_MSSQL_DEPENDENCIES),
    ]);

    return buildMssqlRawCatalog(
      {
        tables: tables as unknown as readonly TableRow[],
        columns: columns as unknown as readonly ColumnRow[],
        keyConstraints: keyConstraints as unknown as readonly KeyConstraintRow[],
        foreignKeys: foreignKeys as unknown as readonly FkRow[],
        checkConstraints: checkConstraints as unknown as readonly CheckRow[],
        indexes: indexes as unknown as readonly IndexRow[],
        modules: modules as unknown as readonly ModuleRow[],
        triggerEvents: triggerEvents as unknown as readonly TriggerEventRow[],
        sequences: sequences as unknown as readonly SequenceRow[],
        extendedProperties: extendedProperties as unknown as readonly ExtendedPropRow[],
        dependencies: dependencies as unknown as readonly DepRow[],
      },
      scope,
    );
  }

  /**
   * Computes a cheap DDL-sensitive fingerprint.
   * Formula: sha256(`${MAX(modify_date)}|${COUNT(*)}`) over sys.objects WHERE is_ms_shipped=0.
   * Changes on DDL (CREATE/ALTER/DROP); stable on DML (US-009).
   * Issues exactly ONE query.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'MssqlSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }

    const rows = await this._driver.query(SQL_MSSQL_FINGERPRINT);
    const row = rows[0] as Record<string, unknown> | undefined;

    const m = row !== undefined ? String(row['m'] ?? 'null') : 'null';
    const c = row !== undefined ? String(row['c'] ?? '0') : '0';

    return createHash('sha256').update(`${m}|${c}`).digest('hex');
  }

  /**
   * Releases the underlying driver connection pool.
   * Idempotent — a second call is a no-op.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._driver.close();
  }
}
