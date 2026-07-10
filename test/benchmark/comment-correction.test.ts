/**
 * Benchmark comment-correction guard (Batch B2.5, sqlite-view-deps; re-pinned for RUN 3).
 *
 * Design D6 / spec `benchmark` "Stale blindness comments corrected" + "view-dependency family
 * is instantiable; the N-change is deferred to its own run".
 *
 * Two duties:
 *   1. HARD STOP byte-stability guard — the FROZEN DATA of benchmark/questions.yaml
 *      (version, substrate, perFamily, N, familiesIncluded, familiesExcluded, and every
 *      committed question qid) is asserted EXACTLY. Any structural drift here is a protocol
 *      violation. The original N=5 pin's deferral clause is FULFILLED: the N=5→6 re-run
 *      landed as its OWN labeled run (the run-3 pre-registration), enabled by
 *      benchmark-guard-precision (archived 2026-07-10) — canonical spec scenario "the
 *      previously-blocked N=6 generation now proceeds". This guard now locks the RUN-3
 *      N=6 set exactly the way it locked the runs-1/2 N=5 set.
 *   2. Comment-correction guard — the stale "SQLite carries no dependency edges / dependency
 *      blindness" notes in questions.yaml AND generate.ts are gone, replaced by the honest
 *      "edges are body-derived" statement.
 *
 * L-009 discipline: exact assertions, explicit negatives — no existence-only checks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Path segments are kept SEPARATE (the dev-stage file name never appears joined to its
// benchmark dir as one literal) so this guard suite is NOT flagged by independence.test.ts,
// which forbids importing a benchmark dev-stage entrypoint. We READ these files as text; we
// never import them.
const benchDir = join(projectRoot, 'benchmark');
const QUESTIONS = readFileSync(join(benchDir, 'questions.yaml'), 'utf-8');
const GENERATE = readFileSync(join(benchDir, 'generate.ts'), 'utf-8');

// The stale, now-false claim that must NOT survive anywhere.
const STALE_BLINDNESS = /views? (?:carry|carries) no [`]?depends_on/i;

describe('benchmark/questions.yaml — FROZEN DATA byte-stability (HARD STOP, run-3 N=6 set)', () => {
  it('version / substrate / perFamily / N are unchanged', () => {
    expect(QUESTIONS).toContain('version: 1');
    expect(QUESTIONS).toContain('substrate: sqlite-torture');
    expect(QUESTIONS).toContain('perFamily: 1');
    expect(QUESTIONS).toContain('n: 6');
  });

  it('familiesIncluded is exactly the six committed families', () => {
    for (const fam of [
      'fk-path',
      'column-type',
      'impact',
      'trigger-inventory',
      'view-dependency',
      'constraint-semantics',
    ]) {
      expect(QUESTIONS).toContain(`- ${fam}`);
    }
  });

  it('familiesExcluded is empty (view-dependency instantiated in the run-3 labeled set)', () => {
    // The empty-list shape: `familiesExcluded:` immediately followed by the `notes:` key.
    expect(QUESTIONS).toMatch(/familiesExcluded:\s*\nnotes:/);
    expect(QUESTIONS).not.toMatch(/familiesExcluded:\s*\n\s*- /);
  });

  it('every committed question qid is byte-stable; superseded run-1/2 impact qid is GONE', () => {
    for (const qid of [
      'column-type-assignments.dept_id',
      'constraint-semantics-assignments',
      'fk-path-assignments-employees',
      'impact-audit_log',
      'trigger-inventory-active_departments',
      'view-dependency-active_departments',
    ]) {
      expect(QUESTIONS).toContain(`qid: ${qid}`);
    }
    // Explicit negative (L-009): the old impact question was superseded, not kept alongside.
    expect(QUESTIONS).not.toContain('qid: impact-departments');
  });
});

describe('benchmark/questions.yaml — stale blindness comment corrected (D6)', () => {
  it('the notes text no longer asserts SQLite views carry no dependency edges', () => {
    expect(QUESTIONS).not.toMatch(STALE_BLINDNESS);
    expect(QUESTIONS).not.toMatch(/dependency blindness/i);
  });

  it('the notes text states edges are body-derived and the family is INCLUDED in the N=6 set', () => {
    const note = QUESTIONS.split('\n').find((l) => l.trim().startsWith('view-dependency:')) ?? '';
    expect(note.toLowerCase()).toMatch(/body|derive/);
    expect(note.toLowerCase()).toContain('included as of the n=6 run-3 set');
    // Explicit negatives (L-009): the fulfilled deferral wording must not survive.
    expect(note.toLowerCase()).not.toContain('held out');
    expect(note.toLowerCase()).not.toContain('pinned at 5');
  });
});

describe('benchmark generate stage — stale blindness notes corrected (D6)', () => {
  it('no longer asserts SQLite views carry no dependency edges (SUBSTRATE NOTE / inline / yamlString)', () => {
    expect(GENERATE).not.toMatch(STALE_BLINDNESS);
    expect(GENERATE).not.toMatch(/dependency blindness/i);
  });

  it('states view dependency edges are body-derived on SQLite', () => {
    expect(GENERATE.toLowerCase()).toMatch(/body-derived|derived from (?:the )?(?:view )?bod/);
  });
});
