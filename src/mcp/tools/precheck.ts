/**
 * dbgraph_precheck tool handler — task 4.4 / Batch D (phase-5-mcp-server).
 * Spec: ALTER + DROP INDEX DDL returns aggregated, deduped precheck.
 *       Non-matchable identifiers reported as unmatched, never guessed.
 * Design: calls src/core/precheck/ engine (runPrecheck) + formatPrecheck.
 *   The precheck CORE lives in src/core/precheck/ — neutral module consumed
 *   by BOTH this MCP tool AND src/cli/commands/affected.ts via the barrel.
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 * NEVER src/adapters/** or src/cli/**.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  runPrecheck,
  formatPrecheck,
  type GraphStore,
  type PrecheckDetail,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface PrecheckArgs {
  ddl: string;
  detail: PrecheckDetail;
}

function parseArgs(raw: Record<string, unknown>): PrecheckArgs {
  const ddl = raw['ddl'];
  if (typeof ddl !== 'string') {
    throw new Error('dbgraph_precheck: "ddl" must be a string');
  }
  const rawDetail = raw['detail'];
  if (rawDetail !== undefined && rawDetail !== 'brief' && rawDetail !== 'normal' && rawDetail !== 'full') {
    throw new Error(`dbgraph_precheck: "detail" must be brief, normal, or full (got "${String(rawDetail)}")`);
  }
  const detail: PrecheckDetail = (rawDetail as PrecheckDetail | undefined) ?? 'normal';
  return { ddl, detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// runPrecheckTool — main handler called by the server
// ─────────────────────────────────────────────────────────────────────────────

export async function runPrecheckTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);

  // Delegate to the core precheck engine (neutral module, lives in src/core/precheck/)
  const view = await runPrecheck(store, args.ddl);

  const text = formatPrecheck(view, args.detail);

  return {
    content: [{ type: 'text', text }],
  };
}
