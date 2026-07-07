/**
 * DOG-1 A.7 — DEFAULT-CI synthetic tier: an in-memory mssql `RawCatalog` carrying the
 * routine-calls-routine chain (as the adapter would produce it) is normalized OFFLINE and
 * pinned with L-009 exact-set assertions. No container.
 *
 * Proves the end-to-end declared-`calls` semantics + the regression that a proc→proc
 * invocation mints NO phantom `[table]` stub for the callee.
 *
 * Spec: mssql-extraction (S15/S16/S17), graph-model "mssql calls is declared" (S4 declared side).
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawCatalog, RawObject, RawDependency } from '../../../../src/core/model/catalog.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { EdgeKind } from '../../../../src/core/model/edge.js';

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

function table(name: string): RawObject {
  return {
    kind: 'table',
    schema: 'dbo',
    name,
    columns: [{ name: 'order_id', dataType: 'int', nullable: false, ordinal: 1 }],
    constraints: [],
    indexes: [],
  };
}

function proc(name: string, deps: RawDependency[]): RawObject {
  return { kind: 'procedure', schema: 'dbo', name, body: `CREATE PROCEDURE dbo.${name} ...`, dependencies: deps };
}

function fn(name: string, deps: RawDependency[]): RawObject {
  return { kind: 'function', schema: 'dbo', name, body: `CREATE FUNCTION dbo.${name} ...`, dependencies: deps };
}

const callsDep = (name: string, kind: 'procedure' | 'function'): RawDependency => ({
  target: { schema: 'dbo', name, kind },
  access: 'read',
  confidence: 'declared',
});
const writeDep = (name: string): RawDependency => ({
  target: { schema: 'dbo', name },
  access: 'write',
  confidence: 'parsed',
});

// The mssql torture chain, as the adapter's tokenizer produces it.
const CATALOG: RawCatalog = {
  engine: 'mssql',
  schemas: ['dbo'],
  objects: [
    table('order_totals'),
    table('audit_log'),
    proc('usp_refresh_totals', [callsDep('usp_log_change', 'procedure'), writeDep('order_totals')]),
    proc('usp_log_change', [writeDep('audit_log')]),
    fn('fn_net_amount', [callsDep('fn_round_money', 'function')]),
    fn('fn_round_money', []),
  ],
};

const norm: NormalizationResult = normalizeCatalog(CATALOG, FULL_SCOPE);
const idToQName = new Map(norm.graph.nodes.map((n) => [n.id, n.qname]));

function pairs(kind: EdgeKind): Set<string> {
  return new Set(
    norm.graph.edges
      .filter((e) => e.kind === kind)
      .map((e) => `${idToQName.get(e.src) ?? e.src}→${idToQName.get(e.dst) ?? e.dst}`),
  );
}

/** { src→dst → confidence } for a given kind. */
function conf(kind: EdgeKind): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of norm.graph.edges.filter((x) => x.kind === kind)) {
    m.set(`${idToQName.get(e.src)}→${idToQName.get(e.dst)}`, e.confidence);
  }
  return m;
}

describe('mssql synthetic normalize — calls edges (L-009 exact set)', () => {
  it('calls edges are EXACTLY the two declared routine invocations', () => {
    expect(pairs('calls')).toStrictEqual(
      new Set([
        'dbo.usp_refresh_totals→dbo.usp_log_change',
        'dbo.fn_net_amount→dbo.fn_round_money',
      ]),
    );
  });

  it('both calls edges carry confidence declared', () => {
    const c = conf('calls');
    expect(c.get('dbo.usp_refresh_totals→dbo.usp_log_change')).toBe('declared');
    expect(c.get('dbo.fn_net_amount→dbo.fn_round_money')).toBe('declared');
  });
});

describe('mssql synthetic normalize — usp_refresh_totals emits EXACTLY its two edges', () => {
  it('writes_to is EXACTLY { usp_refresh_totals→order_totals, usp_log_change→audit_log } (parsed)', () => {
    expect(pairs('writes_to')).toStrictEqual(
      new Set([
        'dbo.usp_refresh_totals→dbo.order_totals',
        'dbo.usp_log_change→dbo.audit_log',
      ]),
    );
    const c = conf('writes_to');
    expect(c.get('dbo.usp_refresh_totals→dbo.order_totals')).toBe('parsed');
    expect(c.get('dbo.usp_log_change→dbo.audit_log')).toBe('parsed');
  });

  it('NEGATIVE: NO reads_from/writes_to edge from usp_refresh_totals to usp_log_change', () => {
    const bad = new Set([...pairs('reads_from'), ...pairs('writes_to')]);
    expect(bad.has('dbo.usp_refresh_totals→dbo.usp_log_change')).toBe(false);
  });

  it('NEGATIVE: usp_log_change emits ZERO calls edges', () => {
    const fromLogChange = [...pairs('calls')].filter((p) => p.startsWith('dbo.usp_log_change→'));
    expect(fromLogChange).toStrictEqual([]);
  });
});

describe('mssql synthetic normalize — regression: no phantom [table] usp_log_change stub', () => {
  it('no table node/stub named usp_log_change is minted (stubCount for it is zero)', () => {
    const tableStub = norm.graph.nodes.find(
      (n) => n.kind === 'table' && n.qname === 'dbo.usp_log_change',
    );
    expect(tableStub).toBeUndefined();
    expect(norm.stubs.filter((s) => s.qname === 'dbo.usp_log_change')).toStrictEqual([]);
    // fn_round_money likewise resolves to a real routine, no stub
    expect(norm.stubs.filter((s) => s.qname === 'dbo.fn_round_money')).toStrictEqual([]);
  });

  it('the graph has ZERO missing stubs of any kind (every target is a real node)', () => {
    expect(norm.stubs.filter((s) => s.reason === 'missing')).toStrictEqual([]);
  });
});
