# Tasks: DOG-2 — Routine Parameters (`RoutinePayload.parameters`)

Standing header (every task): **STRICT TDD** — the failing `vitest` test PRECEDES the code (RED→GREEN→refactor);
**L-009 EXACT-set** assertions ALWAYS (`.toStrictEqual`/`.toContainEqual` the FULL `RawParameter`/`RoutineParameter`
shape — `name+dataType+direction+ordinal(+hasDefault)` — PLUS explicit `not.toContainEqual` NEGATIVES: no fabricated
`out`/`inout`, no fabricated `hasDefault`, no excluded return row); existence-only `.toBeDefined()`/`.length` is FORBIDDEN.
HEXAGONAL (ADR-004): types in `core/model`, mapping in `core/normalize`, rendering in `core/present`, extraction in
`adapters/engines/*`; NO adapter type leaks into `core`; `RawParameter` NEVER carries an engine cursor. Pure additive
payload — NO new node/edge kind, NO impact/traversal change, NO storage migration (`nodes.payload TEXT` is opaque JSON,
D4 — VERIFIED `storage/sqlite/schema.ts:39`). NO new npm dependency (ADR-007). DETERMINISM (ADR-008): ordinal order
EVERYWHERE (query `ORDER BY` → normalize sort → render sort); extract/derive twice → byte-identical. Target DB stays
strictly READ-ONLY (ADR-004; the engines write-verb scanner MUST stay green — catalog `SELECT` only). Strict TS (NO
`any`, `exactOptionalPropertyTypes` — `hasDefault?` is OMITTED, never `false`; `parameters?` is UNSET, never `[]` for a
no-catalog engine); ENGLISH; conventional commits referencing `dog2-routine-parameters`, NO AI attribution, **NO push /
PR / gh / tags** — local commits only. Leak-scan/denylist active — scan before EVERY commit; NEUTRAL fixture names only
(commerce/order-themed, INHERITED from DOG-1: `usp_log_change`, `usp_refresh_totals`, `fn_net_amount`, `fn_round_money`,
`fn_place_order`, `fn_wrapper`, `fn_inner`, `proc_orchestrate`, `proc_step`, `fn_audit_write`, `order_totals`,
`audit_log`) — no payroll/finance flavor, no validation-database codename.

**GOLDEN DISCIPLINE is the sharp edge (D5/§6).** The aggregate golden churn is ONE SINGLE DELIBERATE re-bless in Batch 2
(mssql/pg/mysql `golden-raw-catalog.json` + `golden-e2e.json` + `dumps/mssql-dump-golden.json` + the NEW present family) —
NEVER a per-file drip, NEVER a per-batch drip. **Batch 1 keeps EVERY aggregate golden byte-identical:** extraction is
proved via the TWO-TIER vehicle — map-unit L-009 pins over dedicated parameter row fixtures + `DBGRAPH_INTEGRATION`-gated
assertions over the real container — NEITHER of which regenerates the committed default-CI aggregate goldens; the recorded
golden-generating rows gain parameters ONLY in Batch 2, paired with the re-bless. **Baseline is RE-MEASURED, not trusted:**
apply runs `npm test` and RECORDS the actual green count BEFORE Batch 1 (expect ~3448 on `post-v1` + the sentinel-rename
commit — do NOT hard-code a stale number); every gate = that measured baseline + the batch's NEW suites. **Cross-engine
byte-identity is a HARD STOP at every gate** (freeze): sqlite + any UNTOUCHED engine golden that moves means the shared
seam leaked — investigate, NEVER re-bless. **SQLite + MCP explore/object goldens MUST stay byte-identical THROUGHOUT** —
sqlite has NO routine catalog (emits ZERO parameters) and the MCP substrate focuses a sqlite TABLE (`main.employees`).

## RESOLVED design decisions — apply MUST NOT re-litigate (design.md §5 D1–D6, §10 Spec Coherence, §9 Open Questions)

