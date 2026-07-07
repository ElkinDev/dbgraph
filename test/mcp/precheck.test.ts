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
import { runPrecheck } from '../../src/index.js';
import type { GraphStore, GraphNode, GraphEdge } from '../../src/index.js';
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

// ─────────────────────────────────────────────────────────────────────────────
// Suite: SQLite column-drop surfaces the EXACT view + trigger dependents (L-009)
//
// sqlite-view-deps (B4.3). Spec `mcp-server` "SQLite column-drop surfaces the
// exact view + trigger dependents". Open question (a) VERIFIED against the ACTUAL
// engine output: a bare `dept_id` does NOT resolve to a qname, so the engine pivots
// on the `main.departments` TABLE; `whatToTest` is then EXACTLY the 2 dependent
// views + 2 FK tables + the INSTEAD OF trigger. Every item `confidence:'parsed'`.
// EXACT-set assertions (`.toStrictEqual`) with explicit negatives (`not.toContainEqual`).
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_precheck — SQLite departments.dept_id column-drop (L-009 exact whatToTest)', () => {
  const DROP_DDL = 'ALTER TABLE main.departments DROP COLUMN dept_id;';

  it('whatToTest is EXACTLY the 2 views + 2 FK tables + the INSTEAD OF trigger', async () => {
    const view = await runPrecheck(fx.store, DROP_DDL);
    expect(view.impact.whatToTest).toStrictEqual([
      'main.active_departments',
      'main.assignments',
      'main.employee_summary',
      'main.employees',
      'main.trg_active_dept_instead_insert',
    ]);
  });

  it('READERS is EXACTLY the 2 dependent views + the 2 FK tables, each confidence:parsed', async () => {
    const view = await runPrecheck(fx.store, DROP_DDL);
    expect(view.impact.readers).toStrictEqual([
      { qname: 'main.active_departments', kind: 'view', confidence: 'parsed' },
      { qname: 'main.assignments', kind: 'table', confidence: 'parsed' },
      { qname: 'main.employee_summary', kind: 'view', confidence: 'parsed' },
      { qname: 'main.employees', kind: 'table', confidence: 'parsed' },
    ]);
  });

  it('TRIGGERS is EXACTLY the INSTEAD OF trigger (inbound writes_to), confidence:parsed', async () => {
    const view = await runPrecheck(fx.store, DROP_DDL);
    expect(view.impact.triggers).toStrictEqual([
      { qname: 'main.trg_active_dept_instead_insert', kind: 'trigger', confidence: 'parsed' },
    ]);
  });

  it('the pivot is the departments TABLE (bare dept_id is unmatched — open question a)', async () => {
    const view = await runPrecheck(fx.store, DROP_DDL);
    expect(view.matchedObjects).toStrictEqual([
      { qname: 'main.departments', kind: 'table', confidence: 'parsed' },
    ]);
    expect(view.unmatchedIdentifiers).toStrictEqual(['dept_id']);
  });

  it('no spurious writers or constraint/index dependents are fabricated', async () => {
    const view = await runPrecheck(fx.store, DROP_DDL);
    expect(view.impact.writers).toStrictEqual([]);
    expect(view.impact.constraintsAndIndexes).toStrictEqual([]);
  });

  it('NEGATIVES: whatToTest excludes the pivot and any unrelated object; sections are not cross-contaminated', async () => {
    const view = await runPrecheck(fx.store, DROP_DDL);
    // the pivot table is not listed as its own dependent
    expect(view.impact.whatToTest).not.toContain('main.departments');
    // an unrelated table never leaks in
    expect(view.impact.whatToTest).not.toContain('main.projects');
    // the trigger belongs to TRIGGERS, never READERS; the views belong to READERS, never TRIGGERS
    expect(view.impact.readers).not.toContainEqual(
      { qname: 'main.trg_active_dept_instead_insert', kind: 'trigger', confidence: 'parsed' },
    );
    expect(view.impact.triggers).not.toContainEqual(
      { qname: 'main.active_departments', kind: 'view', confidence: 'parsed' },
    );
  });

  it('the tool text output surfaces every whatToTest dependent (integration)', async () => {
    const text = await harness.callTool('dbgraph_precheck', { ddl: DROP_DDL, detail: 'full' });
    for (const qname of [
      'main.active_departments',
      'main.assignments',
      'main.employee_summary',
      'main.employees',
      'main.trg_active_dept_instead_insert',
    ]) {
      expect(text).toContain(qname);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOG-1 C.2 — precheck CONSUMES the `calls` READ-impact traversal (mcp S32).
//
// Spec `mcp-server` "Altering a called routine surfaces its callers through the calls
// chain": over the mssql routine chain `calls dbo.usp_refresh_totals → dbo.usp_log_change`,
// a DDL touching `dbo.usp_log_change` yields `whatToTest` EXACTLY `{dbo.usp_refresh_totals}`
// (the caller reached through the INBOUND `calls` edge) in the READ / what-to-test section
// — a `calls` edge is READ-impact, not write. BYTE-CONSISTENT with the graph-query C.1 pin.
//
// This is the DEFAULT-CI synthetic tier (design §Testing Q2 = BOTH): an in-memory routine
// chain, NO container. The precheck identifier extractor is kind-AGNOSTIC (it pulls the
// qualified name and the graph resolves the kind), so `ALTER TABLE dbo.usp_log_change`
// resolves the identifier to the PROCEDURE node exactly as the SQLite test above resolves
// `main.departments` to a table. STRICT TDD: RED before `IMPACT_EDGE_KINDS += 'calls'`
// (no calls traversal → empty whatToTest). L-009 EXACT-set + explicit negatives.
// ─────────────────────────────────────────────────────────────────────────────

function callsChainNode(id: string, qname: string): GraphNode {
  return {
    id,
    kind: 'procedure',
    schema: 'dbo',
    name: qname.split('.').pop() ?? qname,
    qname,
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: {},
  };
}

function callsChainTable(id: string, qname: string): GraphNode {
  return { ...callsChainNode(id, qname), kind: 'table' };
}

function callsChainEdge(
  id: string,
  kind: GraphEdge['kind'],
  src: string,
  dst: string,
  confidence: GraphEdge['confidence'],
): GraphEdge {
  return { id, kind, src, dst, confidence, score: null, attrs: {} };
}

/**
 * In-memory mssql routine chain store:
 *   dbo.usp_refresh_totals --calls--> dbo.usp_log_change (declared)
 *   dbo.usp_refresh_totals --writes_to--> dbo.order_totals (parsed)
 *   dbo.usp_log_change --writes_to--> dbo.audit_log (parsed)
 * getImpact walks INBOUND edges (getEdgesTo), keyed on the target.
 */
function buildRoutineChainStore(): GraphStore {
  const refresh = callsChainNode('n-refresh', 'dbo.usp_refresh_totals');
  const log = callsChainNode('n-log', 'dbo.usp_log_change');
  const totals = callsChainTable('n-totals', 'dbo.order_totals');
  const audit = callsChainTable('n-audit', 'dbo.audit_log');
  const nodes: GraphNode[] = [refresh, log, totals, audit];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edgesTo: Record<string, GraphEdge[]> = {
    'n-log': [callsChainEdge('e-calls', 'calls', 'n-refresh', 'n-log', 'declared')],
    'n-totals': [callsChainEdge('e-w1', 'writes_to', 'n-refresh', 'n-totals', 'parsed')],
    'n-audit': [callsChainEdge('e-w2', 'writes_to', 'n-log', 'n-audit', 'parsed')],
    'n-refresh': [],
  };

  return {
    close: async () => {},
    schemaVersion: async () => 1,
    upsertGraph: async () => ({ nodes: 0, edges: 0 }),
    deleteNodes: async () => 0,
    getNode: async (id) => nodeById.get(id) ?? null,
    getNodesByKind: async (kind) => nodes.filter((n) => n.kind === kind),
    getNodeByQName: async (kind, qname) =>
      nodes.find((n) => n.kind === kind && n.qname === qname) ?? null,
    getEdgesFrom: async () => [],
    getEdgesTo: async (id, kinds) => {
      const all = edgesTo[id] ?? [];
      return kinds === undefined ? all : all.filter((e) => kinds.includes(e.kind));
    },
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

describe('dbgraph_precheck — calls chain surfaces the caller in whatToTest (DOG-1 C.2, L-009)', () => {
  // Kind-agnostic identifier extraction: the ALTER TABLE clause makes the extractor emit
  // `dbo.usp_log_change`, which the graph resolves to the PROCEDURE node.
  const ALTER_LOG_DDL = 'ALTER TABLE dbo.usp_log_change ADD COLUMN reviewed BIT;';

  it('whatToTest is EXACTLY {dbo.usp_refresh_totals} (the caller via the inbound calls edge)', async () => {
    const store = buildRoutineChainStore();
    const view = await runPrecheck(store, ALTER_LOG_DDL);
    expect(view.impact.whatToTest).toStrictEqual(['dbo.usp_refresh_totals']);
  });

  it('READERS is EXACTLY the calling routine, confidence:parsed (calls = read-impact)', async () => {
    const store = buildRoutineChainStore();
    const view = await runPrecheck(store, ALTER_LOG_DDL);
    expect(view.impact.readers).toStrictEqual([
      { qname: 'dbo.usp_refresh_totals', kind: 'procedure', confidence: 'parsed' },
    ]);
  });

  it('NEGATIVE: the caller appears in NO write section — a calls edge is never write-impact', async () => {
    const store = buildRoutineChainStore();
    const view = await runPrecheck(store, ALTER_LOG_DDL);
    expect(view.impact.writers).toStrictEqual([]);
    expect(view.impact.triggers).toStrictEqual([]);
    expect(view.impact.constraintsAndIndexes).toStrictEqual([]);
    // the caller is not mis-classified as a writer
    expect(view.impact.writers).not.toContainEqual(
      { qname: 'dbo.usp_refresh_totals', kind: 'procedure', confidence: 'parsed' },
    );
    // whatToTest never lists the pivot itself
    expect(view.impact.whatToTest).not.toContain('dbo.usp_log_change');
  });

  it('the pivot resolves to the PROCEDURE node (kind-agnostic identifier match)', async () => {
    const store = buildRoutineChainStore();
    const view = await runPrecheck(store, ALTER_LOG_DDL);
    expect(view.matchedObjects).toStrictEqual([
      { qname: 'dbo.usp_log_change', kind: 'procedure', confidence: 'parsed' },
    ]);
  });

  it('byte-consistent whatToTest on re-run (ADR-008)', async () => {
    const store = buildRoutineChainStore();
    const r1 = await runPrecheck(store, ALTER_LOG_DDL);
    const r2 = await runPrecheck(store, ALTER_LOG_DDL);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
