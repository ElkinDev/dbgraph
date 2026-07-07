/**
 * object command handler — explore-payloads C.3 (design D5).
 * Spec: cli-config "object CLI command mirrors dbgraph_object".
 *
 * `runObject` is a THIN wrapper over the EXISTING formatObject presenter — the SAME
 * presenter dbgraph_object uses — so a CLI-only agent can retrieve one object's full
 * detail (columns, constraints, indexes, triggers, body) WITHOUT the MCP server. It adds
 * ZERO rendering logic; its output is byte-identical to dbgraph_object({ qname, detail })
 * (same-source-same-golden, ruling 4). Resolution mirrors runExplore, including the D3 fix
 * (prefer a REAL node over a phantom stub minted for the same qname). NO --json — the MCP
 * dbgraph_object tool has none (parity + minimal).
 *
 * ADR-004: imports ONLY ../../index.js (public barrel) + a CLI sibling type. No adapter
 * imports, no process.exit (cli.ts owns that).
 */

import type { GraphStore, NodeKind, GraphNode, ObjectDetail, ObjectView } from '../../index.js';
import { NODE_KINDS, NotFoundError, getNeighbors, formatObject } from '../../index.js';
import type { ExploreOutcome } from './explore.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ObjectOptions {
  readonly store: GraphStore;
  /** Fully qualified name to look up (e.g. 'main.employees'). */
  readonly qname: string;
  /** Detail level for formatObject — defaults to 'normal' upstream via parseDetail. */
  readonly detail: ObjectDetail;
}

// ─────────────────────────────────────────────────────────────────────────────
// runObject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves qname → GraphNode, gathers neighbors, and formats the object bundle.
 * Throws NotFoundError when the qname resolves to no node in any kind.
 * Returns ExploreOutcome (shared success/output shape); the caller writes output.
 */
export async function runObject(options: ObjectOptions): Promise<ExploreOutcome> {
  const { store, qname, detail } = options;

  // Resolve across all kinds, preferring a REAL node over a phantom stub minted for the
  // same qname (design D3 — e.g. an INSTEAD OF trigger on a view mints a `table` stub;
  // NODE_KINDS visits `table` before `view`, so a first-match break would mislabel it).
  const matches: GraphNode[] = [];
  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const found = await store.getNodeByQName(kind, qname);
    if (found !== null) matches.push(found);
  }
  const real = matches.filter((n) => !n.missing);
  const effective = real.length > 0 ? real : matches;
  const node: GraphNode | null = effective[0] ?? null;

  if (node === null) {
    throw new NotFoundError('entity', qname);
  }

  // Gather neighbors via the core query (public barrel — ADR-004 boundary preserved).
  const neighbors = await getNeighbors(store, { nodeId: node.id });

  // Assemble the view and format via the EXISTING presenter — no new rendering logic.
  const view: ObjectView = { node, neighbors };
  const output = formatObject(view, detail);

  return { type: 'success', output };
}
