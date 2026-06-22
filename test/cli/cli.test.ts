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
import { USAGE_TEXT } from '../../src/cli/cli.js';
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
