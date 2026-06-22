/**
 * SqlcmdStrategy — ConnectivityStrategy that uses the sqlcmd CLI tool to
 * extract a SQL Server catalog via Windows Integrated Security (-E flag).
 *
 * Design §"sqlcmd strategy — FOR JSON PATH, line reassembly, validation boundary".
 * Resilient-connectivity Batch 4 (task 4.3): profile-driven flags; reassembly
 * delegated to `reassembleForJson`/`reassembleSingleForJson` from json-rows.ts.
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
 * Profile:
 *   `resolveProfile(probe)` selects the correct flag/format/encoding entry from
 *   the SQLCMD_PROFILES registry. The default profile (used when no probe result
 *   is available) reproduces the SHIPPED flags exactly (-y 0 -f o:65001, no -h/-W).
 *
 * connectivity-strategies Batch B, tasks B2.3–B2.5.
 * Resilient-connectivity Batch 4, task 4.3.
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
import { parseJsonRows, reassembleForJson, reassembleSingleForJson } from './json-rows.js';
import { TransportError } from '../../../../core/errors.js';
import { resolveProfile } from './profiles.js';
import type { SqlcmdProfile } from './profiles.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// SqlcmdStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the SQL Server catalog extraction using the sqlcmd CLI tool
 * with Windows Integrated Security (-E flag, no credentials in argv).
 *
 * Inject a custom spawnSync for testing; defaults to node:child_process.spawnSync.
 *
 * Batch 4 (task 4.3): the profile is resolved once at construction (or via the
 * optional `profile` parameter for testing). In production the DEFAULT profile
 * (reproducing the SHIPPED flags) is used until `probe()` is available end-to-end.
 * This preserves BYTE-IDENTICAL behavior: the default profile flags are the same
 * as the previously hard-coded flags (['-y','0','-f','o:65001']).
 */
export class SqlcmdStrategy implements ConnectivityStrategy {
  readonly id = 'sqlcmd';

  private readonly _spawnSync: SpawnSyncFn;
  private readonly _profile: SqlcmdProfile;

  constructor(
    private readonly _config: MssqlAdapterConfig,
    spawnSync?: SpawnSyncFn,
    profile?: SqlcmdProfile,
  ) {
    this._spawnSync = spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
    // Use the provided profile (for testing / probe-driven selection) or
    // resolve from an empty probe result (yields the conservative default,
    // which has the SAME flags as the previously hard-coded set).
    this._profile = profile ?? resolveProfile({ nativeDriver: false, cliTools: [], odbc: false });
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
   *   2. Spawn sqlcmd -E -S <server> -d <db> -Q <wrapped> [profile flags].
   *      Profile flags come from this._profile.flags (e.g. ['-y','0','-f','o:65001']
   *      for legacy-15.x — no -h, no -W per F-3 mutual-exclusivities).
   *   3. Reassemble chunked stdout via reassembleForJson(stdout, profile) (json-rows.ts).
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
      // Profile flags (this._profile.flags) encode the variant/version quirks:
      //   legacy-15.x: ['-y','0','-f','o:65001'] — -y 0 alone (F-3), UTF-8 output (F-5).
      const wrappedSql = `SET NOCOUNT ON;\n${catalogSql(family.sql)}`;
      const result = this._spawnSync(
        'sqlcmd',
        ['-E', '-S', this._config.server, '-d', this._config.database, '-Q', wrappedSql, ...this._profile.flags],
        {
          encoding: 'buffer',
          timeout: CATALOG_TIMEOUT_MS,
          shell: false,
          maxBuffer: 256 * 1024 * 1024, // 256 MB for large schemas
        },
      );

      if (result.error !== undefined || result.status !== 0) {
        // REDACTED: stderr may contain host/user/db/password identifiers.
        // The raw stderr is preserved as cause for debugging; message is content-free.
        const rawCause = result.error ?? new Error(
          `sqlcmd exited with status ${result.status ?? 'null'} for family "${family.key}"`,
        );
        throw new TransportError(
          `sqlcmd: catalog query for family "${family.key}" failed. ` +
          'Check server availability, authentication, and sqlcmd installation.',
          rawCause,
        );
      }

      rawFamilies[family.key] = reassembleForJson(result.stdout, this._profile);
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
    // Profile flags encode the variant/version quirks (e.g. -y 0 -f o:65001 for legacy-15.x).
    const fingerprintSql = `SET NOCOUNT ON;\n${SQL_MSSQL_FINGERPRINT}\nFOR JSON PATH, WITHOUT_ARRAY_WRAPPER`;
    const result = this._spawnSync(
      'sqlcmd',
      ['-E', '-S', this._config.server, '-d', this._config.database, '-Q', fingerprintSql, ...this._profile.flags],
      {
        encoding: 'buffer',
        timeout: CATALOG_TIMEOUT_MS,
        shell: false,
      },
    );

    if (result.error !== undefined || result.status !== 0) {
      // REDACTED: stderr may contain host/user/db/password identifiers.
      const rawCause = result.error ?? new Error(
        `sqlcmd fingerprint exited with status ${result.status ?? 'null'}`,
      );
      throw new TransportError(
        'sqlcmd: fingerprint query failed. ' +
        'Check server availability, authentication, and sqlcmd installation.',
        rawCause,
      );
    }

    const row = reassembleSingleForJson(result.stdout, this._profile);
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
