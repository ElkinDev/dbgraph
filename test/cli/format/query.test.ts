/**
 * Tests for src/cli/format/query.ts — task 5.3 (phase-4-cli-config).
 * Spec: cli-config "query is backed by core search with a stable JSON contract"
 * Design: CLI-only pure formatter for query results.
 *   Text mode: one line per hit with type + qname.
 *   JSON mode (--json): STABLE, deterministic, byte-identical (ADR-008).
 *   No process.env / Date.now() / adapter imports — pure function.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import { formatQueryText, formatQueryJson, type QueryResultView } from '../../../src/cli/format/query.js';
import type { SearchHit } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const HIT_ORDERS: SearchHit = {
  id: 'node-orders',
  kind: 'table',
  qname: 'dbo.orders',
  column: 'qname',
  score: 0.9,
};

const HIT_ORDER_ITEMS: SearchHit = {
  id: 'node-order-items',
  kind: 'table',
  qname: 'dbo.order_items',
  column: 'qname',
  score: 0.7,
};

const HIT_GET_ORDERS: SearchHit = {
  id: 'node-get-orders',
  kind: 'procedure',
  qname: 'dbo.get_orders',
  column: 'body',
  score: 0.5,
};

// ─────────────────────────────────────────────────────────────────────────────
// formatQueryText
// ─────────────────────────────────────────────────────────────────────────────

describe('formatQueryText', () => {
  it('includes type and qname for each hit', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS], total: 1, term: 'orders' };
    const output = formatQueryText(view);

    expect(output).toContain('table');
    expect(output).toContain('dbo.orders');
  });

  it('formats multiple hits, one per line', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS, HIT_ORDER_ITEMS], total: 2, term: 'orders' };
    const output = formatQueryText(view);

    expect(output).toContain('dbo.orders');
    expect(output).toContain('dbo.order_items');
    // Each hit is on its own line
    const lines = output.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('includes different kinds (procedure)', () => {
    const view: QueryResultView = {
      hits: [HIT_ORDERS, HIT_GET_ORDERS],
      total: 2,
      term: 'orders',
    };
    const output = formatQueryText(view);

    expect(output).toContain('procedure');
    expect(output).toContain('dbo.get_orders');
  });

  it('handles empty hits array without throwing', () => {
    const view: QueryResultView = { hits: [], total: 0, term: 'nothing' };
    expect(() => formatQueryText(view)).not.toThrow();
  });

  it('output ends with newline', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS], total: 1, term: 'orders' };
    expect(formatQueryText(view)).toMatch(/\n$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatQueryJson — stable, machine-parseable
// ─────────────────────────────────────────────────────────────────────────────

describe('formatQueryJson', () => {
  it('emits valid JSON', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS], total: 1, term: 'orders' };
    const output = formatQueryJson(view);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('JSON includes type (kind) and qname for each hit', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS], total: 1, term: 'orders' };
    const parsed = JSON.parse(formatQueryJson(view)) as { hits: { kind: string; qname: string }[] };

    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.kind).toBe('table');
    expect(parsed.hits[0]!.qname).toBe('dbo.orders');
  });

  it('JSON includes total', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS, HIT_ORDER_ITEMS], total: 2, term: 'orders' };
    const parsed = JSON.parse(formatQueryJson(view)) as { total: number };

    expect(parsed.total).toBe(2);
  });

  it('deterministic: same input → byte-identical output (ADR-008)', () => {
    const view: QueryResultView = {
      hits: [HIT_ORDERS, HIT_ORDER_ITEMS, HIT_GET_ORDERS],
      total: 3,
      term: 'orders',
    };
    const run1 = formatQueryJson(view);
    const run2 = formatQueryJson(view);

    expect(run1).toBe(run2);
  });

  it('output ends with newline', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS], total: 1, term: 'orders' };
    expect(formatQueryJson(view)).toMatch(/\n$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden: structural pins (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatQueryText — golden', () => {
  it('one table hit: expected line structure', () => {
    const view: QueryResultView = { hits: [HIT_ORDERS], total: 1, term: 'orders' };
    const output = formatQueryText(view);

    // Must contain type and qname on the same output area
    expect(output).toContain('table');
    expect(output).toContain('dbo.orders');
  });
});

describe('formatQueryJson — golden', () => {
  it('three hits: stable JSON structure', () => {
    const view: QueryResultView = {
      hits: [HIT_ORDERS, HIT_ORDER_ITEMS, HIT_GET_ORDERS],
      total: 3,
      term: 'orders',
    };
    const parsed = JSON.parse(formatQueryJson(view)) as {
      term: string;
      total: number;
      hits: { kind: string; qname: string }[];
    };

    expect(parsed.term).toBe('orders');
    expect(parsed.total).toBe(3);
    expect(parsed.hits).toHaveLength(3);
  });
});
