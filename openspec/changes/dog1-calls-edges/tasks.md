# Tasks: DOG-1 — `calls` Edges (routine → routine invocation)

Standing header (every task): **STRICT TDD** — the failing `vitest` test PRECEDES the code (RED→GREEN→refactor);
**L-009 EXACT-set** assertions ALWAYS (`.toStrictEqual`/`.toContainEqual` the FULL `src+dst+kind+confidence` edge,
PLUS explicit `not.toContainEqual` NEGATIVES) — existence-only `.toBeDefined()`/`find()` is FORBIDDEN (this subsystem's
own lesson: phantom edges hide behind existence-only asserts). HEXAGONAL (ADR-004): per-engine adapters reuse
`engines/_shared/tokenizer-core.ts` (`maskDynamicStrings`+`bodyContainsRef`+`classifyAccess`); the routine branch lives
in `src/core/normalize/reference-resolver.ts`; `referenced_id` NEVER crosses into `core` (engine-specific). NO new npm
dependency (ADR-007 — no call grammar). DETERMINISM (ADR-008): candidate list name-sorted, extract-twice byte-identical.
Bodies are ALREADY in `RawObject.body` at `DEFAULT_LEVELS` — the ONLY new query cost is the mssql `sys.objects` self-join;
NO store/query/port CONTRACT change (`edges.kind`/`edges.confidence` are unconstrained `TEXT` — VERIFIED, no migration).
Target DB stays strictly READ-ONLY (ADR-004 boundary). Strict TS (NO `any`, `exactOptionalPropertyTypes`); ENGLISH;
conventional commits referencing `dog1-calls-edges`, NO AI attribution, **NO push / PR / gh / tags** — local commits only.
Leak-scan/denylist hooks active — scan before EVERY commit; NEUTRAL fixture names only (`usp_refresh_totals`,
`usp_log_change`, `fn_net_amount`, `fn_round_money`, `order_totals`, `audit_log`, `fn_wrapper`, `fn_inner`,
`proc_orchestrate`, `proc_step`) — no validation-database codename.

**GOLDEN DISCIPLINE is the sharp edge (D5/D6).** The new `calls` edges (+ the mssql phantom-stub removal) DRIFT
per-engine graph goldens. Re-bless is ONE DELIBERATE commit PER BATCH with a per-golden INVENTORY in the message body —
NEVER a per-file drip re-bless. The exact edge SETS are pinned by PROGRAMMATIC L-009 tests FIRST; the goldens are
re-blessed to match SECOND. **Baseline is RE-MEASURED, not trusted:** the apply agent runs `npm test` and RECORDS the
actual green count BEFORE Batch A (graph-viz noted ~3253 on this `post-v1` branch — do NOT hard-code a stale number);
every gate = that measured baseline + the batch's NEW suites. **Cross-engine byte-identity is a HARD STOP at every gate:**
a non-target engine golden that moves means the shared seam leaked — investigate, NEVER re-bless. **SQLite goldens MUST
stay byte-identical THROUGHOUT** — SQLite has no routines, so it emits ZERO `calls` and the shared normalize branch must
fabricate nothing for it.

## RESOLVED design decisions — apply MUST NOT re-litigate (design.md §Architecture Decisions D1–D6, §Spec Coherence, §Open Questions)

- **D1 (no model addition):** REUSE existing types — `'declared'`/`'parsed'` already exist on `EdgeConfidence` /
  `RawDependency.confidence`; `RawDependency.target.kind?: NodeKind` already optional. ONLY `edge.ts` gains `calls`;
  `catalog.ts` gets a DOC comment (kind is now load-bearing). `buildDependencyEdges` passes `dep.confidence` through
  UNCHANGED. REJECTED: a `'called'` confidence tier or a parallel `calls[]` field. No CHECK constraint blocks the new
  kind string — VERIFIED (`storage/sqlite/schema.ts:45-53`, `TEXT NOT NULL`).
