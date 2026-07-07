/**
 * SQLite schema extraction mappers.
 * Design §mapping "object by object → RawCatalog" + locked decisions 3–7.
 *
 * Every public function takes a ReadonlyDriver and returns RawObject fragments.
 * buildRawCatalog() assembles the full deterministic RawCatalog.
 *
 * Determinism (ADR-008 / locked decision 5):
 *   - objects: sorted by (kind-rank, schema, name)
 *   - columns: by ordinal
 *   - constraints / indexes: by name
 *   - FK/index columns: preserve SQLite's declared seqno order
 *   - schemas: ['main']
 */

import type { ReadonlyDriver } from './driver.js';
import type { ExtractionScope } from '../../../core/model/capability.js';
import type {
  RawCatalog,
  RawObject,
  RawColumn,
  RawConstraint,
  RawIndex,
  RawTriggerInfo,
  RawDependency,
} from '../../../core/model/catalog.js';
import type { NodeKind } from '../../../core/model/node.js';
import {
  SQL_TABLES,
  SQL_VIEWS,
  SQL_TRIGGERS,
  PRAGMA_TABLE_INFO,
  PRAGMA_FOREIGN_KEY_LIST,
  PRAGMA_INDEX_LIST,
  PRAGMA_INDEX_INFO,
} from './queries.js';
import { tokenizeSqliteBody, extractTriggerActionBlock } from './tokenizer.js';

/** Candidate object reference for body tokenization (schema + bare name). */
interface DepCandidate {
  readonly schema: string;
  readonly name: string;
}

/**
 * Builds the deterministic candidate list for body tokenization (Design D3):
 * ALL tables + ALL views, name-sorted. Reads only the sqlite_master NAME rows that
 * extraction already consumes — no new query type, no dependency PRAGMA (SQLite has none).
 * A view/trigger body never matches its OWN qname because the caller excludes self
 * (view bodies from sqlite_master include the CREATE VIEW <name> AS header).
 */
