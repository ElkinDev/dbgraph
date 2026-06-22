/**
 * json-rows.ts — FOR-JSON reassembly + validation/coercion → MssqlRowInput.
 *
 * Shared by the sqlcmd strategy (Batch B) and the manual-dump strategy (Batch D).
 *
 * ## Reassembly layer (NEW — Batch 4, task 4.2)
 *
 * `reassembleForJson(stdout, profile)` and `reassembleSingleForJson(stdout, profile)`
 * are extracted from the private helpers in sqlcmd.strategy.ts. They are now
 * exported, profile-driven, and independently tested.
 *
 * Reassembly rules (F-4/F-5/F-6 findings):
 *   - Decode stdout using `profile.encoding` (NOT hard-coded utf8 — F-5).
 *   - Skip leading non-JSON lines defensively (the real output starts at line 0,
 *     but legacy/future variants may have a header — `profile.outputShape.hasHeader`
 *     is informational; the defensive skip handles both cases).
 *   - Drop blank lines and the "(N rows affected)" trailer (SET NOCOUNT ON safety net).
 *   - Concatenate surviving lines VERBATIM — NO .trim() at chunk boundaries (F-4/F-6).
 *   - On malformed/partial output throw a TYPED actionable error (what + first N chars)
 *     — NOT a raw JSON.parse stack trace.
 *
 * ## Coercion layer (UNCHANGED)
 *
 * `parseJsonRows(input)` takes the raw JSON-parsed output from sqlcmd FOR JSON /
 * a dump file and validates + coerces each row family into the exact *Row types:
 *
 *   - bit 0/1 (SQL Server emits numbers for BIT columns) → boolean
 *   - numeric-string → number for id/ordinal fields
 *   - absent nullable text → null
 *   - malformed / missing-required → throw (strategy falls to next, never silent cast)
 *
 * Design §"json-rows.ts: shared FOR-JSON validation/coercion → MssqlRowInput".
 * Spec mssql-extraction "Malformed sqlcmd output is rejected, not cast".
 * connectivity-strategies Batch B, task B2.2.
 * Resilient-connectivity Batch 4, task 4.2 (reassembly extraction).
 */

import type { SqlcmdProfile } from './profiles.js';
import { TransportError } from '../../../../core/errors.js';
import type {
  MssqlRowInput,
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
} from '../map.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reassembly layer — profile-driven stdout → parsed JSON
// ─────────────────────────────────────────────────────────────────────────────

// MALFORMED_PREVIEW_CHARS was used for the old raw-content error messages.
// Removed in R1 (C2): errors are now REDACTED (TransportError, no raw output content).

/**
 * Extracts the JSON data lines from sqlcmd stdout, driven by the profile.
 *
 * Algorithm (F-4/F-6 findings — measured on legacy sqlcmd 15.x):
 *   1. Decode stdout using `profile.encoding` (F-5 — NOT hard-coded 'utf8').
 *   2. Split into lines, stripping trailing \r per line.
 *   3. Skip leading non-JSON lines DEFENSIVELY: discard until the first line
 *      whose trimStart begins with `[` or `{`. In the legacy-15.x profile
 *      this is always line 0, but future/alternate variants may have a header.
 *   4. From the remaining lines, drop truly-empty lines and the
 *      "(N rows affected)" trailer (SET NOCOUNT ON suppresses it, but this
 *      is kept as a safety net for edge cases).
 *   5. Concatenate survivors VERBATIM (NO .trim() — FOR JSON chunks split
 *      mid-token; any whitespace at a chunk boundary is content, not padding).
 *   6. If nothing remains, return "" (caller decides how to handle empty).
 */
