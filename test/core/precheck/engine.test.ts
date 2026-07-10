/**
 * precheck engine unit tests — task 4.3 / Batch D (phase-5-mcp-server).
 * Spec: match identifiers to graph → aggregate getImpact → PrecheckView.
 * Design: PURE core function (store, ddl) => PrecheckView; tags confidence:'parsed';
 *         reports unmatched identifiers; deduplicates impact across multiple statements.
 *
 * TDD RED: module does not exist yet → RED.
 * These tests use the fixture store (openFixtureStore) since engine needs a real graph.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';
import { runPrecheck } from '../../../src/core/precheck/engine.js';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

let fx: FixtureStore;

beforeAll(async () => {
  fx = await openFixtureStore();
});

afterAll(async () => {
  await fx.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Basic match + confidence tagging
// ─────────────────────────────────────────────────────────────────────────────

describe('runPrecheck — basic match and confidence tagging', () => {
  it('returns a PrecheckView with matched objects', async () => {
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE main.employees ADD COLUMN status TEXT',
    );
    expect(view.matchedObjects.length).toBeGreaterThan(0);
  });

  it('all matched items carry confidence: parsed', async () => {
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE main.employees ADD COLUMN status TEXT',
    );
    for (const item of view.matchedObjects) {
      expect(item.confidence).toBe('parsed');
    }
  });

  it('matched item has qname and kind', async () => {
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE main.employees ADD COLUMN status TEXT',
    );
    const emp = view.matchedObjects.find((m) => m.qname === 'main.employees');
    expect(emp).toBeDefined();
    expect(emp?.kind).toBe('table');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unmatched identifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('runPrecheck — unmatched identifiers', () => {
  it('reports identifier with no matching graph node in unmatchedIdentifiers', async () => {
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE nonexistent_phantom_table ADD COLUMN x INT',
    );
    expect(view.unmatchedIdentifiers).toContain('nonexistent_phantom_table');
  });

  it('does not report matched identifiers in unmatchedIdentifiers', async () => {
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE main.employees ADD COLUMN status TEXT',
    );
    expect(view.unmatchedIdentifiers).not.toContain('main.employees');
  });

  it('all impact items in unmatched case have confidence: parsed', async () => {
    // Even when unmatched, impact section items from matched objects must be tagged
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE main.employees ADD COLUMN status TEXT',
    );
    for (const item of view.impact.triggers) {
      expect(item.confidence).toBe('parsed');
    }
    for (const item of view.impact.writers) {
      expect(item.confidence).toBe('parsed');
    }
    for (const item of view.impact.readers) {
      expect(item.confidence).toBe('parsed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication across multiple statements
// ─────────────────────────────────────────────────────────────────────────────

describe('runPrecheck — deduplication across statements', () => {
  it('deduplicates matched objects when the same table appears in multiple statements', async () => {
    const ddl = `
      ALTER TABLE main.employees ADD COLUMN status TEXT;
      ALTER TABLE main.employees DROP COLUMN old_col;
    `;
    const view = await runPrecheck(fx.store, ddl);
    const empMatches = view.matchedObjects.filter((m) => m.qname === 'main.employees');
    expect(empMatches.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Impact aggregation — ALTER TABLE + DROP INDEX on torture fixture
// ─────────────────────────────────────────────────────────────────────────────

describe('runPrecheck — impact aggregation (torture fixture)', () => {
  it('ALTER TABLE main.employees produces a PrecheckView (not empty)', async () => {
    const view = await runPrecheck(
      fx.store,
      'ALTER TABLE main.employees ADD COLUMN new_col TEXT',
    );
    // employees has triggers that fire on it — impact.triggers or impact sections should be non-trivial
    expect(view.matchedObjects.length).toBeGreaterThan(0);
  });

  it('combined DDL produces aggregated deduped impact sections', async () => {
    const ddl = `
      ALTER TABLE main.employees ADD COLUMN priority INT;
      DROP INDEX idx_emp_dept ON main.employees;
    `;
    const view = await runPrecheck(fx.store, ddl);
    // employees must be matched
    const emp = view.matchedObjects.find((m) => m.qname === 'main.employees');
    expect(emp).toBeDefined();
    // No identifier should appear twice in any section
    const allTriggers = view.impact.triggers.map((t) => t.qname);
    const uniqueTriggers = new Set(allTriggers);
    expect(allTriggers.length).toBe(uniqueTriggers.size);
  });

  it('empty DDL returns empty PrecheckView', async () => {
    const view = await runPrecheck(fx.store, '');
    expect(view.matchedObjects).toHaveLength(0);
    expect(view.unmatchedIdentifiers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOG-4 (task 3.2) — per-node dynamic-SQL degradation marker on PrecheckItem.
// Fake store with neutral acme_* names. SQLite has NO dynamic SQL, so this needs a
// synthetic graph. Asserts BOTH construction sites feed the flag (matched + impact
// section), an ISOLATED dynamic routine (no inbound edges) is STILL flagged via the
// matched site, and non-dynamic items OMIT the key (r2). L-009: exact flagged sets.
// ─────────────────────────────────────────────────────────────────────────────

function synNode(id: string, kind: GraphNode['kind'], qname: string, hasDynamicSql = false): GraphNode {
  return {
    id,
    kind,
    schema: 'acme',
    name: qname.split('.').pop() ?? qname,
    qname,
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: hasDynamicSql ? { hasDynamicSql: true } : {},
  };
}

function synEdge(id: string, kind: GraphEdge['kind'], src: string, dst: string): GraphEdge {
  return { id, kind, src, dst, confidence: 'declared', score: null, attrs: {} };
}

/** Fake store keyed by id (getNode) and qname+kind (getNodeByQName); edgesTo is inbound. */
function makeDynFakeStore(nodes: GraphNode[], edgesTo: Record<string, GraphEdge[]>): GraphStore {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byQname = new Map(nodes.map((n) => [n.qname, n]));
  return {
    close: async () => {},
    schemaVersion: async () => 1,
    upsertGraph: async () => ({ nodes: 0, edges: 0 }),
    deleteNodes: async () => 0,
    getNode: async (id) => byId.get(id) ?? null,
    getNodesByKind: async () => [],
    getNodeByQName: async (kind, qname) => {
      const n = byQname.get(qname);
      return n && n.kind === kind ? n : null;
    },
    getEdgesFrom: async () => [],
    getEdgesTo: async (id) => edgesTo[id] ?? [],
    getAllNodes: async () => nodes,
    getAllEdges: async () => [],
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

describe('runPrecheck — dynamic-SQL per-node marker (DOG-4 task 3.2)', () => {
  // acme.orders (table) is read by a dynamic function + a plain view.
  // acme.run_report (procedure, dynamic) is matched directly with NO inbound edges (isolated).
  const nOrders = synNode('n-orders', 'table', 'acme.orders');
  const nRun = synNode('n-run', 'procedure', 'acme.run_report', true);
  const nFn = synNode('n-fn', 'function', 'acme.fn_exec_stmt', true);
  const nView = synNode('n-view', 'view', 'acme.order_summary');

  function store(): GraphStore {
    return makeDynFakeStore(
      [nOrders, nRun, nFn, nView],
      { 'n-orders': [synEdge('e-fn', 'reads_from', 'n-fn', 'n-orders'), synEdge('e-vw', 'reads_from', 'n-view', 'n-orders')] },
    );
  }

  // DDL matches acme.orders (plain, has readers) AND acme.run_report (dynamic, isolated).
  const DDL = 'ALTER TABLE acme.orders ADD COLUMN note TEXT; ALTER TABLE acme.run_report ADD COLUMN flag INT;';

  it('matched dynamic routine carries hasDynamicSql:true (isolated routine STILL flagged)', async () => {
    const view = await runPrecheck(store(), DDL);
    const flaggedMatched = view.matchedObjects.filter((i) => i.hasDynamicSql === true).map((i) => i.qname);
    expect(flaggedMatched).toEqual(['acme.run_report']);
  });

  it('impact-section (reader) dynamic routine carries hasDynamicSql:true — EXACT set', async () => {
    const view = await runPrecheck(store(), DDL);
    const flaggedReaders = view.impact.readers.filter((i) => i.hasDynamicSql === true).map((i) => i.qname);
    expect(flaggedReaders).toEqual(['acme.fn_exec_stmt']);
  });

  it('NEGATIVE: non-dynamic matched item OMITS the key entirely', async () => {
    const view = await runPrecheck(store(), DDL);
    const orders = view.matchedObjects.find((i) => i.qname === 'acme.orders');
    expect(orders).toBeDefined();
    expect('hasDynamicSql' in (orders as object)).toBe(false);
  });

  it('NEGATIVE: non-dynamic reader OMITS the key entirely', async () => {
    const view = await runPrecheck(store(), DDL);
    const summary = view.impact.readers.find((i) => i.qname === 'acme.order_summary');
    expect(summary).toBeDefined();
    expect('hasDynamicSql' in (summary as object)).toBe(false);
  });

  it('all items — flagged or not — stay tagged confidence: parsed', async () => {
    const view = await runPrecheck(store(), DDL);
    for (const item of [...view.matchedObjects, ...view.impact.readers]) {
      expect(item.confidence).toBe('parsed');
    }
  });
});
