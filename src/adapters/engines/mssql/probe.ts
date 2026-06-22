/**
 * MssqlCapabilityProbe — CapabilityProbe implementation for SQL Server.
 * Design §"probe() is OPTIONAL on the strategy port; per-engine probe in adapters".
 * Resilient-connectivity Batch 2, task 2.1.
 *
 * Detection strategy:
 *   - nativeDriver: dynamic import('tedious') resolves → present (NO .connect())
 *   - cliTools:     where/which sqlcmd on PATH (cross-platform); version via sqlcmd -?
 *   - odbc:         Windows registry probe (mirrors OdbcDriverStrategy.detect())
 *
 * All detection failures, timeouts, and absent prerequisites yield a NEGATIVE
 * result — probe() MUST NEVER reject.
 *
 * Seams (all optional — omit for production use):
 *   - spawnSync:      injectable child_process.spawnSync (default: real spawnSync)
 *   - importTedious:  injectable import() for 'tedious' (default: real dynamic import)
 *   - platform:       injectable process.platform override (for cross-platform testing)
 *
 * ADR-004: this file MAY import node:child_process (adapter territory).
 * The core port (capability-probe.ts) imports nothing from adapters.
 */

import { spawnSync as defaultSpawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import type { CapabilityProbe, ProbeResult, CliToolInfo } from '../../../core/ports/capability-probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seam types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable seam for node:child_process.spawnSync (Buffer overload).
 * Mirrors the existing SqlcmdStrategy / OdbcDriverStrategy seam pattern.
 */
export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

/**
 * Injectable seam for dynamic import('tedious').
 * Resolves with the module (any shape) when present; rejects on MODULE_NOT_FOUND.
 * MUST NOT call .connect() or instantiate any class.
 */
export type ImportTediousFn = () => Promise<unknown>;

/**
 * Constructor options for MssqlCapabilityProbe.
 * All fields are optional — omit entirely for production use.
 */
export interface MssqlCapabilityProbeOptions {
  /** Injectable spawnSync seam. Defaults to node:child_process.spawnSync. */
  readonly spawnSync?: SpawnSyncFn;
  /** Injectable tedious import seam. Defaults to dynamic import('tedious'). */
  readonly importTedious?: ImportTediousFn;
  /** Injectable platform override for cross-platform PATH detection testing. */
  readonly platform?: NodeJS.Platform;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 3_000;

/** Pattern to parse a version number from sqlcmd -? output. */
const VERSION_RE = /Version\s+(\d+[.\d]+)/i;

/** Registry key for ODBC drivers (mirrors OdbcDriverStrategy). */
const ODBC_DRIVERS_REG_KEY = 'HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers';

/** Pattern for ODBC Driver for SQL Server (mirrors OdbcDriverStrategy). */
const ODBC_SQL_SERVER_RE = /ODBC Driver[^\n]*SQL Server/i;

// ─────────────────────────────────────────────────────────────────────────────
// MssqlCapabilityProbe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability probe for SQL Server.
 * Implements CapabilityProbe — engine = 'mssql'.
 *
 * probe() MUST resolve, never reject.
 * probe() MUST NOT open a DB connection.
 * probe() MUST NOT issue any write.
 */
export class MssqlCapabilityProbe implements CapabilityProbe {
  readonly engine = 'mssql';

  private readonly _spawnSync: SpawnSyncFn;
  private readonly _importTedious: ImportTediousFn;
  private readonly _platform: NodeJS.Platform;

  constructor(opts: MssqlCapabilityProbeOptions = {}) {
    this._spawnSync = opts.spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
    this._importTedious = opts.importTedious ?? (() => import('tedious' as string));
    this._platform = opts.platform ?? process.platform;
  }

  // ─── probe() ──────────────────────────────────────────────────────────────

  /**
   * Run all three detections (driver, CLI, ODBC) and return the composite result.
   * Any detection failure is reported as unavailable — never throws.
   */
  async probe(): Promise<ProbeResult> {
    const [nativeDriver, cliTools, odbc] = await Promise.all([
      this._detectNativeDriver(),
      this._detectCliTools(),
      this._detectOdbc(),
    ]);

    return { nativeDriver, cliTools, odbc };
  }

  // ─── private detection steps ───────────────────────────────────────────────

  /**
   * Checks whether the 'tedious' npm package is importable WITHOUT connecting.
   * Resolves true on success, false on any error (MODULE_NOT_FOUND, throws, etc.).
   */
  private async _detectNativeDriver(): Promise<boolean> {
    try {
      await this._importTedious();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scans for sqlcmd on PATH using where (Windows) / which (POSIX).
   * If found, parses the version from sqlcmd -?.
   * Always resolves with one CliToolInfo entry for 'sqlcmd'.
   */
  private async _detectCliTools(): Promise<readonly CliToolInfo[]> {
    const info = await this._detectSqlcmd();
    return [info];
  }

  private async _detectSqlcmd(): Promise<CliToolInfo> {
    try {
      const isWindows = this._platform === 'win32';
      const whereCmd = isWindows ? 'where' : 'which';

      const whereResult = this._spawnSync(whereCmd, ['sqlcmd'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (whereResult.error !== undefined || whereResult.status !== 0) {
        return { tool: 'sqlcmd', version: null, path: null };
      }

      // Extract the first line of output as the resolved path
      const rawPath = whereResult.stdout.toString('utf8').split('\n')[0]?.replace(/\r$/, '').trim();
      const resolvedPath = rawPath !== undefined && rawPath !== '' ? rawPath : null;

      // Probe version via sqlcmd -?
      const version = this._parseSqlcmdVersion();

      return { tool: 'sqlcmd', version, path: resolvedPath };
    } catch {
      return { tool: 'sqlcmd', version: null, path: null };
    }
  }

  /**
   * Runs sqlcmd -? to extract the version string.
   * Returns null on any failure (timeout, non-zero exit, parse failure).
   */
  private _parseSqlcmdVersion(): string | null {
    try {
      const result = this._spawnSync('sqlcmd', ['-?'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (result.error !== undefined || result.status !== 0) {
        return null;
      }

      const output = result.stdout.toString('utf8');
      const match = VERSION_RE.exec(output);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Probes the Windows registry for an ODBC Driver for SQL Server installation.
   * Mirrors OdbcDriverStrategy.detect() — returns true/false, never throws.
   */
  private async _detectOdbc(): Promise<boolean> {
    try {
      const result = this._spawnSync(
        'reg',
        ['query', ODBC_DRIVERS_REG_KEY],
        { encoding: 'buffer', timeout: DETECT_TIMEOUT_MS, shell: false },
      );

      if (result.error !== undefined || result.status !== 0) {
        return false;
      }

      const output = result.stdout.toString('utf8');
      return ODBC_SQL_SERVER_RE.test(output);
    } catch {
      return false;
    }
  }
}
