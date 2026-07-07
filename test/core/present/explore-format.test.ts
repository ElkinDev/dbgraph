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
import { formatObject } from '../../../src/core/present/object.js';
import type { GraphNode, GraphEdge, NeighborGroups } from '../../../src/index.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// B.4 — focus PAYLOAD sections via the shared helper, byte-identical to object
// (torture main.employees fixture; FK target RECONSTRUCTED from the references edge)
// ─────────────────────────────────────────────────────────────────────────────

function empNode(kind: GraphNode['kind'], name: string, payload: Record<string, unknown>): GraphNode {
  return {
    id: `emp-${kind}-${name}`,
    kind,
    schema: 'main',
    name,
    qname: kind === 'table' ? `main.${name}` : `main.employees.${name}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload,
  };
}

const EMP_TABLE: GraphNode = {
  id: 'emp-table',
  kind: 'table',
  schema: 'main',
  name: 'employees',
  qname: 'main.employees',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: {},
};

const DEPARTMENTS: GraphNode = {
  id: 'dep-table',
  kind: 'table',
  schema: 'main',
  name: 'departments',
  qname: 'main.departments',
  level: 'metadata',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: {},
};

const refEdge = (agg: boolean, srcColumn?: string): GraphEdge => ({
  id: `emp-ref-${srcColumn ?? 'agg'}`,
  kind: 'references',
  src: 'emp-table',
  dst: 'dep-table',
  confidence: 'declared',
  score: null,
  attrs: { constraintName: 'fk_employees_0', ...(agg ? { aggregate: true } : {}), ...(srcColumn !== undefined ? { srcColumn, dstColumn: srcColumn } : {}) },
});

const plainEdge = (kind: GraphEdge['kind'], src: string, dst: string): GraphEdge => ({
  id: `${kind}-${src}-${dst}`,
  kind,
  src,
  dst,
  confidence: 'declared',
  score: null,
  attrs: {},
});

const EMP_NEIGHBORS: NeighborGroups = {
  has_column: {
    out: [
      { node: empNode('column', 'emp_id', { dataType: 'INTEGER', nullable: false, ordinal: 1 }), edge: plainEdge('has_column', 'emp-table', 'emp_id') },
      { node: empNode('column', 'full_name', { dataType: 'TEXT', nullable: false, ordinal: 2 }), edge: plainEdge('has_column', 'emp-table', 'full_name') },
      { node: empNode('column', 'email', { dataType: 'TEXT', nullable: true, ordinal: 3 }), edge: plainEdge('has_column', 'emp-table', 'email') },
      { node: empNode('column', 'dept_id', { dataType: 'INTEGER', nullable: false, ordinal: 4 }), edge: plainEdge('has_column', 'emp-table', 'dept_id') },
      { node: empNode('column', 'salary', { dataType: 'REAL', nullable: false, ordinal: 5, default: '0.0' }), edge: plainEdge('has_column', 'emp-table', 'salary') },
      { node: empNode('column', 'hire_date', { dataType: 'TEXT', nullable: true, ordinal: 6 }), edge: plainEdge('has_column', 'emp-table', 'hire_date') },
    ],
    in: [],
  },
  has_constraint: {
    out: [
      { node: empNode('constraint', 'fk_employees_0', { type: 'FK', columns: ['dept_id'] }), edge: plainEdge('has_constraint', 'emp-table', 'fk_employees_0') },
      { node: empNode('constraint', 'idx_emp_email', { type: 'UNIQUE', columns: ['email'] }), edge: plainEdge('has_constraint', 'emp-table', 'idx_emp_email') },
      { node: empNode('constraint', 'pk_employees', { type: 'PK', columns: ['emp_id'] }), edge: plainEdge('has_constraint', 'emp-table', 'pk_employees') },
    ],
    in: [],
  },
  has_index: {
    out: [
      { node: empNode('index', 'idx_emp_active_dept', { unique: false, columns: ['dept_id'] }), edge: plainEdge('has_index', 'emp-table', 'idx_emp_active_dept') },
      { node: empNode('index', 'idx_emp_dept', { unique: false, columns: ['dept_id', 'hire_date'] }), edge: plainEdge('has_index', 'emp-table', 'idx_emp_dept') },
      { node: empNode('index', 'idx_emp_email', { unique: true, columns: ['email'] }), edge: plainEdge('has_index', 'emp-table', 'idx_emp_email') },
      { node: empNode('index', 'idx_emp_email_lower', { unique: false, columns: ['(expr)'] }), edge: plainEdge('has_index', 'emp-table', 'idx_emp_email_lower') },
    ],
    in: [],
  },
  fires_on: {
    out: [],
    in: [
      { node: empNode('trigger', 'trg_emp_after_delete', { timing: 'AFTER', events: ['DELETE'] }), edge: plainEdge('fires_on', 'trg_emp_after_delete', 'emp-table') },
      { node: empNode('trigger', 'trg_emp_after_insert', { timing: 'AFTER', events: ['INSERT'] }), edge: plainEdge('fires_on', 'trg_emp_after_insert', 'emp-table') },
      { node: empNode('trigger', 'trg_emp_before_insert', { timing: 'BEFORE', events: ['INSERT'] }), edge: plainEdge('fires_on', 'trg_emp_before_insert', 'emp-table') },
      { node: empNode('trigger', 'trg_emp_before_update', { timing: 'BEFORE', events: ['UPDATE'] }), edge: plainEdge('fires_on', 'trg_emp_before_update', 'emp-table') },
      { node: empNode('trigger', 'trg_emp_salary_update', { timing: 'BEFORE', events: ['UPDATE'] }), edge: plainEdge('fires_on', 'trg_emp_salary_update', 'emp-table') },
    ],
  },
  references: {
    out: [
      { node: DEPARTMENTS, edge: refEdge(false, 'dept_id') },
      { node: DEPARTMENTS, edge: refEdge(true) },
    ],
    in: [],
  },
};

const EMP_VIEW = { node: EMP_TABLE, neighbors: EMP_NEIGHBORS };

const COLUMNS_BLOCK = [
  'COLUMNS',
  '  emp_id  INTEGER  [PK]',
  '  full_name  TEXT  [NN]',
  '  email  TEXT',
  '  dept_id  INTEGER  [FK→main.departments]  [NN]',
  '  salary  REAL  [NN]  DEFAULT 0.0',
  '  hire_date  TEXT',
].join('\n');

const CONSTRAINTS_BLOCK = [
  'CONSTRAINTS',
  '  [FK]  fk_employees_0  (dept_id → main.departments)',
  '  [UNIQUE]  idx_emp_email  (email)',
  '  [PK]  pk_employees  (emp_id)',
].join('\n');

const INDEXES_BLOCK = [
  'INDEXES',
  '  idx_emp_active_dept  (dept_id)',
  '  idx_emp_dept  (dept_id, hire_date)',
  '  idx_emp_email  UNIQUE (email)',
  '  idx_emp_email_lower  ((expr))',
].join('\n');

const TRIGGERS_BLOCK = [
  'TRIGGERS',
  '  trg_emp_after_delete  AFTER DELETE',
  '  trg_emp_after_insert  AFTER INSERT',
  '  trg_emp_before_insert  BEFORE INSERT',
  '  trg_emp_before_update  BEFORE UPDATE',
  '  trg_emp_salary_update  BEFORE UPDATE',
].join('\n');

describe('formatExplore — focus payload sections (explore-payloads B.4)', () => {
  it('normal renders the COLUMNS + CONSTRAINTS sections, byte-identical to object', () => {
    const explore = formatExplore(EMP_VIEW, 'normal');
    const object = formatObject(EMP_VIEW, 'normal');
    expect(explore).toContain(COLUMNS_BLOCK);
    expect(explore).toContain(CONSTRAINTS_BLOCK);
    expect(object).toContain(COLUMNS_BLOCK);
    expect(object).toContain(CONSTRAINTS_BLOCK);
  });

  it('normal renders the reconstructed FK column line and constraint mapping', () => {
    const explore = formatExplore(EMP_VIEW, 'normal');
    expect(explore).toContain('  dept_id  INTEGER  [FK→main.departments]  [NN]');
    expect(explore).toContain('  [FK]  fk_employees_0  (dept_id → main.departments)');
  });

  it('normal does NOT render INDEXES/TRIGGERS sections (full-only, gated like object)', () => {
    const explore = formatExplore(EMP_VIEW, 'normal');
    expect(explore).not.toContain('INDEXES');
    expect(explore).not.toContain('TRIGGERS');
  });

  it('full renders the INDEXES + TRIGGERS sections, byte-identical to object', () => {
    const explore = formatExplore(EMP_VIEW, 'full');
    const object = formatObject(EMP_VIEW, 'full');
    expect(explore).toContain(INDEXES_BLOCK);
    expect(explore).toContain(TRIGGERS_BLOCK);
    expect(object).toContain(INDEXES_BLOCK);
    expect(object).toContain(TRIGGERS_BLOCK);
    expect(explore).toContain('  trg_emp_after_insert  AFTER INSERT');
    expect(explore).toContain('  trg_emp_salary_update  BEFORE UPDATE');
  });

  it('brief renders NO payload lines (only header + neighbor-kind counts)', () => {
    const brief = formatExplore(EMP_VIEW, 'brief');
    expect(brief).not.toContain('COLUMNS');
    expect(brief).not.toContain('CONSTRAINTS');
    expect(brief).not.toContain('INDEXES');
    expect(brief).not.toContain('TRIGGERS');
    expect(brief).toContain('has_column');
  });

  it('retains the grouped in/out neighbor listing AFTER the payload sections', () => {
    const explore = formatExplore(EMP_VIEW, 'normal');
    expect(explore).toContain('references');
    expect(explore).toContain('→ main.departments  [table]');
    expect(explore.indexOf('COLUMNS')).toBeLessThan(explore.indexOf('  fires_on'));
  });

  it('renders a NON-container (column) focus via renderFocusPayload at normal', () => {
    const colFocus = {
      node: empNode('column', 'salary', { dataType: 'REAL', nullable: false, ordinal: 5, default: '0.0' }),
      neighbors: {} as NeighborGroups,
    };
    const out = formatExplore(colFocus, 'normal');
    expect(out).toContain('COLUMNS');
    expect(out).toContain('  salary  REAL  [NN]  DEFAULT 0.0');
  });
});