- **D1 (extraction shape — per-engine natural join):** mssql + mysql use a SEPARATE parameter query joined by object
  identity (`sys.parameters` / `information_schema.PARAMETERS` are one-row-per-parameter — mirror `SQL_MSSQL_TRIGGER_EVENTS`);
  pg EXTENDS the existing `pg_proc` `SQL_PG_ROUTINES` row (arg arrays live inline). REJECTED: a universal per-engine query
  (breaks mssql FOR-JSON determinism); JS-side OID→name resolution for pg (adds a `pg_type` round-trip, risks non-verbatim
  type strings — SQL `regtype` decode is exact and cheaper).
- **D2 (RawParameter — durable contract, pure copy):** first-class OPTIONAL `RawObject.parameters?: readonly RawParameter[]`
  (`catalog.ts`), copied verbatim into `RoutinePayload.parameters?` in `buildPayload`, ordinal-sorted. REJECTED: an untyped
  `RawObject.extra` passthrough (bypasses the compile-time contract).
- **D3 (ONE shared `renderParameters`, wired into BOTH formatters):** a single pure `renderParameters(node)` in
  `present/payload.ts`, called by `renderFocusPayload` (explore) AND `formatObject` (object), gated at non-brief on both →
  byte-identical section across CLI/MCP × explore/object. REJECTED: inline per-formatter rendering (drift); rendering only in
  `renderFocusPayload` and ASSUMING object inherits — **FALSE** (`formatObject` does NOT call `renderFocusPayload`; see §9
  understatement, task 2.3).
- **D4 (no storage migration):** `nodes.payload` is opaque `TEXT` JSON; a new `parameters` key is transparent;
  `stableStringify` keeps it deterministic. REJECTED: a typed parameters table.
- **D5 (determinism + honesty per-engine, never blurred):** raw type strings VERBATIM per engine (NO cross-engine
  normalization); `dataType` composed IDENTICALLY to the SAME engine's COLUMN `dataType` — mssql BARE `tp.name` (`int`,
  `decimal`, `nvarchar` — NOT `decimal(12,2)`); mysql FULL `DTD_IDENTIFIER` (`int`, `varchar(20)`); pg canonical `regtype`
  name, TYPMOD-LESS for arguments (`numeric`, NOT `numeric(10,2)` — pg stores no per-argument typmod; the precision is
  PHYSICALLY absent, never fabricated). `hasDefault`/`direction` emitted ONLY from a REAL catalog signal.
- **D6 (ordinal = contiguous 1..N over EMITTED params):** 1-based position among emitted parameters in catalog array/row
  order, AFTER excluding pg `t`-mode entries and the mssql (`parameter_id=0`) / mysql (`ORDINAL_POSITION=0`) return rows.
  ENCODED (design leans this way — §9 open question resolved). REJECTED: preserving raw catalog position (leaves gaps).
- **§10 Spec Coherence rulings:** `graph-normalization` carries NO delta (payload COPY, no node/edge/shape change — the
  determinism is the EXISTING ADR-008 requirement, pinned by re-blessed goldens); `benchmark` NO delta (the
  "parameter-render golden family" is a `test/golden/present` family, NOT a benchmark question set — no protocol change);
  `cli-config` NO SEPARATE delta (the section is added to the ONE shared `present/payload.ts` helper backing BOTH surfaces —
  `mcp-server` delta covers CLI `explore`/`object` + MCP `dbgraph_explore`/`dbgraph_object`).

Design §9 Open Questions RESOLVED as task decisions (audit during apply, do not defer silently):
- **pg SQL arg-type decode idiom** — use `COALESCE(proallargtypes::oid[], string_to_array(proargtypes::text,' ')::oid[])::regtype[]::text[]`
  (the `string_to_array` fallback is the safe idiom across pg versions; `proallargtypes` is NULL when only IN args exist).
  1.4 VERIFIES the exact cast against the target pg version at apply (cannot run pg here).
