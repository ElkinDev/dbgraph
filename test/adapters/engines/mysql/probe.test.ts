/**
 * MysqlCapabilityProbe unit tests — Batch 2, task 2.3.
 *
 * TDD: RED → GREEN → REFACTOR.
 * All child_process calls use an injected spawnSync seam (vi.fn pattern).
 * Driver import uses an injected importMysql seam (mirrors factory.ts pattern).
 * No real mysql, no real mysql2 driver, no DB connection.
 *
 * Spec: connectivity-diagnostics
 *   - "Probe reports a present native driver and a CLI on PATH"
 *   - "Absent driver and absent CLI are reported, not raised"
 *   - "A timed-out or failed detection is treated as unavailable"
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { MysqlCapabilityProbe, type SpawnSyncFn } from '../../../../src/adapters/engines/mysql/probe.js';

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

/** importMysql that resolves (driver present — NO connections made). */
const importMysqlPresent = () => Promise.resolve({ createConnection: async () => ({}) });

/** importMysql that rejects with MODULE_NOT_FOUND. */
const importMysqlAbsent = () => {
  const err = new Error("Cannot find module 'mysql2'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  return Promise.reject(err);
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MysqlCapabilityProbe — task 2.3', () => {
  it('has engine === "mysql"', () => {
    const probe = new MysqlCapabilityProbe();
    expect(probe.engine).toBe('mysql');
  });

  it('probe() returns a ProbeResult with nativeDriver / cliTools / odbc', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
    const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlAbsent });
    const result = await probe.probe();
    expect(result).toMatchObject({
      nativeDriver: expect.any(Boolean),
      cliTools: expect.any(Array),
      odbc: expect.any(Boolean),
    });
  });

  // ── Scenario: mysql2 present + mysql CLI on PATH ────────────────────────────

  describe('mysql2-present + mysql-CLI-on-PATH', () => {
    it('EXACT-SET: nativeDriver true, mysql tool with path and version, odbc false', async () => {
      const mysqlPath = '/usr/bin/mysql';
      const versionOutput = 'mysql  Ver 8.0.36 Distrib 8.0.36, for Linux (x86_64)';

      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd, args) => {
        if ((cmd === 'where' || cmd === 'which') && args[0] === 'mysql') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(`${mysqlPath}\n`) });
        }
        if (cmd === 'mysql' && args[0] === '--version') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(versionOutput) });
        }
        return makeSpawnResult({ status: 1 });
      });

      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlPresent });
      const result = await probe.probe();

      expect(result.nativeDriver).toBe(true);
      expect(result.cliTools).toHaveLength(1);
      expect(result.cliTools[0]?.tool).toBe('mysql');
      expect(result.cliTools[0]?.path).toBe(mysqlPath);
      expect(result.cliTools[0]?.version).toMatch(/8\.0/);
      expect(result.odbc).toBe(false);
    });

    it('does NOT call createConnection() during probe', async () => {
      let createConnectionCalled = false;
      const importMysqlWithSpy = () =>
        Promise.resolve({
          createConnection: async () => {
            createConnectionCalled = true;
            return {};
          },
        });

      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlWithSpy });
      await probe.probe();
      expect(createConnectionCalled).toBe(false);
    });
  });

  // ── Scenario: mysql2 absent + mysql CLI absent ──────────────────────────────

  describe('mysql2-absent + mysql-CLI-absent', () => {
    it('EXACT-SET: nativeDriver false, mysql tool with null version and null path, odbc false', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlAbsent });
      const result = await probe.probe();

      expect(result).toEqual({
        nativeDriver: false,
        cliTools: [{ tool: 'mysql', version: null, path: null }],
        odbc: false,
      });
    });

    it('does NOT throw when both mysql2 and mysql CLI are absent', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlAbsent });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });

  // ── Scenario: timed-out / errored detection ─────────────────────────────────

  describe('timed-out or errored detection treated as unavailable', () => {
    it('spawnSync error set → mysql CLI reported unavailable, no throw', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
        makeSpawnResult({ error: new Error('ETIMEDOUT'), status: null as unknown as number }),
      );
      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlAbsent });
      const result = await probe.probe();
      expect(result.cliTools[0]?.version).toBeNull();
      expect(result.cliTools[0]?.path).toBeNull();
    });

    it('probe() NEVER rejects even when seams throw', async () => {
      const badSpawn = vi.fn<SpawnSyncFn>().mockImplementation(() => {
        throw new Error('spawn exploded');
      });
      const probe = new MysqlCapabilityProbe({ spawnSync: badSpawn, importMysql: importMysqlAbsent });
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
      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlAbsent, platform: 'win32' });
      await probe.probe();
      expect(commands[0]).toBe('where');
    });

    it('uses "which" on Linux', async () => {
      const commands: string[] = [];
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        commands.push(cmd);
        return makeSpawnResult({ status: 1 });
      });
      const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlAbsent, platform: 'linux' });
      await probe.probe();
      expect(commands[0]).toBe('which');
    });
  });

  // ── odbc is always false for mysql ─────────────────────────────────────────

  it('odbc is always false (N/A for mysql)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 0 }));
    const probe = new MysqlCapabilityProbe({ spawnSync, importMysql: importMysqlPresent });
    const result = await probe.probe();
    expect(result.odbc).toBe(false);
  });
});
