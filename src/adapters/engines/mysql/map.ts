/**
 * MySQL schema extraction mappers.
 * Design §map.ts "rows → deterministic sorted RawCatalog".
 *
 * buildMysqlRawCatalog(input, scope) assembles a deterministic RawCatalog from
 * pre-fetched information_schema row arrays (testable with JSON fixtures — no live DB here).
 *
 * Determinism (ADR-008):
 *   - objects      : sorted by (KIND_RANK, schema, name) — mirrors pg/map.ts
 *   - columns      : by ORDINAL_POSITION
 *   - constraints  : by name (sorted alphabetically)
 *   - FK columns   : by ORDINAL_POSITION; ref columns aligned by POSITION_IN_UNIQUE_CONSTRAINT
 *   - index columns: by SEQ_IN_INDEX (composite index ordering)
 *   - triggers     : grouped by name; events array from EVENT_MANIPULATION
 *   - schemas      : single connected database (schema == database)
 *
 * AUTO_INCREMENT modelled as column extra.autoIncrement:true (NO sequence object).
 * STORED/VIRTUAL GENERATED modelled as column extra.generated:true + generationKind.
 * Edges from bodies via tokenizeMysqlBody at confidence:'parsed' (no score).
 * supportsDependencyHints: false — body tokenizer is the SOLE edge source.
 *
 * US-029 (MySQL adapter, Phase 8b), US-007 (reads_from/writes_to),
 * ADR-008 (determinism), CRITICAL-1 (presence gate in tokenizer).
 */

import type { ExtractionScope } from '../../../core/model/capability.js';
import type {
  RawCatalog,
  RawObject,
  RawColumn,
  RawConstraint,
  RawIndex,
  RawTriggerInfo,
  RawDependency,
  RawParameter,
} from '../../../core/model/catalog.js';
import type { NodeKind } from '../../../core/model/node.js';
import { tokenizeMysqlBody } from './tokenizer.js';

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
// Row shape interfaces (matching information_schema query output from queries.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface MysqlTableRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly table_comment: string | null;
}

export interface MysqlColumnRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly ordinal_position: number;
  readonly column_name: string;
  readonly column_type: string;
  readonly is_nullable: string; // 'YES' | 'NO'
  readonly column_default: string | null;
  /** auto_increment / STORED GENERATED / VIRTUAL GENERATED / DEFAULT_GENERATED / '' */
  readonly extra: string;
  readonly generation_expression: string | null;
  readonly column_comment: string | null;
}

export interface MysqlPkUkColumnRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly constraint_type: string; // 'PRIMARY KEY' | 'UNIQUE'
  readonly column_name: string;
  readonly ordinal_position: number;
}

export interface MysqlFkColumnRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly column_name: string;
  readonly ordinal_position: number;
  readonly referenced_table_schema: string | null;
  readonly referenced_table_name: string | null;
  readonly referenced_column_name: string | null;
  readonly position_in_unique_constraint: number | null;
  readonly delete_rule: string | null;
  readonly update_rule: string | null;
}

export interface MysqlCheckConstraintRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly check_clause: string;
}

export interface MysqlStatisticsRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly index_name: string;
  readonly non_unique: number; // 0 = unique, 1 = non-unique
  readonly seq_in_index: number;
  readonly column_name: string | null;
  readonly expression: string | null;
  readonly sub_part: number | null;
  readonly index_type: string;
}

export interface MysqlViewRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly view_definition: string | null;
}

export interface MysqlRoutineRow {
  readonly routine_schema: string;
  readonly routine_name: string;
  readonly routine_type: string; // 'PROCEDURE' | 'FUNCTION'
  readonly routine_definition: string | null;
  readonly routine_comment: string | null;
}

export interface MysqlTriggerRow {
  readonly trigger_schema: string;
  readonly trigger_name: string;
  readonly event_manipulation: string; // 'INSERT' | 'UPDATE' | 'DELETE'
  readonly action_timing: string;      // 'BEFORE' | 'AFTER'
  readonly event_object_table: string;
  readonly action_statement: string | null;
}

export interface MysqlParameterRow {
  readonly routine_schema: string;
  readonly routine_name: string;        // SPECIFIC_NAME — join key to the routine
  readonly ordinal_position: number;    // 0 = FUNCTION return row (excluded)
  readonly parameter_name: string | null; // NULL for the return row
  readonly parameter_mode: string | null; // IN/OUT/INOUT; NULL for FUNCTION params ⇒ 'in'
  readonly data_type: string;           // DTD_IDENTIFIER — FULL type (int, varchar(20))
}

