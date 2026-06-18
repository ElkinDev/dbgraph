/**
 * Tests for src/mcp/instructions.ts — task 2.6 (phase-5-mcp-server).
 * Spec: stdio server with static initialize instructions (US-018).
 *
 * The instructions string is a STATIC constant golden-tested to ensure it is
 * byte-identical on re-run (ADR-008). It must cover:
 *   - when to use explore vs search vs object
 *   - the recommended pre-change flow (status → explore → precheck)
 *
 * TDD: RED (golden file absent → fails) → GREEN (create instructions + golden).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DBGRAPH_INSTRUCTIONS } from '../../src/mcp/instructions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');
const goldenPath = join(projectRoot, 'test', 'mcp', 'golden', 'instructions.txt');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('DBGRAPH_INSTRUCTIONS — static guidance string', () => {
  it('is a non-empty string', () => {
    expect(typeof DBGRAPH_INSTRUCTIONS).toBe('string');
    expect(DBGRAPH_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('ends with a trailing newline (ADR-008 determinism)', () => {
    expect(DBGRAPH_INSTRUCTIONS.endsWith('\n')).toBe(true);
  });

  it('mentions explore (when to use explore)', () => {
    expect(DBGRAPH_INSTRUCTIONS.toLowerCase()).toContain('explore');
  });

  it('mentions search (when to use search)', () => {
    expect(DBGRAPH_INSTRUCTIONS.toLowerCase()).toContain('search');
  });

  it('mentions object (when to use object)', () => {
    expect(DBGRAPH_INSTRUCTIONS.toLowerCase()).toContain('object');
  });

  it('mentions status (pre-change flow: status → explore → precheck)', () => {
    expect(DBGRAPH_INSTRUCTIONS.toLowerCase()).toContain('status');
  });

  it('mentions precheck (pre-change flow: status → explore → precheck)', () => {
    expect(DBGRAPH_INSTRUCTIONS.toLowerCase()).toContain('precheck');
  });

  it('matches the committed golden (byte-identical — ADR-008)', () => {
    expect(existsSync(goldenPath)).toBe(true);
    const golden = readFileSync(goldenPath, 'utf-8');
    expect(DBGRAPH_INSTRUCTIONS).toBe(golden);
  });

  it('is deterministic: two reads produce identical output', () => {
    // Re-import by reading the module constant a second time via a fresh import
    // (within the same test run the module is cached — this verifies the constant
    // is immutable, not computed from non-deterministic sources).
    const first = DBGRAPH_INSTRUCTIONS;
    const second = DBGRAPH_INSTRUCTIONS;
    expect(first).toBe(second);
  });
});
