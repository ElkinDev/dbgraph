/**
 * PgCapabilityProbe — CapabilityProbe implementation for PostgreSQL.
 * Design §"probe() is OPTIONAL on the strategy port; per-engine probe in adapters".
 * Resilient-connectivity Batch 2, task 2.2.
 *
 * Detection strategy:
 *   - nativeDriver: dynamic import('pg') resolves → present (NO Client.connect())
 *   - cliTools:     where/which psql on PATH (cross-platform); version via psql --version
 *   - odbc:         always false (N/A for PostgreSQL)
 *
 * All detection failures, timeouts, and absent prerequisites yield a NEGATIVE
 * result — probe() MUST NEVER reject.
 *
 * Seams (all optional — omit for production use):
 *   - spawnSync:  injectable child_process.spawnSync
 *   - importPg:   injectable import() for 'pg' (mirrors factory.ts PgSchemaAdapterDeps.importPg)
 *   - platform:   injectable process.platform override (for cross-platform testing)
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
 * Injectable seam for dynamic import('pg').
 * Resolves with the module when present; rejects on MODULE_NOT_FOUND.
 * MUST NOT call Client.connect() or instantiate any class.
 */
export type ImportPgFn = () => Promise<unknown>;

/**
 * Constructor options for PgCapabilityProbe.
 * All fields are optional — omit entirely for production use.
 */
export interface PgCapabilityProbeOptions {
  /** Injectable spawnSync seam. Defaults to node:child_process.spawnSync. */
  readonly spawnSync?: SpawnSyncFn;
  /** Injectable pg import seam. Defaults to dynamic import('pg'). */
  readonly importPg?: ImportPgFn;
  /** Injectable platform override for cross-platform PATH detection testing. */
  readonly platform?: NodeJS.Platform;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 3_000;

/** Pattern to parse a version number from psql --version output. */
const VERSION_RE = /(\d+[.\d]+)/;

// ─────────────────────────────────────────────────────────────────────────────
// PgCapabilityProbe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability probe for PostgreSQL.
 * Implements CapabilityProbe — engine = 'pg'.
 *
 * probe() MUST resolve, never reject.
 * probe() MUST NOT open a DB connection.
 * probe() MUST NOT issue any write.
 */
export class PgCapabilityProbe implements CapabilityProbe {
  readonly engine = 'pg';

  private readonly _spawnSync: SpawnSyncFn;
  private readonly _importPg: ImportPgFn;
  private readonly _platform: NodeJS.Platform;

  constructor(opts: PgCapabilityProbeOptions = {}) {
    this._spawnSync = opts.spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
    this._importPg = opts.importPg ?? (() => import('pg' as string));
    this._platform = opts.platform ?? process.platform;
  }

  // ─── probe() ──────────────────────────────────────────────────────────────

  /**
   * Run all detections (driver, CLI) and return the composite result.
   * Any detection failure is reported as unavailable — never throws.
   * odbc is always false for PostgreSQL.
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
   * Checks whether the 'pg' npm package is importable WITHOUT connecting.
   * Resolves true on success, false on any error.
   */
  private async _detectNativeDriver(): Promise<boolean> {
    try {
      await this._importPg();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scans for psql on PATH using where (Windows) / which (POSIX).
   * If found, parses the version from psql --version.
   * Always resolves with one CliToolInfo entry for 'psql'.
   */
  private async _detectCliTools(): Promise<readonly CliToolInfo[]> {
    const info = await this._detectPsql();
    return [info];
  }

  private async _detectPsql(): Promise<CliToolInfo> {
    try {
      const isWindows = this._platform === 'win32';
      const whereCmd = isWindows ? 'where' : 'which';

      const whereResult = this._spawnSync(whereCmd, ['psql'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (whereResult.error !== undefined || whereResult.status !== 0) {
        return { tool: 'psql', version: null, path: null };
      }

      // Extract the first line of output as the resolved path
      const rawPath = whereResult.stdout.toString('utf8').split('\n')[0]?.replace(/\r$/, '').trim();
      const resolvedPath = rawPath !== undefined && rawPath !== '' ? rawPath : null;

      // Probe version via psql --version
      const version = this._parsePsqlVersion();

      return { tool: 'psql', version, path: resolvedPath };
    } catch {
      return { tool: 'psql', version: null, path: null };
    }
  }

  /**
   * Runs psql --version to extract the version string.
   * Returns null on any failure.
   */
  private _parsePsqlVersion(): string | null {
    try {
      const result = this._spawnSync('psql', ['--version'], {
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
