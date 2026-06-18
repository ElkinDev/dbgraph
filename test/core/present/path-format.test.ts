/**
 * Tests for src/core/present/path.ts — task 1.6 (phase-5-mcp-server).
 * Spec: dbgraph_path shortest join path or suggests neighbors; No route reports neighbors.
 * Design: formatPath(PathView) PURE; shortest route with exact join columns per hop;
 *   inferred-only route marked inferred; no-route message + closest neighbors.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPath,
  type PathView,
} from '../../../src/core/present/path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_MAP: Record<string, string> = {
  'tbl-customers': 'dbo.customers',
  'tbl-orders': 'dbo.orders',
  'tbl-shipments': 'dbo.shipments',
};

const resolveTable = (id: string): string => TABLE_MAP[id] ?? id;

const FOUND_PATH_VIEW: PathView = {
  from: 'dbo.customers',
  to: 'dbo.shipments',
  result: {
    found: true,
    hops: [
      {
        fromTable: 'tbl-customers',
        toTable: 'tbl-orders',
        joinColumns: [{ from: 'customer_id', to: 'customer_id' }],
      },
      {
        fromTable: 'tbl-orders',
        toTable: 'tbl-shipments',
        joinColumns: [{ from: 'order_id', to: 'order_id' }],
      },
    ],
    inferred: false,
  },
  resolveTable,
};

const INFERRED_PATH_VIEW: PathView = {
  from: 'dbo.customers',
  to: 'dbo.shipments',
  result: {
    found: true,
    hops: [
      {
        fromTable: 'tbl-customers',
        toTable: 'tbl-orders',
        joinColumns: [{ from: 'customer_id', to: 'customer_id' }],
      },
    ],
    inferred: true,
  },
  resolveTable,
};

const NO_ROUTE_VIEW: PathView = {
  from: 'dbo.customers',
  to: 'dbo.shipments',
  result: {
    found: false,
    nearest: {
      from: ['dbo.orders', 'dbo.addresses'],
      to: ['dbo.orders', 'dbo.warehouses'],
    },
  },
  resolveTable,
};

const SAME_NODE_VIEW: PathView = {
  from: 'dbo.orders',
  to: 'dbo.orders',
  result: {
    found: true,
    hops: [],
    inferred: false,
  },
  resolveTable,
};

// ─────────────────────────────────────────────────────────────────────────────
// Found path
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPath — found path', () => {
  it('includes from and to qnames in header', () => {
    const output = formatPath(FOUND_PATH_VIEW);
    expect(output).toContain('dbo.customers');
    expect(output).toContain('dbo.shipments');
  });

  it('shows join columns per hop', () => {
    const output = formatPath(FOUND_PATH_VIEW);
    expect(output).toContain('customer_id');
    expect(output).toContain('order_id');
    expect(output).toContain('JOIN ON');
  });

  it('shows intermediate table in multi-hop path', () => {
    const output = formatPath(FOUND_PATH_VIEW);
    expect(output).toContain('dbo.orders');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No route
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPath — no route', () => {
  it('states no route found', () => {
    const output = formatPath(NO_ROUTE_VIEW);
    expect(output).toContain('No join path found');
  });

  it('suggests nearest neighbors of from endpoint', () => {
    const output = formatPath(NO_ROUTE_VIEW);
    expect(output).toContain('dbo.orders');
    expect(output).toContain('dbo.addresses');
  });

  it('suggests nearest neighbors of to endpoint', () => {
    const output = formatPath(NO_ROUTE_VIEW);
    expect(output).toContain('dbo.warehouses');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred route
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPath — inferred route', () => {
  it('marks inferred route with a warning', () => {
    const output = formatPath(INFERRED_PATH_VIEW);
    expect(output).toContain('inferred');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity contract
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPath — purity contract', () => {
  it('returns a string ending with a newline', () => {
    expect(formatPath(FOUND_PATH_VIEW)).toMatch(/\n$/);
    expect(formatPath(NO_ROUTE_VIEW)).toMatch(/\n$/);
  });

  it('does not throw on same-node case', () => {
    expect(() => formatPath(SAME_NODE_VIEW)).not.toThrow();
    const output = formatPath(SAME_NODE_VIEW);
    expect(output).toContain('dbo.orders');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPath — determinism (ADR-008)', () => {
  it('same input → byte-identical output (found path)', () => {
    expect(formatPath(FOUND_PATH_VIEW)).toBe(formatPath(FOUND_PATH_VIEW));
  });

  it('same input → byte-identical output (no route)', () => {
    expect(formatPath(NO_ROUTE_VIEW)).toBe(formatPath(NO_ROUTE_VIEW));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatPath — goldens', () => {
  it('found path output matches golden', () => {
    const actual = formatPath(FOUND_PATH_VIEW);
    const golden = readFileSync(join(goldenDir, 'path-found.txt'), 'utf-8');
    expect(actual).toBe(golden);
  });

  it('no-route output matches golden', () => {
    const actual = formatPath(NO_ROUTE_VIEW);
    const golden = readFileSync(join(goldenDir, 'path-noroute.txt'), 'utf-8');
    expect(actual).toBe(golden);
  });
});
