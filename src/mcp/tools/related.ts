/**
 * dbgraph_related tool handler — task 3.3 (phase-5-mcp-server).
 * Spec: dbgraph_related grouped by edge kind and direction; kinds filter restricts.
 * Design: wraps getNeighbors + formatRelated; detail brief|normal|full.
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NODE_KINDS,
  getNeighbors,
  formatRelated,
  type GraphStore,
  type GraphNode,
  type NodeKind,
  type RelatedDetail,
  type EdgeKind,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface RelatedArgs {
  qname: string;
  kinds: EdgeKind[] | undefined;
  detail: RelatedDetail;
}

function parseArgs(raw: Record<string, unknown>): RelatedArgs {
  const qname = raw['qname'];
  if (typeof qname !== 'string' || qname.trim() === '') {
    throw new Error('dbgraph_related: "qname" must be a non-empty string');
  }

  const detail = raw['detail'] as RelatedDetail | undefined;
  if (detail !== undefined && detail !== 'brief' && detail !== 'normal' && detail !== 'full') {
    throw new Error(`dbgraph_related: "detail" must be brief, normal, or full (got "${detail}")`);
  }

  let kinds: EdgeKind[] | undefined;
  if (raw['kinds'] !== undefined) {
    if (!Array.isArray(raw['kinds'])) {
      throw new Error('dbgraph_related: "kinds" must be an array of strings');
    }
    kinds = (raw['kinds'] as unknown[]).map((k) => {
      if (typeof k !== 'string') {
        throw new Error(`dbgraph_related: "kinds" elements must be strings (got ${typeof k})`);
      }
      return k as EdgeKind;
    });
  }

  return { qname: qname.trim(), kinds, detail: detail ?? 'normal' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve node across all kinds
// ─────────────────────────────────────────────────────────────────────────────

async function resolveNode(store: GraphStore, qname: string): Promise<GraphNode | null> {
  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const node = await store.getNodeByQName(kind, qname);
    if (node !== null) return node;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// runRelatedTool — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runRelatedTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);
  const node = await resolveNode(store, args.qname);

  if (node === null) {
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

  const neighborQuery = args.kinds !== undefined
    ? { nodeId: node.id, kinds: args.kinds }
    : { nodeId: node.id };
  const neighbors = await getNeighbors(store, neighborQuery);

  const text = formatRelated({ node, neighbors }, args.detail);

  return {
    content: [{ type: 'text', text }],
  };
}
