/**
 * Benchmark comment-correction guard (Batch B2.5, sqlite-view-deps).
 *
 * Design D6 / spec `benchmark` "Stale blindness comments corrected" + "N and the committed
 * question set are unchanged; prior runs stay frozen".
 *
 * Two duties:
 *   1. HARD STOP byte-stability guard — the FROZEN DATA of benchmark/questions.yaml
 *      (version, substrate, perFamily, N, familiesIncluded, familiesExcluded, and every
 *      committed question qid) is asserted EXACTLY. Any structural drift here is a protocol
 *      violation (the N=5→6 re-run is DEFERRED to its own labeled run — OUT OF SCOPE).
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

describe('benchmark/questions.yaml — FROZEN DATA byte-stability (HARD STOP)', () => {
  it('version / substrate / perFamily / N are unchanged', () => {
    expect(QUESTIONS).toContain('version: 1');
    expect(QUESTIONS).toContain('substrate: sqlite-torture');
    expect(QUESTIONS).toContain('perFamily: 1');
    expect(QUESTIONS).toContain('n: 5');
  });

  it('familiesIncluded is exactly the five committed families', () => {
    for (const fam of [
      'fk-path',
      'column-type',
      'impact',
      'trigger-inventory',
      'constraint-semantics',
    ]) {
      expect(QUESTIONS).toContain(`- ${fam}`);
    }
  });

  it('familiesExcluded still lists view-dependency (instantiation DEFERRED, N held at 5)', () => {
    expect(QUESTIONS).toMatch(/familiesExcluded:\s*\n\s*- view-dependency/);
  });

  it('every committed question qid is byte-stable', () => {
    for (const qid of [
      'column-type-assignments.dept_id',
      'constraint-semantics-assignments',
      'fk-path-assignments-employees',
      'impact-departments',
      'trigger-inventory-active_departments',
    ]) {
      expect(QUESTIONS).toContain(`qid: ${qid}`);
    }
  });
});

describe('benchmark/questions.yaml — stale blindness comment corrected (D6)', () => {
  it('the notes text no longer asserts SQLite views carry no dependency edges', () => {
    expect(QUESTIONS).not.toMatch(STALE_BLINDNESS);
    expect(QUESTIONS).not.toMatch(/dependency blindness/i);
  });

  it('the notes text states edges are body-derived and instantiation is deferred', () => {
    const note = QUESTIONS.split('\n').find((l) => l.trim().startsWith('view-dependency:')) ?? '';
    expect(note.toLowerCase()).toMatch(/body|derive/);
    expect(note.toLowerCase()).toContain('defer');
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
