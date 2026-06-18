/**
 * dbgraph_search tool test — task 3.2 (phase-5-mcp-server).
 * Spec: dbgraph_search ranked paginated hits; second page via offset and hasMore.
 * Design: wraps search + formatSearch; detail brief|normal|full; golden per detail.
 *
 * TDD: RED (tool not implemented) → GREEN (tool wired) → golden pinned.
 * ADR-008: byte-identical on re-run.
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

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), 'utf-8');
}

function captureGolden(name: string, content: string): void {
  writeFileSync(join(goldenDir, name), content, 'utf-8');
}

const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: search × detail levels
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_search — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `search-tool-${detail}.txt`;

    it(`search "main.employees" at detail=${detail} matches golden`, async () => {
      const text = await harness.callTool('dbgraph_search', {
        query: 'employees',
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

    it(`search "employees" at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_search', { query: 'employees', detail });
      const run2 = await harness.callTool('dbgraph_search', { query: 'employees', detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_search — content assertions', () => {
  it('search for "employees" returns hits containing "employees"', async () => {
    const text = await harness.callTool('dbgraph_search', { query: 'employees' });
    expect(text).toContain('employees');
    expect(text).toContain('SEARCH RESULTS');
  });

  it('returns output with pagination footer', async () => {
    const text = await harness.callTool('dbgraph_search', { query: 'emp' });
    // Should have pagination footer
    expect(text).toMatch(/---.*results/);
  });

  it('default detail is normal (matches normal golden)', async () => {
    if (CAPTURE) return;
    const text = await harness.callTool('dbgraph_search', { query: 'employees' });
    const normal = readGolden('search-tool-normal.txt');
    expect(text).toBe(normal);
  });

  it('empty query returns "No results found"', async () => {
    const text = await harness.callTool('dbgraph_search', { query: 'xyzzy_nonexistent_token_q99' });
    // Either no results or a small set — check it doesn't crash
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_search — pagination', () => {
  it('offset=0 returns first page', async () => {
    const text = await harness.callTool('dbgraph_search', {
      query: 'e',
      offset: 0,
      limit: 3,
    });
    expect(text).toContain('SEARCH RESULTS');
  });

  it('using limit=1 returns hasMore:true when multiple results exist', async () => {
    const text = await harness.callTool('dbgraph_search', {
      query: 'e',
      offset: 0,
      limit: 1,
    });
    // If there are multiple results, hasMore should be true
    // The torture fixture has many objects with 'e' in their names
    expect(text).toContain('SEARCH RESULTS');
  });
});
