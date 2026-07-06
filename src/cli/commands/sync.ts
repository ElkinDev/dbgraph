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
import { computeDelta } from '../sync/incremental.js';
import { NODE_KINDS } from '../../index.js';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../../core/ports/logger.js';
import { noopLogger } from '../../core/ports/logger.js';
import type { SyncSummary } from '../format/sync.js';

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
  /**
   * Optional Logger for observable progress (Design Decision D6).
   * Defaults to noopLogger — back-compat, mirrors openConnections. runSync logs
   * phase transitions (extract / delta / snapshot) but NEVER formats or writes I/O:
   * the handler owns process.stdout via formatSyncSummary.
   *
   * CONTENT-SAFETY: only count/phase/id scalars are ever passed as log meta — never
   * schema names, object identifiers, connection strings, secrets, or sampled values.
   */
  readonly logger?: Logger;
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
 * Emits phase progress through the injected Logger (Design Decision D6) and returns a
 * typed SyncSummary (Design Decision D5) — the handler formats + writes it to stdout.
 */
export async function runSync(options: SyncOptions): Promise<SyncSummary> {
  const { adapter, store, full } = options;
  const logger = options.logger ?? noopLogger;

  // Step 1: Get live fingerprint
  const liveFingerprint = await adapter.fingerprint();

  // Step 2: Check last snapshot
  const snapshots = await store.listSnapshots();
  const lastSnapshot = snapshots.length > 0 ? snapshots[0] : null;
  const storedFingerprint = lastSnapshot?.fingerprint ?? null;

  // Step 3: Short-circuit if fingerprint is unchanged and not forcing full rebuild
  if (!full && storedFingerprint !== null && storedFingerprint === liveFingerprint) {
    // No changes — skip extraction entirely (but SPEAK it — no more silent exit).
    logger.info('extraction skipped');
    return {
      mode: 'skipped',
      counts: {},
      upserted: 0,
      deleted: 0,
      hasDrift: false,
      snapshotId: '',
      fingerprint: liveFingerprint,
    };
  }

  // Drift = the stored fingerprint existed AND differed from live (this sync resolves it).
  const hasDrift = storedFingerprint !== null && storedFingerprint !== liveFingerprint;

  // Step 4: Extract the schema
  logger.info('extract started');
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
  const upserted = delta.toUpsert.length;
  const deleted = delta.toDelete.length;

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

  // Content-safety: only count scalars are logged — never node names or values.
  logger.info('delta computed', { upserted, deleted });

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
  logger.info('snapshot written', { id: snapshot.id });

  // Step 11: Build the observable summary (Design Decision D5).
  return {
    mode: full ? 'full' : 'incremental',
    counts,
    upserted,
    deleted,
    hasDrift,
    snapshotId: snapshot.id,
    fingerprint: liveFingerprint,
  };
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
