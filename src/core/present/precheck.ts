/**
 * formatPrecheck — task 1.8 (phase-5-mcp-server).
 * Spec: dbgraph_precheck aggregates DDL impact (format half).
 * Design: PURE; PrecheckView; matched objects + aggregated impact sections
 *   (triggers/writers/readers/constraints+indexes/what-to-test), confidence:'parsed' tags,
 *   unmatched-identifier section.
 *
 * ADR-004: imports ONLY core model/port types — NO adapters, NO cli, NO mcp, NO drivers.
 * ADR-008: deterministic output — same (PrecheckView, PrecheckDetail) → byte-identical string.
 *
 * --detail levels:
 *   brief  — matched objects list only
 *   normal — brief + aggregated impact sections
 *   full   — normal + confidence tags, unmatched identifiers
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The detail level for precheck output. */
export type PrecheckDetail = 'brief' | 'normal' | 'full';

/** An item in the precheck result — carries confidence and kind. */
export interface PrecheckItem {
  readonly qname: string;
  readonly kind: string;
  readonly confidence: 'parsed';
  /**
   * DOG-4 (r2): degradation marker — PRESENT (`true`) ONLY on an item whose subject
   * routine carries `hasDynamicSql`, OMITTED otherwise (degrade-by-absence,
   * `exactOptionalPropertyTypes`-clean). The `--json` key is additive; consumers MUST
   * treat absence as false. Orthogonal to `confidence` (no new tier).
   */
  readonly hasDynamicSql?: true;
}

/**
 * Aggregated impact section for precheck output.
 */
export interface PrecheckImpactSection {
  readonly triggers: readonly PrecheckItem[];
  readonly writers: readonly PrecheckItem[];
  readonly readers: readonly PrecheckItem[];
  readonly constraintsAndIndexes: readonly PrecheckItem[];
  readonly whatToTest: readonly string[];
}

/**
 * Input bundle for formatPrecheck.
 * Assembled by the caller from DDL extraction + graph lookup + getImpact aggregation.
 */
export interface PrecheckView {
  readonly matchedObjects: readonly PrecheckItem[];
  readonly impact: PrecheckImpactSection;
  readonly unmatchedIdentifiers: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// formatPrecheck — PURE deterministic formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a PrecheckView into a human-readable string at the requested detail level.
 *
 * Output contract (ADR-008):
 *   - Same (view, detail) → always the SAME bytes
 *   - Trailing newline guaranteed
 *   - No Date.now(), no process.env, no I/O
 */
export function formatPrecheck(view: PrecheckView, detail: PrecheckDetail): string {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('DDL PRECHECK');
  lines.push('─'.repeat(40));

  // ── Matched objects (all levels) ──────────────────────────────────────────
  lines.push('');
  lines.push('MATCHED OBJECTS');
  if (view.matchedObjects.length === 0) {
    lines.push('  (none matched)');
  } else {
    const sorted = [...view.matchedObjects].sort((a, b) => a.qname.localeCompare(b.qname));
    for (const item of sorted) {
      if (detail === 'full') {
        lines.push(`  [${item.kind}]  ${item.qname}  (confidence: ${item.confidence})`);
      } else {
        lines.push(`  [${item.kind}]  ${item.qname}`);
      }
    }
  }

  if (detail === 'brief') {
    lines.push('');
    return lines.join('\n') + '\n';
  }

  // ── Impact sections (normal + full) ───────────────────────────────────────
  const { impact } = view;

  // Triggers
  if (impact.triggers.length > 0) {
    lines.push('');
    lines.push('TRIGGERS FIRING ON AFFECTED OBJECTS');
    const sorted = [...impact.triggers].sort((a, b) => a.qname.localeCompare(b.qname));
    for (const item of sorted) {
      if (detail === 'full') {
        lines.push(`  [${item.kind}]  ${item.qname}  (confidence: ${item.confidence})`);
      } else {
        lines.push(`  [${item.kind}]  ${item.qname}`);
      }
    }
  }

  // Writers
  if (impact.writers.length > 0) {
    lines.push('');
    lines.push('WRITERS');
    const sorted = [...impact.writers].sort((a, b) => a.qname.localeCompare(b.qname));
    for (const item of sorted) {
      if (detail === 'full') {
        lines.push(`  [${item.kind}]  ${item.qname}  (confidence: ${item.confidence})`);
      } else {
        lines.push(`  [${item.kind}]  ${item.qname}`);
      }
    }
  }

  // Readers
  if (impact.readers.length > 0) {
    lines.push('');
    lines.push('READERS');
    const sorted = [...impact.readers].sort((a, b) => a.qname.localeCompare(b.qname));
    for (const item of sorted) {
      if (detail === 'full') {
        lines.push(`  [${item.kind}]  ${item.qname}  (confidence: ${item.confidence})`);
      } else {
        lines.push(`  [${item.kind}]  ${item.qname}`);
      }
    }
  }

  // Constraints and indexes
  if (impact.constraintsAndIndexes.length > 0) {
    lines.push('');
    lines.push('CONSTRAINTS AND INDEXES AFFECTED');
    const sorted = [...impact.constraintsAndIndexes].sort((a, b) => a.qname.localeCompare(b.qname));
    for (const item of sorted) {
      if (detail === 'full') {
        lines.push(`  [${item.kind}]  ${item.qname}  (confidence: ${item.confidence})`);
      } else {
        lines.push(`  [${item.kind}]  ${item.qname}`);
      }
    }
  }

  // What to test
  if (impact.whatToTest.length > 0) {
    lines.push('');
    lines.push('WHAT TO TEST');
    const sorted = [...impact.whatToTest].sort();
    for (const item of sorted) {
      lines.push(`  - ${item}`);
    }
  }

  // ── Unmatched identifiers (full only) ─────────────────────────────────────
  if (detail === 'full') {
    lines.push('');
    lines.push('UNMATCHED IDENTIFIERS');
    if (view.unmatchedIdentifiers.length === 0) {
      lines.push('  (none)');
    } else {
      const sorted = [...view.unmatchedIdentifiers].sort();
      for (const id of sorted) {
        lines.push(`  ${id}  (no matching graph node)`);
      }
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}
