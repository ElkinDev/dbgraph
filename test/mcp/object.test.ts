/**
 * dbgraph_object tool test — task 4.1 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_object orchestrator — getNodeByQName + getNeighbors → formatObject.
 * Design: columns/PK/FK/indexes/triggers; metadata states body omitted; ambiguous → candidates.
 *
 * TDD: RED (stub returns "not implemented") → GREEN (real handler wired) → golden pinned.
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
// Suite: object × detail levels (golden)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_object — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `object-tool-${detail}.txt`;

    it(`object main.employees at detail=${detail} matches golden`, async () => {
      const text = await harness.callTool('dbgraph_object', {
        qname: 'main.employees',
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

    it(`object main.employees at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail });
      const run2 = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: object content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_object — content assertions', () => {
  it('output includes the table name', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('employees');
  });

  it('normal detail includes COLUMNS section', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('COLUMNS');
  });

  it('normal detail shows emp_id column', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('emp_id');
  });

  it('full detail includes INDEXES section', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail: 'full' });
    expect(text).toContain('INDEXES');
  });

  it('full detail includes TRIGGERS section', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'main.employees', detail: 'full' });
    expect(text).toContain('TRIGGERS');
  });

  it('brief detail returns non-empty output', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'main.departments', detail: 'brief' });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('departments');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: not found
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_object — not found', () => {
  it('returns error text for unknown qname', async () => {
    const text = await harness.callTool('dbgraph_object', { qname: 'xyzzy_phantom_table_99' });
    expect(text).toContain('xyzzy_phantom_table_99');
  });
});
