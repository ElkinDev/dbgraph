/**
 * Incremental sync selector — task 4.1 (phase-4-cli-config).
 * Spec: cli-config "sync is incremental by fingerprint, --full forces a rebuild"
 * Design: pure function; no DB, no I/O. Compares existing store nodes vs freshly-extracted
 *   nodes by bodyHash and produces the exact id sets to delete and upsert.
 *
 * ADR-004: imports ONLY core types (through src/index.js).
 * ADR-008: deterministic — pure function of inputs, no side effects.
 * No any types; no adapter imports.
 */

import type { GraphNode } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Delta result
// ─────────────────────────────────────────────────────────────────────────────

export interface DeltaResult {
  /** Node ids that exist in the store but are absent from the fresh extraction — must be deleted. */
  readonly toDelete: readonly string[];
  /** Nodes that are new or have a changed bodyHash — must be upserted. */
  readonly toUpsert: readonly GraphNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDelta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the minimal set of changes needed to bring the store in sync with
 * the freshly-extracted normalized graph nodes.
 *
 * Rules:
 *   - Nodes present in `existing` but absent in `fresh`       → toDelete (by id)
 *   - Nodes present in `fresh` but absent in `existing`       → toUpsert (new)
 *   - Nodes present in BOTH with DIFFERENT bodyHash           → toUpsert (changed)
 *   - Nodes present in BOTH with the SAME bodyHash            → ignored (no-op)
 *
 * @param existing  Current nodes in the store (from getNodesByKind calls).
 * @param fresh     Newly extracted + normalized nodes (from normalizeCatalog).
 * @returns         DeltaResult with the exact operations needed.
 */
export function computeDelta(
  existing: readonly GraphNode[],
  fresh: readonly GraphNode[],
): DeltaResult {
  // Build a map of existing nodes by id for O(1) lookup
  const existingById = new Map<string, string | null>();
  for (const node of existing) {
    existingById.set(node.id, node.bodyHash);
  }

  // Build a set of fresh node ids for O(1) deletion-check
  const freshIds = new Set<string>();
  const toUpsert: GraphNode[] = [];

  for (const node of fresh) {
    freshIds.add(node.id);
    const existingHash = existingById.get(node.id);
    if (existingHash === undefined) {
      // New node — not in the store
      toUpsert.push(node);
    } else if (existingHash !== node.bodyHash) {
      // Changed node — bodyHash differs
      toUpsert.push(node);
    }
    // If existingHash === node.bodyHash: unchanged — skip
  }

  // Nodes in existing but not in fresh — must be deleted
  const toDelete: string[] = [];
  for (const [id] of existingById) {
    if (!freshIds.has(id)) {
      toDelete.push(id);
    }
  }

  return { toDelete, toUpsert };
}
