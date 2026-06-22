/**
 * SqliteCapabilityProbe unit tests — Batch 2, task 2.4.
 *
 * TDD: RED → GREEN → REFACTOR.
 * Driver import uses injected seams (importBetterSqlite / importNodeSqlite).
 * No real drivers, no DB file.
 *
 * Spec: connectivity-diagnostics
 *   - "the probe reports availability per engine without raising"
 *   - "Absent driver and absent CLI are reported, not raised"
 *
 * SQLite probe notes:
 *   - nativeDriver: true if better-sqlite3 OR node:sqlite is available
 *   - cliTools: [] (no separate CLI tool for SQLite extraction)
 *   - odbc: false (N/A for SQLite)
 */

import { describe, it, expect } from 'vitest';
import { SqliteCapabilityProbe } from '../../../../src/adapters/engines/sqlite/probe.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seam factories
// ─────────────────────────────────────────────────────────────────────────────

/** better-sqlite3 resolves (present). */
const importBetterSqlitePresent = () => Promise.resolve({ Database: class {} });

/** better-sqlite3 rejects (absent). */
const importBetterSqliteAbsent = () => {
  const err = new Error("Cannot find module 'better-sqlite3'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  return Promise.reject(err);
};

/** node:sqlite resolves (present — Node >= 22.5 mock). */
const importNodeSqlitePresent = () => Promise.resolve({ DatabaseSync: class {} });

/** node:sqlite rejects (absent or old Node). */
const importNodeSqliteAbsent = () => {
  const err = new Error("Cannot find module 'node:sqlite'");
  (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
  return Promise.reject(err);
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteCapabilityProbe — task 2.4', () => {
  it('has engine === "sqlite"', () => {
    const probe = new SqliteCapabilityProbe();
    expect(probe.engine).toBe('sqlite');
  });

  it('probe() returns a ProbeResult with nativeDriver / cliTools / odbc', async () => {
    const probe = new SqliteCapabilityProbe({
      importBetterSqlite: importBetterSqliteAbsent,
      importNodeSqlite: importNodeSqliteAbsent,
    });
    const result = await probe.probe();
    expect(result).toMatchObject({
      nativeDriver: expect.any(Boolean),
      cliTools: expect.any(Array),
      odbc: expect.any(Boolean),
    });
  });

  // ── cliTools is always empty for SQLite ─────────────────────────────────────

  it('cliTools is always an empty array (no separate CLI for SQLite)', async () => {
    const probe = new SqliteCapabilityProbe({
      importBetterSqlite: importBetterSqlitePresent,
      importNodeSqlite: importNodeSqliteAbsent,
    });
    const result = await probe.probe();
    expect(result.cliTools).toEqual([]);
  });

  it('odbc is always false (N/A for SQLite)', async () => {
    const probe = new SqliteCapabilityProbe({
      importBetterSqlite: importBetterSqlitePresent,
      importNodeSqlite: importNodeSqliteAbsent,
    });
    const result = await probe.probe();
    expect(result.odbc).toBe(false);
  });

  // ── Scenario: better-sqlite3 present ───────────────────────────────────────

  describe('better-sqlite3 present', () => {
    it('nativeDriver: true when better-sqlite3 resolves', async () => {
      const probe = new SqliteCapabilityProbe({
        importBetterSqlite: importBetterSqlitePresent,
        importNodeSqlite: importNodeSqliteAbsent,
      });
      const result = await probe.probe();
      expect(result.nativeDriver).toBe(true);
    });
  });

  // ── Scenario: node:sqlite present ──────────────────────────────────────────

  describe('node:sqlite present (better-sqlite3 absent)', () => {
    it('nativeDriver: true when node:sqlite resolves but better-sqlite3 is absent', async () => {
      const probe = new SqliteCapabilityProbe({
        importBetterSqlite: importBetterSqliteAbsent,
        importNodeSqlite: importNodeSqlitePresent,
      });
      const result = await probe.probe();
      expect(result.nativeDriver).toBe(true);
    });
  });

  // ── Scenario: both drivers absent ──────────────────────────────────────────

  describe('both drivers absent', () => {
    it('EXACT-SET: nativeDriver false, cliTools empty, odbc false', async () => {
      const probe = new SqliteCapabilityProbe({
        importBetterSqlite: importBetterSqliteAbsent,
        importNodeSqlite: importNodeSqliteAbsent,
      });
      const result = await probe.probe();

      expect(result).toEqual({
        nativeDriver: false,
        cliTools: [],
        odbc: false,
      });
    });

    it('does NOT throw when both drivers are absent', async () => {
      const probe = new SqliteCapabilityProbe({
        importBetterSqlite: importBetterSqliteAbsent,
        importNodeSqlite: importNodeSqliteAbsent,
      });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });

  // ── Scenario: NON-throwing even when imports throw synchronously ────────────

  describe('non-throwing guarantee', () => {
    it('probe() NEVER rejects when importBetterSqlite throws synchronously', async () => {
      const throwingImport = () => { throw new Error('sync throw'); };
      const probe = new SqliteCapabilityProbe({
        importBetterSqlite: throwingImport,
        importNodeSqlite: importNodeSqliteAbsent,
      });
      await expect(probe.probe()).resolves.toBeDefined();
    });

    it('probe() NEVER rejects when both imports throw synchronously', async () => {
      const throwingImport = () => { throw new Error('sync throw'); };
      const probe = new SqliteCapabilityProbe({
        importBetterSqlite: throwingImport,
        importNodeSqlite: throwingImport,
      });
      await expect(probe.probe()).resolves.toBeDefined();
    });
  });
});
