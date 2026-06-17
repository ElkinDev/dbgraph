/**
 * Status formatter — task 4.3 (phase-4-cli-config).
 * Spec: cli-config "status reports counts, last snapshot and live drift"
 * Design: PURE, deterministic, golden-pinned CLI-only formatter (ADR-008).
 *   - Per-kind counts section
 *   - Last snapshot section (timestamp, engine, fingerprint, per-type counts)
 *   - Excluded count (when > 0)
 *   - DRIFT indicator (when live fingerprint !== stored fingerprint)
 *
 * No process.env / Date.now() / adapter imports — pure function of inputs.
 * ADR-004: CLI-only formatter; lives under src/cli/format/.
 */

import type { SnapshotRecord } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// StatusView — the input shape for formatStatus
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusView {
  /** Per-kind node counts from the current graph (getNodesByKind results). */
  readonly kindCounts: Readonly<Record<string, number>>;
  /** The most-recent snapshot, or null if no sync has been run. */
  readonly lastSnapshot: SnapshotRecord | null;
  /** Number of nodes excluded by filters (missing=1 OR excluded=1). */
  readonly excludedCount: number;
  /** True when the live fingerprint differs from the stored last-snapshot fingerprint. */
  readonly hasDrift: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatStatus — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a StatusView into a human-readable string.
 * Output is deterministic: same input → always same bytes (ADR-008).
 * No Date.now(), no process.env, no I/O — pure function.
 */
export function formatStatus(view: StatusView): string {
  const lines: string[] = [];

  // ── Section 1: Graph counts ──────────────────────────────────────────────
  lines.push('Graph');
  lines.push('─────');
  const kinds = Object.keys(view.kindCounts).sort();
  if (kinds.length === 0) {
    lines.push('  (empty — run sync first)');
  } else {
    for (const kind of kinds) {
      const count = view.kindCounts[kind] ?? 0;
      lines.push(`  ${kind.padEnd(14)} ${count}`);
    }
  }

  if (view.excludedCount > 0) {
    lines.push(`  excluded        ${view.excludedCount}`);
  }

  lines.push('');

  // ── Section 2: Last snapshot ─────────────────────────────────────────────
  lines.push('Last Snapshot');
  lines.push('─────────────');
  if (view.lastSnapshot === null) {
    lines.push('  never synced — run: dbgraph sync');
  } else {
    const snap = view.lastSnapshot;
    lines.push(`  taken        ${snap.takenAt}`);
    lines.push(`  engine       ${snap.engine}`);
    lines.push(`  fingerprint  ${snap.fingerprint}`);

    // Per-type counts from the snapshot
    const snapKinds = Object.keys(snap.counts).sort();
    if (snapKinds.length > 0) {
      lines.push('  counts:');
      for (const kind of snapKinds) {
        const count = snap.counts[kind] ?? 0;
        lines.push(`    ${kind.padEnd(12)} ${count}`);
      }
    }
  }

  lines.push('');

  // ── Section 3: Drift indicator ───────────────────────────────────────────
  if (view.hasDrift) {
    lines.push('DRIFT DETECTED — source schema has changed since last sync.');
    lines.push('  Run: dbgraph sync');
    lines.push('');
  }

  // Join lines with newline; ensure trailing newline for determinism
  return lines.join('\n') + '\n';
}
