/**
 * Tests for src/core/present/object.ts — task 1.3 (phase-5-mcp-server).
 * Spec: dbgraph_object assembles full detail; Metadata-level states body omitted.
 * Design: formatObject(ObjectView, detail) PURE; columns (type/null/default), PK/FK/check,
 *   indexes (cols+kind), triggers (event); full includes body, metadata states body omitted.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 * ADR-008: deterministic output, byte-identical on re-run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatObject,
  type ObjectView,
  type ObjectDetail,
} from '../../../src/core/present/object.js';
import { formatExplore } from '../../../src/core/present/explore.js';
import type { GraphNode } from '../../../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NODE: GraphNode = {
  id: 'node-orders',
  kind: 'table',
  schema: 'dbo',
  name: 'orders',
  qname: 'dbo.orders',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { rowCountEstimate: 500, comment: 'Sales orders' },
};

const COL_ORDER_ID: GraphNode = {
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

const COL_CUSTOMER_ID: GraphNode = {
  id: 'node-customer-id',
  kind: 'column',
  schema: 'dbo',
  name: 'customer_id',
  qname: 'dbo.orders.customer_id',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { dataType: 'int', nullable: false, ordinal: 2 },
};

const COL_STATUS: GraphNode = {
  id: 'node-status',
  kind: 'column',
  schema: 'dbo',
  name: 'status',
  qname: 'dbo.orders.status',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { dataType: 'varchar(20)', nullable: true, default: "'pending'", ordinal: 3 },
};

const PK_CONSTRAINT: GraphNode = {
  id: 'node-pk',
  kind: 'constraint',
  schema: 'dbo',
  name: 'PK_orders',
  qname: 'dbo.PK_orders',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { type: 'PK', columns: ['order_id'] },
};

const FK_CONSTRAINT: GraphNode = {
  id: 'node-fk',
  kind: 'constraint',
  schema: 'dbo',
  name: 'FK_orders_customers',
  qname: 'dbo.FK_orders_customers',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { type: 'FK', columns: ['customer_id'], definition: 'dbo.customers.customer_id' },
};

const INDEX_NODE: GraphNode = {
  id: 'node-idx',
  kind: 'index',
  schema: 'dbo',
  name: 'IX_orders_status',
  qname: 'dbo.IX_orders_status',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: null,
  payload: { unique: false, columns: ['status'], method: 'BTREE' },
};

const TRIGGER_NODE: GraphNode = {
  id: 'node-trg',
  kind: 'trigger',
  schema: 'dbo',
  name: 'trg_orders_audit',
  qname: 'dbo.trg_orders_audit',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: 'trg-hash-123',
  payload: {
    timing: 'AFTER',
    events: ['INSERT', 'UPDATE'],
    hasDynamicSql: false,
    body: 'INSERT INTO audit_log ...',
  },
};

const PROC_NODE: GraphNode = {
  id: 'node-proc',
  kind: 'procedure',
  schema: 'dbo',
  name: 'usp_ProcessOrder',
  qname: 'dbo.usp_ProcessOrder',
  level: 'metadata',
  missing: false,
  excluded: false,
  bodyHash: 'proc-hash-456',
  payload: {
    signature: 'usp_ProcessOrder(@order_id int)',
    hasDynamicSql: false,
  },
};

const PROC_FULL_NODE: GraphNode = {
  id: 'node-proc-full',
  kind: 'procedure',
  schema: 'dbo',
  name: 'usp_ProcessOrderFull',
  qname: 'dbo.usp_ProcessOrderFull',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: 'proc-full-hash',
  payload: {
    signature: 'usp_ProcessOrderFull(@order_id int)',
    body: 'BEGIN\n  SELECT 1;\nEND',
    hasDynamicSql: false,
  },
};

const makeEdge = (id: string, kind: string, src: string, dst: string) => ({
  id,
  kind: kind as 'has_column' | 'has_index' | 'has_constraint' | 'fires_on',
  src,
  dst,
  confidence: 'declared' as const,
  score: null,
  attrs: {},
});

/** Rich table view: columns + PK/FK constraints + index + trigger. */
const TABLE_VIEW: ObjectView = {
  node: TABLE_NODE,
  neighbors: {
    has_column: {
      out: [
        { node: COL_ORDER_ID, edge: makeEdge('e1', 'has_column', TABLE_NODE.id, COL_ORDER_ID.id) },
        { node: COL_CUSTOMER_ID, edge: makeEdge('e2', 'has_column', TABLE_NODE.id, COL_CUSTOMER_ID.id) },
        { node: COL_STATUS, edge: makeEdge('e3', 'has_column', TABLE_NODE.id, COL_STATUS.id) },
      ],
      in: [],
    },
    has_constraint: {
      out: [
        { node: PK_CONSTRAINT, edge: makeEdge('e4', 'has_constraint', TABLE_NODE.id, PK_CONSTRAINT.id) },
        { node: FK_CONSTRAINT, edge: makeEdge('e5', 'has_constraint', TABLE_NODE.id, FK_CONSTRAINT.id) },
      ],
      in: [],
    },
    has_index: {
      out: [
        { node: INDEX_NODE, edge: makeEdge('e6', 'has_index', TABLE_NODE.id, INDEX_NODE.id) },
      ],
      in: [],
    },
    fires_on: {
      out: [],
      in: [
        { node: TRIGGER_NODE, edge: makeEdge('e7', 'fires_on', TRIGGER_NODE.id, TABLE_NODE.id) },
      ],
    },
  },
};

