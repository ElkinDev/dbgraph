/**
 * Benchmark scorer unit tests (US-035, Batch 1 — STRICT TDD, RED→GREEN).
 *
 * These tests are the ONLY new code `npm test` exercises for the benchmark harness
 * (design D3/D15). They import COMMITTED fixture ground-truth stubs under
 * `test/benchmark/fixtures/` — they need NO generated questions and NO run, so the
 * suite stays green on a clean checkout with zero benchmark artifacts.
 *
 * Every assertion is EXACT (`.toBe` / `.toStrictEqual`); existence-only `.toBeDefined()`
 * is forbidden by the standing task header.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  parseAnswer,
  normalizeQname,
  canonicalType,
  compareFkPath,
  compareColumnType,
  compareImpact,
  compareTriggerInventory,
  compareViewDependency,
  compareConstraintSemantics,
  comparePlanCallers,
  comparePlanBlindspots,
  comparePlanOrder,
  schemaTokens,
  scoreAnswer,
  FAMILIES,
} from '../../benchmark/scorer/index.js';
import type { GroundTruthByFamily, ScoreInput } from '../../benchmark/scorer/index.js';

// ── Fixture loader (committed ground-truth stubs, D15) ───────────────────────
function loadFixture<T>(name: string): T {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.1 — shared helpers: parseAnswer, normalizeQname, canonicalType
// ─────────────────────────────────────────────────────────────────────────────

describe('parseAnswer', () => {
  it('extracts the value after the final ANSWER: line, trimmed', () => {
    expect(parseAnswer('reasoning here\nANSWER: x')).toBe('x');
  });

  it('extracts the LAST ANSWER: line when several are present', () => {
    expect(parseAnswer('ANSWER: first\nmore text\nANSWER: final')).toBe('final');
  });

  it('trims surrounding whitespace from the captured value', () => {
    expect(parseAnswer('ANSWER:    spaced value   ')).toBe('spaced value');
  });

  it('returns empty string when no ANSWER: line exists', () => {
    expect(parseAnswer('no answer marker at all')).toBe('');
  });

  it('returns empty string when the ANSWER: line has no value', () => {
    expect(parseAnswer('text\nANSWER:')).toBe('');
  });
});

describe('normalizeQname', () => {
  it('strips double quotes and lowercases', () => {
    expect(normalizeQname('"Foo"."Bar"')).toBe('foo.bar');
  });

  it('strips square brackets and lowercases', () => {
    expect(normalizeQname('[Foo].[Bar]')).toBe('foo.bar');
  });

  it('collapses internal whitespace and trims', () => {
    expect(normalizeQname('  Foo   .  Bar  ')).toBe('foo . bar');
  });

  it('strips backtick identifiers', () => {
    expect(normalizeQname('`Foo`.`Bar`')).toBe('foo.bar');
  });
});

describe('canonicalType', () => {
  it('maps the INT synonym to INTEGER', () => {
    expect(canonicalType('int')).toBe('INTEGER');
  });

  it('leaves INTEGER unchanged (uppercased)', () => {
    expect(canonicalType('integer')).toBe('INTEGER');
  });

  it('uppercases and trims non-synonym types', () => {
    expect(canonicalType('  text  ')).toBe('TEXT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.2 — fk-path comparator: SET equality of `A.col=B.col` hop atoms, order-independent
// ─────────────────────────────────────────────────────────────────────────────

describe('compareFkPath', () => {
  const gt = loadFixture<GroundTruthByFamily['fk-path']>('fk-path.json');

  it('passes on the exact composite-FK atom set', () => {
    const answer = 'assignments.emp_id=employees.emp_id; assignments.dept_id=employees.dept_id';
    expect(compareFkPath(answer, gt).correct).toBe(true);
  });

  it('passes when atoms are reordered AND each atom side is swapped (order-independent set)', () => {
    const answer = 'employees.dept_id=assignments.dept_id; employees.emp_id=assignments.emp_id';
    expect(compareFkPath(answer, gt).correct).toBe(true);
  });

  it('fails when a hop atom is missing (no partial credit)', () => {
    const answer = 'assignments.emp_id=employees.emp_id';
    expect(compareFkPath(answer, gt).correct).toBe(false);
  });

  it('fails on a fuzzy/near-miss atom (no fuzzy matching)', () => {
    const answer = 'assignments.emp_id=employees.emp_id; assignments.dept_id=departments.dept_id';
    expect(compareFkPath(answer, gt).correct).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.3 — column-type (control) comparator: EXACT `TYPE|NULLABLE`, synonym-normalized
// ─────────────────────────────────────────────────────────────────────────────

describe('compareColumnType', () => {
  const gt = loadFixture<GroundTruthByFamily['column-type']>('column-type.json'); // INTEGER, NOT NULL

  it('passes on the exact TYPE|NULLABLE form', () => {
    expect(compareColumnType('INTEGER|NOT NULL', gt).correct).toBe(true);
  });

  it('passes with the INT synonym and lowercase nullability token', () => {
    const nullableGt: GroundTruthByFamily['column-type'] = { dataType: 'INTEGER', nullable: true };
    expect(compareColumnType('int|null', nullableGt).correct).toBe(true);
  });

  it('fails on nullability mismatch (NULL vs NOT NULL)', () => {
    expect(compareColumnType('INTEGER|NULL', gt).correct).toBe(false);
  });

  it('fails on type mismatch (no partial credit)', () => {
    expect(compareColumnType('TEXT|NOT NULL', gt).correct).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.4 — impact (set qnames) + trigger-inventory (STRICT {qname,timing,events} tuples)
// ─────────────────────────────────────────────────────────────────────────────

describe('compareImpact', () => {
  const gt = loadFixture<GroundTruthByFamily['impact']>('impact.json');

  it('passes on set-equal whatToTest qnames regardless of order', () => {
    expect(compareImpact('employee_summary, employees, assignments', gt).correct).toBe(true);
  });

  it('fails when a whatToTest qname is missing', () => {
    expect(compareImpact('employees, assignments', gt).correct).toBe(false);
  });
});

describe('compareTriggerInventory', () => {
  const gt = loadFixture<GroundTruthByFamily['trigger-inventory']>('trigger-inventory.json');

  it('passes on set-equal {qname,timing,events} tuples regardless of order', () => {
    const answer = 'trg_employees_audit_del:AFTER:DELETE, trg_employees_audit_upd:AFTER:UPDATE';
    expect(compareTriggerInventory(answer, gt).correct).toBe(true);
  });

  it('fails on a timing mismatch (STRICT — timing is scored)', () => {
    const answer = 'trg_employees_audit_upd:BEFORE:UPDATE, trg_employees_audit_del:AFTER:DELETE';
    expect(compareTriggerInventory(answer, gt).correct).toBe(false);
  });

  it('fails on an events mismatch (STRICT — events are scored)', () => {
    const answer = 'trg_employees_audit_upd:AFTER:INSERT, trg_employees_audit_del:AFTER:DELETE';
    expect(compareTriggerInventory(answer, gt).correct).toBe(false);
  });

  it('fails on a malformed tuple (missing events segment)', () => {
    const answer = 'trg_employees_audit_upd:AFTER, trg_employees_audit_del:AFTER:DELETE';
    expect(compareTriggerInventory(answer, gt).correct).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.5 — view-dependency (set qnames) + constraint-semantics (PK ordered, else set)
// ─────────────────────────────────────────────────────────────────────────────

describe('compareViewDependency', () => {
  const gt = loadFixture<GroundTruthByFamily['view-dependency']>('view-dependency.json');

  it('passes on set-equal dependency qnames regardless of order', () => {
    expect(compareViewDependency('departments, employees', gt).correct).toBe(true);
  });

  it('fails on an extra spurious dependency', () => {
    expect(compareViewDependency('departments, employees, projects', gt).correct).toBe(false);
  });
});

describe('compareConstraintSemantics', () => {
  const pkGt = loadFixture<GroundTruthByFamily['constraint-semantics']>('constraint-semantics.json'); // ordered PK

  it('passes when PK columns are in the exact declared order', () => {
    expect(compareConstraintSemantics('project_id, emp_id, dept_id', pkGt).correct).toBe(true);
  });

  it('fails when PK column order is wrong (order-SENSITIVE for PK)', () => {
    expect(compareConstraintSemantics('emp_id, project_id, dept_id', pkGt).correct).toBe(false);
  });

  it('passes when a non-PK constraint set is reordered (order-INSENSITIVE)', () => {
    const setGt: GroundTruthByFamily['constraint-semantics'] = {
      columns: ['email', 'tenant_id'],
      ordered: false,
    };
    expect(compareConstraintSemantics('tenant_id, email', setGt).correct).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A4 (v2) — plan-callers / plan-blindspots via the EXISTING unordered set-match rule
// (Req 2 "closed-form set-match"). Committed fixtures fixtures/plan-callers.json /
// fixtures/plan-blindspots.json.
// ─────────────────────────────────────────────────────────────────────────────

describe('comparePlanCallers (v2 set-match)', () => {
  const gt = loadFixture<GroundTruthByFamily['plan-callers']>('plan-callers.json'); // 2 callers

  it('passes on the exact caller set regardless of order', () => {
    expect(comparePlanCallers('sp_place_order, usp_refresh_totals', gt).correct).toBe(true);
  });

  it('fails when a caller is missing (no partial credit)', () => {
    expect(comparePlanCallers('usp_refresh_totals', gt).correct).toBe(false);
  });

  it('fails on a spurious extra caller (no fuzzy matching)', () => {
    expect(comparePlanCallers('sp_place_order, usp_refresh_totals, sp_dynamic_search', gt).correct).toBe(false);
  });

  it('normalizes quoting/casing before the set compare', () => {
    expect(comparePlanCallers('[SP_PLACE_ORDER], "USP_REFRESH_TOTALS"', gt).correct).toBe(true);
  });
});

describe('comparePlanBlindspots (v2 set-match over the scoped list)', () => {
  const gt = loadFixture<GroundTruthByFamily['plan-blindspots']>('plan-blindspots.json'); // {sp_dynamic_search}

  it('passes when the answer names exactly the blind-spot set', () => {
    expect(comparePlanBlindspots('sp_dynamic_search', gt).correct).toBe(true);
  });

  it('fails when a non-blind-spot routine from the scope is named', () => {
    expect(comparePlanBlindspots('sp_place_order', gt).correct).toBe(false);
  });

  it('fails when a real blind spot is buried among false positives (extra)', () => {
    expect(comparePlanBlindspots('sp_dynamic_search, sp_place_order', gt).correct).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A4 (v2) — comparePlanOrder: valid-topological-order comparator (Req 2, D3).
// FULL matrix: valid A, distinct valid B, pair violation, missing, extra, duplicate,
// empty, quoted/normalized, no-constraint pairs. Committed fixtures/plan-order.json.
// ─────────────────────────────────────────────────────────────────────────────

describe('comparePlanOrder (valid-topological-order comparator, D3)', () => {
  // scope [order_items, orders, products, regions]; pairs order_items→orders,
  // order_items→products, products→regions.
  const gt = loadFixture<GroundTruthByFamily['plan-order']>('plan-order.json');

  it('topo positive A — a valid linearization scores correct', () => {
    expect(comparePlanOrder('order_items, orders, products, regions', gt).correct).toBe(true);
  });

  it('topo positive B — a DIFFERENT valid permutation of the full set scores correct too', () => {
    // orders and products swapped; all pairs still respected — no single canonical order.
    expect(comparePlanOrder('order_items, products, regions, orders', gt).correct).toBe(true);
  });

  it('topo negative (violation) — regions before products violates products→regions', () => {
    expect(comparePlanOrder('order_items, orders, regions, products', gt).correct).toBe(false);
  });

  it('topo negative (missing) — omitting a scoped object is not a full permutation', () => {
    expect(comparePlanOrder('order_items, orders, products', gt).correct).toBe(false);
  });

  it('topo negative (extra) — an out-of-scope object is rejected', () => {
    expect(comparePlanOrder('order_items, orders, products, regions, audit_log', gt).correct).toBe(false);
  });

  it('topo negative (duplicate) — a repeated scoped object is rejected', () => {
    expect(comparePlanOrder('order_items, orders, products, regions, orders', gt).correct).toBe(false);
  });

  it('topo negative (empty) — an empty answer is rejected', () => {
    expect(comparePlanOrder('', gt).correct).toBe(false);
  });

  it('normalizes quoting/casing before checking permutation + precedence', () => {
    expect(comparePlanOrder('[ORDER_ITEMS], "Orders", products, regions', gt).correct).toBe(true);
  });

  it('with NO constraint pairs, ANY permutation of the full scoped set is accepted', () => {
    const noPairs: GroundTruthByFamily['plan-order'] = { scope: ['a', 'b', 'c'], precede: [] };
    expect(comparePlanOrder('c, a, b', noPairs).correct).toBe(true);
    // …but the full set is still required — a missing member is rejected even with no pairs.
    expect(comparePlanOrder('c, a', noPairs).correct).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.6 — schemaTokens: actual passthrough, else ceil(len/4) labeled approx
// ─────────────────────────────────────────────────────────────────────────────

describe('schemaTokens', () => {
  it('approximates at the ceil(len/4) boundary and labels mode approx', () => {
    expect(schemaTokens({ schemaText: '0123456789' })).toStrictEqual({
      mode: 'approx',
      schemaTokens: 3,
    });
  });

  it('returns 0 tokens for empty schema text', () => {
    expect(schemaTokens({ schemaText: '' })).toStrictEqual({ mode: 'approx', schemaTokens: 0 });
  });

  it('passes actual runtime usage through unchanged and labels mode actual', () => {
    expect(schemaTokens({ schemaText: 'ignored-when-actual-present', actual: 1234 })).toStrictEqual({
      mode: 'actual',
      schemaTokens: 1234,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.7 — scoreAnswer dispatcher: BLIND (no condition field) + deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreAnswer (blind dispatcher, D13)', () => {
  it('dispatches to the family comparator and reports correctness', () => {
    const input: ScoreInput = {
      family: 'column-type',
      answerParsed: 'INTEGER|NOT NULL',
      groundTruth: { dataType: 'INTEGER', nullable: false },
    };
    expect(scoreAnswer(input).correct).toBe(true);
  });

  it('dispatches set-based families through the same blind entrypoint', () => {
    const input: ScoreInput = {
      family: 'view-dependency',
      answerParsed: 'departments, employees',
      groundTruth: { dependencies: ['employees', 'departments'] },
    };
    expect(scoreAnswer(input).correct).toBe(true);
  });

  it('is deterministic — the same input twice yields byte-identical output (ADR-008)', () => {
    const input: ScoreInput = {
      family: 'fk-path',
      answerParsed: 'assignments.emp_id=employees.emp_id; assignments.dept_id=employees.dept_id',
      groundTruth: loadFixture<GroundTruthByFamily['fk-path']>('fk-path.json'),
    };
    const first = scoreAnswer(input);
    const second = scoreAnswer(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.correct).toBe(true);
  });

  it('type-rejects a condition/WITH-WITHOUT label on the scorer input (compile-level blindness)', () => {
    const result = scoreAnswer({
      family: 'column-type',
      answerParsed: 'INTEGER|NOT NULL',
      groundTruth: { dataType: 'INTEGER', nullable: false },
      // @ts-expect-error — the scorer input MUST NOT accept a condition/label field (D13)
      condition: 'with',
    });
    expect(result.correct).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.8 — Family union is EXACTLY the six closed-form families, no rubric path
// ─────────────────────────────────────────────────────────────────────────────

describe('Family taxonomy (D6/D4 — nine closed-form families, no free-text/rubric)', () => {
  it('contains exactly the nine closed-form families in canonical order (6 lookup + 3 v2 plan-*)', () => {
    expect([...FAMILIES]).toStrictEqual([
      'fk-path',
      'column-type',
      'impact',
      'trigger-inventory',
      'view-dependency',
      'constraint-semantics',
      'plan-callers',
      'plan-blindspots',
      'plan-order',
    ]);
  });

  it('has no free-text explain/rubric member (headline accuracy is 100% closed-form)', () => {
    expect(FAMILIES.length).toBe(9);
    expect(FAMILIES).not.toContain('explain');
    expect(FAMILIES).not.toContain('rubric');
  });

  it('rejects an unknown family (no rubric/fallback scoring path exists)', () => {
    const bogus = {
      family: 'explain',
      answerParsed: 'anything',
      groundTruth: {},
    } as unknown as ScoreInput;
    expect(() => scoreAnswer(bogus)).toThrow(/unknown benchmark family/i);
  });
});
