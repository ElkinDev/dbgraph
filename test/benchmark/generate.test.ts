/**
 * view-dependency enumerator instantiability (sqlite-view-deps, B4.4).
 *
 * Spec `benchmark` "Enumerator now yields view-dependency candidates on SQLite" +
 * "N and the committed question set are unchanged; prior runs stay frozen".
 *
 * The `view-dependency` family enumerator (in the benchmark generate stage) selects
 * candidate views via `store.getEdgesFrom(view.id, ['depends_on','reads_from'])` and
 * SKIPS any view whose result is empty. Before sqlite-view-deps the SQLite adapter
 * emitted NO body-derived view `depends_on` edges, so that query returned ZERO for
 * every view and the family was NOT instantiable. This suite proves that — over the
 * committed torture substrate — the SAME query now yields candidates.
 *
 * IMPORTANT (independence): this suite reproduces ONLY the enumerator's graph QUERY
 * against the built store. It does NOT import the generate stage, does NOT run a
 * benchmark, does NOT bump N, and does NOT touch the frozen committed question set.
 * `npm test` stays fully decoupled from any benchmark run.
 *
 * L-009: EXACT candidate set (`.toStrictEqual`) — never existence-only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { openFixtureStore, type FixtureStore } from '../mcp/fixture.js';

// The exact edge kinds the view-dependency enumerator probes per candidate view.
const VIEW_DEP_EDGE_KINDS = ['depends_on', 'reads_from'] as const;

let fx: FixtureStore;

beforeAll(async () => {
  // Builds the store from the committed torture fixture (test/fixtures/sqlite/torture.sql).
  fx = await openFixtureStore();
});

afterAll(async () => {
  await fx.cleanup();
});

describe('view-dependency family is instantiable on the SQLite substrate (B4.4)', () => {
  it('the enumerator query yields at least one candidate view (previously ZERO)', async () => {
    const views = await fx.store.getNodesByKind('view');
    const candidates: string[] = [];
    for (const view of views) {
      const edges = await fx.store.getEdgesFrom(view.id, [...VIEW_DEP_EDGE_KINDS]);
      if (edges.length === 0) continue; // mirrors the enumerator's skip-empty rule
      candidates.push(view.qname);
    }
    candidates.sort();
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    // EXACT set (L-009): the two torture views carry body-derived depends_on edges.
    expect(candidates).toStrictEqual([
      'main.active_departments',
      'main.employee_summary',
    ]);
  });

  it('each candidate view exposes its exact depends_on targets (body-derived)', async () => {
    const targetsFor = async (qname: string): Promise<string[]> => {
      const view = await fx.store.getNodeByQName('view', qname);
      if (view === null) throw new Error(`view ${qname} not found`);
      const edges = await fx.store.getEdgesFrom(view.id, [...VIEW_DEP_EDGE_KINDS]);
      const targets: string[] = [];
      for (const e of edges) {
        const dst = await fx.store.getNode(e.dst);
        if (dst !== null) targets.push(dst.qname);
      }
      return targets.sort();
    };

    expect(await targetsFor('main.active_departments')).toStrictEqual([
      'main.departments',
      'main.employees',
    ]);
    expect(await targetsFor('main.employee_summary')).toStrictEqual([
      'main.departments',
      'main.employees',
    ]);
  });
});