- **D2 (mssql catalog JOIN + plumbing):** `SQL_MSSQL_DEPENDENCIES` gains `LEFT JOIN sys.objects ref ON ref.object_id =
  dep.referenced_id` → `ref.type AS ref_object_type`; `DepRow`+`coerceDepRow` gain `ref_object_type: string | null`
  (`optionalString`); `map.ts` maps via the EXISTING `moduleTypeToKind` and passes it to `tokenizeModuleDeps`, which sets
  `target.kind`+`confidence:'declared'` ONLY when the mapped kind ∈ {`procedure`,`function`} AND the referencing module is
  itself a routine; else UNCHANGED (`parsed`, no kind). `LEFT JOIN` keeps NULL-`referenced_id` (cross-db) rows — already
  skipped by the null-name guard. `ref.type` is `CHAR(2)` → a plain JSON string under FOR JSON PATH (NOT `sql_variant`) →
  NO coercion, F-1..F-7 scalar-shape lessons satisfied; `moduleTypeToKind` already `.trim()`s the padding. REJECTED: a
  second query; carrying `referenced_id` into `core`.
- **D3 (per-engine call detection, honest):** mssql = catalog `declared`; pg/mysql = body presence-gate `parsed`
  (`bodyContainsRef` over `maskDynamicStrings`); sqlite/mongodb = N/A (no routine objects — capability declared absent,
  not fabricated). Candidate expansion is confined to `buildRoutines` (routine bodies) — NOT view bodies — so a view→fn
  reference stays `depends_on`. False-positive register (documented, not hidden): mssql `sp_executesql`/variable-`EXEC`
  never enters `sys.sql_expression_dependencies` → correctly NO `calls`; `--`/`/* */` comments are NOT masked (pre-existing
  limitation shared with `reads_from`), mitigated by resolving against REAL routine nodes only. REJECTED: a call grammar
  (ADR-007); a builtin allow-list (`count()` resolves to no routine node → already dropped).
- **D4 (explicit self-exclusion — corrects a prior lesson):** pg/mysql `buildRoutines` EXPLICITLY self-excludes routine
  candidates (`schema===row.schema_name && name===row.routine_name`). The sqlite-view-deps "presence-gate guarantees
  self-exclusion" lesson is FALSE for pg — `pg_get_functiondef` emits the full `CREATE FUNCTION app.fn_x(...)` HEADER, so a
  body contains its OWN qname → without the filter a routine `calls` itself. mysql `ROUTINE_DEFINITION` is body-only but the
  filter is applied UNIFORMLY for determinism. mssql self-calls do not appear in the dependency catalog.
- **D5 (normalize routine-target resolution, no stub):** `resolveRoutineTarget(schema,name,nodeMap,referencedById)` probes
  `nodeMap` for a REAL node across `['procedure','function']` (cross-kind, mirroring `resolveTriggerTarget`); returns the
  node or `null`. `buildDependencyEdges`: `isRoutineKind(dep.target.kind)` → resolve; `null` → **SKIP (no edge, no stub)**;
  else `edgeId('calls',src,dst,'')` @ `dep.confidence`, `attrs:{}`. Non-routine targets keep the existing branch
  (`targetKind ?? 'table'`) byte-for-byte. REJECTED: `resolveOrStub('procedure', …)` (would MINT a phantom `missing`
  routine — the exact bug class DOG-1 kills). A NON-routine `target.kind` (e.g. `view`) is deliberately NOT attached in the
  mssql adapter, so proc→view keeps `reads_from`/`depends_on` with ZERO drift.
- **D6 (impact traversal + golden blast-radius):** `IMPACT_EDGE_KINDS += 'calls'` as a READ-impact kind (NOT in
  `WRITE_KINDS`) → `getImpact` + `runPrecheck.whatToTest` reach callers through inbound `calls`. REJECTED: making `calls`
  write-impact (a call is not a mutation; write-sets would over-report). Blast radius is confined to routine-bearing graphs;
  the default-CI mcp/present golden substrate is SQLite (NO routines) → ZERO `calls` drift there — the mssql calls-impact /
  render pins therefore run at TWO tiers (§below), not over the sqlite mcp goldens.
- **§Spec Coherence rulings:** `schema-extraction` & `benchmark` carry NO delta (`target.kind` SHAPE unchanged; benchmark
  family is INSTANTIABLE but the labeled re-run is DEFERRED). `cli-config` NO delta (sqlite CLI goldens are routine-free).
  `graph-query` is the CANONICAL home of the `IMPACT_EDGE_KINDS` semantics; `mcp-server` CONSUMES it — pinned
  BYTE-CONSISTENT: altering `dbo.usp_log_change` yields the EXACT `{dbo.usp_refresh_totals}` in BOTH.

Design Open Questions RESOLVED as task decisions (audit during apply, do not defer silently):
- **EDGE_KINDS tuple slot** — insert `calls` AFTER `depends_on` (reads naturally). A.1 VERIFIES no test byte-pins the tuple
  BEFORE the edit; C.5 re-confirms.
