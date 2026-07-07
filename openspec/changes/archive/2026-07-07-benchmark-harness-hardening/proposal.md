# Proposal: Benchmark harness hardening — build-time DDL-coverage assertion + self-contained no-leak audit trail

## Intent

Two protocol-integrity defects surfaced during the phase-benchmark run, both recorded in that change's
archive, both caught today only by MANUAL cross-check:

1. **Round-1 incident** (archive `2026-07-06-phase-benchmark`, `docs/benchmarks.md` Run notes #3). `build-packets.ts --db`
   was handed a POSIX-style path on Windows; the embedded WITHOUT DDL dump came from the WRONG database.
   Every existing self-check (WITH-has-no-DDL, WITHOUT-has-DDL, no-answer-leak) PASSED — none verifies the
   dump actually covers the questions' target objects. The WITHOUT round was invalidated and re-run;
   detected only by eyeballing WITH-agent tool output against the packet DDL.
2. **W1** (phase-benchmark verify). Raw run records carry an EMPTY `promptSha256`, though design R.4 required
   it populated. The per-packet hashes DO exist in `packets/manifest.json`, so the no-leak audit trail
   currently DEPENDS on cross-referencing a separate file.

Why now: `v1-prep` freezes this harness for reuse. Turning both defects into build-time / score-time
failures makes the next run trustworthy with no human in the loop. Success = the wrong-DB class becomes a
LOUD build abort, and the no-leak audit trail is self-contained in the run/scored artifacts.

## Scope

### In Scope

- **DDL-coverage self-check in `build-packets.ts`.** Per question, derive the target object identifiers
  from the family-typed ground truth — fk-path `fromTable`/`toTable`, trigger-inventory `triggerQname`,
  impact `whatToTest`, plus the table encoded in the qid for column-type / constraint-semantics — and
  ASSERT each appears in the generated WITHOUT DDL dump. Mismatch → exit 1 naming the missing object
  CLASS/identifier (a bare schema identifier, already allowed in the dump), NEVER a composed key value.
- **Self-contained no-leak audit trail.** `score.ts` joins `packets/manifest.json` and STAMPS the
  authoritative `promptSha256` per `(qid, condition)` into `scored/per-question.json`; a non-empty
  raw-record hash that MISMATCHES the manifest fails loudly, a missing one warns. Design picks the
  least-invasive honest mechanism.

### Out of Scope

- ANY change to the frozen question set, N, scoring rules, protocols, or the token-accounting boundary — HARD guard.
- New runtime OR dev dependencies (zero-dep ADR).
- Re-running the benchmark or editing committed results / `docs/benchmarks.md` numbers.

## Capabilities

> Research complete: `openspec/specs/benchmark/spec.md` is the canonical capability.

### New Capabilities

- None.

### Modified Capabilities

- `benchmark`: strengthen "WITHOUT dump is fair, from the same source of truth" with a BUILD-TIME machine
  assertion that the dump covers every question's target objects; strengthen the no-leak audit trail so
  `promptSha256` is self-contained in scored artifacts, not manifest-only.

## Approach

Both fixes are additive validation on existing DEV/orchestrator tooling — no product / `src` / `dist`
touch. `build-packets.ts` already reads each family's ground truth (via `answerAtoms`); the coverage check
reuses that same typed read to extract target identifiers and asserts each is a substring of the catalog
DDL dump before packets are written. `score.ts` gains a manifest join at scoring time. STRICT TDD applies
at apply: RED tests for a wrong-DB dump, a missing target, and an empty/mismatched hash first.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `benchmark/build-packets.ts` | Modified | Per-question DDL-coverage assertion from family-typed ground truth; LOUD exit-1 on miss |
| `benchmark/score.ts` | Modified | Read `packets/manifest.json`; stamp authoritative `promptSha256` into scored output; fail on mismatch / warn on missing |
| `test/benchmark/*.test.ts` | New/Modified | RED→GREEN: wrong-DB dump aborts, missing target aborts, mismatched/empty hash handled |
| `benchmark/ground-truth/*.json` | Unchanged (read-only) | Source of target identifiers; NOT modified |
| `openspec/specs/benchmark/spec.md` | Modified (via sdd-spec) | Delta strengthening the two requirements |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-strict coverage check false-positives (case / quoted identifiers) | Med | Match catalog identifier tokens as the DDL already carries them; derive from the same fields `answerAtoms` uses; unit-test hit AND miss |
| `promptSha256` stamp OVERCLAIMS (manifest hash ≠ proof the agent saw that packet) | Med | Scored field attests the FROZEN packet hash (the no-leak-checked content) ONLY; design states the exact guarantee; no runtime-input claim without an actual fed-prompt hash — HONESTY |
| `source_ddl_ref` is `file:line`, not an object name | Low | Derive targets from family answer fields + qid, NOT from `source_ddl_ref`; design pins per-family extraction |
| Scope creep into the frozen protocol | Low | HARD guard; verify checks the diff touches only the two scripts, their tests, and the spec delta |

## Rollback Plan

Revert the two script diffs, the new/changed tests, and the spec delta. Fully additive validation — no
data, artifact, question, or protocol was changed. `npm test` returns to its prior green state; the harness
behaves exactly as archived.

## Dependencies

- Reuses committed `benchmark/ground-truth/*.json` and `packets/manifest.json` shapes — no new inputs.
- ZERO new runtime or dev dependencies. STRICT TDD applies at apply.

## Success Criteria

- [ ] A DDL dump from the WRONG database (missing a question's target object) makes `build-packets` exit 1 with a message naming the missing object — no key value leaked.
- [ ] A correct dump passes unchanged; existing structural + no-leak self-checks still pass.
- [ ] `scored/per-question.json` carries the authoritative `promptSha256` per `(qid, condition)`, sourced from `manifest.json` — no separate-file cross-reference needed for the no-leak audit.
- [ ] A raw record whose non-empty `promptSha256` mismatches the manifest fails scoring loudly.
- [ ] Zero changes to `questions.yaml`, N, scoring rules, or protocols; `npm test` green; zero new deps.
