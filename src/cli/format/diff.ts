/**
 * Diff formatter — task 6.5 (phase-4-cli-config).
 * Spec: cli-config "diff compares snapshots per object and is CI-gate usable"
 * Design: PURE, deterministic, golden-pinned CLI-only formatter (ADR-008).
 *
 * Sections: ADDED / REMOVED / MODIFIED grouped by kind.
 * MODIFIED entries state WHAT changed (definition changed by body hash).
 * "No changes detected." when all arrays empty.
 *
 * No process.env / Date.now() / adapter imports — pure function of inputs.
 * ADR-004: CLI-only formatter; lives under src/cli/format/.
 */

import type { DiffResult, DiffAddedRow, DiffRemovedRow, DiffChangedRow } from '../diff/engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a DiffResult into a human-readable string.
 * Sections: ADDED, REMOVED, MODIFIED — each sorted by kind then qname.
 * Output is deterministic: same input → always same bytes (ADR-008).
 */
export function formatDiff(result: DiffResult): string {
  const { added, removed, changed } = result;

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return 'No changes detected.\n';
  }

  const lines: string[] = [];

  if (added.length > 0) {
    lines.push('ADDED');
    lines.push('─────');
    const sorted = [...added].sort(compareByKindThenQname);
    for (const row of sorted) {
      lines.push(`  + ${row.kind.padEnd(14)} ${row.qname}`);
    }
    lines.push('');
  }

  if (removed.length > 0) {
    lines.push('REMOVED');
    lines.push('───────');
    const sorted = [...removed].sort(compareByKindThenQname);
    for (const row of sorted) {
      lines.push(`  - ${row.kind.padEnd(14)} ${row.qname}`);
    }
    lines.push('');
  }

  if (changed.length > 0) {
    lines.push('MODIFIED');
    lines.push('────────');
    const sorted = [...changed].sort(compareByKindThenQname);
    for (const row of sorted) {
      const what = describeChange(row);
      lines.push(`  ~ ${row.kind.padEnd(14)} ${row.qname}`);
      lines.push(`      ${what}`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

/**
 * Graceful degradation message for pre-v2 snapshots with no manifest.
 * Called by the diff command when one or both manifests are empty and
 * the snapshot pre-dates the v2 schema (no snapshot_objects rows).
 */
export function formatDiffNoManifest(snapA: string, snapB: string): string {
  return (
    `No per-object manifest found for snapshots "${snapA}" / "${snapB}".\n` +
    `These snapshots were recorded before the v2 schema index.\n` +
    `Run: dbgraph sync to record a new snapshot, then diff again.\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function compareByKindThenQname(
  a: { kind: string; qname: string },
  b: { kind: string; qname: string },
): number {
  const kindCmp = a.kind.localeCompare(b.kind);
  return kindCmp !== 0 ? kindCmp : a.qname.localeCompare(b.qname);
}

function describeChange(row: DiffChangedRow): string {
  // At the manifest granularity, we only know the body_hash changed.
  // This satisfies the spec: "definition changed (hash)" is the correct
  // description when no deeper column-level diff is available.
  const oldHash = row.oldBodyHash ?? '(null)';
  const newHash = row.newBodyHash ?? '(null)';
  return `definition changed (hash: ${oldHash.slice(0, 8)}… → ${newHash.slice(0, 8)}…)`;
}

// Re-export row types for consumers who want them without importing the engine directly
export type { DiffAddedRow, DiffRemovedRow, DiffChangedRow };