/**
 * Full set of pre-fetched information_schema row arrays passed to buildMysqlRawCatalog.
 * In production: populated by the adapter from MysqlReadonlyDriver queries.
 * In tests: populated directly from JSON fixtures (no live DB).
 */
export interface MysqlRowInput {
  /** The connected database name (schema == database for MySQL). */
  readonly database: string;
  readonly tables: readonly MysqlTableRow[];
  readonly columns: readonly MysqlColumnRow[];
  readonly pkUkColumns: readonly MysqlPkUkColumnRow[];
  readonly fkColumns: readonly MysqlFkColumnRow[];
  readonly checkConstraints: readonly MysqlCheckConstraintRow[];
  readonly statistics: readonly MysqlStatisticsRow[];
  readonly views: readonly MysqlViewRow[];
  readonly routines: readonly MysqlRoutineRow[];
  readonly triggers: readonly MysqlTriggerRow[];
  // DOG-2: information_schema.PARAMETERS rows. OPTIONAL so pre-DOG-2 callers/fixtures stay
  // valid and drift-free; buildRoutines treats absent as [] (every routine → known-zero []).
  readonly parameters?: readonly MysqlParameterRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ExtendedRawColumn — column with MySQL-specific extra fields
// ─────────────────────────────────────────────────────────────────────────────

type ExtendedRawColumn = RawColumn & { extra?: Readonly<Record<string, unknown>> };

// ─────────────────────────────────────────────────────────────────────────────
// Helper — table key
// ─────────────────────────────────────────────────────────────────────────────

function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column mapping
// ─────────────────────────────────────────────────────────────────────────────

function buildColumns(
  schema: string,
  tableName: string,
  allColumns: readonly MysqlColumnRow[],
): ExtendedRawColumn[] {
  const key = tableKey(schema, tableName);
  return allColumns
    .filter((c) => tableKey(c.table_schema, c.table_name) === key)
    .sort((a, b) => a.ordinal_position - b.ordinal_position)
    .map((c): ExtendedRawColumn => {
      // Determine extra for AUTO_INCREMENT / GENERATED columns
      const extraLower = c.extra.toLowerCase();

      let extra: Readonly<Record<string, unknown>> | undefined;
      if (extraLower.includes('auto_increment')) {
        extra = { autoIncrement: true };
      } else if (extraLower.includes('stored generated')) {
        extra = {
          generated: true,
          generationKind: 'STORED',
          ...(c.generation_expression !== null ? { generationExpression: c.generation_expression } : {}),
        };
      } else if (extraLower.includes('virtual generated')) {
        extra = {
          generated: true,
          generationKind: 'VIRTUAL',
          ...(c.generation_expression !== null ? { generationExpression: c.generation_expression } : {}),
        };
      }

      const col: ExtendedRawColumn = {
        name: c.column_name,
        dataType: c.column_type,
        nullable: c.is_nullable === 'YES',
        ordinal: c.ordinal_position,
        ...(c.column_default !== null ? { default: c.column_default } : {}),
        ...(c.column_comment !== null && c.column_comment !== '' ? { comment: c.column_comment } : {}),
        ...(extra !== undefined ? { extra } : {}),
      };
      return col;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Constraint mapping: PK / UNIQUE / FK / CHECK
// ─────────────────────────────────────────────────────────────────────────────

function buildConstraints(
  schema: string,
  tableName: string,
  pkUkRows: readonly MysqlPkUkColumnRow[],
  fkRows: readonly MysqlFkColumnRow[],
  checkRows: readonly MysqlCheckConstraintRow[],
): RawConstraint[] {
  const key = tableKey(schema, tableName);
  const constraints: RawConstraint[] = [];

  // ── PK / UNIQUE ────────────────────────────────────────────────────────────
  // Group by constraint name, then sort columns by ordinal_position
  const pkUkFiltered = pkUkRows
    .filter((r) => tableKey(r.table_schema, r.table_name) === key)
    .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name) || a.ordinal_position - b.ordinal_position);

  const pkUkGroups = new Map<string, MysqlPkUkColumnRow[]>();
  for (const row of pkUkFiltered) {
    const existing = pkUkGroups.get(row.constraint_name);
    if (existing !== undefined) {
      existing.push(row);
    } else {
      pkUkGroups.set(row.constraint_name, [row]);
    }
  }

  for (const [name, rows] of pkUkGroups) {
    const firstRow = rows[0]!;
    const type: 'PK' | 'UNIQUE' =
      firstRow.constraint_type === 'PRIMARY KEY' ? 'PK' : 'UNIQUE';
    const columns = rows.map((r) => r.column_name);
    constraints.push({ name, type, columns });
  }

  // ── FK ─────────────────────────────────────────────────────────────────────
  // Group by constraint name; local cols by ordinal_position, ref aligned by position_in_unique_constraint
  const fkFiltered = fkRows
    .filter((r) => tableKey(r.table_schema, r.table_name) === key)
    .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name) || a.ordinal_position - b.ordinal_position);

