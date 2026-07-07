/**
 * Unit tests for the SQLite body tokenizer seams (Batch B1, sqlite-view-deps).
 * PURE string→string / string→RawDependency[] units — no driver, no I/O, no graph build.
 *
 * Covers:
 *   - sqliteCanonicalize  : strip [] / "" / backtick quoting → bare lowercased identifier
 *   - extractTriggerActionBlock : mask-then-slice header strip (Design D2) — the
 *     CREATE TRIGGER … ON <target> header (incl. WHEN / INSTEAD OF / UPDATE OF) never
 *     reaches the output; a BEGIN/END token inside a masked WHEN literal does not mis-slice.
 *   - tokenizeSqliteBody  : maskDynamicStrings → bodyContainsRef presence-gate → classifyAccess
 *     over the shared _shared/tokenizer-core.ts primitives. LEAK NEGATIVES: string literal,
 *     NEW./OLD. pseudo-column, -- comment, self (absent from candidates) → NO edge.
 *
 * STRICT TDD — RED first: this file fails until src/adapters/engines/sqlite/tokenizer.ts exists.
 * L-009: assertions are EXACT (toStrictEqual full edge sets + explicit negatives).
 */

import { describe, it, expect } from 'vitest';
import {
  sqliteCanonicalize,
  extractTriggerActionBlock,
  tokenizeSqliteBody,
} from '../../../../src/adapters/engines/sqlite/tokenizer.js';
import type { RawDependency } from '../../../../src/core/model/catalog.js';

// ─────────────────────────────────────────────────────────────────────────────
// sqliteCanonicalize
// ─────────────────────────────────────────────────────────────────────────────

