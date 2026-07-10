/**
 * Unit suite for the PURE `harness-checks` module (benchmark-harness-hardening).
 *
 * This suite imports ONLY the pure, I/O-free module — NEVER a dev stage. The
 * independence guard (`independence.test.ts`) scans this file's full text: it must
 * carry no dev-stage entrypoint path and no run-directory path, and it adds NO new
 * `.json` under `fixtures/` (the fixture set is guard-locked to the six family stubs).
 * Every poisoned dump and mismatched-hash record below is an INLINE `const` literal.
 *
 * Every assertion is EXACT (`.toStrictEqual`) per the standing task header — no
 * existence-only `.toBeDefined()`.
 */

import { describe, it, expect } from 'vitest';

import {
  occursStandalone,
  deriveCoverageTargets,
  verifyDumpCoverage,
  joinManifestHashes,
  type CoverageTarget,
  type ManifestHashEntry,
} from '../../benchmark/harness-checks.ts';

// ─────────────────────────────────────────────────────────────────────────────
// deriveCoverageTargets — per-family target derivation (D2 / D2-shape)
// Inline GT literals MIRROR the committed `benchmark/ground-truth/*.json` shapes.
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveCoverageTargets: per-family targets by pinned rule', () => {
  it('fk-path derives {table, fromTable} + {table, toTable} per hop', () => {
    const gt = {
      hops: [
        {
          fromTable: 'assignments',
          toTable: 'employees',
          joinColumns: [{ fromColumn: 'dept_id', toColumn: 'dept_id' }],
        },
      ],
    };
    expect(deriveCoverageTargets('fk-path-assignments-employees', 'fk-path', gt)).toStrictEqual([
      { kind: 'table', name: 'assignments' },
      { kind: 'table', name: 'employees' },
    ]);
  });

  it('trigger-inventory derives {trigger, triggerQname} per trigger', () => {
    const gt = {
      triggers: [
        { triggerQname: 'trg_active_dept_instead_insert', timing: 'INSTEAD OF', events: ['INSERT'] },
      ],
    };
    expect(
      deriveCoverageTargets('trigger-inventory-active_departments', 'trigger-inventory', gt),
    ).toStrictEqual([{ kind: 'trigger', name: 'trg_active_dept_instead_insert' }]);
  });

  it('impact derives one {kind:any, entry} per FLAT whatToTest string — KIND-AGNOSTIC (Gap 2)', () => {
    // Committed ground truth stores whatToTest as a FLAT array of bare object names. Because
    // `affected`'s whatToTest may name a table, VIEW, or TRIGGER, impact targets are matched by
    // NAME only (kind:'any'); the printed kind stays honest (never mislabels a trigger as TABLE).
    const gt = { whatToTest: ['assignments', 'employees'] };
    expect(deriveCoverageTargets('impact-departments', 'impact', gt)).toStrictEqual([
      { kind: 'any', name: 'assignments' },
      { kind: 'any', name: 'employees' },
    ]);
  });

  it('column-type derives {table} from the qid table before the first dot', () => {
    const gt = { dataType: 'INTEGER', nullable: false };
    expect(
      deriveCoverageTargets('column-type-assignments.dept_id', 'column-type', gt),
    ).toStrictEqual([{ kind: 'table', name: 'assignments' }]);
  });

  it('constraint-semantics derives {table} from the qid tail', () => {
    const gt = { columns: ['project_id', 'emp_id', 'dept_id'], ordered: true };
    expect(
      deriveCoverageTargets('constraint-semantics-assignments', 'constraint-semantics', gt),
    ).toStrictEqual([{ kind: 'table', name: 'assignments' }]);
  });

  it('qid parsing anchors on slice(family.length + 1) — robust to hyphens on BOTH sides', () => {
    // family "constraint-semantics" itself contains a hyphen; a naive split('-') would
    // yield "constraint". Anchoring on the KNOWN family length yields the real tail.
    const gt = { columns: ['a'], ordered: true };
    expect(
      deriveCoverageTargets('constraint-semantics-order-items', 'constraint-semantics', gt),
    ).toStrictEqual([{ kind: 'table', name: 'order-items' }]);
    // A hyphenated table on a column-type qid keeps the whole table, only the column drops.
    const colGt = { dataType: 'INTEGER', nullable: false };
    expect(
      deriveCoverageTargets('column-type-order-items.qty', 'column-type', colGt),
    ).toStrictEqual([{ kind: 'table', name: 'order-items' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyDumpCoverage — membership in the set of DEFINED objects (D3)
// Inline mini-dump strings only.
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyDumpCoverage: coverage = membership in CREATE-defined objects', () => {
  const targets: readonly CoverageTarget[] = [
    { kind: 'table', name: 'assignments' },
    { kind: 'table', name: 'employees' },
  ];

  it('HIT — a dump defining every target returns [] (full coverage)', () => {
    const dump = [
      'CREATE TABLE assignments (id INTEGER, dept_id INTEGER);',
      'CREATE TABLE employees (emp_id INTEGER, dept_id INTEGER);',
    ].join('\n\n');
    expect(verifyDumpCoverage(dump, targets)).toStrictEqual([]);
  });

  it('MISS — a poisoned dump omitting a target returns exactly that target', () => {
    const dump = 'CREATE TABLE employees (emp_id INTEGER, dept_id INTEGER);';
    expect(verifyDumpCoverage(dump, targets)).toStrictEqual([{ kind: 'table', name: 'assignments' }]);
  });

  it('quoted, schema-qualified, IF NOT EXISTS and TEMP variants all COVER (case/quote-insensitive)', () => {
    const one: readonly CoverageTarget[] = [{ kind: 'table', name: 'assignments' }];
    expect(verifyDumpCoverage('CREATE TABLE "Assignments" (id INTEGER);', one)).toStrictEqual([]);
    expect(verifyDumpCoverage('CREATE TABLE main.assignments (id INTEGER);', one)).toStrictEqual([]);
    expect(verifyDumpCoverage('CREATE TABLE IF NOT EXISTS assignments (id INTEGER);', one)).toStrictEqual([]);
    expect(verifyDumpCoverage('CREATE TEMP TABLE assignments (id INTEGER);', one)).toStrictEqual([]);
  });

  it('a mere REFERENCES (no CREATE of the target) does NOT cover', () => {
    const dump = 'CREATE TABLE roster (emp_id INTEGER REFERENCES assignments(id));';
    expect(verifyDumpCoverage(dump, [{ kind: 'table', name: 'assignments' }])).toStrictEqual([
      { kind: 'table', name: 'assignments' },
    ]);
  });

  it('coverage is by kind:name — a TABLE foo does NOT cover a TRIGGER foo', () => {
    expect(verifyDumpCoverage('CREATE TABLE foo (id INTEGER);', [{ kind: 'trigger', name: 'foo' }])).toStrictEqual([
      { kind: 'trigger', name: 'foo' },
    ]);
    expect(
      verifyDumpCoverage('CREATE TRIGGER trg_x INSTEAD OF INSERT ON v BEGIN SELECT 1; END;', [
        { kind: 'trigger', name: 'trg_x' },
      ]),
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyDumpCoverage — IMPACT targets are KIND-AGNOSTIC (kind:'any', Gap 2 / D2)
// whatToTest may name a table, VIEW, or TRIGGER; the purpose (catch a WRONG-DB dump)
// needs only that the NAMED object be DEFINED under ANY kind. Concrete kinds keep
// exact kind:name matching. Inline mini-dump strings only.
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyDumpCoverage: impact (kind:any) matches by NAME regardless of declared kind', () => {
  const impactTargets: readonly CoverageTarget[] = [
    { kind: 'any', name: 'trg_audit_log_ins' },
    { kind: 'any', name: 'active_departments' },
  ];

  it('POSITIVE — a correct dump defining the names as TRIGGER/VIEW covers them by NAME → []', () => {
    const dump = [
      'CREATE VIEW active_departments AS SELECT * FROM departments;',
      'CREATE TRIGGER trg_audit_log_ins AFTER INSERT ON audit_log BEGIN SELECT 1; END;',
    ].join('\n\n');
    expect(verifyDumpCoverage(dump, impactTargets)).toStrictEqual([]);
  });

  it('NEGATIVE (wrong-DB) — a dump OMITTING both names under EVERY kind returns both unchanged', () => {
    const dump = 'CREATE TABLE unrelated (id INTEGER);';
    expect(verifyDumpCoverage(dump, impactTargets)).toStrictEqual([
      { kind: 'any', name: 'trg_audit_log_ins' },
      { kind: 'any', name: 'active_departments' },
    ]);
  });

  it('REGRESSION — a CONCRETE {trigger, foo} is STILL NOT covered by CREATE TABLE foo (kind-aware path byte-identical)', () => {
    expect(
      verifyDumpCoverage('CREATE TABLE foo (id INTEGER);', [{ kind: 'trigger', name: 'foo' }]),
    ).toStrictEqual([{ kind: 'trigger', name: 'foo' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// joinManifestHashes — pure hash join, no throw; caller decides severity (D4 / OQ1)
// Inline manifest + raw literals only.
// ─────────────────────────────────────────────────────────────────────────────

describe('joinManifestHashes: ok / mismatch / empty-raw / missing-in-manifest', () => {
  const manifest: readonly ManifestHashEntry[] = [
    { qid: 'fk-path-x', condition: 'with', promptSha256: 'aaa' },
    { qid: 'fk-path-x', condition: 'without', promptSha256: 'bbb' },
  ];

  it('non-empty raw equal to manifest → ok with authoritative from manifest', () => {
    expect(
      joinManifestHashes(manifest, [{ qid: 'fk-path-x', condition: 'with', promptSha256: 'aaa' }]),
    ).toStrictEqual([
      {
        qid: 'fk-path-x',
        condition: 'with',
        authoritativePromptSha256: 'aaa',
        rawPromptSha256: 'aaa',
        status: 'ok',
      },
    ]);
  });

  it('non-empty raw different from manifest → mismatch', () => {
    expect(
      joinManifestHashes(manifest, [{ qid: 'fk-path-x', condition: 'with', promptSha256: 'zzz' }]),
    ).toStrictEqual([
      {
        qid: 'fk-path-x',
        condition: 'with',
        authoritativePromptSha256: 'aaa',
        rawPromptSha256: 'zzz',
        status: 'mismatch',
      },
    ]);
  });

  it('absent raw hash → empty-raw with rawPromptSha256 "" and authoritative stamped', () => {
    expect(joinManifestHashes(manifest, [{ qid: 'fk-path-x', condition: 'without' }])).toStrictEqual([
      {
        qid: 'fk-path-x',
        condition: 'without',
        authoritativePromptSha256: 'bbb',
        rawPromptSha256: '',
        status: 'empty-raw',
      },
    ]);
  });

  it('empty-string raw hash → empty-raw (same as absent)', () => {
    expect(
      joinManifestHashes(manifest, [{ qid: 'fk-path-x', condition: 'without', promptSha256: '' }]),
    ).toStrictEqual([
      {
        qid: 'fk-path-x',
        condition: 'without',
        authoritativePromptSha256: 'bbb',
        rawPromptSha256: '',
        status: 'empty-raw',
      },
    ]);
  });

  it('(qid,condition) absent from manifest → missing-in-manifest with authoritative null', () => {
    expect(
      joinManifestHashes(manifest, [{ qid: 'ghost-qid', condition: 'with', promptSha256: 'ccc' }]),
    ).toStrictEqual([
      {
        qid: 'ghost-qid',
        condition: 'with',
        authoritativePromptSha256: null,
        rawPromptSha256: 'ccc',
        status: 'missing-in-manifest',
      },
    ]);
  });

  it('LEAK GUARD — a result carries ONLY qid/condition/hashes/status, no answer VALUE', () => {
    const results = joinManifestHashes(manifest, [
      { qid: 'fk-path-x', condition: 'with', promptSha256: 'aaa' },
      { qid: 'fk-path-x', condition: 'without' },
    ]);
    for (const r of results) {
      expect(Object.keys(r).sort()).toStrictEqual([
        'authoritativePromptSha256',
        'condition',
        'qid',
        'rawPromptSha256',
        'status',
      ]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// occursStandalone — no-answer-leak overlap check (Gap 1, design Decision 1)
// STANDALONE = an occurrence NOT flanked, on EITHER side, by an alphanumeric-or-
// underscore character (`[a-z0-9_]`), the project's alphanumeric-adjacency
// convention (deliberately NOT a `\b` regex — the needle is compared as a LITERAL
// string, never a pattern). Every assertion is EXACT (`.toBe`).
// ─────────────────────────────────────────────────────────────────────────────

describe('occursStandalone: standalone (alphanumeric-adjacency) token occurrence', () => {
  it('embedded inside a larger identifier is NOT standalone (the `_` flanks it)', () => {
    // `departments` within the view name `active_departments` — flanked by `_`, not a leak.
    expect(
      occursStandalone('which tables does the view active_departments read from', 'departments'),
    ).toBe(false);
  });

  it('a free-standing occurrence IS standalone', () => {
    expect(occursStandalone('list the columns of departments here', 'departments')).toBe(true);
  });

  it('punctuation and whitespace flanks count as boundaries', () => {
    // Flanked by a space (before) and a comma (after) — neither matches `[a-z0-9_]`.
    expect(occursStandalone('answer: dept_id, emp_id.', 'dept_id')).toBe(true);
  });

  it('matches the needle LITERALLY — metacharacters are not a regex pattern', () => {
    // A composed FK-path token carries dots and `->`; it must be compared as a literal string.
    expect(occursStandalone('path a.b -> c.d shown', 'a.b -> c.d')).toBe(true);
    // The same literal, flanked by `x`/`y` alphanumerics on both ends, is NOT standalone.
    expect(occursStandalone('xa.b -> c.dy', 'a.b -> c.d')).toBe(false);
  });

  it('scans EVERY occurrence — embedded first, free-standing later still leaks', () => {
    expect(occursStandalone('active_departments then departments alone', 'departments')).toBe(true);
  });

  it('an empty needle is never a leak', () => {
    expect(occursStandalone('anything at all', '')).toBe(false);
  });

  it('is case-insensitive on BOTH sides', () => {
    // Standalone match survives case folding …
    expect(occursStandalone('list the columns of DEPARTMENTS here', 'departments')).toBe(true);
    expect(occursStandalone('list the columns of departments here', 'DEPARTMENTS')).toBe(true);
    // … and an embedded occurrence stays non-standalone regardless of case.
    expect(occursStandalone('which view reads ACTIVE_DEPARTMENTS today', 'departments')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-breaking REGRESSION — the frozen run-1/2 (N=5) question set (Gap 1).
// INLINE literals mirroring benchmark/questions.yaml + benchmark/ground-truth/*.json
// (answerTokens as the generation dev stage emits them). That dev stage is NEVER
// imported here — the independence guard forbids a vitest suite from importing one.
// EVERY frozen (question, answerToken) pair MUST stay non-leaking (guard never fires).
// ─────────────────────────────────────────────────────────────────────────────

describe('occursStandalone fires on ZERO frozen run-1/2 pairs (non-breaking)', () => {
  const FROZEN: readonly { readonly qid: string; readonly question: string; readonly answerTokens: readonly string[] }[] = [
    {
      qid: 'column-type-assignments.dept_id',
      question:
        'What is the declared SQL data type and nullability of the column assignments.dept_id?',
      answerTokens: ['INTEGER', 'NOT NULL', 'INTEGER|NOT NULL'],
    },
    {
      qid: 'constraint-semantics-assignments',
      question: 'List the columns of the PRIMARY KEY of table assignments, in their declared order.',
      answerTokens: ['project_id', 'emp_id', 'dept_id', 'project_id, emp_id, dept_id'],
    },
    {
      qid: 'fk-path-assignments-employees',
      question: 'What foreign-key join path connects the tables assignments and employees?',
      answerTokens: [
        'assignments.dept_id=employees.dept_id',
        'dept_id',
        'dept_id',
        'assignments.emp_id=employees.emp_id',
        'emp_id',
        'emp_id',
      ],
    },
    {
      qid: 'impact-departments',
      question:
        'A developer proposes the following DDL change:\nALTER TABLE main.departments DROP COLUMN dept_id;\nWhich existing database objects should be re-tested as a result of this change?',
      answerTokens: ['assignments', 'employees', 'assignments, employees'],
    },
    {
      qid: 'trigger-inventory-active_departments',
      question:
        'Which triggers are defined on active_departments? For each trigger give its name, timing, and the events it fires on.',
      answerTokens: [
        'trg_active_dept_instead_insert',
        'INSTEAD OF',
        'INSERT',
        'trg_active_dept_instead_insert:INSTEAD OF:INSERT',
      ],
    },
  ];

  for (const q of FROZEN) {
    for (const token of q.answerTokens) {
      it(`${q.qid}: token "${token}" does NOT leak into the question`, () => {
        expect(occursStandalone(q.question, token)).toBe(false);
      });
    }
  }
});
