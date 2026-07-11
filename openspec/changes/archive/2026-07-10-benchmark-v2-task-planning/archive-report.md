# Archive Report — benchmark-v2-task-planning

**Change**: benchmark-v2-task-planning
**Branch**: main (repo dbgraph)
**HEAD at archive**: `4448537` — clean tree
**Artifact store**: openspec
**Archived**: 2026-07-10
**Verdict**: ARCHIVE-READY — 0 CRITICAL / 1 WARNING / 2 SUGGESTION (see `verify-report.md`, carried into this archive)

## Commits

| Commit | Role |
|--------|------|
| `eb37562` | Batch A — Docker-free machinery: shared `excludeScopeBlock` helper (r2), `CREATE_OBJECT_RE` += `PROCEDURE\|PROC\|FUNCTION` (r4/D2c), `deriveCoverageTargets` plan cases, the 3 scorer families + `comparePlanOrder` comparator, the hand-planted `benchmark/planning-keys/*.json` with `source_ddl_ref`/`source_ddl_refs`, and the Docker-free unit tier (topo matrix, set-match, grep-audit ±, non-leak regression). |
| `e9ee054` | Batch B — substrate dimension + mssql dump + Docker-gated proof: `--substrate` threading through `generate`/`build-packets`/`render` (default `sqlite-torture` = byte-identical), the read-key path in `generate` (opens NO store), the mssql stripped-DDL WITHOUT dump, the additive manifest `substrate` field, and the `describe.skipIf(!DBGRAPH_INTEGRATION)` live pipeline proof. |
| `4448537` | HEAD at archive (clean tree) — final gate/bookkeeping state on which verify reproduced everything (tsc 0, lint 0/0, 232 files / 3727 tests + 4 skipped, live leg 5/5). |

## Headline

v2 adds a task-planning **decision-quality** measurement layer to the benchmark methodology as a
PURELY ADDITIVE extension: three new closed-form families (`plan-callers`, `plan-blindspots`,
`plan-order`) scored on the mssql torture fixture through the UNCHANGED blind scorer / aggregate /
coverage / promptSha256 machinery. Its load-bearing move is the **anti-circularity carve-out** — where
Runs 1–3 mechanically derive rename-impact keys straight from dbgraph's own `affected` output (so a WITH
agent can score by REPEATING the tool), v2's plan-* keys are HAND-PLANTED, DDL-audited, committed, and
READ (never store-derived). The flagship `plan-blindspots` family measures the OPPOSITE of tool-copying:
recognizing that a `sp_executesql` reference is invisible to static edges — knowing your blind spots.

**This change ships MACHINERY + PRE-REGISTERED KEYS ONLY.** `docs/benchmarks.md` is intentionally
UNTOUCHED; the labeled v2 RUN and its limitations enumeration are a deferred, separately-labeled phase.

## What Shipped

- **9-family scorer** — the existing 6 families plus the 3 v2 planning families registered in
  `scorer/index.ts` (`Family`, `FAMILIES`, `GroundTruthByFamily`, `scoreAnswer` switch); `score.ts`
  UNTOUCHED (family-generic, picks up families once registered).
- **`comparePlanOrder`** — the one novel comparator (pure, in `scorer/families.ts`): correct IFF the
  answer is a PERMUTATION of the scoped set (each once, no extra, no dup) AND every `[u,v]` precede-pair
  satisfies `index(u) < index(v)`; accepts ANY valid linearization, deterministic. Set-match reused
  unchanged for `plan-callers` / `plan-blindspots`.
- **`excludeScopeBlock` shared guard** — ONE exported pure helper in `harness-checks.ts`, called by BOTH
  `generate`'s `assertNoAnswerLeak` and `build-packets`'s `assertPacketPair` (r2 — no hand-copied
  pattern); the `=== SCOPE BEGIN ===` / `=== SCOPE END ===` region is fair input excluded from the scan.
- **`CREATE_OBJECT_RE` fix** — extended to `PROCEDURE|PROC|FUNCTION|TABLE|VIEW|TRIGGER|INDEX` (r4/D2c);
  without it mssql routines never register as defined and the build-time coverage assert always fails.
  A frozen-set regression test pins the fix.
- **Planted keys with `source_ddl_ref` audit** — committed `benchmark/planning-keys/*.json` (GT shape +
  top-level `source_ddl_ref` string + per-target `source_ddl_refs` map); a grep-audit verifies each fact
  is PRESENT at its cited span and FAILS LOUDLY otherwise.
- **Substrate dimension** — `--substrate` on `generate`/`build-packets` (default `sqlite-torture` =
  byte-identical), an additive `substrate` manifest field, and an optional `render --substrate` caption
  (absent ⇒ byte-identical); the label threads set → manifest → render.
- **Stripped mssql WITHOUT dump** — deterministic comment/header/`GO`-stripped `torture.sql` keeping every
  CREATE incl. full SP bodies verbatim; token cost measured honestly (1449 tokens in the dormant-path run).
- **Docker-gated proof** — `test/benchmark/mssql-substrate.test.ts` (`describe.skipIf(!DBGRAPH_INTEGRATION)`)
  spins mssql via `container.ts`, indexes with dbgraph, runs `build-packets --substrate mssql-torture`, and
  asserts the WITHOUT dump embeds SP bodies + plan-* coverage passes on the LIVE substrate; Docker absent → SKIPS.

## Deviations (chosen during apply, confirmed by verify)

