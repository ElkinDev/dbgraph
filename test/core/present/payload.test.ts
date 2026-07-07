/**
 * Tests for src/core/present/payload.ts — change explore-payloads (US-036), Batch A.
 * Spec: mcp-server "One shared payload-render helper backs explore and object";
 *   cli-config "explore output comes from a pure formatter shared with the MCP tool".
 * Design D1 — pure per-kind section renderers (string[] in → string[] out, [] when empty),
 *   body-only lines WITHOUT a leading blank; deriveColumnAnnotations (payload-present path
 *   in Batch A; reconstruct/degrade in Batch B). ADR-004/ADR-008: core types only, deterministic.
 *
 * STRICT TDD: these assertions are EXACT (.toStrictEqual / .toBe) and precede the module.
 */

import { describe, it, expect } from 'vitest';
import {
  renderColumns,
  renderConstraints,
  renderIndexes,
  renderTriggers,
  deriveColumnAnnotations,
  type ColumnAnnotations,
  type NeighborEntry,
} from '../../../src/core/present/payload.js';
import type { GraphNode } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders — synthetic GraphNodes mirroring the torture fixture facts.
// Pure unit fixtures: no graph build, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

function baseNode(kind: GraphNode['kind'], name: string, payload: Record<string, unknown>): GraphNode {
  return {
    id: `node-${kind}-${name}`,
    kind,
    schema: 'main',
    name,
    qname: `main.${name}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload,
  };
}

function colNode(
  name: string,
  dataType: string,
  nullable: boolean,
  ordinal: number,
  def?: string,
): GraphNode {
  const payload: Record<string, unknown> = { dataType, nullable, ordinal };
  if (def !== undefined) payload['default'] = def;
  return baseNode('column', name, payload);
}

function constraintNode(
  name: string,
  type: 'PK' | 'FK' | 'UNIQUE' | 'CHECK',
  columns: readonly string[],
  definition?: string,
): GraphNode {
  const payload: Record<string, unknown> = { type, columns };
  if (definition !== undefined) payload['definition'] = definition;
  return baseNode('constraint', name, payload);
}

function indexNode(
  name: string,
  unique: boolean,
  columns: readonly string[],
  method?: string,
): GraphNode {
  const payload: Record<string, unknown> = { unique, columns };
  if (method !== undefined) payload['method'] = method;
  return baseNode('index', name, payload);
}

function triggerNode(name: string, timing: string, events: readonly string[]): GraphNode {
  return baseNode('trigger', name, { timing, events });
}

const entry = (node: GraphNode): NeighborEntry => ({ node });

// ─────────────────────────────────────────────────────────────────────────────
// A.1 — renderColumns
// ─────────────────────────────────────────────────────────────────────────────

describe('payload.renderColumns (A.1)', () => {
  const empColumns: NeighborEntry[] = [
    entry(colNode('emp_id', 'INTEGER', false, 1)),
    entry(colNode('full_name', 'TEXT', false, 2)),
    entry(colNode('email', 'TEXT', true, 3)),
    entry(colNode('dept_id', 'INTEGER', false, 4)),
    entry(colNode('salary', 'REAL', false, 5, '0.0')),
    entry(colNode('hire_date', 'TEXT', true, 6)),
  ];

  const pkOnly: ColumnAnnotations = { pk: new Set(['emp_id']), fk: new Map() };

  it('renders a COLUMNS header + one body row per column, PK/NN/DEFAULT markers', () => {
    expect(renderColumns(empColumns, pkOnly)).toStrictEqual([
      'COLUMNS',
      '  emp_id  INTEGER  [PK]',
      '  full_name  TEXT  [NN]',
      '  email  TEXT',
      '  dept_id  INTEGER  [NN]',
      '  salary  REAL  [NN]  DEFAULT 0.0',
      '  hire_date  TEXT',
    ]);
  });

  it('sorts columns by declared ordinal regardless of input order', () => {
    const shuffled = [empColumns[4]!, empColumns[0]!, empColumns[2]!, empColumns[5]!, empColumns[1]!, empColumns[3]!];
    expect(renderColumns(shuffled, pkOnly)).toStrictEqual(renderColumns(empColumns, pkOnly));
  });

  it('renders the [FK→target] marker before [NN] when the annotation carries an FK target', () => {
    const withFk: ColumnAnnotations = {
      pk: new Set(['emp_id']),
      fk: new Map([['dept_id', 'main.departments']]),
    };
    expect(renderColumns([entry(colNode('dept_id', 'INTEGER', false, 4))], withFk)).toStrictEqual([
      'COLUMNS',
      '  dept_id  INTEGER  [FK→main.departments]  [NN]',
    ]);
  });

  it('returns [] when there are no columns', () => {
    expect(renderColumns([], pkOnly)).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.2 — renderConstraints / renderIndexes / renderTriggers
// ─────────────────────────────────────────────────────────────────────────────

describe('payload.renderConstraints (A.2)', () => {
  const empConstraints: NeighborEntry[] = [
    entry(constraintNode('fk_employees_0', 'FK', ['dept_id'])),
    entry(constraintNode('idx_emp_email', 'UNIQUE', ['email'])),
    entry(constraintNode('pk_employees', 'PK', ['emp_id'])),
  ];
  const a: ColumnAnnotations = { pk: new Set(['emp_id']), fk: new Map() };

  it('renders a CONSTRAINTS header + name-sorted rows, FK without target when annotation has none', () => {
    expect(renderConstraints(empConstraints, a)).toStrictEqual([
      'CONSTRAINTS',
      '  [FK]  fk_employees_0  (dept_id)',
      '  [UNIQUE]  idx_emp_email  (email)',
      '  [PK]  pk_employees  (emp_id)',
    ]);
  });

  it('renders the FK column → target mapping when the annotation carries a target', () => {
    const withFk: ColumnAnnotations = {
      pk: new Set(),
      fk: new Map([['dept_id', 'main.departments']]),
    };
    expect(renderConstraints([entry(constraintNode('fk_employees_0', 'FK', ['dept_id']))], withFk)).toStrictEqual([
      'CONSTRAINTS',
      '  [FK]  fk_employees_0  (dept_id → main.departments)',
    ]);
  });

  it('preserves composite key member columns in DECLARED order (never alphabetized)', () => {
    const composite: NeighborEntry[] = [
      entry(constraintNode('pk_assignments', 'PK', ['project_id', 'emp_id', 'dept_id'])),
    ];
    expect(renderConstraints(composite, { pk: new Set(), fk: new Map() })).toStrictEqual([
      'CONSTRAINTS',
      '  [PK]  pk_assignments  (project_id, emp_id, dept_id)',
    ]);
  });

  it('returns [] when there are no constraints', () => {
    expect(renderConstraints([], a)).toStrictEqual([]);
  });
});

describe('payload.renderIndexes (A.2)', () => {
  const empIndexes: NeighborEntry[] = [
    entry(indexNode('idx_emp_active_dept', false, ['dept_id'])),
    entry(indexNode('idx_emp_dept', false, ['dept_id', 'hire_date'])),
    entry(indexNode('idx_emp_email', true, ['email'])),
    entry(indexNode('idx_emp_email_lower', false, ['(expr)'])),
  ];

  it('renders an INDEXES header + name-sorted rows with UNIQUE/method markers', () => {
    expect(renderIndexes(empIndexes)).toStrictEqual([
      'INDEXES',
      '  idx_emp_active_dept  (dept_id)',
      '  idx_emp_dept  (dept_id, hire_date)',
      '  idx_emp_email  UNIQUE (email)',
      '  idx_emp_email_lower  ((expr))',
    ]);
  });

  it('renders a [method] suffix when present', () => {
    expect(renderIndexes([entry(indexNode('IX_orders_status', false, ['status'], 'BTREE'))])).toStrictEqual([
      'INDEXES',
      '  IX_orders_status  (status) [BTREE]',
    ]);
  });

  it('returns [] when there are no indexes', () => {
    expect(renderIndexes([])).toStrictEqual([]);
  });
});

describe('payload.renderTriggers (A.2)', () => {
  const empTriggers: NeighborEntry[] = [
    entry(triggerNode('trg_emp_after_delete', 'AFTER', ['DELETE'])),
    entry(triggerNode('trg_emp_after_insert', 'AFTER', ['INSERT'])),
    entry(triggerNode('trg_emp_before_insert', 'BEFORE', ['INSERT'])),
    entry(triggerNode('trg_emp_before_update', 'BEFORE', ['UPDATE'])),
    entry(triggerNode('trg_emp_salary_update', 'BEFORE', ['UPDATE'])),
  ];

  it('renders a TRIGGERS header + name-sorted rows with timing + events', () => {
    expect(renderTriggers(empTriggers)).toStrictEqual([
      'TRIGGERS',
      '  trg_emp_after_delete  AFTER DELETE',
      '  trg_emp_after_insert  AFTER INSERT',
      '  trg_emp_before_insert  BEFORE INSERT',
      '  trg_emp_before_update  BEFORE UPDATE',
      '  trg_emp_salary_update  BEFORE UPDATE',
    ]);
  });

  it('joins multiple events with a comma', () => {
    expect(renderTriggers([entry(triggerNode('trg_orders_audit', 'AFTER', ['INSERT', 'UPDATE']))])).toStrictEqual([
      'TRIGGERS',
      '  trg_orders_audit  AFTER INSERT, UPDATE',
    ]);
  });

  it('returns [] when there are no triggers', () => {
    expect(renderTriggers([])).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.3 — deriveColumnAnnotations (payload-present path only in Batch A)
// ─────────────────────────────────────────────────────────────────────────────

describe('payload.deriveColumnAnnotations — payload-present path (A.3)', () => {
  it('collects the PK column set and the FK colname → target map from the constraint payload', () => {
    const orderConstraints: NeighborEntry[] = [
      entry(constraintNode('PK_orders', 'PK', ['order_id'])),
      entry(constraintNode('FK_orders_customers', 'FK', ['customer_id'], 'dbo.customers.customer_id')),
    ];
    const ann = deriveColumnAnnotations(orderConstraints, []);
    expect([...ann.pk]).toStrictEqual(['order_id']);
    expect(ann.fk.get('customer_id')).toBe('dbo.customers.customer_id');
  });

  it('renders the payload FK target verbatim at column and constraint level', () => {
    const orderConstraints: NeighborEntry[] = [
      entry(constraintNode('FK_orders_customers', 'FK', ['customer_id'], 'dbo.customers.customer_id')),
    ];
    const orderColumns: NeighborEntry[] = [entry(colNode('customer_id', 'int', false, 2))];
    const ann = deriveColumnAnnotations(orderConstraints, []);
    expect(renderColumns(orderColumns, ann)).toStrictEqual([
      'COLUMNS',
      '  customer_id  int  [FK→dbo.customers.customer_id]  [NN]',
    ]);
    expect(renderConstraints(orderConstraints, ann)).toStrictEqual([
      'CONSTRAINTS',
      '  [FK]  FK_orders_customers  (customer_id → dbo.customers.customer_id)',
    ]);
  });

  it('preserves declared composite PK order in the derived set', () => {
    const composite: NeighborEntry[] = [
      entry(constraintNode('pk_assignments', 'PK', ['project_id', 'emp_id', 'dept_id'])),
    ];
    const ann = deriveColumnAnnotations(composite, []);
    expect([...ann.pk]).toStrictEqual(['project_id', 'emp_id', 'dept_id']);
  });

  it('does NOT reconstruct an FK target in Batch A when the payload carries none (empty references)', () => {
    const empFk: NeighborEntry[] = [entry(constraintNode('fk_employees_0', 'FK', ['dept_id']))];
    const ann = deriveColumnAnnotations(empFk, []);
    expect(ann.fk.size).toBe(0);
  });
});