- **Fixture call forms (no `hasDynamicSql` trip)** — mssql two-part `EXEC dbo.usp_log_change` + `SELECT dbo.fn_round_money(@x)`
  (resolve in `sys.sql_expression_dependencies`); pg `SELECT app.fn_inner()` (function→function, no dynamic `EXECUTE`); mysql
  `CALL app.proc_step()`. The dynamic-`EXECUTE`/`PREPARE` and builtin NEGATIVES (S20/S21/S25) are UNIT tests over SYNTHETIC
  bodies — NO new fixture object (fixtures add the POSITIVE routine pairs only).
- **Present-brief edge-count goldens** — C.5 classifies torture-graph-derived (drift) vs synthetic `PresentView` (no drift);
  the sqlite-derived mcp/present goldens carry no routines → ZERO drift expected.
- **proc→view kind-preservation** — OUT OF SCOPE (attach routine kinds ONLY). C.5 CONFIRMS no mssql torture proc references a
  VIEW today (else unexpected drift when gating). Noted for a future change.

**Two-tier vehicle for the mssql `calls`/impact pins (design §Testing, RESOLVED Q2 = BOTH):** (1) DEFAULT-CI tier — the
recorded FOR-JSON row fixtures (`test/fixtures/mssql/rows/{dependencies,modules}.json`), the committed
`golden-raw-catalog.json`/`golden-e2e.json`, AND a SYNTHETIC in-memory `RawCatalog` normalized offline — all run in plain
`npm test`, no containers. (2) INTEGRATION tier — the SAME assertions ADDED to the `DBGRAPH_INTEGRATION`-gated
`test/cli/mssql.e2e.integration.test.ts` (Testcontainers materializes `torture.sql`), proving the catalog path end-to-end.

## Batch A: Shared seam + mssql catalog-`declared` `calls` + the regression-stub golden

> Realizes D1/D2/D3/D5. Lands the ONCE-written normalize branch every DOG child reuses, the mssql catalog plumbing, the
> mssql routine fixtures, and the single deliberate mssql structural re-bless (the phantom `[table]` stub GONE). Blast
> radius is mssql-only — pg/mysql/sqlite goldens MUST stay byte-identical.

- [x] A.1 **(vitest)** AUDIT then RED→GREEN `test/core/model/edge.test.ts` + `src/core/model/edge.ts`: FIRST grep/confirm NO
  test byte-pins the `EDGE_KINDS` tuple ORDER (record the audit); then add `calls` to the `EdgeKind` union + `EDGE_KINDS`
  tuple AFTER `depends_on`; doc-comment `RawDependency.target.kind` load-bearing in `src/core/model/catalog.ts`. Assert
  `calls ∈ EDGE_KINDS`; a `calls` edge carries `confidence ∈ {declared,parsed}`, NEVER `inferred`, and NO `score`. Spec:
  graph-model "calls edge connects two routine nodes" (S1). D1.
- [x] A.2 **(vitest)** RED→GREEN `test/core/normalize/routine-target.test.ts` (new) + `src/core/normalize/reference-resolver.ts`:
  add `resolveRoutineTarget` (probe `['procedure','function']`, real node or `null`, NO stub) + `buildDependencyEdges`
  routine branch (`edgeId('calls',src,dst,'')` @ `dep.confidence`; unresolved → skip). RED over synthetic `RawCatalog`s:
  proc→proc = EXACTLY one `calls`, ZERO `reads_from`/`writes_to`, ZERO `[table]` stub (S6); unresolved routine (builtin
  `count`) = ZERO edge + ZERO stub (S7); table-only routine = read/write unchanged `parsed`, ZERO `calls` (S8); genuine
  self-recursion = one self-`calls`, non-recursive = none (S9). Deterministic ordering (ADR-008). Spec: graph-normalization
  (all 4). D5.
- [x] A.3 **(vitest)** RED→GREEN `test/adapters/engines/sqlite/calls-absence.test.ts` (new) — pin SQLite ABSENCE over the
  EXISTING sqlite torture graph (the shared A.2 branch must fabricate nothing): ZERO edges of kind `calls`; `CapabilityMatrix`
  still reports procedures+functions UNSUPPORTED; a trigger body naming a function-like token (`some_udf(x)`) invents NO
  `calls` edge and NO routine stub. Spec: graph-model "SQLite emits no calls edge" (S5); sqlite-extraction (S27, S28). D3.
