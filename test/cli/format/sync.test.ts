/**
 * Tests for src/cli/format/sync.ts — task 2.1 (ux-observability).
 * Spec: cli-config "sync emits a deterministic golden-pinned summary" (US-005 + US-004).
 * Design Decision D3: pure formatter, mirrors format/status.ts line shape.
 * Design Decision D4: NO timing in the pinned body (ADR-008) — elapsed ms flows through
 *   the logger seam, never the formatter.
 *
 * The formatter is PURE: same input → byte-identical output. No Date.now(), no process.env,
 * no I/O. It renders ONLY counts, per-kind totals, drift state, snapshot id + fingerprint —
 * NEVER schema names, connection strings, secrets, or sampled data values.
 *
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import {
  formatSyncSummary,
  type SyncSummary,
} from '../../../src/cli/format/sync.js';

// ─────────────────────────────────────────────────────────────────────────────
// Golden — full sync with a known delta (drift resolved)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSyncSummary — golden (full sync)', () => {
  const view: SyncSummary = {
    mode: 'full',
    counts: { view: 1, table: 3, procedure: 2 }, // unsorted input — formatter MUST sort
    upserted: 6,
    deleted: 1,
    hasDrift: true,
    snapshotId: 'snap-0001',
    fingerprint: 'fp-deadbeef',
  };

  it('renders the exact golden string (kinds sorted, drift resolved)', () => {
    const expected =
      'Sync Summary\n' +
      '────────────\n' +
      '  mode         full\n' +
      '  counts:\n' +
      '    procedure    2\n' +
      '    table        3\n' +
      '    view         1\n' +
      '  upserted     6\n' +
      '  deleted      1\n' +
      '  snapshot     snap-0001\n' +
      '  fingerprint  fp-deadbeef\n' +
      '\n' +
      'DRIFT RESOLVED — source schema had changed since the previous snapshot.\n' +
      '\n';
    expect(formatSyncSummary(view)).toBe(expected);
  });

  it('is deterministic — same input yields byte-identical output', () => {
    const run1 = formatSyncSummary(view);
    const run2 = formatSyncSummary(view);
    expect(run1).toBe(run2);
  });

  it('contains NO timing token (no elapsed / ms) in the pinned body (ADR-008, D4)', () => {
    const out = formatSyncSummary(view);
    expect(out).not.toMatch(/\d+\s*ms\b/);
    expect(out.toLowerCase()).not.toContain('elapsed');
    expect(out.toLowerCase()).not.toContain('duration');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden — incremental sync, no drift, empty deletion
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSyncSummary — golden (incremental, no drift)', () => {
  it('renders the exact golden string (no DRIFT line when hasDrift is false)', () => {
    const view: SyncSummary = {
      mode: 'incremental',
      counts: { table: 5 },
      upserted: 2,
      deleted: 0,
      hasDrift: false,
      snapshotId: 'snap-0002',
      fingerprint: 'fp-abc123',
    };
    const expected =
      'Sync Summary\n' +
      '────────────\n' +
      '  mode         incremental\n' +
      '  counts:\n' +
      '    table        5\n' +
      '  upserted     2\n' +
      '  deleted      0\n' +
      '  snapshot     snap-0002\n' +
      '  fingerprint  fp-abc123\n' +
      '\n';
    expect(formatSyncSummary(view)).toBe(expected);
  });

  it('renders "(none)" when counts is empty', () => {
    const view: SyncSummary = {
      mode: 'full',
      counts: {},
      upserted: 0,
      deleted: 0,
      hasDrift: false,
      snapshotId: 'snap-0003',
      fingerprint: 'fp-empty',
    };
    const expected =
      'Sync Summary\n' +
      '────────────\n' +
      '  mode         full\n' +
      '  counts:\n' +
      '    (none)\n' +
      '  upserted     0\n' +
      '  deleted      0\n' +
      '  snapshot     snap-0003\n' +
      '  fingerprint  fp-empty\n' +
      '\n';
    expect(formatSyncSummary(view)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden — skipped sync (fingerprint unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatSyncSummary — golden (skipped)', () => {
  it('renders the "already up to date" line for mode:skipped', () => {
    const view: SyncSummary = {
      mode: 'skipped',
      counts: {},
      upserted: 0,
      deleted: 0,
      hasDrift: false,
      snapshotId: '',
      fingerprint: 'fp-unchanged',
    };
    const expected =
      'Sync Summary\n' +
      '────────────\n' +
      '  already up to date — no changes since last snapshot\n' +
      '  fingerprint  fp-unchanged\n' +
      '\n';
    expect(formatSyncSummary(view)).toBe(expected);
  });

  it('skipped output carries no timing token', () => {
    const view: SyncSummary = {
      mode: 'skipped',
      counts: {},
      upserted: 0,
      deleted: 0,
      hasDrift: false,
      snapshotId: '',
      fingerprint: 'fp-unchanged',
    };
    const out = formatSyncSummary(view);
    expect(out).not.toMatch(/\d+\s*ms\b/);
  });
});
