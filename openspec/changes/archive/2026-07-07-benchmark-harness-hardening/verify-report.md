# Verification Report — benchmark-harness-hardening

**Change**: benchmark-harness-hardening
**Spec version**: benchmark delta — 2 ADDED requirements / 8 scenarios
**Mode**: Standard verify + Strict-TDD evidence (RED to GREEN observed for the pure helpers; exact toStrictEqual pins)
**Repo / branch**: dbgraph @ v1-prep — HEAD 8555cb4 (local only, never pushed)
**Verifier reproduction date**: 2026-07-07

---

## Verdict

PASS. All 15/15 tasks + 6/6 Definition-of-Done items complete; 8/8 spec scenarios compliant with
independently reproduced runtime evidence; full gate green (tsc 0, lint 0/0, npm test 3246); zero golden
drift; frozen protocol untouched; NUL purge confirmed and leak-scan now genuinely covers the files; nothing
pushed; tree unchanged except the two intentionally-uncommitted planning artifacts and this report.

CRITICAL: 0 - WARNING: 0 - SUGGESTION: 1

---

## Completeness

| Metric | Value |
|--------|-------|
| Task items (B1.1-B1.6, B2.1-B2.3) | 9/9 done |
| Definition-of-Done items | 6/6 done |
| Total checkboxes | 15/15 |
| Incomplete | none |

apply-progress.md status = DONE; matches code state (commit 8555cb4 touches exactly the 4 planned files).

---

## Gate (verifier-executed, independent of apply's numbers)

| Gate | Command | Result |
|------|---------|--------|
| Type-check | npx tsc --noEmit | exit 0 clean (strict, no any) |
| Lint | npx eslint . | exit 0, 0 errors / 0 warnings |
| Full suite | npx vitest run | 185 files, 3246 passed, exit 0 (3229 baseline + 17 harness-checks units) |
| Independence guard | vitest run independence.test.ts | 5/5 passed |
| Harness-checks units | vitest run harness-checks.test.ts | 17/17 passed |

Frozen protocol: git diff --stat 139a0c3 8555cb4 = exactly 4 files (harness-checks.ts, build-packets.ts,
score.ts, harness-checks.test.ts). Zero questions.yaml / scorer / N / scoring-rule / src / dist bytes moved.
No new runtime or dev deps (package.json 2 deps / 12 devDeps, unchanged).

---

## Adversarial reproductions (verifier ran these independently)

### 1. Byte-identity of scoring (spec Req 2 — Stamp is additive, byte-identical)

Extracted the PRE-change scorer (139a0c3 score.ts, which neither imports harness-checks nor reads the
manifest) and ran it vs the POST-change scorer against independent scratch copies of BOTH committed runs'
raw records (runs/ is git-ignored; scratch out-dirs throughout, committed runs untouched):

| Run | aggregate.json sha256 PRE | sha256 POST | Match |
|-----|----------------------------|-------------|-------|
| torture-2026-07-06 | 0ebbc9be...44a | 0ebbc9be...44a | identical |
| explore-payloads-2026-07-06 | 458d70ac...192 | 458d70ac...192 | identical |

Accuracy/token outcomes unchanged (torture 40/80, explore 80/80). per-question.json diff is purely additive:
per run, 10 close-brace lines gain a comma plus 10 new promptSha256 lines (5 questions x 2 conditions); no
prior field VALUE changed. All 10 (qid,condition) pairs per run were empty-raw, WARNED to stderr and STAMPED
the frozen-manifest hash; zero mismatch / missing-in-manifest. Every stamped hash cross-checked against
packets/manifest.json = exact match (fk-path WITH db08897b..., WITHOUT 5b48f10f..., column-type WITH
d7a0c97e...). Same shas apply's B2.1 claimed. Reading score.ts confirms the code-level guarantee: aggregate
is built only from correct/total/tokens tallies; promptSha256 never enters it.

### 2. Poisoned-db negative proof (spec Req 1 — Wrong-DB dump to LOUD exit 1 + leaks no key VALUE)

