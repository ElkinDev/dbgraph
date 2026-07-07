/**
 * explore command handler — task 5.2 (phase-4-cli-config).
 * Spec: cli-config "explore output comes from a pure formatter shared with the MCP tool"
 * Design: resolves qname → GraphNode + getNeighbors → ExploreView → formatExplore.
 *   --detail defaults to 'normal'; brief|normal|full render via the SAME shared formatter.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + node builtins.
 * No adapter imports, no process.exit (cli.ts owns that).
 * formatExplore is the PURE shared formatter from src/core/present/explore.ts.
 */

import type { GraphStore, NodeKind, GraphNode } from '../../index.js';
import { NODE_KINDS, NotFoundError, getNeighbors, formatExplore } from '../../index.js';
import type { ExploreDetail, ExploreView } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExploreOptions {
  readonly store: GraphStore;
  /** Fully qualified name to look up (e.g. 'dbo.orders'). */
  readonly qname: string;
  /** Detail level for formatExplore — defaults to 'normal'. */
  readonly detail: ExploreDetail;
}

/** Extended outcome carrying the formatted output string. */
export interface ExploreOutcome {
  readonly type: 'success';
  readonly output: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// runExplore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves qname → GraphNode, gathers neighbors, and formats the bundle.
 * Throws NotFoundError when the qname resolves to no node in any kind.
 * Returns ExploreOutcome; the caller (cli.ts / dispatch handler) writes output.
 */
export async function runExplore(options: ExploreOptions): Promise<ExploreOutcome> {
  const { store, qname, detail } = options;

  // Resolve the node across all kinds, preferring a REAL node over a phantom stub
  // minted for the same qname (design D3 — e.g. an INSTEAD OF trigger on a view
  // mints a `table` stub; NODE_KINDS visits `table` before `view`, so a first-match
  // break would mislabel the view as [table]). Prefer non-`missing` matches.
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

  // Gather neighbors via core query (uses public barrel — ADR-004 boundary preserved)
  const neighbors = await getNeighbors(store, { nodeId: node.id });

  // Assemble the view and format
  const view: ExploreView = { node, neighbors };
  const output = formatExplore(view, detail);

  return { type: 'success', output };
}
