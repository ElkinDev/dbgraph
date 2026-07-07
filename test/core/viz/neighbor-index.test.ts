/**
 * Task 1.3 — RED→GREEN: pure in-memory neighbor-index builder.
 *
 * `buildNeighborIndex(edges, nodes)` builds a `NeighborGroups` per node from the FULL
 * bulk arrays (NO per-node store lookup), grouped by edge kind + direction and sorted
 * identically to `getNeighbors` (by qname, then id) so it feeds `formatObject` with
 * byte-identical bytes. This is the same-source-same-truth half of the "no second
 * renderer" contract (parity is finished in task 1.5).
 *
 * Spec scenario `graph-viz` "node click shows payload sections matching object"
 * (neighbor-build half). EXACT-set: a collapsed table's groups still include its COLUMN
 * members. ADR-004 pure. L-009: toStrictEqual, no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildNeighborIndex } from '../../../src/core/viz/neighbor-index.js';
import { getNeighbors } from '../../../src/core/query/neighbors.js';
import { loadTortureGraph, type TortureGraph } from './torture-graph.js';

let g: TortureGraph;

beforeAll(async () => {
  g = await loadTortureGraph();
});

afterAll(async () => {
  await g.cleanup();
});

describe('buildNeighborIndex — full-graph in-memory neighbor groups', () => {
  it('a table keeps a has_column group whose out lists its column members', () => {
    const index = buildNeighborIndex(g.edges, g.nodes);
    const employees = g.nodes.find((n) => n.qname === 'main.employees');
    expect(employees).toBeTruthy();
    if (employees === undefined) return;

    const groups = index.get(employees.id);
    expect(groups).toBeTruthy();
    if (groups === undefined) return;

    const hasColumn = groups['has_column'];
    expect(hasColumn).toBeTruthy();
    if (hasColumn === undefined) return;

    // the out members are the table's columns (non-empty, all kind 'column')
    expect(hasColumn.out.length).toBeGreaterThan(0);
    for (const entry of hasColumn.out) {
      expect(entry.node.kind).toBe('column');
    }
    // and a specific known column is present
    const colQnames = hasColumn.out.map((e) => e.node.qname);
    expect(colQnames).toContain('main.employees.dept_id');
  });

  it('matches getNeighbors output byte-for-byte for a table node (parity at index level)', async () => {
    const index = buildNeighborIndex(g.edges, g.nodes);
    const employees = g.nodes.find((n) => n.qname === 'main.employees');
    if (employees === undefined) throw new Error('missing employees table');

    const fromStore = await getNeighbors(g.store, { nodeId: employees.id });
    const fromIndex = index.get(employees.id);
    expect(fromIndex).toStrictEqual(fromStore);
  });

  it('matches getNeighbors for a referenced (parent) table via the in direction', async () => {
    const index = buildNeighborIndex(g.edges, g.nodes);
    const departments = g.nodes.find((n) => n.qname === 'main.departments');
    if (departments === undefined) throw new Error('missing departments table');

    const fromStore = await getNeighbors(g.store, { nodeId: departments.id });
    const fromIndex = index.get(departments.id);
    expect(fromIndex).toStrictEqual(fromStore);
  });

  it('is order-independent (shuffled input yields identical groups)', () => {
    const a = buildNeighborIndex(g.edges, g.nodes);
    const b = buildNeighborIndex([...g.edges].reverse(), [...g.nodes].reverse());
    const employees = g.nodes.find((n) => n.qname === 'main.employees');
    if (employees === undefined) throw new Error('missing employees table');
    expect(b.get(employees.id)).toStrictEqual(a.get(employees.id));
  });

  it('builds an entry for every node that has at least one incident edge', () => {
    const index = buildNeighborIndex(g.edges, g.nodes);
    const withEdges = new Set<string>();
    for (const e of g.edges) {
      withEdges.add(e.src);
      withEdges.add(e.dst);
    }
    for (const id of withEdges) {
      expect(index.has(id)).toBe(true);
    }
  });
});
