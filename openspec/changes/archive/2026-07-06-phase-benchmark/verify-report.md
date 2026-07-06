# Verify Report — phase-benchmark (US-035)

**Change**: phase-benchmark
**Spec version**: benchmark spec (6 requirements, 20 scenarios)
**Mode**: Standard verify + honesty audit (artifact store: openspec)
**Branch**: closeout · HEAD: 84267bb · Date: 2026-07-06

---

## Verdict: PASS

The harness is complete, reproducible, and behaviorally compliant with all 6 requirements
(20/20 scenarios COMPLIANT). The unfavorable result (WITH 40% vs WITHOUT 80%) is reported
faithfully, unsoftened, with its root cause, circularity, run incident, and token-accounting
deviation documented per the honesty contract. No CRITICAL issues. No spec/honesty violation.
Two non-blocking WARNINGs (artifact-consistency only). Archive-ready.

---

## Completeness

| Metric | Value |
|--------|-------|
| Apply tasks (Batches 1-4) | 29 / 29 complete [x] |
| Batch R tasks | 8 / 8 complete [x] (R.7 deliberately SKIPPED, documented) |
| Total task checkboxes | 37 / 37 |

R.7 (secondary mssql run) is annotated SKIPPED in tasks.md AND in the report (Environment row +
Run notes) — a spec-permitted skip: Req 1 makes the secondary optional. The Definition of Done
roll-up lines remain [ ] by convention (traceability summaries, not tasks).

---

## Gate Execution (run by verifier)

| Gate | Result |
|------|--------|
| npx tsc --noEmit (strict) | PASS — exit 0, clean |
| npm run lint (eslint .) | PASS — 0 errors / 0 warnings |
| npm test (vitest run) | PASS — 3004 passed across 175 files, ZERO benchmark artifacts |
| Node | v22.19.0 (>= 22.6, satisfies --experimental-strip-types) |

Benchmark subset re-run explicitly: test/benchmark -> 46 passed (scorer + independence tests).
Gitignore integrity: git ls-files benchmark/runs benchmark/packets -> empty (dirs exist on disk,
correctly untracked). Working tree clean after all verifier operations.

---

## Independent Re-execution Evidence (core of this verify)

### 1. Scorer honesty — re-ran the scorer on committed runs
score.ts benchmark/runs/torture-2026-07-06 -> WITH 40% / WITHOUT 80% (tokens WITH 293325 vs
WITHOUT 133442). The re-scored aggregate.json is BYTE-IDENTICAL to the committed one and matches
docs/benchmarks.md Results EXACTLY:

| Family | WITH | WITHOUT | WITH tok | WITHOUT tok | matches docs |
|--------|------|---------|----------|-------------|--------------|
| fk-path | 0% | 100% | 36467 | 26693 | yes |
| column-type (control) | 0% | 100% | 102282 | 26686 | yes |
| impact | 100% | 0% | 41660 | 26694 | yes |
| trigger-inventory | 100% | 100% | 30273 | 26704 | yes |
| constraint-semantics | 0% | 100% | 82643 | 26665 | yes |
| Overall | 40% (2/5) | 80% (4/5) | 293325 | 133442 | yes |

Per-question raw records spot-checked against the report appendix — every answerParsed, key, and
verdict matches (column-type WITH INTEGER|NULL vs key INTEGER|NOT NULL; constraint WITH
"emp_id, project_id" vs ordered key "project_id, emp_id, dept_id"; fk-path WITH one atom vs both;
impact WITH "assignments, employees" equals affected --json whatToTest key; trigger both sides match).

### 2. Ground-truth integrity — regenerated from a torture-built graph
generate.ts --project <scratch graph> --out <temp> reproduced the committed set BYTE-IDENTICALLY:
questions.yaml IDENTICAL, ground-truth/ IDENTICAL, impact-snippets/ IDENTICAL. Invoked correctly
(affected probe runs with cwd=projectDir, absolute snippet path); ran to a temp --out so the
committed set was never touched. No stray probe .sql survived — committed impact-snippets/ holds only
the selected impact-departments.sql. The three spec-pinned rules reproduce (fk-path from FK edge
table, column-type from field payloads, impact from affected --json).

