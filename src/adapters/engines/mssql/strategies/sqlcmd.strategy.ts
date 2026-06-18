/**
 * SqlcmdStrategy — ConnectivityStrategy that uses the sqlcmd CLI tool to
 * extract a SQL Server catalog via Windows Integrated Security (-E flag).
 *
 * Design §"sqlcmd strategy — FOR JSON PATH, line reassembly, validation boundary".
 *
 * Security:
 *   - ALL config values are passed as ARGV array elements (never a shell string).
 *   - spawn is called with { shell: false } on every invocation.
 *   - No resolved secret is ever passed as a command argument (integrated auth
 *     uses -E / the current Windows session, no user/password in the argv).
 *
 * Spawn seam:
 *   The spawnSync function is injected via the constructor so tests can mock
 *   child_process calls without patching the module globally. In production,
 *   the default is spawnSync from node:child_process.
 *
 * connectivity-strategies Batch B, tasks B2.3–B2.5.
 */

import { spawnSync as defaultSpawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import type { ConnectivityStrategy, DetectResult } from '../../../../core/ports/connectivity-strategy.js';
import { createHash } from 'node:crypto';
import type { RawCatalog } from '../../../../core/model/catalog.js';
import type { ExtractionScope } from '../../../../core/model/capability.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';
import { buildMssqlRawCatalog } from '../map.js';
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
} from '../queries.js';
import { parseJsonRows } from './json-rows.js';

// ─────────────────────────────────────────────────────────────────────────────
// SpawnSyncFn type — the injectable seam for child_process.spawnSync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type alias for node:child_process.spawnSync (Buffer overload).
 * Injected at construction to allow mocking in tests without global patching.
 */
export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

// ─────────────────────────────────────────────────────────────────────────────
// Catalog family definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Maps each MssqlRowInput key to its catalog query constant. */
const CATALOG_FAMILIES: ReadonlyArray<{ key: string; sql: string }> = [
  { key: 'tables',             sql: SQL_MSSQL_TABLES },
  { key: 'columns',            sql: SQL_MSSQL_COLUMNS },
  { key: 'keyConstraints',     sql: SQL_MSSQL_KEY_CONSTRAINTS },
  { key: 'foreignKeys',        sql: SQL_MSSQL_FOREIGN_KEYS },
  { key: 'checkConstraints',   sql: SQL_MSSQL_CHECK_CONSTRAINTS },
  { key: 'indexes',            sql: SQL_MSSQL_INDEXES },
  { key: 'modules',            sql: SQL_MSSQL_MODULES },
  { key: 'triggerEvents',      sql: SQL_MSSQL_TRIGGER_EVENTS },
  { key: 'sequences',          sql: SQL_MSSQL_SEQUENCES },
  { key: 'extendedProperties', sql: SQL_MSSQL_EXTENDED_PROPERTIES },
  { key: 'dependencies',       sql: SQL_MSSQL_DEPENDENCIES },
];

// ─────────────────────────────────────────────────────────────────────────────
// Detection timeout (short — must not hang)
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 10000;
const CATALOG_TIMEOUT_MS = 300000; // 5 min — large enterprise catalog families (e.g. columns) exceed 60s

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appends FOR JSON PATH, INCLUDE_NULL_VALUES to a catalog SELECT query for use
 * with sqlcmd -Q.
 *
 * Each queries.ts constant ends with a top-level ORDER BY. Appending FOR JSON
 * PATH at the same level is valid SQL Server syntax (ORDER BY + FOR JSON PATH
 * coexist at top level). This is the correct form.
 *
 * The previous approach (`SELECT * FROM (<query>) AS _rows FOR JSON PATH`) was
 * INCORRECT — SQL Server Msg 1033 forbids ORDER BY inside a derived table
 * (subquery/derived table) unless TOP or OFFSET-FETCH is present.
 *
 * ADR-008 determinism: the top-level ORDER BY in each constant remains the
 * primary guarantee; app-level re-sorting in map.ts/normalize is the anchor.
 */
function catalogSql(sql: string): string {
  return `${sql}\nFOR JSON PATH, INCLUDE_NULL_VALUES`;
}

