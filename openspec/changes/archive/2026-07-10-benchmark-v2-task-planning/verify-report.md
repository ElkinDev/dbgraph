# Verify Report — benchmark-v2-task-planning

**Change**: benchmark-v2-task-planning
**Branch**: main (repo dbgraph)
**HEAD verified**: `4448537` — clean tree
**Artifact store**: openspec
**Verified**: 2026-07-10
**Method**: independent adversarial re-verification (verifier re-derived every claim from source at HEAD; did not trust apply)

## Verdict

**ARCHIVE-READY** — **0 CRITICAL / 1 WARNING / 2 SUGGESTION.**

Everything reproduced. `tsc` exit 0; lint 0 errors / 0 warnings; `npm test` 232 files / 3727 tests + 4
skipped (exact). The Docker-gated live leg ran GREEN (5/5 on a live mssql container). The dormant
read-key path was exercised end-to-end in scratch. The HARD-STOP freezes reproduced byte-identical. The
planted keys were independently re-grepped and every audit break-attempt was caught. The comparator
adversarial matrix is airtight. Legal sweep: 0 hits.

## Gates (re-run at HEAD `4448537`)

| Gate | Result |
|------|--------|
| Type check (`npx tsc --noEmit`) | PASS — exit 0, strict; the `Family` union + `GroundTruthByFamily` additions break no exhaustiveness site |
| Lint (`npm run lint`) | PASS — 0 errors / 0 warnings |
| Tests (`npm test`) | PASS — 232 files, 3727 tests, **+4 skipped** (the Docker-gated `mssql-substrate` suite when `DBGRAPH_INTEGRATION` is unset), exit 0 |
| Docker-gated live leg (`DBGRAPH_INTEGRATION=1`) | PASS — 5/5 GREEN on a live mssql container (spin → apply `torture.sql` → dbgraph index → `build-packets --substrate mssql-torture` → assertions) |
| Legal sweep (all three commits) | 0 hits |

## Reproduction Table

| Claim | Verifier action | Result |
|-------|-----------------|--------|
| `tsc` clean | `npx tsc --noEmit` at HEAD | exit 0 |
| lint clean | `npm run lint` | 0/0 |
| suite count | `npm test` | 232 files / 3727 tests / 4 skipped — EXACT |
| Docker live leg | `DBGRAPH_INTEGRATION=1 npm test` (mssql container) | 5/5 GREEN on the live substrate |
| dormant read-key path | ran `generate --substrate mssql-torture` in a scratch dir, N=3 | NO store opened; scope-excluded leak guard GREEN; manifest carries `substrate` + `promptSha256`; WITHOUT dump = 1449 tokens (honest, stripped `torture.sql`) |
| HARD-STOP freeze | diffed all frozen sqlite artifacts + empty/default sqlite packets/render | byte-identical, empirically — all empty + default sqlite packets/render reproduced byte-for-byte |
| planted keys | independently re-grepped `test/fixtures/mssql/torture.sql` | `usp_refresh_totals` is the SOLE caller of `usp_log_change`; line 208 is the SOLE dynamic-SQL site; 5 precedence pairs all real |
| key audit break-attempts | planted deliberately-wrong `source_ddl_ref` spans | all caught — audit FAILS LOUDLY naming qid+target |
| comparator matrix | adversarial `comparePlanOrder` inputs | airtight (see matrix below) |

## Live Leg (Docker-gated, `mssql-substrate.test.ts`)

- GREEN 5/5 on a live mssql container reusing `test/fixtures/mssql/container.ts`.
- Pipeline proven end-to-end on the live substrate: spin mssql → apply `torture.sql` → index with dbgraph
  (the WITH graph) → `build-packets --substrate mssql-torture`.
- Asserted the WITHOUT dump EMBEDS the SP bodies (sp_executesql / EXEC chains / composite FKs) and that
  plan-* coverage passes on the live substrate.
- Docker absent → the suite SKIPS honestly (the +4 skipped in the default run); numbers NEVER fabricated.

## Dormant Read-Key Path (exercised in scratch, N=3)

- `generate --substrate mssql-torture` opened **NO store** — it READ `benchmark/planning-keys/<qid>.json`.
- The scope-excluded leak guard (shared `excludeScopeBlock`) ran GREEN: the `=== SCOPE BEGIN/END ===`
  region is fair input and correctly excluded from the answer-leak scan.
- The manifest carried the additive `substrate` field AND `promptSha256`.
- The WITHOUT dump measured **1449 tokens** (honest, over the deterministic stripped `torture.sql`).

## Key-Audit Findings (incl. break attempts)

- **Re-grep of the fixture (independent):**
  - `plan-callers` — `usp_refresh_totals` is the **SOLE** caller of `usp_log_change` (whole-fixture grep;
    the r1 completeness-by-DDL-audit requirement is satisfied, not assumed).
  - `plan-blindspots` — **line 208** is the SOLE dynamic-SQL (`sp_executesql`) site; the `sp_dynamic_search`
    → `orders` reference is invisible to static edges (the flagship known-incomplete regime).
  - `plan-order` — the **5 precedence pairs** are all real in the DDL (`order_items→orders/products→regions`,
    `fn_net_amount→fn_round_money`, `usp_refresh_totals→usp_log_change`).
