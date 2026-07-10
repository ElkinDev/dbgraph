# Archive Report — dog2-routine-parameters

**Change**: dog2-routine-parameters (DOG-2 — routine parameters, `RoutinePayload.parameters`)
**Branch**: post-v1 (repo dbgraph)
**Artifact store**: openspec (files) — no engram writes
**Archived**: 2026-07-07
**Verdict**: PASS — 0 CRITICAL / 0 WARNING / 1 SUGGESTION (see `verify-report.md`, carried into this archive)

## Shipped Commits

| Commit | Summary |
|--------|---------|
| `216d8bd` | docs(dog2-routine-parameters): add SDD planning (proposal, specs, design, tasks); reconcile dataType honesty per engine |
| `fd2e5e4` | feat(core,engines): extract routine parameters (RawParameter → RoutinePayload.parameters) per engine |
| `b7c80b9` | feat(present): render routine PARAMETERS section across explore and object + deliberate golden re-bless |
| `5d0722e` | docs(dog2-routine-parameters): mark tasks + DoD complete (Batch 1 + Batch 2 done) |

## Headline

Routine parameters are now LIVE across the SQL engines with HONEST per-engine `dataType` composition —
proven not against fixtures alone but against LIVE catalogs in Docker. Each engine surfaces the parameter
type EXACTLY as it surfaces its own COLUMN types, with zero cross-engine normalization: **mssql is BARE**
(`sys.types` name only — `int` / `nvarchar` / `decimal`, never `decimal(12,2)`), **pg is typmod-less**
(canonical `regtype` names — `integer` / `numeric`; PostgreSQL physically stores NO per-argument typmod, so
a `numeric(10,2)` argument honestly surfaces as `numeric`, never fabricated), and **mysql is FULL**
(`DTD_IDENTIFIER` — `int` / `varchar(20)`). The three engines source from `sys.parameters ⋈ sys.types`,
`pg_proc` argument arrays decoded via `regtype`, and `information_schema.PARAMETERS` respectively; each
excludes the FUNCTION RETURN row (mssql `parameter_id = 0`, mysql `ORDINAL_POSITION = 0`, pg `t`-mode
TABLE entries), emits contiguous 1..N ordinals over the surviving arguments, and sets `hasDefault` ONLY
where a real catalog flag sources it (mssql `has_default_value`, pg trailing `pronargdefaults`; mysql
OMITS it entirely — no default column exists). Direction is decoded from the catalog, never guessed: a
NULL mode (pg `proargmodes`, mysql function params) maps to `in`; pg VARIADIC `v` is an input; `out`/`inout`
are emitted only where the catalog PROVES them.

The rendered surface is driven by ONE shared `renderParameters` helper in `src/core/present/payload.ts`,
so CLI `explore`, CLI `object`, and the MCP `dbgraph_explore`/`dbgraph_object` tools all emit BYTE-IDENTICAL
`PARAMETERS` bytes for the same node — no per-surface branch. The section is detail-gated as the routine
analog of COLUMNS (rendered at `normal`/`full`, absent at `brief`), orders by ascending `ordinal`, and marks
direction/default in UPPERCASE (`[OUT]`/`[INOUT]`/`[DEFAULT]`) with `in` unmarked — matching the established
`[PK]`/`[FK→]`/`[NN]` casing convention; `[DEFAULT]` is a PRESENCE marker only (the default value is never
rendered). The sqlcmd and manual-dump connectivity strategies were extended so the parameters family flows
through those offline paths too (registered in `dump-emitter.ts` + `sqlcmd.strategy.ts` CATALOG_FAMILIES,
with a backward-compatible `coerceParameterRow` so pre-DOG-2 dumps still parse) — validated by the live
FOR-JSON tier (parameters family FOR JSON PATH parseable, BARE types, no Msg 1033).

SQLite is HONEST ABSENCE: its `CapabilityMatrix` declares procedures/functions unsupported, so `parameters`
stays UNSET on every SQLite `RawObject` — distinguishing "unknown" from "known-zero", never an empty array,
never fabricated — pinned by a genuine unset assertion (`in`-operator present-check + `toBeUndefined()`).
The sqlite and MCP goldens are BYTE-IDENTICAL vs the planning baseline (`216d8bd`): the feature adds no
SQLite output. Single-re-bless discipline held — B1 (`fd2e5e4`) touched ZERO goldens; the entire deliberate
re-bless is one Batch-2 commit (`b7c80b9`). Test suite grew **3448 → 3506** (contract-exact 3506). Gate
green throughout: tsc 0, lint 0/0, npm test 3506/3506, write-verb scanner green (all new param queries are
catalog `SELECT` only). All three Docker-gated engine tiers plus the FOR-JSON dump tier ran green with live
per-engine L-009 parameter pins.

## Documented Deviations Accepted (all evaluated HONEST per verify-report.md)

1. **`golden-e2e.json` NOT re-blessed** — HONEST. The e2e golden is a SUMMARY (edgeCount, edgeKinds,
   firstNodes kind+qname, nodeCount, stubCount) with ZERO payloads; adding a `parameters` payload field
   cannot change it. Parameters are pinned instead by `DBGRAPH_INTEGRATION`-gated live `it()` assertions
   (added in B1, run green). The literal "re-bless golden-e2e" task line was a no-op against reality; the
   chosen path is strictly MORE honest. **Mental-model correction recorded: the e2e goldens are summaries,
   not payload snapshots** — a future change must not expect payload additions to move them.
