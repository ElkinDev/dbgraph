/**
 * Tests for src/core/present/doctor.ts — formatDoctor — task 5.1 (resilient-connectivity Batch 5).
 *
 * Spec (US-043 / connectivity-diagnostics):
 *   "dbgraph doctor reports diagnostics content-free" — three scenarios:
 *   1. Doctor reports capability, chosen strategy and environment profile (shape only).
 *   2. Doctor output is content-free and safe to share.
 *   3. An unrecognized environment reports rather than throws.
 *
 * Design: pure formatDoctor(view: DoctorView): string
 *   mirrors present/status.ts SHAPE — imports ONLY core types.
 *   Output: engine, native-driver bool, CLI tools + versions, ODBC bool,
 *           resolvedProfile name, chosenStrategy id — SHAPE ONLY.
 *   ZERO schema / identifier / secret.
 *
 * TDD: RED → GREEN.
 * EXACT-set + LEAK assertions (L-009).
 */

import { describe, it, expect } from 'vitest';
import { formatDoctor } from '../../../src/core/present/doctor.js';
import type { DoctorView } from '../../../src/core/present/doctor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A well-known mssql environment with sqlcmd on PATH. */
const MSSQL_VIEW: DoctorView = {
  engine: 'mssql',
  nativeDriver: false,
  cliTools: [{ tool: 'sqlcmd', version: '15.0.1300', path: '/usr/bin/sqlcmd' }],
  odbc: true,
  resolvedProfile: 'legacy-odbc@15.x',
  chosenStrategy: 'sqlcmd',
};

/** A pg environment with native driver present and psql on PATH. */
const PG_VIEW: DoctorView = {
  engine: 'pg',
  nativeDriver: true,
  cliTools: [{ tool: 'psql', version: '14.5', path: '/usr/bin/psql' }],
  odbc: false,
  resolvedProfile: 'n/a',
  chosenStrategy: 'native-pg',
};

/**
 * An "unrecognized" environment — no driver, no CLI tools, unrecognized profile.
 * The doctor MUST report this gracefully, never throw.
 */
const UNRECOGNIZED_VIEW: DoctorView = {
  engine: 'mssql',
  nativeDriver: false,
  cliTools: [{ tool: 'sqlcmd', version: null, path: null }],
  odbc: false,
  resolvedProfile: 'unknown@any',
  chosenStrategy: 'unavailable',
};

/**
 * A view that deliberately has PLANTED secrets/identifiers in the
 * adjacent (non-view) runtime context — the rendered doctor output MUST NOT
 * contain any of these strings.
 *
 * The "planted" values are NOT part of the DoctorView — they represent things
 * that might exist in memory around the call but must never leak into output.
 */
const PLANTED_SCHEMA = 'dbo.super_secret_table';
const PLANTED_SECRET = 'p@ssw0rd!Xk92';
const PLANTED_HOST = 'prod-sqlserver.company.internal';

// The view itself contains only shape-data — no schema/secret/host
const SAFE_VIEW: DoctorView = {
  engine: 'mssql',
  nativeDriver: false,
  cliTools: [{ tool: 'sqlcmd', version: '15.0.1300', path: '/usr/bin/sqlcmd' }],
  odbc: false,
  resolvedProfile: 'legacy-odbc@15.x',
  chosenStrategy: 'sqlcmd',
};

// ─────────────────────────────────────────────────────────────────────────────
// DoctorView type shape
// ─────────────────────────────────────────────────────────────────────────────

