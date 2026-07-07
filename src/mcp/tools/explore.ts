/**
 * dbgraph_explore tool handler — task 3.1 (phase-5-mcp-server).
 * Spec: dbgraph_explore compact neighborhood; Ambiguous target returns disambiguation.
 * Design: wraps getNeighbors + formatExplore; detail brief|normal|full.
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 * Never src/adapters/** or src/cli/**.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NODE_KINDS,
  getNeighbors,
  formatExplore,
  type GraphStore,
  type GraphNode,
  type NodeKind,
  type ExploreDetail,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface ExploreArgs {
  target: string;
  detail: ExploreDetail;
}

function parseArgs(raw: Record<string, unknown>): ExploreArgs {
  const target = raw['target'];
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('dbgraph_explore: "target" must be a non-empty string');
  }
  const rawDetail = raw['detail'];
  if (rawDetail !== undefined && rawDetail !== 'brief' && rawDetail !== 'normal' && rawDetail !== 'full') {
    throw new Error(`dbgraph_explore: "detail" must be brief, normal, or full (got "${String(rawDetail)}")`);
  }
  const detail: ExploreDetail = (rawDetail as ExploreDetail | undefined) ?? 'normal';
  return { target: target.trim(), detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve target to a single node (or return disambiguation candidates)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveNode(
  store: GraphStore,
  target: string,
): Promise<{ node: GraphNode } | { candidates: GraphNode[] } | { notFound: true }> {
  const matches: GraphNode[] = [];

  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const node = await store.getNodeByQName(kind, target);
    if (node !== null) {
      matches.push(node);
    }
  }

  // Prefer a REAL node over a phantom stub minted for the same qname (design D3):
  // e.g. an INSTEAD OF trigger on a view mints a `table` stub, which would otherwise
  // make a view falsely resolve as ambiguous / labeled [table].
  const real = matches.filter((n) => !n.missing);
  const effective = real.length > 0 ? real : matches;

  if (effective.length === 0) {
    return { notFound: true };
  }
  if (effective.length === 1 && effective[0] !== undefined) {
    return { node: effective[0] };
  }
  // Multiple real matches = disambiguation required
  return { candidates: effective };
}

// ─────────────────────────────────────────────────────────────────────────────
// runExplore — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runExploreTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);
  const resolved = await resolveNode(store, args.target);

  if ('notFound' in resolved) {
    return {
      content: [
        {
          type: 'text',
          text: `[NOT_FOUND] No object named "${args.target}" found in the graph.`,
        },
      ],
      isError: true,
    };
  }

  if ('candidates' in resolved) {
    const names = resolved.candidates.map((n) => `  ${n.qname}  [${n.kind}]`).join('\n');
    return {
      content: [
        {
          type: 'text',
          text: `Ambiguous name "${args.target}" — please qualify with schema:\n${names}\n`,
        },
      ],
    };
  }

  const node = resolved.node;
  const neighbors = await getNeighbors(store, { nodeId: node.id });
  const text = formatExplore({ node, neighbors }, args.detail);

  return {
    content: [{ type: 'text', text }],
  };
}
