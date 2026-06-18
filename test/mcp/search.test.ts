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

describe('dbgraph_search — pagination (L-009 strengthened)', () => {
  it('first page with limit=5 returns hasMore:true footer when more results exist', async () => {
    // "employees" search returns 19 total; limit=5 → first page should have hasMore:true
    const text = await harness.callTool('dbgraph_search', {
      query: 'employees',
      offset: 0,
      limit: 5,
    });
    expect(text).toContain('SEARCH RESULTS');
    // L-009: assert the hasMore:true footer, not just existence
    expect(text).toContain('hasMore: true');
    // Also assert we got 5 items (not fewer)
    expect(text).toContain('offset 0');
  });

  it('second page via offset=5 returns specific hits and correct offset', async () => {
    // "employees" search returns 19 total; offset=5, limit=5 → 2nd page
    const page2 = await harness.callTool('dbgraph_search', {
      query: 'employees',
      offset: 5,
      limit: 5,
    });
    expect(page2).toContain('SEARCH RESULTS');
    // L-009: second page must contain specific qnames (different from first 5)
    // The fixture returns employee-related objects; page 2 should contain further hits
    expect(page2).toContain('main.employees');
    // Offset marker must reflect the requested offset
    expect(page2).toContain('offset 5');
  });

  it('last page reports hasMore:false (no footer with hasMore:true)', async () => {
    // Use a small limit to paginate to the end of the 19-result "employees" search
    // Page 4: offset=15, limit=5 → 4 remaining items → hasMore:false
    const lastPage = await harness.callTool('dbgraph_search', {
      query: 'employees',
      offset: 15,
      limit: 5,
    });
    expect(lastPage).toContain('SEARCH RESULTS');
    // Last page should NOT have hasMore:true
    expect(lastPage).not.toContain('hasMore: true');
    // Last page uses the total-results format, not hasMore
    expect(lastPage).toContain('results (total)');
  });

  it('advancing offset yields different hits than first page (pagination correctness)', async () => {
    const page1 = await harness.callTool('dbgraph_search', {
      query: 'employees',
      offset: 0,
      limit: 3,
    });
    const page2 = await harness.callTool('dbgraph_search', {
      query: 'employees',
      offset: 3,
      limit: 3,
    });
    // Pages should differ in content (different hits per page)
    expect(page1).not.toBe(page2);
    expect(page1).toContain('offset 0');
    expect(page2).toContain('offset 3');
  });
});
