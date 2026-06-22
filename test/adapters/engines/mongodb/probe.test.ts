/**
 * MongodbCapabilityProbe unit tests — Batch 3, task 3.4.
 *
 * TDD RED -> GREEN -> REFACTOR.
 * All child_process calls use an injected spawnSync seam (vi.fn pattern).
 * Driver import uses an injected importMongodb seam (mirrors factory.ts pattern).
 * No real mongosh, no real mongodb driver, no DB connection.
 *
 * Spec: mongodb-extraction
 *   - "probe is connection-free and never rejects (resilient-connectivity contract)"
 *   - "nativeDriver via dynamic import without connecting"
 *   - "cliTools via spawnSync where/which mongosh (cross-platform)"
 *   - "odbc: false"
 * US-030 (MongoDB adapter), phase-9b-mongodb Batch 3 task 3.4.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { MongodbCapabilityProbe, type SpawnSyncFn } from '../../../../src/adapters/engines/mongodb/probe.js';

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

/** importMongodb that resolves (driver present — NO MongoClient.connect() called). */
const importMongodbPresent = () => Promise.resolve({ MongoClient: class {} });

/** importMongodb that rejects with MODULE_NOT_FOUND. */
const importMongodbAbsent = () => {
  const err = new Error("Cannot find module 'mongodb'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  return Promise.reject(err);
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MongodbCapabilityProbe — task 3.4', () => {
  it('has engine === "mongodb"', () => {
    const probe = new MongodbCapabilityProbe();
    expect(probe.engine).toBe('mongodb');
  });

  it('probe() returns a ProbeResult with nativeDriver / cliTools / odbc', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
    const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbAbsent });
    const result = await probe.probe();
    expect(result).toMatchObject({
      nativeDriver: expect.any(Boolean),
      cliTools: expect.any(Array),
      odbc: expect.any(Boolean),
    });
  });

  // ── Scenario: mongodb present + mongosh on PATH ─────────────────────────────

  describe('mongodb-present + mongosh-on-PATH', () => {
    it('EXACT-SET: nativeDriver true, mongosh tool with path and version, odbc false', async () => {
      const mongoshPath = '/usr/local/bin/mongosh';
      const versionOutput = 'mongosh 2.3.1';

      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd, args) => {
        if ((cmd === 'where' || cmd === 'which') && args[0] === 'mongosh') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(`${mongoshPath}\n`) });
        }
        if (cmd === 'mongosh' && args[0] === '--version') {
          return makeSpawnResult({ status: 0, stdout: Buffer.from(versionOutput) });
        }
        return makeSpawnResult({ status: 1 });
      });

      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbPresent });
      const result = await probe.probe();

      expect(result.nativeDriver).toBe(true);
      expect(result.cliTools).toHaveLength(1);
      expect(result.cliTools[0]?.tool).toBe('mongosh');
      expect(result.cliTools[0]?.path).toBe(mongoshPath);
      expect(result.cliTools[0]?.version).toMatch(/2\.3\.1/);
      expect(result.odbc).toBe(false);
    });

    it('does NOT call MongoClient.connect() during probe', async () => {
      let connectCalled = false;
      const importMongodbWithSpy = () =>
        Promise.resolve({
          MongoClient: class {
            connect() {
              connectCalled = true;
              return Promise.resolve();
            }
          },
        });

      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbWithSpy });
      await probe.probe();
      expect(connectCalled).toBe(false);
    });
  });

  // ── Scenario: mongodb absent + mongosh absent ───────────────────────────────

  describe('mongodb-absent + mongosh-absent', () => {
    it('EXACT-SET: nativeDriver false, mongosh tool with null version and null path, odbc false', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbAbsent });
      const result = await probe.probe();

      expect(result).toEqual({
        nativeDriver: false,
        cliTools: [{ tool: 'mongosh', version: null, path: null }],
        odbc: false,
      });
    });

    it('does NOT throw when both mongodb and mongosh are absent', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 1 }));
      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbAbsent });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });

  // ── Scenario: timed-out / errored detection ──────────────────────────────────

  describe('timed-out or errored detection treated as unavailable', () => {
    it('spawnSync error set → mongosh reported unavailable, no throw', async () => {
      const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(
        makeSpawnResult({ error: new Error('ETIMEDOUT'), status: null as unknown as number }),
      );
      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbAbsent });
      const result = await probe.probe();
      expect(result.cliTools[0]?.version).toBeNull();
      expect(result.cliTools[0]?.path).toBeNull();
    });

    it('probe() NEVER rejects even when seams throw', async () => {
      const badSpawn = vi.fn<SpawnSyncFn>().mockImplementation(() => {
        throw new Error('spawn exploded');
      });
      const probe = new MongodbCapabilityProbe({ spawnSync: badSpawn, importMongodb: importMongodbAbsent });
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
      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbAbsent, platform: 'win32' });
      await probe.probe();
      expect(commands[0]).toBe('where');
    });

    it('uses "which" on Linux', async () => {
      const commands: string[] = [];
      const spawnSync = vi.fn<SpawnSyncFn>().mockImplementation((cmd) => {
        commands.push(cmd);
        return makeSpawnResult({ status: 1 });
      });
      const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbAbsent, platform: 'linux' });
      await probe.probe();
      expect(commands[0]).toBe('which');
    });
  });

  // ── odbc is always false for mongodb ──────────────────────────────────────

  it('odbc is always false (N/A for mongodb)', async () => {
    const spawnSync = vi.fn<SpawnSyncFn>().mockReturnValue(makeSpawnResult({ status: 0 }));
    const probe = new MongodbCapabilityProbe({ spawnSync, importMongodb: importMongodbPresent });
    const result = await probe.probe();
    expect(result.odbc).toBe(false);
  });
});