/**
 * Extracts the JSON data lines from legacy sqlcmd 15.x stdout.
 *
 * REAL FORMAT (measured on sqlcmd 15.0.1300 with `-E -S -d -Q ... -y 0` and
 * `SET NOCOUNT ON`):
 *   - NO column header line, NO dashes-separator line.
 *   - Line 0 starts directly with `[` (array) or `{` (single object).
 *   - Large results are split into 2033-char chunks, one chunk per line.
 *   - NO trailing-space padding on any chunk line.
 *
 * The previous assumption (header + dashes separator before JSON) was WRONG
 * for this flag combination and has been removed.
 *
 * Algorithm:
 *   1. Split stdout into lines, stripping trailing \r per line.
 *   2. Skip leading non-JSON lines DEFENSIVELY: discard lines until the first
 *      one whose trimStart begins with `[` or `{`. In reality this is line 0.
 *   3. From the remaining lines, drop truly-empty lines and a
 *      "(N rows affected)" trailer (SET NOCOUNT ON suppresses it, but
 *      kept as a safety net).
 *   4. Concatenate survivors VERBATIM (NO .trim() — FOR JSON chunks split
 *      mid-token; any whitespace at a chunk boundary is content, not padding).
 *   5. If nothing remains, return "" (caller decides how to handle empty).
 */
