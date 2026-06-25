/**
 * MongodbCapabilityProbe — CapabilityProbe implementation for MongoDB.
 * Design §"probe() NEVER rejects; per-engine probe in adapters".
 * Mirrors PgCapabilityProbe exactly in structure.
 *
 * Detection strategy:
 *   - nativeDriver: dynamic import('mongodb') resolves → present (NO MongoClient.connect())
 *   - cliTools:     where/which mongosh on PATH (cross-platform); version via mongosh --version
 *   - odbc:         always false (N/A for MongoDB)
 *
 * All detection failures, timeouts, and absent prerequisites yield a NEGATIVE
 * result — probe() MUST NEVER reject.
 *
 * Seams (all optional — omit for production use):
 *   - spawnSync:      injectable child_process.spawnSync
 *   - importMongodb:  injectable import() for 'mongodb' (mirrors factory.ts seam)
 *   - platform:       injectable process.platform override (for cross-platform testing)
 *
 * ADR-004: this file MAY import node:child_process (adapter territory).
 * US-030 (MongoDB adapter), phase-9b-mongodb Batch 3 task 3.4.
 */

import { spawnSync as defaultSpawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import type { CapabilityProbe, ProbeResult, CliToolInfo } from '../../../core/ports/capability-probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seam types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable seam for node:child_process.spawnSync (Buffer overload).
 * Mirrors PgCapabilityProbe seam pattern.
 */
export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

/**
 * Injectable seam for dynamic import('mongodb').
 * Resolves with the module when present; rejects on MODULE_NOT_FOUND.
 * MUST NOT call MongoClient.connect() or instantiate any class.
 */
export type ImportMongodbFn = () => Promise<unknown>;

/**
 * Constructor options for MongodbCapabilityProbe.
 * All fields are optional — omit entirely for production use.
 */
export interface MongodbCapabilityProbeOptions {
  /** Injectable spawnSync seam. Defaults to node:child_process.spawnSync. */
  readonly spawnSync?: SpawnSyncFn;
  /** Injectable mongodb import seam. Defaults to dynamic import('mongodb'). */
  readonly importMongodb?: ImportMongodbFn;
  /** Injectable platform override for cross-platform PATH detection testing. */
  readonly platform?: NodeJS.Platform;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 3_000;

/** Pattern to parse a version number from mongosh --version output. */
const VERSION_RE = /(\d+[.\d]+)/;

// ─────────────────────────────────────────────────────────────────────────────
// MongodbCapabilityProbe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability probe for MongoDB.
 * Implements CapabilityProbe — engine = 'mongodb'.
 *
 * probe() MUST resolve, never reject.
 * probe() MUST NOT open a DB connection.
 * probe() MUST NOT issue any write.
 */
export class MongodbCapabilityProbe implements CapabilityProbe {
  readonly engine = 'mongodb';

  private readonly _spawnSync: SpawnSyncFn;
  private readonly _importMongodb: ImportMongodbFn;
  private readonly _platform: NodeJS.Platform;

  constructor(opts: MongodbCapabilityProbeOptions = {}) {
    this._spawnSync = opts.spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
    this._importMongodb = opts.importMongodb ?? (() => import('mongodb' as string));
    this._platform = opts.platform ?? process.platform;
  }

  // ─── probe() ──────────────────────────────────────────────────────────────

  /**
   * Run all detections (driver, CLI) and return the composite result.
   * Any detection failure is reported as unavailable — never throws.
   * odbc is always false for MongoDB.
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
   * Checks whether the 'mongodb' npm package is importable WITHOUT connecting.
   * Resolves true on success, false on any error.
   */
  private async _detectNativeDriver(): Promise<boolean> {
    try {
      await this._importMongodb();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scans for mongosh on PATH using where (Windows) / which (POSIX).
   * If found, parses the version from mongosh --version.
   * Always resolves with one CliToolInfo entry for 'mongosh'.
   */
  private async _detectCliTools(): Promise<readonly CliToolInfo[]> {
    const info = await this._detectMongosh();
    return [info];
  }

  private async _detectMongosh(): Promise<CliToolInfo> {
    try {
      const isWindows = this._platform === 'win32';
      const whereCmd = isWindows ? 'where' : 'which';

      const whereResult = this._spawnSync(whereCmd, ['mongosh'], {
        encoding: 'buffer',
        timeout: DETECT_TIMEOUT_MS,
        shell: false,
      });

      if (whereResult.error !== undefined || whereResult.status !== 0) {
        return { tool: 'mongosh', version: null, path: null };
      }

      // Extract the first line of output as the resolved path
      const rawPath = whereResult.stdout.toString('utf8').split('\n')[0]?.replace(/\r$/, '').trim();
      const resolvedPath = rawPath !== undefined && rawPath !== '' ? rawPath : null;

      // Probe version via mongosh --version
      const version = this._parseMongoshVersion();

      return { tool: 'mongosh', version, path: resolvedPath };
    } catch {
      return { tool: 'mongosh', version: null, path: null };
    }
  }

  /**
   * Runs mongosh --version to extract the version string.
   * Returns null on any failure.
   */
  private _parseMongoshVersion(): string | null {
    try {
      const result = this._spawnSync('mongosh', ['--version'], {
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
