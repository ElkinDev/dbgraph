# Tasks: Benchmark Guard Precision

Size: **XS — ONE batch, one commit.** STRICT TDD (`strict_tdd: true`): a FAILING test precedes every
change. L-009: every assertion EXACT (`.toStrictEqual` / `.toBe`) — never existence-only. No `src/**`
or `dist/**` change. Runs 1/2 frozen; RUN 3 is NOT generated here.

Test runner: `npm test` (vitest). Gate commands: `npx tsc --noEmit`, `npm run lint`, `npm test`.

## Batch 1 — guard precision (generate.ts + harness-checks.ts + vitest seams)

### 1. Gap 1 — leak guard: standalone occurrence (RED → GREEN)

- [ ] 1.1 (RED) In `test/benchmark/harness-checks.test.ts`, add a `describe('occursStandalone …')` importing `occursStandalone` from `../../benchmark/harness-checks.ts`. Assert:
  - embedded is NOT standalone: `occursStandalone('which tables does the view active_departments read from', 'departments')` → `false` (the `_` flanks it);
  - free-standing IS standalone: `occursStandalone('list the columns of departments here', 'departments')` → `true`;
  - punctuation flanks count as boundaries: `occursStandalone('answer: dept_id, emp_id.', 'dept_id')` → `true`;
  - literal (non-regex) match of a token with metacharacters: `occursStandalone('path a.b -> c.d shown', 'a.b -> c.d')` → `true`; and `occursStandalone('xa.b -> c.dy', 'a.b -> c.d')` → `false`;
  - repeat-occurrence: embedded first, standalone later → `true`;
  - empty needle → `false`; case-insensitive (`'DEPARTMENTS'` vs `'departments'`).
  Run `npm test` — MUST fail (export absent).
- [ ] 1.2 (GREEN) Add the exported `occursStandalone(haystack, needle)` helper + `LEAK_FLANK_RE` to `benchmark/harness-checks.ts` per design Decision 1. Run `npm test` — 1.1 GREEN.
- [ ] 1.3 (RED) Add a data-driven REGRESSION `it` over the frozen run-1/2 (question, answerToken) pairs as INLINE literals (do NOT import `generate.ts` — independence guard). Assert `occursStandalone(question, token)` is `false` for EVERY pair (guards never fire on the frozen set). If any pair is missing the helper it fails RED first, then GREEN after 1.2.
- [ ] 1.4 (GREEN) Wire the guard: in `benchmark/generate.ts` import `occursStandalone` from `./harness-checks.ts` and replace `haystack.includes(needle)` with `occursStandalone(haystack, needle)` inside `assertNoAnswerLeak` (keep the `needle.length >= 2` floor and the error message verbatim). Update the guard's inline comment to state standalone/alphanumeric-adjacency semantics.

### 2. Gap 2 — impact coverage: kind-agnostic (RED → GREEN)

- [ ] 2.1 (RED) Update the EXISTING impact assertion in `harness-checks.test.ts` (`deriveCoverageTargets('impact-departments', 'impact', { whatToTest: ['assignments','employees'] })`) to expect `[{ kind: 'any', name: 'assignments' }, { kind: 'any', name: 'employees' }]`. Run `npm test` — MUST fail (still `kind:'table'`).
- [ ] 2.2 (RED) Add `verifyDumpCoverage` cases proving kind-agnostic impact matching:
  - POSITIVE: targets `[{kind:'any', name:'trg_audit_log_ins'}, {kind:'any', name:'active_departments'}]` against a mini-dump defining `CREATE TRIGGER trg_audit_log_ins …` and `CREATE VIEW active_departments …` → `toStrictEqual([])`;
  - NEGATIVE (wrong-DB): the same targets against a dump that OMITS both names (defines only an unrelated table) → returns both targets unchanged;
  - REGRESSION: a concrete `{kind:'trigger', name:'foo'}` target is STILL NOT covered by `CREATE TABLE foo …` (kind-aware path unchanged).
  Run `npm test` — POSITIVE fails RED (name-only branch absent).
- [ ] 2.3 (GREEN) In `benchmark/harness-checks.ts`: extend `ObjectKind` with `'any'`; change the impact branch of `deriveCoverageTargets` to emit `{ kind: 'any', name }`; add the `definedNames` set + `'any'` branch in `verifyDumpCoverage` per design Decision 2. Update the impact-branch comment to state kind-agnostic matching. Run `npm test` — 2.1/2.2 GREEN.

### 3. Gate + DoD

- [ ] 3.1 `npx tsc --noEmit` — clean (verify `ObjectKind` union addition breaks no exhaustiveness site).
- [ ] 3.2 `npm run lint` — clean.
- [ ] 3.3 `npm test` — FULL suite green; total test count **>= 3639** (this change only ADDS tests and re-shapes one existing impact assertion; the floor MUST NOT drop).
- [ ] 3.4 Confirm no `src/**` or `dist/**` file changed; touched files are exactly `benchmark/harness-checks.ts`, `benchmark/generate.ts`, `test/benchmark/harness-checks.test.ts`.
- [ ] 3.5 Confirm `benchmark/questions.yaml`, `benchmark/ground-truth/*`, and `benchmark/runs/*` are UNCHANGED (no RUN 3 generated; runs 1/2 frozen).

## Definition of Done

- Both MODIFIED `benchmark` spec requirements satisfied, each with its positive AND negative (L-009) scenario covered by a passing unit test.
- `assertNoAnswerLeak` no longer false-aborts on `view-dependency-active_departments`; a genuine standalone leak STILL aborts.
- `verifyDumpCoverage` passes a correct dump whose impact `whatToTest` names views/triggers; a wrong-DB dump with a genuinely-absent name STILL fails.
- Non-breaking proven: regression test shows `occursStandalone` fires on ZERO frozen run-1/2 pairs; concrete-kind coverage matching is byte-identical.
- `tsc`, `lint`, and `npm test` (count >= 3639) all green. One commit; no push.
