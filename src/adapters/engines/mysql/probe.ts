/**
 * MysqlCapabilityProbe — CapabilityProbe implementation for MySQL.
 * Design §"probe() is OPTIONAL on the strategy port; per-engine probe in adapters".
 * Resilient-connectivity Batch 2, task 2.3.
 *
 * Detection strategy:
 *   - nativeDriver: dynamic import('mysql2') resolves → present (NO createConnection())
 *   - cliTools:     where/which mysql on PATH (cross-platform); version via mysql --version
 *   - odbc:         always false (N/A for MySQL)
 *
 * All detection failures, timeouts, and absent prerequisites yield a NEGATIVE
 * result — probe() MUST NEVER reject.
 *
 * Seams (all optional — omit for production use):
 *   - spawnSync:    injectable child_process.spawnSync
 *   - importMysql:  injectable import() for 'mysql2' (mirrors factory.ts MysqlSchemaAdapterDeps.importMysql)
 *   - platform:     injectable process.platform override (for cross-platform testing)
 *
 * ADR-004: this file MAY import node:child_process (adapter territory).
 */

import { spawnSync as defaultSpawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import type { CapabilityProbe, ProbeResult, CliToolInfo } from '../../../core/ports/capability-probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seam types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable seam for node:child_process.spawnSync (Buffer overload).
 * Mirrors the SqlcmdStrategy / OdbcDriverStrategy seam pattern.
 */
export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

/**
 * Injectable seam for dynamic import('mysql2').
 * Resolves with the module when present; rejects on MODULE_NOT_FOUND.
 * MUST NOT call createConnection() or establish any connection.
 */
export type ImportMysqlFn = () => Promise<unknown>;

/**
 * Constructor options for MysqlCapabilityProbe.
 * All fields are optional — omit entirely for production use.
 */
export interface MysqlCapabilityProbeOptions {
  /** Injectable spawnSync seam. Defaults to node:child_process.spawnSync. */
  readonly spawnSync?: SpawnSyncFn;
  /** Injectable mysql2 import seam. Defaults to dynamic import('mysql2'). */
  readonly importMysql?: ImportMysqlFn;
  /** Injectable platform override for cross-platform PATH detection testing. */
  readonly platform?: NodeJS.Platform;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 3_000;

/** Pattern to parse a version number from mysql --version output. */
const VERSION_RE = /(\d+[.\d]+)/;

// ─────────────────────────────────────────────────────────────────────────────
// MysqlCapabilityProbe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability probe for MySQL.
 * Implements CapabilityProbe — engine = 'mysql'.
 *
 * probe() MUST resolve, never reject.
 * probe() MUST NOT open a DB connection.
 * probe() MUST NOT issue any write.
 */
export class MysqlCapabilityProbe implements CapabilityProbe {
  readonly engine = 'mysql';

  private readonly _spawnSync: SpawnSyncFn;
  private readonly _importMysql: ImportMysqlFn;
  private readonly _platform: NodeJS.Platform;

  constructor(opts: MysqlCapabilityProbeOptions = {}) {
    this._spawnSync = opts.spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
    this._importMysql = opts.importMysql ?? (() => import('mysql2' as string));
    this._platform = opts.platform ?? process.platform;
  }

  // ─── probe() ──────────────────────────────────────────────────────────────

  /**
   * Run all detections (driver, CLI) and return the composite result.
   * Any detection failure is reported as unavailable — never throws.
   * odbc is always false for MySQL.
   */
  async probe(): Promise<ProbeResult> {
    const [nativeDriver, cliTools] = await Promise.all([
      this._detectNativeDriver(),
      this._detectCliTools(),
    ]);

    return { nativeDriver, cliTools, odbc: false };
  }

  // ─── private detection steps ───────────────────────────────────────────────

  /**
   * Checks whether the 'mysql2' npm package is importable WITHOUT connecting.
   * Resolves true on success, false on any error.
   */
  private async _detectNativeDriver(): Promise<boolean> {
    try {
      await this._importMysql();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scans for the mysql CLI on PATH using where (Windows) / which (POSIX).
   * If found, parses the version from mysql --version.
   * Always resolves with one CliToolInfo entry for 'mysql'.
   */
  private async _detectCliTools(): Promise<readonly CliToolInfo[]> {
    const info = await this._detectMysqlCli();
    return [info];
  }

  private async _detectMysqlCli(): Promise<CliToolInfo> {
    try {
      const isWindows = this._platform === 'win32';
      const whereCmd = isWindows ? 'where' : 'which';

      const whereResult = this._spawnSync(whereCmd, ['mysql'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (whereResult.error !== undefined || whereResult.status !== 0) {
        return { tool: 'mysql', version: null, path: null };
      }

      // Extract the first line of output as the resolved path
      const rawPath = whereResult.stdout.toString('utf8').split('\n')[0]?.replace(/\r$/, '').trim();
      const resolvedPath = rawPath !== undefined && rawPath !== '' ? rawPath : null;

      // Probe version via mysql --version
      const version = this._parseMysqlVersion();

      return { tool: 'mysql', version, path: resolvedPath };
    } catch {
      return { tool: 'mysql', version: null, path: null };
    }
  }

  /**
   * Runs mysql --version to extract the version string.
   * Returns null on any failure.
   */
  private _parseMysqlVersion(): string | null {
    try {
      const result = this._spawnSync('mysql', ['--version'], {
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
}
