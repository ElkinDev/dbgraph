/**
 * MssqlCapabilityProbe unit tests — Batch 2, task 2.1.
 *
 * TDD: RED → GREEN → REFACTOR.
 * All child_process calls use an injected spawnSync seam (vi.fn pattern).
 * Driver import uses an injected importTedious seam.
 * No real sqlcmd, no real tedious, no DB connection.
 *
 * Spec: connectivity-diagnostics
 *   - "Probe reports a present native driver and a CLI on PATH"
 *   - "Absent driver and absent CLI are reported, not raised"
 *   - "A timed-out or failed detection is treated as unavailable"
 *   - "Probe port stays driver-free and core-typed"
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { MssqlCapabilityProbe, type SpawnSyncFn } from '../../../../src/adapters/engines/mssql/probe.js';

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

/** importTedious that resolves (driver present). */
const importTediousPresent = () => Promise.resolve({ Connection: class {} });

/** importTedious that rejects with MODULE_NOT_FOUND. */
const importTediousAbsent = () => {
  const err = new Error("Cannot find module 'tedious'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  return Promise.reject(err);
};

/** importTedious that throws synchronously (edge case). */
const importTediousThrows = () => {
  throw new Error('unexpected import error');
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MssqlCapabilityProbe — task 2.1', () => {
  // ── implements CapabilityProbe interface ────────────────────────────────────

  it('has engine === "mssql"', () => {
    const probe = new MssqlCapabilityProbe();
    expect(probe.engine).toBe('mssql');
  });

  it('probe() returns a ProbeResult (object with nativeDriver / cliTools / odbc)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
    const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent });
    const result = await probe.probe();
    expect(result).toMatchObject({
      nativeDriver: expect.any(Boolean),
      cliTools: expect.any(Array),
      odbc: expect.any(Boolean),
    });
  });

  // ── Scenario: driver present + sqlcmd on PATH ───────────────────────────────

  describe('driver present + sqlcmd on PATH', () => {
    it('resolves nativeDriver: true when tedious import resolves', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousPresent });
      const result = await probe.probe();
      expect(result.nativeDriver).toBe(true);
    });

    it('resolves cliTools with sqlcmd present, version parsed, path parsed', async () => {
      const sqlcmdPath = 'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\sqlcmd.EXE';
      const versionOutput = 'Microsoft (R) SQL Server Command Line Tool\nVersion 15.0.1300.23 NT';

      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd, args) => {
        if (cmd === 'where' || cmd === 'which') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(`${sqlcmdPath}\n`) });
        }
        if (cmd === 'sqlcmd' && args[0] === '-?') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(versionOutput) });
        }
        return makeSpawnResult({ status: 1 });
      });

      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousPresent });
      const result = await probe.probe();

      expect(result.cliTools).toHaveLength(1);
      const tool = result.cliTools[0];
      expect(tool?.tool).toBe('sqlcmd');
      expect(tool?.path).toBe(sqlcmdPath);
      expect(tool?.version).toMatch(/15\.0/);
    });

    it('EXACT-SET: driver-present + sqlcmd-on-PATH full result shape', async () => {
      const spawnPath = '/usr/local/bin/sqlcmd';
      const versionStr = 'Version 15.0.1300.23';

      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd, args) => {
        if (cmd === 'where' || cmd === 'which') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(`${spawnPath}\n`) });
        }
        if (cmd === 'sqlcmd' && args[0] === '-?') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(versionStr) });
        }
        return makeSpawnResult({ status: 1 }); // ODBC absent
      });

      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousPresent });
      const result = await probe.probe();

      expect(result.nativeDriver).toBe(true);
      expect(result.cliTools).toHaveLength(1);
      expect(result.cliTools[0]?.tool).toBe('sqlcmd');
      expect(result.cliTools[0]?.path).toBe(spawnPath);
      expect(typeof result.cliTools[0]?.version).toBe('string');
      expect(result.odbc).toBe(false);
    });
  });

  // ── Scenario: driver absent + sqlcmd absent ─────────────────────────────────

  describe('driver absent + sqlcmd absent', () => {
    it('EXACT-SET: nativeDriver false, sqlcmd tool with null version and null path, odbc false', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent });
      const result = await probe.probe();

      expect(result).toEqual({
        nativeDriver: false,
        cliTools: [{ tool: 'sqlcmd', version: null, path: null }],
        odbc: false,
      });
    });

    it('does NOT throw when both driver and CLI are absent', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent });
      await expect(probe.probe()).resolves.not.toThrow();
    });
  });

  // ── Scenario: timed-out / failed detection ──────────────────────────────────

  describe('timed-out or errored detection treated as unavailable', () => {
    it('spawnSync with error set → sqlcmd reported unavailable, no throw', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
        makeSpawnResult({ error: new Error('ETIMEDOUT'), status: null as unknown as number }),
      );
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent });
      const result = await probe.probe();
      expect(result.cliTools[0]?.version).toBeNull();
      expect(result.cliTools[0]?.path).toBeNull();
    });

    it('importTedious that throws synchronously → nativeDriver false, no throw', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousThrows });
      const result = await probe.probe();
      expect(result.nativeDriver).toBe(false);
    });

    it('probe() NEVER rejects even when seams throw', async () => {
      const badSpawn = vi.fn<SpawnSyncFn>().mockImplementation(() => {
        throw new Error('spawnSync exploded');
      });
      const probe = new MssqlCapabilityProbe({ spawnSync: badSpawn, importTedious: importTediousAbsent });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });

  // ── Cross-platform PATH scan ─────────────────────────────────────────────────

  describe('cross-platform PATH scan', () => {
    it('uses "where" command on Windows (win32 branch via injected platform)', async () => {
      const commands: string[] = [];
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        commands.push(cmd);
        return makeSpawnResult({ status: 1 });
      });
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent, platform: 'win32' });
      await probe.probe();
      // First spawn call MUST be "where" (the PATH detection command on Windows)
      expect(commands[0]).toBe('where');
    });

    it('uses "which" command on POSIX (linux branch via injected platform)', async () => {
      const commands: string[] = [];
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        commands.push(cmd);
        return makeSpawnResult({ status: 1 });
      });
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent, platform: 'linux' });
      await probe.probe();
      // First spawn call MUST be "which" (the PATH detection command on POSIX)
      expect(commands[0]).toBe('which');
    });
  });

  // ── ODBC detection via registry ─────────────────────────────────────────────

  describe('ODBC detection', () => {
    it('odbc: true when reg query returns ODBC Driver for SQL Server', async () => {
      const regOutput = 'ODBC Driver 17 for SQL Server    REG_SZ    Installed\n';
      // Route by command: where/which → fail, sqlcmd → fail, reg → ODBC output
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        if (cmd === 'reg') return makeSpawnResult({ status: 0, stdout: Buffer.from(regOutput) });
        return makeSpawnResult({ status: 1 }); // where/which + sqlcmd -? absent
      });
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent });
      const result = await probe.probe();
      expect(result.odbc).toBe(true);
    });

    it('odbc: false when reg query fails', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MssqlCapabilityProbe({ spawnSync, importTedious: importTediousAbsent });
      const result = await probe.probe();
      expect(result.odbc).toBe(false);
    });
  });
});
