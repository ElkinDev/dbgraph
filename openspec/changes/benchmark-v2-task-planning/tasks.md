# Tasks: Benchmark v2 — Task-Planning Decision-Quality Measurement

Test-first (STRICT TDD: RED observed before GREEN). L-009 positives AND negatives.
Two batches; per-batch gate; ONE conventional commit per batch; hooks active; NO push.
Scope: only `openspec/changes/benchmark-v2-task-planning/`, `benchmark/`, `test/benchmark/`.
Binding rulings r1–r4 (design `## Reconciliation`) override earlier prose. `docs/benchmarks.md`
is UNTOUCHED — the v2 labeled RUN is a later phase; this change builds machinery + pre-registers keys only.

## Batch A — Docker-free: helper, regex, comparator, families, keys, unit tier

### Phase A1: Shared scope-exclusion helper (r2)

- [x] A1.1 RED: in `test/benchmark/harness-checks.test.ts`, assert a pure `excludeScopeBlock(text)` in
  `benchmark/harness-checks.ts` strips the region between literal own-line markers `=== SCOPE BEGIN ===`
  and `=== SCOPE END ===`; text with no markers returns unchanged; nested/absent-END aborts loudly.
- [x] A1.2 GREEN: implement `excludeScopeBlock` once as an exported pure helper in `harness-checks.ts`.
- [x] A1.3 GREEN: call the SAME helper from `generate.ts` `assertNoAnswerLeak` (:446) and
  `build-packets.ts` `assertPacketPair` (:243) — one helper, both callers, no hand-copied pattern (r2).

### Phase A2: CREATE_OBJECT_RE extension + regression (r4 / D2c)

- [x] A2.1 RED: frozen-set regression in `harness-checks.test.ts` — a mini-dump with `CREATE PROCEDURE`,
  `CREATE PROC`, `CREATE FUNCTION` registers those names as defined; existing `TABLE|VIEW|TRIGGER|INDEX`
  matches stay byte-identical (benchmark-guard-precision style).
- [x] A2.2 GREEN: extend `CREATE_OBJECT_RE` (`harness-checks.ts:128`) to `PROCEDURE|PROC|FUNCTION|TABLE|VIEW|TRIGGER|INDEX`.

### Phase A3: deriveCoverageTargets plan cases (spec Req 5)

- [x] A3.1 RED: in `harness-checks.test.ts`, assert `deriveCoverageTargets` returns `{kind:'any'}` NAME-only
  targets for `plan-callers` (`callers[]`), `plan-blindspots` (`blind_spots[]`), and `plan-order` (the FULL
  scoped object set of `precede` pairs) — covers Req 5 scenario "Targets derived per family by pinned rule".
- [x] A3.2 GREEN: add the three plan cases to `deriveCoverageTargets` (`harness-checks.ts:73-115`).

### Phase A4: Scorer — 3 families + comparators (spec Req 2)

- [x] A4.1 RED: in `test/benchmark/scorer.test.ts`, FULL `comparePlanOrder` unit matrix with committed
  `test/benchmark/fixtures/plan-order.json` — valid order A (Req2 "topo positive A"), distinct valid order B
  (same verdict, "topo positive B"), pair violation ("topo negative — violation"), missing scoped object
  ("missing"), extra out-of-scope object AND duplicate ("extra"), empty answer (reject), quoted/normalized
  qnames, no-constraint pairs (any order accepted). `.toStrictEqual`.
- [x] A4.2 RED: assert `plan-callers` / `plan-blindspots` score via the EXISTING unordered set-match rule
  against `fixtures/plan-callers.json` / `fixtures/plan-blindspots.json` (Req2 closed-form set-match scenario).
- [x] A4.3 GREEN: implement pure `comparePlanOrder(answerParsed, gt)` in `scorer/families.ts` — correct IFF
  answer is a PERMUTATION of `scope` (each once, no extra, no dup) AND every `[u,v]` has `index(u)<index(v)`;
  reuse `splitList`+`normalizeQname` but PRESERVE order.
