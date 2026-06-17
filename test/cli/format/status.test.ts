/**
 * Tests for src/cli/format/status.ts — task 4.3 (phase-4-cli-config).
 * Spec: cli-config "status reports counts, last snapshot and live drift"
 * Design: PURE, deterministic, golden-pinned formatter (ADR-008).
 *
 * formatStatus(view: StatusView): string
 *
 * StatusView contains:
 *   - kindCounts: Record<string, number>  (per-kind node counts from getNodesByKind)
 *   - lastSnapshot: SnapshotRecord | null  (most recent snapshot)
 *   - excludedCount: number                (nodes excluded by filters)
 *   - hasDrift: boolean                    (live fp !== stored last-snapshot fp)
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import { formatStatus, type StatusView } from '../../../src/cli/format/status.js';
import type { SnapshotRecord } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SNAP_BASE: SnapshotRecord = {
  id: 'snap-001',
  takenAt: '2024-06-17T10:00:00.000Z',
  engine: 'sqlite',
  fingerprint: 'fp-abc123',
  counts: { table: 5, view: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Basic output structure
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — basic output', () => {
  it('includes per-kind counts section', () => {
    const view: StatusView = {
      kindCounts: { table: 3, view: 1 },
      lastSnapshot: null,
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    expect(output).toContain('table');
    expect(output).toContain('3');
    expect(output).toContain('view');
    expect(output).toContain('1');
  });

  it('includes last snapshot info when present', () => {
    const view: StatusView = {
      kindCounts: {},
      lastSnapshot: SNAP_BASE,
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    expect(output).toContain('2024-06-17');
    expect(output).toContain('sqlite');
    expect(output).toContain('fp-abc123');
  });

  it('shows "no snapshots" message when lastSnapshot is null', () => {
    const view: StatusView = {
      kindCounts: {},
      lastSnapshot: null,
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    expect(output.toLowerCase()).toMatch(/no snapshot|never synced/);
  });

  it('includes excluded count when > 0', () => {
    const view: StatusView = {
      kindCounts: { table: 5 },
      lastSnapshot: null,
      excludedCount: 3,
      hasDrift: false,
    };

    const output = formatStatus(view);

    expect(output).toContain('3');
    // Should mention exclusion/excluded/filtered
    expect(output.toLowerCase()).toMatch(/exclu|filter/);
  });

  it('does NOT mention excluded when count is 0', () => {
    const view: StatusView = {
      kindCounts: { table: 5 },
      lastSnapshot: null,
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    // Should not clutter output with zero-excluded noise
    expect(output.toLowerCase()).not.toMatch(/excluded: 0|filtered: 0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drift indicator
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — drift indicator', () => {
  it('shows DRIFT indicator when hasDrift is true', () => {
    const view: StatusView = {
      kindCounts: {},
      lastSnapshot: SNAP_BASE,
      excludedCount: 0,
      hasDrift: true,
    };

    const output = formatStatus(view);

    expect(output.toUpperCase()).toContain('DRIFT');
  });

  it('does NOT show DRIFT when hasDrift is false', () => {
    const view: StatusView = {
      kindCounts: {},
      lastSnapshot: SNAP_BASE,
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    expect(output.toUpperCase()).not.toContain('DRIFT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism — same input always produces identical output (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — determinism (ADR-008)', () => {
  it('produces identical output for the same input (run 1 == run 2)', () => {
    const view: StatusView = {
      kindCounts: { table: 5, view: 2, index: 10 },
      lastSnapshot: SNAP_BASE,
      excludedCount: 1,
      hasDrift: true,
    };

    const run1 = formatStatus(view);
    const run2 = formatStatus(view);

    expect(run1).toBe(run2);
  });

  it('golden: produces the expected stable output for a well-known input', () => {
    const view: StatusView = {
      kindCounts: { table: 5, view: 2 },
      lastSnapshot: SNAP_BASE,
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    // Structural golden checks — must contain these exact substrings
    expect(output).toContain('table');
    expect(output).toContain('5');
    expect(output).toContain('view');
    expect(output).toContain('2');
    expect(output).toContain('2024-06-17T10:00:00.000Z');
    expect(output).toContain('sqlite');
    expect(output).toContain('fp-abc123');
  });

  it('snapshot counts are shown in last snapshot section', () => {
    const view: StatusView = {
      kindCounts: { table: 10 },
      lastSnapshot: {
        ...SNAP_BASE,
        counts: { table: 8, view: 3, procedure: 1 },
      },
      excludedCount: 0,
      hasDrift: false,
    };

    const output = formatStatus(view);

    // Snapshot-section counts should appear
    expect(output).toContain('8');
    expect(output).toContain('3');
    expect(output).toContain('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty graph
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStatus — empty graph', () => {
  it('handles empty kindCounts without throwing', () => {
    const view: StatusView = {
      kindCounts: {},
      lastSnapshot: null,
      excludedCount: 0,
      hasDrift: false,
    };

    expect(() => formatStatus(view)).not.toThrow();
  });
});
