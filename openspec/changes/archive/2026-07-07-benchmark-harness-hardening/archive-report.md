# Archive Report — benchmark-harness-hardening

**Change**: benchmark-harness-hardening
**Branch**: v1-prep (repo dbgraph)
**Artifact store**: openspec
**Archived**: 2026-07-07
**Verdict**: PASS — 0 CRITICAL / 0 WARNING / 1 SUGGESTION (see `verify-report.md`, carried into this archive)

## Commits

| Commit | Role |
|--------|------|
| `139a0c3` | Pre-change baseline HEAD (clean tree, `npm test` = 3229). Used as the PRE side of the verifier's independent byte-identity reproduction (pre-change `score.ts` extracted and re-run against scratch copies of both committed runs). |
| `8555cb4` | Shipped commit — `feat(benchmark): add harness-checks coverage + manifest-hash module, wire build-packets abort and score stamp`. Amends the initial `023ce1d` (see NUL-byte incident below); touches exactly 4 files: `benchmark/harness-checks.ts` (new), `benchmark/build-packets.ts`, `benchmark/score.ts`, `test/benchmark/harness-checks.test.ts`. |

## Headline

The round-1 wrong-DB incident class — a WITHOUT dump silently missing a question's target object
because it was built from the wrong database — is now a **build-time exit-1**: `build-packets.ts`
derives each question's target identifiers from its family-typed ground truth and asserts every one
appears in the generated DDL dump BEFORE any packet is written; a miss aborts loudly, naming only the
bare missing object and the qid (never a composed ground-truth value). Separately, scored artifacts now
carry a **self-contained `promptSha256` audit trail**: `score.ts` joins `packets/manifest.json` at
scoring time and stamps the authoritative hash per `(qid, condition)` into `scored/per-question.json`,
so the no-leak trail no longer needs a separate-file cross-reference. The stamp is honestly worded — it
attests only which FROZEN PACKET content was scored, explicitly NOT a receipt that the agent was fed
exactly those bytes at runtime. Both mechanisms were adversarially re-proven by the verifier
independently of the applier's own evidence: a poisoned-db smoke (dropped table) hit the new exit-1 with
a leak-safe message, a bogus-hash smoke hit the mismatch-fail path, and — the HARD guard — the PRE-change
and POST-change scorers were run against scratch copies of both committed real runs (`torture-2026-07-06`,
`explore-payloads-2026-07-06`): `aggregate.json` sha256 is BYTE-IDENTICAL pre vs post for both runs, and
the `promptSha256` field is purely additive in `per-question.json` (no prior field value changed).

## Notable Incident During Apply — NUL-Byte / Leak-Scan Blind Spot

The initial commit `023ce1d` stored `harness-checks.ts` and `score.ts` using raw NUL bytes (0x00) as the
Map-key separator between `${qid}` and `${condition}`. The code was functionally correct (all 3246 tests
plus the B2.1 stamping smoke passed), but the NUL bytes made **git classify both files as BINARY** —
which caused the pre-commit **leak-scan hook to SILENTLY SKIP them** during its `git diff` grep scan (a
binary-classified file exposes 0 diff lines to a text-based grep, with no warning emitted). This means
the leak-scan ran, reported clean, and gave a false sense of coverage while never actually looking at the
added content of two files. The NULs were replaced with ASCII spaces (semantics unchanged — qids/
conditions never contain spaces) and amended into `8555cb4`; the verifier independently confirmed the
committed blobs of `8555cb4` are UTF-8 text with 0 NUL bytes, that `git show` renders 0 binary-file
markers, that `git diff -U0` exposes all 532 added lines to the grep, and that re-running the exact
pre-commit hook logic against `8555cb4` found 0 denylist matches — leak-scan is now genuinely covering
the files.

**KNOWN HOOK BLIND SPOT (flagged for follow-up):** binary-classified additions evade the leak-scan's
diff-grep entirely and silently — no error, no warning, nothing in the hook's own output signals that
content was skipped. This is a real gap in the leak-scan tooling itself, independent of this change: ANY
future commit that introduces NUL bytes (or any other content that trips git's binary heuristic) into a
tracked text file will pass leak-scan without actually being scanned. Recommended follow-up hardening for
the hook: detect and hard-fail (or loudly warn) when a file staged in the commit is classified binary by
git but has a text-like extension (`.ts`, `.js`, `.md`, `.json`, etc.), so a NUL-byte (or similar) leak
vector cannot silently bypass the scan again.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `benchmark` | Updated | 2 ADDED requirements appended at the end of the Requirements list in `openspec/specs/benchmark/spec.md` (existing no-dated-section convention, same pattern as the immediately prior `explore-payloads` / `sqlite-view-deps` merges): (1) **WITHOUT-dump coverage is machine-asserted at build time** — 4 scenarios (correct dump covers every target, wrong-DB dump missing a target aborts exit 1, targets derived per family by pinned rule, failure output leaks no key value); (2) **No-leak audit trail is self-contained in scored artifacts** — 4 scenarios (scored output carries the manifest hash for both conditions, non-empty mismatching hash fails loudly, empty raw hash stamped with honest attestation, stamp is additive/byte-identical HARD guard). |

## Suggestion Carried Forward (Non-Blocking)

**S-1** (from `verify-report.md`): the missing-in-manifest FAIL path (OQ1) and the mismatch FAIL path
share one offenders-then-throw branch in `score.ts`; only the mismatch path was smoke-exercised at the
stage level (missing-in-manifest is pure-unit-covered + code-reviewed, since all real-run qids are
present in the frozen manifest today). If a future change adds or renames a question, a one-line scratch
smoke of the missing-in-manifest exit would close this last documented gap. Non-blocking — the shared
throw path makes divergence unlikely and both severities are pure-unit-pinned (17/17 `harness-checks`
units green).

## Gates (re-confirmed at archive time, per verify-report.md)

| Gate | Result |
|------|--------|
| Type check (`npx tsc --noEmit`) | PASS — exit 0, clean, strict, no `any` |
| Lint (`npx eslint .` / `npm run lint`) | PASS — 0 errors / 0 warnings |
| Tests (`npm test` / `npx vitest run`) | PASS — 185 files, 3246 passed, exit 0 (3229 baseline + 17 harness-checks units) |
| Independence guard (`independence.test.ts`) | PASS — 5/5 |
| Frozen protocol (`git diff --stat 139a0c3 8555cb4`) | Exactly 4 files touched; zero `questions.yaml` / scorer / N / scoring-rule / `src` / `dist` bytes moved; no new runtime or dev deps |

## Housekeeping

- Nothing pushed: `v1-prep` has no upstream; `origin/v1-prep` does not exist; commit `8555cb4` is local
  only. No PR, no `gh`, no tag.
- `tasks.md` (modified) and `apply-progress.md` (untracked) were intentionally left uncommitted per the
  B2.3 plan — this archive's commit lands them, together with this report and the canonical spec sync.

## Next recommended: none — SDD cycle complete for `benchmark-harness-hardening`. The leak-scan hook
blind spot (binary-classified text files silently skipping the diff grep) is flagged above as an
independent follow-up hardening candidate for the hook itself, not for this change's scope.