function extractJsonContent(stdout: Buffer, profile: SqlcmdProfile): string {
  const text = stdout.toString(profile.encoding as BufferEncoding);
  const lines = text.split('\n');

  // Step 3: Skip leading non-JSON lines defensively
  let dataStartIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const stripped = (lines[i] ?? '').replace(/\r$/, '');
    const trimStart = stripped.trimStart();
    if (trimStart.startsWith('[') || trimStart.startsWith('{')) {
      dataStartIdx = i;
      break;
    }
  }

  const cleanLines: string[] = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    // Strip ONLY the trailing \r — do NOT trim content (chunk boundaries carry content)
    const line = (lines[i] ?? '').replace(/\r$/, '');
    // Skip truly-empty lines (blank separators at end of output)
    if (line === '') continue;
    // Skip the row-count trailer that SET NOCOUNT ON suppresses (safety net)
    if (/^\(\d+ rows? affected\)$/.test(line.trim())) continue;
    cleanLines.push(line); // preserve exact content — no .trim()
  }

  return cleanLines.join(''); // no spaces — FOR JSON chunks split mid-token
}

/**
 * Reassembles FOR JSON PATH output from sqlcmd stdout into a parsed array.
 *
 * Handles the REAL legacy sqlcmd 15.x output shape (F-4): with `-y 0`,
 * `SET NOCOUNT ON`, and `-f o:65001`, the JSON starts at line 0 (NO header,
 * NO dashes separator). Large results are split into 2033-char chunks with
 * NO trailing-space padding.
 *
 * Decodes stdout using `profile.encoding` (F-5).
 * Concatenates chunks VERBATIM — never .trim() at boundaries (F-4/F-6).
 *
 * @throws Error with actionable message (first N chars) if not valid JSON array.
 */
export function reassembleForJson(stdout: Buffer, profile: SqlcmdProfile): unknown[] {
  const concatenated = extractJsonContent(stdout, profile);
  if (concatenated === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(concatenated);
  } catch (e) {
    // REDACTED: raw output may contain host/user/db identifiers. Message is
    // content-free; raw parse error preserved as cause for debugging only.
    throw new TransportError(
      'sqlcmd: failed to parse FOR JSON output. The output was malformed or incomplete. ' +
      'Check that SET NOCOUNT ON is active and the query ran successfully.',
      e,
    );
  }

  if (!Array.isArray(parsed)) {
    // REDACTED: same rule — no raw output content in the message.
    throw new TransportError(
      `sqlcmd: expected a JSON array from FOR JSON PATH output but got ${typeof parsed}. ` +
      'The query may have returned unexpected output. Enable verbose logging for details.',
    );
  }

  return parsed;
}

/**
 * Reassembles FOR JSON PATH, WITHOUT_ARRAY_WRAPPER output from sqlcmd stdout.
 * Returns the parsed JSON object directly (not wrapped in an array).
 * Used by fingerprint() which returns a single aggregate row, not an array.
 *
 * Uses the same profile-driven extractJsonContent logic as reassembleForJson.
 *
 * @throws Error with actionable message (first N chars) if not valid JSON object.
 */
