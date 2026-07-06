/**
 * Tests for cli.ts skeleton — task 2.4 (phase-4-cli-config).
 * Spec: cli-config exit contract + Design Decision 9.
 * The full E2E (spawn + exit codes) is gated to Batch G (task 7.4).
 * This test confirms:
 *   - USAGE_TEXT is exported and contains each known command
 *   - runCli exists as a callable async function
 * Batch 3 (task 3.6): ConnectivityUnavailableError is caught and rendered via formatOutcome.
 * TDD: RED → GREEN.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { USAGE_TEXT, runCli } from '../../src/cli/cli.js';
import { DBGRAPH_VERSION } from '../../src/index.js';
// Note: runCli not directly tested here; dispatch mock not used via module spy

// ─────────────────────────────────────────────────────────────────────────────
// USAGE_TEXT content
// ─────────────────────────────────────────────────────────────────────────────

describe('cli — USAGE_TEXT', () => {
  it('USAGE_TEXT is a non-empty string', () => {
    expect(typeof USAGE_TEXT).toBe('string');
    expect(USAGE_TEXT.length).toBeGreaterThan(0);
  });

  it('USAGE_TEXT mentions "init"', () => {
    expect(USAGE_TEXT).toContain('init');
  });

  it('USAGE_TEXT mentions "sync"', () => {
    expect(USAGE_TEXT).toContain('sync');
  });

  it('USAGE_TEXT mentions "status"', () => {
    expect(USAGE_TEXT).toContain('status');
  });

  it('USAGE_TEXT mentions "query"', () => {
    expect(USAGE_TEXT).toContain('query');
  });

  it('USAGE_TEXT mentions "explore"', () => {
    expect(USAGE_TEXT).toContain('explore');
  });

  it('USAGE_TEXT mentions "diff"', () => {
    expect(USAGE_TEXT).toContain('diff');
  });

  it('USAGE_TEXT mentions "affected"', () => {
    expect(USAGE_TEXT).toContain('affected');
  });

  it('USAGE_TEXT mentions "install"', () => {
    expect(USAGE_TEXT).toContain('install');
  });

  // ── ux-observability task 3.1: banner install line describes the MULTI-AGENT reality ──

  it('install line does NOT describe a single agent ("Claude Desktop")', () => {
    // Pin: a future single-agent regression MUST fail the build (US-038 install is multi-agent).
    expect(USAGE_TEXT).not.toContain('Claude Desktop');
  });

  it('install line describes supported MCP agents (multi-agent), with --remove to undo', () => {
    const installLine =
      USAGE_TEXT.split('\n').find((l) => l.trimStart().startsWith('install')) ?? '';
    expect(installLine).toContain('agents');
    expect(installLine).toContain('--remove');
    expect(installLine).not.toContain('Claude Desktop');
  });

  it('banner agent wording is consistent with install MANUAL_SNIPPET (single source of truth)', async () => {
    const { MANUAL_SNIPPET } = await import('../../src/cli/commands/install.js');
    // install.ts owns the supported-agents list; the banner must speak the same multi-agent language.
    expect(MANUAL_SNIPPET).toContain('Supported agents');
    expect(USAGE_TEXT.toLowerCase()).toContain('agents');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 — task 3.6: ConnectivityUnavailableError catch renders via formatOutcome
// ─────────────────────────────────────────────────────────────────────────────

import { ConnectivityUnavailableError } from '../../src/index.js';
import type { ConnectivityOutcome } from '../../src/index.js';

function makeTestOutcome(): ConnectivityOutcome {
  return {
    engine: 'pg',
    summary: 'No pg connectivity available',
    attempts: [{ id: 'native-pg', reason: 'driver absent' }],
    options: [
      {
        kind: 'run-it-yourself',
        description: 'Run these SELECTs',
        queries: ['SELECT name FROM sys.schemas WHERE is_ms_shipped = 0'],
      },
      {
        kind: 'consented-install',
        description: 'Install pg',
        tool: 'pg',
        docUrl: 'https://npmjs.com/package/pg',
      },
      {
        kind: 'manual-dump',
        description: 'Import dump',
        outputPath: '.dbgraph/dumps/pg-dump.json',
      },
    ],
  };
}

describe('cli — ConnectivityUnavailableError rendering (Batch 3, task 3.6)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('formatOutcome renders CONNECTIVITY UNAVAILABLE header', async () => {
    const { formatOutcome } = await import('../../src/index.js');
    const rendered = formatOutcome(makeTestOutcome());
    expect(rendered).toContain('CONNECTIVITY UNAVAILABLE');
  });

  it('formatOutcome renders all 3 option numbers', async () => {
    const { formatOutcome } = await import('../../src/index.js');
    const rendered = formatOutcome(makeTestOutcome());
    expect(rendered).toContain('Option 1');
    expect(rendered).toContain('Option 2');
    expect(rendered).toContain('Option 3');
  });

  it('formatOutcome rendered output has no stack-frame text', async () => {
    const { formatOutcome } = await import('../../src/index.js');
    const rendered = formatOutcome(makeTestOutcome());
    // No "Error:" prefixed lines, no "  at SomeFunction(" stack lines
    expect(rendered).not.toContain('Error:');
    expect(rendered).not.toMatch(/\s{2,}at\s+\w+\s*\(/);
  });

  it('ConnectivityUnavailableError code is E_CONNECTIVITY_UNAVAILABLE', () => {
    const err = new ConnectivityUnavailableError(makeTestOutcome());
    expect(err.code).toBe('E_CONNECTIVITY_UNAVAILABLE');
  });

  it('formatOutcome output (what cli.ts catch block writes) contains option text, no stack', async () => {
    // Verify the outcome path produces output that the catch block would write to stderr.
    const { formatOutcome } = await import('../../src/index.js');
    const outcome = makeTestOutcome();
    const rendered = formatOutcome(outcome);
    // The catch block writes this to stderr — verify it contains option text, not stack
    expect(rendered).not.toMatch(/\s{2,}at\s+\w/);
    expect(rendered).toContain('Run it yourself');
  });

  it('cli.ts USAGE_TEXT contains "doctor" command (added in task 3.6)', () => {
    expect(USAGE_TEXT).toContain('doctor');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase-9.5c task 1.1 — `--version`/`-v` branch in runCli (design D6)
// The binary must answer `--version` with NO package.json on disk: the value is
// `process.env.DBGRAPH_BUILD_VERSION ?? DBGRAPH_VERSION`. esbuild `define` bakes the
// literal at bundle time; off-SEA the env var is undefined → falls back to
// DBGRAPH_VERSION ('0.0.0'). RED → GREEN in `npm test` (no binary required).
// ─────────────────────────────────────────────────────────────────────────────

describe('cli — --version / -v (task 1.1, design D6)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stdout: string[];
  const originalBuildVersion = process.env['DBGRAPH_BUILD_VERSION'];

  beforeEach(() => {
    stdout = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    delete process.env['DBGRAPH_BUILD_VERSION'];
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    if (originalBuildVersion === undefined) {
      delete process.env['DBGRAPH_BUILD_VERSION'];
    } else {
      process.env['DBGRAPH_BUILD_VERSION'] = originalBuildVersion;
    }
  });

  it('DBGRAPH_VERSION placeholder is still exactly "0.0.0" (fallback anchor for the smoke)', () => {
    expect(DBGRAPH_VERSION).toBe('0.0.0');
  });

  it('runCli(["--version"]) with DBGRAPH_BUILD_VERSION unset prints EXACTLY "0.0.0\\n" and returns 0', async () => {
    const code = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('0.0.0\n');
  });

  it('runCli(["-v"]) with DBGRAPH_BUILD_VERSION unset prints EXACTLY "0.0.0\\n" and returns 0', async () => {
    const code = await runCli(['-v']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('0.0.0\n');
  });

  it('runCli(["--version"]) with DBGRAPH_BUILD_VERSION set to "9.9.9" prints EXACTLY "9.9.9\\n" and returns 0', async () => {
    process.env['DBGRAPH_BUILD_VERSION'] = '9.9.9';
    const code = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('9.9.9\n');
  });

  it('USAGE_TEXT documents the --version flag', () => {
    expect(USAGE_TEXT).toContain('--version');
  });

  it('USAGE_TEXT still begins with the product banner (unchanged by --version addition)', () => {
    expect(USAGE_TEXT.startsWith('dbgraph — database schema graph indexer')).toBe(true);
  });
});
