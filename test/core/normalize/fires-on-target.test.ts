/**
 * RED+GREEN tests for B3.1 (sqlite-view-deps): resolveTriggerTarget + buildFiresOnEdges.
 *
 * Design D4 — a trigger `fires_on` target is resolved to the ACTUAL existing node kind:
 *   - a trigger on a real VIEW resolves to that `view` node (no phantom `[table]` stub);
 *   - a trigger on a real TABLE resolves to that `table` node, and its `fires_on` edge id
 *     `edgeId('fires_on', trig, dst, event)` is UNCHANGED (byte-identical regression pin);
 *   - a trigger on a genuinely MISSING object still becomes a `missing:true` stub of kind table.
 *
 * Cross-engine blast radius is EMPTY (D4): pg/mssql/mysql triggers fire on TABLES, so the
 * table-first probe returns the same node they did before — proven here engine-agnostically.
 *
 * L-009: exact assertions + explicit negatives (no phantom stub minted).
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import {
  resolveTriggerTarget,
  type NodeMap,
} from '../../../src/core/normalize/reference-resolver.js';
import { nodeId, edgeId, canonicalQName } from '../../../src/core/normalize/id.js';
import type { RawCatalog, RawObject } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { GraphNode } from '../../../src/core/model/node.js';

const FULL_SCOPE: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'full',
    fields: 'full',
    statistics: 'off',
    sampling: 'off',
  },
};

function table(schema: string, name: string): RawObject {
  return {
    kind: 'table',
    schema,
    name,
    columns: [{ name: 'id', dataType: 'INTEGER', nullable: false, ordinal: 0 }],
    constraints: [],
    indexes: [],
  };
}

function view(schema: string, name: string): RawObject {
  return { kind: 'view', schema, name, body: `CREATE VIEW ${name} AS SELECT id FROM t`, dependencies: [] };
}

function trigger(schema: string, name: string, onSchema: string, onName: string): RawObject {
  return {
    kind: 'trigger',
    schema,
    name,
    trigger: { timing: 'INSTEAD OF', events: ['INSERT'], table: { schema: onSchema, name: onName } },
    dependencies: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Via normalizeCatalog — the wired behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('buildFiresOnEdges — trigger on a VIEW resolves to the view node (no phantom stub)', () => {
  const catalog: RawCatalog = {
    engine: 'sqlite',
    schemas: ['main'],
    objects: [
      table('main', 'departments'),
      view('main', 'active_departments'),
      trigger('main', 'trg_instead', 'main', 'active_departments'),
    ],
  };
  const result = normalizeCatalog(catalog, FULL_SCOPE);
  const firesOn = result.graph.edges.filter((e) => e.kind === 'fires_on');

  it('fires_on targets the VIEW node (kind view)', () => {
    expect(firesOn).toHaveLength(1);
    const target = result.graph.nodes.find((n) => n.id === firesOn[0]!.dst);
    expect(target).toBeDefined();
    expect(target!.kind).toBe('view');
    expect(target!.qname).toBe('main.active_departments');
  });

  it('NO phantom [table] active_departments stub is minted', () => {
    const tableStub = result.graph.nodes.find(
      (n) => n.kind === 'table' && n.qname === 'main.active_departments',
    );
    expect(tableStub).toBeUndefined();
    expect(result.stubs.filter((s) => s.qname === 'main.active_departments')).toStrictEqual([]);
  });
});

describe('buildFiresOnEdges — trigger on a TABLE keeps its exact fires_on edge id (regression pin)', () => {
  const catalog: RawCatalog = {
    engine: 'sqlite',
    schemas: ['main'],
    objects: [table('main', 'employees'), trigger('main', 'trg_tbl', 'main', 'employees')],
  };
  const result = normalizeCatalog(catalog, FULL_SCOPE);

  it('fires_on targets the TABLE node with the UNCHANGED edge id', () => {
    const firesOn = result.graph.edges.filter((e) => e.kind === 'fires_on');
    expect(firesOn).toHaveLength(1);

    const trigId = nodeId('trigger', canonicalQName('main', 'trg_tbl'));
    const tableId = nodeId('table', canonicalQName('main', 'employees'));
    const expectedEdgeId = edgeId('fires_on', trigId, tableId, 'INSERT');

    expect(firesOn[0]!.dst).toBe(tableId);
    expect(firesOn[0]!.id).toBe(expectedEdgeId);

    const target = result.graph.nodes.find((n) => n.id === firesOn[0]!.dst);
    expect(target!.kind).toBe('table');
  });
});

describe('buildFiresOnEdges — trigger on a MISSING object still stubs as [table]', () => {
  const catalog: RawCatalog = {
    engine: 'sqlite',
    schemas: ['main'],
    objects: [trigger('main', 'trg_ghost', 'main', 'ghost_object')],
  };
  const result = normalizeCatalog(catalog, FULL_SCOPE);

  it('a missing:true table stub is created for the absent target', () => {
    const stub = result.graph.nodes.find((n) => n.qname === 'main.ghost_object');
    expect(stub).toBeDefined();
    expect(stub!.kind).toBe('table');
    expect(stub!.missing).toBe(true);
    expect(result.stubs.map((s) => s.qname)).toContain('main.ghost_object');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direct unit tests of resolveTriggerTarget — probe order + fallback
// ─────────────────────────────────────────────────────────────────────────────

function realNode(kind: 'table' | 'view', schema: string, name: string): GraphNode {
  const qname = canonicalQName(schema, name);
  return {
    id: nodeId(kind, qname),
    kind,
    schema,
    name: name.toLowerCase(),
    qname,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: {},
  };
}

describe('resolveTriggerTarget — probe [table, view] then stub', () => {
  it('prefers a real TABLE node when both a table and view could match by name', () => {
    const map: NodeMap = new Map();
    const t = realNode('table', 'main', 'thing');
    map.set(`table:${t.qname}`, t);
    const res = resolveTriggerTarget('main', 'thing', map, new Set(), 'src');
    expect(res.node.kind).toBe('table');
    expect(res.isStub).toBe(false);
  });

  it('resolves to a real VIEW node when no real table exists', () => {
    const map: NodeMap = new Map();
    const v = realNode('view', 'main', 'active_departments');
    map.set(`view:${v.qname}`, v);
    const res = resolveTriggerTarget('main', 'active_departments', map, new Set(), 'src');
    expect(res.node.kind).toBe('view');
    expect(res.isStub).toBe(false);
  });

  it('falls back to a missing [table] stub when neither a real table nor view exists', () => {
    const map: NodeMap = new Map();
    const res = resolveTriggerTarget('main', 'nope', map, new Set(), 'src');
    expect(res.node.kind).toBe('table');
    expect(res.isStub).toBe(true);
    expect(res.stubInfo?.reason).toBe('missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3.3 — cross-engine no-drift: table-firing triggers on every engine are unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-engine table-firing triggers keep byte-identical fires_on edges (D4)', () => {
  for (const [engine, schema] of [
    ['pg', 'app'],
    ['mssql', 'dbo'],
    ['mysql', 'shop'],
  ] as const) {
    it(`${engine}: trigger on ${schema}.orders resolves to the table with the unchanged edge id`, () => {
      const catalog: RawCatalog = {
        engine,
        schemas: [schema],
        objects: [table(schema, 'orders'), trigger(schema, 'trg_orders', schema, 'orders')],
      };
      const result = normalizeCatalog(catalog, FULL_SCOPE);
      const firesOn = result.graph.edges.filter((e) => e.kind === 'fires_on');
      expect(firesOn).toHaveLength(1);

      const trigId = nodeId('trigger', canonicalQName(schema, 'trg_orders'));
      const tableId = nodeId('table', canonicalQName(schema, 'orders'));
      expect(firesOn[0]!.dst).toBe(tableId);
      expect(firesOn[0]!.id).toBe(edgeId('fires_on', trigId, tableId, 'INSERT'));

      // No phantom view stub sneaks in for a real table (would break the "try view first" rejection).
      const viewStub = result.graph.nodes.find(
        (n) => n.kind === 'view' && n.qname === canonicalQName(schema, 'orders'),
      );
      expect(viewStub).toBeUndefined();
    });
  }
});
