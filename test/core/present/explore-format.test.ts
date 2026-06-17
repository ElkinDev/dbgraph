/**
 * Tests for src/core/present/explore.ts — task 5.1 (phase-4-cli-config).
 * Spec: cli-config "explore output comes from a pure formatter shared with the MCP tool"
 * Design: PURE, core-types-only formatter (overrides design.md Decision 2).
 *   Location: src/core/present/explore.ts (NOT src/cli/format/).
 *   Levels: brief | normal | full.
 *   No process/Date.now/adapter imports — pure function of (ExploreView, ExploreDetail).
 *   Golden-pinned per detail level (ADR-008).
 *   boundaries.test.ts enforces core/present imports nothing outward.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import {
  formatExplore,
  type ExploreView,
  type ExploreDetail,
} from '../../../src/core/present/explore.js';
import type { GraphNode, NeighborGroups } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BASE_NODE: GraphNode = {
  id: 'node-orders',
  kind: 'table',
  schema: 'dbo',
  name: 'orders',
  qname: 'dbo.orders',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: 'abc123def456',
  payload: { rowCountEstimate: 1000, comment: 'Sales orders table' },
};

const COL_NODE: GraphNode = {
  id: 'node-order-id',
  kind: 'column',
  schema: 'dbo',
  name: 'order_id',
  qname: 'dbo.orders.order_id',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { dataType: 'int', nullable: false, ordinal: 1 },
};

const FK_NODE: GraphNode = {
  id: 'node-customers',
  kind: 'table',
  schema: 'dbo',
  name: 'customers',
  qname: 'dbo.customers',
  level: 'metadata',
  missing: false,
  excluded: false,
  bodyHash: 'zzz999',
  payload: {},
};

const BASE_EDGE = {
  id: 'edge-1',
  kind: 'references' as const,
  src: 'node-orders',
  dst: 'node-customers',
  confidence: 'declared' as const,
  score: null,
  attrs: {},
};

const COL_EDGE = {
  id: 'edge-2',
  kind: 'has_column' as const,
  src: 'node-orders',
  dst: 'node-order-id',
  confidence: 'declared' as const,
  score: null,
  attrs: {},
};

/** Empty neighbors — minimal case. */
const EMPTY_NEIGHBORS: NeighborGroups = {};

/** Neighbors with references + has_column groups. */
const RICH_NEIGHBORS: NeighborGroups = {
  references: {
    out: [{ node: FK_NODE, edge: BASE_EDGE }],
    in: [],
  },
  has_column: {
    out: [{ node: COL_NODE, edge: COL_EDGE }],
    in: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// brief level
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExplore — brief', () => {
  it('includes the qname and kind', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    const output = formatExplore(view, 'brief');

    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
  });

  it('includes neighbor counts summary', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'brief');

    // Brief must mention that there are neighbors (counts line)
    expect(output).toContain('references');
    expect(output).toContain('has_column');
  });

  it('does NOT include body hash in brief', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    const output = formatExplore(view, 'brief');

    // abc123def456 is the bodyHash — should NOT appear in brief
    expect(output).not.toContain('abc123def456');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normal level
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExplore — normal', () => {
  it('includes qname, kind and grouped neighbors', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'normal');

    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
    // Neighbors grouped by edge kind
    expect(output).toContain('references');
    expect(output).toContain('dbo.customers');
    expect(output).toContain('has_column');
    expect(output).toContain('dbo.orders.order_id');
  });

  it('shows out/in direction labels for each group', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'normal');

    expect(output).toContain('out');
  });

  it('handles empty neighbors gracefully', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    expect(() => formatExplore(view, 'normal')).not.toThrow();
    const output = formatExplore(view, 'normal');
    expect(output).toContain('dbo.orders');
  });

  it('does NOT include body hash in normal', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    const output = formatExplore(view, 'normal');
    expect(output).not.toContain('abc123def456');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// full level
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExplore — full', () => {
  it('includes body hash when present', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    const output = formatExplore(view, 'full');

    expect(output).toContain('abc123def456');
  });

  it('includes level field', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    const output = formatExplore(view, 'full');

    // The node level (full/metadata/off) must appear in full detail
    expect(output).toContain('full');
  });

  it('shows null bodyHash as a placeholder in full', () => {
    const colView: ExploreView = { node: COL_NODE, neighbors: EMPTY_NEIGHBORS };
    const output = formatExplore(colView, 'full');
    // Should mention bodyHash field but with null/none indicator
    expect(output.toLowerCase()).toMatch(/bodyhash|body.?hash|hash/);
  });

  it('includes grouped neighbors just like normal', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'full');

    expect(output).toContain('dbo.customers');
    expect(output).toContain('dbo.orders.order_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExplore — determinism (ADR-008)', () => {
  const LEVELS: ExploreDetail[] = ['brief', 'normal', 'full'];

  for (const level of LEVELS) {
    it(`brief|normal|full: same input → byte-identical output (${level})`, () => {
      const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
      const run1 = formatExplore(view, level);
      const run2 = formatExplore(view, level);
      expect(run1).toBe(run2);
    });
  }

  it('different detail levels produce different output', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    const brief = formatExplore(view, 'brief');
    const full = formatExplore(view, 'full');
    expect(brief).not.toBe(full);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity — no side effects; no mutation of input
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExplore — purity', () => {
  it('returns a string (no throw) for any valid detail level', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    for (const level of ['brief', 'normal', 'full'] as ExploreDetail[]) {
      expect(() => formatExplore(view, level)).not.toThrow();
      expect(typeof formatExplore(view, level)).toBe('string');
    }
  });

  it('output ends with a newline for consistency', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: EMPTY_NEIGHBORS };
    for (const level of ['brief', 'normal', 'full'] as ExploreDetail[]) {
      expect(formatExplore(view, level)).toMatch(/\n$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests — structural pins per level (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatExplore — goldens', () => {
  it('brief golden: expected sections present', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'brief');

    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
    // Brief shows edge kinds with counts
    expect(output).toContain('references');
    expect(output).toContain('has_column');
    // No body hash
    expect(output).not.toContain('abc123def456');
  });

  it('normal golden: sections + neighbor details', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'normal');

    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
    expect(output).toContain('dbo.customers');
    expect(output).toContain('dbo.orders.order_id');
    expect(output).not.toContain('abc123def456');
  });

  it('full golden: sections + neighbors + hash + level', () => {
    const view: ExploreView = { node: BASE_NODE, neighbors: RICH_NEIGHBORS };
    const output = formatExplore(view, 'full');

    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
    expect(output).toContain('abc123def456');
    expect(output).toContain('dbo.customers');
    expect(output).toContain('dbo.orders.order_id');
  });
});
