/**
 * dbgraph_path tool handler — task 3.4 (phase-5-mcp-server).
 * Spec: dbgraph_path shortest join path or suggests neighbors; No route reports neighbors.
 * Design: wraps findJoinPath + formatPath; declared/parsed references edges only (inferred deferred to Phase 9).
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NODE_KINDS,
  findJoinPath,
  formatPath,
  type GraphStore,
  type GraphNode,
  type NodeKind,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface PathArgs {
  from: string;
  to: string;
}

function parseArgs(raw: Record<string, unknown>): PathArgs {
  const from = raw['from'];
  const to = raw['to'];

  if (typeof from !== 'string' || from.trim() === '') {
    throw new Error('dbgraph_path: "from" must be a non-empty string');
  }
  if (typeof to !== 'string' || to.trim() === '') {
    throw new Error('dbgraph_path: "to" must be a non-empty string');
  }

  return { from: from.trim(), to: to.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve node across all kinds (tables only for path, but try all for error quality)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveNode(store: GraphStore, qname: string): Promise<GraphNode | null> {
  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const node = await store.getNodeByQName(kind, qname);
    if (node !== null) return node;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// runPathTool — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runPathTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);

  const fromNode = await resolveNode(store, args.from);
  const toNode = await resolveNode(store, args.to);

  if (fromNode === null) {
    return {
      content: [
        {
          type: 'text',
          text: `[NOT_FOUND] No object named "${args.from}" found in the graph.`,
        },
      ],
      isError: true,
    };
  }
  if (toNode === null) {
    return {
      content: [
        {
          type: 'text',
          text: `[NOT_FOUND] No object named "${args.to}" found in the graph.`,
        },
      ],
      isError: true,
    };
  }

  const result = await findJoinPath(store, {
    from: fromNode.id,
    to: toNode.id,
    allowInferred: false,
  });

  // Build a node id → qname resolver using the nodes we fetched + lazy store calls for hops
  const nodeCache = new Map<string, string>([
    [fromNode.id, fromNode.qname],
    [toNode.id, toNode.qname],
  ]);

  const resolveTable = (id: string): string => {
    const cached = nodeCache.get(id);
    if (cached !== undefined) return cached;
    // Synchronous fallback: should not be needed because hops are subsets of the resolved path
    return id;
  };

  // Pre-populate cache with hop nodes (async, so we do it before calling formatPath)
  if (result.found && result.hops !== undefined) {
    for (const hop of result.hops) {
      for (const id of [hop.fromTable, hop.toTable]) {
        if (!nodeCache.has(id)) {
          const node = await store.getNode(id);
          if (node !== null) nodeCache.set(id, node.qname);
        }
      }
    }
  }

  // Also pre-populate nearest neighbors for no-route case
  if (!result.found && result.nearest !== undefined) {
    for (const id of [...result.nearest.from, ...result.nearest.to]) {
      if (!nodeCache.has(id)) {
        const node = await store.getNode(id);
        if (node !== null) nodeCache.set(id, node.qname);
      }
    }
  }

  // Build PathResult with qnames in nearest (formatPath passes nearest ids to resolveTable)
  const text = formatPath({
    from: fromNode.qname,
    to: toNode.qname,
    result,
    resolveTable,
  });

  return {
    content: [{ type: 'text', text }],
  };
}
