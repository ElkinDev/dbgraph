/**
 * SQL Server schema extraction mappers.
 * Design §map.ts "rows → RawObject[]" per family — mirrors sqlite/map.ts structure.
 *
 * buildMssqlRawCatalog(input, scope) assembles a deterministic RawCatalog
 * from pre-fetched sys.* row arrays (ReadonlyDriver-shaped input, but fully
 * testable with JSON fixtures because no live DB call is made here).
 *
 * Determinism (ADR-008):
 *   - objects: sorted by (KIND_RANK, schema, name)
 *   - columns: by column_id (ordinal)
 *   - constraints: by name
 *   - FK/index columns: by constraint_column_id / index_column_id
 *   - schemas: derived from distinct schema names in table/module/sequence rows
 *
 * US-027 (extraction), US-007 (tokenizer wiring for dep classification).
 */

import type { ExtractionScope } from '../../../core/model/capability.js';
import type {
  RawCatalog,
  RawObject,
  RawColumn,
  RawConstraint,
  RawIndex,
  RawTriggerInfo,
  RawParameter,
} from '../../../core/model/catalog.js';
import type { NodeKind } from '../../../core/model/node.js';
import { tokenizeModuleDeps } from './tokenizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Kind rank for deterministic ordering (mirrors sqlite/map.ts KIND_RANK)
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
// Row shape interfaces (matching the query output from queries.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface TableRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly object_id: number;
}

export interface ColumnRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly column_id: number;
  readonly column_name: string;
  readonly data_type: string;
  readonly max_length: number;
  readonly precision: number;
  readonly scale: number;
  readonly is_nullable: boolean;
  readonly is_computed: boolean;
  readonly computed_definition: string | null;
  readonly default_definition: string | null;
}

export interface KeyConstraintRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly constraint_type: string; // 'PK' | 'UQ'
  readonly column_name: string;
  readonly key_ordinal: number;
}

export interface FkRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly fk_id: number;
  readonly ref_schema_name: string;
  readonly ref_table_name: string;
  readonly local_column: string;
  readonly ref_column: string;
  readonly constraint_column_id: number;
}

export interface CheckRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly constraint_name: string;
  readonly definition: string;
}

export interface IndexRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly index_name: string;
  readonly is_unique: boolean;
  readonly is_primary_key: boolean;
  readonly is_unique_constraint: boolean;
  readonly type_desc: string;
  readonly filter_definition: string | null;
  readonly column_name: string;
  readonly key_ordinal: number;
  readonly index_column_id: number;
  readonly is_included_column: boolean;
}

export interface ModuleRow {
  readonly schema_name: string;
  readonly object_name: string;
  readonly object_type: string; // 'V' | 'P' | 'FN' | 'IF' | 'TF' | 'TR'
  readonly object_id: number;
  readonly definition: string | null;
}

export interface TriggerEventRow {
  readonly trigger_id: number;
  readonly trigger_name: string;
  readonly parent_object_id: number;
  readonly is_instead_of_trigger: boolean;
  readonly event_type: string; // 'INSERT' | 'UPDATE' | 'DELETE'
}

export interface ParameterRow {
  readonly schema_name: string;
  readonly object_name: string;
  readonly object_id: number;
  readonly parameter_id: number;   // 0 = scalar-function return row (excluded)
  readonly parameter_name: string; // verbatim, keeps '@'
  readonly data_type: string;      // BARE sys.types.name (int / nvarchar / decimal)
  readonly is_output: boolean;     // 1 → 'out', 0 → 'in' (never 'inout')
  readonly has_default_value: boolean;
}

export interface SequenceRow {
  readonly schema_name: string;
  readonly sequence_name: string;
  readonly data_type: string;
  readonly start_value: string;
  readonly increment: string;
  readonly minimum_value: string;
  readonly maximum_value: string;
  readonly is_cycling: boolean;
}

export interface ExtendedPropRow {
  readonly schema_name: string;
  readonly object_name: string;
  readonly column_id: number;  // 0 = object-level, >0 = column-level
  readonly column_name: string | null;
  readonly description: string;
}

export interface DepRow {
  readonly schema_name: string;
  readonly object_name: string;
  readonly object_type: string;
  readonly ref_schema_name: string | null;
  readonly ref_object_name: string | null;
  readonly ref_object_id: number | null;
  // sys.objects.type (CHAR(2)) of the REFERENCED object, via LEFT JOIN sys.objects on
  // referenced_id. Null for unresolved / cross-database refs (NULL referenced_id). DOG-1 (D2).
  readonly ref_object_type: string | null;
}