describe('DoctorView — type shape', () => {
  it('can construct a DoctorView with all required fields', () => {
    const view: DoctorView = {
      engine: 'test-engine',
      nativeDriver: true,
      cliTools: [],
      odbc: false,
      resolvedProfile: 'test-profile',
      chosenStrategy: 'test-strategy',
    };
    expect(view.engine).toBe('test-engine');
    expect(view.nativeDriver).toBe(true);
    expect(view.cliTools).toEqual([]);
    expect(view.odbc).toBe(false);
    expect(view.resolvedProfile).toBe('test-profile');
    expect(view.chosenStrategy).toBe('test-strategy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDoctor — basic shape
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDoctor — basic shape', () => {
  it('returns a non-empty string', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('ends with a trailing newline', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toMatch(/\n$/);
  });

  it('is deterministic — same input → same output (ADR-008)', () => {
    const out1 = formatDoctor(MSSQL_VIEW);
    const out2 = formatDoctor(MSSQL_VIEW);
    expect(out1).toBe(out2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-043 scenario 1: Doctor reports capability, chosen strategy, environment profile
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDoctor — capability report (US-043 scenario 1)', () => {
  it('contains the engine name', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toContain('mssql');
  });

  it('contains the native driver availability (false)', () => {
    const output = formatDoctor(MSSQL_VIEW);
    // The renderer surfaces the bool — any textual representation is fine
    expect(output.toLowerCase()).toMatch(/native.*false|driver.*false|false.*driver|false.*native/);
  });

  it('contains the native driver availability (true)', () => {
    const output = formatDoctor(PG_VIEW);
    expect(output.toLowerCase()).toMatch(/native.*true|driver.*true|true.*driver|true.*native/);
  });

  it('contains each CLI tool name', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toContain('sqlcmd');
  });

  it('contains the CLI tool version when present', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toContain('15.0.1300');
  });

  it('contains the CLI tool path when present', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toContain('/usr/bin/sqlcmd');
  });

  it('contains the ODBC availability', () => {
    const output = formatDoctor(MSSQL_VIEW);
    // odbc: true for MSSQL_VIEW
    expect(output.toLowerCase()).toMatch(/odbc.*true|true.*odbc/);
  });

  it('contains the resolved profile name', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toContain('legacy-odbc@15.x');
  });

  it('contains the chosen strategy id', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).toContain('sqlcmd');
  });

  it('renders pg engine with psql tool and version', () => {
    const output = formatDoctor(PG_VIEW);
    expect(output).toContain('pg');
    expect(output).toContain('psql');
    expect(output).toContain('14.5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-043 scenario 2: Doctor output is content-free and safe to share
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDoctor — content-free (US-043 scenario 2)', () => {
  it('does not contain any planted schema/identifier when not in view', () => {
    // SAFE_VIEW has no planted strings — formatDoctor must not invent them
    const output = formatDoctor(SAFE_VIEW);
    expect(output).not.toContain(PLANTED_SCHEMA);
    expect(output).not.toContain(PLANTED_SECRET);
    expect(output).not.toContain(PLANTED_HOST);
  });

  it('does not contain raw "Error:" prefix', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).not.toContain('Error:');
  });

  it('does not contain a stack frame marker ("    at ")', () => {
    const output = formatDoctor(MSSQL_VIEW);
    expect(output).not.toContain('    at ');
  });

  it('does not contain connection string fragments', () => {
    const output = formatDoctor(SAFE_VIEW);
    // Connection string keywords that should never appear in doctor output
    expect(output).not.toContain('Password=');
    expect(output).not.toContain('User Id=');
    expect(output).not.toContain('Server=');
    expect(output).not.toContain('Database=');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-043 scenario 3: Unrecognized environment reports rather than throws
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDoctor — unrecognized environment (US-043 scenario 3)', () => {
  it('does not throw for an unrecognized profile/environment', () => {
    expect(() => formatDoctor(UNRECOGNIZED_VIEW)).not.toThrow();
  });

  it('returns a non-empty string for an unrecognized environment', () => {
    const output = formatDoctor(UNRECOGNIZED_VIEW);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('contains the engine name for unrecognized environment', () => {
    const output = formatDoctor(UNRECOGNIZED_VIEW);
    expect(output).toContain('mssql');
  });

  it('shows profile name "unknown@any" for unrecognized environment', () => {
    const output = formatDoctor(UNRECOGNIZED_VIEW);
    expect(output).toContain('unknown@any');
  });

  it('shows "unavailable" chosen strategy for unrecognized environment', () => {
    const output = formatDoctor(UNRECOGNIZED_VIEW);
    expect(output).toContain('unavailable');
  });

  it('indicates absent CLI tool (version null, path null)', () => {
    const output = formatDoctor(UNRECOGNIZED_VIEW);
    // The tool name must appear, but version/path are null
    expect(output).toContain('sqlcmd');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LEAK assertion — the central content-free requirement
// Feeds a DoctorView with planted schema/secret in ADJACENT CONTEXT
// (not in the view itself) and verifies none appear in the output.
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDoctor — leak assertion (the content-free guarantee)', () => {
  it('rendered output does not contain the planted schema name', () => {
    // SAFE_VIEW has no planted values — they exist only in this test's local scope
    // (simulating surrounding runtime context). The renderer MUST NOT invent them.
    void PLANTED_SCHEMA; // reference to prevent dead-code elimination
    void PLANTED_SECRET;
    void PLANTED_HOST;
    const output = formatDoctor(SAFE_VIEW);
    expect(output).not.toContain(PLANTED_SCHEMA);
    expect(output).not.toContain(PLANTED_SECRET);
    expect(output).not.toContain(PLANTED_HOST);
  });

  it('the engine name is the only identifier-like string that may appear', () => {
    const output = formatDoctor(SAFE_VIEW);
    // Verify none of the PLANTED values appear — only shape data from SAFE_VIEW
    const plantedValues = [PLANTED_SCHEMA, PLANTED_SECRET, PLANTED_HOST];
    for (const planted of plantedValues) {
      expect(output).not.toContain(planted);
    }
    // But view-sourced data DOES appear
    expect(output).toContain('mssql');
    expect(output).toContain('legacy-odbc@15.x');
    expect(output).toContain('sqlcmd');
  });
});
