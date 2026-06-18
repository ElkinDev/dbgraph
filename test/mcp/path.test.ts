/**
 * dbgraph_path tool test — task 3.4 (phase-5-mcp-server).
 * Spec: dbgraph_path shortest join path; No route reports neighbors.
 * Design: wraps findJoinPath + formatPath; declared references edges only; golden per tool.
 *
 * TDD: RED (tool not implemented) → GREEN (tool wired) → golden pinned.
 * ADR-008: byte-identical on re-run.
 *
 * Torture fixture has:
 *   employees → departments (via dept_id FK)
 *   assignments → employees (via emp_id + dept_id composite FK)
 * So employees→departments is a direct 1-hop path.
 * projects has no FK, so employees→projects = no route.
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
// Suite: path — found route (golden)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_path — found route (golden)', () => {
  const goldenFile = 'path-tool-found.txt';

  it('path employees→departments matches golden', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.departments',
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

  it('path employees→departments is byte-identical on re-run (ADR-008)', async () => {
    if (CAPTURE) return;

    const run1 = await harness.callTool('dbgraph_path', { from: 'main.employees', to: 'main.departments' });
    const run2 = await harness.callTool('dbgraph_path', { from: 'main.employees', to: 'main.departments' });
    expect(run1).toBe(run2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: path — no route (golden)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_path — no route (golden)', () => {
  const goldenFile = 'path-tool-noroute.txt';

  it('path employees→projects (no FK) matches golden', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.projects',
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

  it('path employees→projects is byte-identical on re-run (ADR-008)', async () => {
    if (CAPTURE) return;

    const run1 = await harness.callTool('dbgraph_path', { from: 'main.employees', to: 'main.projects' });
    const run2 = await harness.callTool('dbgraph_path', { from: 'main.employees', to: 'main.projects' });
    expect(run1).toBe(run2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_path — content assertions', () => {
  it('found path includes PATH header with from and to', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.departments',
    });
    expect(text).toContain('PATH');
    expect(text).toContain('employees');
    expect(text).toContain('departments');
  });

  it('found path includes JOIN ON line for the FK column', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.departments',
    });
    expect(text).toContain('JOIN ON');
    expect(text).toContain('dept_id');
  });

  it('no-route path includes "No join path found"', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.projects',
    });
    expect(text).toContain('No join path found');
  });

  it('no-route path includes neighbor suggestions', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'main.employees',
      to: 'main.projects',
    });
    // Should suggest neighbors for each endpoint
    expect(text).toContain('Neighbors of');
  });

  it('returns error for unknown from table', async () => {
    const text = await harness.callTool('dbgraph_path', {
      from: 'xyzzy_nonexistent_table',
      to: 'main.employees',
    });
    expect(text).toContain('NOT_FOUND');
  });
});
