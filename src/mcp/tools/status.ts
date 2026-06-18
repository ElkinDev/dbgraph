/**
 * dbgraph_status tool handler — task 3.5 (phase-5-mcp-server).
 * Spec: dbgraph_status index trust and live drift (connectionless golden).
 * Design: composes listSnapshots + per-type counts + capabilitiesFor + formatStatus.
 *   Connectionless path states drift not checked live.
 *   Live-fingerprint drift variant is integration-only (task 3.6, DBGRAPH_INTEGRATION=1).
 *
 * ADR-004: imports ONLY from barrel (src/index.ts) + @modelcontextprotocol/sdk.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  NODE_KINDS,
  capabilitiesFor,
  formatStatus,
  type GraphStore,
  type NodeKind,
  type StatusDetail,
  type McpStatusView,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input args type
// ─────────────────────────────────────────────────────────────────────────────

interface StatusArgs {
  detail: StatusDetail;
}

function parseArgs(raw: Record<string, unknown>): StatusArgs {
  const detail = raw['detail'] as StatusDetail | undefined;
  if (detail !== undefined && detail !== 'brief' && detail !== 'normal' && detail !== 'full') {
    throw new Error(`dbgraph_status: "detail" must be brief, normal, or full (got "${detail}")`);
  }
  return { detail: detail ?? 'normal' };
}

// ─────────────────────────────────────────────────────────────────────────────
// runStatusTool — main handler called by the server (connectionless variant)
// ─────────────────────────────────────────────────────────────────────────────

export async function runStatusTool(
  store: GraphStore,
  rawArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const args = parseArgs(rawArgs);

  // ── Step 1: last snapshot ─────────────────────────────────────────────────
  const snapshots = await store.listSnapshots();
  const lastSnapshot = snapshots.length > 0 ? (snapshots[0] ?? null) : null;

  // ── Step 2: per-type counts from store (non-excluded, non-missing nodes) ──
  const counts: Record<string, number> = {};
  const excludedObjects: string[] = [];

  for (const kind of NODE_KINDS as readonly NodeKind[]) {
    const nodes = await store.getNodesByKind(kind);
    for (const node of nodes) {
      if (node.excluded) {
        excludedObjects.push(node.qname);
      } else if (!node.missing) {
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  }

  // ── Step 3: capability matrix for configured levels ───────────────────────
  const engine = lastSnapshot?.engine ?? 'unknown';
  let levels: McpStatusView['levels'] = {};
  try {
    const matrix = capabilitiesFor(engine);
    levels = matrix.defaultLevels;
  } catch {
    // Unknown dialect — levels stay empty ({} already set)
  }

  // ── Step 4: assemble McpStatusView (connectionless — drift not checked) ───
  const view: McpStatusView = {
    engine: lastSnapshot?.engine ?? 'unknown',
    engineVersion: lastSnapshot?.engineVersion,
    lastSync: lastSnapshot?.takenAt ?? null,
    counts,
    levels,
    excludedObjects: [...excludedObjects].sort(),
    driftChecked: false,
    driftDetected: null,
  };

  const text = formatStatus(view, args.detail);

  return {
    content: [{ type: 'text', text }],
  };
}
