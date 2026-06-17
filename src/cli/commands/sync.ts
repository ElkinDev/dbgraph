/**
 * sync command handler — task 4.2 (phase-4-cli-config).
 * Spec: cli-config "sync is incremental by fingerprint, --full forces a rebuild"
 * Design: resolves config → adapter + store → fingerprint check → extract (conditional)
 *   → normalizeCatalog → computeDelta → apply delta → putSnapshot.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + node builtins.
 * No adapter imports, no process.exit (cli.ts owns that).
 * Read-only against target DB is INVIOLABLE — only catalog SELECTs via the adapter.
 */

import { normalizeCatalog } from '../../index.js';
import type {
  SchemaAdapter,
  GraphStore,
  SnapshotRecord,
  GraphNode,
  NodeKind,
} from '../../index.js';
import type { HandlerOutcome } from '../dispatch.js';
import { computeDelta } from '../sync/incremental.js';
import { NODE_KINDS } from '../../index.js';
import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Public input type
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Already-opened SchemaAdapter (created by the caller from config). */
  readonly adapter: SchemaAdapter;
  /** Already-opened GraphStore (created by the caller from config). */
  readonly store: GraphStore;
  /** When true, skip the fingerprint short-circuit and force a full re-extract. */
  readonly full: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// runSync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs one incremental sync cycle.
 *
 * Algorithm:
 *   1. Get the live fingerprint from the adapter.
 *   2. Get the last snapshot from the store.
 *   3. If fingerprints are equal AND --full is false → skip (no-op sync).
 *   4. Otherwise: extract → normalizeCatalog → computeDelta → apply delta → putSnapshot.
 *
 * The node-selection logic (computeDelta) is pure and unit-tested separately (task 4.1).
 * Returns HandlerOutcome { type: 'success' } on success.
 */
export async function runSync(options: SyncOptions): Promise<HandlerOutcome> {
  const { adapter, store, full } = options;

  // Step 1: Get live fingerprint
  const liveFingerprint = await adapter.fingerprint();

  // Step 2: Check last snapshot
  const snapshots = await store.listSnapshots();
  const lastSnapshot = snapshots.length > 0 ? snapshots[0] : null;
  const storedFingerprint = lastSnapshot?.fingerprint ?? null;

  // Step 3: Short-circuit if fingerprint is unchanged and not forcing full rebuild
  if (!full && storedFingerprint !== null && storedFingerprint === liveFingerprint) {
    // No changes — skip extraction entirely
    return { type: 'success' };
  }

  // Step 4: Extract the schema
  const scope = {
    levels: adapter.capabilities.defaultLevels,
  };
  const rawCatalog = await adapter.extract(scope);

  // Step 5: Normalize the raw catalog
  const normResult = normalizeCatalog(rawCatalog, scope);
  const freshNodes = normResult.graph.nodes;

  // Step 6: Gather all existing nodes from the store (across all kinds)
  const existingNodes = await getAllNodes(store);

  // Step 7: Compute the delta (pure function)
  const delta = computeDelta(existingNodes, freshNodes);

  // Step 8: Apply the delta
  if (delta.toDelete.length > 0) {
    await store.deleteNodes(delta.toDelete);
  }

  if (delta.toUpsert.length > 0) {
    // Upsert via the normalized graph structure (edges come from the full normResult)
    // For efficiency we send only the changed/new nodes but keep all edges
    // (the store's upsertGraph handles partial graphs idempotently)
    await store.upsertGraph({
      nodes: delta.toUpsert,
      edges: normResult.graph.edges,
    });
  }

  // Step 9: Build per-kind counts from fresh nodes
  const counts = buildCounts(freshNodes);

  // Step 10: Write the snapshot
  const snapshot: SnapshotRecord = {
    id: randomUUID(),
    takenAt: new Date().toISOString(),
    engine: adapter.dialect,
    fingerprint: liveFingerprint,
    counts,
  };
  await store.putSnapshot(snapshot);

  return { type: 'success' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all nodes from the store across all known NodeKinds.
 * Used to build the full existing-node set for delta computation.
 */
async function getAllNodes(store: GraphStore): Promise<GraphNode[]> {
  const results = await Promise.all(
    NODE_KINDS.map((kind: NodeKind) => store.getNodesByKind(kind)),
  );
  // Flatten — each kind returns a separate array
  return results.flatMap((arr) => arr as GraphNode[]);
}

/**
 * Builds per-kind counts from a normalized node list.
 */
function buildCounts(nodes: readonly GraphNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  }
  return counts;
}
