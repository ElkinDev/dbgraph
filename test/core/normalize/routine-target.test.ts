/**
 * DOG-1 A.2 — normalize routine-target resolution + the `calls` branch (D5).
 * Strict TDD RED: `resolveRoutineTarget` and the routine branch in `buildDependencyEdges`
 * do not exist yet.
 *
 * Engine-agnostic, written ONCE. `buildDependencyEdges` branches on the preserved
 * `RawDependency.target.kind`: a routine target (`procedure`/`function`) resolves to the
 * ACTUAL routine node and emits ONE `calls` edge carrying `dep.confidence` UNCHANGED; an
 * unresolved routine target emits NO edge and mints NO stub (ADR-007). Every non-routine
 * target keeps the existing read/write branch byte-for-byte.
 *
 * L-009: EXACT src→dst qname sets per kind + explicit negatives (no read/write to the
 * callee, no self edge unless real recursion, no phantom `[table]` stub). Existence-only
 * assertions are FORBIDDEN.
 *
 * Spec: graph-normalization S6/S7/S8/S9.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../../../src/core/normalize/normalize.js';
import {
  resolveRoutineTarget,
  isRoutineKind,
  type NodeMap,
} from '../../../src/core/normalize/reference-resolver.js';
import { nodeId, canonicalQName } from '../../../src/core/normalize/id.js';
import type { RawObject, RawDependency } from '../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../src/core/model/graph.js';
import type { GraphNode, NodeKind } from '../../../src/core/model/node.js';
import type { EdgeKind } from '../../../src/core/model/edge.js';

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
    columns: [{ name: 'id', dataType: 'int', nullable: false, ordinal: 1 }],
    constraints: [],
    indexes: [],
  };
}

function routine(
  kind: 'procedure' | 'function',
  schema: string,
  name: string,
  dependencies: RawDependency[],
): RawObject {
  return { kind, schema, name, body: `CREATE ${kind} ${name} ...`, dependencies };
}

function dep(
  schema: string,
  name: string,
  access: 'read' | 'write',
  confidence: 'declared' | 'parsed',
  kind?: NodeKind,
): RawDependency {
  return { target: { schema, name, ...(kind !== undefined ? { kind } : {}) }, access, confidence };
}

function build(objects: RawObject[]): NormalizationResult {
  return normalizeCatalog({ engine: 'mssql', schemas: ['dbo'], objects }, FULL_SCOPE);
}

/** src→dst qname pairs for every edge of the given kind. */
function edgePairs(result: NormalizationResult, kind: EdgeKind): Set<string> {
  const idToQName = new Map(result.graph.nodes.map((n) => [n.id, n.qname]));
  return new Set(
    result.graph.edges
      .filter((e) => e.kind === kind)
      .map((e) => `${idToQName.get(e.src) ?? e.src}→${idToQName.get(e.dst) ?? e.dst}`),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveRoutineTarget — direct unit (probe [procedure, function], no stub)
// ─────────────────────────────────────────────────────────────────────────────

function realRoutineNode(kind: 'procedure' | 'function', schema: string, name: string): GraphNode {
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

describe('resolveRoutineTarget — probes procedure then function, never stubs', () => {
  it('returns a real PROCEDURE node when present', () => {
    const map: NodeMap = new Map();
    const p = realRoutineNode('procedure', 'dbo', 'usp_log_change');
    map.set(`procedure:${p.qname}`, p);
    const node = resolveRoutineTarget('dbo', 'usp_log_change', map);
    expect(node).not.toBeNull();
    expect(node!.kind).toBe('procedure');
    expect(node!.qname).toBe('dbo.usp_log_change');
  });

  it('resolves cross-kind to a real FUNCTION node when no procedure exists', () => {
    const map: NodeMap = new Map();
    const f = realRoutineNode('function', 'dbo', 'fn_round_money');
    map.set(`function:${f.qname}`, f);
    const node = resolveRoutineTarget('dbo', 'fn_round_money', map);
    expect(node).not.toBeNull();
    expect(node!.kind).toBe('function');
  });

  it('returns null and mints NO stub when no routine node exists', () => {
    const map: NodeMap = new Map();
    const node = resolveRoutineTarget('dbo', 'count', map);
    expect(node).toBeNull();
    expect(map.size).toBe(0); // no stub was added to the map
  });

  it('ignores a missing/excluded stub node (only REAL routines resolve)', () => {
    const map: NodeMap = new Map();
    const stub = { ...realRoutineNode('procedure', 'dbo', 'ghost'), missing: true };
    map.set(`procedure:${stub.qname}`, stub);
    expect(resolveRoutineTarget('dbo', 'ghost', map)).toBeNull();
  });
});

describe('isRoutineKind', () => {
  it('is true only for procedure and function', () => {
    expect(isRoutineKind('procedure')).toBe(true);
    expect(isRoutineKind('function')).toBe(true);
    expect(isRoutineKind('table')).toBe(false);
    expect(isRoutineKind('view')).toBe(false);
    expect(isRoutineKind(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — proc→proc yields EXACTLY one calls edge and ZERO table stub (regression pin)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalize — proc→proc emits exactly one calls edge, no reads/writes, no stub (S6)', () => {
  const result = build([
    table('dbo', 'order_totals'),
    table('dbo', 'audit_log'),
    routine('procedure', 'dbo', 'usp_refresh_totals', [
      dep('dbo', 'usp_log_change', 'read', 'declared', 'procedure'),
      dep('dbo', 'order_totals', 'write', 'parsed'),
    ]),
    routine('procedure', 'dbo', 'usp_log_change', [
      dep('dbo', 'audit_log', 'write', 'parsed'),
    ]),
  ]);

  it('calls edges are EXACTLY { usp_refresh_totals → usp_log_change }', () => {
    expect(edgePairs(result, 'calls')).toStrictEqual(
      new Set(['dbo.usp_refresh_totals→dbo.usp_log_change']),
    );
  });

  it('the calls edge carries confidence declared and a null score', () => {
    const calls = result.graph.edges.filter((e) => e.kind === 'calls');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.confidence).toBe('declared');
    expect(calls[0]!.score).toBeNull();
    expect(calls[0]!.attrs).toStrictEqual({});
  });

  it('writes_to edges are EXACTLY the two real-table writes (parsed) — none to usp_log_change', () => {
    expect(edgePairs(result, 'writes_to')).toStrictEqual(
      new Set([
        'dbo.usp_refresh_totals→dbo.order_totals',
        'dbo.usp_log_change→dbo.audit_log',
      ]),
    );
  });

  it('NEGATIVE: no reads_from edge to usp_log_change and no reads_from at all here', () => {
    expect(edgePairs(result, 'reads_from')).toStrictEqual(new Set());
  });

  it('NEGATIVE: no phantom [table] usp_log_change stub is minted (stubCount 0 for it)', () => {
    const tableStub = result.graph.nodes.find(
      (n) => n.kind === 'table' && n.qname === 'dbo.usp_log_change',
    );
    expect(tableStub).toBeUndefined();
    expect(result.stubs.filter((s) => s.qname === 'dbo.usp_log_change')).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S7 — unresolved routine target invents no edge and no stub (negative)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalize — unresolved routine target (builtin count) invents nothing (S7)', () => {
  const result = build([
    routine('procedure', 'dbo', 'usp_uses_builtin', [
      dep('dbo', 'count', 'read', 'declared', 'function'),
    ]),
  ]);

  it('emits ZERO calls edges', () => {
    expect(edgePairs(result, 'calls')).toStrictEqual(new Set());
  });

  it('mints NO stub of any kind for the unresolved target', () => {
    expect(result.stubs.filter((s) => s.qname === 'dbo.count')).toStrictEqual([]);
    expect(result.graph.nodes.find((n) => n.qname === 'dbo.count')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S8 — routine touching only tables emits zero calls edges (negative)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalize — table-only routine keeps read/write parsed, ZERO calls (S8)', () => {
  const result = build([
    table('dbo', 'audit_log'),
    table('dbo', 'order_totals'),
    routine('procedure', 'dbo', 'usp_tables_only', [
      dep('dbo', 'order_totals', 'read', 'parsed'),
      dep('dbo', 'audit_log', 'write', 'parsed'),
    ]),
  ]);

  it('reads_from and writes_to are the exact table sets with parsed confidence', () => {
    expect(edgePairs(result, 'reads_from')).toStrictEqual(
      new Set(['dbo.usp_tables_only→dbo.order_totals']),
    );
    expect(edgePairs(result, 'writes_to')).toStrictEqual(
      new Set(['dbo.usp_tables_only→dbo.audit_log']),
    );
    const rw = result.graph.edges.filter((e) => e.kind === 'reads_from' || e.kind === 'writes_to');
    expect(rw.every((e) => e.confidence === 'parsed')).toBe(true);
  });

  it('emits ZERO calls edges', () => {
    expect(edgePairs(result, 'calls')).toStrictEqual(new Set());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S9 — self-call emitted ONLY when recursion is real
// ─────────────────────────────────────────────────────────────────────────────

describe('normalize — self-call only for genuine recursion (S9)', () => {
  const result = build([
    table('dbo', 'audit_log'),
    routine('procedure', 'dbo', 'usp_recursive', [
      dep('dbo', 'usp_recursive', 'read', 'declared', 'procedure'),
    ]),
    routine('procedure', 'dbo', 'usp_plain', [
      dep('dbo', 'audit_log', 'write', 'parsed'),
    ]),
  ]);

  it('exactly one self-calls edge for the recursive routine', () => {
    expect(edgePairs(result, 'calls')).toStrictEqual(
      new Set(['dbo.usp_recursive→dbo.usp_recursive']),
    );
    const selfEdge = result.graph.edges.find((e) => e.kind === 'calls');
    expect(selfEdge!.src).toBe(selfEdge!.dst);
  });

  it('NEGATIVE: the non-recursive routine has no self-calls edge', () => {
    const plainId = nodeId('procedure', 'dbo.usp_plain');
    const selfCalls = result.graph.edges.filter(
      (e) => e.kind === 'calls' && e.src === plainId && e.dst === plainId,
    );
    expect(selfCalls).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism (ADR-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalize — calls edges are deterministic (ADR-008)', () => {
  it('normalize twice → identical calls edge set', () => {
    const objs: RawObject[] = [
      table('dbo', 'order_totals'),
      routine('procedure', 'dbo', 'usp_refresh_totals', [
        dep('dbo', 'usp_log_change', 'read', 'declared', 'procedure'),
        dep('dbo', 'order_totals', 'write', 'parsed'),
      ]),
      routine('procedure', 'dbo', 'usp_log_change', []),
    ];
    expect(edgePairs(build(objs), 'calls')).toStrictEqual(edgePairs(build(objs), 'calls'));
  });
});
