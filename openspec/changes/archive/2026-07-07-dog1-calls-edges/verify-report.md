# Verify Report — dog1-calls-edges

**Change**: dog1-calls-edges (DOG-1 — calls edges, routine to routine invocation)
**Repo / branch**: C:\Users\ecardoso\dev\dbgraph @ post-v1 (HEAD c2ed29b)
**Artifact store**: openspec (files) — no engram writes
**Mode**: Strict TDD (RED to GREEN, L-009 exact-set discipline)
**Verdict**: PASS — 0 CRITICAL, 0 WARNING, 2 SUGGESTION

## Executive summary

Implementation matches the proposal, design (D1–D6 + Spec Coherence) and all 8 spec deltas
(34 scenarios). Gate measured green by the verifier: tsc --noEmit clean, eslint 0/0, npm test
3340 passed / 7 skipped (3347) — exactly the expected 3340 + 7. The 7 skipped are the
DBGRAPH_INTEGRATION-gated container suites, which the verifier RAN under Docker (mssql/pg/mysql):
210 integration tests passed with the working tree byte-identical afterward (no golden rewritten).
Cross-engine freeze holds: zero sqlite/mongodb src or golden drift. Regression protection (phantom
[table] stub removal) is REAL, not theater — confirmed against pre-change buildDependencyEdges and
proven at both the synthetic and container tiers.

## Completeness

- Tasks: 24 / 24 complete (A.1–A.10, B.1–B.7, C.1–C.7). DoD: 9 / 9.
- Commits: 5fd1d48 (A), 2a9a021 (B), c2ed29b (C) — match the batch structure.
- openspec mode carries apply-progress in tasks.md checkboxes + commit history (no separate file);
  both consistent. The two reconciliation annotations (A.3 sqlite-absence verified green in the C.7
  FINAL gate; DoD S4 line) are accurate.

## Gate — measured by the verifier

| Check | Command | Result |
|-------|---------|--------|
| Type check | npx tsc --noEmit | PASS (exit 0, no any) |
| Lint | npx eslint . | PASS (0 / 0) |
| Unit + default-CI | npm test | PASS 196 files, 3340 passed / 7 skipped / 0 failed (=3347) |

### Docker integration re-run (verifier-executed, DBGRAPH_INTEGRATION=1)

Images local: mcr.microsoft.com/mssql/server:2022-latest, postgres:16, mysql:8.

| Suite(s) | Tests | Result |
|----------|-------|--------|
| pg + mysql e2e.integration | 49 | PASS |
| mssql cli.e2e + adapter e2e integration (A.9 / C.4) | 26 | PASS |
| mssql extract/fingerprint/queries-for-json + pg/mysql extract | 135 | PASS |
| Total | 210 | PASS |

Tree clean before and after every container run -> goldens byte-identical vs live-materialized
torture.sql catalogs. Nothing pushed (no upstream), no tags on HEAD.

## Spec Compliance Matrix (34 scenarios, all COMPLIANT)

