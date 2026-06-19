/**
 * Tests for dispatch + USAGE_TEXT — task 5.3 (resilient-connectivity Batch 5).
 *
 * Spec (US-043 / connectivity-diagnostics):
 *   "there SHALL be a dbgraph doctor diagnostic command".
 *
 * Assertions:
 *   - dispatch('doctor') returns { type: 'handler' }
 *   - USAGE_TEXT contains the doctor entry
 *
 * Design: handleDoctor is added to COMMAND_TABLE in dispatch.ts;
 *   the doctor line exists in USAGE_TEXT in cli.ts.
 *
 * TDD: RED → GREEN.
 * EXACT-set assertions (L-009).
 */

import { describe, it, expect } from 'vitest';
import { dispatch } from '../../../src/cli/dispatch.js';
import { USAGE_TEXT } from '../../../src/cli/cli.js';

// ─────────────────────────────────────────────────────────────────────────────
// dispatch('doctor') — registered as a handler
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch — doctor command', () => {
  it('dispatch("doctor") returns type "handler"', () => {
    const result = dispatch('doctor');
    expect(result.type).toBe('handler');
  });

  it('dispatch("doctor") handler is a function', () => {
    const result = dispatch('doctor');
    expect(result.type).toBe('handler');
    if (result.type === 'handler') {
      expect(typeof result.handler).toBe('function');
    }
  });

  it('doctor handler is different from all other handlers', () => {
    const doctor = dispatch('doctor');
    const init = dispatch('init');
    const sync = dispatch('sync');
    const status = dispatch('status');
    const install = dispatch('install');

    if (doctor.type === 'handler') {
      if (init.type === 'handler') expect(doctor.handler).not.toBe(init.handler);
      if (sync.type === 'handler') expect(doctor.handler).not.toBe(sync.handler);
      if (status.type === 'handler') expect(doctor.handler).not.toBe(status.handler);
      if (install.type === 'handler') expect(doctor.handler).not.toBe(install.handler);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// USAGE_TEXT — doctor entry
// ─────────────────────────────────────────────────────────────────────────────

describe('USAGE_TEXT — doctor entry', () => {
  it('USAGE_TEXT contains "doctor"', () => {
    expect(USAGE_TEXT).toContain('doctor');
  });

  it('USAGE_TEXT doctor entry contains "content-free" or "self-test"', () => {
    // The doctor line in USAGE_TEXT must describe its content-free nature
    expect(USAGE_TEXT.toLowerCase()).toMatch(/content.free|self.test|safe to share/);
  });
});
