/**
 * status command handler — task 4.3 (phase-4-cli-config).
 * Spec: cli-config "status reports counts, last snapshot and live drift"
 * Design: gathers counts from getNodesByKind + last snapshot from listSnapshots
 *   + live adapter.fingerprint() → assembles StatusView → formatStatus → stdout.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + node builtins.
 * No adapter imports, no process.exit (cli.ts owns that).
 * Formatter is PURE — all I/O stays in this handler.
 */

import type { SchemaAdapter, GraphStore, GraphNode, NodeKind } from '../../index.js';
import { NODE_KINDS } from '../../index.js';
import { formatStatus, type StatusView } from '../format/status.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusOptions {
  readonly adapter: SchemaAdapter;
  readonly store: GraphStore;
}

/** Extended outcome for status — carries the formatted output string. */
export interface StatusOutcome {
  readonly type: 'success';
  readonly output: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// runStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gathers status data and returns a formatted output string via StatusOutcome.
 * The caller (cli.ts) is responsible for writing output to stdout.
 *
 * Algorithm:
 *   1. Get all nodes from the store → build per-kind counts and excluded count.
 *   2. Get the most recent snapshot via listSnapshots.
 *   3. Get the live fingerprint from the adapter.
 *   4. Detect drift: hasDrift = (lastSnapshot !== null) && (liveFp !== lastSnapshot.fingerprint).
 *   5. Assemble StatusView → formatStatus → return StatusOutcome.
 */
export async function runStatus(options: StatusOptions): Promise<StatusOutcome> {
  const { adapter, store } = options;

  // Step 1: Collect all nodes across all kinds
  const allNodeArrays = await Promise.all(
    NODE_KINDS.map((kind: NodeKind) => store.getNodesByKind(kind)),
  );
  const allNodes: GraphNode[] = allNodeArrays.flatMap((arr) => arr as GraphNode[]);

  // Build per-kind counts (non-excluded, non-missing nodes)
  const kindCounts: Record<string, number> = {};
  let excludedCount = 0;
  for (const node of allNodes) {
    if (node.missing || node.excluded) {
      excludedCount++;
    } else {
      kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;
    }
  }

  // Step 2: Get last snapshot (listSnapshots returns most-recent first)
  const snapshots = await store.listSnapshots();
  const lastSnapshot = snapshots.length > 0 ? (snapshots[0] ?? null) : null;

  // Step 3: Get live fingerprint
  const liveFp = await adapter.fingerprint();

  // Step 4: Detect drift
  const hasDrift = lastSnapshot !== null && liveFp !== lastSnapshot.fingerprint;

  // Step 5: Assemble and format
  const view: StatusView = {
    kindCounts,
    lastSnapshot,
    excludedCount,
    hasDrift,
  };

  const output = formatStatus(view);

  return { type: 'success', output };
}
