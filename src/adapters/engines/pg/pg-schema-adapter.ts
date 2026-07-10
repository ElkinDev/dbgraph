/**
 * PgSchemaAdapter — concrete SchemaAdapter for PostgreSQL.
 * Design §"PG mirrors the SQLite adapter SHAPE (thin class + single duck-typed driver seam)".
 *
 * Talks ONLY to PgReadonlyDriver (ADR-004) — never to pg directly.
 * Instantiated by createPgSchemaAdapter (factory.ts).
 *
 * US-028 (PostgreSQL adapter), US-009 (fingerprint), ADR-004 (seam),
 * ADR-006 (lazy optional import), ADR-008 (determinism).
 */

import { createHash } from 'node:crypto';
import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { CapabilityMatrix, ExtractionScope } from '../../../core/model/capability.js';
import type { RawCatalog } from '../../../core/model/catalog.js';
import type { PgReadonlyDriver } from './driver.js';
import { PG_CAPABILITIES } from './capabilities.js';
import { buildPgRawCatalog } from './map.js';
import {
  SQL_PG_SCHEMAS,
  SQL_PG_TABLES,
  SQL_PG_COLUMNS,
  SQL_PG_COLUMN_NAMES,
  SQL_PG_CONSTRAINTS,
  SQL_PG_INDEXES,
  SQL_PG_VIEWS,
  SQL_PG_ROUTINES,
  SQL_PG_TRIGGERS,
  SQL_PG_SEQUENCES,
  SQL_PG_FINGERPRINT,
  SQL_PG_VIEW_COLUMN_USAGE,
} from './queries.js';
import { ConnectionError } from '../../../core/errors.js';
import type {
  SchemaRow,
  TableRow,
  ColumnRow,
  ColumnNameRow,
  ConstraintRow,
  IndexRow,
  ViewRow,
  RoutineRow,
  TriggerRow,
  SequenceRow,
  ViewColumnUsageRow,
} from './map.js';

// ─────────────────────────────────────────────────────────────────────────────
// PgSchemaAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements SchemaAdapter backed by a connected PgReadonlyDriver.
 * The driver is created exactly once by the factory and closed by close().
 *
 * @param _driver  - Connected PgReadonlyDriver.
 * @param _schema  - Optional schema scope (null = all non-system schemas).
 */
export class PgSchemaAdapter implements SchemaAdapter {
  readonly dialect = 'pg' as const;
  readonly capabilities: CapabilityMatrix = PG_CAPABILITIES;

  /** Set to true after close() so the second call is a no-op. */
  private _closed = false;

  constructor(
    private readonly _driver: PgReadonlyDriver,
    private readonly _schema: string | null = null,
  ) {}

  /**
   * Extracts the source database schema into a deterministic RawCatalog.
   * Issues pg_catalog SELECTs in parallel (where independent) via the driver,
   * assembles via buildPgRawCatalog. Honours ExtractionScope levels.
   *
   * @throws ConnectionError if close() was already called (lifecycle guard).
   */
  async extract(scope: ExtractionScope): Promise<RawCatalog> {
    if (this._closed) {
      throw new ConnectionError(
        'PgSchemaAdapter: extract() called after close(). Create a new adapter.',
      );
    }

    const schemaParam = this._schema ?? null;

    // Run all catalog queries in parallel for efficiency (independent queries).
    // Each query accepts an optional $1 schema scope param (null = all non-system schemas).
    const [
      schemas,
      tables,
      columns,
      columnNames,
      constraints,
      indexes,
      views,
      routines,
      triggers,
      sequences,
      viewColumnUsage,
    ] = await Promise.all([
      this._driver.query(SQL_PG_SCHEMAS, [schemaParam]),
      this._driver.query(SQL_PG_TABLES, [schemaParam]),
      this._driver.query(SQL_PG_COLUMNS, [schemaParam]),
      this._driver.query(SQL_PG_COLUMN_NAMES, [schemaParam]),
      this._driver.query(SQL_PG_CONSTRAINTS, [schemaParam]),
      this._driver.query(SQL_PG_INDEXES, [schemaParam]),
      this._driver.query(SQL_PG_VIEWS, [schemaParam]),
      this._driver.query(SQL_PG_ROUTINES, [schemaParam]),
      this._driver.query(SQL_PG_TRIGGERS, [schemaParam]),
      this._driver.query(SQL_PG_SEQUENCES, [schemaParam]),
      // DOG-3 (D5): view_column_usage — a single flat catalog SELECT (no per-view loop, unlike
      // the mssql D8 TVF). Materialized/owner-invisible pairs are structurally absent from rows.
      this._driver.query(SQL_PG_VIEW_COLUMN_USAGE, [schemaParam]),
    ]);

    const viewColumnUsageRows = viewColumnUsage as unknown as readonly ViewColumnUsageRow[];

    return buildPgRawCatalog(
      {
        schemas: schemas as unknown as readonly SchemaRow[],
        tables: tables as unknown as readonly TableRow[],
        columns: columns as unknown as readonly ColumnRow[],
        columnNames: columnNames as unknown as readonly ColumnNameRow[],
        constraints: constraints as unknown as readonly ConstraintRow[],
        indexes: indexes as unknown as readonly IndexRow[],
        views: views as unknown as readonly ViewRow[],
        routines: routines as unknown as readonly RoutineRow[],
        triggers: triggers as unknown as readonly TriggerRow[],
        sequences: sequences as unknown as readonly SequenceRow[],
        ...(viewColumnUsageRows.length > 0 ? { viewColumnUsage: viewColumnUsageRows } : {}),
      },
      scope,
    );
  }

  /**
   * Computes a cheap DDL-sensitive fingerprint (SUGGESTION-2 fix).
   * Formula: sha256(`${maxOid}|${maxAttnum}|${relCount}|${attrCount}`)
   *
   * Components (all from a SINGLE query):
   *   max_oid    — MAX(pg_class.oid)      moves on CREATE TABLE/VIEW/INDEX/SEQUENCE
   *   max_attnum — MAX(pg_attribute.attnum) moves when a column is added (attnum is per-table
   *                column ordinal that does not reset on DROP; new columns get higher attnums)
   *   rel_count  — COUNT(DISTINCT oid)    moves on CREATE/DROP of any relation
   *   attr_count — COUNT(attnum)          moves on ADD COLUMN or DROP COLUMN
   *
   * Together these detect ALTER TABLE ADD COLUMN which may not advance MAX(oid).
   * Stable across DML inserts/updates/deletes (US-009).
   * Issues exactly ONE query.
   *
   * @throws ConnectionError if close() was already called.
   */
  async fingerprint(): Promise<string> {
    if (this._closed) {
      throw new ConnectionError(
        'PgSchemaAdapter: fingerprint() called after close(). Create a new adapter.',
      );
    }

    const schemaParam = this._schema ?? null;
    const rows = await this._driver.query(SQL_PG_FINGERPRINT, [schemaParam]);
    const row = rows[0] as Record<string, unknown> | undefined;

    const maxOid = row !== undefined ? String(row['max_oid'] ?? 'null') : 'null';
    const maxAttnum = row !== undefined ? String(row['max_attnum'] ?? '0') : '0';
    const relCount = row !== undefined ? String(row['rel_count'] ?? '0') : '0';
    const attrCount = row !== undefined ? String(row['attr_count'] ?? '0') : '0';

    return createHash('sha256').update(`${maxOid}|${maxAttnum}|${relCount}|${attrCount}`).digest('hex');
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
