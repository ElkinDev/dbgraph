/**
 * dbgraph_impact tool handler — task 4.2 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_impact read/write blast radius; depth truncation + dynamic-SQL warn.
 * Design: getNodeByQName → resolveNode → getImpact → ImpactView → formatImpact.
 *   Node-id→qname resolver built from store.getNode.
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NODE_KINDS,
  getImpact,
  formatImpact,
  type GraphStore,
  type GraphNode,
  type NodeKind,
  type ImpactDetail,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface ImpactArgs {
  qname: string;
  depth: number;
  detail: ImpactDetail;
}

function parseArgs(raw: Record<string, unknown>): ImpactArgs {
  const qname = raw['qname'];
  if (typeof qname !== 'string' || qname.trim() === '') {
    throw new Error('dbgraph_impact: "qname" must be a non-empty string');
  }
  const rawDetail = raw['detail'];
  if (rawDetail !== undefined && rawDetail !== 'brief' && rawDetail !== 'normal' && rawDetail !== 'full') {
    throw new Error(`dbgraph_impact: "detail" must be brief, normal, or full (got "${String(rawDetail)}")`);
  }
  const detail: ImpactDetail = (rawDetail as ImpactDetail | undefined) ?? 'normal';
  const rawDepth = raw['depth'];
  const depth = typeof rawDepth === 'number' && rawDepth > 0 ? rawDepth : 3;
  return { qname: qname.trim(), depth, detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve target node (first match across all kinds)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveNode(store: GraphStore, qname: string): Promise<GraphNode | null> {
  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const node = await store.getNodeByQName(kind, qname);
    if (node !== null) return node;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// runImpactTool — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runImpactTool(
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

  const result = await getImpact(store, { nodeId: node.id, depth: args.depth });

  // Build a lazy node-id→qname resolver using store.getNode
  // We cache results to avoid repeated lookups for the same node id.
  const cache = new Map<string, string>([[node.id, node.qname]]);
  const resolve = async (id: string): Promise<string> => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const n = await store.getNode(id);
    const qname = n !== null ? n.qname : id;
    cache.set(id, qname);
    return qname;
  };

  // Pre-populate cache for all node ids in all chains (required by formatImpact sync API)
  const allIds = new Set<string>();
  for (const chain of [...result.readImpact, ...result.writeImpact]) {
    for (const id of chain.nodes) allIds.add(id);
  }
  // DOG-4 (D1 wiring): also pre-cache every degraded node id so the named block resolves
  // each degraded id to its qname (not a raw id) — a defensive guarantee for any degraded
  // id that is not otherwise surfaced in a read/write chain.
  for (const id of result.degradedNodeIds) allIds.add(id);
  await Promise.all([...allIds].map((id) => resolve(id)));

  // Build synchronous resolve function (all ids pre-cached)
  const resolveSync = (id: string): string => cache.get(id) ?? id;

  const text = formatImpact({ node, result, resolve: resolveSync }, args.detail);

  return {
    content: [{ type: 'text', text }],
  };
}