- **pg `proargmodes` `"char"[]` parsing** — cast to `::text[]` in SQL so node-postgres returns a parsed array (raw `"char"[]`
  risks a `{i,o}` string). Encoded in `SQL_PG_ROUTINES` (1.4).
- **pg `v`/`t` modes** — NO torture routine required; a `v` (VARIADIC→`in`) and a `t` (RETURNS TABLE→EXCLUDED) case are pinned
  by UNIT FIXTURES ONLY (1.4). Confirm the DOG-1 pg fixtures contain no `v`/`t` routine (else the aggregate golden would
  gain them — it must not).
- **object.ts wiring (proposal understatement, design §9):** `formatObject` NEEDS its OWN PARAMETERS block (2.3) — else
  `object`/MCP-object silently OMIT parameters while `explore` shows them.

## Batch 1: types + normalize copy + per-engine extraction (map-unit + integration) + sqlite honest-absence

> Realizes D1/D2/D4/D5/D6. Lands the additive types, the ordinal-sorted payload copy, and per-engine extraction proved via
> the TWO-TIER vehicle (map-unit L-009 + `DBGRAPH_INTEGRATION`-gated). NO renderer yet, NO aggregate golden touched — EVERY
> committed default-CI golden (all engines) stays byte-identical; the single deliberate re-bless is Batch 2.

- [x] 1.1 **(vitest)** RED→GREEN `test/core/model/parameters.test.ts` (new) + `src/core/model/node.ts` + `catalog.ts`: add
  `RoutineParameter` (`name:string`, `dataType:string`, `direction:'in'|'out'|'inout'`, `ordinal:number`, `hasDefault?:boolean`)
  + `RoutinePayload.parameters?: readonly RoutineParameter[]` (node.ts:96); mirror `RawParameter` + `RawObject.parameters?:
  readonly RawParameter[]` (catalog.ts:23). Assert the shape compiles under strict TS; `hasDefault` is OPTIONAL (omit ≠ false);
  `parameters` is OPTIONAL (unset ≠ `[]`); `direction` is exactly the 3-member union. Spec: graph-model "parameter view carries
  name, raw type, direction and ordinal" (GM-1), "absent … leaves the field unset" (GM-2), "hasDefault only where sourced" (GM-3). D2.
- [x] 1.2 **(vitest)** RED→GREEN `test/core/normalize/parameters.test.ts` (new) + `src/core/normalize/normalize.ts`: in the
  `procedure||function` branch of `buildPayload` (lines 268-272), copy `obj.parameters` → `base['parameters']`
  ordinal-sorted, CONDITIONALLY (emit only when present AND non-empty — mirrors `signature`/`returns`). L-009: `RawObject`
  with out-of-order params → payload `parameters` sorted ascending `ordinal`; UNSET input → payload key ABSENT; empty array →
  key ELIDED; pure copy — NO edge, NO reference resolution, NO inference (`declared`, never `inferred`; US-008 untouched);
  derive twice → byte-identical. Spec: graph-model GM-1 (ordinal order, ADR-008), GM-2. D2/D6. **NO graph-normalization delta**
  (§10 — payload copy, not a shape change).
