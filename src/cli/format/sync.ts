/**
 * Sync summary formatter — task 2.1 (ux-observability).
 * Spec: cli-config "sync … MUST emit a final SUMMARY … produced by a PURE, deterministic,
 *   golden-pinnable formatter" (US-005 + US-004).
 * Design Decision D3: CLI-only presentation formatter; mirrors format/status.ts line shape
 *   (`lines[].join('\n') + '\n'`, sorted kinds). Home is src/cli/format/ (ADR-004) — core
 *   present/ is the MCP variant.
 * Design Decision D4: NO timing in the pinned body (ADR-008). Elapsed ms flows through the
 *   Logger seam, NEVER into this formatter — so the golden stays byte-deterministic.
 *
 * CONTENT-SAFETY (HARD): this formatter renders ONLY counts, per-kind totals, drift state,
 *   snapshot id and fingerprint — NEVER schema names, object identifiers, connection-string
 *   values, resolved secrets, or sampled data values. The caller (runSync) builds the view
 *   from count/id scalars only.
 *
 * No process.env, no Date.now(), no I/O — pure function of its input (ADR-008).
 */

// ─────────────────────────────────────────────────────────────────────────────
// SyncSummary — the input shape for formatSyncSummary (timing intentionally absent, D4)
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncSummary {
  /** How the sync resolved: full rebuild, incremental delta, or skipped (fingerprint match). */
  readonly mode: 'full' | 'incremental' | 'skipped';
  /** Per-kind node counts from the freshly-extracted graph (empty for skipped). */
  readonly counts: Readonly<Record<string, number>>;
  /** Number of nodes upserted by the applied delta. */
  readonly upserted: number;
  /** Number of nodes deleted by the applied delta. */
  readonly deleted: number;
  /** True when the stored fingerprint differed from the live fingerprint (drift resolved). */
  readonly hasDrift: boolean;
  /** The written snapshot's id (empty string for skipped). */
  readonly snapshotId: string;
  /** The live fingerprint (a content-free hash — safe to display). */
  readonly fingerprint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatSyncSummary — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/** Label column width — aligns values after the longest label ("fingerprint"). */
const LABEL_WIDTH = 13;
/** Per-kind count label width — mirrors format/status.ts snapshot counts. */
const KIND_WIDTH = 12;

/**
 * Formats a SyncSummary into a human-readable string.
 * Output is deterministic: same input → always the same bytes (ADR-008).
 * No Date.now(), no process.env, no I/O — pure function.
 */
export function formatSyncSummary(view: SyncSummary): string {
  const lines: string[] = [];

  lines.push('Sync Summary');
  lines.push('────────────');

  // ── Skipped path: fingerprint unchanged, nothing extracted ─────────────────
  if (view.mode === 'skipped') {
    lines.push('  already up to date — no changes since last snapshot');
    lines.push(`  ${'fingerprint'.padEnd(LABEL_WIDTH)}${view.fingerprint}`);
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Full / incremental path ────────────────────────────────────────────────
  lines.push(`  ${'mode'.padEnd(LABEL_WIDTH)}${view.mode}`);

  lines.push('  counts:');
  const kinds = Object.keys(view.counts).sort();
  if (kinds.length === 0) {
    lines.push('    (none)');
  } else {
    for (const kind of kinds) {
      const count = view.counts[kind] ?? 0;
      lines.push(`    ${kind.padEnd(KIND_WIDTH)} ${count}`);
    }
  }

  lines.push(`  ${'upserted'.padEnd(LABEL_WIDTH)}${view.upserted}`);
  lines.push(`  ${'deleted'.padEnd(LABEL_WIDTH)}${view.deleted}`);
  lines.push(`  ${'snapshot'.padEnd(LABEL_WIDTH)}${view.snapshotId}`);
  lines.push(`  ${'fingerprint'.padEnd(LABEL_WIDTH)}${view.fingerprint}`);
  lines.push('');

  if (view.hasDrift) {
    lines.push('DRIFT RESOLVED — source schema had changed since the previous snapshot.');
    lines.push('');
  }

  // Join lines with newline; ensure trailing newline for determinism (mirrors format/status.ts).
  return lines.join('\n') + '\n';
}