### 3. Root-cause claim VERIFIED TRUE (not merely asserted)
src/core/present/explore.ts: formatExplore renders header + neighbor groups + (full only) bodyHash +
level + a hasDynamicSql warning. It touches node.payload ONLY to read the hasDynamicSql flag
(lines 130-131) — it NEVER renders column type, nullability, or PK/FK column membership, though the
payload is present on the node. src/cli/format/query.ts returns hits carrying only kind/qname/id/score.
So the graph STORES the exact facts (ground truth derived from those payloads via the store API) but
the CLI presentation layer does not expose them. This is exactly why WITH lost on column-type /
constraint-semantics / fk-path, and why the two WITH wins came from affected --json (the one
structured-fact command). The Run notes root-cause claim is a TRUE product gap, correctly attributed.

### 4. view-dependency exclusion VERIFIED TRUE
src/adapters/engines/sqlite/capabilities.ts declares supportsDependencyHints=false (US-007 declared
blindness). The excluded family is genuinely uninstantiable on SQLite for BOTH conditions equally (no
data, not a suppressed unfavorable result), and the exclusion is disclosed in questions.yaml
(familiesExcluded + notes) and prominently in the report N section. Honest.

---

## Spec Compliance Matrix (20/20 COMPLIANT)

| Req | Scenario | Evidence | Result |
|-----|----------|----------|--------|
| R1 | Primary rebuildable from committed source | Regenerated byte-identical; Reproduce section present | COMPLIANT |
| R1 | Secondary optional corroboration only | Env NOT RUN; complete on fixture; no mssql in runs | COMPLIANT |
| R2 | Each family GT derived by pinned rule (byte-for-byte) | Regeneration reproduced GT byte-identically | COMPLIANT |
| R2 | N fixed 5-10 pre-registered before run | N=5, hard-asserted 5<=N<=10, committed before runs | COMPLIANT |
| R2 | No question embeds its own answer | generate.ts leakage self-check; GT held separately | COMPLIANT |
| R3 | WITH exposes exactly four commands | protocols/with.md: exactly query/explore/affected/status | COMPLIANT |
| R3 | WITHOUT dump fair, same source of truth | sqlite_master dump (6 CREATE TABLE); WITH packet 0 DDL | COMPLIANT |
| R3 | Identical framing across conditions | shared question+answer-format; only schema access differs | COMPLIANT |
| R3 | One token boundary applied identically | tokens.ts: actual-preferred else ceil(chars/4) labeled | COMPLIANT |
| R4 | Closed-form exact/set-match, no partial credit | families.ts pinned; 46 benchmark tests pass | COMPLIANT |
| R4 | Scorer blind to condition labels | scoreAnswer gets family/answer/groundTruth only; score.ts blind | COMPLIANT |
| R4 | Rubric items flagged / reported apart | Satisfied by EXCLUSION (no free-text family); a limitation | COMPLIANT |
| R4 | Scorer unit tests pass inside npm test | scorer.test.ts within the 3004 green | COMPLIANT |
| R5 | All required sections in order | Methodology, Environment, N, Results, Token acct, Limitations, Reproduce | COMPLIANT |
| R5 | Limitations enumerated alongside results | All 7 required + circularity + chars/4 + free-text | COMPLIANT |
| R5 | Unfavorable results reported, not suppressed | 40% vs 80% in table AND prose; full per-question appendix | COMPLIANT |
| R5 | No extrapolation | Forbidden phrasings absent as claims; scoped to fixture/set/model | COMPLIANT |
| R5 | Secondary non-reproducible + honest read-only downgrade | Non-reproducible; read-only BY CONSTRUCTION; SSPI; SSMS=attestation | COMPLIANT |
| R6 | Suite green with no run artifacts | 3004 green; runs/+packets gitignored, ls-files empty | COMPLIANT |
| R6 | No vitest suite triggers a run | independence.test.ts asserts it; passes | COMPLIANT |

Compliance summary: 20/20 scenarios COMPLIANT.

---

## Honesty Audit (L-009 — the report IS the honesty contract)

