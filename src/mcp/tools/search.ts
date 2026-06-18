/**
 * dbgraph_search tool handler — task 3.2 (phase-5-mcp-server).
 * Spec: dbgraph_search ranked paginated hits; Pagination offset/limit/hasMore.
 * Design: wraps search + formatSearch; detail brief|normal|full.
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  search,
  formatSearch,
  type GraphStore,
  type SearchDetail,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;

interface SearchArgs {
  query: string;
  offset: number;
  limit: number;
  detail: SearchDetail;
}

function parseArgs(raw: Record<string, unknown>): SearchArgs {
  const query = raw['query'];
  if (typeof query !== 'string' || query.trim() === '') {
    throw new Error('dbgraph_search: "query" must be a non-empty string');
  }

  const offset = raw['offset'] !== undefined ? Number(raw['offset']) : 0;
  const limit = raw['limit'] !== undefined ? Number(raw['limit']) : DEFAULT_LIMIT;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`dbgraph_search: "offset" must be a non-negative integer (got "${raw['offset']}")`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`dbgraph_search: "limit" must be a positive integer (got "${raw['limit']}")`);
  }

  const detail = raw['detail'] as SearchDetail | undefined;
  if (detail !== undefined && detail !== 'brief' && detail !== 'normal' && detail !== 'full') {
    throw new Error(`dbgraph_search: "detail" must be brief, normal, or full (got "${detail}")`);
  }

  return {
    query: query.trim(),
    offset,
    limit,
    detail: detail ?? 'normal',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runSearchTool — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runSearchTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);

  const result = await search(store, {
    term: args.query,
    offset: args.offset,
    limit: args.limit,
  });

  const text = formatSearch(
    {
      hits: result.hits,
      total: result.total,
      offset: args.offset,
      limit: args.limit,
    },
    args.detail,
  );

  return {
    content: [{ type: 'text', text }],
  };
}
