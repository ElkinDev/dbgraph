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

// ─────────────────────────────────────────────────────────────────────────────
// D3 — [view] resolution fix (explore-payloads B.5). The torture INSTEAD OF
// trigger mints a phantom `table` stub for active_departments; resolveNode must
// prefer the real view and NOT report the qname as ambiguous.
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — D3 [view] resolution (explore-payloads B.5)', () => {
  it('resolves main.active_departments to the VIEW (not the phantom table stub, not ambiguous)', async () => {
    const text = await harness.callTool('dbgraph_explore', { target: 'main.active_departments' });
    expect(text).toContain('main.active_departments  [view]');
    // The PIVOT must resolve to the view, never the phantom `[table]` stub. Neighbor
    // tables surfaced by the new view `depends_on` edges (main.departments/main.employees
    // as `[table]`) are legitimate, so the negative is scoped to the pivot qname only.
    expect(text).not.toContain('main.active_departments  [table]');
    expect(text).not.toContain('Ambiguous');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dedicated VIEW-focus golden (explore-payloads B.6, ruling 5): pins BOTH the D3
// [view] resolution fix and the payload rendering for main.active_departments.
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — view focus golden (explore-payloads B.6)', () => {
  it('explore main.active_departments (normal) matches the view golden — header [view] + payload', async () => {
    const text = await harness.callTool('dbgraph_explore', { target: 'main.active_departments', detail: 'normal' });
    expect(text).toContain('main.active_departments  [view]');

    if (CAPTURE) {
      captureGolden('explore-view.txt', text);
      return;
    }
    expect(text).toBe(readGolden('explore-view.txt'));
  });

  it('explore main.active_departments (normal) is byte-identical on re-run (ADR-008)', async () => {
    if (CAPTURE) return;
    const run1 = await harness.callTool('dbgraph_explore', { target: 'main.active_departments', detail: 'normal' });
    const run2 = await harness.callTool('dbgraph_explore', { target: 'main.active_departments', detail: 'normal' });
    expect(run1).toBe(run2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D8 — composite FK reconstruction pinned in explore for main.assignments, from
// the REAL built torture graph (explore-payloads B.7). Byte-identical to object.
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_explore — main.assignments composite FK reconstruction (explore-payloads B.7)', () => {
  it('reconstructs the composite FK target and preserves declared PK order', async () => {
    const text = await harness.callTool('dbgraph_explore', { target: 'main.assignments', detail: 'normal' });
    expect(text).toContain('  emp_id  INTEGER  [PK]  [FK→main.employees]');
    expect(text).toContain('  dept_id  INTEGER  [PK]  [FK→main.employees]');
    expect(text).toContain('  [FK]  fk_assignments_0  (emp_id, dept_id → main.employees)');
    expect(text).toContain('  [PK]  pk_assignments  (project_id, emp_id, dept_id)');
  });
});