- [x] 1.3 **(vitest + integration-gated)** RED→GREEN `test/adapters/engines/mssql/parameters.test.ts` (new) +
  `src/adapters/engines/mssql/queries.ts` + `map.ts` + `mssql-schema-adapter.ts`: add `SQL_MSSQL_PARAMETERS` over
  `sys.parameters`⋈`sys.types`⋈`sys.objects`⋈`sys.schemas` (`WHERE type IN ('P','FN','IF','TF') AND parameter_id > 0`,
  top-level `ORDER BY … parameter_id` — FOR-JSON-safe per §4.1: single top-level SELECT, no subquery wrap, all
  nvarchar/int/bit cols, NO `sql_variant`); `ParameterRow` interface + `buildModules` builds an `object_id → RawParameter[]`
  map and attaches. Map: `is_output` `1`→`out`/`0`→`in` (NEVER `inout` — sys.parameters has no INOUT concept); `dataType` =
  BARE `tp.name`; `hasDefault` from `has_default_value`; `parameter_id=0` return row EXCLUDED; ordinal = contiguous 1..N (D6).
  L-009 map-unit over dedicated parameter rows mirroring the DOG-1 signatures: `usp_log_change(@order_id int, @new_status
  nvarchar)` → EXACTLY `[{@order_id,int,in,1},{@new_status,nvarchar,in,2}]`, no `hasDefault`; `usp_refresh_totals(@order_id
  int)`, `fn_net_amount(@gross decimal)`, `fn_round_money(@amount decimal)` → single-param BARE-type sets, return row
  excluded. ALSO wire the live query into the adapter `Promise.all` fetch and add the SAME L-009 sets to the
  `DBGRAPH_INTEGRATION`-gated `test/cli/mssql.e2e.integration.test.ts` (real container). Spec: mssql-extraction "Extract routine
  parameters from sys.parameters" (MS-1, MS-2); schema-extraction "An adapter with a parameter catalog populates parameters"
  (SE-1). D1/D5/D6.
- [x] 1.4 **(vitest + integration-gated)** RED→GREEN `test/adapters/engines/pg/parameters.test.ts` (new) +
  `src/adapters/engines/pg/queries.ts` + `map.ts`: EXTEND `SQL_PG_ROUTINES` (queries.ts:248) with `proargnames`,
  `proargmodes::text[]`, `COALESCE(proallargtypes::oid[], string_to_array(proargtypes::text,' ')::oid[])::regtype[]::text[]`,
  `pronargdefaults` (§4.2 idiom — VERIFY the cast against the target pg version); `RoutineRow` (map.ts:146) gains the 4 fields;
  `buildRoutines` (map.ts:539) index-aligns names/modes/types → `RawParameter[]`. Map: `i`→`in`, `o`→`out`, `b`→`inout`,
  `v`(VARIADIC)→`in`, `t`(TABLE)→**EXCLUDED**; **`proargmodes` NULL ⇒ ALL `in`** (never emit `out`/`inout` unless the array
  proves it); `dataType` = canonical regtype name, TYPMOD-LESS (`numeric`, not `numeric(10,2)`); `hasDefault:true` for the
  TRAILING `pronargdefaults` args ONLY; ordinal contiguous 1..N after `t`-exclusion (D6). L-009 UNIT fixtures (no torture
  routine needed for modes): `fn_wrapper()`/`fn_inner()` → `parameters:[]` (real empty, NOT unset), no fabricated dir/default;
  `fn_place_order(p_order_id,p_customer_id,p_product_id,p_qty int)` NULL-modes → EXACTLY four `direction:"in"`
  `dataType:"integer"` at ordinals 1..4; a synthetic `v`-mode arg → `in`; a synthetic `t`-mode arg → EXCLUDED; a
  `numeric(10,2)` arg → `dataType:"numeric"` (no fabricated precision). ALSO add the non-`t`/`v` sets to the
  `DBGRAPH_INTEGRATION`-gated pg e2e suite. Spec: pg-extraction "Decode routine parameters from pg_proc arrays" (PG-1, PG-2,
  PG-3, PG-4); schema-extraction (SE-1). D1/D5/D6, §9 open-Q resolutions.
