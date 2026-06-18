/**
 * InvokeSqlcmdStrategy — detection-only ConnectivityStrategy for the PowerShell
 * Invoke-Sqlcmd cmdlet (part of SqlServer PS module).
 *
 * This strategy implements DETECTION ONLY — it probes whether Invoke-Sqlcmd is
 * available in the PowerShell environment without opening a DB connection.
 * canConnect() always returns false and runCatalog() is not yet implemented.
 *
 * Detection approach:
 *   1. Probe `pwsh -Command "Get-Command Invoke-Sqlcmd"` (PowerShell 7+).
 *   2. If pwsh is not found (ENOENT / non-zero), fall back to
 *      `powershell -Command "Get-Command Invoke-Sqlcmd"` (Windows PS 5.1).
 *   3. Exit 0 on either probe → available: true with the PS host name in detail.
 *   4. Both probes unavailable or exit non-zero → available: false.
 *
 * Design notes:
 *   - Invoke-Sqlcmd is typically installed as part of the SqlServer PS module
 *     (`Install-Module SqlServer`) which bundles the ODBC driver.
 *   - runCatalog() is NOT implemented in this change — marking the strategy as
 *     extensible per connectivity spec "detected-but-not-yet-a-runCatalog-strategy".
 *   - SpawnSyncFn constructor injection seam (same pattern as SqlcmdStrategy).
 *
 * connectivity-strategies WARN-3 remediation.
 */

import { spawnSync as defaultSpawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import type { ConnectivityStrategy, DetectResult } from '../../../../core/ports/connectivity-strategy.js';
import type { RawCatalog } from '../../../../core/model/catalog.js';
import type { ExtractionScope } from '../../../../core/model/capability.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// SpawnSyncFn type — re-exported for test injection
// ─────────────────────────────────────────────────────────────────────────────

export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

// ─────────────────────────────────────────────────────────────────────────────
// Timeouts
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// InvokeSqlcmdStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detection-only strategy for PowerShell Invoke-Sqlcmd (SqlServer PS module).
 *
 * canConnect() → always false (not yet a full runCatalog candidate).
 * runCatalog() → throws (not yet implemented).
 *
 * Inject a custom spawnSync for testing; defaults to node:child_process.spawnSync.
 */
export class InvokeSqlcmdStrategy implements ConnectivityStrategy {
  readonly id = 'invoke-sqlcmd';

  private readonly _spawnSync: SpawnSyncFn;

  constructor(
    private readonly _config: MssqlAdapterConfig,
    spawnSync?: SpawnSyncFn,
  ) {
    this._spawnSync = spawnSync ?? (defaultSpawnSync as SpawnSyncFn);
    // _config is not used for detection but is required by the port contract.
    void this._config;
  }

  // ─── detect() ──────────────────────────────────────────────────────────────

  /**
   * Probes whether Invoke-Sqlcmd is available in the PowerShell environment.
   *
   * Steps:
   *   1. Run `pwsh -Command "Get-Command Invoke-Sqlcmd"` (exit 0 → available).
   *   2. If pwsh errors (ENOENT / non-zero), try
   *      `powershell -Command "Get-Command Invoke-Sqlcmd"` (exit 0 → available).
   *   3. Both probes fail → available: false (never throws).
   *
   * Does NOT open a database connection.
   */
  async detect(): Promise<DetectResult> {
    try {
      // Try pwsh (PowerShell 7+) first
      const pwshResult = this._spawnSync(
        'pwsh',
        ['-Command', 'Get-Command Invoke-Sqlcmd'],
        { encoding: 'buffer', timeout: DETECT_TIMEOUT_MS, shell: false },
      );

      if (pwshResult.error === undefined && pwshResult.status === 0) {
        const version = pwshResult.stdout.toString('utf8').trim().split('\n')[0]?.trim() ?? 'pwsh';
        return { available: true, detail: `Invoke-Sqlcmd available via pwsh: ${version}` };
      }

      // Fallback: try Windows PowerShell 5.1
      const psResult = this._spawnSync(
        'powershell',
        ['-Command', 'Get-Command Invoke-Sqlcmd'],
        { encoding: 'buffer', timeout: DETECT_TIMEOUT_MS, shell: false },
      );

      if (psResult.error === undefined && psResult.status === 0) {
        const version = psResult.stdout.toString('utf8').trim().split('\n')[0]?.trim() ?? 'powershell';
        return { available: true, detail: `Invoke-Sqlcmd available via powershell: ${version}` };
      }

      return { available: false, detail: 'Invoke-Sqlcmd not found in pwsh or powershell' };
    } catch {
      return { available: false, detail: 'Invoke-Sqlcmd detect probe failed unexpectedly' };
    }
  }

  // ─── canConnect() ──────────────────────────────────────────────────────────

  /**
   * Always returns false — Invoke-Sqlcmd is detected but not yet a full
   * runCatalog strategy. This ensures the strategy is bypassed in selectStrategy
   * and recorded in StrategyExhaustionError.attempts for user transparency.
   *
   * Extensible to a real canConnect() probe in a future change (Phase 6+).
   */
  async canConnect(): Promise<boolean> {
    return false;
  }

  // ─── runCatalog() ──────────────────────────────────────────────────────────

  /**
   * Not yet implemented. Invoke-Sqlcmd is detected but the runCatalog() path
   * requires PowerShell scripting beyond the current change scope.
   *
   * @throws Error indicating the strategy is detection-only for now.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async runCatalog(_scope: ExtractionScope): Promise<RawCatalog> {
    throw new Error(
      'InvokeSqlcmdStrategy: runCatalog() is not yet implemented. ' +
      'This strategy detects Invoke-Sqlcmd availability only. ' +
      'Full catalog extraction via Invoke-Sqlcmd is planned for a future change.',
    );
  }

  // ─── close() ───────────────────────────────────────────────────────────────

  /**
   * No-op: no persistent connection to close.
   */
  async close(): Promise<void> {
    // No persistent connection.
  }
}