Materialized the REAL torture db from committed fixture test/fixtures/sqlite/torture.sql into scratch (outside
repo). Determinism build to scratch out-dir: exit 0, manifest sha dfbe1c44... == frozen, diff -r vs
benchmark/packets = NO DIFF (correct source + deterministic). Copied the db, DROP TABLE assignments (remaining:
audit_log,counters,departments,employees,projects), ran build-packets --db poison.db --out scratch:

- Exit code 1. Stderr verbatim:
  Error: SELF-CHECK FAILED: column-type-assignments.dept_id (column-type) — DDL dump does not define target object(s): TABLE assignments
- Names qid + family + the bare missing OBJECT (TABLE assignments), an identifier already present un-redacted
  in a correct dump. NO composed answer value (no dataType, no FK path, no column list).
- Zero packets written before abort (fails on first question; scratch out-dir empty).
- Frozen benchmark/packets/ byte-identical before/after (dir hash 6f9e2f2b... and manifest dfbe1c44... unchanged).

### 3. Mismatch stage path (spec Req 2 — Non-empty mismatching hash fails loudly) — verifier bonus

Injected a bogus non-empty promptSha256=deadbeef... into one raw record of a scratch torture copy and ran score.ts:

- Exit code 1. Stderr: Error: score: manifest hash integrity failure — NO scored file emitted:
  column-type-assignments.dept_id (with): raw promptSha256 deadbeef... does not match the frozen manifest hash d7a0c97e...
- No scored/per-question.json and no aggregate.json emitted. Confirms no scored file for that run.

### 4. NUL-byte purge + leak-scan coverage (contract focus)

Initial commit 023ce1d stored NUL (0x00) map-key separators, making git classify the files BINARY so the
pre-commit leak-scan (greps git-diff added text) silently skipped them; amended 8555cb4 replaced NULs with
ASCII space. On the committed blobs of 8555cb4:

- git cat-file -p + file: all 4 files = JavaScript source, UTF-8 text. 0 NUL bytes (blobs and working tree).
- git show 8555cb4 renders 0 Binary-file markers; git diff -U0 exposes 532 added text lines (== numstat
  insertions) to the leak-scan grep, so the hook now actually SEES this content (a binary file exposes 0 lines).
- Ran the exact pre-commit hook logic against 8555cb4 added content: 2 denylist entries checked, 0 matches.
  Leak-scan CLEAN and genuinely covering the files.

### 5. Attestation honesty (contract focus)

score.ts ConditionResult.promptSha256 comment matches the design FROZEN wording: attests WHICH packet content
was scored and states explicitly it is NOT a receipt that the agent was fed exactly these bytes at run time
(no fed-prompt hash captured). No runtime-receipt overclaim. HONEST.

---

## Spec Compliance Matrix (8 scenarios / 2 requirements)

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Req1 Build-time DDL coverage | Correct dump covers every target | HIT units (derive + verifyDumpCoverage empty) + verifier determinism build exit 0 | COMPLIANT |
| Req1 | Wrong-DB dump missing a target to LOUD exit 1 | verifyDumpCoverage MISS unit + verifier poisoned-db smoke exit 1 | COMPLIANT |
| Req1 | Targets derived per family by pinned rule | deriveCoverageTargets 6 units (fk from/to, trigger qname, impact flat whatToTest, column-type/constraint table-from-qid, hyphen-anchor) | COMPLIANT |
| Req1 | Failure output leaks no key VALUE | join leak-guard unit (result key-shape pin) + verifier smoke message carries only KIND identifier | COMPLIANT |
| Req2 Self-contained no-leak trail | Scored output carries the manifest hash both conditions | join ok/empty-raw units + verifier byte-identity smoke (stamped == manifest, both conditions) | COMPLIANT |
| Req2 | Non-empty mismatching hash fails loudly | join mismatch unit + verifier score.ts stage smoke exit 1, no scored file | COMPLIANT |
| Req2 | Empty raw hash stamped with honest attestation | join empty-raw units (absent + empty-string) + verifier smoke 10/10 warn+stamp + honest comment | COMPLIANT |
| Req2 | Stamp is additive, byte-identical (HARD guard) | verifier PRE-vs-POST scorer smoke: aggregate sha PRE==POST both runs; per-question additive-only | COMPLIANT |

