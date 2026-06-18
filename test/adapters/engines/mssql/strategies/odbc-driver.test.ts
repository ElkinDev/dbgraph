/**
 * odbc-driver.test.ts — unit tests for OdbcDriverStrategy detection.
 *
 * WARN-3 remediation: the connectivity spec mandates at least 3 candidate
 * probes. This tests the third candidate: ODBC Driver for SQL Server (Windows
 * registry or PowerShell Get-ItemProperty probe).
 *
 * OdbcDriverStrategy:
 *   detect() — probes the Windows registry via `reg query
 *              "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers"` and looks for
 *              an entry matching "ODBC Driver.*SQL Server".
 *              Fallback: `powershell -Command "Get-ItemProperty ..."`.
 *              Does NOT open a DB connection.
 *
 *   canConnect() — always false (not yet implemented as a full runCatalog strategy).
 *   runCatalog() — throws Error('OdbcDriver: runCatalog not yet implemented').
 *
 * SpawnSyncFn seam injected at construction (same pattern as SqlcmdStrategy).
 * All child_process calls are mocked.
 *
 * connectivity-strategies WARN-3 remediation.
 * TDD: RED → GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { OdbcDriverStrategy, type SpawnSyncFn } from '../../../../../src/adapters/engines/mssql/strategies/odbc-driver.strategy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSpawnResult(overrides: Partial<Omit<SpawnSyncReturns<Buffer>, 'error'>> & { error?: Error } = {}): SpawnSyncReturns<Buffer> {
  const base: SpawnSyncReturns<Buffer> = {
    pid: 1,
    output: [],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    ...overrides,
  };
  if (overrides.error !== undefined) {
    base.error = overrides.error;
  }
  return base;
}

const MSSQL_CONFIG = {
  server: 'MYSERVER\\SQLEXPRESS',
  database: 'MyDb',
  authentication: { type: 'integrated' as const },
} as const;

// Registry output that includes ODBC Driver for SQL Server
const REG_OUTPUT_WITH_ODBC = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers
    ODBC Driver 17 for SQL Server    REG_SZ    Installed
    SQL Server Native Client 11.0    REG_SZ    Installed
`.trim();

// Registry output without ODBC Driver for SQL Server
const REG_OUTPUT_NO_ODBC = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers
    Microsoft Access Driver (*.mdb)    REG_SZ    Installed
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// detect() tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OdbcDriverStrategy.detect() — WARN-3', () => {
  it('strategy id is "odbc-driver"', () => {
    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    expect(strategy.id).toBe('odbc-driver');
  });

  it('returns { available: true } when reg query output includes ODBC Driver.*SQL Server', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 0, stdout: Buffer.from(REG_OUTPUT_WITH_ODBC) }));

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(true);
  });

  it('detect() result.detail mentions the found driver name', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 0, stdout: Buffer.from(REG_OUTPUT_WITH_ODBC) }));

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.detail).toContain('ODBC Driver');
  });

  it('returns { available: false } when reg query output has no ODBC Driver for SQL Server', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 0, stdout: Buffer.from(REG_OUTPUT_NO_ODBC) }));

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('returns { available: false } when reg query exits non-zero (registry key absent)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 1, stderr: Buffer.from('ERROR: The system was unable to find the specified registry key or value') }));

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('returns { available: false } when reg command is not found (non-Windows / ENOENT)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: null, error: new Error('ENOENT') }));

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('detect() never throws — resolves available:false on unexpected error', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      throw new Error('unexpected spawn failure');
    });

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.detect()).resolves.toMatchObject({ available: false });
  });

  it('does NOT open a DB connection during detect()', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0, stdout: Buffer.from(REG_OUTPUT_WITH_ODBC) }));

    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, spawnSync);
    await strategy.detect();

    const calls = spawnSync.mock.calls;
    for (const call of calls) {
      const args = (call[1] ?? []) as string[];
      expect(args).not.toContain('-S');
      expect(args).not.toContain('-d');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canConnect() / runCatalog() — not-yet-implemented boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('OdbcDriverStrategy not-yet-implemented boundary — WARN-3', () => {
  it('canConnect() always returns false (not yet a full runCatalog strategy)', async () => {
    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    const result = await strategy.canConnect();
    expect(result).toBe(false);
  });

  it('runCatalog() throws Error explaining it is not yet implemented', async () => {
    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    await expect(strategy.runCatalog({
      levels: {
        tables: 'full', columns: 'full', constraints: 'full', indexes: 'full',
        views: 'full', procedures: 'metadata', functions: 'metadata',
        triggers: 'full', sequences: 'full', collections: 'off', fields: 'off',
        statistics: 'off', sampling: 'off',
      },
    })).rejects.toThrow(/not yet implemented/i);
  });

  it('close() is a no-op (no persistent connection)', async () => {
    const strategy = new OdbcDriverStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    await expect(strategy.close()).resolves.toBeUndefined();
  });
});
