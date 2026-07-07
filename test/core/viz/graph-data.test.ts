/**
 * Task 1.4 — RED→GREEN: the deterministic embedded data block.
 *
 * `buildVizData(nodes, edges, opts)` collapses (per opts), assigns communities, builds the
 * full-graph neighbor index, and emits `{ nodes: VizNode[], edges: VizEdge[], communities:
 * CommunityInfo[] }` with STABLE key + node/edge order. Each VizNode.detail is
 * `formatObject(view, 'full')` verbatim (parity proven in 1.5). Serializing twice on the
 * torture fixture MUST be byte-identical and `.toStrictEqual` the blessed data-block golden.
 *
 * Spec scenario `graph-viz` "same graph yields a byte-identical data block" (ADR-008).
 * L-009: toStrictEqual / toBe, no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVizData } from '../../../src/core/viz/graph-data.js';
import type { VizGraphData } from '../../../src/core/viz/graph-data.js';
import { loadTortureGraph, type TortureGraph } from './torture-graph.js';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

let g: TortureGraph;

beforeAll(async () => {
  g = await loadTortureGraph();
});

afterAll(async () => {
  await g.cleanup();
});

function serialize(data: VizGraphData): string {
  return JSON.stringify(data, null, 2) + '\n';
}

describe('buildVizData — deterministic embedded data block', () => {
  it('produces a byte-identical serialization on two runs', () => {
    const a = serialize(buildVizData(g.nodes, g.edges, { full: false }));
    const b = serialize(buildVizData(g.nodes, g.edges, { full: false }));
    expect(b).toBe(a);
  });

  it('is order-independent (shuffled input yields the identical data block)', () => {
    const a = serialize(buildVizData(g.nodes, g.edges, { full: false }));
    const b = serialize(
      buildVizData([...g.nodes].reverse(), [...g.edges].reverse(), { full: false }),
    );
    expect(b).toBe(a);
  });

  it('assigns contiguous node indices 0..n-1 in stable order', () => {
    const data = buildVizData(g.nodes, g.edges, { full: false });
    expect(data.nodes.map((n) => n.i)).toStrictEqual(data.nodes.map((_, i) => i));
    expect(data.nodes.length).toBeGreaterThan(0);
  });

  it('every edge references valid node indices and carries a real kind', () => {
    const data = buildVizData(g.nodes, g.edges, { full: false });
    const maxIndex = data.nodes.length - 1;
    expect(data.edges.length).toBeGreaterThan(0);
    for (const e of data.edges) {
      expect(e.s).toBeGreaterThanOrEqual(0);
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.s).toBeLessThanOrEqual(maxIndex);
      expect(e.t).toBeLessThanOrEqual(maxIndex);
      expect(typeof e.kind).toBe('string');
    }
  });

  it('each community in the legend has a matching member count', () => {
    const data = buildVizData(g.nodes, g.edges, { full: false });
    for (const c of data.communities) {
      const actual = data.nodes.filter((n) => n.community === c.id).length;
      expect(actual).toBe(c.count);
    }
  });

  it('every node carries a non-empty formatObject detail string', () => {
    const data = buildVizData(g.nodes, g.edges, { full: false });
    for (const n of data.nodes) {
      expect(n.detail.length).toBeGreaterThan(0);
      // the detail header carries the node's own qname (real formatObject output)
      expect(n.detail).toContain(n.label);
    }
  });

  it('matches the blessed data-block golden byte-for-byte', () => {
    const actual = serialize(buildVizData(g.nodes, g.edges, { full: false }));
    const goldenPath = join(goldenDir, 'data-block-torture.json');
    if (CAPTURE || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, actual, 'utf-8');
      if (CAPTURE) return;
    }
    expect(actual).toBe(readFileSync(goldenPath, 'utf-8'));
  });
});