function extractJsonContent(stdout: Buffer): string {
  const lines = stdout.toString('utf8').split('\n');

  // Skip leading non-JSON lines (defensive fallback — in reality line 0 is JSON)
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
 * Handles the REAL legacy sqlcmd 15.x output shape: with `-y 0`, `SET NOCOUNT ON`,
 * and `-f o:65001`, the JSON starts at line 0 (NO header, NO dashes separator).
 * Large results are split into 2033-char chunks across lines with NO padding.
 *
 * @throws Error if the concatenated string is not valid JSON.
 */
function reassembleJsonOutput(stdout: Buffer): unknown[] {
  const concatenated = extractJsonContent(stdout);
  if (concatenated === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(concatenated);
  } catch (e) {
    throw new Error(
      `sqlcmd: failed to parse FOR JSON output. ` +
      `Stdout (first 200 chars): ${concatenated.slice(0, 200)}. ` +
      `Parse error: ${(e as Error).message}`,
      { cause: e },
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `sqlcmd: expected a JSON array from FOR JSON PATH output but got ${typeof parsed}`,
    );
  }

  return parsed;
}

/**
 * Reassembles FOR JSON PATH, WITHOUT_ARRAY_WRAPPER output from sqlcmd stdout.
 * Returns the parsed JSON object directly (not wrapped in an array).
 * Used by fingerprint() which returns a single aggregate row, not an array.
 *
 * Uses the same extractJsonContent logic — see that function for output format details.
 *
 * @throws Error if the concatenated string is not valid JSON or is empty.
 */
function reassembleSingleObjectOutput(stdout: Buffer): Record<string, unknown> {
  const concatenated = extractJsonContent(stdout);
  if (concatenated === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(concatenated);
  } catch (e) {
    throw new Error(
      `sqlcmd: failed to parse WITHOUT_ARRAY_WRAPPER output. ` +
      `Stdout (first 200 chars): ${concatenated.slice(0, 200)}. ` +
      `Parse error: ${(e as Error).message}`,
      { cause: e },
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `sqlcmd: expected a JSON object from WITHOUT_ARRAY_WRAPPER output but got ${typeof parsed}`,
    );
  }

  return parsed as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SqlcmdStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the SQL Server catalog extraction using the sqlcmd CLI tool
 * with Windows Integrated Security (-E flag, no credentials in argv).
 *
 * Inject a custom spawnSync for testing; defaults to node:child_process.spawnSync.
 */
export class SqlcmdStrategy implements ConnectivityStrategy {
  readonly id = 'sqlcmd';

  private readonly _spawnSync: SpawnSyncFn;

  constructor(
    private readonly _config: MssqlAdapterConfig,
    spawnSync?: SpawnSyncFn,
  ) {
    this._spawnSync = spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
  }

  // ─── detect() ──────────────────────────────────────────────────────────────

  /**
   * Probes whether sqlcmd is available on PATH without opening a DB connection.
   *
   * Steps:
   *   1. Run `where sqlcmd` (Windows) / `which sqlcmd` (POSIX) with a short timeout.
   *   2. If exit 0 → available: true.
   *   3. If non-zero → run `sqlcmd -?` as a capability probe (fallback for go-sqlcmd).
   *   4. If -? exits 0 → available: true.
   *   5. If timeout or error on any probe → available: false (never hang, never throw).
   *
   * Does NOT open a database connection.
   */
  async detect(): Promise<DetectResult> {
    try {
      const isWindows = process.platform === 'win32';
      const whereCmd = isWindows ? 'where' : 'which';

      const whereResult = this._spawnSync(whereCmd, ['sqlcmd'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (whereResult.error === undefined && whereResult.status === 0) {
        const path = whereResult.stdout.toString('utf8').trim().split('\n')[0]?.trim();
        return { available: true, detail: path !== undefined && path !== '' ? `sqlcmd at ${path}` : 'sqlcmd available' };
      }

      // Fallback: capability probe via sqlcmd -?
      const capResult = this._spawnSync('sqlcmd', ['-?'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (capResult.error === undefined && capResult.status === 0) {
        return { available: true, detail: 'sqlcmd detected via -? probe' };
      }

      return { available: false, detail: 'sqlcmd not found on PATH' };
    } catch {
      return { available: false, detail: 'sqlcmd detect probe failed unexpectedly' };
    }
  }

  // ─── canConnect() ──────────────────────────────────────────────────────────

  /**
   * Cheap connectivity probe: runs `sqlcmd -E -S <server> -d <db> -Q "SELECT 1" -h -1`.
   * All config values are in the argv array (shell: false — no interpolation).
   * Returns true on exit 0, false otherwise (including timeout).
   */
  async canConnect(): Promise<boolean> {
    const result = this._spawnSync(
      'sqlcmd',
      ['-E', '-S', this._config.server, '-d', this._config.database, '-Q', 'SELECT 1', '-h', '-1'],
      {
        encoding: 'buffer',
        timeout: CONNECT_TIMEOUT_MS,
        shell: false,
      },
    );

    return result.error === undefined && result.status === 0;
  }

  // ─── runCatalog() ──────────────────────────────────────────────────────────

  /**
   * Runs all 11 catalog queries + the fingerprint query via sqlcmd FOR JSON PATH.
   *
   * For each catalog family:
   *   1. Wrap the queries.ts constant in FOR JSON PATH, INCLUDE_NULL_VALUES at top level.
   *   2. Spawn sqlcmd -E -S <server> -d <db> -Q <wrapped> -y 0 -f o:65001.
   *      (-y 0: unlimited nvarchar width; -f o:65001: force UTF-8 stdout; no -h, no -W)
   *   3. Reassemble chunked stdout into one JSON document (concat-then-parse).
   *   4. Validate + coerce through parseJsonRows (json-rows.ts).
   *
   * The fingerprint is computed separately (SHA-256 over MAX(modify_date)|COUNT(*)).
   * buildMssqlRawCatalog is called UNCHANGED with the typed MssqlRowInput.
   *
   * @throws Error if any family's output is malformed (strategy falls to next).
   */
  async runCatalog(scope: ExtractionScope): Promise<RawCatalog> {
    const rawFamilies: Record<string, unknown[]> = {};

    for (const family of CATALOG_FAMILIES) {
      // SET NOCOUNT ON suppresses the "(N rows affected)" row-count trailer that legacy
      // sqlcmd 15.x emits. This is a session setting (read-only, not a write).
      // -h is NOT used here: legacy sqlcmd 15.x treats -h and -y 0 as mutually exclusive.
      // -W is also NOT used: mutually exclusive with -y 0 in legacy sqlcmd 15.x.
      // -f o:65001 forces UTF-8 output codepage so that stdout.toString('utf8') is
      // correct for non-ASCII content in proc definitions and other nvarchar columns.
      const wrappedSql = `SET NOCOUNT ON;\n${catalogSql(family.sql)}`;
      const result = this._spawnSync(
        'sqlcmd',
        ['-E', '-S', this._config.server, '-d', this._config.database, '-Q', wrappedSql, '-y', '0', '-f', 'o:65001'],
        {
          encoding: 'buffer',
          timeout: CATALOG_TIMEOUT_MS,
          shell: false,
          maxBuffer: 256 * 1024 * 1024, // 256 MB for large schemas
        },
      );

      if (result.error !== undefined || result.status !== 0) {
        const stderr = result.stderr.toString('utf8').slice(0, 200);
        throw new Error(
          `sqlcmd: query for family "${family.key}" failed. ` +
          `Exit: ${result.status ?? 'null'}. ` +
          `Error: ${result.error?.message ?? 'none'}. ` +
          `Stderr: ${stderr}`,
        );
      }

      rawFamilies[family.key] = reassembleJsonOutput(result.stdout);
    }

    const input = parseJsonRows({
      tables: rawFamilies['tables'] as unknown[],
      columns: rawFamilies['columns'] as unknown[],
      keyConstraints: rawFamilies['keyConstraints'] as unknown[],
      foreignKeys: rawFamilies['foreignKeys'] as unknown[],
      checkConstraints: rawFamilies['checkConstraints'] as unknown[],
      indexes: rawFamilies['indexes'] as unknown[],
      modules: rawFamilies['modules'] as unknown[],
      triggerEvents: rawFamilies['triggerEvents'] as unknown[],
      sequences: rawFamilies['sequences'] as unknown[],
      extendedProperties: rawFamilies['extendedProperties'] as unknown[],
      dependencies: rawFamilies['dependencies'] as unknown[],
    });

    return buildMssqlRawCatalog(input, scope);
  }

  // ─── fingerprint() ─────────────────────────────────────────────────────────

  /**
   * Computes a DDL-sensitive fingerprint by running SQL_MSSQL_FINGERPRINT via sqlcmd.
   * Formula (mirrors MssqlSchemaAdapter): sha256(`${MAX(modify_date)}|${COUNT(*)}`)
   * over sys.objects WHERE is_ms_shipped=0.
   * Issues exactly ONE query — does NOT walk all objects.
   *
   * Uses WITHOUT_ARRAY_WRAPPER since the fingerprint returns a single aggregate row
   * (not an array); the sqlcmd output is a plain JSON object rather than an array.
   */
  async fingerprint(): Promise<string> {
    // SET NOCOUNT ON suppresses the "(N rows affected)" trailer.
    // -h is NOT used: mutually exclusive with -y 0 in legacy sqlcmd 15.x.
    // -f o:65001 forces UTF-8 output codepage (consistent with runCatalog).
    const fingerprintSql = `SET NOCOUNT ON;\n${SQL_MSSQL_FINGERPRINT}\nFOR JSON PATH, WITHOUT_ARRAY_WRAPPER`;
    const result = this._spawnSync(
      'sqlcmd',
      ['-E', '-S', this._config.server, '-d', this._config.database, '-Q', fingerprintSql, '-y', '0', '-f', 'o:65001'],
      {
        encoding: 'buffer',
        timeout: CATALOG_TIMEOUT_MS,
        shell: false,
      },
    );

    if (result.error !== undefined || result.status !== 0) {
      const stderr = result.stderr.toString('utf8').slice(0, 200);
      throw new Error(
        `sqlcmd: fingerprint query failed. ` +
        `Exit: ${result.status ?? 'null'}. ` +
        `Error: ${result.error?.message ?? 'none'}. ` +
        `Stderr: ${stderr}`,
      );
    }

    const row = reassembleSingleObjectOutput(result.stdout);
    const m = String(row['m'] ?? 'null');
    const c = String(row['c'] ?? '0');

    return createHash('sha256').update(`${m}|${c}`).digest('hex');
  }

  // ─── close() ───────────────────────────────────────────────────────────────

  /**
   * No-op: sqlcmd spawns a separate process per query, no persistent connection.
   * Included for interface compliance; idempotent.
   */
  async close(): Promise<void> {
    // No persistent connection to close.
  }
}