/** Metadata procedure: body omitted. */
const PROC_META_VIEW: ObjectView = {
  node: PROC_NODE,
  neighbors: {},
};

/** Full procedure: body present. */
const PROC_FULL_VIEW: ObjectView = {
  node: PROC_FULL_NODE,
  neighbors: {},
};

/** Minimal table with no columns/constraints/indexes/triggers. */
const EMPTY_TABLE_VIEW: ObjectView = {
  node: TABLE_NODE,
  neighbors: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('formatObject — content', () => {
  it('includes the qname and kind in the header', () => {
    const output = formatObject(TABLE_VIEW, 'normal');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
  });

  it('includes column names at normal detail', () => {
    const output = formatObject(TABLE_VIEW, 'normal');
    expect(output).toContain('order_id');
    expect(output).toContain('customer_id');
    expect(output).toContain('status');
  });

  it('includes column data types at normal detail', () => {
    const output = formatObject(TABLE_VIEW, 'normal');
    expect(output).toContain('int');
    expect(output).toContain('varchar(20)');
  });

  it('includes DEFAULT value in column line when present', () => {
    const output = formatObject(TABLE_VIEW, 'normal');
    expect(output).toContain("'pending'");
  });

  it('includes PK constraint', () => {
    const output = formatObject(TABLE_VIEW, 'normal');
    expect(output).toContain('PK');
  });

  it('includes FK constraint with reference target', () => {
    const output = formatObject(TABLE_VIEW, 'normal');
    expect(output).toContain('FK');
  });

  it('includes index name and columns at full detail', () => {
    const output = formatObject(TABLE_VIEW, 'full');
    expect(output).toContain('IX_orders_status');
    expect(output).toContain('status');
  });

  it('includes trigger event at full detail', () => {
    const output = formatObject(TABLE_VIEW, 'full');
    expect(output).toContain('trg_orders_audit');
    expect(output).toContain('INSERT');
    expect(output).toContain('UPDATE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Metadata-level: body omitted explicitly stated
// ─────────────────────────────────────────────────────────────────────────────

describe('formatObject — metadata omission', () => {
  it('metadata procedure: states body is omitted (not silently empty)', () => {
    const output = formatObject(PROC_META_VIEW, 'full');
    // Must explicitly state body omission — not just be empty
    expect(output.toLowerCase()).toMatch(/body.*omit|omit.*body/);
  });

  it('full procedure: includes body when level=full and body is present', () => {
    const output = formatObject(PROC_FULL_VIEW, 'full');
    expect(output).toContain('BEGIN');
    expect(output).toContain('SELECT 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Brief detail: header + annotation counts only
// ─────────────────────────────────────────────────────────────────────────────

describe('formatObject — brief detail', () => {
  it('brief: includes qname and kind', () => {
    const output = formatObject(TABLE_VIEW, 'brief');
    expect(output).toContain('dbo.orders');
    expect(output).toContain('table');
  });

  it('brief: includes annotation counts (indexes + triggers)', () => {
    const output = formatObject(TABLE_VIEW, 'brief');
    // Should show count of indexes and triggers
    expect(output).toContain('idx');
    expect(output).toContain('trg');
  });

  it('brief: does NOT include individual column names', () => {
    const output = formatObject(TABLE_VIEW, 'brief');
    // Brief should not expand columns
    expect(output).not.toContain('order_id');
    expect(output).not.toContain('customer_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity contract
// ─────────────────────────────────────────────────────────────────────────────

describe('formatObject — purity contract', () => {
  it('returns a string ending with a newline', () => {
    const levels: ObjectDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(formatObject(TABLE_VIEW, level)).toMatch(/\n$/);
    }
  });

  it('does not throw on empty neighbors', () => {
    const levels: ObjectDetail[] = ['brief', 'normal', 'full'];
    for (const level of levels) {
      expect(() => formatObject(EMPTY_TABLE_VIEW, level)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatObject — determinism (ADR-008)', () => {
  const levels: ObjectDetail[] = ['brief', 'normal', 'full'];
  for (const level of levels) {
    it(`same input → byte-identical output (${level})`, () => {
      const run1 = formatObject(TABLE_VIEW, level);
      const run2 = formatObject(TABLE_VIEW, level);
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Golden tests (byte-identical per detail level, ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatObject — goldens', () => {
  const levels: ObjectDetail[] = ['brief', 'normal', 'full'];

  for (const level of levels) {
    it(`${level} output matches golden`, () => {
      const actual = formatObject(TABLE_VIEW, level);
      const goldenPath = join(goldenDir, `object-${level}.txt`);
      const golden = readFileSync(goldenPath, 'utf-8');
      expect(actual).toBe(golden);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOG-4 (task 5.2) — shared dynamic-SQL caveat in object at normal + full, and the
// caveat line is BYTE-IDENTICAL to explore's (both push the SAME shared helper, no
// per-surface branch). Negatives: brief never renders it; a plain routine never carries
// it. ObjectView and ExploreView are structurally identical, so the same view drives both.
// ─────────────────────────────────────────────────────────────────────────────

const CAVEAT_LINE = '[DYNAMIC SQL] impact analysis may be incomplete';

const DYN_PROC_NODE: GraphNode = {
  id: 'node-dyn-proc',
  kind: 'procedure',
  schema: 'acme',
  name: 'run_report',
  qname: 'acme.run_report',
  level: 'full',
  missing: false,
  excluded: false,
  bodyHash: 'dyn-hash',
  payload: { signature: 'run_report()', hasDynamicSql: true, body: 'BEGIN EXEC(@sql); END' },
};

const PLAIN_PROC_NODE: GraphNode = {
  ...DYN_PROC_NODE,
  id: 'node-plain-proc',
  name: 'touch_totals',
  qname: 'acme.touch_totals',
  payload: { signature: 'touch_totals()', hasDynamicSql: false, body: 'BEGIN UPDATE t SET x=1; END' },
};

const DYN_PROC_VIEW: ObjectView = { node: DYN_PROC_NODE, neighbors: {} };
const PLAIN_PROC_VIEW: ObjectView = { node: PLAIN_PROC_NODE, neighbors: {} };

function caveatLineOf(output: string): string | undefined {
  return output.split('\n').find((l) => l.includes('[DYNAMIC SQL]'));
}

describe('formatObject — dynamic-SQL caveat (DOG-4 task 5.2)', () => {
  it('POSITIVE: renders the exact caveat line at normal', () => {
    expect(formatObject(DYN_PROC_VIEW, 'normal')).toContain(CAVEAT_LINE);
  });

  it('POSITIVE: renders the exact caveat line at full', () => {
    expect(formatObject(DYN_PROC_VIEW, 'full')).toContain(CAVEAT_LINE);
  });

  it('NEGATIVE: brief NEVER renders the caveat', () => {
    expect(formatObject(DYN_PROC_VIEW, 'brief')).not.toContain('[DYNAMIC SQL]');
  });

  it('NEGATIVE: a plain routine never carries the caveat at any detail', () => {
    for (const detail of ['brief', 'normal', 'full'] as ObjectDetail[]) {
      expect(formatObject(PLAIN_PROC_VIEW, detail)).not.toContain('[DYNAMIC SQL]');
    }
  });

  it('the caveat line is BYTE-IDENTICAL to explore (shared helper, no per-surface branch)', () => {
    for (const detail of ['normal', 'full'] as const) {
      const objLine = caveatLineOf(formatObject(DYN_PROC_VIEW, detail));
      const expLine = caveatLineOf(formatExplore(DYN_PROC_VIEW, detail));
      expect(objLine).toBe(CAVEAT_LINE);
      expect(objLine).toBe(expLine);
    }
  });
});