- [x] 1.5 **(vitest + integration-gated)** RED→GREEN `test/adapters/engines/mysql/parameters.test.ts` (new) +
  `src/adapters/engines/mysql/queries.ts` + `map.ts` + adapter fetch: add `SQL_MYSQL_PARAMETERS` over
  `information_schema.PARAMETERS` (`WHERE SPECIFIC_SCHEMA = DATABASE() AND ORDINAL_POSITION > 0`, `ORDER BY SPECIFIC_NAME,
  ORDINAL_POSITION`); `MysqlParameterRow` + `buildRoutines` (map.ts:473) builds a `routine_name → RawParameter[]` map and
  attaches. Map: `PARAMETER_MODE` `IN`→`in`/`OUT`→`out`/`INOUT`→`inout`, **NULL (function params) ⇒ `in`**; `dataType` = FULL
  `DTD_IDENTIFIER` (`int`, `varchar(20)`); `ORDINAL_POSITION=0` return row EXCLUDED; **`hasDefault` NEVER emitted** (no column
  → OMITTED, HONESTY); ordinal contiguous 1..N (D6). L-009: `proc_orchestrate()`/`proc_step()` → `parameters:[]`, no
  `hasDefault` on any param; `fn_audit_write(p_order_id INT, p_old_status VARCHAR(20), p_new_status VARCHAR(20)) RETURNS INT`
  → EXACTLY `[{p_order_id,int,in,1},{p_old_status,varchar(20),in,2},{p_new_status,varchar(20),in,3}]`, ordinal-0 return
  EXCLUDED. ALSO add the sets to the `DBGRAPH_INTEGRATION`-gated mysql e2e suite. Spec: mysql-extraction "Extract routine
  parameters from information_schema.PARAMETERS" (MY-1, MY-2); schema-extraction (SE-1). D1/D5/D6.
- [x] 1.6 **(vitest)** RED→GREEN `test/adapters/engines/sqlite/parameters-absence.test.ts` (new): pin HONEST ABSENCE over the
  EXISTING sqlite torture catalog — NO `RawObject` carries `parameters` (UNSET, NOT `[]`); the `CapabilityMatrix` still reports
  procedures + functions UNSUPPORTED; NO fixture object added; NO `sqlite/*` code change. Spec: sqlite-extraction "SQLite emits
  no routine parameters" (SQ-1); schema-extraction "An engine without a parameter catalog leaves the field unset" (SE-2, the
  unset half). D5.
- [x] 1.7 GATE (Batch 1): RE-MEASURE baseline FIRST; `npx tsc --noEmit` strict clean (no `any`, `exactOptionalPropertyTypes`);
  `npm run lint` 0/0; `npm test` GREEN (baseline + 1.1–1.6 suites); engines write-verb scanner GREEN (new queries are catalog
  `SELECT` only); **EVERY aggregate golden byte-identical — ALL engines, HARD STOP on ANY drift** (extraction proved via
  map-unit + integration tiers only; nothing re-blessed here); leak-scan clean; confirm nothing pushed. COMMIT
  `feat(core,engines): extract routine parameters (RawParameter → RoutinePayload.parameters) per engine`.

## Batch 2: shared `renderParameters` + dual-formatter wiring + present goldens + THE single re-bless + DoD

> Realizes D3 + §6 blast-radius + §10. Adds the ONE shared renderer wired into BOTH surfaces, the new present golden family,
> and the SINGLE deliberate aggregate re-bless (mssql/pg/mysql raw-catalog + e2e + mssql dump — inventoried). sqlite + MCP
> goldens MUST show ZERO drift. Ends in the consolidated gate + DoD handoff to `sdd-verify`.

- [x] 2.1 **(vitest)** RED→GREEN `test/core/present/parameters.test.ts` (new) + `src/core/present/payload.ts`: add the pure
  `renderParameters(node): string[]` — empty/unset `parameters` → `[]` (no section); else header `PARAMETERS` then, ascending
  `ordinal`, `  <name>  <dataType>` (2-space indent, double-space gaps, mirrors `renderColumns`) + UPPERCASE markers
  `[OUT]`/`[INOUT]`/`[DEFAULT]` double-space-joined; `in` renders NO marker; `[DEFAULT]` is PRESENCE-only (never the value).
  L-009 grammar unit: out/inout/in/hasDefault mixed set → exact lines with UPPERCASE markers and `in` unmarked; out-of-order
  input → rendered ascending `ordinal`; unset → `[]`. Spec: mcp-server "direction and default markers are UPPERCASE; `in` is
  unmarked" (MCP-2), "parameter order follows ordinal" (MCP-4). D3.