- **Break attempts (all caught):** planting a target whose `source_ddl_ref` cites lines that do NOT
  contain the fact causes the grep-audit to FAIL LOUDLY naming the qid and target — an unverifiable
  hand-planted key is a SPEC VIOLATION, never a silent pass (Req 1 v2 negative reproduced).
- **Never store-derived:** `generate.ts` READS the committed key file for plan-* and never calls
  `affected`/`getImpact` to build a plan-* key (Req 1 confirmed).

## Comparator Adversarial Matrix (`comparePlanOrder`)

| Input class | Expected | Observed |
|-------------|----------|----------|
| valid linearization A (respects all pairs, full scope once) | CORRECT | CORRECT |
| distinct valid linearization B (same key) | CORRECT (same verdict) | CORRECT |
| pair violation (`regions` before `products`) | WRONG | WRONG |
| missing scoped object (fewer than M) | WRONG | WRONG |
| extra out-of-scope object | WRONG | WRONG |
| duplicate scoped object | WRONG | WRONG |
| empty answer | WRONG | WRONG |
| quoted/normalized qnames | normalized then judged | correct |
| unconstrained pairs (no precedence) | any relative order accepted | accepted |

Deterministic: the comparator returns the SAME verdict for any given answer, independent of which valid
linearization the key's pairs would themselves admit.

## Six-Requirement Compliance (with the explicit deferral)

| # | Requirement (MODIFIED) | Machinery delivered | Status |
|---|------------------------|---------------------|--------|
| 1 | Question set — hand-planted planning-key carve-out | keys committed with `source_ddl_ref`/`source_ddl_refs`; grep-audit ±; N-bound 3–10; scope-excluded leak guard; never store-derived | **CONFORMANT** — all machine-provable scenarios pass |
| 2 | Scoring — valid-topological-order rule | `comparePlanOrder` + full unit matrix; set-match reused for callers/blindspots; scorer tests inside `npm test` | **CONFORMANT** |
| 3 | Reproducible-with-Docker tier | Docker-gated live proof GREEN; honest SKIP when Docker absent | **CONFORMANT** |
| 4 | Multiple runs — own substrate-labeled set | substrate threads set→manifest→render; frozen SQLite runs byte-identical (HARD guard reproduced); additive families | **CONFORMANT for machinery.** The scenario "v2 lands as its own substrate-labeled table" is CONDITIONAL ("whenever v2 results are reported") — the labeled RUN + `docs/benchmarks.md` table are DEFERRED (see W1) |
| 5 | WITHOUT-dump coverage — plan-* kind-agnostic | `deriveCoverageTargets` plan cases; `CREATE_OBJECT_RE` += `PROCEDURE\|PROC\|FUNCTION`; coverage ± on live + stripped dump; composed-value redaction | **CONFORMANT** |
| 6 | Report carries all limitations (5 v2 additions) | spec enumerates the five v2 limitations, CONDITIONAL on v2 results existing | **CONDITIONAL/DEFERRED** — the docs enumeration lands with the labeled run (see W1) |

## Findings

### WARNING-1 (tracked follow-up, NON-blocking)

This change delivers **MACHINERY + PRE-REGISTERED KEYS ONLY.** Req 4's scenario "v2 lands as its own
substrate-labeled table" and ALL Req 6 docs/limitations scenarios are CONDITIONAL — they trigger
"whenever v2 results are reported" — and are DEFERRED to the labeled-run phase. `docs/benchmarks.md` is
intentionally UNTOUCHED by this change. **Archive MUST NOT mark those two requirements' report-side
scenarios as delivered;** they are carried as a tracked follow-up (the labeled RUN v2 phase). The spec
scenarios merge as written because they are conditional on v2 results existing, which is accurate.

### SUGGESTION-1 (future hardening)

`auditPlanKey` lacks span-tightness enforcement: an over-WIDE `source_ddl_ref` citation (a span that
contains the fact but also much unrelated DDL) would still PASS. Tightening the audit to require the
narrowest justifying span would harden the anti-circularity story.

### SUGGESTION-2 (harmless today)

`generate.ts` has a top-level `dist` import that runs even on the mssql path. Harmless at present (dist
is built), but it would FAIL in a dist-less checkout of the mssql/read-key path. Move the import behind
the sqlite branch or make it lazy.

## Rulings Upheld

- **Audit both-endpoints rule** is spec-conformant (the leak/pair guards call the ONE shared
  `excludeScopeBlock` helper from both `generate` and `build-packets`).
- The **6→9 taxonomy edits** (3 new families registered atop the existing 6) are a legitimate D4 extension.
- **`process.exit(0)`** on the read-key path is acceptable.
- Audit fact-semantics chosen by apply are acceptable.

## Deferral (explicit, carried to archive)

DEFERRED to the labeled-run phase — machinery + pre-registered keys are READY; the following land
post-archive as their own orchestrator step:

- Req 4 "v2 lands as its own substrate-labeled table" (the RUN + the `docs/benchmarks.md` v2 table).
- ALL Req 6 docs/limitations scenarios (the five v2 limitations enumerated alongside the v2 results).

## Next recommended

Archive is unblocked (0 CRITICAL). The natural follow-up is the LABELED RUN v2 phase — see the
archive report's Follow-ups.
