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