Compliance summary: 8/8 scenarios compliant.

### Note on the vitest / documented-smoke split (D12 precedent — evaluated ACCEPTABLE)

The independence guard (independence.test.ts, STAGE_RE) mechanically FORBIDS any vitest suite from importing a
dev stage or reading benchmark/runs/. So the stage-level exit-1 (Wrong-DB stage half, mismatch stage half) and
the byte-identity proof (reads real runs) CANNOT be vitest suites. The design mitigation is sound and mirrors
the D12 precedent: all decision logic lives in the pure, neutrally-named harness-checks.ts and is exhaustively
unit-pinned (17 exact toStrictEqual units: HIT/MISS, all 4 hash states, quoting/case/schema normalization,
REFERENCES-does-not-cover, kind:name discrimination, hyphen-robust qid anchoring, leak-safe result shape); the
thin stage wiring is proven by documented smoke. Crucially the verifier independently RE-RAN all three smoke
proofs (poisoned build exit 1, byte-identity PRE==POST, mismatch stage exit 1), so the not-vitest halves carry
live runtime evidence, not just the applier's assertion. Forcing these into vitest would require violating a
stronger invariant (run-independence of npm test). The split is the correct design, not a coverage gap.

---

## Correctness (static structural evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Req1 DDL-coverage assertion in build-packets | Implemented | derive + verifyDumpCoverage wired after assertPacketPair; pinned LOUD throw on miss |
| Req2 Self-contained manifest-hash stamp in score | Implemented | reads frozen manifest (benchmarkDir-relative default, --manifest override, missing FILE throws); joins + stamps additively; mismatch/missing collect+fail; empty warn+stamp |

## Coherence (design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 pure I/O-free harness-checks.ts, 3 exports | Yes | no fs/crypto/Database; neutral name evades STAGE_RE; stages import + call it |
| D2 / D2-shape per-family derivation; impact whatToTest FLAT string array; qid anchor slice(family.length+1) | Yes | matches committed shapes; hyphen-robust anchor unit-pinned |
| D3 membership in CREATE-defined kind:name set; schema/quote-strip, lowercase; REFERENCES excluded | Yes | regex tolerates TEMP / IF NOT EXISTS; kind:name discrimination unit-pinned |
| D4 / OQ1 frozen-manifest join; mismatch+missing FAIL, empty warn+stamp; honest FROZEN attestation | Yes | wording matches design verbatim; aggregate.json untouched |
| Inline fixtures (no new fixtures json), no stage/runs literal in test text | Yes | fixture-set + STAGE_RE + runs-string guards all green |

---

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (nice to have):
1. The missing-in-manifest FAIL path (OQ1) and the mismatch FAIL path share one offenders-then-throw branch in
   score.ts; only mismatch was smoke-exercised at the stage level (missing-in-manifest is pure-unit-covered +
   code-reviewed, since all real-run qids are present in the frozen manifest). If a future change adds/renames a
   question, a one-line scratch smoke of the missing-in-manifest exit would close the last documented gap.
   Non-blocking: the shared throw path makes divergence unlikely and both severities are pure-unit-pinned.

---

## Housekeeping

- Nothing pushed: origin exists but v1-prep has NO upstream; origin/v1-prep does not exist; commit 8555cb4 is
  contained ONLY by local v1-prep. No PR/gh/tag.
- Working tree unchanged except tasks.md (modified) and apply-progress.md (untracked), both intentionally
  uncommitted per B2.3 (archive commits them), plus this verify-report.md. All verifier scratch work (db
  materialization, re-score copies, poison probes) ran OUTSIDE the repo; committed benchmark/packets/ and
  benchmark/runs/ byte-identical before/after.
- Leak-scan clean; .leakscan-denylist.local present.

## Handoff

Recommended next phase: sdd-archive (clean PASS; archive commits tasks.md + apply-progress.md).
