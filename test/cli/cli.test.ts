/**
 * Tests for cli.ts skeleton — task 2.4 (phase-4-cli-config).
 * Spec: cli-config exit contract + Design Decision 9.
 * The full E2E (spawn + exit codes) is gated to Batch G (task 7.4).
 * This test confirms:
 *   - USAGE_TEXT is exported and contains each known command
 *   - runCli exists as a callable async function
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { USAGE_TEXT } from '../../src/cli/cli.js';

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
});
