/**
 * dbgraph_related tool test — task 3.3 (phase-5-mcp-server).
 * Spec: dbgraph_related grouped by edge kind and direction; kinds filter restricts.
 * Design: wraps getNeighbors + formatRelated; detail brief|normal|full; golden per detail.
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
// Suite: related × detail levels
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_related — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `related-tool-${detail}.txt`;

    it(`related employees at detail=${detail} matches golden`, async () => {
      const text = await harness.callTool('dbgraph_related', {
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

    it(`related employees at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_related', { qname: 'main.employees', detail });
      const run2 = await harness.callTool('dbgraph_related', { qname: 'main.employees', detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_related — content assertions', () => {
  it('output includes RELATED header with qname', async () => {
    const text = await harness.callTool('dbgraph_related', { qname: 'main.employees' });
    expect(text).toContain('RELATED');
    expect(text).toContain('employees');
  });

  it('kinds filter restricts to only references edges', async () => {
    const text = await harness.callTool('dbgraph_related', {
      qname: 'main.employees',
      kinds: ['references'],
    });
    expect(text).toContain('references');
    // Should not contain fires_on (triggers) when filtered to references only
    expect(text).not.toContain('fires_on');
  });

  it('returns error for unknown qname', async () => {
    const text = await harness.callTool('dbgraph_related', {
      qname: 'xyzzy_nonexistent_q99',
    });
    expect(text).toContain('NOT_FOUND');
  });

  it('default detail is normal (matches normal golden)', async () => {
    if (CAPTURE) return;
    const text = await harness.callTool('dbgraph_related', { qname: 'main.employees' });
    const normal = readGolden('related-tool-normal.txt');
    expect(text).toBe(normal);
  });
});