- [x] 2.2 **(vitest)** RED→GREEN `test/core/present/explore.test.ts` (extend) + `src/core/present/explore.ts` /
  `payload.ts`: add `case 'procedure': case 'function': return renderParameters(node);` to `renderFocusPayload`
  (payload.ts:222) — `present/explore.ts:116` already routes non-container focus through it, so `explore` (+ MCP
  `dbgraph_explore`) gets the section for FREE; gated at non-brief. L-009 over a synthetic routine `PresentView`: `normal`
  emits the exact PARAMETERS lines; `brief` emits none. Spec: mcp-server "Routine focus renders a PARAMETERS section via the
  shared payload helper" (MCP-1 explore side), "detail-gated to normal and full, absent at brief" (MCP-3). D3.
- [x] 2.3 **(vitest)** RED→GREEN `test/core/present/object.test.ts` (extend) + `src/core/present/object.ts`: insert a
  PARAMETERS block into `formatObject` calling the SAME `renderParameters(view.node)`, AFTER the CONSTRAINTS section and
  BEFORE the `if (detail === 'normal') return` early-return (object.ts:101) so it renders at `normal` AND `full`, NOT `brief`
  — this is the design §9 understatement (object does NOT call `renderFocusPayload`; without this, object/MCP-object silently
  omit parameters). L-009: BOTH `explore` and `object` emit BYTE-IDENTICAL PARAMETERS lines for the same node (shared source,
  no per-surface branch); `object` brief omits. Spec: mcp-server MCP-1 (byte-identical across surfaces), MCP-3. D3.
- [x] 2.4 **(golden — DELIBERATE, part of the single re-bless)** Add the NEW `parameter-render` present golden family
  (`test/golden/present/*`, routine focus — explore + object, `normal`) pinning the mssql `usp_log_change` exact lines
  `PARAMETERS` / `  @order_id  int` / `  @new_status  nvarchar` and a mixed out/inout/default set; add the negative:
  non-routine (TABLE) focus + UNSET-parameters routine → NO PARAMETERS section. Spec: mcp-server MCP-1 (exact lines), MCP-5
  (negative). D3/§6.
- [x] 2.5 **(golden — THE SINGLE DELIBERATE RE-BLESS, inventoried)** In ONE commit, re-record the golden-generating parameter
  rows (mssql `test/fixtures/mssql/rows/parameters.json` NEW; pg `rows/routines.json` +arg arrays; mysql `rows/parameters.json`
  NEW — transcribing the DOG-1 signatures accurately, leak-scan neutral) and re-bless the aggregates: mssql/pg/mysql
  `golden-raw-catalog.json` (routine objects gain `parameters`) + `golden-e2e.json` (routine payloads gain `parameters`) +
  `dumps/mssql-dump-golden.json` (new `parameters` family — register in `dump-emitter.ts` `CATALOG_FAMILIES` /
  `CATALOG_FAMILY_KEYS`, FOR-JSON `ORDER BY` coexistence). EVERY changed byte traces to a `parameters` array; byte-identical on
  re-run (ADR-008); commit body = per-golden INVENTORY. Extend `queries-for-json.integration.test.ts` + `dump-emitter.test.ts`
  for the new family. Spec: mssql-extraction "mssql goldens gain parameters deliberately, scanner stays green" (MS-3);
  pg-extraction (PG-5); mysql-extraction (MY-3); schema-extraction "non-participating engines byte-identical" (SE-2). D5/§6.
- [x] 2.6 **(vitest / golden — freeze guard)** ASSERT ZERO drift on the non-participating surfaces: the existing
  sqlite-substrate explore/object goldens (TABLE focus `main.employees`) + the MCP explore/object goldens are BYTE-IDENTICAL
  (a move is a HARD STOP — the shared branch fabricated a sqlite section); add the `docs/format-spec.md` §6 token-delta note
  for the new PARAMETERS section. Spec: sqlite-extraction "SQLite present/MCP goldens show zero drift" (SQ-2); mcp-server MCP-5
  (non-routine/unset negative). §6.
