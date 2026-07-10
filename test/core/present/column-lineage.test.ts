/**
 * DOG-3 C.4 — the shared payload-render helper renders a VIEW focus node's consumed
 * SOURCE-COLUMN set from `edge.attrs.dstColumns`, gated to FULL detail ONLY (design D7).
 * Spec: mcp-server "explore and object render a view's consumed source columns at full detail,
 * honest" (view-focus-full, honesty, degraded-negative scenarios).
 *
 * PINNED SHAPE (design.md D7 / mcp-server spec, verbatim): `consumes: <table>.<column>` — one
 * line per consumed source column, NO separate uppercase header (unlike COLUMNS/PARAMETERS),
 * listing columns in the canonical code-point order the normalizer already stamped (D3);
 * multiple depended-on tables are ordered by target qname (ADR-008 determinism).
 *
 * STRICT TDD: `renderConsumedColumns` does not exist yet, and explore/object do not wire a
 * `depends_on` section for VIEW containers — every assertion below is RED until C.4 lands.
 *
 * L-009: exact lines, byte-identical explore vs object, brief/normal absence, degraded-negative
 * (NO dstColumns -> NO consumes section), honesty (source columns only, never an output pair).
 */

import { describe, it, expect } from 'vitest';
import { formatExplore, type ExploreView } from '../../../src/core/present/explore.js';
import { formatObject, type ObjectView } from '../../../src/core/present/object.js';
import { renderConsumedColumns } from '../../../src/core/present/payload.js';
import type { GraphNode, GraphEdge, NeighborGroups } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic view-focus fixture (mirrors the A.4/A.7 mssql truth set)
// ─────────────────────────────────────────────────────────────────────────────

function tableNode(id: string, qname: string): GraphNode {
  return {
    id, kind: 'table', schema: 'dbo',
    name: qname.split('.').pop() ?? qname, qname,
    level: 'metadata', missing: false, excluded: false, bodyHash: null, payload: {},
  };
}

function viewNode(): GraphNode {
  return {
    id: 'n-view', kind: 'view', schema: 'dbo',
    name: 'v_order_summary', qname: 'dbo.v_order_summary',
    level: 'full', missing: false, excluded: false, bodyHash: 'abc123', payload: {},
  };
}

function dependsOnEdge(dst: string, dstColumns?: readonly string[]): GraphEdge {
  return {
    id: `e-dep-${dst}`, kind: 'depends_on', src: 'n-view', dst,
    confidence: dstColumns !== undefined ? 'declared' : 'parsed',
    score: null,
    attrs: dstColumns !== undefined ? { dstColumns } : {},
  };
}

const ORDERS = tableNode('n-orders', 'dbo.orders');
const ORDER_ITEMS = tableNode('n-order-items', 'dbo.order_items');

const EXPECTED_LINES = [
  'consumes: dbo.order_items.order_id',
  'consumes: dbo.order_items.product_id',
  'consumes: dbo.orders.customer_id',
  'consumes: dbo.orders.order_id',
  'consumes: dbo.orders.status',
  'consumes: dbo.orders.total_amount',
];

// ─────────────────────────────────────────────────────────────────────────────
// C.4a — renderConsumedColumns: the pure renderer
// ─────────────────────────────────────────────────────────────────────────────

