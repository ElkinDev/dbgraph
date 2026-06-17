/**
 * RED→GREEN tests for src/cli/format/diff.ts (task 6.5, phase-4-cli-config).
 * Spec: cli-config "diff compares snapshots per object and is CI-gate usable"
 * Design: PURE, deterministic, golden-pinned formatter (ADR-008).
 *
 * formatDiff(result: DiffResult): string
 *   - Groups output by kind: ADDED / REMOVED / MODIFIED sections.
 *   - For MODIFIED, shows WHAT changed (body hash change).
 *   - "No changes" when all arrays are empty.
 *   - Deterministic — same input → always same bytes.
 *   - Pre-v2 graceful degradation: "no manifest" message.
 */

import { describe, it, expect } from 'vitest';
import { formatDiff } from '../../../src/cli/format/diff.js';
import type { DiffResult } from '../../../src/cli/diff/engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_DIFF: DiffResult = { added: [], removed: [], changed: [] };

const MIXED_DIFF: DiffResult = {
  added: [
    { nodeId: 'n4', kind: 'table',     qname: 'dbo.customers', bodyHash: 'h4' },
  ],
  removed: [
    { nodeId: 'n2', kind: 'view',      qname: 'dbo.v_old',     bodyHash: 'h2' },
  ],
  changed: [
    { nodeId: 'n3', kind: 'procedure', qname: 'dbo.sp_calc',   oldBodyHash: 'hash-old', newBodyHash: 'hash-new' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — no changes
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — no changes', () => {
  it('outputs "No changes" when diff is empty', () => {
    const output = formatDiff(EMPTY_DIFF);
    expect(output).toMatch(/no changes/i);
  });

  it('empty diff output ends with a newline', () => {
    const output = formatDiff(EMPTY_DIFF);
    expect(output.endsWith('\n')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — ADDED section
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — ADDED section', () => {
  it('includes ADDED section heading when items present', () => {
    const diff: DiffResult = {
      added: [{ nodeId: 'n1', kind: 'table', qname: 'dbo.orders', bodyHash: 'h1' }],
      removed: [],
      changed: [],
    };
    const output = formatDiff(diff);
    expect(output).toMatch(/added/i);
  });

  it('lists each added item with its kind and qname', () => {
    const diff: DiffResult = {
      added: [
        { nodeId: 'n1', kind: 'table',     qname: 'dbo.orders',    bodyHash: 'h1' },
        { nodeId: 'n2', kind: 'procedure', qname: 'dbo.sp_create', bodyHash: 'h2' },
      ],
      removed: [],
      changed: [],
    };
    const output = formatDiff(diff);
    expect(output).toContain('table');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('procedure');
    expect(output).toContain('dbo.sp_create');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — REMOVED section
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — REMOVED section', () => {
  it('includes REMOVED section heading when items present', () => {
    const diff: DiffResult = {
      added: [],
      removed: [{ nodeId: 'n1', kind: 'view', qname: 'dbo.v_old', bodyHash: null }],
      changed: [],
    };
    const output = formatDiff(diff);
    expect(output).toMatch(/removed/i);
  });

  it('lists each removed item with its kind and qname', () => {
    const diff: DiffResult = {
      added: [],
      removed: [
        { nodeId: 'n1', kind: 'view',    qname: 'dbo.v_archived', bodyHash: 'h1' },
        { nodeId: 'n2', kind: 'trigger', qname: 'dbo.trg_legacy',  bodyHash: null },
      ],
      changed: [],
    };
    const output = formatDiff(diff);
    expect(output).toContain('view');
    expect(output).toContain('dbo.v_archived');
    expect(output).toContain('trigger');
    expect(output).toContain('dbo.trg_legacy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — MODIFIED / CHANGED section
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — MODIFIED section', () => {
  it('includes MODIFIED section heading when items present', () => {
    const diff: DiffResult = {
      added: [],
      removed: [],
      changed: [
        { nodeId: 'n1', kind: 'procedure', qname: 'dbo.sp_calc', oldBodyHash: 'old', newBodyHash: 'new' },
      ],
    };
    const output = formatDiff(diff);
    expect(output).toMatch(/modified/i);
  });

  it('shows WHAT changed for modified items (body hash change)', () => {
    const diff: DiffResult = {
      added: [],
      removed: [],
      changed: [
        { nodeId: 'n1', kind: 'procedure', qname: 'dbo.sp_calc', oldBodyHash: 'hash-old', newBodyHash: 'hash-new' },
      ],
    };
    const output = formatDiff(diff);
    // Must mention the qname and kind
    expect(output).toContain('dbo.sp_calc');
    expect(output).toContain('procedure');
    // Must indicate the definition changed (body hash)
    expect(output.toLowerCase()).toMatch(/definition changed|body changed|hash/i);
  });

  it('shows kind, qname, and change description for each modified item', () => {
    const diff: DiffResult = {
      added: [],
      removed: [],
      changed: [
        { nodeId: 'n1', kind: 'table',     qname: 'dbo.orders',  oldBodyHash: 'o1', newBodyHash: 'n1' },
        { nodeId: 'n2', kind: 'procedure', qname: 'dbo.sp_calc', oldBodyHash: 'o2', newBodyHash: 'n2' },
      ],
    };
    const output = formatDiff(diff);
    expect(output).toContain('dbo.orders');
    expect(output).toContain('dbo.sp_calc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — mixed diff golden
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — mixed diff', () => {
  it('produces output containing all three sections for MIXED_DIFF', () => {
    const output = formatDiff(MIXED_DIFF);
    expect(output).toMatch(/added/i);
    expect(output).toMatch(/removed/i);
    expect(output).toMatch(/modified/i);
    expect(output).toContain('dbo.customers');
    expect(output).toContain('dbo.v_old');
    expect(output).toContain('dbo.sp_calc');
  });

  it('MIXED_DIFF output is deterministic (same input → same bytes)', () => {
    const r1 = formatDiff(MIXED_DIFF);
    const r2 = formatDiff(MIXED_DIFF);
    expect(r1).toBe(r2);
  });

  it('output ends with a newline', () => {
    const output = formatDiff(MIXED_DIFF);
    expect(output.endsWith('\n')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — golden pin (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — golden pin', () => {
  it('MIXED_DIFF golden matches expected output', () => {
    const output = formatDiff(MIXED_DIFF);
    // Golden: check key structural fragments
    // ADDED section
    expect(output).toMatch(/ADDED/);
    expect(output).toMatch(/table\s+dbo\.customers/);
    // REMOVED section
    expect(output).toMatch(/REMOVED/);
    expect(output).toMatch(/view\s+dbo\.v_old/);
    // MODIFIED section
    expect(output).toMatch(/MODIFIED/);
    expect(output).toMatch(/procedure\s+dbo\.sp_calc/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDiff — no-manifest graceful degradation
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDiff — no-manifest degradation', () => {
  it('formatDiffNoManifest returns a human-readable message', async () => {
    const { formatDiffNoManifest } = await import('../../../src/cli/format/diff.js');
    const output = formatDiffNoManifest('snap-A', 'snap-B');
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
    expect(output.toLowerCase()).toMatch(/manifest|re-sync|sync/i);
    expect(output.endsWith('\n')).toBe(true);
  });
});
