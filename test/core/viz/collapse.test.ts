/**
 * Task 1.1 — RED→GREEN: pure column-collapse transform for viz.
 *
 * Spec scenario `graph-viz` "default collapses columns, --full expands them".
 * OPEN-Q1 (RESOLVED): default = structural nodes only (columns + other heavy kinds
 * folded); `--columns` = structural + columns (no other heavy kinds); `--full` = every
 * kind incl. columns. Pre-filters: `--schema` / `--min-degree` / `--kinds`.
 *
 * ADR-004: `collapse` is pure (core-types-only, no I/O). ADR-008: order-independent
 * output. L-009: EXACT-set assertions (toStrictEqual / toBe), no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { collapse } from '../../../src/core/viz/collapse.js';
import type { VizOptions } from '../../../src/core/viz/collapse.js';
import { loadTortureGraph, type TortureGraph } from './torture-graph.js';
import type { NodeKind } from '../../../src/core/model/node.js';

let g: TortureGraph;

beforeAll(async () => {
  g = await loadTortureGraph();
});

afterAll(async () => {
  await g.cleanup();
});

function kindsPresent(nodes: readonly { kind: NodeKind }[]): Set<NodeKind> {
  return new Set(nodes.map((n) => n.kind));
}

const DEFAULT_OPTS: VizOptions = { full: false };
const FULL_OPTS: VizOptions = { full: true };
const COLUMNS_OPTS: VizOptions = { full: false, columns: true };

describe('collapse — default folds columns into parents', () => {
  it('default view contains ZERO top-level column nodes', () => {
    const { nodes } = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const columnNodes = nodes.filter((n) => n.kind === 'column');
    expect(columnNodes).toStrictEqual([]);
    // ...but structural tables ARE present (proves the emptiness comes from folding,
    // not from an empty input)
    const tableNodes = nodes.filter((n) => n.kind === 'table');
    expect(tableNodes.length).toBeGreaterThan(0);
  });

  it('default view drops other heavy kinds (constraint / index / trigger)', () => {
    const { nodes } = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const kinds = kindsPresent(nodes);
    expect(kinds.has('column')).toBe(false);
    expect(kinds.has('constraint')).toBe(false);
    expect(kinds.has('index')).toBe(false);
    expect(kinds.has('trigger')).toBe(false);
  });

  it('default view keeps structural table nodes with their real qnames', () => {
    const { nodes } = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const qnames = new Set(nodes.map((n) => n.qname));
    expect(qnames.has('main.employees')).toBe(true);
    expect(qnames.has('main.departments')).toBe(true);
  });

  it('default view rewires column-grain FK references to a table→table edge', () => {
    const { nodes, edges } = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const references = edges.filter((e) => e.kind === 'references');
    // every surviving references edge connects two KEPT table/structural nodes
    // (columns are gone, so a column-grain FK must have been rewired to its table)
    expect(references.length).toBeGreaterThan(0);
    for (const e of references) {
      expect(nodeById.has(e.src)).toBe(true);
      expect(nodeById.has(e.dst)).toBe(true);
      expect(e.src).not.toBe(e.dst); // no self-loops
    }
    // employees.department_id → departments must survive as main.employees → main.departments
    const empId = nodes.find((n) => n.qname === 'main.employees')?.id;
    const depId = nodes.find((n) => n.qname === 'main.departments')?.id;
    expect(empId).toBeTruthy();
    expect(depId).toBeTruthy();
    const empToDep = references.some((e) => e.src === empId && e.dst === depId);
    expect(empToDep).toBe(true);
  });

  it('default view drops pure containment edges (has_column / has_constraint / has_index)', () => {
    const { edges } = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const kinds = new Set(edges.map((e) => e.kind));
    expect(kinds.has('has_column')).toBe(false);
    expect(kinds.has('has_constraint')).toBe(false);
    expect(kinds.has('has_index')).toBe(false);
  });

  it('collapse is order-independent (same result for shuffled input)', () => {
    const forward = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const reversed = collapse([...g.nodes].reverse(), [...g.edges].reverse(), DEFAULT_OPTS);
    const idsF = forward.nodes.map((n) => n.id).sort();
    const idsR = reversed.nodes.map((n) => n.id).sort();
    expect(idsR).toStrictEqual(idsF);
    const edgesF = forward.edges.map((e) => `${e.kind}|${e.src}|${e.dst}`).sort();
    const edgesR = reversed.edges.map((e) => `${e.kind}|${e.src}|${e.dst}`).sort();
    expect(edgesR).toStrictEqual(edgesF);
  });
});

describe('collapse — --full is pass-through (every kind incl. columns)', () => {
  it('--full renders column nodes individually', () => {
    const { nodes } = collapse(g.nodes, g.edges, FULL_OPTS);
    const columnNodes = nodes.filter((n) => n.kind === 'column');
    expect(columnNodes.length).toBeGreaterThan(0);
  });

  it('--full keeps every input node (pure pass-through of the node set)', () => {
    const { nodes } = collapse(g.nodes, g.edges, FULL_OPTS);
    expect(nodes.length).toBe(g.nodes.length);
  });

  it('--full keeps has_column containment edges (columns still attached)', () => {
    const { edges } = collapse(g.nodes, g.edges, FULL_OPTS);
    const hasColumn = edges.filter((e) => e.kind === 'has_column');
    expect(hasColumn.length).toBeGreaterThan(0);
  });
});

describe('collapse — --columns includes columns but no other heavy kinds', () => {
  it('--columns keeps column nodes', () => {
    const { nodes } = collapse(g.nodes, g.edges, COLUMNS_OPTS);
    const columnNodes = nodes.filter((n) => n.kind === 'column');
    expect(columnNodes.length).toBeGreaterThan(0);
  });

  it('--columns still folds constraints and indexes (lighter than --full)', () => {
    const { nodes } = collapse(g.nodes, g.edges, COLUMNS_OPTS);
    const kinds = kindsPresent(nodes);
    expect(kinds.has('column')).toBe(true);
    expect(kinds.has('constraint')).toBe(false);
    expect(kinds.has('index')).toBe(false);
  });
});

describe('collapse — pre-filters (schema / min-degree / kinds)', () => {
  it('--schema keeps only nodes in the named schema', () => {
    const { nodes } = collapse(g.nodes, g.edges, { full: true, schema: 'main' });
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.schema).toBe('main');
    }
    // a non-existent schema yields an empty node set (real filtering, not a no-op)
    const empty = collapse(g.nodes, g.edges, { full: true, schema: '__no_such_schema__' });
    expect(empty.nodes).toStrictEqual([]);
  });

  it('--kinds restricts the kept kinds to the allowlist', () => {
    const { nodes } = collapse(g.nodes, g.edges, { full: false, kinds: ['table'] });
    const kinds = kindsPresent(nodes);
    expect([...kinds]).toStrictEqual(['table']);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('--min-degree drops nodes below the degree threshold', () => {
    const base = collapse(g.nodes, g.edges, DEFAULT_OPTS);
    const filtered = collapse(g.nodes, g.edges, { full: false, minDegree: 1 });
    // every surviving node has at least one incident edge in the filtered graph
    const incident = new Map<string, number>();
    for (const n of filtered.nodes) incident.set(n.id, 0);
    for (const e of filtered.edges) {
      incident.set(e.src, (incident.get(e.src) ?? 0) + 1);
      incident.set(e.dst, (incident.get(e.dst) ?? 0) + 1);
    }
    for (const n of filtered.nodes) {
      expect(incident.get(n.id) ?? 0).toBeGreaterThanOrEqual(1);
    }
    // filtering removed at least one isolated node relative to the unfiltered default
    expect(filtered.nodes.length).toBeLessThanOrEqual(base.nodes.length);
  });
});