2. **Aggregate goldens container-generated, not fixture-generated** — HONEST. The map-unit fixtures use
   dedicated non-golden-feeding routine names; the raw-catalog aggregates are regenerated from a live
   container. This is exactly the discipline that keeps the re-bless a single Batch-2 commit.
3. **Gated assertion placement by data availability** — HONEST. pg/mysql zero-arg e2e assertions check
   `payload.parameters` `toBeUndefined()` (post-normalize the empty array is elided), while the map-unit
   tier asserts `RawObject.parameters` `toStrictEqual []`. Both correct at their layer; placement honestly
   reflects where the empty-vs-unset distinction lives.
4. **sqlcmd / manual-dump strategy wiring extension** — HONEST and TESTED. Beyond the literal task text but
   NECESSARY: without it the manual-dump path would silently drop parameters. Proven by `dump-emitter.test.ts`
   (default suite) and the live FOR-JSON tier (both green).
5. **mysql fixture param types partially synthetic** — HONEST. The map-unit fixture uses synthetic types on
   synthetic routines to avoid conflation with the golden-feeding routines; the REAL types (`int`,
   `varchar(20)`) are sourced from the live container into the aggregate golden and pinned by the gated e2e
   assertion. No fabrication reaches any output path.

## Suggestion Recorded as Future Item (1, non-blocking)

1. **S-1 — live-container honesty pins are gated-only.** The per-engine e2e parameter sets and the FOR-JSON
   parameters-family coexistence run ONLY under `DBGRAPH_INTEGRATION=1` and are excluded from the default
   `npm test` gate. This mirrors the DOG-1 pattern; the map-unit + golden tiers cover the logic in default
   CI, and the verifier executed all gated tiers by hand (green). No action required unless the team wants
   these pins in default CI.

## Specs Synced (7 delta specs → canonical)

| Domain | Action | Merge detail |
|--------|--------|--------------|
| `graph-model` | Updated | 1 ADDED, appended inline at the tail of `## Requirements` (flat inline structure — dog1 established no dated-section convention here): `Routine parameters payload contract` (3 scenarios: view carries name/type/direction/ordinal; absent catalog leaves field UNSET; hasDefault only where sourced). Defines the OPTIONAL `RoutinePayload.parameters?` view + mirroring `RawObject.parameters?` contract. |
| `schema-extraction` | Updated | 1 ADDED, appended inline at the tail of `## Requirements` (flat inline structure — matches the RawField / tokenizer / mongodb precedents): `Optional RawObject.parameters is an engine-agnostic, honest-absence contract` (2 scenarios: adapter with catalog populates; engine without catalog stays UNSET + byte-identical). Registers the port-contract obligation; adds NO port method, no SHAPE change. |
| `mssql-extraction` | Updated | 1 ADDED via a DATED sub-section `## Requirements Added by dog2-routine-parameters (2026-07-07)` (`---` + header + summary blockquote — matching this file's connectivity-strategies + dog1 precedent): `Extract routine parameters from sys.parameters` (3 scenarios: usp_log_change exact BARE; single-param + scalar fns with parameter_id=0 excluded; deliberate re-bless + scanner green). |
| `pg-extraction` | Updated | 1 ADDED, appended inline at the tail (flat inline structure, no dated-section precedent — matches dog1): `Decode routine parameters from pg_proc arrays` (5 scenarios: fn_wrapper/fn_inner empty; NULL proargmodes all-IN; VARIADIC-in + RETURNS TABLE excluded; typmod-less dataType; deliberate re-bless + scanner green). |
| `mysql-extraction` | Updated | 1 ADDED, appended inline at the tail (flat inline structure, no dated-section precedent): `Extract routine parameters from information_schema.PARAMETERS` (3 scenarios: proc_orchestrate/proc_step empty + no hasDefault; fn_audit_write ordinal-0 excluded FULL types; deliberate re-bless + scanner green). |
| `sqlite-extraction` | Updated | 1 ADDED, appended inline at the tail of `## ADDED Requirements` (matching this file's sqlite-view-deps + dog1 precedent): `SQLite emits no routine parameters (capability honestly absent)` (2 scenarios: catalog carries no parameters field / CapabilityMatrix unchanged; present/MCP goldens zero drift). An HONEST negative — no fixture object added. |
| `mcp-server` | Updated | 1 ADDED, appended inline at the tail (no dated-section convention — matches dog1 + explore-payloads precedent): `Routine focus renders a PARAMETERS section via the shared payload helper` (5 scenarios: mssql exact lines byte-identical explore/object; UPPERCASE OUT/INOUT/DEFAULT with `in` unmarked; detail-gated normal/full absent brief; order follows ordinal; non-routine / UNSET renders nothing). |

## Deferred (Epic Backlog — deep-object-graph)

- **DOG-3, DOG-4** remain in the deep-object-graph epic backlog; they are out of scope for DOG-2 and are
  not touched by this archive. The `deep-object-graph` epic proposal and the `graph-viz` change stay ACTIVE
  under `openspec/changes/`.

## Gates (re-confirmed at archive time)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npx tsc --noEmit` | PASS |
| Lint | `npx eslint .` | PASS — 0 errors / 0 warnings |
| Tests | `npm test` | PASS — 3506 passed / 0 failed |

## Next recommended: none — SDD cycle complete for `dog2-routine-parameters`. The deep-object-graph epic (DOG-3/4) and graph-viz remain the natural next changes.
