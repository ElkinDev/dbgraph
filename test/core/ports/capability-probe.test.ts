/**
 * Tests for the CapabilityProbe port — task 1.1 (resilient-connectivity Batch 1).
 * Spec: connectivity-diagnostics "Engine-agnostic capability probe reports available methods
 *   without raising" — Scenario "Probe port stays driver-free and core-typed".
 * Design: src/core/ports/capability-probe.ts — CapabilityProbe + ProbeResult + CliToolInfo (driver-free).
 *
 * TDD: RED → GREEN.
 * Assertions:
 *   - Shape of CliToolInfo, ProbeResult, CapabilityProbe
 *   - Port is implementable by a test double (no DB, no driver)
 *   - Import surface: module source must NOT import child_process, driver, adapter, cli, or mcp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CapabilityProbe,
  ProbeResult,
  CliToolInfo,
} from '../../../src/core/ports/capability-probe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../..');

// ─────────────────────────────────────────────────────────────────────────────
// CliToolInfo shape
// ─────────────────────────────────────────────────────────────────────────────

describe('CliToolInfo', () => {
  it('accepts all fields present', () => {
    const info: CliToolInfo = { tool: 'sqlcmd', version: '16.0.0001', path: '/usr/bin/sqlcmd' };
    expect(info.tool).toBe('sqlcmd');
    expect(info.version).toBe('16.0.0001');
    expect(info.path).toBe('/usr/bin/sqlcmd');
  });

  it('accepts version null (tool found, version unparseable)', () => {
    const info: CliToolInfo = { tool: 'psql', version: null, path: '/usr/bin/psql' };
    expect(info.version).toBeNull();
  });

  it('accepts path null (tool absent)', () => {
    const info: CliToolInfo = { tool: 'mysql', version: null, path: null };
    expect(info.path).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ProbeResult shape
// ─────────────────────────────────────────────────────────────────────────────

describe('ProbeResult', () => {
  it('accepts native driver present + CLI on PATH', () => {
    const result: ProbeResult = {
      nativeDriver: true,
      cliTools: [{ tool: 'sqlcmd', version: '15.0', path: 'C:\\sqlcmd.exe' }],
      odbc: false,
    };
    expect(result.nativeDriver).toBe(true);
    expect(result.cliTools).toHaveLength(1);
    expect(result.odbc).toBe(false);
  });

  it('accepts all methods absent', () => {
    const result: ProbeResult = {
      nativeDriver: false,
      cliTools: [{ tool: 'sqlcmd', version: null, path: null }],
      odbc: false,
    };
    expect(result.nativeDriver).toBe(false);
    expect(result.cliTools[0]?.path).toBeNull();
  });

  it('cliTools is readonly array', () => {
    const result: ProbeResult = {
      nativeDriver: false,
      cliTools: [],
      odbc: false,
    };
    expect(Array.isArray(result.cliTools)).toBe(true);
  });

  it('accepts odbc: true', () => {
    const result: ProbeResult = {
      nativeDriver: false,
      cliTools: [],
      odbc: true,
    };
    expect(result.odbc).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CapabilityProbe interface — test double implementation
// ─────────────────────────────────────────────────────────────────────────────

describe('CapabilityProbe', () => {
  it('is implementable by a test double (driver-present path)', async () => {
    const probe: CapabilityProbe = {
      engine: 'mssql',
      probe: () =>
        Promise.resolve({
          nativeDriver: true,
          cliTools: [{ tool: 'sqlcmd', version: '15.0.4043.16', path: 'C:\\sqlcmd.exe' }],
          odbc: false,
        }),
    };

    expect(probe.engine).toBe('mssql');
    const result = await probe.probe();
    expect(result.nativeDriver).toBe(true);
    expect(result.cliTools).toHaveLength(1);
    expect(result.cliTools[0]?.tool).toBe('sqlcmd');
  });

  it('is implementable by a test double (driver-absent path)', async () => {
    const probe: CapabilityProbe = {
      engine: 'pg',
      probe: () =>
        Promise.resolve({
          nativeDriver: false,
          cliTools: [{ tool: 'psql', version: null, path: null }],
          odbc: false,
        }),
    };

    const result = await probe.probe();
    expect(result.nativeDriver).toBe(false);
    expect(result.cliTools[0]?.path).toBeNull();
  });

  it('probe() resolves (never rejects) even when detection fails', async () => {
    // The contract: MUST NOT throw, report unavailability as negative result
    const probe: CapabilityProbe = {
      engine: 'mysql',
      probe: () =>
        Promise.resolve({
          nativeDriver: false,
          cliTools: [{ tool: 'mysql', version: null, path: null }],
          odbc: false,
        }),
    };

    await expect(probe.probe()).resolves.toMatchObject({ nativeDriver: false });
  });

  it('probe() does NOT open a DB connection (no connect method on the stub)', () => {
    const probe: CapabilityProbe = {
      engine: 'sqlite',
      probe: () => Promise.resolve({ nativeDriver: true, cliTools: [], odbc: false }),
    };
    // The interface does not expose any connect() method
    expect('connect' in probe).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Import-surface assertion — port must NOT import child_process or drivers
// Mirrors the connectivity-strategy port discipline in boundaries.test.ts:
// extract all import specifiers and check each one.
// ─────────────────────────────────────────────────────────────────────────────

/** Extract all from/import specifier strings from TS source. */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticRe = /(?:import|export)\s+(?:type\s+)?(?:[\w,{}\s*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(source)) !== null) {
    if (m[1] !== undefined) specifiers.push(m[1]);
  }
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(source)) !== null) {
    if (m[1] !== undefined) specifiers.push(m[1]);
  }
  return specifiers;
}

describe('capability-probe.ts import surface (ADR-004)', () => {
  const portPath = join(projectRoot, 'src', 'core', 'ports', 'capability-probe.ts');

  it('port file exists', () => {
    const source = readFileSync(portPath, 'utf-8');
    expect(source.length).toBeGreaterThan(0);
  });

  it('does not import node:child_process', () => {
    const source = readFileSync(portPath, 'utf-8');
    const specifiers = extractImportSpecifiers(source);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/child_process/);
    }
  });

  it('does not import any DB driver (mssql/pg/mysql2/better-sqlite3/tedious)', () => {
    const source = readFileSync(portPath, 'utf-8');
    const specifiers = extractImportSpecifiers(source);
    const forbidden = ['mssql', 'pg', 'mysql2', 'better-sqlite3', 'tedious'];
    for (const spec of specifiers) {
      for (const driver of forbidden) {
        expect(spec).not.toBe(driver);
        expect(spec).not.toMatch(new RegExp(`^${driver}/`));
      }
    }
  });

  it('does not import from adapters, cli, or mcp layers', () => {
    const source = readFileSync(portPath, 'utf-8');
    const specifiers = extractImportSpecifiers(source);
    for (const spec of specifiers) {
      expect(spec).not.toContain('/adapters/');
      expect(spec).not.toContain('/cli/');
      expect(spec).not.toContain('/mcp/');
    }
  });
});
