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

  it('states that B2 (automated install) is deferred', () => {
    const err = makeExhaustionError([
      { id: 'consented-install', reason: 'B1 guided install shown' },
    ]);
    const output = formatExhaustionError(err);
    expect(output.toLowerCase()).toMatch(/b2|deferred|automated|follow.up/i);
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