export function reassembleSingleForJson(stdout: Buffer, profile: SqlcmdProfile): Record<string, unknown> {
  const concatenated = extractJsonContent(stdout, profile);
  if (concatenated === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(concatenated);
  } catch (e) {
    // REDACTED: raw output may contain host/user/db identifiers.
    throw new TransportError(
      'sqlcmd: failed to parse WITHOUT_ARRAY_WRAPPER output. The output was malformed or incomplete. ' +
      'Check that SET NOCOUNT ON is active and the query ran successfully.',
      e,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // REDACTED: no raw output content in the message.
    throw new TransportError(
      `sqlcmd: expected a JSON object from WITHOUT_ARRAY_WRAPPER output but got ${typeof parsed}. ` +
      'The query may have returned unexpected output. Enable verbose logging for details.',
    );
  }

  return parsed as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw input shape (all families as unknown[])
// ─────────────────────────────────────────────────────────────────────────────

export interface RawJsonInput {
  tables: unknown;
  columns: unknown;
  keyConstraints: unknown;
  foreignKeys: unknown;
  checkConstraints: unknown;
  indexes: unknown;
  modules: unknown;
  triggerEvents: unknown;
  sequences: unknown;
  extendedProperties: unknown;
  dependencies: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitive coercion helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerces a SQL Server BIT field value to boolean.
 * SQL Server FOR JSON emits BIT as 0 or 1 (numbers), not true/false.
 * Also accepts already-boolean values for robustness.
 * Throws on any other value.
 */
function coerceBit(value: unknown, fieldName: string): boolean {
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  throw new Error(
    `json-rows: invalid bit value for field "${fieldName}": expected 0, 1, true, or false but got ${JSON.stringify(value)}`,
  );
}

/**
 * Coerces a numeric or numeric-string field to number.
 * SQL Server FOR JSON may emit numbers as strings in some configurations.
 * Throws on values that cannot be coerced to a finite number.
 */
function coerceNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(
    `json-rows: invalid numeric value for field "${fieldName}": expected a number or numeric string but got ${JSON.stringify(value)}`,
  );
}

/**
 * Validates a required string field.
 * Throws if the value is undefined, null, or not a string.
 */
function requireString(value: unknown, fieldName: string): string {
  if (typeof value === 'string') return value;
  throw new Error(
    `json-rows: required string field "${fieldName}" is missing or not a string: got ${JSON.stringify(value)}`,
  );
}

/**
 * Coerces a sql_variant scalar field to string.
 *
 * SQL Server FOR JSON renders sql_variant columns as their native JSON type
 * (number, boolean, etc.) rather than as a quoted string. This helper coerces
 * those scalars to the string representation that the *Row types expect.
 *
 * Supported coercions:
 *   string  → returned as-is
 *   number  → String(value)  (finite numbers only; NaN/Infinity throw)
 *   bigint  → value.toString()
 *   boolean → String(value)  ("true" | "false")
 *
 * Throws an actionable error for null, undefined, or object values.
 *
 * NOTE: bigint values that exceed Number.MAX_SAFE_INTEGER (2^53-1) lose
 * precision when serialised as JSON numbers. SQL Server will emit them as
 * lossy floats. The canonical fix is to CAST those columns to varchar in the
 * query; this coercion handles the case where that cast was not applied.
 */
function coerceStringy(value: unknown, fieldName: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `json-rows: sql_variant field "${fieldName}" is a non-finite number: got ${String(value)}`,
      );
    }
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return String(value);
  throw new Error(
    `json-rows: sql_variant field "${fieldName}" cannot be coerced to string: got ${JSON.stringify(value)}`,
  );
}

/**
 * Coerces an optional text field: if value is null/undefined, returns null.
 * If it is a string, returns it. Throws on other types.
 */
function optionalString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new Error(
    `json-rows: nullable string field "${fieldName}" has unexpected type: got ${JSON.stringify(value)}`,
  );
}

/**
 * Coerces an optional number field: if value is null/undefined, returns null.
 */
function optionalNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(
    `json-rows: nullable numeric field "${fieldName}" has unexpected value: got ${JSON.stringify(value)}`,
  );
}

/**
 * Ensures a value is an array. Throws with the family name if not.
 */
function requireArray(value: unknown, familyName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `json-rows: family "${familyName}" must be an array but got ${typeof value}`,
    );
  }
  return value;
}

/**
 * Gets a field value from an unknown row object, treating the row as a plain object.
 */
