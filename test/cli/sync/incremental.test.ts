/**
 * Tests for src/cli/sync/incremental.ts — task 4.1 (phase-4-cli-config).
 * Spec: cli-config "sync is incremental by fingerprint" — changed source applies only the delta.
 * Design: pure selector over a fake in-memory GraphStore double.
 *
 * The function computeDelta(existingNodes, freshNodes) is a PURE function:
 *   - existingNodes: GraphNode[] currently in the store (returned by getNodesByKind calls)
 *   - freshNodes:    GraphNode[] extracted + normalized (keyed by id, carry updated bodyHash)
 *   Returns: { toDelete: string[], toUpsert: GraphNode[] }
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import { computeDelta } from '../../../src/cli/sync/incremental.js';
import type { GraphNode } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(id: string, bodyHash: string | null = 'hash-abc'): GraphNode {
  return {
    id,
    kind: 'table',
    schema: 'dbo',
    name: id,
    qname: `dbo.${id}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash,
    payload: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// No changes — empty delta when all nodes are identical
// ─────────────────────────────────────────────────────────────────────────────

describe('computeDelta — no changes', () => {
  it('returns empty toDelete and toUpsert when nodes are identical', () => {
    const existing = [makeNode('a', 'hash-1'), makeNode('b', 'hash-2')];
    const fresh = [makeNode('a', 'hash-1'), makeNode('b', 'hash-2')];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toHaveLength(0);
    expect(delta.toUpsert).toHaveLength(0);
  });

  it('returns empty delta when both sets are empty', () => {
    const delta = computeDelta([], []);
    expect(delta.toDelete).toHaveLength(0);
    expect(delta.toUpsert).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New node — added to source
// ─────────────────────────────────────────────────────────────────────────────

describe('computeDelta — new nodes', () => {
  it('marks a new node (not in existing) for upsert', () => {
    const existing = [makeNode('a', 'hash-1')];
    const fresh = [makeNode('a', 'hash-1'), makeNode('b', 'hash-2')];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toHaveLength(0);
    expect(delta.toUpsert).toHaveLength(1);
    expect(delta.toUpsert[0]!.id).toBe('b');
  });

  it('marks multiple new nodes for upsert', () => {
    const existing: GraphNode[] = [];
    const fresh = [makeNode('a', 'hash-1'), makeNode('b', 'hash-2'), makeNode('c', 'hash-3')];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toHaveLength(0);
    expect(delta.toUpsert).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Removed node — deleted from source
// ─────────────────────────────────────────────────────────────────────────────

describe('computeDelta — removed nodes', () => {
  it('marks a removed node (not in fresh) for deletion by id', () => {
    const existing = [makeNode('a', 'hash-1'), makeNode('b', 'hash-2')];
    const fresh = [makeNode('a', 'hash-1')];

    const delta = computeDelta(existing, fresh);

    expect(delta.toUpsert).toHaveLength(0);
    expect(delta.toDelete).toHaveLength(1);
    expect(delta.toDelete[0]).toBe('b');
  });

  it('marks multiple removed nodes for deletion', () => {
    const existing = [makeNode('a', 'hash-1'), makeNode('b', 'hash-2'), makeNode('c', 'hash-3')];
    const fresh: GraphNode[] = [];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toHaveLength(3);
    expect(delta.toUpsert).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Changed node — bodyHash differs
// ─────────────────────────────────────────────────────────────────────────────

describe('computeDelta — changed nodes (bodyHash mismatch)', () => {
  it('marks a node with a different bodyHash for upsert (not deletion)', () => {
    const existing = [makeNode('a', 'hash-old')];
    const fresh = [makeNode('a', 'hash-new')];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toHaveLength(0);
    expect(delta.toUpsert).toHaveLength(1);
    expect(delta.toUpsert[0]!.id).toBe('a');
    expect(delta.toUpsert[0]!.bodyHash).toBe('hash-new');
  });

  it('does not mark a node for upsert when bodyHash is unchanged', () => {
    const existing = [makeNode('a', 'hash-same')];
    const fresh = [makeNode('a', 'hash-same')];

    const delta = computeDelta(existing, fresh);

    expect(delta.toUpsert).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mixed scenario — all three types of change at once
// ─────────────────────────────────────────────────────────────────────────────

describe('computeDelta — mixed delta (add + remove + change)', () => {
  it('correctly computes all three change types simultaneously', () => {
    const existing = [
      makeNode('unchanged', 'hash-same'),
      makeNode('changed', 'hash-old'),
      makeNode('removed', 'hash-r'),
    ];
    const fresh = [
      makeNode('unchanged', 'hash-same'),
      makeNode('changed', 'hash-new'),
      makeNode('added', 'hash-a'),
    ];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toEqual(['removed']);
    expect(delta.toUpsert).toHaveLength(2);
    const upsertIds = delta.toUpsert.map((n) => n.id).sort();
    expect(upsertIds).toEqual(['added', 'changed']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Null bodyHash handling — treat null as distinct from any non-null hash
// ─────────────────────────────────────────────────────────────────────────────

describe('computeDelta — null bodyHash', () => {
  it('treats null bodyHash in fresh as changed vs non-null in existing', () => {
    const existing = [makeNode('a', 'hash-1')];
    const fresh = [makeNode('a', null)];

    const delta = computeDelta(existing, fresh);

    // bodyHash changed (hash-1 → null), so node should be upserted
    expect(delta.toUpsert).toHaveLength(1);
    expect(delta.toUpsert[0]!.id).toBe('a');
  });

  it('treats null = null as unchanged', () => {
    const existing = [makeNode('a', null)];
    const fresh = [makeNode('a', null)];

    const delta = computeDelta(existing, fresh);

    expect(delta.toDelete).toHaveLength(0);
    expect(delta.toUpsert).toHaveLength(0);
  });
});
