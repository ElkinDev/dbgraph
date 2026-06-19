/**
 * exit-code-4 regression guard — UnsupportedDialectError → 4 (Batch 5, task 5.5).
 * STRICT TDD: RED → GREEN
 *
 * Adds an EXPLICIT regression assertion that UnsupportedDialectError still maps
 * to exit code 4 via the instanceof path — proving the message change in task 5.4
 * did NOT perturb the mapping, WITHOUT editing exit-code.ts.
 *
 * This test proves:
 *   1. UnsupportedDialectError('pg') maps to 4 (new message, pg listed)
 *   2. UnsupportedDialectError('oracle') still maps to 4 (unknown dialect)
 *   3. The mapping uses instanceof, not string content
 *
 * Spec: schema-extraction "UnsupportedDialectError lists pg and maps to exit code 4
 *   (verified unchanged)". Design: "add explicit instanceof code-4 regression-guard
 *   assertion; do NOT edit exit-code.ts".
 */

import { describe, it, expect } from 'vitest';
import { exitCodeFor } from '../../src/cli/exit-code.js';
import { UnsupportedDialectError } from '../../src/index.js';

describe('exitCodeFor — UnsupportedDialectError → 4 (instanceof guard, task 5.5)', () => {
  it('UnsupportedDialectError("oracle") maps to exit code 4 (baseline — unchanged)', () => {
    const err = new UnsupportedDialectError('oracle');
    expect(exitCodeFor(err)).toBe(4);
  });

  it('UnsupportedDialectError("pg") maps to exit code 4 (pg message does not perturb mapping)', () => {
    // After task 5.4 the message now lists "sqlite, mssql, pg".
    // This asserts the mapping is by instanceof (not string match) and still returns 4.
    const err = new UnsupportedDialectError('pg');
    expect(exitCodeFor(err)).toBe(4);
  });

  it('UnsupportedDialectError message now contains "pg"', () => {
    // Regression guard: the message update from task 5.4 is reflected.
    const err = new UnsupportedDialectError('oracle');
    expect(err.message).toContain('sqlite, mssql, pg');
  });

  it('exit code 4 is stable regardless of the unsupported dialect name', () => {
    // The mapping is by instanceof — any UnsupportedDialectError maps to 4.
    const dialects = ['mysql', 'redis', 'mongodb', 'pg'];
    for (const d of dialects) {
      const err = new UnsupportedDialectError(d);
      expect(exitCodeFor(err)).toBe(4);
    }
  });
});
