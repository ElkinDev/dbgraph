/**
 * Tests for src/core/present/related.ts — task 1.4 (phase-5-mcp-server).
 * Spec: dbgraph_related grouped by edge kind and direction; inferred edges separate.
 * Design: formatRelated(ExploreView, detail) PURE; neighbors grouped by kind + direction;
 *   inferred edges a SEPARATE group with score. MAY reuse ExploreView.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatRelated,
  type RelatedDetail,
} from '../../../src/core/present/related.js';
import type { ExploreView, GraphNode, NeighborGroups } from '../../../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ORDERS_NODE: GraphNode = {
  id: 'node-orders', kind: 'table', schema: 'dbo', name: 'orders', qname: 'dbo.orders',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};
const CUSTOMERS_NODE: GraphNode = {
  id: 'node-customers', kind: 'table', schema: 'dbo', name: 'customers', qname: 'dbo.customers',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};
const ORDER_ITEMS_NODE: GraphNode = {
  id: 'node-order-items', kind: 'table', schema: 'dbo', name: 'order_items', qname: 'dbo.order_items',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};
const VIEW_NODE: GraphNode = {
  id: 'node-view', kind: 'view', schema: 'dbo', name: 'order_summary', qname: 'dbo.order_summary',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};
const TRIGGER_NODE: GraphNode = {
  id: 'node-trg', kind: 'trigger', schema: 'dbo', name: 'trg_audit', qname: 'dbo.trg_audit',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};
const INFERRED_TABLE: GraphNode = {
  id: 'node-shipments', kind: 'table', schema: 'dbo', name: 'shipments', qname: 'dbo.shipments',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};

const RICH_NEIGHBORS: NeighborGroups = {
  references: {
    out: [
      {
        node: CUSTOMERS_NODE,
        edge: { id: 'e1', kind: 'references', src: ORDERS_NODE.id, dst: CUSTOMERS_NODE.id, confidence: 'declared', score: null, attrs: {} },
      },
    ],
    in: [
      {
        node: ORDER_ITEMS_NODE,
        edge: { id: 'e2', kind: 'references', src: ORDER_ITEMS_NODE.id, dst: ORDERS_NODE.id, confidence: 'declared', score: null, attrs: {} },
      },
    ],
  },
  depends_on: {
    out: [],
    in: [
      {
        node: VIEW_NODE,
        edge: { id: 'e3', kind: 'depends_on', src: VIEW_NODE.id, dst: ORDERS_NODE.id, confidence: 'declared', score: null, attrs: {} },
      },
    ],
  },
  fires_on: {
    out: [],
    in: [
      {
        node: TRIGGER_NODE,
        edge: { id: 'e4', kind: 'fires_on', src: TRIGGER_NODE.id, dst: ORDERS_NODE.id, confidence: 'declared', score: null, attrs: {} },
      },
    ],
  },
  references_inferred: {
    out: [
      {
        node: INFERRED_TABLE,
        edge: { id: 'e5', kind: 'references', src: ORDERS_NODE.id, dst: INFERRED_TABLE.id, confidence: 'inferred', score: 0.85, attrs: {} },
      },
    ],
    in: [],
  },
};

const EMPTY_VIEW: ExploreView = { node: ORDERS_NODE, neighbors: {} };
const RICH_VIEW: ExploreView = { node: ORDERS_NODE, neighbors: RICH_NEIGHBORS };

// ─────────────────────────────────────────────────────────────────────────────
// Content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('formatRelated — content', () => {
  it('includes the pivot node qname', () => {
    const output = formatRelated(RICH_VIEW, 'normal');
    expect(output).toContain('dbo.orders');
  });

  it('normal: includes neighbor qnames grouped by kind', () => {
    const output = formatRelated(RICH_VIEW, 'normal');
    expect(output).toContain('dbo.customers');
    expect(output).toContain('dbo.order_items');
    expect(output).toContain('dbo.order_summary');
    expect(output).toContain('dbo.trg_audit');
  });

  it('normal: includes edge kinds', () => {
    const output = formatRelated(RICH_VIEW, 'normal');
    expect(output).toContain('references');
    expect(output).toContain('depends_on');
    expect(output).toContain('fires_on');
  });

  it('normal: shows out/in direction arrows', () => {
    const output = formatRelated(RICH_VIEW, 'normal');
    expect(output).toContain('→');
    expect(output).toContain('←');
  });

  it('handles empty neighbors gracefully', () => {
    expect(() => formatRelated(EMPTY_VIEW, 'normal')).not.toThrow();
    const output = formatRelated(EMPTY_VIEW, 'normal');
    expect(output).toContain('no neighbors');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred edges — separate group
// ─────────────────────────────────────────────────────────────────────────────

describe('formatRelated — inferred edges', () => {
  it('normal: inferred edges appear in a separate group', () => {
    const output = formatRelated(RICH_VIEW, 'normal');
    expect(output).toContain('inferred');
    expect(output).toContain('dbo.shipments');
  });

  it('full: inferred edges show score', () => {
    const output = formatRelated(RICH_VIEW, 'full');
    expect(output).toContain('0.85');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Brief detail
// ─────────────────────────────────────────────────────────────────────────────

describe('formatRelated — brief detail', () => {
  it('brief: includes kind names with counts', () => {
    const output = formatRelated(RICH_VIEW, 'brief');
    expect(output).toContain('references');
  });

  it('brief: does NOT include individual qnames', () => {
    const output = formatRelated(RICH_VIEW, 'brief');
    expect(output).not.toContain('dbo.customers');
    expect(output).not.toContain('dbo.order_items');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity contract
// ─────────────────────────────────────────────────────────────────────────────

describe('formatRelated — purity contract', () => {
  it('returns a string ending with a newline', () => {
    const levels: RelatedDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(formatRelated(RICH_VIEW, level)).toMatch(/\n$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatRelated — determinism (ADR-008)', () => {
  const levels: RelatedDetail[] = ['brief', 'normal', 'full'];
  for (const level of levels) {
    it(`same input → byte-identical output (${level})`, () => {
      const run1 = formatRelated(RICH_VIEW, level);
      const run2 = formatRelated(RICH_VIEW, level);
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests (byte-identical per detail level, ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatRelated — goldens', () => {
  const levels: RelatedDetail[] = ['brief', 'normal', 'full'];

  for (const level of levels) {
    it(`${level} output matches golden`, () => {
      const actual = formatRelated(RICH_VIEW, level);
      const goldenPath = join(goldenDir, `related-${level}.txt`);
      const golden = readFileSync(goldenPath, 'utf-8');
      expect(actual).toBe(golden);
    });
  }
});
