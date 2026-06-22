/**
 * SqliteCapabilityProbe — CapabilityProbe implementation for SQLite.
 * Design §"probe() is OPTIONAL on the strategy port; per-engine probe in adapters".
 * Resilient-connectivity Batch 2, task 2.4.
 *
 * Detection strategy:
 *   - nativeDriver: true if better-sqlite3 OR node:sqlite is importable (no DB opened)
 *   - cliTools:     [] (no separate CLI tool relevant to SQLite extraction)
 *   - odbc:         always false (N/A for SQLite)
 *
 * Driver selection mirrors the shipped sqlite/factory.ts logic:
 *   1. Try better-sqlite3 first (the default driver — ships as a prod dependency).
 *   2. Fall back to node:sqlite if better-sqlite3 is absent and Node >= 22.5.
 * The probe keeps the surface uniform: same ProbeResult shape across all four engines
 * so `doctor` and the engine-agnostic parity suite are engine-agnostic by construction.
 *
 * All detection failures yield a NEGATIVE result — probe() MUST NEVER reject.
 *
 * Seams (all optional — omit for production use):
 *   - importBetterSqlite: injectable import() for 'better-sqlite3'
 *   - importNodeSqlite:   injectable import() for 'node:sqlite'
 *
 * ADR-004: no child_process here (no CLI tool for SQLite).
 */

import type { CapabilityProbe, ProbeResult } from '../../../core/ports/capability-probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seam types
// ─────────────────────────────────────────────────────────────────────────────

/** Injectable seam for dynamic import('better-sqlite3'). */
export type ImportBetterSqliteFn = () => Promise<unknown>;

/** Injectable seam for dynamic import('node:sqlite'). */
export type ImportNodeSqliteFn = () => Promise<unknown>;

/**
 * Constructor options for SqliteCapabilityProbe.
 * All fields are optional — omit entirely for production use.
 */
export interface SqliteCapabilityProbeOptions {
  /** Injectable better-sqlite3 import seam. Defaults to dynamic import('better-sqlite3'). */
  readonly importBetterSqlite?: ImportBetterSqliteFn;
  /** Injectable node:sqlite import seam. Defaults to dynamic import('node:sqlite'). */
  readonly importNodeSqlite?: ImportNodeSqliteFn;
}

// ─────────────────────────────────────────────────────────────────────────────
// SqliteCapabilityProbe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability probe for SQLite.
 * Implements CapabilityProbe — engine = 'sqlite'.
 *
 * probe() MUST resolve, never reject.
 * probe() MUST NOT open a DB file.
 * probe() MUST NOT issue any write.
 *
 * cliTools is always empty — there is no separate CLI tool for SQLite extraction.
 * odbc is always false — N/A for SQLite.
 */
export class SqliteCapabilityProbe implements CapabilityProbe {
  readonly engine = 'sqlite';

  private readonly _importBetterSqlite: ImportBetterSqliteFn;
  private readonly _importNodeSqlite: ImportNodeSqliteFn;

  constructor(opts: SqliteCapabilityProbeOptions = {}) {
    this._importBetterSqlite = opts.importBetterSqlite ?? (() => import('better-sqlite3'));
    this._importNodeSqlite = opts.importNodeSqlite ?? (() => import('node:sqlite' as string));
  }

  // ─── probe() ──────────────────────────────────────────────────────────────

  /**
   * Detects whether at least one SQLite driver is available.
   * Checks better-sqlite3 first, then node:sqlite.
   * Never opens a database file.
   * Never throws.
   */
  async probe(): Promise<ProbeResult> {
    const nativeDriver = await this._detectNativeDriver();
    return {
      nativeDriver,
      cliTools: [],
      odbc: false,
    };
  }

  // ─── private detection steps ───────────────────────────────────────────────

  /**
   * Returns true if better-sqlite3 or node:sqlite is importable.
   * Tries better-sqlite3 first (it is the default and shipped prod dep).
   * Falls back to node:sqlite if better-sqlite3 is absent.
   * Returns false if both are absent or both throw.
   */
  private async _detectNativeDriver(): Promise<boolean> {
    // Try better-sqlite3 first
    try {
      await this._importBetterSqlite();
      return true;
    } catch {
      // Fall through to node:sqlite
    }

    // Try node:sqlite as fallback
    try {
      await this._importNodeSqlite();
      return true;
    } catch {
      return false;
    }
  }
}
