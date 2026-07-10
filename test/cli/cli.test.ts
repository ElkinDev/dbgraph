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

  // ── phase-7-docs / US-038: install banner documents the --project scope flag ──

  it('install banner line documents --project with the EXACT pinned text (US-038)', () => {
    // cli-config scenario "install banner line documents the --project flag with the
    // exact text" — a single-character drift (e.g. dropping --project) fails the build.
    const installLine =
      USAGE_TEXT.split('\n').find((l) => l.trimStart().startsWith('install')) ?? '';
    expect(installLine).toBe(
      '  install   Wire dbgraph-mcp into supported MCP agents (--project for project scope, --remove to undo)',
    );
  });

  it('install banner line stays multi-agent AND still documents --remove (no single-agent regression)', () => {
    const installLine =
      USAGE_TEXT.split('\n').find((l) => l.trimStart().startsWith('install')) ?? '';
    expect(installLine).toContain('agents');
    expect(installLine).toContain('--project');
    expect(installLine).toContain('--remove');
    expect(installLine).not.toContain('Claude Desktop');
  });

  // ── http-transport task 4.1: the mcp banner line documents the --http surface ──

  it('mcp banner line is present with EXACTLY the pinned, column-aligned text (task 4.1)', () => {
    // cli-config scenario "mcp banner line is present with the exact aligned text":
    // two leading spaces, `mcp`, seven spaces — description aligned at character index 12,
    // matching init/affected/doctor/install. A single-character drift fails the build.
    const mcpLine = USAGE_TEXT.split('\n').find((l) => l.trimStart().startsWith('mcp')) ?? '';
    expect(mcpLine).toBe(
      '  mcp       Serve the MCP tools over stdio (default) or Streamable HTTP (--http)',
    );
    // The description column is index 12 (same as every other command line).
    expect(mcpLine.indexOf('Serve')).toBe(12);
    // Dropping the --http mention must fail the build (silent-SSE/misconfig guard).
    expect(mcpLine).toContain('--http');
  });

  // ── explore-payloads C.5: the object banner line, column-aligned + placed after explore ──

  it('object banner line is present with EXACTLY the pinned, column-aligned text (C.5)', () => {
    // cli-config scenario "usage banner documents the object line with the exact alignment":
    // two leading spaces, `object`, four spaces — description aligned at character index 12,
    // matching query/explore/install. Dropping the object command fails the build.
    const objectLine = USAGE_TEXT.split('\n').find((l) => l.trimStart().startsWith('object')) ?? '';
    expect(objectLine).toBe(
      '  object    Show one object in full (columns, constraints, indexes, triggers)',
    );
    // Description column is index 12 (same as every other command line).
    expect(objectLine.indexOf('Show')).toBe(12);
  });

  it('object line is placed immediately AFTER the explore line (C.5)', () => {
    const lines = USAGE_TEXT.split('\n');
    const exploreIdx = lines.findIndex((l) => l.trimStart().startsWith('explore'));
    const objectIdx = lines.findIndex((l) => l.trimStart().startsWith('object'));
    expect(exploreIdx).toBeGreaterThanOrEqual(0);
    expect(objectIdx).toBe(exploreIdx + 1);
  });

  // ── graph-viz task 3.4: the viz banner line, column-aligned + placed after object (Q4) ──

  it('viz banner line is present with EXACTLY the pinned, column-aligned text (task 3.4)', () => {
    // cli-config scenario "viz banner line is present with the exact aligned text":
    // two leading spaces, `viz`, seven spaces — description aligned at character index 12,
    // matching init/object/mcp/install. Dropping the viz/--mermaid/--out mention fails the pin.
    const vizLine = USAGE_TEXT.split('\n').find((l) => l.trimStart().startsWith('viz')) ?? '';
    expect(vizLine).toBe(
      '  viz       Export a self-contained interactive graph HTML (--mermaid ER, --out path, --full all nodes)',
    );
    // Description column is index 12 (same as every other command line).
    expect(vizLine.indexOf('Export')).toBe(12);
    expect(vizLine).toContain('--mermaid');
    expect(vizLine).toContain('--out');
  });

  it('viz line is placed immediately AFTER the object line (Q4)', () => {
    const lines = USAGE_TEXT.split('\n');
    const objectIdx = lines.findIndex((l) => l.trimStart().startsWith('object'));
    const vizIdx = lines.findIndex((l) => l.trimStart().startsWith('viz'));
    expect(objectIdx).toBeGreaterThanOrEqual(0);
    expect(vizIdx).toBe(objectIdx + 1);
  });

  it('adding the viz line leaves every existing command line byte-identical (Q4 insertion-only)', () => {
    for (const line of [
      '  init      Initialize the graph index for a database',
      '  sync      Synchronize the graph index with the database',
      '  status    Show the current state of the graph index',
      '  query     Search the graph index for a term',
      '  explore   Explore a node and its neighbors in the graph',
      '  object    Show one object in full (columns, constraints, indexes, triggers)',
      '  diff      Compare two snapshots of the graph index',
      '  affected  Analyze DDL to show impacted objects (--json for machine output)',
      '  install   Wire dbgraph-mcp into supported MCP agents (--project for project scope, --remove to undo)',
      '  doctor    Run a content-free connectivity self-test (safe to share)',
      '  mcp       Serve the MCP tools over stdio (default) or Streamable HTTP (--http)',
    ]) {
      expect(USAGE_TEXT).toContain(line);
    }
  });

  it('adds ONLY the mcp line — every existing command line stays byte-identical (task 4.1)', () => {
    // cli-config scenario "Adding the mcp line leaves the other command lines unchanged":
    // init…doctor (incl. the pinned install line) are byte-identical to before.
    for (const line of [
      '  init      Initialize the graph index for a database',
      '  sync      Synchronize the graph index with the database',
      '  status    Show the current state of the graph index',
      '  query     Search the graph index for a term',
      '  explore   Explore a node and its neighbors in the graph',
      '  diff      Compare two snapshots of the graph index',
      '  affected  Analyze DDL to show impacted objects (--json for machine output)',
      '  install   Wire dbgraph-mcp into supported MCP agents (--project for project scope, --remove to undo)',
      '  doctor    Run a content-free connectivity self-test (safe to share)',
    ]) {
      expect(USAGE_TEXT).toContain(line);
    }
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

  it('DBGRAPH_VERSION placeholder is still exactly "1.1.0" (fallback anchor for the smoke)', () => {
    expect(DBGRAPH_VERSION).toBe('1.1.0');
  });

  it('runCli(["--version"]) with DBGRAPH_BUILD_VERSION unset prints EXACTLY "1.1.0\\n" and returns 0', async () => {
    const code = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('1.1.0\n');
  });

  it('runCli(["-v"]) with DBGRAPH_BUILD_VERSION unset prints EXACTLY "1.1.0\\n" and returns 0', async () => {
    const code = await runCli(['-v']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('1.1.0\n');
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

  // phase-9.5c task 2.6 prerequisite (spec R1): top-level `--help`/`-h` must exit 0
  // and print USAGE to stdout. parseArgv makes the first token the command, so the
  // command-position must be handled like --version (Batch 1 only wired the flag
  // position). The no-node_modules smoke asserts `--help` on the binary — exit 0.
  it('runCli(["--help"]) prints USAGE to stdout and returns 0 (command position, spec R1)', async () => {
    const code = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe(USAGE_TEXT + '\n');
  });

  it('runCli(["-h"]) prints USAGE to stdout and returns 0 (command position, spec R1)', async () => {
    const code = await runCli(['-h']);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe(USAGE_TEXT + '\n');
  });
});