- [x] A4.4 GREEN: register 3 families in `scorer/index.ts` — `Family` (:13), `FAMILIES` (:22),
  `GroundTruthByFamily` (:50) shapes, `scoreAnswer` switch (:150); wire set-match for callers/blindspots and
  `comparePlanOrder` for order. Confirms Req2 "Scorer unit tests pass inside npm test".

### Phase A5: Hand-planted keys + DDL audit (r1, spec Req 1)

- [x] A5.1 Plant keys: GREP the WHOLE `test/fixtures/mssql/torture.sql` (r1) for the COMPLETE caller set of
  `usp_log_change` (question = "a required parameter must be added to usp_log_change — which routines call
  it?"; expected `{usp_refresh_totals}` at the EXEC region :253-265, but every call site by DDL audit, not
  assumption); every `sp_executesql` site (blind-spots, e.g. `sp_dynamic_search`→`orders` :199-210); and all
  FK/calls precedence pairs (`order_items→orders/products→regions` :53-79, `fn_net_amount→fn_round_money`
  :225-239, `usp_refresh_totals→usp_log_change` :263).
- [x] A5.2 Create `benchmark/planning-keys/plan-callers-<qid>.json`, `plan-blindspots-<qid>.json`,
  `plan-order-<qid>.json` — GT shape + top-level `source_ddl_ref` string + per-target `source_ddl_refs` map
  (one entry per scope/pair member). NEVER derived from `affected`/`getImpact` (Req1 "never store-derived").
- [x] A5.3 RED: grep-audit check (positive) — each planted target's fact IS PRESENT at its cited
  `source_ddl_ref` span in `torture.sql` (Req1 "planted key auditable against cited DDL", v2 positive).
- [x] A5.4 RED: grep-audit NEGATIVE — a key whose `source_ddl_ref` lacks the fact FAILS LOUDLY naming
  qid+target (Req1 "source_ddl_ref lacks the fact FAILS audit", v2 negative). GREEN: implement audit assertion.

### Phase A6: Batch A gate + commit (HARD STOP)

- [x] A6.1 HARD STOP: sqlite `questions.yaml`, `ground-truth/*.json`, `packets/*`+`manifest.json` BYTE-IDENTICAL;
  runs 1–3 raw/scored BYTE-IDENTICAL (regression assert, Req4 "Frozen SQLite runs byte-identical" HARD guard).
- [x] A6.2 Gate: `tsc` clean; lint 0/0; `npm test` green (floor 3669 + new tests). Fix RED→GREEN only.
- [x] A6.3 ONE conventional commit for Batch A (hooks active); NO push.

## Batch B — Substrate dimension + mssql dump + Docker-gated proof

### Phase B1: --substrate threading, default byte-identical (D4)

- [x] B1.1 RED: assert `generate`/`build-packets` accept `--substrate` (default `sqlite-torture`) and that
  ABSENT/default output is byte-identical to current; `render` `--substrate` prepends a caption, ABSENT ⇒
  byte-identical (Req4 label threading).
- [x] B1.2 GREEN: add `--substrate` to `generate.ts`, `build-packets.ts` (additive `substrate` manifest field),
  `render.ts` (optional caption). `score.ts` UNTOUCHED (family-generic).
- [x] B1.3 GREEN: substrate-aware N-bound in `assertNInBounds` (`generate.ts:431`) — sqlite lower bound 5,
  mssql-plan lower bound 3; default 5 preserved; anti-cherry-pick: every committed question runs (r3, Req1
  "N is fixed and pre-registered", ships N=3).

### Phase B2: read-key path in generate (D2)

- [x] B2.1 RED: under `--substrate mssql-torture`, `generate` READS `benchmark/planning-keys/<qid>.json`,
  opens NO store, builds a `QuestionRecord` with the SCOPE block (marked per r2) where applicable, and never
  calls `affected`/`getImpact` (Req1 "plan-* keys are never store-derived").
- [x] B2.2 GREEN: implement the read-key branch; leak guard uses A1 `excludeScopeBlock` so the scope block is
  fair input; `answerTokens` are composed answer forms only (D2a). plan-callers (no scope block) uses the
  standard guard unchanged.
