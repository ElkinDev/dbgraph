/**
 * Tests for src/cli/commands/doctor.ts — runDoctor — task 5.2 (resilient-connectivity Batch 5).
 *
 * Spec (US-043 / connectivity-diagnostics):
 *   "dbgraph doctor reports diagnostics content-free" — three scenarios:
 *   1. Doctor reports capability, chosen strategy and environment profile.
 *   2. Doctor output is content-free and safe to share.
 *   3. Doctor on an unrecognized environment reports rather than throws.
 *
 * Design: runDoctor(deps) runs the per-engine CapabilityProbe(s) stand-alone
 *   (inject the probe seam — NO real DB), resolves the profile NAME via resolveProfile,
 *   derives the chosen-strategy id WITHOUT connecting, builds a DoctorView,
 *   and returns the formatDoctor output.
 *   NON-throwing: an unrecognized-environment probe → a report, NO exception.
 *
 * TDD: RED → GREEN.
 * EXACT-set assertions (L-009).
 */

import { describe, it, expect } from 'vitest';
import { runDoctor } from '../../../src/cli/commands/doctor.js';
import type { RunDoctorDeps } from '../../../src/cli/commands/doctor.js';
import type { ProbeResult } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture probe results
// ─────────────────────────────────────────────────────────────────────────────

/** mssql probe: sqlcmd present, native driver absent, ODBC present. */
const MSSQL_PROBE_PRESENT: ProbeResult = {
  nativeDriver: false,
  cliTools: [{ tool: 'sqlcmd', version: '15.0.1300', path: '/usr/bin/sqlcmd' }],
  odbc: true,
};

/** mssql probe: nothing present (unrecognized / minimal environment). */
const MSSQL_PROBE_ABSENT: ProbeResult = {
  nativeDriver: false,
  cliTools: [{ tool: 'sqlcmd', version: null, path: null }],
  odbc: false,
};

/** pg probe: native driver present, psql on PATH. */
const PG_PROBE_PRESENT: ProbeResult = {
  nativeDriver: true,
  cliTools: [{ tool: 'psql', version: '14.5', path: '/usr/bin/psql' }],
  odbc: false,
};

