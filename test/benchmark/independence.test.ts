/**
 * `npm test` independence guard (US-035, Batch 4 — spec Req "npm test is independent of any
 * benchmark run"). This suite is the no-CI safety net: it PROVES, inside `npm test` itself, that no
 * vitest suite is coupled to a benchmark run.
 *
 * The benchmark RUN is an ORCHESTRATOR step executed between apply and verify — never a vitest
 * suite. A test that imported a dev stage, spawned an agent run, or read `benchmark/runs/` would
 * silently couple `npm test` to a run and ship undetected without CI. These assertions forbid that.
 *
 * Every assertion is EXACT (`.toStrictEqual` / `.toBe`) per the standing task header — no
 * existence-only `.toBeDefined()`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const thisFile = fileURLToPath(import.meta.url);
const benchTestDir = dirname(thisFile); // test/benchmark
const testRoot = dirname(benchTestDir); // test

// Dev-stage ENTRYPOINTS whose import/spawn from a vitest suite would couple the suite to a run.
// The extension is required so `benchmark/scorer/...` (the LEGITIMATELY tested core) never matches
// `benchmark/score.ts`.
const STAGE_RE = /benchmark[\\/](?:generate|build-packets|score|render)\.(?:ts|js)/;
const CHILD_PROCESS_RE = /['"]node:child_process['"]|['"]child_process['"]/;

function tsFilesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map((entry) => String(entry))
    .filter((rel) => rel.endsWith('.ts'))
    .map((rel) => join(root, rel));
}

const allTestFiles = tsFilesUnder(testRoot).filter((f) => !f.endsWith('independence.test.ts'));
const benchTestFiles = tsFilesUnder(benchTestDir).filter((f) => !f.endsWith('independence.test.ts'));

describe('npm test is decoupled from any benchmark run', () => {
  it('no vitest suite imports a benchmark dev-stage entrypoint (generate/build-packets/score/render)', () => {
    const offenders = allTestFiles.filter((f) => STAGE_RE.test(readFileSync(f, 'utf8')));
    expect(offenders).toStrictEqual([]);
  });

  it('no vitest suite reads benchmark/runs/ transcripts', () => {
    const offenders = allTestFiles.filter((f) => readFileSync(f, 'utf8').includes('benchmark/runs'));
    expect(offenders).toStrictEqual([]);
  });

  it('no benchmark vitest suite spawns a child process (agent run)', () => {
    const offenders = benchTestFiles.filter((f) => CHILD_PROCESS_RE.test(readFileSync(f, 'utf8')));
    expect(offenders).toStrictEqual([]);
  });
});

describe('the scorer suite depends ONLY on committed fixtures (D15)', () => {
  const scorerSrc = readFileSync(join(benchTestDir, 'scorer.test.ts'), 'utf8');

  it('scorer.test.ts loads committed fixtures and reads no run/packet artifacts', () => {
    expect(scorerSrc.includes('fixtures/')).toBe(true);
    expect(scorerSrc.includes('benchmark/runs')).toBe(false);
    expect(scorerSrc.includes('benchmark/packets')).toBe(false);
    expect(STAGE_RE.test(scorerSrc)).toBe(false);
  });

  it('the committed fixture set is exactly the six family stubs', () => {
    const fixtures = readdirSync(join(benchTestDir, 'fixtures'))
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(fixtures).toStrictEqual([
      'column-type.json',
      'constraint-semantics.json',
      'fk-path.json',
      'impact.json',
      'trigger-inventory.json',
      'view-dependency.json',
    ]);
  });
});
