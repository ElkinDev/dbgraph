/**
 * invoke-sqlcmd.test.ts — unit tests for InvokeSqlcmdStrategy detection.
 *
 * WARN-3 remediation: the connectivity spec mandates at least 3 candidate
 * probes. This tests the second candidate: PowerShell Invoke-Sqlcmd detection.
 *
 * InvokeSqlcmdStrategy:
 *   detect() — probes via `pwsh -Command "Get-Command Invoke-Sqlcmd"` or
 *              `powershell -Command "Get-Command Invoke-Sqlcmd"` (Windows only).
 *              Returns available: true if exit code is 0.
 *              Does NOT open a DB connection.
 *
 *   canConnect() — always false (not yet implemented as a full runCatalog strategy).
 *   runCatalog() — throws Error('Invoke-Sqlcmd: runCatalog not yet implemented').
 *
 * SpawnSyncFn seam injected at construction (same pattern as SqlcmdStrategy).
 * All child_process calls are mocked.
 *
 * connectivity-strategies WARN-3 remediation.
 * TDD: RED → GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { InvokeSqlcmdStrategy, type SpawnSyncFn } from '../../../../../src/adapters/engines/mssql/strategies/invoke-sqlcmd.strategy.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// detect() tests
// ─────────────────────────────────────────────────────────────────────────────

describe('InvokeSqlcmdStrategy.detect() — WARN-3', () => {
  it('strategy id is "invoke-sqlcmd"', () => {
    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    expect(strategy.id).toBe('invoke-sqlcmd');
  });

  it('returns { available: true } when pwsh Get-Command exits 0', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: 0, stdout: Buffer.from('Invoke-Sqlcmd\n') }));

    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(true);
  });

  it('returns { available: false } when pwsh Get-Command exits non-zero', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 1, stderr: Buffer.from('CommandNotFoundException') }));

    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('tries powershell fallback when pwsh is not available', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValueOnce(makeSpawnResult({ status: null, error: new Error('ENOENT') })) // pwsh not found
      .mockReturnValueOnce(makeSpawnResult({ status: 0, stdout: Buffer.from('Invoke-Sqlcmd\n') })); // powershell succeeds

    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('returns { available: false } when both pwsh and powershell are unavailable', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: null, error: new Error('ENOENT') }));

    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    const result = await strategy.detect();

    expect(result.available).toBe(false);
  });

  it('detect() never throws — resolves available:false on unexpected error', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation(() => {
      throw new Error('unexpected spawn failure');
    });

    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, spawnSync);
    await expect(strategy.detect()).resolves.toMatchObject({ available: false });
  });

  it('does NOT open a DB connection during detect()', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>()
      .mockReturnValue(makeSpawnResult({ status: 0 }));

    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, spawnSync);
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

describe('InvokeSqlcmdStrategy not-yet-implemented boundary — WARN-3', () => {
  it('canConnect() always returns false (not yet a full runCatalog strategy)', async () => {
    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    const result = await strategy.canConnect();
    expect(result).toBe(false);
  });

  it('runCatalog() throws Error explaining it is not yet implemented', async () => {
    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
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
    const strategy = new InvokeSqlcmdStrategy(MSSQL_CONFIG, vi.fn<SpawnSyncFn>());
    await expect(strategy.close()).resolves.toBeUndefined();
  });
});
