/**
 * RED→GREEN tests for the pure diff engine (task 6.4).
 * Design: diffManifests(a, b) → { added, removed, changed } grouped by kind.
 * Spec: cli-config "diff compares snapshots per object" +
 *       graph-storage "Two manifests support a per-object diff".
 *
 * PURE unit tests — no DB, no store, fabricated manifests only.
 */

import { describe, it, expect } from 'vitest';
import { diffManifests } from '../../../src/cli/diff/engine.js';
import type { SnapshotObjectRow } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(
  snapshotId: string,
  nodeId: string,
  kind: string,
  qname: string,
  bodyHash: string | null = null,
): SnapshotObjectRow {
  return { snapshotId, nodeId, kind, qname, bodyHash };
}

// ─────────────────────────────────────────────────────────────────────────────
// diffManifests — basic contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('diffManifests — basic contracts (task 6.4)', () => {
  it('returns empty added/removed/changed for identical manifests', () => {
    const a = [
      makeRow('s1', 'n1', 'table', 'dbo.orders', 'hash-A'),
      makeRow('s1', 'n2', 'view',  'dbo.v_orders', 'hash-B'),
    ];
    const b = [
      makeRow('s2', 'n1', 'table', 'dbo.orders', 'hash-A'),
      makeRow('s2', 'n2', 'view',  'dbo.v_orders', 'hash-B'),
    ];
    const result = diffManifests(a, b);
    expect(result.added).toStrictEqual([]);
    expect(result.removed).toStrictEqual([]);
    expect(result.changed).toStrictEqual([]);
  });

  it('detects an added node (present in b, absent in a)', () => {
    const a = [makeRow('s1', 'n1', 'table', 'dbo.orders', 'hash-A')];
    const b = [
      makeRow('s2', 'n1', 'table', 'dbo.orders', 'hash-A'),
      makeRow('s2', 'n2', 'table', 'dbo.customers', 'hash-B'),
    ];
    const result = diffManifests(a, b);
    expect(result.added.length).toBe(1);
    expect(result.added[0]?.nodeId).toBe('n2');
    expect(result.added[0]?.qname).toBe('dbo.customers');
    expect(result.added[0]?.kind).toBe('table');
  });

  it('detects a removed node (present in a, absent in b)', () => {
    const a = [
      makeRow('s1', 'n1', 'table', 'dbo.orders', 'hash-A'),
      makeRow('s1', 'n2', 'view',  'dbo.v_old', 'hash-X'),
    ];
    const b = [makeRow('s2', 'n1', 'table', 'dbo.orders', 'hash-A')];
    const result = diffManifests(a, b);
    expect(result.removed.length).toBe(1);
    expect(result.removed[0]?.nodeId).toBe('n2');
    expect(result.removed[0]?.kind).toBe('view');
  });

  it('detects a changed node (same nodeId, different bodyHash)', () => {
    const a = [makeRow('s1', 'n1', 'procedure', 'dbo.sp_calc', 'hash-old')];
    const b = [makeRow('s2', 'n1', 'procedure', 'dbo.sp_calc', 'hash-new')];
    const result = diffManifests(a, b);
    expect(result.changed.length).toBe(1);
    expect(result.changed[0]?.nodeId).toBe('n1');
    expect(result.changed[0]?.kind).toBe('procedure');
    expect(result.changed[0]?.oldBodyHash).toBe('hash-old');
    expect(result.changed[0]?.newBodyHash).toBe('hash-new');
  });

  it('handles all three changes simultaneously', () => {
    const a = [
      makeRow('s1', 'n1', 'table',     'dbo.orders',    'hash-1'),  // unchanged
      makeRow('s1', 'n2', 'view',      'dbo.v_old',     'hash-2'),  // removed
      makeRow('s1', 'n3', 'procedure', 'dbo.sp_calc',   'hash-3'),  // changed
    ];
    const b = [
      makeRow('s2', 'n1', 'table',     'dbo.orders',    'hash-1'),  // unchanged
      makeRow('s2', 'n3', 'procedure', 'dbo.sp_calc',   'hash-3b'), // changed
      makeRow('s2', 'n4', 'table',     'dbo.customers', 'hash-4'),  // added
    ];
    const result = diffManifests(a, b);
    expect(result.added.map((r) => r.nodeId)).toStrictEqual(['n4']);
    expect(result.removed.map((r) => r.nodeId)).toStrictEqual(['n2']);
    expect(result.changed.map((r) => r.nodeId)).toStrictEqual(['n3']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diffManifests — grouping by kind
// ─────────────────────────────────────────────────────────────────────────────

describe('diffManifests — grouping by kind', () => {
  it('added array carries the kind field from the manifest', () => {
    const a: SnapshotObjectRow[] = [];
    const b = [
      makeRow('s2', 'n1', 'table',     'dbo.t1', 'h1'),
      makeRow('s2', 'n2', 'view',      'dbo.v1', 'h2'),
      makeRow('s2', 'n3', 'procedure', 'dbo.p1', 'h3'),
    ];
    const result = diffManifests(a, b);
    const kinds = result.added.map((r) => r.kind).sort();
    expect(kinds).toStrictEqual(['procedure', 'table', 'view']);
  });

  it('removed array carries the kind field from the manifest', () => {
    const a = [
      makeRow('s1', 'n1', 'table', 'dbo.t1', 'h1'),
      makeRow('s1', 'n2', 'trigger', 'dbo.trg', null),
    ];
    const b: SnapshotObjectRow[] = [];
    const result = diffManifests(a, b);
    const kinds = result.removed.map((r) => r.kind).sort();
    expect(kinds).toStrictEqual(['table', 'trigger']);
  });

  it('changed array carries the kind, qname, oldBodyHash, newBodyHash', () => {
    const a = [
      makeRow('s1', 'n1', 'procedure', 'dbo.sp_x', 'old'),
      makeRow('s1', 'n2', 'trigger',   'dbo.trg_y', 'old-t'),
    ];
    const b = [
      makeRow('s2', 'n1', 'procedure', 'dbo.sp_x', 'new'),
      makeRow('s2', 'n2', 'trigger',   'dbo.trg_y', 'new-t'),
    ];
    const result = diffManifests(a, b);
    expect(result.changed.length).toBe(2);
    const proc = result.changed.find((r) => r.kind === 'procedure');
    expect(proc?.qname).toBe('dbo.sp_x');
    expect(proc?.oldBodyHash).toBe('old');
    expect(proc?.newBodyHash).toBe('new');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diffManifests — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('diffManifests — edge cases', () => {
  it('null bodyHash in both a and b is NOT considered changed', () => {
    const a = [makeRow('s1', 'n1', 'table', 'dbo.t1', null)];
    const b = [makeRow('s2', 'n1', 'table', 'dbo.t1', null)];
    const result = diffManifests(a, b);
    expect(result.changed).toStrictEqual([]);
  });

  it('null bodyHash in a vs non-null in b is considered changed', () => {
    const a = [makeRow('s1', 'n1', 'table', 'dbo.t1', null)];
    const b = [makeRow('s2', 'n1', 'table', 'dbo.t1', 'new-hash')];
    const result = diffManifests(a, b);
    expect(result.changed.length).toBe(1);
    expect(result.changed[0]?.oldBodyHash).toBeNull();
    expect(result.changed[0]?.newBodyHash).toBe('new-hash');
  });

  it('empty manifests on both sides returns empty diff', () => {
    const result = diffManifests([], []);
    expect(result.added).toStrictEqual([]);
    expect(result.removed).toStrictEqual([]);
    expect(result.changed).toStrictEqual([]);
  });

  it('comparison is by nodeId, not by qname or position', () => {
    // Same qname but different nodeId means removed + added, not changed
    const a = [makeRow('s1', 'n1', 'table', 'dbo.orders', 'hash-A')];
    const b = [makeRow('s2', 'n2', 'table', 'dbo.orders', 'hash-A')]; // different id
    const result = diffManifests(a, b);
    expect(result.removed.length).toBe(1);
    expect(result.added.length).toBe(1);
    expect(result.changed).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diffManifests — purity / determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('diffManifests — purity', () => {
  it('calling twice with same inputs returns equal results', () => {
    const a = [
      makeRow('s1', 'n1', 'table', 'dbo.orders', 'hash-A'),
      makeRow('s1', 'n2', 'view',  'dbo.v_old',  'hash-B'),
    ];
    const b = [
      makeRow('s2', 'n1', 'table', 'dbo.orders',    'hash-A'),
      makeRow('s2', 'n3', 'table', 'dbo.customers', 'hash-C'),
    ];
    const r1 = diffManifests(a, b);
    const r2 = diffManifests(a, b);
    expect(r1).toStrictEqual(r2);
  });

  it('does not mutate the input arrays', () => {
    const a = [makeRow('s1', 'n1', 'table', 'dbo.orders', 'hash-A')];
    const b = [makeRow('s2', 'n2', 'table', 'dbo.t2', 'hash-B')];
    const aLen = a.length;
    const bLen = b.length;
    diffManifests(a, b);
    expect(a.length).toBe(aLen);
    expect(b.length).toBe(bLen);
  });
});
