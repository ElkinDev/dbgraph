/**
 * Task 1.5 — detail-parity: each VizNode.detail === formatObject(view, 'full').
 *
 * Proves the "no second renderer" contract (success criterion 4): the viz node-detail
 * text is the SAME `formatObject(view, 'full')` (`src/core/present/object.ts`) that backs
 * `dbgraph object <qname> --detail full`, sourced from the SAME graph via `getNeighbors`.
 * If the in-memory neighbor index (1.3) ever drifts from the store path, this fails.
 *
 * Spec scenario `graph-viz` "node click shows payload sections matching object" (parity
 * half). EXACT-set: `.toBe` per visible node — byte-identical, no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildVizData } from '../../../src/core/viz/graph-data.js';
import { collapse } from '../../../src/core/viz/collapse.js';
import { getNeighbors } from '../../../src/core/query/neighbors.js';
import { formatObject } from '../../../src/core/present/object.js';
import { loadTortureGraph, type TortureGraph } from './torture-graph.js';

let g: TortureGraph;

beforeAll(async () => {
  g = await loadTortureGraph();
});

afterAll(async () => {
  await g.cleanup();
});

describe('detail-parity — VizNode.detail equals dbgraph object full render', () => {
  it('every visible node detail is byte-identical to formatObject(view, "full")', async () => {
    const data = buildVizData(g.nodes, g.edges, { full: false });
    const collapsed = collapse(g.nodes, g.edges, { full: false });
    const detailByLabel = new Map(data.nodes.map((n) => [n.label, n.detail]));

    // The visible set is non-trivial and each node has an object-derived detail.
    expect(collapsed.nodes.length).toBeGreaterThan(0);

    let compared = 0;
    for (const node of collapsed.nodes) {
      const neighbors = await getNeighbors(g.store, { nodeId: node.id });
      const expected = formatObject({ node, neighbors }, 'full');
      const actual = detailByLabel.get(node.qname);
      expect(actual).toBe(expected);
      compared++;
    }
    // We actually walked every visible node (guards against a vacuous pass).
    expect(compared).toBe(collapsed.nodes.length);
  });

  it('a collapsed table detail still shows its COLUMNS section (built from full edges)', async () => {
    const data = buildVizData(g.nodes, g.edges, { full: false });
    const employees = data.nodes.find((n) => n.label === 'main.employees');
    expect(employees).toBeTruthy();
    if (employees === undefined) return;

    // formatObject renders a COLUMNS section listing local column names (e.g. dept_id).
    expect(employees.detail).toContain('COLUMNS');
    expect(employees.detail).toContain('dept_id');
    // and it matches the object command's render for the same node exactly.
    const node = g.nodes.find((n) => n.qname === 'main.employees');
    if (node === undefined) throw new Error('missing employees node');
    const neighbors = await getNeighbors(g.store, { nodeId: node.id });
    expect(employees.detail).toBe(formatObject({ node, neighbors }, 'full'));
  });
});