- [ ] 2.7 GATE (Batch 2 — FINAL): RE-MEASURE baseline; `npx tsc --noEmit` strict clean (no `any`); `npm run lint` 0/0;
  `npm test` FULL GREEN (baseline + ALL Batch 1 + Batch 2 suites) with EVERY re-blessed golden byte-identical on re-run;
  **sqlite + MCP goldens byte-identical (HARD STOP)**; engines write-verb scanner GREEN; ADR-004 read-only + ADR-008
  determinism green; leak-scan clean; confirm NOTHING pushed (no push/PR/gh/tag). Trace the DoD below. COMMIT
  `feat(present): render routine PARAMETERS section across explore and object + deliberate golden re-bless`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 1** (1.1–1.7): CORE + EXTRACTION — `node.ts`/`catalog.ts` types, `normalize.ts` ordinal-sorted payload copy,
  mssql `SQL_MSSQL_PARAMETERS`+map+adapter fetch, pg extended `SQL_PG_ROUTINES` decode, mysql `SQL_MYSQL_PARAMETERS`+map,
  sqlite honest-absence guard; L-009 map-unit + `DBGRAPH_INTEGRATION`-gated pins; NO renderer, NO aggregate re-bless.
- **Batch 2** (2.1–2.7): RENDER + THE SINGLE RE-BLESS — `present/payload.ts` `renderParameters`, `explore.ts` +
  `object.ts` dual wiring (gated normal+full), new present golden family, the ONE deliberate aggregate re-bless
  (raw-catalog + e2e + mssql dump), sqlite/MCP zero-drift guards + `docs/format-spec.md` §6 note, consolidated gate + DoD.

### Parallel vs sequential

- **Batches are STRICTLY SEQUENTIAL: 1 → 2.** Batch 2's renderer + present goldens depend on `RoutineParameter` +
  `buildPayload.parameters` EXISTING (Batch 1); the single aggregate re-bless (2.5) depends on the full extraction path (1.3–1.5).
- **Within Batch 1, 1.1 (types) → 1.2 (normalize copy)** are the prerequisites for everything. **1.3 (mssql), 1.4 (pg),
  1.5 (mysql) touch INDEPENDENT files → parallel-safe** (they land in one session); 1.6 (sqlite) is independent (assertion
  only). 1.7 gates all.
- **Within Batch 2, 2.1 (renderer) → 2.2 (explore) + 2.3 (object)** (both consume `renderParameters`; 2.2/2.3 touch
  independent files → parallel-safe after 2.1); 2.4 (present goldens) depends on 2.2+2.3; 2.5 (single re-bless) depends on
  the Batch-1 extraction; 2.6 (freeze guard) is independent; 2.7 gates all.

### Dependency bottlenecks

- **`renderParameters` (2.1) is the render bottleneck** — BOTH surfaces reuse it. The design §9 correction (object.ts needs
  its OWN block, 2.3) is the one place a "rendering only in explore" shortcut would silently drop object parameters — 2.3 is
  MANDATORY, not optional.
- **THE SINGLE aggregate re-bless (2.5) is the golden bottleneck** — mssql/pg/mysql raw-catalog + e2e + mssql dump churn in
  ONE inventoried commit. Batch 1 deliberately keeps aggregate goldens byte-identical (two-tier vehicle) so this re-bless is
  the ONLY one; a per-batch or per-file drip violates the single-re-bless discipline. **Risk:** if the golden-generating
  recorded rows and the map-unit fixtures cannot be kept separate in Batch 1, the aggregate raw-catalog golden would drift in
  Batch 1 — apply MUST resolve this by keeping Batch-1 map-unit fixtures dedicated (not golden-feeding) so the re-bless stays
  a single Batch-2 commit.
