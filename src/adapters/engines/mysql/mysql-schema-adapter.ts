/**
 * MysqlSchemaAdapter — concrete SchemaAdapter for MySQL.
 * Design §"MysqlSchemaAdapter mirrors PgSchemaAdapter SHAPE (thin class + single
 *   duck-typed MysqlReadonlyDriver seam)".
 *
 * Talks ONLY to MysqlReadonlyDriver (ADR-004) — never to mysql2 directly.
 * Instantiated by createMysqlSchemaAdapter (factory.ts).
 *
 * extract(scope) runs information_schema SELECTs in parallel (where independent)
 * and assembles a deterministic RawCatalog via buildMysqlRawCatalog.
 * fingerprint() runs exactly ONE query (SQL_MYSQL_FINGERPRINT) and returns
 * sha256(`${table_count}|${column_count}|${routine_count}`).
 *
 * Lifecycle: idempotent close() sets _closed flag; extract/fingerprint after
 * close() throw ConnectionError immediately.
 *
 * NOTE: The exact mysql:8 information_schema row shapes (particularly the
 * precise EXTRA string for stored-generated columns, and EXPRESSION/SUB_PART
 * presence for functional/prefix indexes) are provisional until Batch 7 pins
 * them against a live mysql:8 container via the golden RawCatalog.
 *
 * US-029 (MySQL adapter, Phase 8b), US-009 (fingerprint), ADR-004 (seam),
 * ADR-006 (lazy optional import), ADR-008 (determinism).
 */

import { createHash } from 'node:crypto';
import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { MysqlReadonlyDriver } from './driver.js';
import { MYSQL_CAPABILITIES } from './capabilities.js';
import { buildMysqlRawCatalog } from './map.js';
import type {
  MysqlTableRow,
  MysqlColumnRow,
  MysqlPkUkColumnRow,
  MysqlFkColumnRow,
  MysqlCheckConstraintRow,
  MysqlStatisticsRow,
  MysqlViewRow,
  MysqlRoutineRow,
  MysqlTriggerRow,
} from './map.js';
import {
  SQL_MYSQL_TABLES,
  SQL_MYSQL_COLUMNS,
  SQL_MYSQL_PK_UK_COLUMNS,
  SQL_MYSQL_FK_COLUMNS,
  SQL_MYSQL_CHECK_CONSTRAINTS,
  SQL_MYSQL_STATISTICS,
  SQL_MYSQL_VIEWS,
  SQL_MYSQL_ROUTINES,
  SQL_MYSQL_TRIGGERS,
  SQL_MYSQL_FINGERPRINT,
} from './queries.js';
import { ConnectionError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// MysqlSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a connected MysqlReadonlyDriver.
 * The driver is created exactly once by the factory and closed by close().
 *
 * @param _driver    - Connected MysqlReadonlyDriver.
 * @param _database  - The connected database name (schema == database for MySQL).
 */
export class MysqlSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'mysql' as const;
  readonly capabilities: CapabilityMatrix = MYSQL_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(
    private readonly _driver: MysqlReadonlyDriver,
    private readonly _database: string = '',
  ) {}

  /**
   * Extracts the source database schema into a deterministic RawCatalog.
   * Issues information_schema SELECTs in parallel (where independent) via the driver.
   * Honours ExtractionScope levels.
   *
   * @throws ConnectionError if close() was already called (lifecycle guard).
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    if (this._closed) {
      throw new ConnectionError(
        'MysqlSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }

    // Run independent catalog queries in parallel for efficiency.
    // All are scoped by DATABASE() in the SQL (no params needed).
    const [
      tables,
      columns,
      pkUkColumns,
      fkColumns,
      checkConstraints,
      statistics,
      views,
      routines,
      triggers,
    ] = await Promise.all([
      this._driver.query(SQL_MYSQL_TABLES),
      this._driver.query(SQL_MYSQL_COLUMNS),
      this._driver.query(SQL_MYSQL_PK_UK_COLUMNS),
      this._driver.query(SQL_MYSQL_FK_COLUMNS),
      this._driver.query(SQL_MYSQL_CHECK_CONSTRAINTS),
      this._driver.query(SQL_MYSQL_STATISTICS),
      this._driver.query(SQL_MYSQL_VIEWS),
      this._driver.query(SQL_MYSQL_ROUTINES),
      this._driver.query(SQL_MYSQL_TRIGGERS),
    ]);

    // Determine the connected database name.
    // Primary: use the stored _database from construction (set by factory).
    // Fallback: derive from any table row (all scoped to DATABASE()).
    const database =
      this._database ||
      ((tables[0] as Record<string, unknown> | undefined)?.['table_schema'] as string | undefined) ||
      'unknown';

    return buildMysqlRawCatalog(
      {
        database,
        tables: tables as unknown as readonly MysqlTableRow[],
        columns: columns as unknown as readonly MysqlColumnRow[],
        pkUkColumns: pkUkColumns as unknown as readonly MysqlPkUkColumnRow[],
        fkColumns: fkColumns as unknown as readonly MysqlFkColumnRow[],
        checkConstraints: checkConstraints as unknown as readonly MysqlCheckConstraintRow[],
        statistics: statistics as unknown as readonly MysqlStatisticsRow[],
        views: views as unknown as readonly MysqlViewRow[],
        routines: routines as unknown as readonly MysqlRoutineRow[],
        triggers: triggers as unknown as readonly MysqlTriggerRow[],
      },
      scope,
    );
  }

  /**
   * Computes a cheap DDL-sensitive fingerprint via ONE query (Decision §6).
   * Formula: sha256(`${table_count}|${column_count}|${routine_count}`)
   *
   * Components:
   *   table_count   — moves on CREATE/DROP TABLE/VIEW
   *   column_count  — moves on ADD COLUMN (SUGGESTION-2 fix from Phase-8a)
   *   routine_count — moves on CREATE/DROP PROCEDURE/FUNCTION
   * All three stable under pure DML.
   *
   * @throws ConnectionError if close() was already called.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'MysqlSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }

    const rows = await this._driver.query(SQL_MYSQL_FINGERPRINT);
    const row = rows[0] as Record<string, unknown> | undefined;

    const tableCount = row !== undefined ? String(row['table_count'] ?? '0') : '0';
    const columnCount = row !== undefined ? String(row['column_count'] ?? '0') : '0';
    const routineCount = row !== undefined ? String(row['routine_count'] ?? '0') : '0';

    return createHash('sha256')
      .update(`${tableCount}|${columnCount}|${routineCount}`)
      .digest('hex');
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