- Sections: all 7 required present in the spec order (extra "claim under test" preface is allowed).
- Unfavorable headline NOT softened: 40% vs 80% in the Results table AND in prose ("WITH condition
  LOST"), plus "spending 2.2x the tokens". Every per-question outcome reported (2 WITH wins, 3 losses).
- Forbidden phrasings: "better in general" / "more accurate" appear ONLY in (a) the scoped
  claim-under-test and (b) the explicit forbidding-list — never as a result or superiority claim.
- Token-accounting deviation stated plainly (not buried): transcripts were not persisted, so the
  schema-bearing chars/4 figure was not computable after the fact; the table reports ACTUAL runtime
  usage including a fixed ~26.7k per-agent overhead identical on both sides — so the DELTA, not the
  absolutes, is meaningful. In the Token accounting section.
- Run incident documented: round-1 WITHOUT invalidated (a POSIX-path invocation on Windows / MSYS
  path mangling embedded a wrong DDL); detected by cross-checking WITH tool outputs vs packet DDL;
  remediated by regenerating with a native path and re-running; round-1 discarded; WITH round unaffected.
- CLI paper cuts enumerated (Run notes item 4). R.7 skip recorded in BOTH tasks.md and the report.
- US-035 story reconciliation (docs/stories/07-quality-publication.md) matches delivered scope.

---

## Security / Leak Scan

- git ls-files benchmark/runs benchmark/packets -> empty (working artifacts gitignored).
- No private paths / credentials in tracked benchmark/ or docs (git grep for temp path, user path,
  password/secret/api-key/server= -> none).
- No private mssql object name in docs/benchmarks.md — only the mssql-private label + NOT RUN.
- No new tags; branch closeout has no upstream configured — nothing pushed.
- Leak-scan git-hooks present (scripts/git-hooks/pre-commit + commit-msg).
- Working tree clean except this verify-report.md (not committed).

---

## Issues Found

### CRITICAL (block archive)
None.

### WARNING (should fix — non-blocking, artifact-consistency only)
1. Raw run records carry EMPTY promptSha256. Design (Persistence) and task R.4 specify a populated
   promptSha256 per runs raw record so verify can corroborate no key text entered any prompt. The raw
   records leave it empty. The no-leak trail is NOT lost — per-packet hashes ARE present in
   benchmark/packets/manifest.json, and build-packets.ts enforces no-key/no-DDL/no-tool-docs at build
   time — but the raw-record schema field deviates from the design. Affects gitignored artifacts only.
2. tasks.md asserts N=6 / six families but the delivered set is N=5. The RESOLVED block and tasks
   2.4 / 4.2 describe six instantiated families (incl. view-dependency) and small N ~6. The actual
   committed set is N=5 (view-dependency uninstantiable on SQLite). HONESTLY reconciled in questions.yaml
   and the report, WITHIN the spec fixed 5-10 bound, passes the generate.ts hard-assert — so NOT a
   spec/honesty violation — but tasks.md was left stale relative to what shipped.

### SUGGESTION (follow-up, not this change)
1. Harness hardening (self-identified in Run notes): build-packets.ts should assert the emitted DDL
   dump covers every question target object against ground-truth source_ddl_ref — this would have caught
   the round-1 wrong-DDL incident automatically instead of by manual cross-check.
2. Product follow-up (the benchmark actual finding): render node payloads in explore (and/or a --json
   payload view for query/explore) so an agent can reach the exact facts the graph already stores.
   Belongs to a later change (US-036+), not phase-benchmark.

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D2 package-leak guard (files=dist) | Yes | benchmark/test/docs excluded structurally |
| D3 .ts via strip-types, comparators shared with run | Yes | score.ts imports scorer/; no duplicated normalization |
| D5 mechanical GT + source_ddl_ref | Yes | every key carries source_ddl_ref; regeneration byte-identical |
| D8 WITHOUT = comment-free sqlite_master dump | Yes | 6 CREATE TABLE, no pedagogical comments |
| D11 WITH forbidden from reading .sql | Yes | protocols/with.md enforces; WITH packet 0 DDL |
| D13 scorer condition-blind | Yes | comparators receive no label; verified in code + tests |
| D14 fixture primary, mssql optional | Yes | secondary NOT RUN; deliverable complete on fixture |
| N knob --per-family 1 -> N in 5-10 | Deviated | Delivered N=5 vs tasks stated N=6 — spec-compliant, documented, tasks.md stale (WARNING 2) |

---

## Verdict

PASS. phase-benchmark is complete, reproducible, and honest. All 20 spec scenarios are COMPLIANT under
independent re-execution; the unfavorable headline is reported unsoftened with root cause, circularity,
run incident, and token-accounting caveat all documented. No CRITICAL issues; the two WARNINGs are
artifact-consistency nits that do not block archive. Recommend proceeding to sdd-archive.