  const fkGroups = new Map<string, MysqlFkColumnRow[]>();
  for (const row of fkFiltered) {
    const existing = fkGroups.get(row.constraint_name);
    if (existing !== undefined) {
      existing.push(row);
    } else {
      fkGroups.set(row.constraint_name, [row]);
    }
  }

  for (const [name, rows] of fkGroups) {
    const firstRow = rows[0]!;
    // FK columns are already sorted by ordinal_position
    const localCols = rows.map((r) => r.column_name);
    // Ref columns aligned by position_in_unique_constraint (same sort order as ordinal_position)
    const refCols = rows.map((r) => r.referenced_column_name ?? '');
    constraints.push({
      name,
      type: 'FK',
      columns: localCols,
      references: {
        schema: firstRow.referenced_table_schema,
        table: firstRow.referenced_table_name ?? '',
        columns: refCols,
      },
    });
  }

  // ── CHECK ──────────────────────────────────────────────────────────────────
  const checkFiltered = checkRows
    .filter((r) => tableKey(r.table_schema, r.table_name) === key)
    .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name));

  for (const row of checkFiltered) {
    constraints.push({
      name: row.constraint_name,
      type: 'CHECK',
      columns: [],
      definition: row.check_clause,
    });
  }

  // Sort all constraints alphabetically by name for determinism
  return constraints.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Index mapping (from STATISTICS rows — grouped by INDEX_NAME)
// ─────────────────────────────────────────────────────────────────────────────