describe('renderConsumedColumns — pure renderer (D7)', () => {
  it('renders the EXACT pinned consumes: <table>.<column> lines, ordered by target qname', () => {
    const dependsOn = [
      { node: ORDER_ITEMS, edge: dependsOnEdge('n-order-items', ['order_id', 'product_id']) },
      { node: ORDERS, edge: dependsOnEdge('n-orders', ['customer_id', 'order_id', 'status', 'total_amount']) },
    ];
    expect(renderConsumedColumns(dependsOn)).toStrictEqual(EXPECTED_LINES);
  });

  it('returns [] when NO depends_on edge carries dstColumns (degraded, negative)', () => {
    const dependsOn = [
      { node: ORDER_ITEMS, edge: dependsOnEdge('n-order-items') }, // no dstColumns
      { node: ORDERS, edge: dependsOnEdge('n-orders') },
    ];
    expect(renderConsumedColumns(dependsOn)).toStrictEqual([]);
  });

  it('a MIXED graph renders only the covered edge, skipping the uncovered one (honesty)', () => {
    const dependsOn = [
      { node: ORDER_ITEMS, edge: dependsOnEdge('n-order-items', ['order_id']) },
      { node: ORDERS, edge: dependsOnEdge('n-orders') }, // uncovered
    ];
    expect(renderConsumedColumns(dependsOn)).toStrictEqual(['consumes: dbo.order_items.order_id']);
  });

  it('empty depends_on list -> []', () => {
    expect(renderConsumedColumns([])).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.4b — explore wiring: FULL ONLY, byte-identical negative at brief/normal
// ─────────────────────────────────────────────────────────────────────────────

function neighborsWithDstColumns(): NeighborGroups {
  return {
    depends_on: {
      out: [
        { node: ORDER_ITEMS, edge: dependsOnEdge('n-order-items', ['order_id', 'product_id']) },
        { node: ORDERS, edge: dependsOnEdge('n-orders', ['customer_id', 'order_id', 'status', 'total_amount']) },
      ],
      in: [],
    },
  };
}

function neighborsDegraded(): NeighborGroups {
  return {
    depends_on: {
      out: [
        { node: ORDER_ITEMS, edge: dependsOnEdge('n-order-items') },
        { node: ORDERS, edge: dependsOnEdge('n-orders') },
      ],
      in: [],
    },
  };
}

const EXPECTED_BLOCK = EXPECTED_LINES.join('\n');

describe('explore — view focus consumes section, FULL ONLY (C.4, D7)', () => {
  it('full renders the EXACT consumes lines (byte-exact block)', () => {
    const view: ExploreView = { node: viewNode(), neighbors: neighborsWithDstColumns() };
    expect(formatExplore(view, 'full')).toContain(EXPECTED_BLOCK);
  });

  it('normal renders NO consumes section (negative — full-only budget honesty)', () => {
    const view: ExploreView = { node: viewNode(), neighbors: neighborsWithDstColumns() };
    expect(formatExplore(view, 'normal')).not.toContain('consumes:');
  });

  it('brief renders NO consumes section (negative)', () => {
    const view: ExploreView = { node: viewNode(), neighbors: neighborsWithDstColumns() };
    expect(formatExplore(view, 'brief')).not.toContain('consumes:');
  });

  it('a degraded view (no dstColumns) renders NO consumes section at full (negative)', () => {
    const view: ExploreView = { node: viewNode(), neighbors: neighborsDegraded() };
    expect(formatExplore(view, 'full')).not.toContain('consumes:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.4c — object wiring: FULL ONLY, byte-identical negative at brief/normal
// ─────────────────────────────────────────────────────────────────────────────

describe('object — view focus consumes section, FULL ONLY (C.4, D7)', () => {
  it('full renders the EXACT consumes lines (byte-exact block)', () => {
    const view: ObjectView = { node: viewNode(), neighbors: neighborsWithDstColumns() };
    expect(formatObject(view, 'full')).toContain(EXPECTED_BLOCK);
  });

  it('normal renders NO consumes section (negative)', () => {
    const view: ObjectView = { node: viewNode(), neighbors: neighborsWithDstColumns() };
    expect(formatObject(view, 'normal')).not.toContain('consumes:');
  });

  it('brief renders NO consumes section (negative)', () => {
    const view: ObjectView = { node: viewNode(), neighbors: neighborsWithDstColumns() };
    expect(formatObject(view, 'brief')).not.toContain('consumes:');
  });

  it('a degraded view (no dstColumns) renders NO consumes section at full (negative)', () => {
    const view: ObjectView = { node: viewNode(), neighbors: neighborsDegraded() };
    expect(formatObject(view, 'full')).not.toContain('consumes:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.4d — CLI (explore) and MCP (object) share ONE helper: BYTE-IDENTICAL bytes
// ─────────────────────────────────────────────────────────────────────────────

describe('explore and object render BYTE-IDENTICAL consumes: bytes (D7, one shared helper)', () => {
  it('the same node + neighbors yield the identical exact block across both surfaces', () => {
    const node = viewNode();
    const neighbors = neighborsWithDstColumns();
    expect(formatExplore({ node, neighbors }, 'full')).toContain(EXPECTED_BLOCK);
    expect(formatObject({ node, neighbors }, 'full')).toContain(EXPECTED_BLOCK);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.4e — honesty: source columns only, NEVER an output-column pairing
// ─────────────────────────────────────────────────────────────────────────────

describe('honesty — the consumes lines name ONLY source columns, never an output pair (ADR-007)', () => {
  it('no line contains "->" or "=>" or any output-mapping punctuation', () => {
    const dependsOn = [
      { node: ORDERS, edge: dependsOnEdge('n-orders', ['customer_id', 'order_id', 'status', 'total_amount']) },
    ];
    const lines = renderConsumedColumns(dependsOn);
    for (const line of lines) {
      expect(line).not.toMatch(/->|=>|→/);
      expect(line.startsWith('consumes: dbo.orders.')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.4f — freeze proof: a graph WITHOUT any depends_on group renders byte-identical
// to the pre-DOG-3 shape (no stray section, no crash on absent group)
// ─────────────────────────────────────────────────────────────────────────────

describe('freeze proof — a node with NO depends_on group at all renders no consumes section', () => {
  it('explore full with zero neighbor groups omits consumes: entirely', () => {
    const view: ExploreView = { node: viewNode(), neighbors: {} };
    expect(formatExplore(view, 'full')).not.toContain('consumes:');
  });
  it('object full with zero neighbor groups omits consumes: entirely', () => {
    const view: ObjectView = { node: viewNode(), neighbors: {} };
    expect(formatObject(view, 'full')).not.toContain('consumes:');
  });
});
