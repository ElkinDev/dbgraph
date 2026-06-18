/**
 * formatStatus — task 1.7 (phase-5-mcp-server).
 * Spec: dbgraph_status index trust and live drift (connectionless half).
 * Design: PURE; McpStatusView; engine/version, last sync, per-type counts, configured levels,
 *   excluded objects, drift line ("could not be checked live" when no connection).
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (McpStatusView) → byte-identical string.
 *
 * This is the MCP variant of status, distinct from the CLI status formatter.
 *
 * --detail levels:
 *   brief  — engine/version + last sync timestamp
 *   normal — brief + per-type counts, configured levels
 *   full   — normal + excluded objects, drift detail
 */

import type { ObjectTypeLevels } from '../model/node.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The detail level for status output. */
export type StatusDetail = 'brief' | 'normal' | 'full';

/**
 * Input bundle for formatStatus — MCP variant.
 * Assembled by the caller from listSnapshots() + capabilitiesFor() + drift check.
 */
export interface McpStatusView {
  readonly engine: string;
  readonly engineVersion: string | undefined;
  readonly lastSync: string | null;       // ISO-8601 timestamp or null if never synced
  readonly counts: Readonly<Record<string, number>>;
  readonly levels: Readonly<Partial<ObjectTypeLevels>>;
  readonly excludedObjects: readonly string[];
  readonly driftChecked: boolean;         // true when live fingerprint was computed
  readonly driftDetected: boolean | null; // null when not checked
}

// ─────────────────────────────────────────────────────────────────────────────
// formatStatus — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a McpStatusView into a human-readable string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatStatus(view: McpStatusView, detail: StatusDetail): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('DBGRAPH STATUS');
  lines.push('─'.repeat(40));

  // ── Engine / version (all levels) ─────────────────────────────────────────
  const versionStr = view.engineVersion ? ` ${view.engineVersion}` : '';
  lines.push(`  Engine:     ${view.engine}${versionStr}`);

  // ── Last sync (all levels) ────────────────────────────────────────────────
  lines.push(`  Last sync:  ${view.lastSync ?? 'never'}`);

  // ── Drift line (all levels) ───────────────────────────────────────────────
  if (!view.driftChecked) {
    lines.push('  Drift:      could not be checked live (no connection)');
  } else if (view.driftDetected === true) {
    lines.push('  Drift:      detected (schema changed since last sync)');
  } else {
    lines.push('  Drift:      none detected');
  }

  if (detail === 'brief') {
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Per-type counts (normal + full) ───────────────────────────────────────
  const countKeys = Object.keys(view.counts).sort();
  if (countKeys.length > 0) {
    lines.push('');
    lines.push('  Object counts:');
    for (const key of countKeys) {
      const count = view.counts[key] ?? 0;
      if (count > 0) {
        lines.push(`    ${key.padEnd(18)}  ${count}`);
      }
    }
  }

  // ── Configured levels (normal + full) ─────────────────────────────────────
  const levelKeys = Object.keys(view.levels).sort();
  if (levelKeys.length > 0) {
    lines.push('');
    lines.push('  Index levels:');
    for (const key of levelKeys) {
      const level = view.levels[key as keyof ObjectTypeLevels];
      if (level !== undefined) {
        lines.push(`    ${key.padEnd(18)}  ${level}`);
      }
    }
  }

  if (detail === 'normal') {
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Excluded objects (full only) ──────────────────────────────────────────
  if (view.excludedObjects.length > 0) {
    lines.push('');
    lines.push('  Excluded objects:');
    for (const obj of [...view.excludedObjects].sort()) {
      lines.push(`    ${obj}`);
    }
  } else {
    lines.push('');
    lines.push('  Excluded objects:  (none)');
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
