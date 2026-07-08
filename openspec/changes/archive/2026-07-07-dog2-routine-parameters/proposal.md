# Proposal: DOG-2 — Routine Parameters (`RoutinePayload.parameters`)

> Second child of the **deep-object-graph** epic (`openspec/changes/deep-object-graph/proposal.md`).
> Size S, no deps, runs in PARALLEL with DOG-1 (now ARCHIVED as `archive/2026-07-07-dog1-calls-edges`).
> Pure-additive payload — NO new edge kind, NO graph-shape change, NO impact-traversal change.

## Intent

dbgraph extracts a routine's body, signature, and dynamic-SQL blindness but NOT its PARAMETERS.
Verified in code: `RoutinePayload` (`core/model/node.ts:96`) has `signature?/returns?/body?/hasDynamicSql/
comment?` and NO parameter field; `RawObject` (`core/model/catalog.ts:23`) has no parameters either; and
NO engine query reads `sys.parameters` / `pg_proc` arg arrays / `information_schema.PARAMETERS`
(`SQL_MSSQL_MODULES`, `SQL_PG_ROUTINES`, `SQL_MYSQL_ROUTINES` select name/type/body only).

The fixtures ALREADY carry parametrized routines from DOG-1 — mssql `sp_place_order(@order_id int,
@customer_id int, @product_id int, @region_id int, @qty int)`, `fn_discount_price(@price decimal,
@discount decimal)` — but they are INVISIBLE in `explore`/`object`. This is the user's explicit ask
("parámetros"). Now is the moment: the parametrized fixtures exist and the SHARED payload renderer
(`present/payload.ts` `renderFocusPayload`, from explore-payloads) already dispatches routine focus
nodes to a `default: return []` branch — DOG-2 fills exactly that seam.

Success = `explore`/`object` render a PARAMETERS section for a routine focus on mssql/pg/mysql
(name/type/direction, `hasDefault` where the catalog exposes it), parameter ORDER pinned to ordinal
position (ADR-008); sqlite HONESTLY reports parameters absent — never fabricated; L-009 exact-set
goldens pin the rendered parameter list per engine.

## Scope

### In Scope
- **`RoutinePayload.parameters?: readonly RoutineParameter[]`** (`core/model/node.ts`) + a new
  `RoutineParameter` accessor view: `name`, `dataType` (raw engine type STRING, verbatim — no
  normalization), `direction: 'in' | 'out' | 'inout'`, `hasDefault?: boolean`, `ordinal: number`.
- **`RawObject.parameters?: readonly RawParameter[]`** + `RawParameter` on `core/model/catalog.ts`
  (mirrors the accessor view — the durable adapter→core contract). Optional; SQL engines without a
  parameter catalog leave it unset.
- **Per-engine catalog sourcing (verified reality below):** mssql new `SQL_MSSQL_PARAMETERS` from
  `sys.parameters` + `sys.types` (FOR-JSON-compatible — the dump path uses `FOR JSON PATH`); pg extend
  `SQL_PG_ROUTINES` with `proargnames`/`proargmodes`/`proallargtypes` (+ `pg_type` for the type name);
  mysql new/extended query over `information_schema.PARAMETERS`. sqlite N/A — honest absence.
- **Normalize mapping**: `RawObject.parameters` → `RoutinePayload.parameters` in `graph-normalization`,
  deterministic ordinal ordering (ADR-008). No edge construction — pure payload copy.
- **Present**: `renderFocusPayload` gains the routine case (`procedure`/`function`) → a `PARAMETERS`
  section via the SHARED renderer; `present/explore.ts` already routes non-container focus there, so
  `object`/`explore` render it and MCP inherits automatically (no formatter rewrite).
- **L-009 exact-set goldens + deliberate re-bless**: per-engine raw-catalog + e2e goldens gain
  `parameters` (deliberate re-bless, mssql/pg/mysql); parameter-render goldens for a routine focus.

### Out of Scope (deferred, justified)
- **Default-value EXPRESSIONS** — engines expose them inconsistently (mssql `sys.parameters` carries a
  `has_default_value` FLAG but not the value; pg `proargdefaults` is a node-tree; mysql `PARAMETERS`
  has NO default column at all). We store `hasDefault` boolean ONLY where cleanly sourced — never the
  expression, never a fabricated flag (see Risks).