- [x] A.4 **(vitest)** RED→GREEN `test/adapters/engines/mssql/*` + `src/adapters/engines/mssql/queries.ts` +
  `strategies/json-rows.ts`: `SQL_MSSQL_DEPENDENCIES` LEFT JOIN `sys.objects ref` → `ref.type AS ref_object_type`; `DepRow`
  + `coerceDepRow` gain `ref_object_type: string | null` (`optionalString`). RED over recorded FOR-JSON rows: coerce yields
  the trimmed `CHAR(2)` or `null`; a NULL-`referenced_id` row survives the LEFT JOIN and is skipped by the null-name guard.
  Spec: mssql-extraction "Catalog-declared calls edges" (plumbing half). D2.
- [x] A.5 **(vitest)** RED→GREEN `test/adapters/engines/mssql/*` + `src/adapters/engines/mssql/map.ts` + `tokenizer.ts`:
  `map.ts` maps `ref_object_type` via `moduleTypeToKind` (routine-gated: mapped kind ∈ {procedure,function} AND the
  referencing module is a routine) → `tokenizeModuleDeps`; `DepRef` gains `ref_object_type`, sets `target.kind` +
  `confidence:'declared'` for routine targets. RED over recorded DepRow fixtures: routine ref → `target.kind` + `declared`;
  table/view ref → UNCHANGED `parsed`, no kind; `sp_executesql`/variable-`EXEC` absent from catalog → NO `calls`. Spec:
  mssql-extraction "Catalog-declared calls edges" + negative (S15/S16/S17 unit half). D2/D3.
- [x] A.6 **(vitest, fixtures)** Add NEUTRAL routine objects to `test/fixtures/mssql/torture.sql` — `dbo.usp_refresh_totals`
  (`UPDATE dbo.order_totals` + `EXEC dbo.usp_log_change`), `dbo.usp_log_change` (`INSERT dbo.audit_log`), `dbo.fn_net_amount`
  (returns `dbo.fn_round_money(@x)`), `dbo.fn_round_money`, tables `dbo.order_totals`/`dbo.audit_log` — then RE-RECORD
  `test/fixtures/mssql/rows/dependencies.json` (add `ref_object_type` + the new dep rows) and `rows/modules.json` (new
  bodies) from the materialized fixture. Leak-scan neutral. Spec: mssql-extraction "mssql torture fixture exercises
  routine-calls-routine". D2/D3, §Open-Q fixture form.
- [x] A.7 **(vitest)** RED→GREEN `test/adapters/engines/mssql/calls-normalize.test.ts` (new) — SYNTHETIC in-memory
  `RawCatalog` (default CI, no container): `dbo.usp_refresh_totals` EXEC `dbo.usp_log_change` → normalize → L-009 exact-set:
  `dbo.usp_refresh_totals` = EXACTLY `{calls dbo.usp_log_change (declared), writes_to dbo.order_totals (parsed)}`;
  `dbo.usp_log_change` = `{writes_to dbo.audit_log (parsed)}`, ZERO `calls`; ZERO `[table] usp_log_change` stub; fn→fn =
  one `calls dbo.fn_round_money (declared)`. Spec: mssql-extraction (S15/S16/S17), graph-model "mssql calls is declared"
  (S4 declared side). §Testing.
- [x] A.8 **(golden — DELIBERATE re-bless, batch-scoped)** Re-bless `test/fixtures/mssql/golden/golden-raw-catalog.json`
  (routines gain `dependencies` w/ routine kind) + `golden-e2e.json` (+2 `calls` edges; **−1 phantom `[table]
  usp_log_change` stub** → `stubCount` −1) to match the pinned graph; every byte traces to a `calls` edge or the stub
  removal; byte-identical on re-run (ADR-008). Commit body = per-golden inventory. Spec: mssql-extraction "fixture … goldens
  pin the calls edges" (S18). D5.
- [x] A.9 **(integration-gated)** Add the SAME A.7 L-009 exact-set + zero-stub assertions to
  `test/cli/mssql.e2e.integration.test.ts` (`DBGRAPH_INTEGRATION`-gated Testcontainers over `torture.sql`) — proves the
  catalog path end-to-end; runs only under the gate. Spec: mssql-extraction (S18, integration tier). §Testing.
