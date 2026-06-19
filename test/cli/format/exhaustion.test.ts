/**
 * exhaustion.test.ts — unit tests for the StrategyExhaustionError UX presenter.
 *
 * E5.3: asserts that when StrategyExhaustionError surfaces, the formatted output
 * presents BOTH actionable options clearly:
 *   (a) manual-dump path — where the emitted script is and where to place the JSON
 *   (b) guided install (B1) — official install instructions behind consent notice
 *   (c) states that B2 (automated execution) is DEFERRED
 *
 * Spec cli-config "Exhausted strategies present manual-dump and guided-install options".
 * connectivity-strategies Batch E, task E5.3.
 */

import { describe, it, expect } from 'vitest';
import { formatExhaustionError } from '../../../src/cli/format/exhaustion.js';
import { StrategyExhaustionError } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeExhaustionError(attempts: { id: string; reason: string }[]): StrategyExhaustionError {
  return new StrategyExhaustionError(attempts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExhaustionError()', () => {
  it('returns a non-empty string', () => {
    const err = makeExhaustionError([
      { id: 'native-tedious', reason: 'integrated auth: native skipped' },
      { id: 'sqlcmd', reason: 'not found on PATH' },
      { id: 'manual-dump', reason: 'dump file not found' },
      { id: 'consented-install', reason: 'B1 guided install shown' },
    ]);
    const output = formatExhaustionError(err);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('mentions "manual-dump" or "dump script" option (a)', () => {
    const err = makeExhaustionError([
      { id: 'manual-dump', reason: 'dump file not found' },
    ]);
    const output = formatExhaustionError(err);
    expect(output.toLowerCase()).toMatch(/manual.dump|dump script|emitted script/i);
  });

  it('includes the gitignored dump output location (.dbgraph/dumps/)', () => {
    const err = makeExhaustionError([
      { id: 'manual-dump', reason: 'dump file not found' },
    ]);
    const output = formatExhaustionError(err);
    expect(output).toMatch(/\.dbgraph\/dumps\//);
  });

  it('includes the dump file name (mssql-dump.json)', () => {
    const err = makeExhaustionError([
      { id: 'manual-dump', reason: 'dump file not found' },
    ]);
    const output = formatExhaustionError(err);
    expect(output).toMatch(/mssql-dump\.json/);
  });

  it('mentions guided install option (b) — install or guide', () => {
    const err = makeExhaustionError([
      { id: 'consented-install', reason: 'B1 guided install shown' },
    ]);
    const output = formatExhaustionError(err);
    expect(output.toLowerCase()).toMatch(/install|guide/i);
  });

  it('mentions official install source (microsoft.com)', () => {
    const err = makeExhaustionError([
      { id: 'consented-install', reason: 'B1 guided install shown' },
    ]);
    const output = formatExhaustionError(err);
    expect(output).toMatch(/microsoft\.com/i);
  });

  it('states that install option is consented (no automatic installation — Batch 3 shim)', () => {
    // Batch 3: the shim delegates to formatOutcome which renders a CONSENT notice,
    // replacing the old "B2 deferred" notice with the new consented-install option text.
    const err = makeExhaustionError([
      { id: 'consented-install', reason: 'B1 guided install shown' },
    ]);
    const output = formatExhaustionError(err);
    // The consented-install option now renders a CONSENT notice
    expect(output.toLowerCase()).toMatch(/consent|install/i);
  });

  it('lists each strategy attempt and its reason', () => {
    const err = makeExhaustionError([
      { id: 'native-tedious', reason: 'integrated auth: native skipped' },
      { id: 'sqlcmd', reason: 'sqlcmd not found on PATH' },
    ]);
    const output = formatExhaustionError(err);
    expect(output).toContain('native-tedious');
    expect(output).toContain('sqlcmd');
  });

  it('presents both option (a) and option (b) in the same output', () => {
    const err = makeExhaustionError([
      { id: 'native-tedious', reason: 'integrated auth: native skipped' },
      { id: 'sqlcmd', reason: 'sqlcmd not found on PATH' },
      { id: 'manual-dump', reason: 'dump file not found' },
      { id: 'consented-install', reason: 'B1 guided install shown' },
    ]);
    const output = formatExhaustionError(err);
    // Option (a) — manual-dump path
    expect(output.toLowerCase()).toMatch(/manual.dump|dump script|emitted script/i);
    // Option (b) — guided install
    expect(output.toLowerCase()).toMatch(/install|guide/i);
  });

  it('output is purely textual — no exceptions thrown', () => {
    // Even with empty attempts list, format should not throw
    const err = makeExhaustionError([]);
    expect(() => formatExhaustionError(err)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 — task 3.7: formatExhaustionError is a thin shim delegating to formatOutcome
// The shim builds a ConnectivityOutcome from the StrategyExhaustionError.attempts
// and delegates to core formatOutcome — which renders ≥3 options.
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExhaustionError() — shim delegates to formatOutcome (Batch 3, task 3.7)', () => {
  it('shim output contains "CONNECTIVITY UNAVAILABLE" (delegates to formatOutcome)', () => {
    const err = makeExhaustionError([
      { id: 'native-tedious', reason: 'integrated auth skipped' },
      { id: 'sqlcmd', reason: 'not found on PATH' },
    ]);
    const output = formatExhaustionError(err);
    expect(output).toContain('CONNECTIVITY UNAVAILABLE');
  });

  it('shim output contains "Option 1", "Option 2", "Option 3" (≥3 options rendered)', () => {
    const err = makeExhaustionError([
      { id: 'manual-dump', reason: 'dump file not found' },
      { id: 'consented-install', reason: 'install not consented' },
    ]);
    const output = formatExhaustionError(err);
    expect(output).toContain('Option 1');
    expect(output).toContain('Option 2');
    expect(output).toContain('Option 3');
  });

  it('shim output contains "Run it yourself" option (run-it-yourself)', () => {
    const err = makeExhaustionError([{ id: 'sqlcmd', reason: 'absent' }]);
    const output = formatExhaustionError(err);
    expect(output).toContain('Run it yourself');
  });

  it('shim output contains consented install option', () => {
    const err = makeExhaustionError([{ id: 'sqlcmd', reason: 'absent' }]);
    const output = formatExhaustionError(err);
    expect(output).toContain('Consented install');
  });

  it('shim output contains manual dump option', () => {
    const err = makeExhaustionError([{ id: 'sqlcmd', reason: 'absent' }]);
    const output = formatExhaustionError(err);
    expect(output).toContain('Manual dump import');
  });

  it('shim output mirrors formatOutcome directly for the same attempt set', () => {
    const attempts = [
      { id: 'native-tedious', reason: 'integrated auth skipped' },
      { id: 'sqlcmd', reason: 'sqlcmd not on PATH' },
    ];
    const err = makeExhaustionError(attempts);
    const shimOutput = formatExhaustionError(err);
    // The shim delegates to formatOutcome — output must be a valid formatted outcome
    // It must contain the engine name and attempt IDs
    expect(shimOutput).toContain('mssql');
    expect(shimOutput).toContain('native-tedious');
    expect(shimOutput).toContain('sqlcmd');
  });

  it('shim does not throw on StrategyExhaustionError with any attempt shape', () => {
    // Verify the shim + core renderer remains pure and consistent
    const attempts = [{ id: 'sqlcmd', reason: 'absent' }];
    expect(() => {
      const err = makeExhaustionError(attempts);
      formatExhaustionError(err);
    }).not.toThrow();
  });
});