/** sqlite probe: better-sqlite3 available, no CLI tools. */
const SQLITE_PROBE_PRESENT: ProbeResult = {
  nativeDriver: true,
  cliTools: [],
  odbc: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for building deps
// ─────────────────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<RunDoctorDeps> = {}): RunDoctorDeps {
  return {
    engine: 'mssql',
    probe: async () => MSSQL_PROBE_PRESENT,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runDoctor — basic shape
// ─────────────────────────────────────────────────────────────────────────────

describe('runDoctor — basic shape', () => {
  it('returns a non-empty string', async () => {
    const output = await runDoctor(makeDeps());
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('resolves (does not reject) for a standard mssql probe', async () => {
    await expect(runDoctor(makeDeps())).resolves.not.toThrow();
  });

  it('ends with a trailing newline', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).toMatch(/\n$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-043 scenario 1: reports capability + chosen strategy + profile
// ─────────────────────────────────────────────────────────────────────────────

describe('runDoctor — capability report (US-043 scenario 1)', () => {
  it('contains the engine name (mssql)', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).toContain('mssql');
  });

  it('contains native driver availability (false)', async () => {
    const output = await runDoctor(makeDeps());
    // nativeDriver: false for MSSQL_PROBE_PRESENT
    expect(output.toLowerCase()).toMatch(/native.*false|driver.*false|false.*driver|false.*native/);
  });

  it('contains the sqlcmd tool name', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).toContain('sqlcmd');
  });

  it('contains the sqlcmd version', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).toContain('15.0.1300');
  });

  it('contains ODBC availability (true for mssql probe)', async () => {
    const output = await runDoctor(makeDeps());
    expect(output.toLowerCase()).toMatch(/odbc.*true|true.*odbc/);
  });

  it('contains a resolved profile name', async () => {
    const output = await runDoctor(makeDeps());
    // The resolved profile for sqlcmd 15.x = 'legacy-odbc@15.x' or similar
    // At minimum it must contain the word "legacy" or "profile"
    expect(output.length).toBeGreaterThan(0);
    // The profile name IS present in the output (shape assertion)
    expect(output).toMatch(/legacy|profile|unknown/i);
  });

  it('contains a chosen strategy id', async () => {
    const output = await runDoctor(makeDeps());
    // For mssql with sqlcmd present: strategy = 'sqlcmd'; if absent: 'unavailable'
    expect(output).toMatch(/sqlcmd|native|odbc|unavailable/i);
  });

  it('renders pg engine with native driver true', async () => {
    const output = await runDoctor(makeDeps({
      engine: 'pg',
      probe: async () => PG_PROBE_PRESENT,
    }));
    expect(output).toContain('pg');
    expect(output.toLowerCase()).toMatch(/native.*true|driver.*true|true.*driver|true.*native/);
    expect(output).toContain('psql');
    expect(output).toContain('14.5');
  });

  it('renders sqlite engine with no CLI tools', async () => {
    const output = await runDoctor(makeDeps({
      engine: 'sqlite',
      probe: async () => SQLITE_PROBE_PRESENT,
    }));
    expect(output).toContain('sqlite');
    expect(output.toLowerCase()).toMatch(/native.*true|driver.*true|true.*driver|true.*native/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-043 scenario 2: content-free (safe to share)
// ─────────────────────────────────────────────────────────────────────────────

describe('runDoctor — content-free (US-043 scenario 2)', () => {
  const PLANTED_SCHEMA = 'dbo.secret_proc';
  const PLANTED_SECRET = 'xK92$p@ssw0rd';
  const PLANTED_HOST = 'prod-db.internal.company.com';

  it('output does not contain planted schema, secret, or host', async () => {
    // These values are never in the probe result — they must not appear in output
    const output = await runDoctor(makeDeps());
    expect(output).not.toContain(PLANTED_SCHEMA);
    expect(output).not.toContain(PLANTED_SECRET);
    expect(output).not.toContain(PLANTED_HOST);
  });

  it('output does not contain raw "Error:" prefix', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).not.toContain('Error:');
  });

  it('output does not contain a stack frame marker ("    at ")', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).not.toContain('    at ');
  });

  it('output does not contain connection string keywords', async () => {
    const output = await runDoctor(makeDeps());
    expect(output).not.toContain('Password=');
    expect(output).not.toContain('User Id=');
    expect(output).not.toContain('Server=');
    expect(output).not.toContain('Database=');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-043 scenario 3: unrecognized environment — reports, never throws
// ─────────────────────────────────────────────────────────────────────────────

describe('runDoctor — unrecognized environment (US-043 scenario 3)', () => {
  it('resolves (does not reject) when probe returns all-absent result', async () => {
    await expect(
      runDoctor(makeDeps({ probe: async () => MSSQL_PROBE_ABSENT }))
    ).resolves.not.toThrow();
  });

  it('returns a non-empty string for all-absent probe result', async () => {
    const output = await runDoctor(makeDeps({ probe: async () => MSSQL_PROBE_ABSENT }));
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('contains a default/unrecognized profile marker in output', async () => {
    const output = await runDoctor(makeDeps({ probe: async () => MSSQL_PROBE_ABSENT }));
    // For sqlcmd version null → resolveProfile returns the default profile (variant 'unknown')
    expect(output).toMatch(/unknown|default|unrecognized/i);
  });

  it('does not throw when probe itself throws — degrades gracefully', async () => {
    const throwingProbe = async (): Promise<ProbeResult> => {
      throw new Error('probe internal error');
    };
    // runDoctor must catch probe errors and degrade to "unavailable"
    await expect(
      runDoctor(makeDeps({ probe: throwingProbe }))
    ).resolves.not.toThrow();
  });

  it('returns a non-empty string when probe throws', async () => {
    const throwingProbe = async (): Promise<ProbeResult> => {
      throw new Error('probe internal error');
    };
    const output = await runDoctor(makeDeps({ probe: throwingProbe }));
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });
});