- [x] B2.3 RED: L-009 leak guard — key embedded in a larger identifier is NOT a leak (Req1 "embedded inside a
  larger identifier is NOT a leak"); a FREE-STANDING answer token still ABORTS naming qid (Req1 "real
  standalone answer occurrence still aborts", L-009 negative).

### Phase B3: mssql stripped-DDL dump (D5)

- [x] B3.1 RED: assert the mssql WITHOUT dump = deterministic comment/header/`GO`-stripped `torture.sql` that
  KEEPS every CREATE incl. full SP bodies verbatim; token cost measured via `scorer/tokens.ts`.
- [x] B3.2 GREEN: implement the stripped-dump path in `build-packets.ts` under `--substrate mssql-torture`.
- [x] B3.3 RED: coverage over the live/stripped dump — every plan-* routine/object found by NAME (Req5
  "Correct Docker dump covers every plan-* target", v2 positive); a target ABSENT from a wrong-DB dump aborts
  exit 1 naming object+qid (Req5 v2 L-009 negative); failure output leaks NO composed key value (Req5).

### Phase B4: Docker-gated live pipeline proof (D5, spec Req 3)

- [x] B4.1 Create `test/benchmark/mssql-substrate.test.ts` with `describe.skipIf(!DBGRAPH_INTEGRATION)` reusing
  `test/fixtures/mssql/container.ts`: spin mssql → apply `torture.sql` → index with dbgraph (WITH graph) →
  `build-packets --substrate mssql-torture` → ASSERT the WITHOUT dump embeds SP bodies AND plan-* coverage
  passes on the live substrate (Req3 "Docker tier is rebuildable", v2 positive).
- [x] B4.2 Verify honest SKIP: with Docker absent the suite SKIPS, never fabricates numbers (Req3 "Docker
  unavailable — the v2 run SKIPS honestly", v2 negative).

### Phase B5: Batch B gate + commit (HARD STOP)

- [x] B5.1 HARD STOP: default (no `--substrate`) `generate`/`build-packets`/`render` output BYTE-IDENTICAL to
  pre-change; every new branch activates ONLY under `--substrate mssql-torture` (D6).
- [x] B5.2 HARD STOP: `docs/benchmarks.md` UNTOUCHED (the v2 RUN + limitations enumeration are a later phase);
  no v2 question set generated/committed as a run.
- [x] B5.3 Gate: `tsc` clean; lint 0/0; `npm test` green (floor 3669 + all new). ONE conventional commit for
  Batch B (hooks active); NO push.

## Definition of Done

- [x] r1 honored: keys planted by whole-fixture GREP with `source_ddl_ref`/`source_ddl_refs`; plan-callers
  question pins the CALLEE `usp_log_change`; complete caller set by DDL audit.
- [x] r2 honored: ONE shared `excludeScopeBlock` helper called by both leak/pair guards; markers pinned.
- [x] r3 honored: N-bound 3–10 for planning substrate; anti-cherry-pick (all questions run); ships N=3.
- [x] r4 honored: `CREATE_OBJECT_RE` extended with `PROCEDURE|PROC|FUNCTION`; regression test mandatory & green.
- [x] Machine-provable scenarios of all 6 MODIFIED requirements covered by tests (Req1 audit ±/N/leak ±/
  never-store-derived; Req2 topo A/B/violation/missing/extra + set-match + npm-test; Req3 Docker ±; Req4
  frozen-byte-identical + additive-families; Req5 coverage ± + per-family table + composed-value redaction).
- [ ] DEFERRED to the labeled-run phase (docs untouched now): Req4 "v2 lands as its own substrate-labeled
  table" and ALL Req6 docs/limitations scenarios — machinery + pre-registered keys are ready; the RUN,
  `docs/benchmarks.md` table, and the five v2 limitations land post-archive.
- [x] Both batches: tsc clean, lint 0/0, npm test green (floor 3669 + new), one conventional commit each,
  hooks active, NO push.
