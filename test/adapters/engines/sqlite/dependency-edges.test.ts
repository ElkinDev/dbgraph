/**
 * L-009 EXACT-set integration (Batch B2.3, sqlite-view-deps).
 * Pipeline: torture.sql → materialize → adapter.extract → normalizeCatalog.
 *
 * Asserts the FULL src+dst qname SETS of the body-derived dependency edges the SQLite
 * adapter now emits, plus the explicit NEGATIVES that guard the trigger ON-header leak
 * and phantom/self edges. Existence-only assertions are FORBIDDEN (L-009): every positive
 * is an EXACT `.toStrictEqual` on the whole set, every negative is an explicit absence.
 *
 * The `main.` schema prefix is taken from what the graph ACTUALLY produces (node qnames),
 * confirmed against test/fixtures/sqlite/golden-raw-catalog.json (spec open question b).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../../../fixtures/sqlite/materialize.js';
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { normalizeCatalog } from '../../../../src/core/normalize/normalize.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { NormalizationResult } from '../../../../src/core/model/graph.js';
import type { GraphEdge } from '../../../../src/core/model/edge.js';
import type { EdgeKind } from '../../../../src/core/model/edge.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

let mat: MaterializedDb;
let norm: NormalizationResult;
let idToQName: Map<string, string>;

async function buildTortureGraph(): Promise<NormalizationResult> {
  const adapter = await createSqliteSchemaAdapter({ file: mat.path });
  const catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();
  return normalizeCatalog(catalog, FULL_SCOPE);
}

beforeAll(async () => {
  mat = materializeTorture();
  norm = await buildTortureGraph();
  idToQName = new Map(norm.graph.nodes.map((n) => [n.id, n.qname]));
});

afterAll(() => {
  mat.cleanup();
});

/** Returns the set of `src→dst` qname pairs for every edge of the given kind. */
function edgePairs(kind: EdgeKind): Set<string> {
  return new Set(
    norm.graph.edges
      .filter((e) => e.kind === kind)
      .map((e) => `${idToQName.get(e.src) ?? e.src}→${idToQName.get(e.dst) ?? e.dst}`),
  );
}

function edgesOfKind(kind: EdgeKind): GraphEdge[] {
  return norm.graph.edges.filter((e) => e.kind === kind);
}

describe('SQLite torture graph — view depends_on (L-009 exact set)', () => {
  it('depends_on is EXACTLY the two views × their two base tables — no other, no fewer', () => {
    expect(edgePairs('depends_on')).toStrictEqual(
      new Set([
        'main.active_departments→main.departments',
        'main.active_departments→main.employees',
        'main.employee_summary→main.departments',
        'main.employee_summary→main.employees',
      ]),
    );
  });

  it('every depends_on edge carries confidence:parsed', () => {
    const edges = edgesOfKind('depends_on');
    expect(edges).toHaveLength(4);
    expect(edges.every((e) => e.confidence === 'parsed')).toBe(true);
  });

  it('no view depends_on itself (negative)', () => {
    for (const e of edgesOfKind('depends_on')) {
      expect(e.src).not.toBe(e.dst);
    }
  });
});

describe('SQLite torture graph — trigger writes_to (L-009 exact set)', () => {
  it('writes_to is EXACTLY the five emp-triggers→audit_log plus the instead-trigger→departments', () => {
    expect(edgePairs('writes_to')).toStrictEqual(
      new Set([
        'main.trg_emp_before_insert→main.audit_log',
        'main.trg_emp_after_insert→main.audit_log',
        'main.trg_emp_before_update→main.audit_log',
        'main.trg_emp_after_delete→main.audit_log',
        'main.trg_emp_salary_update→main.audit_log',
        'main.trg_active_dept_instead_insert→main.departments',
      ]),
    );
  });

  it('every writes_to edge carries confidence:parsed', () => {
    const edges = edgesOfKind('writes_to');
    expect(edges).toHaveLength(6);
    expect(edges.every((e) => e.confidence === 'parsed')).toBe(true);
  });
});

describe('SQLite torture graph — negatives (header never leaks, no phantom)', () => {
  it('NO trigger emits a reads_from edge at all (the bodies only write)', () => {
    expect(edgesOfKind('reads_from')).toStrictEqual([]);
  });

  it('NO trg_emp_* → main.employees edge (ON-header target never leaks)', () => {
    const pairs = new Set([...edgePairs('writes_to'), ...edgePairs('reads_from')]);
    expect(pairs.has('main.trg_emp_before_insert→main.employees')).toBe(false);
    expect(pairs.has('main.trg_emp_after_insert→main.employees')).toBe(false);
    expect(pairs.has('main.trg_emp_before_update→main.employees')).toBe(false);
    expect(pairs.has('main.trg_emp_after_delete→main.employees')).toBe(false);
    expect(pairs.has('main.trg_emp_salary_update→main.employees')).toBe(false);
  });

  it('NO trg_active_dept_instead_insert → main.active_departments edge (ON-header target never leaks)', () => {
    const pairs = new Set([...edgePairs('writes_to'), ...edgePairs('reads_from'), ...edgePairs('depends_on')]);
    expect(pairs.has('main.trg_active_dept_instead_insert→main.active_departments')).toBe(false);
  });

  it('no edge references a NEW./OLD. pseudo-column or string-literal name', () => {
    // Every dependency-edge dst is a real catalog table/view qname (present as a node).
    for (const kind of ['depends_on', 'reads_from', 'writes_to'] as const) {
      for (const e of edgesOfKind(kind)) {
        const dstQ = idToQName.get(e.dst);
        expect(dstQ, `${kind} dst`).toBeDefined();
        expect(dstQ).toMatch(/^main\.[a-z_]+$/);
      }
    }
  });
});

describe('SQLite torture graph — determinism (ADR-008)', () => {
  it('extract twice → byte-identical serialized dependency edge set', async () => {
    const norm2 = await buildTortureGraph();
    const depKinds = new Set<EdgeKind>(['depends_on', 'reads_from', 'writes_to']);
    const pick = (r: NormalizationResult): GraphEdge[] =>
      r.graph.edges.filter((e) => depKinds.has(e.kind));
    expect(stableStringify(pick(norm2))).toBe(stableStringify(pick(norm)));
  });
});