- **Cross-engine + sqlite/MCP byte-identity is the phase-wide FREEZE** — Batch 1 freezes ALL aggregate goldens; Batch 2
  freezes sqlite + MCP + any untouched engine. A non-target drift means the shared normalize/render seam leaked: HARD STOP,
  investigate, do NOT re-bless.
- **L-009 exactness is load-bearing** — the positive exact-sets + `not.toContainEqual` negatives (no fabricated
  `out`/`inout`, no fabricated `hasDefault`, return row EXCLUDED, no fabricated sqlite section) are the ONLY guard against
  honesty violations; existence-only asserts would silently pass a fabricated flag.
- **pg `v`/`t` are UNIT-ONLY (§9)** — no torture routine exercises them; confirm the DOG-1 pg fixtures contain no `v`/`t`
  routine (else the aggregate pg golden would unexpectedly gain one). `hasDefault` capable-engine coverage (mssql flag, pg
  trailing-count) is pinned by unit fixtures; mysql omits it entirely.

## Definition of Done (tied to the proposal Success Criteria; 23 scenarios across 7 requirements / 7 deltas traced)

- [ ] `RoutinePayload.parameters` / `RawParameter` carry `name`/`dataType`/`direction`/`ordinal`(+`hasDefault?`), ordinal-sorted,
  UNSET when no catalog (unknown ≠ known-zero), `declared` never `inferred`. — Batch 1 (1.1, 1.2) [graph-model GM-1/GM-2/GM-3;
  schema-extraction SE-1/SE-2]
- [ ] `explore`/`object` render a PARAMETERS section (name/type/direction, `hasDefault` where sourced) for a routine focus on
  mssql/pg/mysql — exact bytes (L-009), BYTE-IDENTICAL for CLI AND MCP, explore AND object. — Batch 2 (2.1, 2.2, 2.3, 2.4)
  [mcp-server MCP-1/MCP-2/MCP-3/MCP-4]
- [ ] Parameter ORDER equals ordinal position, contiguous 1..N over emitted params, deterministically pinned (ADR-008). —
  Batch 1 (1.2) + Batch 2 (2.1) [graph-model GM-1; mcp-server MCP-4] (D6)
- [ ] sqlite HONESTLY renders NO parameters — `parameters` UNSET, `CapabilityMatrix` unchanged, present/MCP goldens ZERO
  drift (negative). — Batch 1 (1.6) + Batch 2 (2.6) [sqlite-extraction SQ-1/SQ-2; mcp-server MCP-5]
- [ ] pg all-IN routine (NULL `proargmodes`) renders every param `in`; VARIADIC `v`→`in`; `t` TABLE EXCLUDED; typmod-less
  `dataType` (no fabricated precision) — exact per engine. — Batch 1 (1.4) [pg-extraction PG-2/PG-3/PG-4]
- [ ] `hasDefault` reflects ONLY a real catalog flag — mssql `has_default_value`, pg trailing `pronargdefaults`; mysql OMITS
  it entirely — no fabricated default (HONESTY). — Batch 1 (1.3, 1.4, 1.5) [mssql MS-1; pg PG-1; mysql MY-1/MY-2; graph-model GM-3]
- [ ] Only mssql/pg/mysql raw-catalog/e2e + mssql dump goldens re-blessed — ONE deliberate inventoried commit, byte-identical
  on re-run; sqlite + MCP + untouched engines byte-identical at EVERY gate; engines write-verb scanner green. — Batch 2 (2.5,
  2.6) [mssql MS-3; pg PG-5; mysql MY-3; schema-extraction SE-2]
- [ ] `npx tsc --noEmit` strict clean (no `any`); `npm run lint` 0/0; `npm test` GREEN (re-measured baseline + all new suites),
  every golden byte-identical on re-run; ADR-004 read-only + ADR-008 determinism green; leak-scan clean; nothing pushed. —
  every batch GATE (1.7, 2.7)