- [x] A.10 GATE (Batch A): RE-MEASURE baseline FIRST; `npx tsc --noEmit` clean (no `any`); `npm run lint` 0/0; `npm test`
  GREEN (baseline + A suites) with `golden-e2e`/`golden-raw-catalog` byte-identical on re-run; **pg/mysql/sqlite goldens
  byte-identical (HARD STOP on drift)**; leak-scan clean. COMMIT `feat(mssql): catalog-declared calls edges via ref_object_type seam + regression-stub golden`.

## Batch B: pg + mysql body-`parsed` `calls` (self-excluded) + fixtures + per-engine re-bless

> Realizes D3/D4. Extends `buildRoutines` candidate lists with routines (self-excluded), adds neutral routine pairs, pins
> the `parsed` L-009 sets. pg/* and mysql/* files are INDEPENDENT → parallel-safe WITHIN the batch. mssql/sqlite goldens
> MUST stay byte-identical.

- [x] B.1 **(vitest)** RED→GREEN `test/adapters/engines/pg/*` + `src/adapters/engines/pg/tokenizer.ts` + `map.ts`: `DepRef`
  gains optional `kind:'procedure'|'function'` carried to `target.kind`; `buildRoutines` candidate list += ROUTINE nodes
  (with kind), EXPLICITLY self-excluded (D4 — `pg_get_functiondef` header self-ref). RED: builtin-only body
  (`now()`,`count()`) → ZERO `calls` (S20); routine name only in a masked dynamic `EXECUTE` string → `hasDynamicSql:true`,
  ZERO `calls` (S21); self-header → NO self-`calls`; routines only ADD candidates — existing table deps UNCHANGED. Spec:
  pg-extraction "Body-parsed calls edges" + negatives. D3/D4.
- [x] B.2 **(vitest)** RED→GREEN `test/adapters/engines/mysql/*` + `src/adapters/engines/mysql/tokenizer.ts` + `map.ts`:
  same seam as pg — candidate list += routines (kind), self-excluded UNIFORMLY (determinism), presence-gate over masked
  `ROUTINE_DEFINITION`. RED: table-only proc → ZERO `calls` (S24); `CALL` name only in a masked `PREPARE`/`EXECUTE` string →
  `hasDynamicSql:true`, ZERO `calls` (S25); NO self-edge; table deps UNCHANGED. Spec: mysql-extraction "Body-parsed calls
  edges … no phantom or self edges". D3/D4.
- [x] B.3 **(vitest, fixtures)** Add NEUTRAL routine pairs: pg `app.fn_wrapper` (`SELECT app.fn_inner()`) + `app.fn_inner`
  (`SELECT … FROM app.orders`) to `test/fixtures/pg/torture.sql`; mysql `app.proc_orchestrate` (`CALL app.proc_step()`) +
  `app.proc_step` (`INSERT app.audit_log`) to `test/fixtures/mysql/torture.sql`; re-record any offline row fixtures.
  Fixture-form: pg `SELECT fn()` + mysql `CALL proc()` (no dynamic `EXECUTE` → no `hasDynamicSql`). Leak-scan neutral. Spec:
  pg/mysql "torture fixture exercises routine-calls-routine". §Open-Q fixture form.
- [x] B.4 **(vitest)** RED→GREEN `test/adapters/engines/{pg,mysql}/calls-edges.test.ts` (new) — L-009 exact-set over the
  BUILT torture graphs: pg `app.fn_wrapper` = EXACTLY one `calls app.fn_inner (parsed)`, NO read/write to `fn_inner`;
  `app.fn_inner` = `{reads_from app.orders (parsed)}`, ZERO `calls`; `stubCount:0`; no self-edge (S19/S22). mysql
  `app.proc_orchestrate` = EXACTLY one `calls app.proc_step (parsed)`; `app.proc_step` = `{writes_to app.audit_log
  (parsed)}`, ZERO `calls`; `stubCount:0`; no self-edge (S23/S26). Extract twice → byte-identical (ADR-008). Spec:
  pg (S19), mysql (S23), graph-model "pg/mysql calls is parsed" (S4 parsed side). §Testing.
- [x] B.5 **(golden — DELIBERATE re-bless, batch-scoped)** Re-bless pg `golden-raw-catalog.json`/`golden-e2e.json`
  (+`calls app.fn_wrapper→app.fn_inner`, `stubCount:0`) and mysql goldens (+`calls app.proc_orchestrate→app.proc_step`,
  `stubCount:0`); every byte traces to a `calls` edge; byte-identical on re-run. mssql+sqlite goldens byte-identical (HARD
  STOP). Commit body = per-golden inventory. Spec: pg (S22), mysql (S26). D5.
- [x] B.6 **(integration-gated)** Add the B.4 pg + mysql L-009 assertions to the `DBGRAPH_INTEGRATION`-gated pg/mysql e2e
  suites over the real containers. Spec: pg/mysql fixture scenarios, integration tier.
- [x] B.7 GATE (Batch B): RE-MEASURE baseline; `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN (baseline +
  A+B suites) with pg/mysql goldens byte-identical on re-run; **mssql + sqlite goldens byte-identical (HARD STOP)**;
  leak-scan clean. COMMIT `feat(pg,mysql): body-parsed calls edges via self-excluded routine candidate list`.

## Batch C: `IMPACT_EDGE_KINDS += calls` traversal + render + final audit/re-bless + DoD

> Realizes D6 + §Spec Coherence. Makes `impact`/`affected`/`precheck` reach callers through `calls`, renders the `calls`
> neighbor section, then does the FINAL audit + minimal deliberate re-bless (default-CI mcp/present substrate is SQLite →
> ZERO `calls` drift). Ends in the consolidated gate + DoD handoff to `sdd-verify`.

- [ ] C.1 **(vitest)** RED→GREEN `test/core/query/impact-calls.test.ts` (new) + `src/core/query/impact.ts`:
  `IMPACT_EDGE_KINDS += 'calls'` (READ-impact, NOT in `WRITE_KINDS`). Synthetic in-memory mssql chain (`calls
  dbo.usp_refresh_totals → dbo.usp_log_change`) → `getImpact(dbo.usp_log_change)` READ impact EXACTLY
  `{dbo.usp_refresh_totals}` via the inbound `calls`; `dbo.usp_refresh_totals` in NO write-impact set; byte-identical on
  re-run. RED regressions GREEN: read/write separation, depth-truncation warning, cyclic visited-set, dynamic-SQL warning
  (S10–S13). Spec: graph-query "Depth-limited impact closure" (S14 + 4 regressions). D6.
- [ ] C.2 **(vitest)** RED→GREEN `test/mcp/precheck.test.ts` (extend): synthetic mssql chain, `dbgraph_precheck({ ddl: ALTER
  dbo.usp_log_change })` → `whatToTest` EXACTLY `{dbo.usp_refresh_totals}` in the READ/what-to-test section (`calls` =
  read-impact, `confidence` preserved) — BYTE-CONSISTENT with C.1 (§Spec Coherence). Regressions GREEN: ALTER+DROP INDEX
  golden (S29), non-matchable unmatched (S30), SQLite column-drop dependents (S31). Spec: mcp-server "dbgraph_precheck
  aggregates DDL impact" (S29–S32). D6.
- [ ] C.3 **(vitest / golden)** RED→GREEN `test/core/present/*` + `test/mcp/*`: over a SYNTHETIC `PresentView` (normalized
  graph with the mssql routine chain) the shared formatter (`present/explore.ts`,`related.ts`,`object.ts` iterate
  `Object.keys(neighbors).sort()`) renders an OUTBOUND `calls` neighbor on `dbo.usp_refresh_totals` + the INBOUND `calls` on
  `dbo.usp_log_change`; `dbgraph_related({ kinds:['calls'] })` returns ONLY the `calls` neighbor annotated with direction; a
  routine with no invocations → EMPTY `calls` group, never fabricated. Add the synthetic present golden DELIBERATELY + a
  matching `docs/format-spec.md` note; CLI + MCP byte-identical (shared formatter). Spec: mcp-server "explore and related
  surface calls neighbors" (S33, S34). D6/§Present.
- [ ] C.4 **(integration-gated)** Add the C.1/C.2/C.3 impact-through-calls + `whatToTest` + explore/related `calls`
  assertions to `test/cli/mssql.e2e.integration.test.ts` (`DBGRAPH_INTEGRATION`-gated) over the container — end-to-end
  traversal + render. Spec: mcp-server (S32/S33/S34, integration tier).
- [ ] C.5 **(audit — resolves Open Questions)** BEFORE regenerating: (a) re-CONFIRM no test byte-pins the `EDGE_KINDS` tuple
  (beyond A.1); (b) CLASSIFY present brief/summary edge-count goldens — torture-graph-derived (drift) vs synthetic
  `PresentView` (no drift); the SQLite-derived mcp/present goldens carry NO routines → ZERO `calls` drift EXPECTED; enumerate
  ANY mssql/pg/mysql-derived impact/explore golden that genuinely gains a `calls` section; (c) CONFIRM no mssql torture proc
  references a VIEW today (else proc→view drift — kind-preservation is OUT OF SCOPE, note for a future change). RECORD the
  exact drift inventory for the C.6 commit body. §Open Questions.
- [ ] C.6 **(golden — DELIBERATE re-bless, batch-scoped)** Re-bless ONLY the goldens enumerated in C.5 that genuinely gain a
  `calls` traversal/section (expected minimal: the C.3 synthetic present golden + any routine-bearing impact golden);
  SQLite-derived goldens MUST be byte-identical (HARD STOP if they move); byte-identical on re-run; per-golden inventory in
  the commit body. D5/D6.
- [ ] C.7 GATE (Batch C — FINAL): RE-MEASURE baseline; `npx tsc --noEmit` strict clean (no `any`); `npm run lint` 0/0;
  `npm test` FULL GREEN (baseline + ALL A/B/C suites) with EVERY golden byte-identical on re-run; **sqlite goldens
  byte-identical (no routines → no `calls`)**; ADR-004 read-only boundary + ADR-008 determinism green; leak-scan clean;
  confirm NOTHING pushed (no push/PR/gh/tag). Trace the DoD below. COMMIT `feat(query,mcp): traverse calls as read-impact and render calls neighbors`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch A** (A.1–A.10): SHARED SEAM + MSSQL — `edge.ts`/`catalog.ts` model, `reference-resolver.ts` `resolveRoutineTarget`
  + routine branch, sqlite absence guard, mssql `queries.ts`/`json-rows.ts`/`map.ts`/`tokenizer.ts` catalog plumbing, mssql
  torture + recorded rows, synthetic + integration-gated pins, the mssql structural re-bless (stub removed).
- **Batch B** (B.1–B.7): PG + MYSQL — `{pg,mysql}/tokenizer.ts`+`map.ts` self-excluded routine candidates, neutral fixture
  pairs, `parsed` L-009 sets, per-engine structural re-bless. pg/* and mysql/* are independent.
- **Batch C** (C.1–C.7): TRAVERSAL + RENDER + FINAL — `impact.ts` `IMPACT_EDGE_KINDS`, precheck/`whatToTest`,
  explore/related `calls` section, final audit + minimal re-bless, consolidated gate + DoD.

### Parallel vs sequential

- **Batches are STRICTLY SEQUENTIAL: A → B → C.** They share the normalize seam and a single per-engine golden chain; C's
  traversal/render depend on `calls` edges EXISTING (A mssql + B pg/mysql). C cannot precede B.
- **Within Batch A, A.1 (model) → A.2 (normalize seam)** are the prerequisites for everything; A.4/A.5 (mssql adapter) can
  proceed in parallel with A.2 but A.7 (synthetic) depends on A.1+A.2+A.5 and A.6 (fixture/rows); A.8 (re-bless) depends on
  A.6+A.7.
- **Within Batch B, the pg path (B.1) and mysql path (B.2) touch INDEPENDENT files → parallel-safe** (design: pg/mysql files
  independent within B). They land in ONE apply session; B.4/B.5 depend on BOTH.
- **Within Batch C, C.1 (impact) → C.2 (precheck consumes it)**; C.3 (render) is independent of C.1/C.2; C.5 (audit) precedes
  C.6 (re-bless); C.4 (integration) mirrors C.1–C.3 under the gate.

### Dependency bottlenecks

- **The normalize routine branch (A.2) is the architectural bottleneck** — every engine and every DOG child reuses
  `resolveRoutineTarget` + the `isRoutineKind` branch. It MUST land in A, correct and exact, before B/C build on it. A
  mis-resolve here reintroduces the phantom-stub bug class.
- **Golden re-bless is PER-BATCH and PER-ENGINE-STRUCTURE, never piecemeal within a batch** — A re-blesses mssql graph
  structure (calls edges + stub removal), B pg/mysql structure, C the traversal/render surface. `golden-e2e` (graph
  structure) drifts in A/B (edges) but NOT in C (traversal doesn't mutate the stored graph) → no double re-bless of the same
  golden.
- **`IMPACT_EDGE_KINDS += calls` (C.1) drifts traversal ONLY where `calls` edges exist.** The default-CI mcp/present golden
  substrate is SQLite (ZERO routines) → those goldens do NOT drift; a SQLite golden that MOVES is a HARD STOP (the branch
  fabricated a sqlite `calls`). The mssql calls-impact / render pins therefore run at the TWO tiers (synthetic default-CI +
  `DBGRAPH_INTEGRATION`-gated), not over the sqlite mcp goldens.
- **Cross-engine byte-identity is the phase-wide invariant** — A freezes pg/mysql/sqlite, B freezes mssql/sqlite, C freezes
  sqlite. Any non-target drift means the shared seam leaked: HARD STOP, investigate, do NOT re-bless.
- **L-009 exactness is load-bearing because of tokenizer over-approximation** — a routine name in a comment (unmasked,
  pre-existing) or a same-named variable could over-match; the exact-set POSITIVES + `not.toContainEqual` NEGATIVES (no
  read/write to the callee, no self-edge, no stub) are the ONLY guard — existence-only asserts would silently pass a phantom.
- **proc→view kind-preservation is OUT OF SCOPE** — C.5 confirms no mssql torture proc references a view; if one does,
  gating routine kinds would surface unexpected proc→view drift → a separate change, not this one.
- **Benchmark `call-graph` family is INSTANTIABLE but the labeled re-run is DEFERRED** (§Spec Coherence) — no `benchmark`
  spec delta, no N-change, no run recorded in this change.

## Definition of Done (tied to the proposal Success Criteria; 34 scenarios across 13 requirements / 8 deltas traced)

- [x] A proc calling a proc yields EXACTLY one `calls` edge with the engine's confidence (mssql `declared`; pg/mysql
  `parsed`) — exact `src+dst+kind+confidence` (L-009). — A (A.2, A.7), B (B.4) [graph-model S1/S4; graph-normalization S6;
  mssql S15/S16; pg S19; mysql S23]
- [x] The mssql proc→proc fixture produces NO spurious `missing` `[table]` stub (regression golden, `stubCount` −1). — A
  (A.7, A.8) [graph-normalization S6; mssql S18]
- [x] A routine touching only tables emits ZERO `calls` edges; an unresolved/builtin/dynamic-string invocation invents NO
  edge and NO stub (negatives). — A (A.2), B (B.1, B.2) [graph-normalization S7/S8/S9; mssql S17; pg S20/S21; mysql S24/S25]
- [ ] SQLite emits ZERO `calls` edges, `CapabilityMatrix` unchanged, a function-like trigger token invents nothing. — A
  (A.3) [graph-model S5; sqlite S27/S28]
- [ ] `impact`/`affected`/`precheck` traverse `calls` as READ-impact: altering `dbo.usp_log_change` yields EXACTLY
  `{dbo.usp_refresh_totals}` in BOTH the graph-query closure and mcp `whatToTest`, in NO write-impact set. — C (C.1, C.2)
  [graph-query S14; mcp S32]
- [ ] `explore`/`related` render the `calls` neighbor section (outbound + inbound) for CLI AND MCP, byte-identical; empty
  group when none. — C (C.3) [mcp S33/S34]
- [ ] Pre-existing behavior preserved: `fires_on` event, `inferred_reference` score, read/write separation, depth
  truncation, cyclic termination, dynamic-SQL warning, ALTER+DROP INDEX golden, non-matchable unmatched, SQLite column-drop
  dependents. — A/C regressions [graph-model S2/S3; graph-query S10–S13; mcp S29/S30/S31]
- [ ] Every re-blessed golden (mssql A.8, pg/mysql B.5, minimal C.6) is ONE DELIBERATE per-batch commit with a per-golden
  inventory, byte-identical on re-run; cross-engine + sqlite goldens byte-identical at every gate; the two-tier mssql pins
  (synthetic + `DBGRAPH_INTEGRATION`-gated) both assert the same sets. — A (A.8, A.9), B (B.5, B.6), C (C.4, C.6)
  [mssql S18; pg S22; mysql S26; graph-query S14 determinism]
- [ ] `npx tsc --noEmit` strict clean (no `any`); `npm run lint` 0/0; `npm test` GREEN (re-measured baseline + all new
  suites) every golden byte-identical on re-run; ADR-004 read-only + ADR-008 determinism green; leak-scan clean; nothing
  pushed. — every batch GATE (A.10, B.7, C.7)