- **Scorer/independence 6→9** — apply registered 3 new families atop the existing 6. This is a legitimate
  D4 extension (additive family registration + comparator), not a change to any frozen run. Verify upheld it.
- **`process.exit(0)`** on the read-key path — accepted (the read-key branch legitimately exits after
  emitting the question record; no store to close).
- **Audit fact-semantics chosen by apply** — apply pinned the exact grep semantics for what counts as the
  planted fact being "present" at a cited span. Accepted as spec-conformant; the span-tightness gap is
  recorded as SUGGESTION-1 (follow-up b).

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `benchmark` | Updated — 6 MODIFIED requirements | In `openspec/specs/benchmark/spec.md`, full-block replacement of: (1) **Reproducible-first, dual substrate** — added the reproducible-with-Docker MIDDLE tier + 2 scenarios (Docker rebuildable / Docker-unavailable honest SKIP). (2) **Question set is mechanically derived** — added the hand-planted planning-key EXCEPTION, the N 3–10 planning-substrate bound + anti-cherry-pick clause, and 3 scenarios (planted key auditable v2 positive / lacks-fact FAILS v2 negative / never store-derived). (3) **Scoring is deterministic** — added the valid-topological-order rule to the prose + its OWN unit-matrix mandate + 5 topo scenarios (positive A / positive B / violation / missing / extra). (4) **Multiple runs** — added the NEW-substrate-labeled-set concept + substrate threading + 3 scenarios (v2 table v2 positive / frozen SQLite byte-identical HARD guard / v2 adds families without altering frozen runs). (5) **WITHOUT-dump coverage** — extended kind-agnostic matching to plan-*, added 3 table rows + 2 scenarios (Docker dump covers plan-* v2 positive / plan-* absent aborts v2 L-009 negative). (6) **The report carries all limitations** — added the five v2 limitations (conditional on v2 results existing) + 2 scenarios (v2 carries five limitations v2 positive / omitting one is a violation v2 negative). The delta's `(Previously:…)` annotations were delta-only markers and were NOT carried into the canonical source of truth. All 4 OTHER benchmark requirements (Two condition protocols; npm test independence; view-dependency family; No-leak audit trail) preserved BYTE-IDENTICAL. Non-destructive merge — no requirement removed. |

## Follow-ups (tracked, NON-blocking)

- **(a) LABELED RUN v2 phase — completes Req 4 table + all of Req 6.** Machinery + pre-registered keys are
  READY; the RUN itself is a separate orchestrator step: generate the pre-registered set → commit → run
  6 sessions WITH/WITHOUT on the Docker-tier mssql substrate → blind-score → write the
  `docs/benchmarks.md` v2 results table (substrate-labeled) WITH the FIVE v2 limitations enumerated
  alongside (plan-quality-unscored, format-prompting bias, hand-planted-key judgment risk,
  statically-decidable radius, Docker-tier reproducibility). This closes WARNING-1: the conditional
  Req-4 "v2 lands as its own substrate-labeled table" scenario and ALL Req-6 docs/limitations scenarios.
- **(b) SUGGESTION-1 — `auditPlanKey` span-tightness.** Enforce the narrowest justifying `source_ddl_ref`
  span so an over-wide citation cannot pass. Future harness hardening.
- **(c) SUGGESTION-2 — dist-less dormant path.** `generate.ts` has a top-level `dist` import that runs
  even on the mssql/read-key path; harmless today (dist built) but would fail in a dist-less checkout.
  Make it lazy or gate it behind the sqlite branch.

## WARNING-1 (recorded from verify — archive does NOT mark these delivered)

Req 4's "v2 lands as its own substrate-labeled table" scenario and ALL Req 6 docs/limitations scenarios
are CONDITIONAL ("whenever v2 results are reported") and DEFERRED to follow-up (a). The spec merges them
as written (they are conditional on v2 results existing, which is accurate), but the RUN-side deliverables
are NOT delivered by this change and are carried as the tracked follow-up above.

## Gates (re-confirmed at archive time, per verify-report.md)

| Gate | Result |
|------|--------|
| Type check (`npx tsc --noEmit`) | PASS — exit 0, strict |
| Lint (`npm run lint`) | PASS — 0 errors / 0 warnings |
| Tests (`npm test`) | PASS — 232 files, 3727 tests, +4 skipped (Docker-gated), exit 0 |
| Docker live leg (`DBGRAPH_INTEGRATION=1`) | PASS — 5/5 GREEN on a live mssql container |
| Dormant read-key path | PASS — N=3, no store opened, scope-excluded leak guard green, manifest substrate + promptSha256, WITHOUT dump 1449 tokens |
| HARD-STOP freeze | PASS — all frozen sqlite artifacts + empty/default sqlite packets/render byte-identical, empirically |
| Legal sweep (all 3 commits) | 0 hits |

## Housekeeping

- Tree clean at `4448537`. Nothing pushed as part of this change.
- All planning artifacts (`proposal.md`, delta `specs/benchmark/spec.md`, `design.md`, `tasks.md`), plus
  `verify-report.md` and this `archive-report.md`, travel with the archived folder as the audit trail.
- `docs/benchmarks.md` is intentionally UNTOUCHED — the v2 labeled RUN is follow-up (a).

## Next recommended

**none for this change** — the SDD cycle for `benchmark-v2-task-planning` is complete. The natural next
step is a NEW, separately-labeled orchestrator step to execute the **LABELED RUN v2 phase** (follow-up a),
which completes the deferred Req-4 table and Req-6 limitations enumeration on the now-ready machinery.