| Scenario | Test evidence | Result |
|----------|---------------|--------|
| graph-model S1 calls connects routine nodes | edge.test.ts + routine-target.test.ts | COMPLIANT |
| graph-model S2 fires_on carries event (regression) | model.test.ts:194 | COMPLIANT |
| graph-model S3 inferred_reference score in range (regression) | model.test.ts:210 | COMPLIANT |
| graph-model S4 mssql declared / pg,mysql parsed | mssql calls-normalize + pg,mysql calls-edges | COMPLIANT |
| graph-model S5 SQLite emits no calls | sqlite/calls-absence.test.ts | COMPLIANT |
| graph-norm S6 proc->proc = 1 calls, 0 stub (regression pin) | routine-target.test.ts S6 | COMPLIANT |
| graph-norm S7 unresolved routine -> no edge/stub | routine-target.test.ts S7 | COMPLIANT |
| graph-norm S8 table-only routine -> 0 calls | routine-target.test.ts S8 | COMPLIANT |
| graph-norm S9 self-call only for real recursion | routine-target.test.ts S9 | COMPLIANT |
| graph-query S10 read/write separation (regression) | impact.test.ts:120 | COMPLIANT |
| graph-query S11 depth truncation (regression) | impact.test.ts:172-193 | COMPLIANT |
| graph-query S12 cyclic terminates (regression) | impact.test.ts:202-216 | COMPLIANT |
| graph-query S13 dynamic-SQL warning (regression) | impact.test.ts:237 | COMPLIANT |
| graph-query S14 impact reaches callers via inbound calls | impact-calls.test.ts (exact set, chain=calls, triangulation, write-negative) | COMPLIANT |
| mssql S15 proc EXEC proc = 1 declared, no stub | calls-normalize + calls-map + cli integration A.9 | COMPLIANT |
| mssql S16 fn->fn declared calls | calls-normalize + cli integration A.9 | COMPLIANT |
| mssql S17 table-only routine -> 0 calls (negative) | calls-normalize.test.ts | COMPLIANT |
| mssql S18 fixture + re-blessed goldens pin calls, 0 stub | golden re-bless + cli integration A.9 | COMPLIANT |
| pg S19 fn->fn = 1 parsed calls | pg/calls-edges + pg e2e integration B.6 | COMPLIANT |
| pg S20 builtin/body-absent -> no calls (negative) | pg/calls-candidates.test.ts S20 | COMPLIANT |
| pg S21 dynamic EXECUTE string -> no calls + hasDynamicSql | pg/calls-candidates.test.ts S21 | COMPLIANT |
| pg S22 fixture + re-bless, stubCount 0, no self | pg/calls-edges + golden re-bless + integration | COMPLIANT |
| mysql S23 proc CALL proc = 1 parsed calls | mysql/calls-edges + mysql e2e integration B.6 | COMPLIANT |
| mysql S24 table-only -> 0 calls, no self (negative) | mysql/calls-candidates.test.ts S24 | COMPLIANT |
| mysql S25 masked PREPARE/EXECUTE -> no calls + hasDynamicSql | mysql/calls-candidates.test.ts S25 | COMPLIANT |
| mysql S26 fixture + re-bless, stubCount 0, no self | mysql/calls-edges + golden re-bless + integration | COMPLIANT |
| sqlite S27 torture graph 0 calls, CapMatrix unchanged | sqlite/calls-absence (guards non-trivial GREEN) | COMPLIANT |
| sqlite S28 function-like token invents nothing | sqlite/calls-absence (forced routine-kind dep -> 0) | COMPLIANT |
| mcp S29 ALTER+DROP INDEX golden (regression) | mcp/precheck.test.ts | COMPLIANT |
| mcp S30 unmatched identifiers reported (regression) | mcp/precheck.test.ts | COMPLIANT |
| mcp S31 SQLite column-drop exact dependents (regression) | mcp/precheck.test.ts:165 | COMPLIANT |
| mcp S32 altering called routine surfaces callers | precheck.test.ts C.2 (exact whatToTest) + cli integration C.4 | COMPLIANT |
| mcp S33 explore renders outbound/inbound calls | explore-format C.3 + explore-calls.txt golden + integration C.4 | COMPLIANT |
| mcp S34 related filters to calls kind | related-format C.3 + integration C.4 (kinds calls) | COMPLIANT |

Compliance: 34 / 34 COMPLIANT. Every calls assertion is L-009 exact-set (toStrictEqual(new Set(...))
or toHaveLength(1) + toStrictEqual on endpoints) with explicit not.toContain* NEGATIVES; no
existence-only assertion stands in for a calls-edge pin. The sqlite absence suite explicitly guards
against a trivially-empty GREEN.

## Adversarial findings

L-009 exact-set discipline (the change soul) — HELD. The mssql/pg/mysql/normalize calls tests assert
the EXACT src->dst set per kind plus negatives: no self-edge (unless genuine recursion, S9), no
read/write to the callee, no phantom [table] stub, zero calls from the callee. The masked-string /
builtin / dynamic-SQL negatives (S17/S20/S21/S24/S25) are pinned.

Confidence honesty — HELD, no code path blurs the tiers. mssql calls carry declared (hardcoded in
tokenizer.ts ONLY when sourceIsRoutine AND refTypeToRoutineKind(ref_object_type) is a routine);
pg/mysql carry parsed (unchanged tokenizer). buildDependencyEdges passes dep.confidence through
UNCHANGED. No path assigns inferred to a calls edge (US-008 inference untouched). Verified in code
AND goldens.

Regression golden is REAL protection, not theater — CONFIRMED. Pre-change buildDependencyEdges at
a0f54a4 has targetKind = dep.target.kind ?? 'table' feeding resolveOrStub, with NO routine branch.
Two independent reverts each break a pinned test: (a) revert the D5 normalize branch -> kind
procedure resolves the real proc but emits a WRONG reads_from edge -> A.7/S6 "exactly {calls,
writes_to}" + "ZERO reads_from to usp_log_change" FAIL; (b) revert the adapter kind-setting -> kind
undefined -> ?? table -> resolveOrStub(table, usp_log_change) mints the phantom [table] stub ->
A.7/S6 "ZERO stub" FAIL. The bug was genuinely DORMANT pre-change; the new fixture + fix keep
stubCount 0 across all three SQL goldens.

