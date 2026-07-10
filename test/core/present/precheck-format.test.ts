/**
 * Tests for src/core/present/precheck.ts — task 1.8 (phase-5-mcp-server).
 * Spec: dbgraph_precheck aggregates DDL impact (format half).
 * Design: formatPrecheck(PrecheckView) PURE; matched objects + aggregated impact sections
 *   (triggers/writers/readers/constraints+indexes/what-to-test), confidence:'parsed' tags,
 *   unmatched-identifier section.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPrecheck,
  type PrecheckView,
  type PrecheckDetail,
} from '../../../src/core/present/precheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FULL_VIEW: PrecheckView = {
  matchedObjects: [
    { qname: 'dbo.orders', kind: 'table', confidence: 'parsed' },
    { qname: 'dbo.IX_orders_status', kind: 'index', confidence: 'parsed' },
  ],
  impact: {
    triggers: [
      { qname: 'dbo.trg_orders_audit', kind: 'trigger', confidence: 'parsed' },
    ],
    writers: [
      { qname: 'dbo.usp_ProcessOrder', kind: 'procedure', confidence: 'parsed' },
    ],
    readers: [
      { qname: 'dbo.order_summary', kind: 'view', confidence: 'parsed' },
      { qname: 'dbo.usp_GetOrders', kind: 'procedure', confidence: 'parsed' },
    ],
    constraintsAndIndexes: [
      { qname: 'dbo.PK_orders', kind: 'constraint', confidence: 'parsed' },
    ],
    whatToTest: [
      'Test trigger dbo.trg_orders_audit fires correctly after DDL change',
      'Verify dbo.order_summary view returns expected results',
    ],
  },
  unmatchedIdentifiers: ['dbo.nonexistent_table', 'ix_unknown'],
};

const MINIMAL_VIEW: PrecheckView = {
  matchedObjects: [
    { qname: 'dbo.orders', kind: 'table', confidence: 'parsed' },
  ],
  impact: {
    triggers: [],
    writers: [],
    readers: [],
    constraintsAndIndexes: [],
    whatToTest: [],
  },
  unmatchedIdentifiers: [],
};

const EMPTY_VIEW: PrecheckView = {
  matchedObjects: [],
  impact: {
    triggers: [],
    writers: [],
    readers: [],
    constraintsAndIndexes: [],
    whatToTest: [],
  },
  unmatchedIdentifiers: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — content', () => {
  it('includes matched objects section', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).toContain('MATCHED OBJECTS');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('dbo.IX_orders_status');
  });

  it('normal: includes triggers section when triggers exist', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).toContain('TRIGGERS');
    expect(output).toContain('dbo.trg_orders_audit');
  });

  it('normal: includes writers section', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).toContain('WRITERS');
    expect(output).toContain('dbo.usp_ProcessOrder');
  });

  it('normal: includes readers section', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).toContain('READERS');
    expect(output).toContain('dbo.order_summary');
  });

  it('normal: includes constraints and indexes section', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).toContain('CONSTRAINTS AND INDEXES');
    expect(output).toContain('dbo.PK_orders');
  });

  it('normal: includes what-to-test section', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).toContain('WHAT TO TEST');
    expect(output).toContain('trigger');
  });

  it('shows (none matched) when matchedObjects is empty', () => {
    const output = formatPrecheck(EMPTY_VIEW, 'normal');
    expect(output).toContain('(none matched)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confidence tags
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — confidence tags', () => {
  it('full: shows confidence:parsed tags', () => {
    const output = formatPrecheck(FULL_VIEW, 'full');
    expect(output).toContain('confidence: parsed');
  });

  it('normal: does NOT show confidence tags (only full shows them)', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).not.toContain('confidence: parsed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unmatched identifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — unmatched identifiers', () => {
  it('full: includes unmatched identifiers section', () => {
    const output = formatPrecheck(FULL_VIEW, 'full');
    expect(output).toContain('UNMATCHED IDENTIFIERS');
    expect(output).toContain('dbo.nonexistent_table');
    expect(output).toContain('ix_unknown');
  });

  it('full: shows (none) when no unmatched identifiers', () => {
    const output = formatPrecheck(MINIMAL_VIEW, 'full');
    expect(output).toContain('UNMATCHED IDENTIFIERS');
    expect(output).toContain('(none)');
  });

  it('normal: does NOT include unmatched identifiers section', () => {
    const output = formatPrecheck(FULL_VIEW, 'normal');
    expect(output).not.toContain('UNMATCHED IDENTIFIERS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Brief detail
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — brief detail', () => {
  it('brief: shows matched objects', () => {
    const output = formatPrecheck(FULL_VIEW, 'brief');
    expect(output).toContain('dbo.orders');
  });

  it('brief: does NOT show impact sections', () => {
    const output = formatPrecheck(FULL_VIEW, 'brief');
    expect(output).not.toContain('TRIGGERS');
    expect(output).not.toContain('WRITERS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity contract
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — purity contract', () => {
  it('returns a string ending with a newline', () => {
    const levels: PrecheckDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(formatPrecheck(FULL_VIEW, level)).toMatch(/\n$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — determinism (ADR-008)', () => {
  const levels: PrecheckDetail[] = ['brief', 'normal', 'full'];
  for (const level of levels) {
    it(`same input → byte-identical output (${level})`, () => {
      const run1 = formatPrecheck(FULL_VIEW, level);
      const run2 = formatPrecheck(FULL_VIEW, level);
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPrecheck — goldens', () => {
  const levels: PrecheckDetail[] = ['brief', 'normal', 'full'];

  for (const level of levels) {
    it(`${level} output matches golden`, () => {
      const actual = formatPrecheck(FULL_VIEW, level);
      const goldenPath = join(goldenDir, `precheck-${level}.txt`);
      const golden = readFileSync(goldenPath, 'utf-8');
      expect(actual).toBe(golden);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOG-4 (task 6.1) — per-node [DYNAMIC SQL] suffix on degraded precheck items.
// The two-space-separated marker is appended AFTER the (confidence: …) suffix (r2),
// gated detail !== 'brief'. The brief matched-objects list stays byte-identical (no
// suffix). Non-degraded items carry no suffix; confidence stays 'parsed'. L-009 exact.
// ─────────────────────────────────────────────────────────────────────────────

const DYN_VIEW: PrecheckView = {
  matchedObjects: [
    { qname: 'acme.run_report', kind: 'procedure', confidence: 'parsed', hasDynamicSql: true },
    { qname: 'acme.touch_totals', kind: 'procedure', confidence: 'parsed' },
  ],
  impact: {
    triggers: [],
    writers: [],
    readers: [{ qname: 'acme.fn_exec_stmt', kind: 'function', confidence: 'parsed', hasDynamicSql: true }],
    constraintsAndIndexes: [],
    whatToTest: [],
  },
  unmatchedIdentifiers: [],
};

/** Same view with the degradation flags stripped — the brief byte-identity baseline. */
const DYN_VIEW_PLAIN: PrecheckView = {
  matchedObjects: [
    { qname: 'acme.run_report', kind: 'procedure', confidence: 'parsed' },
    { qname: 'acme.touch_totals', kind: 'procedure', confidence: 'parsed' },
  ],
  impact: {
    triggers: [],
    writers: [],
    readers: [{ qname: 'acme.fn_exec_stmt', kind: 'function', confidence: 'parsed' }],
    constraintsAndIndexes: [],
    whatToTest: [],
  },
  unmatchedIdentifiers: [],
};

