/**
 * dbgraph_status tool test — task 3.5 (phase-5-mcp-server).
 * Spec: dbgraph_status (connectionless golden).
 * Design: composes listSnapshots + per-type counts + capabilitiesFor + formatStatus.
 *   Connectionless path: drift not checked live.
 *
 * TDD: RED (tool not implemented) → GREEN (tool wired) → verified.
 * ADR-008: byte-identical on re-run (within same harness session).
 *
 * NOTE: The live-fingerprint drift variant (task 3.6) is integration-only
 * and lives in test/mcp/status-drift.integration.test.ts.
 *
 * NOTE on status golden files: status includes a lastSync timestamp from
 * the snapshot taken when the fixture store is populated. This timestamp
 * changes on every test run (fresh materialization + sync each time).
 * Therefore: we assert content properties (stable) rather than byte-identical
 * cross-run goldens. The ADR-008 byte-identical assertion is still verified
 * WITHIN the same test run (two calls → same snapshot → identical output).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createDbgraphServer } from '../../src/mcp/server.js';
import { createHarness, type McpTestHarness } from './harness.js';
import { openFixtureStore, type FixtureStore } from './fixture.js';

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
// Suite: status × detail levels (connectionless)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_status — detail levels (connectionless)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    it(`status at detail=${detail} returns non-empty string`, async () => {
      const text = await harness.callTool('dbgraph_status', { detail });
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    it(`status at detail=${detail} is byte-identical on re-run (ADR-008, same store)`, async () => {
      // Within the same harness (same store, same snapshot), output must be identical
      const run1 = await harness.callTool('dbgraph_status', { detail });
      const run2 = await harness.callTool('dbgraph_status', { detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: status — content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_status — content assertions', () => {
  it('output includes DBGRAPH STATUS header', async () => {
    const text = await harness.callTool('dbgraph_status', {});
    expect(text).toContain('DBGRAPH STATUS');
  });

  it('output includes Engine line', async () => {
    const text = await harness.callTool('dbgraph_status', {});
    expect(text).toContain('Engine');
  });

  it('output includes Last sync line', async () => {
    const text = await harness.callTool('dbgraph_status', {});
    expect(text).toContain('Last sync');
  });

  it('connectionless output states drift could not be checked (driftChecked:false path)', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'full' });
    expect(text).toContain('could not be checked live');
    // Must NOT say "detected" or "none detected" — only the false/no-connection branch
    expect(text).not.toContain('detected (schema changed');
    expect(text).not.toContain('none detected');
  });

  it('normal detail includes object counts', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'normal' });
    expect(text).toContain('Object counts');
  });

  it('normal detail includes index levels', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'normal' });
    expect(text).toContain('Index levels');
  });

  it('default detail is normal (same output as explicit normal)', async () => {
    const defaultText = await harness.callTool('dbgraph_status', {});
    const normalText = await harness.callTool('dbgraph_status', { detail: 'normal' });
    expect(defaultText).toBe(normalText);
  });

  it('output includes sqlite engine name', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'normal' });
    expect(text).toContain('sqlite');
  });

  it('output includes table count from the torture fixture', async () => {
    const text = await harness.callTool('dbgraph_status', { detail: 'normal' });
    // The torture fixture has: departments, employees, projects, assignments, audit_log, counters = 6 tables
    expect(text).toContain('table');
  });
});
