/**
 * PgCapabilityProbe unit tests — Batch 2, task 2.2.
 *
 * TDD: RED → GREEN → REFACTOR.
 * All child_process calls use an injected spawnSync seam (vi.fn pattern).
 * Driver import uses an injected importPg seam (mirrors factory.ts pattern).
 * No real psql, no real pg driver, no DB connection.
 *
 * Spec: connectivity-diagnostics
 *   - "Probe reports a present native driver and a CLI on PATH"
 *   - "Absent driver and absent CLI are reported, not raised"
 *   - "A timed-out or failed detection is treated as unavailable"
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { PgCapabilityProbe, type SpawnSyncFn } from '../../../../src/adapters/engines/pg/probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSpawnResult(
  overrides: Partial<Omit<SpawnSyncReturns<Buffer>, 'error'>> & { error?: Error } = {},
): SpawnSyncReturns<Buffer> {
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

/** importPg that resolves (driver present — NO Client.connect() called). */
const importPgPresent = () => Promise.resolve({ Client: class {} });

/** importPg that rejects with MODULE_NOT_FOUND. */
const importPgAbsent = () => {
  const err = new Error("Cannot find module 'pg'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  return Promise.reject(err);
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PgCapabilityProbe — task 2.2', () => {
  it('has engine === "pg"', () => {
    const probe = new PgCapabilityProbe();
    expect(probe.engine).toBe('pg');
  });

  it('probe() returns a ProbeResult with nativeDriver / cliTools / odbc', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
    const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgAbsent });
    const result = await probe.probe();
    expect(result).toMatchObject({
      nativeDriver: expect.any(Boolean),
      cliTools: expect.any(Array),
      odbc: expect.any(Boolean),
    });
  });

  // ── Scenario: pg present + psql on PATH ────────────────────────────────────

  describe('pg-present + psql-on-PATH', () => {
    it('EXACT-SET: nativeDriver true, psql tool with path and version, odbc false', async () => {
      const psqlPath = '/usr/bin/psql';
      const versionOutput = 'psql (PostgreSQL) 15.3';

      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd, args) => {
        if ((cmd === 'where' || cmd === 'which') && args[0] === 'psql') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(`${psqlPath}\n`) });
        }
        if (cmd === 'psql' && args[0] === '--version') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(versionOutput) });
        }
        return makeSpawnResult({ status: 1 });
      });

      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgPresent });
      const result = await probe.probe();

      expect(result.nativeDriver).toBe(true);
      expect(result.cliTools).toHaveLength(1);
      expect(result.cliTools[0]?.tool).toBe('psql');
      expect(result.cliTools[0]?.path).toBe(psqlPath);
      expect(result.cliTools[0]?.version).toMatch(/15\.3/);
      expect(result.odbc).toBe(false);
    });

    it('does NOT call Client.connect() during probe', async () => {
      let connectCalled = false;
      const importPgWithSpy = () =>
        Promise.resolve({
          Client: class {
            connect() {
              connectCalled = true;
              return Promise.resolve();
            }
          },
        });

      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgWithSpy });
      await probe.probe();
      expect(connectCalled).toBe(false);
    });
  });

  // ── Scenario: pg absent + psql absent ──────────────────────────────────────

  describe('pg-absent + psql-absent', () => {
    it('EXACT-SET: nativeDriver false, psql tool with null version and null path, odbc false', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgAbsent });
      const result = await probe.probe();

      expect(result).toEqual({
        nativeDriver: false,
        cliTools: [{ tool: 'psql', version: null, path: null }],
        odbc: false,
      });
    });

    it('does NOT throw when both pg and psql are absent', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgAbsent });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });

  // ── Scenario: timed-out / errored detection ─────────────────────────────────

  describe('timed-out or errored detection treated as unavailable', () => {
    it('spawnSync error set → psql reported unavailable, no throw', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
        makeSpawnResult({ error: new Error('ETIMEDOUT'), status: null as unknown as number }),
      );
      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgAbsent });
      const result = await probe.probe();
      expect(result.cliTools[0]?.version).toBeNull();
      expect(result.cliTools[0]?.path).toBeNull();
    });

    it('probe() NEVER rejects even when seams throw', async () => {
      const badSpawn = vi.fn<SpawnSyncFn>().mockImplementation(() => {
        throw new Error('spawn exploded');
      });
      const probe = new PgCapabilityProbe({ spawnSync: badSpawn, importPg: importPgAbsent });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });

  // ── Cross-platform PATH scan ─────────────────────────────────────────────────

  describe('cross-platform PATH scan', () => {
    it('uses "where" on Windows', async () => {
      const commands: string[] = [];
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        commands.push(cmd);
        return makeSpawnResult({ status: 1 });
      });
      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgAbsent, platform: 'win32' });
      await probe.probe();
      expect(commands[0]).toBe('where');
    });

    it('uses "which" on Linux', async () => {
      const commands: string[] = [];
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        commands.push(cmd);
        return makeSpawnResult({ status: 1 });
      });
      const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgAbsent, platform: 'linux' });
      await probe.probe();
      expect(commands[0]).toBe('which');
    });
  });

  // ── odbc is always false for pg ────────────────────────────────────────────

  it('odbc is always false (N/A for pg)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 0 }));
    const probe = new PgCapabilityProbe({ spawnSync, importPg: importPgPresent });
    const result = await probe.probe();
    expect(result.odbc).toBe(false);
  });
});
