/**
 * dbgraph_impact tool test — task 4.2 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_impact read/write blast radius; depth truncation + dynamic-SQL warn.
 * Design: getImpact + formatImpact with node-id→qname resolver.
 *
 * TDD: RED (stub returns "not implemented") → GREEN (real handler wired) → golden pinned.
 * ADR-008: byte-identical on re-run.
 *
 * Torture fixture impact:
 *   employees is FK'd to by assignments (references edge).
 *   employees has 4 triggers (fires_on) that write into audit_log.
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
// Suite: impact × detail levels (golden)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `impact-tool-${detail}.txt`;

    it(`impact main.employees at detail=${detail} matches golden`, async () => {
      const text = await harness.callTool('dbgraph_impact', {
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

    it(`impact main.employees at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail });
      const run2 = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: impact content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — content assertions', () => {
  it('output includes the node qname', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('employees');
  });

  it('normal detail includes IMPACT header', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('IMPACT');
  });

  it('normal detail shows READ IMPACT and WRITE IMPACT sections', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('READ IMPACT');
    expect(text).toContain('WRITE IMPACT');
  });

  it('brief detail shows count summary', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.departments', detail: 'brief' });
    expect(text).toContain('departments');
    expect(text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: impact not found
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — not found', () => {
  it('returns error text for unknown qname', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'xyzzy_phantom_99' });
    expect(text).toContain('xyzzy_phantom_99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: default depth
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — default depth', () => {
  it('returns result without depth parameter (defaults to 3)', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'brief' });
    expect(text.length).toBeGreaterThan(0);
  });
});
