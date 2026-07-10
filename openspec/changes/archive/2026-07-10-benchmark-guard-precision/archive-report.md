# Archive Report — benchmark-guard-precision

**Change**: benchmark-guard-precision
**Branch**: post-v1 (repo dbgraph)
**Artifact store**: openspec
**Archived**: 2026-07-10
**Verdict**: ARCHIVE-READY — 0 CRITICAL / 0 WARNING / 2 SUGGESTION (see `verify-report.md`, carried into this archive)

## Commits

| Commit | Role |
|--------|------|
| `dc9cc10` | Planning commit — landed the openspec artifacts for this change (`proposal.md`, `specs/benchmark/spec.md` delta, `design.md`, `tasks.md`). Serves as the PRE side of the verifier's freeze reproduction. |
| `17581f2` | Shipped fix commit (current HEAD, clean tree). The `dc9cc10..17581f2` diff touches EXACTLY the 4 claimed files: the 3 substantive edits (`benchmark/harness-checks.ts`, `benchmark/generate.ts`, `test/benchmark/harness-checks.test.ts`) plus `tasks.md` checkbox bookkeeping. No `src/**` or `dist/**` byte moved; `benchmark/questions.yaml`, `benchmark/ground-truth/*`, and `benchmark/runs/*` unchanged. |

## Headline

Two false-positive bugs in the benchmark harness's OWN honesty guards — both of which BLOCKED the
deferred RUN 3 (N=6) — are fixed by making each guard STRICTLY MORE precise, never more permissive for a
real violation:

1. **Leak-guard alphanumeric-adjacency fix.** `assertNoAnswerLeak` in `generate.ts` used a naive
   `haystack.includes(needle)`, which flagged the answer token `departments` as "leaking" into the
   question text of `view-dependency-active_departments` — because `departments` is a SUBSTRING of the
   view's own name `active_departments`. A new pure, exported `occursStandalone(haystack, needle)` in the
   neutrally-named `harness-checks.ts` treats a token as a leak ONLY when it occurs as a STANDALONE
   occurrence — not flanked on either side by `[a-z0-9_]` (the project's alphanumeric-adjacency
   convention, deliberately NOT a `\b` regex; the needle is matched as a LITERAL string via `indexOf`, so
   answer tokens carrying punctuation are never treated as a pattern). `generate.ts` now wires to it; the
   `needle.length >= 2` floor and the error message are verbatim-unchanged.
2. **Impact-coverage kind-agnostic (name-only) match.** `deriveCoverageTargets` hardcoded every impact
   `whatToTest` name to `{kind:'table'}`, while `verifyDumpCoverage` matches by `kind:name`. Since the
   `affected` command's `whatToTest` may name a table, VIEW, or TRIGGER, a trigger target `X` (`table:X`)
   was reported missing against a dump defining `trigger:X` — so `build-packets` falsely exited 1
   (`impact-audit_log` → 5 triggers). `ObjectKind` gains an `'any'` sentinel; the impact branch emits
   `{kind:'any', name}`; `verifyDumpCoverage` matches `'any'` by NAME (a schema object name is unique
   within its schema, so name-only cannot false-pass on the correct substrate) while every concrete kind
   keeps exact `kind:name` matching byte-for-byte.

Both mechanisms were adversarially re-proven by the verifier via a LIVE end-to-end pipeline run against
the committed SQLite torture fixture: `generate` → N=6 exit 0 (emitting the previously-blocked
`view-dependency-active_departments`); `build-packets` → 12 packets exit 0 with `impact-audit_log`'s five
trigger names covered NAME-only and `promptSha256` stamped; a wrong-DB dump STILL exits 1. Both L-009
negatives still abort loudly, and `occursStandalone` fires on ZERO frozen run-1/2 pairs.

## Apply Deviation

One deviation from the plan, self-corrected during apply and confirmed by verify: the independence guard
(`independence.test.ts`, `STAGE_RE = /benchmark[\\/](?:generate|build-packets|score|render)\.(?:ts|js)/`)
caught a source COMMENT that contained a literal dev-stage PATH STRING (a `benchmark/…​.ts` reference).
The comment was REWORDED to remove the literal path so the independence guard stays green; no behavior
changed. This is the intended safety net working as designed — the guard forbids not just imports but any
literal dev-stage path token leaking into a scanned file.

## Purpose Delivered

This change UNBLOCKS benchmark **RUN 3 (N=6)** — the deferred view-dependency run. It does NOT generate
RUN 3, bump N in the committed set, or alter any question / command / scoring rule / token boundary.
**RUN 3 is a SEPARATE, labeled run** under the frozen methodology and remains to be executed as its own
orchestrator step; Runs 1 and 2 (N=5) stay frozen and labeled with their N.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `benchmark` | Updated — 2 MODIFIED requirements | In `openspec/specs/benchmark/spec.md`: (1) **Question set is mechanically derived and carries machine-checkable ground truth** — requirement prose gained the standalone-token / alphanumeric-adjacency no-leak clause; the "No question embeds its own answer" scenario now says STANDALONE occurrence; TWO scenarios ADDED (embedded-in-larger-identifier is NOT a leak; real standalone occurrence still aborts / L-009 negative). (2) **WITHOUT-dump coverage is machine-asserted at build time** — requirement prose gained the kind-aware vs kind-agnostic split; the per-family table gained a **Match mode** column and a **view-dependency** row; TWO scenarios ADDED (impact whatToTest naming views/triggers covered by the correct dump; impact target name genuinely absent still aborts / L-009 negative). All 8 OTHER benchmark requirements preserved byte-identical. Non-destructive merge — the delta restated both requirements in full; no requirement removed. |

## Follow-ups (Non-Blocking, from verify-report.md)

- **S1** — No DEDICATED unit isolates the view-dependency coverage branch; it is pipeline-proven and
  shares the `kind:name` path already unit-pinned for the other concrete-kind families. Trace nit.
- **S2** — The `verifyDumpCoverage` impact POSITIVE unit uses a representative 2-name mini-dump rather
  than the literal `impact-audit_log` 5-trigger case (the 5-trigger case is covered by the live
  `build-packets` run). Cosmetic — the name-only logic is cardinality-independent.

Neither is a coverage gap that blocks archive; both are recorded here for a future harness touch.

## Gates (re-confirmed at archive time, per verify-report.md)

| Gate | Result |
|------|--------|
| Type check (`npx tsc --noEmit`) | PASS — exit 0, strict; `ObjectKind` union `+'any'` breaks no exhaustiveness site |
| Lint (`npm run lint`) | PASS — 0 errors / 0 warnings |
| Tests (`npm test`) | PASS — 230 files, 3669 tests, exit 0 (>= 3639 floor held) |
| Independence guard (`independence.test.ts`) | PASS — green (all decision logic in pure `harness-checks.ts`; stage wiring proven by live pipeline) |
| Freeze (`git diff dc9cc10..17581f2`) | Exactly the 4 claimed files; zero `src` / `dist` / `questions.yaml` / `ground-truth` / `runs` bytes moved |
| Legal sweep (both commits) | 0 hits |

## Housekeeping

- Tree clean at `17581f2`. Nothing pushed as part of this change.
- All planning artifacts (`proposal.md`, delta `spec.md`, `design.md`, `tasks.md`), plus this
  `verify-report.md` and `archive-report.md`, travel with the archived folder as the audit trail.

## Next recommended

**none** — the SDD cycle for `benchmark-guard-precision` is complete. The natural follow-up is a
NEW, separately-labeled orchestrator step to execute **RUN 3 (N=6)** on the now-unblocked frozen harness
— that is its own run, not a continuation of this change.
