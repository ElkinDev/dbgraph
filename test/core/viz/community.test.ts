/**
 * Task 1.2 — RED→GREEN: seeded label-propagation community assignment + naming.
 *
 * Spec scenario `graph-viz` "torture-fixture community assignment matches a pinned snapshot".
 * Q6 (RESOLVED): seeded label propagation over stable node-id order (own label → adopt the
 * most-frequent neighbor label per round, ties → smallest label id, fixed max rounds,
 * re-numbered 0..k-1 by first appearance). NAME = dominant prefixKey (schema when >1
 * distinct schema, else first `_`-token of name), ties → code-point lexicographic-min.
 *
 * ADR-008: byte-deterministic — assign twice → identical count + membership + names,
 * pinned to a blessed golden. Bless deliberately once (GOLDEN_CAPTURE=1); a drift is a
 * HARD STOP. L-009: EXACT assertions (toStrictEqual / toBe), no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignCommunities } from '../../../src/core/viz/community.js';
import type { CommunityAssignment } from '../../../src/core/viz/community.js';
import { collapse } from '../../../src/core/viz/collapse.js';
import { loadTortureGraph, type TortureGraph } from './torture-graph.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

let g: TortureGraph;
let collapsedNodes: readonly GraphNode[];
let collapsedEdges: readonly GraphEdge[];

beforeAll(async () => {
  g = await loadTortureGraph();
  const c = collapse(g.nodes, g.edges, { full: false });
  collapsedNodes = c.nodes;
  collapsedEdges = c.edges;
});

afterAll(async () => {
  await g.cleanup();
});

interface CommunitySnapshot {
  readonly count: number;
  readonly communities: readonly { id: number; name: string; count: number }[];
  readonly membership: Readonly<Record<string, number>>;
}

/** Deterministic snapshot: community list + per-qname membership (qname-sorted). */
function snapshot(nodes: readonly GraphNode[], a: CommunityAssignment): CommunitySnapshot {
  const membership: Record<string, number> = {};
  const qnames = nodes.map((n) => n.qname).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  for (const qn of qnames) {
    const node = nodes.find((n) => n.qname === qn);
    if (node === undefined) continue;
    const c = a.communityOf.get(node.id);
    if (c !== undefined) membership[qn] = c;
  }
  return {
    count: a.communities.length,
    communities: a.communities.map((c) => ({ id: c.id, name: c.name, count: c.count })),
    membership,
  };
}

describe('assignCommunities — deterministic seeded label propagation', () => {
  it('two assignments produce identical count + membership + names', () => {
    const a1 = assignCommunities(collapsedNodes, collapsedEdges);
    const a2 = assignCommunities(collapsedNodes, collapsedEdges);
    expect(snapshot(collapsedNodes, a2)).toStrictEqual(snapshot(collapsedNodes, a1));
  });

  it('is order-independent (shuffled input yields identical assignment)', () => {
    const a1 = assignCommunities(collapsedNodes, collapsedEdges);
    const a2 = assignCommunities(
      [...collapsedNodes].reverse(),
      [...collapsedEdges].reverse(),
    );
    expect(snapshot(collapsedNodes, a2)).toStrictEqual(snapshot(collapsedNodes, a1));
  });

  it('every collapsed node is assigned to exactly one community', () => {
    const a = assignCommunities(collapsedNodes, collapsedEdges);
    for (const n of collapsedNodes) {
      const c = a.communityOf.get(n.id);
      expect(typeof c).toBe('number');
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(a.communities.length);
    }
    // community member counts sum to the node count (partition, no orphans/overlaps)
    const total = a.communities.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(collapsedNodes.length);
  });

  it('community ids are a contiguous 0..k-1 range in first-appearance order', () => {
    const a = assignCommunities(collapsedNodes, collapsedEdges);
    const ids = a.communities.map((c) => c.id);
    expect(ids).toStrictEqual(a.communities.map((_, i) => i));
  });

  it('single-schema torture graph derives names from the first name token (not "community-N")', () => {
    const a = assignCommunities(collapsedNodes, collapsedEdges);
    // torture graph is single-schema (main) → names come from the name prefix token,
    // so at least one community carries a real prefix, never all fallbacks.
    const hasRealName = a.communities.some((c) => !c.name.startsWith('community-'));
    expect(hasRealName).toBe(true);
  });

  it('matches the blessed community golden snapshot byte-for-byte', () => {
    const a = assignCommunities(collapsedNodes, collapsedEdges);
    const actual = JSON.stringify(snapshot(collapsedNodes, a), null, 2) + '\n';
    const goldenPath = join(goldenDir, 'community-torture.json');
    if (CAPTURE || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, actual, 'utf-8');
      if (CAPTURE) return;
    }
    expect(actual).toBe(readFileSync(goldenPath, 'utf-8'));
  });
});
