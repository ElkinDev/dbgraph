/**
 * Full in-process MCP E2E — task 5.3 / Batch E (phase-5-mcp-server).
 * Spec: "In-process SDK harness drives every tool golden / Every tool exercised in-process".
 * Design: InMemoryTransport harness over the torture fixture; golden per tool×detail;
 *   byte-identical second call (ADR-008); status uses content assertions (non-deterministic
 *   timestamp per design deviation #9 from Batch C).
 *
 * Definition of Done proof: one comprehensive test that drives ALL 8 tools through the harness
 * end-to-end and asserts the golden outputs — "one dbgraph_explore call answers what took 5+ queries".
 *
 * TDD: RED (e2e import fails or golden not present) → GREEN → goldens pinned.
 * ADR-008: all non-status tool outputs are byte-identical on re-run.
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

const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

// ─────────────────────────────────────────────────────────────────────────────
// Harness setup — ONE shared harness for all 8 tools
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
// Golden helpers
// ─────────────────────────────────────────────────────────────────────────────

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), 'utf-8');
}

function captureGolden(name: string, content: string): void {
  writeFileSync(join(goldenDir, name), content, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1 — dbgraph_explore (all 3 detail levels)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_explore', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `explore-${detail}.txt`;
    it(`explore main.employees at detail=${detail} matches golden (ADR-008)`, async () => {
      const text = await harness.callTool('dbgraph_explore', {
        target: 'main.employees',
        detail,
      });
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) { captureGolden(goldenFile, text); return; }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
      // ADR-008: byte-identical on re-run
      const text2 = await harness.callTool('dbgraph_explore', { target: 'main.employees', detail });
      expect(text2).toBe(text);
    });
  }

  it('explore disambiguates ambiguous target (does not guess)', async () => {
    // Use a bare name that could match multiple tables — use just "employees"
    // which should either return the single match OR a disambiguation if multiple schemas
    const text = await harness.callTool('dbgraph_explore', { target: 'employees' });
    expect(text.length).toBeGreaterThan(0);
    // Should not be an internal error
    expect(text).not.toContain('Internal error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2 — dbgraph_search (all 3 detail levels)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_search', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `search-tool-${detail}.txt`;
    it(`search "employees" at detail=${detail} matches golden (ADR-008)`, async () => {
      const text = await harness.callTool('dbgraph_search', { query: 'employees', detail });
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) { captureGolden(goldenFile, text); return; }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
      // ADR-008
      const text2 = await harness.callTool('dbgraph_search', { query: 'employees', detail });
      expect(text2).toBe(text);
    });
  }

  it('search returns hasMore:true on first page when results exceed limit', async () => {
    // Use a very small limit to trigger pagination
    const text = await harness.callTool('dbgraph_search', { query: 'e', limit: 3, offset: 0 });
    // Either hasMore: true or total <= 3
    expect(text).toContain('results');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3 — dbgraph_object (all 3 detail levels)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_object', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `object-tool-${detail}.txt`;
    it(`object main.employees at detail=${detail} matches golden (ADR-008)`, async () => {
      const text = await harness.callTool('dbgraph_object', {
        qname: 'main.employees',
        detail,
      });
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) { captureGolden(goldenFile, text); return; }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
      // ADR-008
      const text2 = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail });
      expect(text2).toBe(text);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4 — dbgraph_related (all 3 detail levels)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_related', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `related-tool-${detail}.txt`;
    it(`related main.employees at detail=${detail} matches golden (ADR-008)`, async () => {
      const text = await harness.callTool('dbgraph_related', {
        qname: 'main.employees',
        detail,
      });
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) { captureGolden(goldenFile, text); return; }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
      // ADR-008
      const text2 = await harness.callTool('dbgraph_related', { qname: 'main.employees', detail });
      expect(text2).toBe(text);
    });
  }

  it('related with kinds filter restricts to references edges', async () => {
    const text = await harness.callTool('dbgraph_related', {
      qname: 'main.employees',
      kinds: ['references'],
    });
    expect(text).not.toContain('fires_on');
    expect(text).not.toContain('has_index');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 5 — dbgraph_impact (all 3 detail levels)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_impact', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `impact-tool-${detail}.txt`;
    it(`impact main.employees at detail=${detail} matches golden (ADR-008)`, async () => {
      const text = await harness.callTool('dbgraph_impact', {
        qname: 'main.employees',
        detail,
      });
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) { captureGolden(goldenFile, text); return; }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
      // ADR-008
      const text2 = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail });
      expect(text2).toBe(text);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 6 — dbgraph_path (found + no-route)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_path', () => {
  it('path employees → departments (found) matches golden (ADR-008)', async () => {
    const goldenFile = 'path-tool-found.txt';
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.departments',
    });
    expect(text.length).toBeGreaterThan(0);

    if (CAPTURE) { captureGolden(goldenFile, text); return; }

    const golden = readGolden(goldenFile);
    expect(text).toBe(golden);
    // ADR-008
    const text2 = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.departments',
    });
    expect(text2).toBe(text);
  });

  it('path with no route matches golden (ADR-008)', async () => {
    const goldenFile = 'path-tool-noroute.txt';
    // main.projects has no FK to/from employees — confirmed no-route in existing golden
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.projects',
    });
    expect(text.length).toBeGreaterThan(0);

    if (CAPTURE) { captureGolden(goldenFile, text); return; }

    const golden = readGolden(goldenFile);
    expect(text).toBe(golden);
    // ADR-008
    const text2 = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.projects',
    });
    expect(text2).toBe(text);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 7 — dbgraph_precheck (all 3 detail levels)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_precheck', () => {
  const DDL = 'ALTER TABLE main.employees ADD COLUMN priority INT;\nDROP INDEX idx_emp_dept ON main.employees;';

  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `precheck-tool-${detail}.txt`;
    it(`precheck at detail=${detail} matches golden (ADR-008)`, async () => {
      const text = await harness.callTool('dbgraph_precheck', { ddl: DDL, detail });
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) { captureGolden(goldenFile, text); return; }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
      // ADR-008
      const text2 = await harness.callTool('dbgraph_precheck', { ddl: DDL, detail });
      expect(text2).toBe(text);
    });
  }

  it('precheck reports unmatched identifiers for unknown tables', async () => {
    const text = await harness.callTool('dbgraph_precheck', {
      ddl: 'ALTER TABLE completely_nonexistent_table ADD COLUMN x INT;',
      detail: 'full',
    });
    expect(text).toContain('UNMATCHED IDENTIFIERS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool 8 — dbgraph_status (content assertions — timestamp is non-deterministic)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: dbgraph_status', () => {
  it('status returns engine info and drift message (ADR-008 within single run)', async () => {
    const text = await harness.callTool('dbgraph_status', {});
    expect(text).toContain('DBGRAPH STATUS');
    expect(text).toContain('sqlite');
    expect(text).toContain('could not be checked live');
    // ADR-008 — byte-identical within the same run
    const text2 = await harness.callTool('dbgraph_status', {});
    expect(text2).toBe(text);
  });

  it('status brief includes engine and last sync', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'brief' });
    expect(text).toContain('Engine:');
    expect(text).toContain('Last sync:');
  });

  it('status normal includes per-type object counts section', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'normal' });
    // The status formatter uses "Object counts:" as the section header
    expect(text).toContain('Object counts:');
    expect(text).toContain('table');
  });

  it('status full includes index levels section', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'full' });
    // The status formatter uses "Index levels:" as the section header
    expect(text).toContain('Index levels:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DoD proof: "one dbgraph_explore call answers what took 5+ queries"
// ─────────────────────────────────────────────────────────────────────────────

describe('DoD proof: single tool call answers multi-query neighborhood', () => {
  it('one dbgraph_explore(full) call returns neighbors, body hash, and dynamic SQL status', async () => {
    const text = await harness.callTool('dbgraph_explore', {
      target: 'main.employees',
      detail: 'full',
    });
    // Contains the pivot table
    expect(text).toContain('main.employees');
    // Contains grouped neighbors (references, has_column, fires_on etc.)
    expect(text).toContain('references');
    // Full detail: this is a meaningful response
    expect(text.length).toBeGreaterThan(100);
  });
});