describe('sqliteCanonicalize()', () => {
  it('strips [bracket] quoting and lowercases', () => {
    expect(sqliteCanonicalize('[Main].[Departments]')).toBe('main.departments');
  });

  it('strips "double-quote" quoting and lowercases', () => {
    const dq = String.fromCharCode(34);
    expect(sqliteCanonicalize(`${dq}main${dq}.${dq}Employees${dq}`)).toBe('main.employees');
  });

  it('strips `backtick` quoting and lowercases', () => {
    const bt = String.fromCharCode(96);
    expect(sqliteCanonicalize(`${bt}main${bt}.${bt}Audit_Log${bt}`)).toBe('main.audit_log');
  });

  it('leaves a bare identifier untouched except case-folding', () => {
    expect(sqliteCanonicalize('Departments')).toBe('departments');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractTriggerActionBlock — header strip (Design D2)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTriggerActionBlock() — header never leaks', () => {
  it('INSTEAD OF … ON <view> header is stripped; ON-target name is absent, body survives', () => {
    const sql = [
      'CREATE TRIGGER trg_active_dept_instead_insert',
      '    INSTEAD OF INSERT ON active_departments',
      'BEGIN',
      '    INSERT INTO departments (dept_id, name, active)',
      '        VALUES (NEW.dept_id, NEW.name, 1);',
      'END',
    ].join('\n');

    const action = extractTriggerActionBlock(sql);

    // Body survives with the real write target intact.
    expect(action).toContain('INSERT INTO departments');
    // The fires_on target from the ON header MUST NOT reach the tokenizer.
    expect(action).not.toContain('active_departments');
    expect(action).not.toContain('INSTEAD OF');
  });

  it('BEFORE UPDATE OF <col> ON <table> WHEN … header (incl. WHEN clause + ON target) is stripped', () => {
    const sql = [
      'CREATE TRIGGER trg_emp_salary_update',
      '    BEFORE UPDATE OF salary ON employees',
      '    WHEN NEW.salary <> OLD.salary',
      'BEGIN',
      "    INSERT INTO audit_log (action) VALUES ('SALARY_UPDATE');",
      'END',
    ].join('\n');

    const action = extractTriggerActionBlock(sql);

    expect(action).toContain('INSERT INTO audit_log');
    expect(action).not.toContain('UPDATE OF salary');
    expect(action).not.toContain('WHEN');
    // ON-target table name (header only) must not survive.
    expect(action).not.toContain('employees');
  });

  it('a BEGIN/END token inside a MASKED string literal in a WHEN clause does NOT mis-slice', () => {
    const sql = [
      'CREATE TRIGGER trg_y',
      '    AFTER INSERT ON t',
      "    WHEN NEW.note = 'BEGIN NOW'",
      'BEGIN',
      "    INSERT INTO log (msg) VALUES ('END OF LINE');",
      'END',
    ].join('\n');

    const action = extractTriggerActionBlock(sql);

    // Real action body sliced from the ORIGINAL — identifiers + real literals survive.
    expect(action).toContain('INSERT INTO log');
    expect(action).toContain('END OF LINE');
    // The WHEN-clause literal that CONTAINS the word BEGIN must not become the slice point.
    expect(action).not.toContain('BEGIN NOW');
    expect(action).not.toContain('WHEN');
  });

  it('returns empty string when there is no BEGIN…END action block', () => {
    expect(extractTriggerActionBlock('CREATE TRIGGER x AFTER INSERT ON t SELECT 1;')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeSqliteBody — presence-gate + classify + leak negatives
// ─────────────────────────────────────────────────────────────────────────────

const DEPS = [
  { schema: 'main', name: 'departments' },
  { schema: 'main', name: 'employees' },
  { schema: 'main', name: 'audit_log' },
  { schema: 'main', name: 'active_departments' },
];

/** Serialize a dependency to a compact comparable tuple. */
function tuple(d: RawDependency): string {
  return `${d.target.schema}.${d.target.name}|${d.access}|${d.confidence}`;
}

describe('tokenizeSqliteBody() — classification', () => {
  it('a FROM/JOIN view body yields EXACT read deps, each confidence:parsed', () => {
    const body =
      'SELECT d.dept_id, COUNT(e.emp_id) FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id';
    const deps = tokenizeSqliteBody(body, DEPS);

    const got = new Set(deps.map(tuple));
    expect(got).toStrictEqual(
      new Set(['main.departments|read|parsed', 'main.employees|read|parsed']),
    );
  });

  it('an INSERT INTO target is classified as a write', () => {
    const body = 'INSERT INTO audit_log (entity, action) VALUES (?, ?)';
    const deps = tokenizeSqliteBody(body, DEPS);

    expect(deps.map(tuple)).toStrictEqual(['main.audit_log|write|parsed']);
  });
});

describe('tokenizeSqliteBody() — LEAK NEGATIVES (L-009)', () => {
  it("a table name appearing ONLY in a string literal ('employees') yields NO edge", () => {
    const body = "INSERT INTO audit_log (entity) VALUES ('employees')";
    const deps = tokenizeSqliteBody(body, DEPS);

    // audit_log is written; the 'employees' STRING LITERAL is masked → no employees edge.
    expect(deps.map(tuple)).toStrictEqual(['main.audit_log|write|parsed']);
    expect(deps.map((d) => d.target.name)).not.toContain('employees');
  });

  it('a NEW./OLD. pseudo-column reference does NOT fabricate an edge (columns are not catalog objects)', () => {
    const body = 'INSERT INTO audit_log (new_val, old_val) VALUES (NEW.full_name, OLD.full_name)';
    const deps = tokenizeSqliteBody(body, DEPS);

    // Only audit_log — NEW.full_name / OLD.full_name reference columns, not tables.
    expect(deps.map(tuple)).toStrictEqual(['main.audit_log|write|parsed']);
  });

  it('a table name present ONLY in a -- line comment yields NO edge', () => {
    const body = 'SELECT 1 -- joins departments here\nFROM audit_log';
    const deps = tokenizeSqliteBody(body, DEPS);

    expect(deps.map((d) => d.target.name)).toStrictEqual(['audit_log']);
    expect(deps.map((d) => d.target.name)).not.toContain('departments');
  });

  it('a table name present ONLY in a /* block comment */ yields NO edge', () => {
    const body = 'SELECT 1 /* uses departments */ FROM audit_log';
    const deps = tokenizeSqliteBody(body, DEPS);

    expect(deps.map((d) => d.target.name)).toStrictEqual(['audit_log']);
    expect(deps.map((d) => d.target.name)).not.toContain('departments');
  });

  it('a body naming a qname absent from the candidate list (e.g. self) yields NO self-edge', () => {
    // Mirrors extractViews excluding the view's own qname from its candidate list:
    // the full CREATE VIEW body still names active_departments, but it is NOT a candidate here.
    const body = [
      'CREATE VIEW active_departments AS',
      '  SELECT d.dept_id FROM departments d LEFT JOIN employees e ON e.dept_id = d.dept_id',
    ].join('\n');
    const candidatesWithoutSelf = DEPS.filter((d) => d.name !== 'active_departments');

    const deps = tokenizeSqliteBody(body, candidatesWithoutSelf);

    const got = new Set(deps.map((d) => d.target.name));
    expect(got).toStrictEqual(new Set(['departments', 'employees']));
    expect(got.has('active_departments')).toBe(false);
  });

  it('skips candidates with empty schema/name', () => {
    const body = 'SELECT * FROM departments';
    const deps = tokenizeSqliteBody(body, [
      { schema: '', name: 'departments' },
      { schema: 'main', name: '' },
      { schema: 'main', name: 'departments' },
    ]);
    expect(deps.map(tuple)).toStrictEqual(['main.departments|read|parsed']);
  });
});
