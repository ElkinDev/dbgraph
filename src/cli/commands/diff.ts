/**
 * diff command handler — task 6.5 (phase-4-cli-config).
 * Spec: cli-config "diff compares snapshots per object and is CI-gate usable"
 * Design: reads two snapshot_objects manifests via getSnapshotObjects → diffManifests
 *   → formatDiff → returns DiffOutcome.
 *
 * Exit codes (via exitCodeFor in cli.ts):
 *   - type: 'success'  → exit 0 (no changes)
 *   - type: 'negative' → exit 1 (changes exist — CI-gate usable, Decision 9)
 *
 * Pre-v2 graceful degradation: empty manifest → formatDiffNoManifest message.
 * --last: compare the two most-recent snapshots (by insertion order from listSnapshots).
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + local CLI modules.
 * No adapter imports, no process.exit (cli.ts owns that).
 */

import type { GraphStore } from '../../index.js';
import { diffManifests } from '../diff/engine.js';
import { formatDiff, formatDiffNoManifest } from '../format/diff.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffOptions {
  readonly store: GraphStore;
  /** Explicit first snapshot ID. Required unless last=true. */
  readonly snapA?: string;
  /** Explicit second snapshot ID. Required unless last=true. */
  readonly snapB?: string;
  /** When true, compare the two most-recent snapshots (--last flag). */
  readonly last?: boolean;
}

export interface DiffOutcome {
  readonly type: 'success' | 'negative';
  readonly output: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// runDiff
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compares two snapshot manifests and returns a formatted diff.
 * Returns type 'negative' when changes are found (exit 1) or when a pre-v2
 * manifest is detected (degradation case — output instructs user to re-sync).
 * Returns type 'success' when no changes are found (exit 0).
 */
export async function runDiff(options: DiffOptions): Promise<DiffOutcome> {
  const { store, last } = options;

  let snapAId: string;
  let snapBId: string;

  if (last === true) {
    // Resolve the two most-recent snapshots from the local index.
    // listSnapshots returns them in insertion order; last two = second-to-last and last.
    const snapshots = await store.listSnapshots();
    if (snapshots.length < 2) {
      return {
        type: 'negative',
        output: 'Not enough snapshots for diff. Need at least two syncs.\n',
      };
    }
    const len = snapshots.length;
    // Non-null assertion: length >= 2 ensures indices are valid.
    snapAId = snapshots[len - 2]!.id;
    snapBId = snapshots[len - 1]!.id;
  } else {
    if (options.snapA === undefined || options.snapB === undefined) {
      return {
        type: 'negative',
        output: 'Usage: dbgraph diff <snapA> <snapB>  |  dbgraph diff --last\n',
      };
    }
    snapAId = options.snapA;
    snapBId = options.snapB;
  }

  // Read both manifests
  const [manifestA, manifestB] = await Promise.all([
    store.getSnapshotObjects(snapAId),
    store.getSnapshotObjects(snapBId),
  ]);

  // Pre-v2 graceful degradation: if either manifest is empty, the snapshot
  // was likely recorded before the v2 schema index (no snapshot_objects rows).
  // An empty manifest after v2 is an unusual edge case (e.g., empty graph) —
  // we degrade consistently when either manifest has no rows, as the diff would
  // not be meaningful (all objects would appear added or removed).
  if (manifestA.length === 0 || manifestB.length === 0) {
    return {
      type: 'negative',
      output: formatDiffNoManifest(snapAId, snapBId),
    };
  }

  // Compute diff
  const diffResult = diffManifests(manifestA, manifestB);
  const hasChanges =
    diffResult.added.length > 0 ||
    diffResult.removed.length > 0 ||
    diffResult.changed.length > 0;

  const output = formatDiff(diffResult);

  return {
    type: hasChanges ? 'negative' : 'success',
    output,
  };
}
