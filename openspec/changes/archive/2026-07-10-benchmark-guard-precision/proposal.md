# Proposal: Benchmark Guard Precision

## Intent

Benchmark RUN 3 (N=6, the deferred view-dependency run) is BLOCKED by two false-positive bugs in the harness's OWN honesty guards (US-035). Both were diagnosed by live execution against HEAD `2f3c393` and confirmed in the code:

1. **Leak guard false positive** — `generate.ts` `assertNoAnswerLeak` uses a naive `haystack.includes(needle)`. It flags the answer value `departments` as "leaking" into the question text of `view-dependency-active_departments` because `departments` is a SUBSTRING of the view's own name `active_departments`. Generation aborts → N=6 impossible.
2. **Impact coverage kind hardcoded** — `harness-checks.ts` `deriveCoverageTargets` maps every impact `whatToTest` name to `{kind:'table'}`. `verifyDumpCoverage` matches by `kind:name`. The current key includes views+triggers (`impact-audit_log` → 5 triggers); a trigger `X` (target `table:X`, dump `trigger:X`) is reported missing and `build-packets` falsely exits 1.

Both guards implement anti-overclaiming spec requirements. Each fix makes the guard STRICTLY MORE precise — never more permissive for a real violation.

## Scope

### In Scope
- Leak guard → standalone-occurrence check with alphanumeric-adjacency semantics.
- Impact coverage → kind-agnostic (name-only) match; other families stay kind-aware.
- Delta spec (MODIFIED) for both requirements, each pinning a positive AND a negative case.
- Regression tests proving non-breaking over the frozen run-1/2 question set.

### Out of Scope
- Generating RUN 3 (N=6) — this only UNBLOCKS it.
- Any methodology change: no question, command, scoring rule, or token boundary altered.
- Runs 1/2 stay frozen; no change to `src/**` or `dist/`.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `benchmark`: (1) no-answer-leak overlap check moves from verbatim-substring to standalone-occurrence (alphanumeric-adjacency); (2) impact-derived WITHOUT-dump coverage matched by NAME (kind-agnostic), other families stay kind-aware.

## Approach

Both fixes land the pure logic in `benchmark/harness-checks.ts` — the importable, I/O-free seam (`generate`/`build-packets`/`score`/`render` match the independence guard `STAGE_RE` and CANNOT be unit-tested). Gap 1: new exported `occursStandalone(haystack, needle)`; `assertNoAnswerLeak` calls it instead of `.includes`. Gap 2: impact branch emits `kind:'any'`; `verifyDumpCoverage` treats `'any'` as name-only, concrete kinds stay exact. STRICT TDD, L-009.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `benchmark/harness-checks.ts` | Modified | `occursStandalone` added; impact → `kind:'any'`; `verifyDumpCoverage` name-only for `'any'` |
| `benchmark/generate.ts` | Modified | `assertNoAnswerLeak` uses `occursStandalone` |
| `test/benchmark/harness-checks.test.ts` | Modified | new unit + regression tests; updated impact-shape assertion |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fix masks a real leak | Low | Negative L-009 test: standalone occurrence STILL aborts |
| Name-only masks wrong-DB dump | Low | Negative test: genuinely-absent name STILL aborts; names unique per schema |
| Frozen N=5 outcomes shift | Low | Regression test over run-1/2 (question, answerTokens) asserts identical pass |

## Rollback Plan

Revert the single commit. The three files return to HEAD `2f3c393`; no data, artifact, or frozen run is touched.

## Dependencies

- None (localized; no `src`/`dist` changes).

## Success Criteria

- [ ] `assertNoAnswerLeak` passes for `view-dependency-active_departments`; a standalone leak still aborts.
- [ ] `verifyDumpCoverage` passes a correct dump with view/trigger `whatToTest`; a wrong-DB dump still fails.
- [ ] Suite green, test count >= 3639 (new tests only add); `tsc` + `lint` clean.
- [ ] Zero behavior change for frozen N=5 runs, proven by regression tests.
