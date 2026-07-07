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

  it('impact derives one {table, entry} per FLAT whatToTest string (D2-shape)', () => {
    // Committed ground truth stores whatToTest as a FLAT array of bare table names,
    // NOT {table,name} sub-objects. Derive one {kind:table} per STRING entry.
    const gt = { whatToTest: ['assignments', 'employees'] };
    expect(deriveCoverageTargets('impact-departments', 'impact', gt)).toStrictEqual([
      { kind: 'table', name: 'assignments' },
      { kind: 'table', name: 'employees' },
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
