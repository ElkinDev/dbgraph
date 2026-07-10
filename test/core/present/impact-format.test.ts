/**
 * Tests for src/core/present/impact.ts — task 1.5 (phase-5-mcp-server).
 * Spec: dbgraph_impact read/write blast radius; Depth truncation and dynamic-SQL warn.
 * Design: formatImpact(ImpactView, detail) PURE; visible chain a→b→c, READ/WRITE split,
 *   depth-truncation warning, "impact possibly incomplete" when any node has_dynamic_sql.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatImpact,
  type ImpactView,
  type ImpactDetail,
} from '../../../src/core/present/impact.js';
import type { GraphNode, ImpactResult } from '../../../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolvePath(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COL: GraphNode = {
  id: 'node-status', kind: 'column', schema: 'dbo', name: 'status', qname: 'dbo.orders.status',
  level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
};

const NODE_MAP: Record<string, string> = {
  'node-status': 'dbo.orders.status',
  'node-index': 'dbo.IX_orders_status',
  'node-view': 'dbo.order_summary',
  'node-read-proc': 'dbo.usp_GetOrdersByStatus',
  'node-write-trigger': 'dbo.trg_orders_audit',
};

const resolveNodeId = (id: string): string => NODE_MAP[id] ?? id;

const BASIC_RESULT: ImpactResult = {
  readImpact: [
    { nodes: ['node-status', 'node-index'], edges: ['reads_from'] },
    { nodes: ['node-status', 'node-view'], edges: ['reads_from'] },
    { nodes: ['node-status', 'node-view', 'node-read-proc'], edges: ['reads_from', 'reads_from'] },
  ],
  writeImpact: [
    { nodes: ['node-status', 'node-write-trigger'], edges: ['writes_to'] },
  ],
  truncated: false,
  dynamicSqlWarning: false,
  degradedNodeIds: [],
};

const TRUNCATED_RESULT: ImpactResult = {
  ...BASIC_RESULT,
  truncated: true,
  dynamicSqlWarning: false,
};

const DYNAMIC_SQL_RESULT: ImpactResult = {
  ...BASIC_RESULT,
  truncated: false,
  dynamicSqlWarning: true,
};

const EMPTY_RESULT: ImpactResult = {
  readImpact: [],
  writeImpact: [],
  truncated: false,
  dynamicSqlWarning: false,
  degradedNodeIds: [],
};

const BASIC_VIEW: ImpactView = { node: STATUS_COL, result: BASIC_RESULT, resolve: resolveNodeId };
const TRUNCATED_VIEW: ImpactView = { node: STATUS_COL, result: TRUNCATED_RESULT, resolve: resolveNodeId };
const DYNAMIC_SQL_VIEW: ImpactView = { node: STATUS_COL, result: DYNAMIC_SQL_RESULT, resolve: resolveNodeId };
const EMPTY_VIEW: ImpactView = { node: STATUS_COL, result: EMPTY_RESULT, resolve: resolveNodeId };

// ─────────────────────────────────────────────────────────────────────────────
// Content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImpact — content', () => {
  it('includes the pivot node qname', () => {
    const output = formatImpact(BASIC_VIEW, 'normal');
    expect(output).toContain('dbo.orders.status');
  });

  it('normal: shows READ and WRITE sections separately', () => {
    const output = formatImpact(BASIC_VIEW, 'normal');
    expect(output).toContain('READ IMPACT');
    expect(output).toContain('WRITE IMPACT');
  });

  it('normal: shows read chain qnames', () => {
    const output = formatImpact(BASIC_VIEW, 'normal');
    expect(output).toContain('dbo.IX_orders_status');
    expect(output).toContain('dbo.order_summary');
    expect(output).toContain('dbo.usp_GetOrdersByStatus');
  });

  it('normal: shows write chain qnames', () => {
    const output = formatImpact(BASIC_VIEW, 'normal');
    expect(output).toContain('dbo.trg_orders_audit');
  });

  it('shows visible chain format a → b → c', () => {
    const output = formatImpact(BASIC_VIEW, 'normal');
    expect(output).toContain('→');
  });

  it('handles empty impact gracefully', () => {
    expect(() => formatImpact(EMPTY_VIEW, 'normal')).not.toThrow();
    const output = formatImpact(EMPTY_VIEW, 'normal');
    expect(output).toContain('(none)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Truncation and dynamic SQL warnings
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImpact — warnings', () => {
  it('shows truncation warning when result.truncated is true', () => {
    const output = formatImpact(TRUNCATED_VIEW, 'normal');
    expect(output).toContain('truncated');
  });

  it('shows dynamic SQL warning when result.dynamicSqlWarning is true', () => {
    const output = formatImpact(DYNAMIC_SQL_VIEW, 'normal');
    expect(output).toContain('incomplete');
    expect(output).toContain('dynamic SQL');
  });

  it('does NOT show warnings when both are false', () => {
    const output = formatImpact(BASIC_VIEW, 'normal');
    expect(output).not.toContain('truncated');
    expect(output).not.toContain('dynamic SQL');
  });

  it('brief: shows truncation warning', () => {
    const output = formatImpact(TRUNCATED_VIEW, 'brief');
    expect(output).toContain('truncated');
  });

  it('brief: shows dynamic SQL warning', () => {
    const output = formatImpact(DYNAMIC_SQL_VIEW, 'brief');
    expect(output).toContain('incomplete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Brief detail
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImpact — brief detail', () => {
  it('brief: shows chain counts', () => {
    const output = formatImpact(BASIC_VIEW, 'brief');
    expect(output).toContain('READ impact');
    expect(output).toContain('WRITE impact');
    expect(output).toContain('3'); // 3 read chains
    expect(output).toContain('1'); // 1 write chain
  });

  it('brief: does NOT show individual chain qnames', () => {
    const output = formatImpact(BASIC_VIEW, 'brief');
    expect(output).not.toContain('dbo.IX_orders_status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity contract
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImpact — purity contract', () => {
  it('returns a string ending with a newline', () => {
    const levels: ImpactDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(formatImpact(BASIC_VIEW, level)).toMatch(/\n$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImpact — determinism (ADR-008)', () => {
  const levels: ImpactDetail[] = ['brief', 'normal', 'full'];
  for (const level of levels) {
    it(`same input → byte-identical output (${level})`, () => {
      const run1 = formatImpact(BASIC_VIEW, level);
      const run2 = formatImpact(BASIC_VIEW, level);
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImpact — goldens', () => {
  const levels: ImpactDetail[] = ['brief', 'normal', 'full'];

  for (const level of levels) {
    it(`${level} output matches golden`, () => {
      const actual = formatImpact(BASIC_VIEW, level);
      const goldenPath = join(goldenDir, `impact-${level}.txt`);
      const golden = readFileSync(goldenPath, 'utf-8');
      expect(actual).toBe(golden);
    });
  }
});
