# Verification Report — benchmark-guard-precision

**Change**: benchmark-guard-precision
**Spec**: benchmark delta — 2 MODIFIED requirements / 11 scenarios
**Mode**: Independent adversarial verify (verifier re-ran the gate and a LIVE end-to-end pipeline; did not trust the applier's numbers)
**Repo / branch**: dbgraph @ post-v1 — HEAD `17581f2` (clean tree)
**Planning commit**: `dc9cc10` — **Fix commit**: `17581f2`
**Verifier reproduction date**: 2026-07-10

---

## Verdict

**ARCHIVE-READY** — the change makes BOTH honesty guards strictly MORE precise (never more permissive
for a real violation) and UNBLOCKS the deferred RUN 3 (N=6). All 11/11 spec scenarios COMPLIANT with
independently reproduced runtime evidence; full gate green; freeze exact; both L-009 negatives still
abort loudly; legal sweep clean on both commits.

**CRITICAL: 0  —  WARNING: 0  —  SUGGESTION: 2**

---

## Gate (verifier-executed, independent of apply's numbers)

| Gate | Command | Result |
|------|---------|--------|
| Type-check | `npx tsc --noEmit` | exit 0, clean, strict — the `ObjectKind` union `+'any'` breaks no exhaustiveness site |
| Lint | `npm run lint` (`eslint .`) | exit 0 — 0 errors / 0 warnings |
| Full suite | `npm test` (`vitest run`) | 230 files, 3669 tests passed, exit 0 (>= 3639 floor held; new units + one re-shaped impact assertion) |
| Independence guard | `independence.test.ts` (STAGE_RE) | green — no vitest suite imports/references a dev stage |

---

## Freeze (exact)

The `dc9cc10..17581f2` diff touches ONLY the 4 claimed files. The 3 substantive edits are:

| File | Change |
|------|--------|
| `benchmark/harness-checks.ts` | `occursStandalone` + `LEAK_FLANK_RE` added; `ObjectKind` extended with `'any'`; impact branch of `deriveCoverageTargets` emits `{kind:'any', name}`; `verifyDumpCoverage` gains the `definedNames` set + name-only `'any'` branch |
| `benchmark/generate.ts` | `assertNoAnswerLeak` calls `occursStandalone` in place of `haystack.includes`; guard comment reworded to state standalone / alphanumeric-adjacency semantics |
| `test/benchmark/harness-checks.test.ts` | new `occursStandalone` units + data-driven frozen-set regression; `verifyDumpCoverage` impact positive/negative + concrete-kind regression; existing impact assertion re-shaped `table` → `any` |

The 4th file in the range is the `tasks.md` checkbox bookkeeping. **No `src/**` or `dist/**` byte moved.**
`benchmark/questions.yaml`, `benchmark/ground-truth/*`, and `benchmark/runs/*` are UNCHANGED — no RUN 3
generated here; Runs 1 and 2 (N=5) stay frozen.

---

## LIVE pipeline proof (verifier ran the real stages end-to-end)

The two guards are wired into dev stages (`generate.ts` / `build-packets.ts`) that the independence
guard forbids any vitest suite from importing, so the verifier proved them by RUNNING the pipeline
against the committed SQLite torture fixture — not by asserting the applier's word:

1. **`generate` → N=6, exit 0.** Generation now produces the six-question set INCLUDING
   `view-dependency-active_departments` — the exact question whose `departments` answer token was
   false-flagged by the old `.includes` guard. The previously-blocked N=6 generation proceeds.
2. **`build-packets` → 12 packets, exit 0.** Coverage assertion passes for all six questions across both
   conditions. Critically, `impact-audit_log`'s five TRIGGER names are covered by the new NAME-only
   (kind-agnostic) impact match — the case the old hardcoded `kind:'table'` falsely reported missing.
   `promptSha256` is stamped per `(qid, condition)` as before (additive, untouched by this change).
3. **Wrong-DB dump → still exit 1.** A dump that omits a target object under EVERY kind still MISSES and
   aborts loudly, naming the bare object + qid — the coverage guard is not blinded by the name-only path.

---

## Guard-weakening hunt (adversarial — is either guard now more permissive for a REAL violation?)

The core risk of this change is that "make the guard more precise" silently becomes "make the guard
looser". The verifier hunted for exactly that and found NO weakening:

- **Leak guard boundary probe.** `occursStandalone` was probed at every flank position. Standalone
  occurrences STILL fire (return `true`): needle at start-of-string, at end-of-string, as the whole
  string, and flanked by punctuation. Only genuinely-embedded occurrences are exonerated (return
  `false`): alphanumeric/underscore-embedded, prefix-embedded, and digit-flanked. The new predicate
  flags a STRICT SUBSET of the old `.includes` matches — it stops flagging only identifier-embedded
  substrings that are not readable as the answer.
- **No pattern injection.** No `RegExp` is ever built from a needle. `occursStandalone` matches the
  needle as a LITERAL string via `indexOf` + a single-char flank test, so answer tokens carrying regex
  metacharacters (dots in qnames, commas/parens in composed FK paths) can never inject a pattern or
  cause a wrong match. This is the project's pinned alphanumeric-adjacency convention, deliberately NOT
  a `\b` regex.
- **L-009 negative (leak) still aborts.** A free-standing answer token still aborts LOUDLY, naming the
  qid.
- **Impact coverage cannot false-pass on the correct substrate.** A schema object name is unique within
  its schema, so a name-only match implies the intended object; a name genuinely ABSENT from a wrong-DB
  dump still misses and aborts (proven live above). Concrete-kind families (fk-path, trigger-inventory,
  column-type, constraint-semantics, view-dependency) keep exact `kind:name` matching byte-for-byte.
- **L-009 negative (impact) still aborts.** An impact `whatToTest` name absent under every kind still
  exits 1.
- **Frozen-set regression.** `occursStandalone` returns `false` for EVERY committed run-1/2
  `(question, answerToken)` tuple; the regression literals were verified byte-accurate against the
  committed `questions.yaml` / ground-truth. The guards fire on ZERO frozen pairs → frozen N=5 outcomes
  are unchanged.
- **Legal sweep.** Denylist sweep over both `dc9cc10` and `17581f2` added content: 0 hits.

---

## Spec Compliance Matrix (11 scenarios / 2 MODIFIED requirements)

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| R1 Question set / ground truth | Each family's ground truth derived by its pinned rule | frozen ground-truth unchanged; derivation regenerates committed keys byte-for-byte | COMPLIANT |
| R1 | N is fixed and pre-registered before any run | `questions.yaml` untouched; no `runs/` transcript added | COMPLIANT |
| R1 | No question embeds its own answer (standalone) | `occursStandalone` units + frozen-set regression (0 fires) | COMPLIANT |
| R1 | Key value embedded in a larger identifier is NOT a leak | live `generate` N=6 exit 0 emits `view-dependency-active_departments`; `departments` inside `active_departments` no longer aborts | COMPLIANT |
| R1 | Real standalone answer occurrence still aborts (L-009 neg) | boundary probe: start/end/whole-string/punctuation-flanked → `true` (still fires) | COMPLIANT |
| R2 WITHOUT-dump coverage | Correct dump covers every target — build succeeds | live `build-packets` → 12 packets exit 0 | COMPLIANT |
| R2 | Wrong-DB dump missing a target — LOUD exit 1 | live wrong-DB dump → exit 1, names bare object + qid | COMPLIANT |
| R2 | Targets derived per family by pinned rule (match-mode table) | `deriveCoverageTargets` units: concrete kinds kind-aware, impact `kind:'any'` | COMPLIANT |
| R2 | Impact whatToTest naming views/triggers covered by correct dump | live: `impact-audit_log` 5 trigger names matched NAME-only, coverage empty, exit 0 | COMPLIANT |
| R2 | Impact target name genuinely absent still aborts (L-009 neg) | name absent under EVERY kind still misses → exit 1 | COMPLIANT |
| R2 | Failure output leaks no key VALUE | miss message carries only bare object + qid, never the composed answer value | COMPLIANT |

Compliance summary: **11/11 scenarios COMPLIANT.**

---

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (nice to have — non-blocking, both pipeline-proven):
1. **S1** — There is no DEDICATED vitest unit exercising the view-dependency coverage branch in
   isolation; it is proven by the live pipeline run rather than a standalone assertion. Trace nit only —
   the branch shares the exact `kind:name` path unit-pinned for the other concrete-kind families.
2. **S2** — The `verifyDumpCoverage` impact POSITIVE unit uses a representative 2-name mini-dump
   (`CREATE TRIGGER …` + `CREATE VIEW …`) rather than reconstructing the literal `impact-audit_log`
   5-trigger case; the 5-trigger case itself is covered by the live `build-packets` run. Cosmetic —
   the name-only match logic is identical regardless of cardinality.

---

## Housekeeping

- Tree clean at `17581f2`. Nothing pushed as part of verification.
- The independence guard (`STAGE_RE`) is green: all decision logic lives in the pure, neutrally-named
  `harness-checks.ts` (imported by units); the thin `generate.ts` / `build-packets.ts` wiring is proven
  by the LIVE pipeline run, not by a forbidden stage import.

## Handoff

Recommended next phase: **sdd-archive** (clean ARCHIVE-READY). Purpose delivered: RUN 3 (N=6) is now
UNBLOCKED. RUN 3 itself is a SEPARATE labeled run under the frozen methodology — NOT part of this change.
