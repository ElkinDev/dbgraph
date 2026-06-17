/**
 * RED→GREEN tests for src/cli/commands/diff.ts (task 6.5, phase-4-cli-config).
 * Spec: cli-config "diff compares snapshots per object and is CI-gate usable"
 * Design: read two manifests → diffManifests → formatDiff → return DiffOutcome.
 *   - No changes → type: 'success' (exit 0).
 *   - Has changes → type: 'negative' (exit 1 — CI-gate usable).
 *   - --last: uses the two most recent snapshots.
 *   - Pre-v2 manifest-less snapshot degrades gracefully.
 *
 * Uses FAKE GraphStore doubles — NO real DB.
 */

import { describe, it, expect } from 'vitest';
import { runDiff, type DiffOptions } from '../../../src/cli/commands/diff.js';
import type { GraphStore, SnapshotRecord, SnapshotObjectRow } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake GraphStore double
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

function makeFakeStore(
  snapshots: SnapshotRecord[],
  manifestMap: Map<string, SnapshotObjectRow[]>,
): GraphStore {
  return {
    async listSnapshots() { return snapshots; },
    async getSnapshotObjects(snapId: string) {
      return manifestMap.get(snapId) ?? [];
    },
    // Unused methods for this test
    async close() { return; },
    async schemaVersion() { return 2; },
    async upsertGraph() { return { nodes: 0, edges: 0 }; },
    async deleteNodes() { return 0; },
    async getNode() { return null; },
    async getNodesByKind() { return []; },
    async getNodeByQName() { return null; },
    async getEdgesFrom() { return []; },
    async getEdgesTo() { return []; },
    async searchFts() { return { hits: [], total: 0 }; },
    async putSnapshot() { return; },
    async getMeta() { return null; },
    async setMeta() { return; },
  } as GraphStore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SNAP_A: SnapshotRecord = {
  id: 'snap-A',
  takenAt: '2026-06-17T10:00:00Z',
  engine: 'sqlite',
  fingerprint: 'fp-A',
  counts: { table: 2 },
};
const SNAP_B: SnapshotRecord = {
  id: 'snap-B',
  takenAt: '2026-06-17T11:00:00Z',
  engine: 'sqlite',
  fingerprint: 'fp-B',
  counts: { table: 3 },
};

const MANIFEST_A = [
  makeRow('snap-A', 'n1', 'table', 'dbo.orders',    'hash-A'),
  makeRow('snap-A', 'n2', 'view',  'dbo.v_archive', 'hash-V'),
];
const MANIFEST_B_NO_CHANGES = [
  makeRow('snap-B', 'n1', 'table', 'dbo.orders',    'hash-A'),
  makeRow('snap-B', 'n2', 'view',  'dbo.v_archive', 'hash-V'),
];
const MANIFEST_B_WITH_CHANGES = [
  makeRow('snap-B', 'n1', 'table',     'dbo.orders',    'hash-A'),      // unchanged
  makeRow('snap-B', 'n3', 'procedure', 'dbo.sp_create', 'hash-new'),    // added
  // n2 removed; n1 changed below is separate test case
];
const MANIFEST_B_CHANGED = [
  makeRow('snap-B', 'n1', 'table', 'dbo.orders', 'hash-changed'),   // changed
  makeRow('snap-B', 'n2', 'view',  'dbo.v_archive', 'hash-V'),
];

// ─────────────────────────────────────────────────────────────────────────────
// runDiff — explicit snap IDs
// ─────────────────────────────────────────────────────────────────────────────

describe('runDiff — explicit snapA/snapB (task 6.5)', () => {
  it('returns type "success" (exit 0) when no changes', async () => {
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', MANIFEST_A], ['snap-B', MANIFEST_B_NO_CHANGES]]),
    );
    const opts: DiffOptions = { store, snapA: 'snap-A', snapB: 'snap-B' };
    const result = await runDiff(opts);
    expect(result.type).toBe('success');
  });

  it('returns type "negative" (exit 1) when there are changes', async () => {
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', MANIFEST_A], ['snap-B', MANIFEST_B_WITH_CHANGES]]),
    );
    const opts: DiffOptions = { store, snapA: 'snap-A', snapB: 'snap-B' };
    const result = await runDiff(opts);
    expect(result.type).toBe('negative');
  });

  it('output contains the formatted diff for changed snapshots', async () => {
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', MANIFEST_A], ['snap-B', MANIFEST_B_WITH_CHANGES]]),
    );
    const opts: DiffOptions = { store, snapA: 'snap-A', snapB: 'snap-B' };
    const result = await runDiff(opts);
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('output is "No changes" for identical manifests', async () => {
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', MANIFEST_A], ['snap-B', MANIFEST_B_NO_CHANGES]]),
    );
    const opts: DiffOptions = { store, snapA: 'snap-A', snapB: 'snap-B' };
    const result = await runDiff(opts);
    expect(result.output.toLowerCase()).toMatch(/no changes/i);
  });

  it('returns type "negative" when a node body hash changed', async () => {
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', MANIFEST_A], ['snap-B', MANIFEST_B_CHANGED]]),
    );
    const opts: DiffOptions = { store, snapA: 'snap-A', snapB: 'snap-B' };
    const result = await runDiff(opts);
    expect(result.type).toBe('negative');
    expect(result.output).toContain('MODIFIED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDiff — --last flag (two most-recent snapshots)
// ─────────────────────────────────────────────────────────────────────────────

describe('runDiff — --last flag', () => {
  it('uses the two most-recent snapshots when last=true', async () => {
    const SNAP_C: SnapshotRecord = {
      id: 'snap-C',
      takenAt: '2026-06-17T12:00:00Z',
      engine: 'sqlite',
      fingerprint: 'fp-C',
      counts: {},
    };
    const manifestC = [
      makeRow('snap-C', 'n1', 'table', 'dbo.orders', 'hash-changed'),
    ];
    // listSnapshots returns in insertion order: A, B, C → last two are B, C
    const store = makeFakeStore(
      [SNAP_A, SNAP_B, SNAP_C],
      new Map([
        ['snap-A', MANIFEST_A],
        ['snap-B', MANIFEST_B_NO_CHANGES],
        ['snap-C', manifestC],
      ]),
    );
    const opts: DiffOptions = { store, last: true };
    const result = await runDiff(opts);
    // snap-B has n1 with hash-A, snap-C has n1 with hash-changed → should see changes
    expect(result.type).toBe('negative');
  });

  it('returns "success" with no-changes message when last two snapshots are identical', async () => {
    const manifestA2 = [
      makeRow('snap-B', 'n1', 'table', 'dbo.orders', 'hash-A'),
    ];
    const manifestA3 = [
      makeRow('snap-A', 'n1', 'table', 'dbo.orders', 'hash-A'),
    ];
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', manifestA3], ['snap-B', manifestA2]]),
    );
    const opts: DiffOptions = { store, last: true };
    const result = await runDiff(opts);
    expect(result.type).toBe('success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDiff — pre-v2 graceful degradation
// ─────────────────────────────────────────────────────────────────────────────

describe('runDiff — pre-v2 graceful degradation', () => {
  it('returns "negative" with degradation message when one manifest is empty (pre-v2)', async () => {
    // A pre-v2 snapshot has no manifest rows (empty []).
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([
        ['snap-A', []],   // pre-v2: no manifest
        ['snap-B', MANIFEST_B_NO_CHANGES],
      ]),
    );
    const opts: DiffOptions = { store, snapA: 'snap-A', snapB: 'snap-B' };
    const result = await runDiff(opts);
    // Pre-v2 degrades gracefully: output mentions re-sync
    expect(result.output.toLowerCase()).toMatch(/manifest|re-sync|sync/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDiff — outcome type shape
// ─────────────────────────────────────────────────────────────────────────────

describe('runDiff — outcome shape', () => {
  it('DiffOutcome always has type and output fields', async () => {
    const store = makeFakeStore(
      [SNAP_A, SNAP_B],
      new Map([['snap-A', MANIFEST_A], ['snap-B', MANIFEST_B_WITH_CHANGES]]),
    );
    const result = await runDiff({ store, snapA: 'snap-A', snapB: 'snap-B' });
    expect('type' in result).toBe(true);
    expect('output' in result).toBe(true);
    expect(typeof result.output).toBe('string');
  });
});
