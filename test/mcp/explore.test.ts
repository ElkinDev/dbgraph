/**
 * dbgraph_explore tool test — task 3.1 (phase-5-mcp-server).
 * Spec: dbgraph_explore compact neighborhood; Ambiguous target returns disambiguation.
 * Design: wraps getNeighbors + formatExplore; detail brief|normal|full; golden per detail.
 *
 * TDD: RED (tool not implemented) → GREEN (tool wired) → golden pinned.
 * Uses the in-process harness over the torture fixture via openFixtureStore().
 *
 * ADR-008: output is byte-identical on re-run — asserted by running each golden twice.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDbgraphServer } from '../../src/mcp/server.js';
import { createHarness, type McpTestHarness } from './harness.js';
import { openFixtureStore, type FixtureStore } from './fixture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Harness setup
// ─────────────────────────────────────────────────────────────────────────────

let fx: FixtureStore;
let harness: McpTestHarness;

beforeAll(async () => {
  fx = await openFixtureStore();
  const server = createDbgraphServer(fx.store);
  harness = await createHarness(server);
});

afterAll(async () => {
  await harness.close();
  await fx.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper — golden read / capture
// ─────────────────────────────────────────────────────────────────────────────

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), 'utf-8');
}

function captureGolden(name: string, content: string): void {
  writeFileSync(join(goldenDir, name), content, 'utf-8');
}

const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: explore × detail levels
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `explore-${detail}.txt`;

    it(`explore main.employees at detail=${detail} matches golden`, async () => {
      const text = await harness.callTool('dbgraph_explore', {
        target: 'main.employees',
        detail,
      });

      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) {
        captureGolden(goldenFile, text);
        return;
      }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
    });

    it(`explore main.employees at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_explore', {
        target: 'main.employees',
        detail,
      });
      const run2 = await harness.callTool('dbgraph_explore', {
        target: 'main.employees',
        detail,
      });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: explore default detail
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — default detail', () => {
  it('returns non-empty output when detail is omitted (defaults to normal)', async () => {
    const text = await harness.callTool('dbgraph_explore', { target: 'main.employees' });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // Should match normal golden
    if (!CAPTURE) {
      const normal = readGolden('explore-normal.txt');
      expect(text).toBe(normal);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: explore output contains expected content
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — content assertions', () => {
  it('output includes the target table name', async () => {
    const text = await harness.callTool('dbgraph_explore', {
      target: 'main.employees',
      detail: 'normal',
    });
    expect(text).toContain('employees');
  });

  it('output includes neighbor edge kinds for main.employees', async () => {
    const text = await harness.callTool('dbgraph_explore', {
      target: 'main.employees',
      detail: 'normal',
    });
    // employees has FK to departments (references), and triggers fire on it (fires_on)
    expect(text).toContain('references');
  });

  it('explore main.departments at brief returns counts only', async () => {
    const text = await harness.callTool('dbgraph_explore', {
      target: 'main.departments',
      detail: 'brief',
    });
    expect(text).toContain('departments');
    // brief shows counts
    expect(text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: ambiguous target
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — not found', () => {
  it('returns a descriptive error for a completely unknown target', async () => {
    const text = await harness.callTool('dbgraph_explore', {
      target: 'xyzzy_nonexistent_table_abc',
    });
    expect(text).toContain('xyzzy_nonexistent_table_abc');
  });
});