function buildPotentialDeps(driver: ReadonlyDriver): DepCandidate[] {
  const tableRows = driver.all(SQL_TABLES) as unknown as MasterRow[];
  const viewRows = driver.all(SQL_VIEWS) as unknown as MasterRow[];
  return [...tableRows, ...viewRows]
    .map((r): DepCandidate => ({ schema: 'main', name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Kind rank for deterministic ordering (locked decision 5)
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
// Internal PRAGMA row shapes
// ─────────────────────────────────────────────────────────────────────────────

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface FkListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
}

interface MasterRow {
  name: string;
  sql: string | null;
}

interface TriggerMasterRow extends MasterRow {
  tbl_name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 — Tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts all user tables from sqlite_master.
 * WITHOUT ROWID tables are flagged with extra.withoutRowid = true.
 */
export function extractTables(driver: ReadonlyDriver): RawObject[] {
  const rows = driver.all(SQL_TABLES) as unknown as MasterRow[];

  return rows.map((row) => {
    const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(row.sql ?? '');
    const obj: RawObject = {
      kind: 'table',
      schema: 'main',
      name: row.name,
      columns: extractColumns(driver, row.name),
      constraints: [
        ...extractPrimaryKeys(driver, row.name),
        ...extractForeignKeys(driver, row.name),
        ...extractUniqueConstraints(driver, row.name),
      ].sort((a, b) => a.name.localeCompare(b.name)),
      indexes: extractIndexes(driver, row.name).sort((a, b) => a.name.localeCompare(b.name)),
      ...(withoutRowid ? { extra: { withoutRowid: true } } : {}),
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 — Columns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts columns for a given table from PRAGMA table_info.
 * dataType is preserved as-is (affinity honesty — '' when typeless, no invention).
 * nullable = notnull === 0.
 * default = dflt_value (null when absent).
 * ordinal = cid.
 */
export function extractColumns(driver: ReadonlyDriver, tableName: string): RawColumn[] {
  const rows = driver.pragma(PRAGMA_TABLE_INFO(tableName)) as unknown as TableInfoRow[];

  return rows
    .sort((a, b) => a.cid - b.cid)
    .map((row) => {
      const col: RawColumn = {
        name: row.name,
        dataType: row.type ?? '',
        nullable: row.notnull === 0,
        ordinal: row.cid,
        ...(row.dflt_value !== null && row.dflt_value !== undefined
          ? { default: row.dflt_value }
          : { default: null }),
      };
      return col;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 — Primary Keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the primary key constraint from PRAGMA table_info rows.
 * Returns a single RawConstraint with type='PK' if any column has pk > 0.
 * Composite PKs produce one constraint with all PK columns, ordered by pk asc.
 */
export function extractPrimaryKeys(driver: ReadonlyDriver, tableName: string): RawConstraint[] {
  const rows = driver.pragma(PRAGMA_TABLE_INFO(tableName)) as unknown as TableInfoRow[];
  const pkRows = rows.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk);

  if (pkRows.length === 0) return [];

  const constraint: RawConstraint = {
    name: `pk_${tableName}`,
    type: 'PK',
    columns: pkRows.map((r) => r.name),
  };
  return [constraint];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.3 — Foreign Keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts foreign keys from PRAGMA foreign_key_list.
 * Groups rows by `id` (one FK per id; multiple rows = composite).
 * Orders target columns by `seq` (SQLite's declared order).
 * Produces ONE RawConstraint per FK id.
 */
export function extractForeignKeys(driver: ReadonlyDriver, tableName: string): RawConstraint[] {
  const rows = driver.pragma(PRAGMA_FOREIGN_KEY_LIST(tableName)) as unknown as FkListRow[];

  if (rows.length === 0) return [];

  // Group by FK id
  const grouped = new Map<number, FkListRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.id);
    if (group !== undefined) {
      group.push(row);
    } else {
      grouped.set(row.id, [row]);
    }
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([id, fkRows]) => {
      const sorted = fkRows.sort((a, b) => a.seq - b.seq);
      const refTable = sorted[0]!.table;
      const constraint: RawConstraint = {
        name: `fk_${tableName}_${id}`,
        type: 'FK',
        columns: sorted.map((r) => r.from),
        references: {
          schema: 'main',
          table: refTable,
          columns: sorted.map((r) => r.to),
        },
      };
      return constraint;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.4 — Indexes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts indexes from PRAGMA index_list + index_info.
 * - Skips sqlite_autoindex_* (design: justified skip — they double-count PK/UNIQUE).
 * - Partial index: extra.where parsed from sqlite_master.sql WHERE clause.
 * - Expression columns: index_info.name null → '(expr)' placeholder (honest, NOT a fake column).
 */
export function extractIndexes(driver: ReadonlyDriver, tableName: string): (RawIndex & { extra?: Record<string, unknown> })[] {
  const listRows = driver.pragma(PRAGMA_INDEX_LIST(tableName)) as unknown as IndexListRow[];
  // Get all index SQL from sqlite_master for WHERE clause extraction
  const masterRows = driver.all(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
    tableName,
  ) as unknown as MasterRow[];
  const masterByName = new Map(masterRows.map((r) => [r.name, r.sql]));

  const result: (RawIndex & { extra?: Record<string, unknown> })[] = [];

  for (const listRow of listRows) {
    // Skip autoindexes — they are implementation artifacts of PK/UNIQUE constraints
    if (listRow.name.startsWith('sqlite_autoindex_')) continue;

    const infoRows = driver.pragma(PRAGMA_INDEX_INFO(listRow.name)) as unknown as IndexInfoRow[];
    const columns = infoRows
      .sort((a, b) => a.seqno - b.seqno)
      .map((r) => (r.name === null || r.name === undefined ? '(expr)' : r.name));

    const indexSql = masterByName.get(listRow.name) ?? null;
    const whereMatch = indexSql !== null ? /WHERE\s+(.+)$/is.exec(indexSql) : null;
    const where = whereMatch !== null ? whereMatch[1]!.trim() : undefined;

    const idx: RawIndex & { extra?: Record<string, unknown> } = {
      name: listRow.name,
      unique: listRow.unique === 1,
      columns,
      ...(where !== undefined ? { extra: { where } } : {}),
    };

    result.push(idx);
  }

  return result;
}

/**
 * Emits UNIQUE constraints for all unique indexes that are NOT autoindexes.
 * This covers both:
 *   origin='c' — an explicit CREATE UNIQUE INDEX statement
 *   origin='u' — an inline UNIQUE constraint on the CREATE TABLE (creates sqlite_autoindex_*,
 *                which we skip since the name starts with sqlite_autoindex_)
 * The net effect: any user-named unique index is also surfaced as RawConstraint{type:'UNIQUE'}
 * so the normalizer can model uniqueness separate from the index object itself.
 */
export function extractUniqueConstraints(driver: ReadonlyDriver, tableName: string): RawConstraint[] {
  const listRows = driver.pragma(PRAGMA_INDEX_LIST(tableName)) as unknown as IndexListRow[];

  const result: RawConstraint[] = [];

  for (const listRow of listRows) {
    // Skip internal autoindex names (sqlite_autoindex_*) — they are PK/UNIQUE artifacts
    if (listRow.name.startsWith('sqlite_autoindex_')) continue;
    // Only emit constraint for unique indexes
    if (listRow.unique !== 1) continue;

    const infoRows = driver.pragma(PRAGMA_INDEX_INFO(listRow.name)) as unknown as IndexInfoRow[];
    const columns = infoRows
      .sort((a, b) => a.seqno - b.seqno)
      .map((r) => (r.name === null || r.name === undefined ? '(expr)' : r.name));

    result.push({
      name: listRow.name,
      type: 'UNIQUE',
      columns,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.5 — Views
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts views from sqlite_master.
 * body is level-gated: included only when levels.views === 'full'.
 *
 * When the body is present, it is tokenized against the candidate list (all tables +
 * views, self excluded) via the shared presence-gate tokenizer → depends_on read deps.
 * A view read dependency normalizes to `depends_on` (reference-resolver §buildDependencyEdges).
 * The candidate list EXCLUDES the view own qname because the sqlite_master body includes
 * the `CREATE VIEW <name> AS` header (unlike pg/mysql catalog bodies) — this is what keeps
 * the no-self-edge invariant (Design D3, spec "No self-edges and no phantom edges").
 */
export function extractViews(
  driver: ReadonlyDriver,
  scope: ExtractionScope,
  potentialDeps: readonly DepCandidate[] = buildPotentialDeps(driver),
): RawObject[] {
  const rows = driver.all(SQL_VIEWS) as unknown as MasterRow[];
  const includeBody = scope.levels.views === 'full';

  return rows.map((row) => {
    const body = includeBody && row.sql !== null ? row.sql : undefined;

    let dependencies: readonly RawDependency[] = [];
    if (body !== undefined) {
      const candidates = potentialDeps.filter(
        (d) => !(d.schema === 'main' && d.name === row.name),
      );
      dependencies = tokenizeSqliteBody(body, candidates);
    }

    const obj: RawObject = {
      kind: 'view',
      schema: 'main',
      name: row.name,
      ...(body !== undefined ? { body } : {}),
      dependencies,
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.6 — Triggers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tolerant parse of a trigger SQL string to extract:
 * - timing: BEFORE | AFTER | INSTEAD OF
 * - events: INSERT | UPDATE | DELETE (UPDATE OF → UPDATE)
 * - target table: ON <table>
 */
function parseTriggerInfo(
  sql: string,
  tblName: string,
): RawTriggerInfo | undefined {
  // Timing: BEFORE, AFTER, INSTEAD OF
  const timingMatch = /\b(BEFORE|AFTER|INSTEAD\s+OF)\b/i.exec(sql);
  if (timingMatch === null) return undefined;
  const timingRaw = timingMatch[1]!.replace(/\s+/g, ' ').toUpperCase();
  const timing: RawTriggerInfo['timing'] =
    timingRaw === 'INSTEAD OF' ? 'INSTEAD OF' :
    timingRaw === 'BEFORE' ? 'BEFORE' :
    'AFTER';

  // Events: INSERT, UPDATE (or UPDATE OF), DELETE — in the header before BEGIN
  const header = sql.split(/\bBEGIN\b/i)[0] ?? sql;
  const events: Set<'INSERT' | 'UPDATE' | 'DELETE'> = new Set();
  if (/\bINSERT\b/i.test(header)) events.add('INSERT');
  if (/\bUPDATE\b/i.test(header)) events.add('UPDATE');
  if (/\bDELETE\b/i.test(header)) events.add('DELETE');

  // Target table: ON <tablename>
  const onMatch = /\bON\s+(\w+)\b/i.exec(header);
  const targetTable = onMatch !== null ? onMatch[1]! : tblName;

  return {
    timing,
    events: Array.from(events),
    table: { schema: 'main', name: targetTable },
  };
}

/**
 * Extracts triggers from sqlite_master.
 * body is level-gated: included only when levels.triggers === 'full'.
 *
 * When the body is present, the CREATE TRIGGER header is stripped via
 * extractTriggerActionBlock (Design D2) so the `ON <target>` fires_on object never reaches
 * the tokenizer; only the `BEGIN…END` action block is tokenized → writes_to (INSERT/UPDATE/
 * DELETE targets) and reads_from (read targets). The candidate list is the full tables+views
 * set (a trigger name is never itself a candidate, so no self-edge is possible).
 */
export function extractTriggers(
  driver: ReadonlyDriver,
  scope: ExtractionScope,
  potentialDeps: readonly DepCandidate[] = buildPotentialDeps(driver),
): RawObject[] {
  const rows = driver.all(SQL_TRIGGERS) as unknown as TriggerMasterRow[];
  const includeBody = scope.levels.triggers === 'full';

  return rows.map((row) => {
    const triggerInfo = row.sql !== null ? parseTriggerInfo(row.sql, row.tbl_name) : undefined;

    const body = includeBody && row.sql !== null ? row.sql : undefined;
    let dependencies: readonly RawDependency[] = [];
    if (body !== undefined) {
      const actionBlock = extractTriggerActionBlock(body);
      if (actionBlock !== '') {
        dependencies = tokenizeSqliteBody(actionBlock, potentialDeps);
      }
    }

    const obj: RawObject = {
      kind: 'trigger',
      schema: 'main',
      name: row.name,
      ...(body !== undefined ? { body } : {}),
      ...(triggerInfo !== undefined ? { trigger: triggerInfo } : {}),
      dependencies,
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.7 — buildRawCatalog (deterministic assembly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a deterministic RawCatalog from the materialized source database.
 * - schemas: ['main']  (SQLite has no namespaces beyond the implicit 'main')
 * - objects: sorted by (kind-rank, schema, name)
 * - Skips object types whose level = 'off'
 */
export function buildRawCatalog(
  driver: ReadonlyDriver,
  scope: ExtractionScope,
): RawCatalog {
  const objects: RawObject[] = [];

  // Candidate list for body tokenization (all tables + views, name-sorted, D3).
  // Computed once and shared by extractViews/extractTriggers for determinism + no re-query.
  const potentialDeps = buildPotentialDeps(driver);

  // Tables (always extracted if level !== 'off')
  if (scope.levels.tables !== 'off') {
    objects.push(...extractTables(driver));
  }

  // Views (skip if 'off')
  if (scope.levels.views !== 'off') {
    objects.push(...extractViews(driver, scope, potentialDeps));
  }

  // Triggers (skip if 'off')
  if (scope.levels.triggers !== 'off') {
    objects.push(...extractTriggers(driver, scope, potentialDeps));
  }

  // Sort deterministically
  objects.sort(compareObjects);

  return {
    engine: 'sqlite',
    schemas: ['main'],
    objects,
  };
}
