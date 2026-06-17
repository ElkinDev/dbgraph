/**
 * Pure diff engine for snapshot_objects manifests (phase-4-cli-config Batch F, task 6.4).
 * Spec: cli-config "diff compares snapshots per object" +
 *       graph-storage "Two manifests support a per-object diff".
 *
 * PURE — no DB, no I/O, no state. Input: two manifest arrays.
 * Output: added / removed / changed grouped by kind.
 *
 * Comparison key: nodeId (not qname — nodeIds are stable identities).
 * Changed = same nodeId, different bodyHash (including null→non-null or vice versa).
 */

import type { SnapshotObjectRow } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

/** An object that was added (present in b, absent in a). */
export interface DiffAddedRow {
  readonly nodeId: string;
  readonly kind: string;
  readonly qname: string;
  readonly bodyHash: string | null;
}

/** An object that was removed (present in a, absent in b). */
export interface DiffRemovedRow {
  readonly nodeId: string;
  readonly kind: string;
  readonly qname: string;
  readonly bodyHash: string | null;
}

/** An object whose bodyHash changed between the two snapshots. */
export interface DiffChangedRow {
  readonly nodeId: string;
  readonly kind: string;
  readonly qname: string;
  readonly oldBodyHash: string | null;
  readonly newBodyHash: string | null;
}

export interface DiffResult {
  readonly added: readonly DiffAddedRow[];
  readonly removed: readonly DiffRemovedRow[];
  readonly changed: readonly DiffChangedRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// diffManifests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compares two snapshot_objects manifests and returns the per-object diff.
 * Comparison is by nodeId. Order of results follows the input arrays' order.
 *
 * @param a - Manifest rows from the older / base snapshot.
 * @param b - Manifest rows from the newer / head snapshot.
 */
export function diffManifests(
  a: readonly SnapshotObjectRow[],
  b: readonly SnapshotObjectRow[],
): DiffResult {
  const mapA = new Map<string, SnapshotObjectRow>();
  for (const row of a) {
    mapA.set(row.nodeId, row);
  }

  const mapB = new Map<string, SnapshotObjectRow>();
  for (const row of b) {
    mapB.set(row.nodeId, row);
  }

  const added: DiffAddedRow[] = [];
  const removed: DiffRemovedRow[] = [];
  const changed: DiffChangedRow[] = [];

  // Objects in b but not in a → added; objects in both with different hash → changed.
  for (const [nodeId, rowB] of mapB) {
    const rowA = mapA.get(nodeId);
    if (rowA === undefined) {
      added.push({
        nodeId,
        kind: rowB.kind,
        qname: rowB.qname,
        bodyHash: rowB.bodyHash,
      });
    } else if (rowA.bodyHash !== rowB.bodyHash) {
      changed.push({
        nodeId,
        kind: rowB.kind,
        qname: rowB.qname,
        oldBodyHash: rowA.bodyHash,
        newBodyHash: rowB.bodyHash,
      });
    }
  }

  // Objects in a but not in b → removed.
  for (const [nodeId, rowA] of mapA) {
    if (!mapB.has(nodeId)) {
      removed.push({
        nodeId,
        kind: rowA.kind,
        qname: rowA.qname,
        bodyHash: rowA.bodyHash,
      });
    }
  }

  return { added, removed, changed };
}