function getField(row: unknown, field: string): unknown {
  if (typeof row !== 'object' || row === null) {
    throw new Error(`json-rows: expected a row object but got ${typeof row}`);
  }
  return (row as Record<string, unknown>)[field];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-family validators
// ─────────────────────────────────────────────────────────────────────────────

function coerceTableRow(raw: unknown, idx: number): TableRow {
  const r = (i: string) => {
    const v = getField(raw, i);
    return v;
  };
  try {
    return {
      schema_name: requireString(r('schema_name'), 'schema_name'),
      table_name: requireString(r('table_name'), 'table_name'),
      object_id: coerceNumber(r('object_id'), 'object_id'),
    };
  } catch (e) {
    throw new Error(`json-rows: TableRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceColumnRow(raw: unknown, idx: number): ColumnRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      table_name: requireString(getField(raw, 'table_name'), 'table_name'),
      column_id: coerceNumber(getField(raw, 'column_id'), 'column_id'),
      column_name: requireString(getField(raw, 'column_name'), 'column_name'),
      data_type: requireString(getField(raw, 'data_type'), 'data_type'),
      max_length: coerceNumber(getField(raw, 'max_length'), 'max_length'),
      precision: coerceNumber(getField(raw, 'precision'), 'precision'),
      scale: coerceNumber(getField(raw, 'scale'), 'scale'),
      is_nullable: coerceBit(getField(raw, 'is_nullable'), 'is_nullable'),
      is_computed: coerceBit(getField(raw, 'is_computed'), 'is_computed'),
      computed_definition: optionalString(getField(raw, 'computed_definition'), 'computed_definition'),
      default_definition: optionalString(getField(raw, 'default_definition'), 'default_definition'),
    };
  } catch (e) {
    throw new Error(`json-rows: ColumnRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceKeyConstraintRow(raw: unknown, idx: number): KeyConstraintRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      table_name: requireString(getField(raw, 'table_name'), 'table_name'),
      constraint_name: requireString(getField(raw, 'constraint_name'), 'constraint_name'),
      constraint_type: requireString(getField(raw, 'constraint_type'), 'constraint_type'),
      column_name: requireString(getField(raw, 'column_name'), 'column_name'),
      key_ordinal: coerceNumber(getField(raw, 'key_ordinal'), 'key_ordinal'),
    };
  } catch (e) {
    throw new Error(`json-rows: KeyConstraintRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceFkRow(raw: unknown, idx: number): FkRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      table_name: requireString(getField(raw, 'table_name'), 'table_name'),
      constraint_name: requireString(getField(raw, 'constraint_name'), 'constraint_name'),
      fk_id: coerceNumber(getField(raw, 'fk_id'), 'fk_id'),
      ref_schema_name: requireString(getField(raw, 'ref_schema_name'), 'ref_schema_name'),
      ref_table_name: requireString(getField(raw, 'ref_table_name'), 'ref_table_name'),
      local_column: requireString(getField(raw, 'local_column'), 'local_column'),
      ref_column: requireString(getField(raw, 'ref_column'), 'ref_column'),
      constraint_column_id: coerceNumber(getField(raw, 'constraint_column_id'), 'constraint_column_id'),
    };
  } catch (e) {
    throw new Error(`json-rows: FkRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceCheckRow(raw: unknown, idx: number): CheckRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      table_name: requireString(getField(raw, 'table_name'), 'table_name'),
      constraint_name: requireString(getField(raw, 'constraint_name'), 'constraint_name'),
      definition: requireString(getField(raw, 'definition'), 'definition'),
    };
  } catch (e) {
    throw new Error(`json-rows: CheckRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceIndexRow(raw: unknown, idx: number): IndexRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      table_name: requireString(getField(raw, 'table_name'), 'table_name'),
      index_name: requireString(getField(raw, 'index_name'), 'index_name'),
      is_unique: coerceBit(getField(raw, 'is_unique'), 'is_unique'),
      is_primary_key: coerceBit(getField(raw, 'is_primary_key'), 'is_primary_key'),
      is_unique_constraint: coerceBit(getField(raw, 'is_unique_constraint'), 'is_unique_constraint'),
      type_desc: requireString(getField(raw, 'type_desc'), 'type_desc'),
      filter_definition: optionalString(getField(raw, 'filter_definition'), 'filter_definition'),
      column_name: requireString(getField(raw, 'column_name'), 'column_name'),
      key_ordinal: coerceNumber(getField(raw, 'key_ordinal'), 'key_ordinal'),
      index_column_id: coerceNumber(getField(raw, 'index_column_id'), 'index_column_id'),
      is_included_column: coerceBit(getField(raw, 'is_included_column'), 'is_included_column'),
    };
  } catch (e) {
    throw new Error(`json-rows: IndexRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceModuleRow(raw: unknown, idx: number): ModuleRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      object_name: requireString(getField(raw, 'object_name'), 'object_name'),
      object_type: requireString(getField(raw, 'object_type'), 'object_type'),
      object_id: coerceNumber(getField(raw, 'object_id'), 'object_id'),
      definition: optionalString(getField(raw, 'definition'), 'definition'),
    };
  } catch (e) {
    throw new Error(`json-rows: ModuleRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceTriggerEventRow(raw: unknown, idx: number): TriggerEventRow {
  try {
    return {
      trigger_id: coerceNumber(getField(raw, 'trigger_id'), 'trigger_id'),
      trigger_name: requireString(getField(raw, 'trigger_name'), 'trigger_name'),
      parent_object_id: coerceNumber(getField(raw, 'parent_object_id'), 'parent_object_id'),
      is_instead_of_trigger: coerceBit(getField(raw, 'is_instead_of_trigger'), 'is_instead_of_trigger'),
      event_type: requireString(getField(raw, 'event_type'), 'event_type'),
    };
  } catch (e) {
    throw new Error(`json-rows: TriggerEventRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceSequenceRow(raw: unknown, idx: number): SequenceRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      sequence_name: requireString(getField(raw, 'sequence_name'), 'sequence_name'),
      data_type: requireString(getField(raw, 'data_type'), 'data_type'),
      start_value: coerceStringy(getField(raw, 'start_value'), 'start_value'),
      increment: coerceStringy(getField(raw, 'increment'), 'increment'),
      minimum_value: coerceStringy(getField(raw, 'minimum_value'), 'minimum_value'),
      maximum_value: coerceStringy(getField(raw, 'maximum_value'), 'maximum_value'),
      is_cycling: coerceBit(getField(raw, 'is_cycling'), 'is_cycling'),
    };
  } catch (e) {
    throw new Error(`json-rows: SequenceRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceExtendedPropRow(raw: unknown, idx: number): ExtendedPropRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      object_name: requireString(getField(raw, 'object_name'), 'object_name'),
      column_id: coerceNumber(getField(raw, 'column_id'), 'column_id'),
      column_name: optionalString(getField(raw, 'column_name'), 'column_name'),
      description: coerceStringy(getField(raw, 'description'), 'description'),
    };
  } catch (e) {
    throw new Error(`json-rows: ExtendedPropRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

function coerceDepRow(raw: unknown, idx: number): DepRow {
  try {
    return {
      schema_name: requireString(getField(raw, 'schema_name'), 'schema_name'),
      object_name: requireString(getField(raw, 'object_name'), 'object_name'),
      object_type: requireString(getField(raw, 'object_type'), 'object_type'),
      ref_schema_name: optionalString(getField(raw, 'ref_schema_name'), 'ref_schema_name'),
      ref_object_name: optionalString(getField(raw, 'ref_object_name'), 'ref_object_name'),
      ref_object_id: optionalNumber(getField(raw, 'ref_object_id'), 'ref_object_id'),
    };
  } catch (e) {
    throw new Error(`json-rows: DepRow[${idx}]: ${(e as Error).message}`, { cause: e });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates and coerces a raw JSON-parsed input (from sqlcmd FOR JSON output or
 * a manual dump file) into fully-typed MssqlRowInput.
 *
 * Each family is validated row-by-row:
 *   - BIT columns (0/1) are coerced to boolean
 *   - Numeric-string id/ordinal fields are coerced to number
 *   - Absent nullable text fields are normalized to null
 *   - Missing required fields or invalid types throw with the field name
 *
 * @throws Error with the family name, row index, and field name on any validation failure.
 */
export function parseJsonRows(input: RawJsonInput): MssqlRowInput {
  const tables = requireArray(input.tables, 'tables').map(coerceTableRow);
  const columns = requireArray(input.columns, 'columns').map(coerceColumnRow);
  const keyConstraints = requireArray(input.keyConstraints, 'keyConstraints').map(coerceKeyConstraintRow);
  const foreignKeys = requireArray(input.foreignKeys, 'foreignKeys').map(coerceFkRow);
  const checkConstraints = requireArray(input.checkConstraints, 'checkConstraints').map(coerceCheckRow);
  const indexes = requireArray(input.indexes, 'indexes').map(coerceIndexRow);
  const modules = requireArray(input.modules, 'modules').map(coerceModuleRow);
  const triggerEvents = requireArray(input.triggerEvents, 'triggerEvents').map(coerceTriggerEventRow);
  const sequences = requireArray(input.sequences, 'sequences').map(coerceSequenceRow);
  const extendedProperties = requireArray(input.extendedProperties, 'extendedProperties').map(coerceExtendedPropRow);
  const dependencies = requireArray(input.dependencies, 'dependencies').map(coerceDepRow);

  return {
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
  };
}
