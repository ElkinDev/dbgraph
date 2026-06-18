/**
 * OdbcDriverStrategy — detection-only ConnectivityStrategy for the
 * Microsoft ODBC Driver for SQL Server (Windows registry probe).
 *
 * This strategy implements DETECTION ONLY — it probes the Windows registry
 * to find an installed ODBC Driver for SQL Server without opening a DB
 * connection. canConnect() always returns false and runCatalog() is not yet
 * implemented.
 *
 * Detection approach:
 *   Run `reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers"` via
 *   child_process.spawnSync. Parse stdout for a line matching
 *   /ODBC Driver.*SQL Server/i. The first matching driver name is returned
 *   in the detail field.
 *
 *   Returns available: false when:
 *     - reg command exits non-zero (registry key absent or command unavailable).
 *     - Output matches but no entry matches /ODBC Driver.*SQL Server/i.
 *     - The spawn call throws or times out (non-Windows platform).
 *
 * Design notes:
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
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 5000;

/** Registry key containing installed ODBC driver registrations. */
const ODBC_DRIVERS_REG_KEY = 'HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers';

/** Pattern to match an ODBC Driver entry for SQL Server. */
const ODBC_SQL_SERVER_RE = /ODBC Driver[^\n]*SQL Server/i;

// ─────────────────────────────────────────────────────────────────────────────
// OdbcDriverStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detection-only strategy for ODBC Driver for SQL Server (Windows registry).
 *
 * canConnect() → always false (not yet a full runCatalog candidate).
 * runCatalog() → throws (not yet implemented).
 *
 * Inject a custom spawnSync for testing; defaults to node:child_process.spawnSync.
 */
export class OdbcDriverStrategy implements ConnectivityStrategy {
  readonly id = 'odbc-driver';

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
   * Probes the Windows registry for an ODBC Driver for SQL Server installation.
   *
   * Uses `reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers"` to list
   * all registered ODBC drivers. Searches for an entry matching
   * /ODBC Driver.*SQL Server/i.
   *
   * Does NOT open a database connection.
   * Returns available: false on non-Windows or if reg command is unavailable.
   */
  async detect(): Promise<DetectResult> {
    try {
      const result = this._spawnSync(
        'reg',
        ['query', ODBC_DRIVERS_REG_KEY],
        { encoding: 'buffer', timeout: DETECT_TIMEOUT_MS, shell: false },
      );

      if (result.error !== undefined || result.status !== 0) {
        return { available: false, detail: 'ODBC Drivers registry key not found or reg command unavailable' };
      }

      const output = result.stdout.toString('utf8');
      const match = ODBC_SQL_SERVER_RE.exec(output);

      if (match === null) {
        return { available: false, detail: 'No ODBC Driver for SQL Server found in registry' };
      }

      // Extract the driver name from the matched line
      const driverLine = match[0].trim();
      return { available: true, detail: `ODBC Driver found: ${driverLine}` };
    } catch {
      return { available: false, detail: 'ODBC Driver detect probe failed unexpectedly' };
    }
  }

  // ─── canConnect() ──────────────────────────────────────────────────────────

  /**
   * Always returns false — ODBC Driver is detected but not yet a full
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
   * Not yet implemented. The ODBC Driver strategy is detection-only.
   * Full catalog extraction via the ODBC driver is planned for a future change.
   *
   * @throws Error indicating the strategy is detection-only for now.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async runCatalog(_scope: ExtractionScope): Promise<RawCatalog> {
    throw new Error(
      'OdbcDriverStrategy: runCatalog() is not yet implemented. ' +
      'This strategy detects ODBC Driver for SQL Server availability only. ' +
      'Full catalog extraction via ODBC is planned for a future change.',
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