Impact closure byte-consistency — CONFIRMED. graph-query C.1 readImpact and mcp-server C.2
whatToTest both resolve to the SAME EXACT set {dbo.usp_refresh_totals}, reached through the inbound
calls edge, absent from every write set, byte-identical on re-run. The precheck pivot resolves ALTER
TABLE dbo.usp_log_change to the PROCEDURE node via kind-agnostic identifier extraction (deviation C
— sound, mirrors the SQLite main.departments table pivot).

Cross-engine freeze — HELD. No src/adapters/engines/{sqlite,mongodb} change; no
test/fixtures/{sqlite,mongodb} golden change. No test byte-pins the EDGE_KINDS tuple ORDER (A.1/C.5
audit correct — model.test.ts pins length 11 + membership, edge.test.ts pins the depends_on+1 slot
positionally, not a full snapshot). SQLite/mongodb goldens byte-identical.

### Documented deviations — all evaluated SOUND

| Deviation (batch) | Assessment |
|-------------------|------------|
| A — resolveRoutineTarget drops design referencedById param | SOUND: never stubs, so no stub id needed; design interface was speculative. |
| A — refTypeToRoutineKind co-located in tokenizer.ts | SOUND: avoids a map/tokenizer import cycle; routine-only subset, correct T-SQL mapping (P->procedure, FN/IF/TF->function), trims CHAR(2) padding. |
| A — access read placeholder on the declared calls dep | SOUND: the normalize routine branch ignores dep.access (emits calls). |
| A — offline rows JSON hand-curated vs container goldens | Both tiers green + byte-identical; container e2e validates the rows against reality. |
| B — offline pg/mysql row fixtures decoupled from container torture | Both tiers green; integration e2e is the guard (see SUGGESTION-1). |
| C — kind-agnostic ALTER TABLE identifier pivot to a procedure | SOUND: qname extracted, graph resolves the kind; mirrors the SQLite table pivot. |
| C — C.3 zero prod change | CONFIRMED: no src/core/present change; shared formatter renders calls via Object.keys(neighbors).sort(). |

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (future, non-blocking):
1. Offline row fixtures vs torture.sql coupling (B discovery). The pg/mysql
   test/fixtures/*/rows/routines.json fixtures are hand-maintained and decoupled from torture.sql;
   only the DBGRAPH_INTEGRATION-gated container tier catches a drift between them. Both green today.
   Consider a cheap consistency check so a future torture.sql edit not mirrored into the offline rows
   fails in default-CI rather than only under the gate.
2. Symmetric latent phantom-stub for non-routine sources (out of DOG-1 scope). calls gates on
   sourceIsRoutine, so a TRIGGER or VIEW that invokes a stored routine would still default
   target.kind -> table and could mint a phantom [table] stub — the mirror of the proc->view
   kind-preservation item already deferred in design Open Questions. Verified DORMANT: no current
   mssql torture trigger/view invokes a routine and stubCount 0 holds across all three SQL goldens,
   so there is no hidden stub today. Worth a one-line note for a future change.

## Correctness (static — structural evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| calls in EdgeKind + EDGE_KINDS (after depends_on) | OK | edge.ts |
| RawDependency.target.kind documented load-bearing | OK | catalog.ts doc |
| resolveRoutineTarget + routine branch (no stub) | OK | reference-resolver.ts (real proc/fn, null->skip) |
| IMPACT_EDGE_KINDS += calls as READ-impact | OK | impact.ts; not in WRITE_KINDS |
| mssql catalog JOIN + ref_object_type plumbing | OK | queries/json-rows/map/tokenizer |
| pg/mysql routine candidates, self-excluded | OK | pg,mysql map filter + tokenizer kind carry |
| Present renders calls (no allowlist change) | OK | no present src change; docs/format-spec.md note added |

## Coherence (design D1–D6)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 reuse types, only edge.ts gains calls | YES | no new confidence tier; catalog.ts doc only |
| D2 mssql catalog JOIN + declared plumbing | YES | ref.type CHAR(2) P/FN/IF/TF; null row skipped |
| D3 per-engine detection (declared vs parsed) | YES | false-positive register upheld (sp_executesql -> no calls) |
| D4 explicit pg/mysql self-exclusion | YES | pg header self-ref filtered; mysql uniform |
| D5 routine-target resolution, no stub | YES | null->skip; genuine recursion still yields self-call (S9) |
| D6 impact traversal + minimal re-bless | YES | read-impact; SQLite substrate zero drift |

## Verdict

PASS. All 24 tasks + 9 DoD items complete; 34/34 spec scenarios COMPLIANT with L-009 exact-set tests
passing at default-CI and re-verified green under Docker at the integration tier (210 tests);
tsc/lint/test gate green (3347); cross-engine + sqlite/mongodb freeze intact; regression protection
proven real; confidence tiers unblurred; nothing pushed; tree clean apart from this report. Two
low-priority SUGGESTIONS for future changes; zero CRITICAL/WARNING. Ready for sdd-archive.
