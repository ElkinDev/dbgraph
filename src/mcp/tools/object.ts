/**
 * dbgraph_object tool handler — task 4.1 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_object assembles full detail via multiple store reads.
 * Design: getNodeByQName → getNeighbors over has_column/has_index/has_constraint/fires_on
 *   → ObjectView → formatObject; metadata states body omitted; ambiguous qname → candidates.
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 * Never src/adapters/** or src/cli/**.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NODE_KINDS,
  getNeighbors,
  formatObject,
  type GraphStore,
  type GraphNode,
  type NodeKind,
  type ObjectDetail,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface ObjectArgs {
  qname: string;
  detail: ObjectDetail;
}

function parseArgs(raw: Record<string, unknown>): ObjectArgs {
  const qname = raw['qname'];
  if (typeof qname !== 'string' || qname.trim() === '') {
    throw new Error('dbgraph_object: "qname" must be a non-empty string');
  }
  const rawDetail = raw['detail'];
  if (rawDetail !== undefined && rawDetail !== 'brief' && rawDetail !== 'normal' && rawDetail !== 'full') {
    throw new Error(`dbgraph_object: "detail" must be brief, normal, or full (got "${String(rawDetail)}")`);
  }
  const detail: ObjectDetail = (rawDetail as ObjectDetail | undefined) ?? 'normal';
  return { qname: qname.trim(), detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve target to a single node (or return disambiguation candidates)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveNode(
  store: GraphStore,
  qname: string,
): Promise<{ node: GraphNode } | { candidates: GraphNode[] } | { notFound: true }> {
  const matches: GraphNode[] = [];

  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const node = await store.getNodeByQName(kind, qname);
    if (node !== null) {
      matches.push(node);
    }
  }

  // Prefer a REAL node over a phantom stub minted for the same qname (design D3),
  // so a view targeted by an INSTEAD OF trigger resolves to the view, not the stub.
  const real = matches.filter((n) => !n.missing);
  const effective = real.length > 0 ? real : matches;

  if (effective.length === 0) {
    return { notFound: true };
  }
  if (effective.length === 1 && effective[0] !== undefined) {
    return { node: effective[0] };
  }
  return { candidates: effective };
}

// ─────────────────────────────────────────────────────────────────────────────
// runObjectTool — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runObjectTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);
  const resolved = await resolveNode(store, args.qname);

  if ('notFound' in resolved) {
    return {
      content: [
        {
          type: 'text',
          text: `[NOT_FOUND] No object named "${args.qname}" found in the graph.`,
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
          text: `Ambiguous name "${args.qname}" — please qualify with schema:\n${names}\n`,
        },
      ],
    };
  }

  const node = resolved.node;

  // Fetch ALL neighbors — formatObject filters by edge kind internally
  const neighbors = await getNeighbors(store, { nodeId: node.id });

  const text = formatObject({ node, neighbors }, args.detail);

  return {
    content: [{ type: 'text', text }],
  };
}