describe('formatPrecheck — dynamic-SQL marker (DOG-4 task 6.1)', () => {
  it('POSITIVE: normal appends the marker after the item (matched + reader)', () => {
    const out = formatPrecheck(DYN_VIEW, 'normal');
    expect(out).toContain('  [procedure]  acme.run_report  [DYNAMIC SQL]');
    expect(out).toContain('  [function]  acme.fn_exec_stmt  [DYNAMIC SQL]');
  });

  it('POSITIVE: full appends the marker AFTER the (confidence: …) suffix', () => {
    const out = formatPrecheck(DYN_VIEW, 'full');
    expect(out).toContain('  [procedure]  acme.run_report  (confidence: parsed)  [DYNAMIC SQL]');
    expect(out).toContain('  [function]  acme.fn_exec_stmt  (confidence: parsed)  [DYNAMIC SQL]');
  });

  it('NEGATIVE: a non-degraded item carries NO marker', () => {
    const normal = formatPrecheck(DYN_VIEW, 'normal');
    expect(normal).toContain('  [procedure]  acme.touch_totals');
    expect(normal).not.toContain('acme.touch_totals  [DYNAMIC SQL]');
    const full = formatPrecheck(DYN_VIEW, 'full');
    expect(full).not.toContain('acme.touch_totals  (confidence: parsed)  [DYNAMIC SQL]');
  });

  it('NEGATIVE: brief matched-objects list is byte-identical (NO suffix)', () => {
    expect(formatPrecheck(DYN_VIEW, 'brief')).not.toContain('[DYNAMIC SQL]');
    // byte-identical to the flag-stripped baseline — the marker never leaks into brief
    expect(formatPrecheck(DYN_VIEW, 'brief')).toBe(formatPrecheck(DYN_VIEW_PLAIN, 'brief'));
  });

  it('degraded items still tagged confidence: parsed (marker is orthogonal)', () => {
    for (const item of [...DYN_VIEW.matchedObjects, ...DYN_VIEW.impact.readers]) {
      expect(item.confidence).toBe('parsed');
    }
  });

  it('the marker is a suffix on the item line, never a standalone edge line', () => {
    const out = formatPrecheck(DYN_VIEW, 'normal');
    const standalone = out.split('\n').some((l) => l.trim() === '[DYNAMIC SQL]');
    expect(standalone).toBe(false);
  });
});
