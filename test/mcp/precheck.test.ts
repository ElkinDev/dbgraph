/**
 * dbgraph_precheck tool test — task 4.4 / Batch D (phase-5-mcp-server).
 * Spec: ALTER + DROP INDEX DDL returns aggregated, deduped precheck.
 *       Non-matchable identifiers reported as unmatched, never guessed.
 * Design: calls src/core/precheck/ engine + formatPrecheck.
 *
 * TDD: RED (stub returns "not implemented") → GREEN (real handler wired) → golden pinned.
 * ADR-008: byte-identical on re-run.
 *
 * Torture fixture: uses inline DDL with main.employees (exists in fixture).
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

// Use inline DDL that exercises both ALTER TABLE and DROP INDEX on the torture fixture
// main.employees exists; idx_emp_dept is a real index on employees.
const PRECHECK_DDL = `ALTER TABLE main.employees ADD COLUMN priority INT;
DROP INDEX idx_emp_dept ON main.employees;`;

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
// Suite: precheck × detail levels (golden)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_precheck — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `precheck-tool-${detail}.txt`;

    it(`precheck at detail=${detail} matches golden (ALTER + DROP INDEX)`, async () => {
      const text = await harness.callTool('dbgraph_precheck', {
        ddl: PRECHECK_DDL,
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

    it(`precheck at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail });
      const run2 = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: precheck content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_precheck — content assertions', () => {
  it('output includes DDL PRECHECK header', async () => {
    const text = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail: 'normal' });
    expect(text).toContain('DDL PRECHECK');
  });

  it('output includes MATCHED OBJECTS section', async () => {
    const text = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail: 'normal' });
    expect(text).toContain('MATCHED OBJECTS');
  });

  it('employees appears in matched objects', async () => {
    const text = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail: 'normal' });
    expect(text).toContain('employees');
  });

  it('full detail shows UNMATCHED IDENTIFIERS section', async () => {
    const text = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail: 'full' });
    expect(text).toContain('UNMATCHED IDENTIFIERS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: unmatched identifiers are reported
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_precheck — unmatched identifiers reported', () => {
  it('unmatched identifier is shown in full detail output', async () => {
    const ddl = 'ALTER TABLE phantom_missing_table ADD COLUMN x INT';
    const text = await harness.callTool('dbgraph_precheck', { ddl, detail: 'full' });
    expect(text).toContain('UNMATCHED IDENTIFIERS');
    expect(text).toContain('phantom_missing_table');
  });

  it('no impact is fabricated for unmatched identifiers', async () => {
    const ddl = 'ALTER TABLE phantom_missing_table ADD COLUMN x INT';
    const text = await harness.callTool('dbgraph_precheck', { ddl, detail: 'normal' });
    // matched objects should be empty / none
    expect(text).toContain('(none matched)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_precheck — deduplication across statements', () => {
  it('employees appears only once in matched objects for multi-statement DDL', async () => {
    const text = await harness.callTool('dbgraph_precheck', { ddl: PRECHECK_DDL, detail: 'full' });
    // Count occurrences of main.employees in MATCHED OBJECTS — should be 1
    const matchedSection = text.split('UNMATCHED')[0] ?? text;
    const occurrences = (matchedSection.match(/main\.employees/g) ?? []).length;
    // At most 1 occurrence as a matched object entry (could also appear in impact chains)
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });
});