/**
 * The full set of pre-fetched sys.* row arrays passed to buildMssqlRawCatalog.
 * In production this is populated by the adapter from MssqlReadonlyDriver queries.
 * In tests it is populated directly from JSON fixtures.
 */
export interface MssqlRowInput {
  readonly tables: readonly TableRow[];
  readonly columns: readonly ColumnRow[];
  readonly keyConstraints: readonly KeyConstraintRow[];
  readonly foreignKeys: readonly FkRow[];
  readonly checkConstraints: readonly CheckRow[];
  readonly indexes: readonly IndexRow[];
  readonly modules: readonly ModuleRow[];
  readonly triggerEvents: readonly TriggerEventRow[];
  readonly sequences: readonly SequenceRow[];
  readonly extendedProperties: readonly ExtendedPropRow[];
  readonly dependencies: readonly DepRow[];
  // DOG-2: sys.parameters rows (one per parameter). OPTIONAL so existing callers/fixtures
  // that predate DOG-2 stay valid and drift-free; buildModules treats absent as [].
  readonly parameters?: readonly ParameterRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Object-type → NodeKind mapping
// ─────────────────────────────────────────────────────────────────────────────

function moduleTypeToKind(type: string): NodeKind | null {
  switch (type.trim()) {
    case 'V':  return 'view';
    case 'P':  return 'procedure';
    case 'FN':
    case 'IF':
    case 'TF': return 'function';
    case 'TR': return 'trigger';
    default:   return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Table key helpers
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
  allColumns: readonly ColumnRow[],
  comments: ReadonlyMap<string, string>,
): (RawColumn & { extra?: Readonly<Record<string, unknown>> })[] {
  const key = tableKey(schema, tableName);
  return allColumns
    .filter((c) => tableKey(c.schema_name, c.table_name) === key)
    .sort((a, b) => a.column_id - b.column_id)
    .map((c) => {
      // Computed column: surface in extra (RawColumn has no extra field, use intersection)
      const computedExtra: Readonly<Record<string, unknown>> | undefined = c.is_computed
        ? {
            computed: true,
            ...(c.computed_definition !== null ? { definition: c.computed_definition } : {}),
          }
        : undefined;

      // Comment from MS_Description (RawColumn.comment is readonly — must be in factory)
      const commentKey = `${key}.${c.column_name}`;
      const comment = comments.get(commentKey);

      const col: RawColumn & { extra?: Readonly<Record<string, unknown>> } = {
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.is_nullable,
        ordinal: c.column_id,
        ...(c.default_definition !== null ? { default: c.default_definition } : {}),
        ...(comment !== undefined ? { comment } : {}),
        ...(computedExtra !== undefined ? { extra: computedExtra } : {}),
      };
      return col;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Constraint mapping
// ─────────────────────────────────────────────────────────────────────────────

function buildKeyConstraints(
  schema: string,
  tableName: string,
  rows: readonly KeyConstraintRow[],
): RawConstraint[] {
  const key = tableKey(schema, tableName);
  const filtered = rows.filter((r) => tableKey(r.schema_name, r.table_name) === key);

  // Group by constraint name
  const grouped = new Map<string, KeyConstraintRow[]>();
  for (const row of filtered) {
    const group = grouped.get(row.constraint_name);
    if (group !== undefined) {
      group.push(row);
    } else {
      grouped.set(row.constraint_name, [row]);
    }
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, constraintRows]) => {
      const sorted = constraintRows.sort((a, b) => a.key_ordinal - b.key_ordinal);
      const rawType = sorted[0]!.constraint_type;
      const type: 'PK' | 'UNIQUE' = rawType === 'PK' ? 'PK' : 'UNIQUE';
      const constraint: RawConstraint = {
        name,
        type,
        columns: sorted.map((r) => r.column_name),
      };
      return constraint;
    });
}

function buildFkConstraints(
  schema: string,
  tableName: string,
  rows: readonly FkRow[],
): RawConstraint[] {
  const key = tableKey(schema, tableName);
  const filtered = rows.filter((r) => tableKey(r.schema_name, r.table_name) === key);

  // Group by fk_id (multiple rows per composite FK)
  const grouped = new Map<number, FkRow[]>();
  for (const row of filtered) {
    const group = grouped.get(row.fk_id);
    if (group !== undefined) {
      group.push(row);
    } else {
      grouped.set(row.fk_id, [row]);
    }
  }

  return Array.from(grouped.entries())
    .sort(([, aRows], [, bRows]) => aRows[0]!.constraint_name.localeCompare(bRows[0]!.constraint_name))
    .map(([, fkRows]) => {
      const sorted = fkRows.sort((a, b) => a.constraint_column_id - b.constraint_column_id);
      const first = sorted[0]!;
      const constraint: RawConstraint = {
        name: first.constraint_name,
        type: 'FK',
        columns: sorted.map((r) => r.local_column),
        references: {
          schema: first.ref_schema_name,
          table: first.ref_table_name,
          columns: sorted.map((r) => r.ref_column),
        },
      };
      return constraint;
    });
}

function buildCheckConstraints(
  schema: string,
  tableName: string,
  rows: readonly CheckRow[],
): RawConstraint[] {
  const key = tableKey(schema, tableName);
  return rows
    .filter((r) => tableKey(r.schema_name, r.table_name) === key)
    .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name))
    .map((r) => ({
      name: r.constraint_name,
      type: 'CHECK' as const,
      columns: [],
      definition: r.definition,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Index mapping
// ─────────────────────────────────────────────────────────────────────────────

function buildIndexes(
  schema: string,
  tableName: string,
  rows: readonly IndexRow[],
): (RawIndex & { extra?: Record<string, unknown> })[] {
  const key = tableKey(schema, tableName);
  const filtered = rows.filter((r) => tableKey(r.schema_name, r.table_name) === key);

  // Group by index name
  const grouped = new Map<string, IndexRow[]>();
  for (const row of filtered) {
    const group = grouped.get(row.index_name);
    if (group !== undefined) {
      group.push(row);
    } else {
      grouped.set(row.index_name, [row]);
    }
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, idxRows]) => {
      const sorted = idxRows.sort((a, b) => a.index_column_id - b.index_column_id);
      const first = sorted[0]!;

      // Separate key columns from included columns
      const keyColumns = sorted
        .filter((r) => !r.is_included_column)
        .map((r) => r.column_name);
      const includedColumns = sorted
        .filter((r) => r.is_included_column)
        .map((r) => r.column_name);

      const extra: Record<string, unknown> = {
        typeDesc: first.type_desc,
      };
      if (first.filter_definition !== null) {
        extra['where'] = first.filter_definition;
      }
      if (includedColumns.length > 0) {
        extra['includedColumns'] = includedColumns;
      }

      const idx: RawIndex & { extra?: Record<string, unknown> } = {
        name,
        unique: first.is_unique,
        columns: keyColumns,
        ...(Object.keys(extra).length > 0 ? { extra } : {}),
      };
      return idx;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended properties (comments) lookup table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a map from:
 *   "schema.object"          → table/view/proc/function description
 *   "schema.object.colname"  → column description
 */
function buildCommentMap(rows: readonly ExtendedPropRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const objKey = tableKey(row.schema_name, row.object_name);
    if (row.column_id === 0 || row.column_name === null) {
      // Object-level comment
      map.set(objKey, row.description);
    } else {
      // Column-level comment
      map.set(`${objKey}.${row.column_name}`, row.description);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table extraction
// ─────────────────────────────────────────────────────────────────────────────

function buildTables(
  input: MssqlRowInput,
  comments: Map<string, string>,
): RawObject[] {
  return input.tables.map((tableRow) => {
    const columns = buildColumns(tableRow.schema_name, tableRow.table_name, input.columns, comments);
    const keyConstraints = buildKeyConstraints(tableRow.schema_name, tableRow.table_name, input.keyConstraints);
    const fkConstraints = buildFkConstraints(tableRow.schema_name, tableRow.table_name, input.foreignKeys);
    const checkConstraints = buildCheckConstraints(tableRow.schema_name, tableRow.table_name, input.checkConstraints);
    const indexes = buildIndexes(tableRow.schema_name, tableRow.table_name, input.indexes);

    const allConstraints = [
      ...keyConstraints,
      ...fkConstraints,
      ...checkConstraints,
    ].sort((a, b) => a.name.localeCompare(b.name));

    const tableCommentKey = tableKey(tableRow.schema_name, tableRow.table_name);
    const comment = comments.get(tableCommentKey);

    const obj: RawObject = {
      kind: 'table',
      schema: tableRow.schema_name,
      name: tableRow.table_name,
      columns: columns as RawColumn[],
      constraints: allConstraints,
      indexes: indexes as RawIndex[],
      ...(comment !== undefined ? { comment } : {}),
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Module extraction (views, procs, functions, triggers)
// ─────────────────────────────────────────────────────────────────────────────

function buildModules(
  input: MssqlRowInput,
  scope: ExtractionScope,
  comments: Map<string, string>,
): RawObject[] {
  // Build object_id → {schema, name} lookup from tables so triggers can resolve their parent table.
  // C-1 fix: trigger.table MUST reference the parent TABLE (resolved from parent_object_id),
  // NOT the trigger's own identity (mod.schema_name / mod.object_name).
  const tableById = new Map<number, { schema: string; name: string }>();
  for (const t of input.tables) {
    tableById.set(t.object_id, { schema: t.schema_name, name: t.table_name });
  }

  // Build trigger event lookup: trigger_id → events + timing + parent_object_id
  const triggerEventMap = new Map<number, { events: Set<'INSERT' | 'UPDATE' | 'DELETE'>; isInsteadOf: boolean; parentObjectId: number }>();
  for (const te of input.triggerEvents) {
    let entry = triggerEventMap.get(te.trigger_id);
    if (entry === undefined) {
      entry = { events: new Set(), isInsteadOf: te.is_instead_of_trigger, parentObjectId: te.parent_object_id };
      triggerEventMap.set(te.trigger_id, entry);
    }
    const eventType = te.event_type.toUpperCase();
    if (eventType === 'INSERT' || eventType === 'UPDATE' || eventType === 'DELETE') {
      entry.events.add(eventType);
    }
  }

  // Build dependency lookup: object_name → dep rows
  const depMap = new Map<string, DepRow[]>();
  for (const dep of input.dependencies) {
    const key = dep.object_name;
    const existing = depMap.get(key);
    if (existing !== undefined) {
      existing.push(dep);
    } else {
      depMap.set(key, [dep]);
    }
  }

  // DOG-2 §4.1/D6: build object_id → RawParameter[] from sys.parameters rows, attached to
  // procedure/function RawObjects by object_id. Sorted by parameter_id and defensively
  // filtered (parameter_id > 0 excludes the scalar-function return row); ordinal is the
  // CONTIGUOUS 1..N position among emitted params (D6), not the raw parameter_id. dataType
  // is the BARE sys.types.name (D5); direction from is_output (never inout); hasDefault only
  // from a real has_default_value flag (never fabricated).
  const paramMap = new Map<number, RawParameter[]>();
  const paramRows = (input.parameters ?? [])
    .filter((p) => p.parameter_id > 0)
    .slice()
    .sort((a, b) => a.parameter_id - b.parameter_id);
  for (const p of paramRows) {
    let list = paramMap.get(p.object_id);
    if (list === undefined) {
      list = [];
      paramMap.set(p.object_id, list);
    }
    const rp: RawParameter = {
      name: p.parameter_name,
      dataType: p.data_type,
      direction: p.is_output ? 'out' : 'in',
      ordinal: list.length + 1,
      ...(p.has_default_value ? { hasDefault: true } : {}),
    };
    list.push(rp);
  }

  const objects: RawObject[] = [];

  for (const mod of input.modules) {
    const kind = moduleTypeToKind(mod.object_type);
    if (kind === null) continue;

    // Determine the applicable scope level
    let level: 'off' | 'metadata' | 'full';
    switch (kind) {
      case 'view':      level = scope.levels.views;      break;
      case 'procedure': level = scope.levels.procedures; break;
      case 'function':  level = scope.levels.functions;  break;
      case 'trigger':   level = scope.levels.triggers;   break;
      default:          level = 'off';
    }

    if (level === 'off') continue;

    const includeBody = level === 'full';
    const moduleCommentKey = tableKey(mod.schema_name, mod.object_name);
    const comment = comments.get(moduleCommentKey);

    // Extra metadata per kind
    const extra: Record<string, unknown> = {};
    if (kind === 'function') {
      extra['functionType'] = mod.object_type.trim();
    }

    // Trigger info
    let triggerInfo: RawTriggerInfo | undefined;
    if (kind === 'trigger') {
      const te = triggerEventMap.get(mod.object_id);
      if (te !== undefined) {
        const timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF' = te.isInsteadOf ? 'INSTEAD OF' : 'AFTER';
        // C-1 fix: resolve the parent table from parent_object_id → tableById.
        // The trigger's OWN name (mod.object_name) is NOT the parent table.
        // Using mod.object_name here created a phantom stub (C-1).
        const parentTable = tableById.get(te.parentObjectId);
        triggerInfo = {
          timing,
          events: Array.from(te.events),
          table: parentTable !== undefined
            ? { schema: parentTable.schema, name: parentTable.name }
            : { schema: mod.schema_name, name: mod.object_name }, // fallback: should not occur if sys.* is consistent
        };
      }
    }

    // Dependency classification via tokenizer.
    // DOG-1 (D2): thread ref_object_type through and flag whether the referencing module is
    // itself a routine, so a routine→routine reference becomes a catalog-declared `calls` edge.
    const deps = depMap.get(mod.object_name) ?? [];
    const sourceIsRoutine = kind === 'procedure' || kind === 'function';
    const { hasDynamicSql: dynamic, dependencies } = tokenizeModuleDeps(
      mod.definition ?? '',
      deps.map((d) => ({
        ref_schema_name: d.ref_schema_name,
        ref_object_name: d.ref_object_name,
        ref_object_type: d.ref_object_type,
      })),
      { sourceIsRoutine },
    );

    const obj: RawObject = {
      kind,
      schema: mod.schema_name,
      name: mod.object_name,
      ...(includeBody && mod.definition !== null ? { body: mod.definition } : {}),
      ...(dynamic ? { hasDynamicSql: true } : {}),
      ...(triggerInfo !== undefined ? { trigger: triggerInfo } : {}),
      ...(dependencies.length > 0 ? { dependencies } : {}),
      // DOG-2: every procedure/function carries a parameters array — populated from
      // sys.parameters, or [] for a real no-argument routine (known-zero, NOT unset).
      // Views/triggers never get one (not in the SQL_MSSQL_PARAMETERS scope).
      ...(sourceIsRoutine ? { parameters: paramMap.get(mod.object_id) ?? [] } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
      ...(comment !== undefined ? { comment } : {}),
    };
    objects.push(obj);
  }

  return objects;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence extraction
// ─────────────────────────────────────────────────────────────────────────────

function buildSequences(
  input: MssqlRowInput,
  scope: ExtractionScope,
  comments: Map<string, string>,
): RawObject[] {
  if (scope.levels.sequences === 'off') return [];

  return input.sequences.map((seq) => {
    const commentKey = tableKey(seq.schema_name, seq.sequence_name);
    const comment = comments.get(commentKey);

    const obj: RawObject = {
      kind: 'sequence',
      schema: seq.schema_name,
      name: seq.sequence_name,
      extra: {
        dataType: seq.data_type,
        startValue: seq.start_value,
        increment: seq.increment,
        minimumValue: seq.minimum_value,
        maximumValue: seq.maximum_value,
        isCycling: seq.is_cycling,
      },
      ...(comment !== undefined ? { comment } : {}),
    };
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// buildMssqlRawCatalog — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a deterministic RawCatalog from pre-fetched sys.* row arrays.
 * Mirrors buildRawCatalog() from sqlite/map.ts in structure and ordering contract.
 *
 * @param input   Pre-fetched sys.* rows (from driver in production; from fixtures in tests)
 * @param scope   Resolved extraction scope (levels for each object type)
 */
export function buildMssqlRawCatalog(
  input: MssqlRowInput,
  scope: ExtractionScope,
): RawCatalog {
  const comments = buildCommentMap(input.extendedProperties);

  const objects: RawObject[] = [];

  // Tables (always if not 'off')
  if (scope.levels.tables !== 'off') {
    objects.push(...buildTables(input, comments));
  }

  // Modules: views, procedures, functions, triggers
  // (each filtered by its own scope level inside buildModules)
  objects.push(...buildModules(input, scope, comments));

  // Sequences
  objects.push(...buildSequences(input, scope, comments));

  // Sort deterministically by (kindRank, schema, name)
  objects.sort(compareObjects);

  // Schemas: distinct schema names across all extracted object types
  const schemaSet = new Set<string>();
  for (const obj of objects) {
    if (obj.schema !== null) schemaSet.add(obj.schema);
  }

  return {
    engine: 'mssql',
    schemas: Array.from(schemaSet).sort(),
    objects,
  };
}