- **Return-type shape** beyond the scalar `returns` string already captured; **TVF result column
  sets** — deferred (aligns with the epic's DOG-3b routine-body deferral).
- **Structural inference** — parameters are catalog-`declared`, NEVER `inferred`; US-008 untouched.
- **Graph shape** — no edge, no impact/traversal change; DOG-2 is payload-only.

## Capabilities

> Contract for sdd-spec. Names verbatim from `openspec/specs/`.

### New Capabilities
- None. Parameters extend the EXISTING `RoutinePayload`/`RawObject` contracts; no new capability directory.

### Modified Capabilities
- `graph-model`: add `RoutinePayload.parameters` + `RoutineParameter`; `RawObject.parameters` +
  `RawParameter`; `direction` enum semantics.
- `graph-normalization`: map `RawObject.parameters` → payload, deterministic ordinal ordering (ADR-008).
- `schema-extraction`: engine-agnostic parameters contract (name/type/direction/hasDefault/ordinal).
- `mssql-extraction`, `pg-extraction`, `mysql-extraction`: per-engine catalog sourcing + mode/default
  honesty; `sqlite-extraction`: parameters HONESTLY absent (declared, not fabricated).
- `mcp-server`, `cli-config`: `renderFocusPayload` PARAMETERS section for routine focus (shared → both).
- `benchmark`: new `parameter-render` golden family (per engine).
- NOT `graph-query` — pure payload; no impact/traversal change (the key contrast with DOG-1).

## Approach

**Extend, don't reinvent** (epic invariant). One additive field carried end-to-end
(`RawParameter` → `RoutinePayload.parameters`) and one renderer case. **Honesty is per-engine and
NEVER blurred (HONESTY / L-009):**

### Per-engine reality matrix (verified against catalog capabilities)

| Field | mssql | pg | mysql | sqlite |
|---|---|---|---|---|
| **name** | `sys.parameters.name` | `proargnames` | `PARAMETER_NAME` | — |
| **dataType** | `sys.types` join | `pg_type` via `proallargtypes` | `DTD_IDENTIFIER` | — |
| **direction** | `is_output` → in/out | `proargmodes` i/o/b/v/t (b=inout; NULL ⇒ all IN) | `PARAMETER_MODE` IN/OUT/INOUT | — |
| **hasDefault** | `has_default_value` (flag) | trailing-count via `pronargdefaults` (partial) | **absent** (no column) | — |
| **ordinal** | `parameter_id` | array position | `ORDINAL_POSITION` (excl. 0 = fn return) | — |
| **provenance** | catalog/`declared` | catalog/`declared` | catalog/`declared` | **absent, honest** |

- pg `proargmodes` NULL means ALL params are IN — the encoding is a genuine honesty point (don't emit
  `out`/`inout` unless the mode array proves it). mysql function-return row (`ORDINAL_POSITION = 0`,
  NULL name) is EXCLUDED, not rendered as a param. sqlite has no parameter catalog → the payload
  declares the capability absent (like DOG-1's calls) — the renderer emits no PARAMETERS section.
- **Present is nearly free.** The shared `renderFocusPayload` already dispatches column/constraint/
  index/trigger; adding `procedure`/`function` gives CLI AND MCP the section with no per-surface branch.

**Apply batches:** **A)** `RoutineParameter`/`RawParameter` types + normalize mapping + renderer case +
unit golden → **B)** mssql `sys.parameters` query/map + pg/mysql catalog sourcing + per-engine
raw-catalog/e2e golden re-bless (deliberate) + sqlite honest-absence assertion.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/model/node.ts` | Modified | `RoutinePayload.parameters` + `RoutineParameter` view |
| `src/core/model/catalog.ts` | Modified | `RawObject.parameters` + `RawParameter` |
| `src/core/normalize/normalize.ts` | Modified | Map `RawObject.parameters` → payload, ordinal order |
| `src/core/present/payload.ts` | Modified | `renderFocusPayload` routine case → PARAMETERS section |
| `src/adapters/engines/mssql/{queries,map}.ts` | Modified | `SQL_MSSQL_PARAMETERS` (`sys.parameters`+`sys.types`, FOR JSON-safe) |
| `src/adapters/engines/pg/{queries,map}.ts` | Modified | `SQL_PG_ROUTINES` gains arg arrays |
| `src/adapters/engines/mysql/{queries,map}.ts` | Modified | `information_schema.PARAMETERS` |
| `src/adapters/engines/sqlite/*` | Verify | Parameters honestly absent — no change |
| `test/` per-engine raw-catalog/e2e + present goldens | Modified | Deliberate re-bless; new L-009 sets |
| `openspec/specs/{graph-model,graph-normalization,schema-extraction,mssql-extraction,pg-extraction,mysql-extraction,sqlite-extraction,mcp-server,cli-config,benchmark}/` | Modified | Deltas per Capabilities |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `hasDefault` over-claimed where the catalog can't source it (mysql none; pg only trailing-count) | Med | Emit `hasDefault` ONLY from a real catalog flag; mysql omits the field (undefined), pg marks only trailing defaulted args; never fabricate (HONESTY) |
| Direction semantics differ (mssql has no explicit INOUT in `sys.parameters`; pg VARIADIC/TABLE modes) | Med | `direction` enum `in\|out\|inout`; map `is_output`→out, pg `b`→inout, `v`/`t` documented per-engine; goldens pin exact per engine |
| pg `proargmodes` NULL mishandled → spurious `out`/`inout` | Med | NULL ⇒ all IN; unit + pg golden pin an all-IN routine |
| mssql `FOR JSON PATH` dump path rejects the new parameter query shape | Low-Med | New query is FOR-JSON-compatible (subquery/ordering per existing `SQL_MSSQL_*` convention); verify in design |
| Golden churn beyond intent (sqlite/MCP explore drift) | Low | sqlite has no params AND the MCP explore goldens focus a sqlite TABLE → NO drift; only mssql/pg/mysql raw-catalog/e2e re-bless (deliberate) |
| Raw engine type strings vary (`decimal(10,2)` vs `numeric`) | Low | Store the raw catalog type STRING verbatim; per-engine golden pins exact bytes (no cross-engine normalization) |

## Rollback Plan

Purely additive and revertible. Revert by: deleting `RoutinePayload.parameters`/`RoutineParameter` and
`RawObject.parameters`/`RawParameter`; dropping the normalize mapping; removing the `renderFocusPayload`
routine case; reverting `SQL_MSSQL_PARAMETERS` and the pg/mysql query/map additions; `git revert` of the
golden commit to restore byte-pins. `parameters` is an OPTIONAL field with no consumer that breaks when
absent — reverting DOG-2 leaves DOG-1 (shipped) and every engine green. No edge kind, impact path, FK/
reference/inference path, or storage schema is touched (ADR-004 read-only boundary intact).

## Dependencies

- Reuses `RawObject`/`RoutinePayload` contracts, the normalize mapping path, and the shared
  `present/payload.ts` renderer — ZERO new npm packages (ADR-004/008 intact).
- Parametrized routines already exist in every engine's `torture.sql` (added by DOG-1) — no NEW fixtures
  required; leak-scan neutrality inherited (commerce/order-themed names, no payroll/finance flavor).
- No storage migration (payload is opaque JSON). Depends on NOTHING — runs parallel to any DOG sibling.

## Success Criteria

- [ ] `explore`/`object` render a PARAMETERS section (name/type/direction, `hasDefault` where sourced)
      for a routine focus on mssql/pg/mysql — exact bytes asserted (L-009), for BOTH CLI and MCP.
- [ ] Parameter ORDER equals ordinal position, deterministically pinned (ADR-008).
- [ ] sqlite HONESTLY renders NO parameters for a routine focus — parameters declared absent, never
      fabricated (negative assertion).
- [ ] pg all-IN routine (NULL `proargmodes`) renders every parameter as `in`; a routine with an OUT/
      INOUT param renders the correct direction — exact-set per engine.
- [ ] `hasDefault` reflects ONLY a real catalog flag; mysql omits it, pg marks only trailing defaults —
      no fabricated default (HONESTY).
- [ ] Only mssql/pg/mysql raw-catalog/e2e goldens re-blessed (deliberate); sqlite + MCP explore goldens
      show ZERO drift; `tsc`/lint/test green; ADR-004 read-only boundary green.