function buildIndexes(
  schema: string,
  tableName: string,
  statisticsRows: readonly MysqlStatisticsRow[],
): (RawIndex & { extra?: Record<string, unknown> })[] {
  const key = tableKey(schema, tableName);
  const filtered = statisticsRows
    .filter((r) => tableKey(r.table_schema, r.table_name) === key)
    .sort((a, b) =>
      a.index_name.localeCompare(b.index_name) || a.seq_in_index - b.seq_in_index,
    );

  // Group by index name
  const groups = new Map<string, MysqlStatisticsRow[]>();
  for (const row of filtered) {
    const existing = groups.get(row.index_name);
    if (existing !== undefined) {
      existing.push(row);
    } else {
      groups.set(row.index_name, [row]);
    }
  }

  const indexes: (RawIndex & { extra?: Record<string, unknown> })[] = [];
  for (const [name, rows] of groups) {
    const firstRow = rows[0]!;
    const unique = firstRow.non_unique === 0;

    // Columns: use column_name when non-null; expression indexes have null column_name
    const columns: string[] = [];
    for (const row of rows) {
      if (row.column_name !== null) {
        columns.push(row.column_name);
      }
    }

    const extra: Record<string, unknown> = {};

    // Functional/expression index: any row has non-null EXPRESSION
    const exprRow = rows.find((r) => r.expression !== null);
    if (exprRow !== undefined) {
      extra['expression'] = exprRow.expression;
    }

    // Prefix index: any row has non-null SUB_PART
    const subPartRow = rows.find((r) => r.sub_part !== null);
    if (subPartRow !== undefined) {
      extra['subPart'] = subPartRow.sub_part;
    }

    const idx: RawIndex & { extra?: Record<string, unknown> } = {
      name,
      unique,
      columns,
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
    indexes.push(idx);
  }

  // Sort indexes by name for determinism
  return indexes.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Table extraction
// ─────────────────────────────────────────────────────────────────────────────

function buildTables(
  input: MysqlRowInput,
  scope: ExtractionScope,
): RawObject[] {
  if (scope.levels.tables === 'off') return [];

  return input.tables.map((tableRow): RawObject => {
    const columns = buildColumns(tableRow.table_schema, tableRow.table_name, input.columns);
    const constraints = buildConstraints(
      tableRow.table_schema,
      tableRow.table_name,
      input.pkUkColumns,
      input.fkColumns,
      input.checkConstraints,
    );
    const indexes = buildIndexes(tableRow.table_schema, tableRow.table_name, input.statistics);

    const obj: RawObject = {
      kind: 'table',
      schema: tableRow.table_schema,
      name: tableRow.table_name,
      columns: columns as RawColumn[],
      constraints,
      indexes: indexes as RawIndex[],
      ...(tableRow.table_comment !== null && tableRow.table_comment !== ''
        ? { comment: tableRow.table_comment }
        : {}),
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// View extraction
// ─────────────────────────────────────────────────────────────────────────────

function buildViews(
  input: MysqlRowInput,
  scope: ExtractionScope,
  potentialDeps: readonly { schema: string; name: string }[],
): RawObject[] {
  const level = scope.levels.views;
  if (level === 'off') return [];

  const includeBody = level === 'full';

  return input.views.map((viewRow): RawObject => {
    const body = includeBody ? (viewRow.view_definition ?? undefined) : undefined;

    let dependencies: readonly RawDependency[] | undefined;
    if (includeBody && body !== undefined) {
      const result = tokenizeMysqlBody(body, potentialDeps);
      if (result.dependencies.length > 0) {
        dependencies = result.dependencies;
      }
    }

    const obj: RawObject = {
      kind: 'view',
      schema: viewRow.table_schema,
      name: viewRow.table_name,
      ...(body !== undefined ? { body } : {}),
      ...(dependencies !== undefined && dependencies.length > 0 ? { dependencies } : {}),
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Routine extraction (functions + procedures)
// ─────────────────────────────────────────────────────────────────────────────

/** DOG-2 §4.3: PARAMETER_MODE → direction. NULL (FUNCTION params) ⇒ 'in'. */
function mysqlParamDirection(mode: string | null): RawParameter['direction'] {
  switch ((mode ?? 'IN').toUpperCase()) {
    case 'OUT':   return 'out';
    case 'INOUT': return 'inout';
    default:      return 'in'; // IN or NULL (function params, implicitly IN)
  }
}

/**
 * Builds a `schema.routine_name` → ordinal-ordered RawParameter[] map from
 * information_schema.PARAMETERS rows. DOG-2 §4.3/D6: ORDINAL_POSITION=0 return row is filtered
 * defensively; ordinal is the CONTIGUOUS 1..N position among emitted params. dataType is the
 * FULL DTD_IDENTIFIER (D5); hasDefault is NEVER emitted (no default column — HONESTY).
 */
function buildMysqlParameterMap(rows: readonly MysqlParameterRow[]): Map<string, RawParameter[]> {
  const map = new Map<string, RawParameter[]>();
  const sorted = rows
    .filter((p) => p.ordinal_position > 0)
    .slice()
    .sort((a, b) => a.ordinal_position - b.ordinal_position);
  for (const p of sorted) {
    const key = `${p.routine_schema}.${p.routine_name}`;
    let list = map.get(key);
    if (list === undefined) {
      list = [];
      map.set(key, list);
    }
    list.push({
      name: p.parameter_name ?? '',
      dataType: p.data_type,
      direction: mysqlParamDirection(p.parameter_mode),
      ordinal: list.length + 1,
    });
  }
  return map;
}

function buildRoutines(
  input: MysqlRowInput,
  scope: ExtractionScope,
): RawObject[] {
  const objects: RawObject[] = [];
  const paramMap = buildMysqlParameterMap(input.parameters ?? []);

  for (const row of input.routines) {
    const kind: NodeKind = row.routine_type === 'PROCEDURE' ? 'procedure' : 'function';

    let level: 'off' | 'metadata' | 'full';
    if (kind === 'function') {
      level = scope.levels.functions;
    } else {
      level = scope.levels.procedures;
    }
    if (level === 'off') continue;

    const includeBody = level === 'full';
    const body = includeBody ? (row.routine_definition ?? undefined) : undefined;

    let dependencies: readonly RawDependency[] | undefined;
    let hasDynSql: boolean | undefined;

    if (includeBody && body !== undefined) {
      // DOG-1 (D3/D4): extend the candidate list with ROUTINE names (carrying `kind`) so a
      // `CALL proc()` / `SELECT fn()` resolves to a `calls` edge. Self-exclusion is applied
      // UNIFORMLY (mirrors pg, D4) for determinism — mysql `ROUTINE_DEFINITION` is body-only,
      // but the filter guarantees a routine never `calls` itself.
      const routineCandidates = input.routines
        .filter((r) => !(r.routine_schema === row.routine_schema && r.routine_name === row.routine_name))
        .map((r) => ({
          schema: r.routine_schema,
          name: r.routine_name,
          kind: (r.routine_type === 'PROCEDURE' ? 'procedure' : 'function') as 'procedure' | 'function',
        }));
      const potentialDeps = [
        ...input.tables.map((t) => ({ schema: t.table_schema, name: t.table_name })),
        ...input.views.map((v) => ({ schema: v.table_schema, name: v.table_name })),
        ...routineCandidates,
      ];
      const result = tokenizeMysqlBody(body, potentialDeps);
      if (result.hasDynamicSql) {
        hasDynSql = true;
      }
      if (result.dependencies.length > 0) {
        dependencies = result.dependencies;
      }
    }

    // DOG-2 §4.3: every routine carries a parameters array — the mapped params, or [] for a
    // real no-argument routine (known-zero, NOT unset; mysql always has a parameter catalog).
    const parameters = paramMap.get(`${row.routine_schema}.${row.routine_name}`) ?? [];

    const obj: RawObject = {
      kind,
      schema: row.routine_schema,
      name: row.routine_name,
      ...(body !== undefined ? { body } : {}),
      ...(hasDynSql !== undefined ? { hasDynamicSql: hasDynSql } : {}),
      ...(dependencies !== undefined && dependencies.length > 0 ? { dependencies } : {}),
      parameters,
      ...(row.routine_comment !== null && row.routine_comment !== '' ? { comment: row.routine_comment } : {}),
    };
    objects.push(obj);
  }

  return objects;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger extraction
// ─────────────────────────────────────────────────────────────────────────────

function buildTriggers(
  input: MysqlRowInput,
  scope: ExtractionScope,
): RawObject[] {
  const level = scope.levels.triggers;
  if (level === 'off') return [];

  const includeBody = level === 'full';

  return input.triggers.map((row): RawObject => {
    // MySQL trigger has direct timing + event fields (no bitmask decode needed — D8)
    const timing = row.action_timing as 'BEFORE' | 'AFTER';
    const event = row.event_manipulation as 'INSERT' | 'UPDATE' | 'DELETE';

    const triggerInfo: RawTriggerInfo = {
      timing,
      events: [event],
      table: {
        schema: row.trigger_schema,
        name: row.event_object_table,
      },
    };

    const body = includeBody ? (row.action_statement ?? undefined) : undefined;

    const obj: RawObject = {
      kind: 'trigger',
      schema: row.trigger_schema,
      name: row.trigger_name,
      trigger: triggerInfo,
      ...(body !== undefined ? { body } : {}),
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// buildMysqlRawCatalog — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a deterministic RawCatalog from pre-fetched information_schema row arrays.
 * Mirrors buildPgRawCatalog() from pg/map.ts in structure and ordering contract.
 *
 * schema == database: every object carries the connected database as its schema.
 * RawCatalog.schemas = [database] (the single connected database).
 * AUTO_INCREMENT is a column extra, never a sequence object.
 *
 * @param input  Pre-fetched information_schema rows (from driver in production; from fixtures in tests)
 * @param scope  Resolved extraction scope (levels for each object type)
 */
export function buildMysqlRawCatalog(
  input: MysqlRowInput,
  scope: ExtractionScope,
): RawCatalog {
  // Build potential deps list for body tokenization (tables + views as dep targets)
  const potentialDeps = [
    ...input.tables.map((t) => ({ schema: t.table_schema, name: t.table_name })),
    ...input.views.map((v) => ({ schema: v.table_schema, name: v.table_name })),
  ];

  const objects: RawObject[] = [];

  // Tables (always if not 'off')
  objects.push(...buildTables(input, scope));

  // Views
  objects.push(...buildViews(input, scope, potentialDeps));

  // Routines: functions + procedures (each filtered by its own scope level)
  objects.push(...buildRoutines(input, scope));

  // Triggers
  objects.push(...buildTriggers(input, scope));

  // Sort deterministically by (kindRank, schema, name) — ADR-008
  objects.sort(compareObjects);

  return {
    engine: 'mysql',
    schemas: [input.database],
    objects,
  };
}
