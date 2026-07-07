# Design: DOG-2 — Routine Parameters (`RoutinePayload.parameters`)

> Technical design for the proposal at `openspec/changes/dog2-routine-parameters/proposal.md`.
> Size S. Pure-additive payload — no new edge kind, no graph-shape change, no storage migration.
> Governing invariants: ADR-004 (core imports nothing from adapters; read-only boundary),
> ADR-008 (determinism — same input → byte-identical output), L-009 (exact-set goldens),
> HONESTY (per-engine, never blurred, never fabricated), leak-scan (fixture-name neutrality).

## 1. Context & Constraints (verified in code)

- `RoutinePayload` (`src/core/model/node.ts:96`) carries `signature?/returns?/body?/hasDynamicSql/comment?`
  and NO parameter field. `RawObject` (`src/core/model/catalog.ts:23`) has no `parameters` either.
- No engine query reads a parameter catalog today: `SQL_MSSQL_MODULES` (queries.ts:208) selects
  name/type/body; `SQL_PG_ROUTINES` (queries.ts:248) selects `proname/prokind/pg_get_functiondef`;
  `SQL_MYSQL_ROUTINES` (queries.ts:221) selects `ROUTINE_NAME/TYPE/DEFINITION`.
- The shared renderer `renderFocusPayload` (`src/core/present/payload.ts:222`) dispatches
  column/constraint/index/trigger and returns `[]` for the `default:` branch — routines fall here today.
- **Storage is schema-less**: `nodes.payload TEXT NOT NULL` (`storage/sqlite/schema.ts:39`). Payload is
  opaque JSON — adding a `parameters` key needs NO migration (Decision D4).
- **mssql dump path (F-1..F-7)**: `dump-emitter.ts` appends `FOR JSON PATH, INCLUDE_NULL_VALUES`
  DIRECTLY to each top-level query (never subquery-wrapped — ORDER BY inside a derived table is Msg 1033).
  Every catalog constant is a single top-level SELECT ending in `ORDER BY`. The combined dump JSON is
  keyed one-family-per-query via `CATALOG_FAMILIES` / `CATALOG_FAMILY_KEYS` and reassembled from chunks
  by the sqlcmd/dump reader. A new parameter family MUST follow this exact convention.
- **Fixtures reality**: pg/mysql routine fixtures already carry parametrized routines, but ONLY as body
  text — no catalog parameter arrays yet (`test/fixtures/pg/rows/routines.json` has no `proarg*`;
  mysql has no `rows/parameters.json`). sqlite golden-raw-catalog has ZERO routines → structurally no drift.

## 2. Chosen Approach — "extend, don't reinvent" (epic invariant)

One additive field threaded end-to-end, one shared renderer, wired into both surfaces:

```
engine catalog (sys.parameters / pg_proc arg arrays / info_schema.PARAMETERS)
   │  per-engine map.ts  → RawParameter[]
   ▼
RawObject.parameters?: readonly RawParameter[]        (catalog.ts — durable adapter→core contract)
   │  normalize.buildPayload (procedure/function branch), ordinal-sorted, ADR-008
   ▼
RoutinePayload.parameters?: readonly RoutineParameter[]   (node.ts — accessor view over opaque JSON)
   │  renderParameters(node)  ← NEW shared renderer (payload.ts)
   ├──► renderFocusPayload procedure/function case → formatExplore (explore, MCP explore)
   └──► formatObject module section (before BODY)  → formatObject (object, MCP object)
```

Architecture layering is preserved: types in `core/model`, mapping in `core/normalize`, rendering in
`core/present`, extraction in `adapters/engines/*`. No adapter type leaks into core (ADR-004). The
renderer is pure and deterministic (ADR-008): no Date/env/random/I/O.

## 3. Component Map & Data Flow

### 3.1 Types (accessor view + durable contract)

`RoutineParameter` (new, `core/model/node.ts`) and its mirror `RawParameter` (new, `core/model/catalog.ts`)
share the same shape — the accessor view over opaque JSON and the durable adapter→core contract:

```ts
name: string;                          // raw catalog name, VERBATIM (mssql keeps '@', pg/mysql bare)
dataType: string;                      // raw engine type STRING, verbatim — NO normalization
direction: 'in' | 'out' | 'inout';
hasDefault?: boolean;                  // ONLY when a real catalog flag sources it; else undefined
ordinal: number;                       // 1-based position, deterministic render order (ADR-008)
```

- `RoutinePayload` gains `parameters?: readonly RoutineParameter[]`.
- `RawObject` gains `parameters?: readonly RawParameter[]` (optional — SQL engines without a parameter
  catalog leave it unset; sqlite NEVER sets it).

### 3.2 Normalize mapping (`core/normalize/normalize.ts` — `buildPayload`)

In the `procedure || function` branch (currently lines 268-272), add:

```ts
if (obj.parameters !== undefined && obj.parameters.length > 0) {
  base['parameters'] = [...obj.parameters].sort((a, b) => a.ordinal - b.ordinal);
}
```

Conditional emission mirrors the existing `signature`/`returns` pattern (emit only when present). Sort by
ordinal defensively so payload JSON is deterministic regardless of adapter row order (ADR-008). Pure copy —
NO edge construction, NO reference resolution, NO inference. `parameters` is `declared`, never `inferred`
(US-008 untouched).

### 3.3 Renderer (`core/present/payload.ts` — new `renderParameters`)

```ts
export function renderParameters(node: GraphNode): string[] {
  const params = node.payload['parameters'] as readonly RoutineParameter[] | undefined;
  if (params === undefined || params.length === 0) return [];   // honest absence → no section
  const sorted = [...params].sort((a, b) => a.ordinal - b.ordinal);
  const lines = ['PARAMETERS'];
  for (const p of sorted) {
    const parts = [`  ${p.name}  ${p.dataType}`];
    if (p.direction === 'out') parts.push('[OUT]');
    else if (p.direction === 'inout') parts.push('[INOUT]');
    if (p.hasDefault === true) parts.push('[DEFAULT]');
    lines.push(parts.join('  '));
  }
  return lines;
}
```

Grammar mirrors `renderColumns` exactly (`  name  type` + bracketed markers joined by two spaces).
`in` renders NO direction marker (the default — like a nullable column shows no `[NN]`). `[DEFAULT]` is a
presence marker only (never the value — see D-scope). Section header `PARAMETERS` matches the
`COLUMNS`/`CONSTRAINTS`/`INDEXES`/`TRIGGERS` convention.

### 3.4 Surface wiring (both formatters share ONE renderer — D1/D2)

- **explore** (`present/explore.ts:116`): already routes non-container focus through
  `renderFocusPayload(view.node)`. Add `case 'procedure': case 'function': return renderParameters(node);`
  to `renderFocusPayload` — explore gets PARAMETERS for FREE.
- **object** (`present/object.ts`): `formatObject` does NOT call `renderFocusPayload`. Insert a PARAMETERS
  section (calling the SAME `renderParameters(view.node)`) AFTER the CONSTRAINTS section and BEFORE the
  `if (detail === 'normal') return` early-return (currently line 101), so it renders at `normal` AND
  `full` — matching explore's non-brief gating. This is a small, targeted wiring addition (one section
  block), NOT a formatter rewrite — but it IS a change the proposal understated (see Risks).

Because BOTH surfaces call the identical `renderParameters`, the section bytes are byte-identical across
CLI/MCP explore/object (the D1/D2 shared-renderer invariant). MCP inherits automatically (its tools call
these same formatters).

## 4. Per-Engine Extraction Design (the load-bearing part)

The extraction shape differs per engine because the catalog shape differs — this is the honest, natural
mapping, NOT reinvention:

### 4.1 mssql — SEPARATE query (`SQL_MSSQL_PARAMETERS`)

`sys.parameters` is one-row-per-parameter, so it is a separate top-level query joined by `object_id` in
`map.ts` (mirrors how `SQL_MSSQL_TRIGGER_EVENTS` is a separate family joined to modules):

```sql
SELECT s.name AS schema_name, o.name AS object_name, o.object_id AS object_id,
       p.parameter_id AS parameter_id, p.name AS parameter_name, tp.name AS data_type,
       p.is_output AS is_output, p.has_default_value AS has_default_value
FROM sys.parameters p
JOIN sys.objects o ON o.object_id = p.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types tp  ON tp.user_type_id = p.user_type_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('P','FN','IF','TF') AND p.parameter_id > 0
ORDER BY s.name, o.name, p.parameter_id
```

- `parameter_id = 0` (scalar-function return value, empty name) is EXCLUDED — not a call parameter.
- `is_output` → `direction`: `1`→`out`, `0`→`in`. mssql `sys.parameters` has NO explicit INOUT concept,
  so mssql NEVER emits `inout` — honest to the catalog's expressiveness.
- `has_default_value` (bit) → `hasDefault`.
- `data_type` = `sys.types.name`, verbatim BARE type name (e.g. `int`, `decimal` — NOT `decimal(12,2)`).
  RATIFIED (spec's pin WINS): mssql parameter `dataType` is composed IDENTICALLY to the mssql COLUMN
  `dataType`, which stores the bare `tp.name` (verified `mssql/queries.ts:53`) — consistency with the
  verified mssql column-golden convention beats any composed-precision illustration. NO precision/scale
  composition in scope (raw type-name string only; per-engine goldens pin the exact bytes at apply).
- **FOR JSON safety (F-1..F-7)**: single top-level SELECT + top-level ORDER BY → `dump-emitter` appends
  `FOR JSON PATH, INCLUDE_NULL_VALUES` unchanged. No subquery wrap, no nested FOR JSON, no `sql_variant`
  columns (all fields are nvarchar/int/bit) → no coercion issue. Chunk reassembly is inherited from the
  existing dump reader (parameters is just another family).
- **Plumbing**: add `parameters` to `MssqlRowInput` + a `ParameterRow` interface (`map.ts`); add
  `SQL_MSSQL_PARAMETERS` to the adapter `Promise.all` fetch and the row assembly
  (`mssql-schema-adapter.ts`); register the family in `dump-emitter.ts` `CATALOG_FAMILIES` +
  `CATALOG_FAMILY_KEYS`. In `buildModules`, build an `object_id → RawParameter[]` map and attach
  `parameters` to procedure/function `RawObject`s.

### 4.2 pg — EXTEND `SQL_PG_ROUTINES` (arg arrays live ON `pg_proc`)

pg's argument metadata is on the same `pg_proc` row as the routine, so we EXTEND the existing query rather
than add a second one:

```sql
-- add to the SELECT list:
p.proargnames                                             AS arg_names,      -- text[] | NULL
p.proargmodes::text[]                                     AS arg_modes,      -- cast for reliable driver parse
COALESCE(p.proallargtypes::oid[],
         string_to_array(p.proargtypes::text, ' ')::oid[])::regtype[]::text[] AS arg_type_names,
p.pronargdefaults                                         AS num_defaults
```

- **Type NAMES decoded IN SQL** (`::regtype[]::text[]`) — NOT via a JS OID→name lookup. Rationale: keeps
  the raw engine type string verbatim (`integer`, `numeric`), avoids a `pg_type` join in JS, and the pg
  driver parses `text[]` reliably. `proargmodes` is internally `"char"[]`; cast to `text[]` so
  node-postgres returns a parsed array (raw `"char"[]` risks a `{i,o}` string).
- **RATIFIED honesty note (dataType, typmod-less args)**: PostgreSQL does NOT store per-argument
  length/precision typmod on `pg_proc` argument types (`proargtypes`/`proallargtypes` are OID arrays
  only), so a `numeric(10,2)` argument HONESTLY surfaces as `numeric` — the precision a COLUMN's
  `format_type(atttypid, atttypmod)` would show (verified `pg/queries.ts:94`) is PHYSICALLY ABSENT for a
  function argument and is NEVER fabricated. This is the pg analog of "compose like the COLUMN `dataType`"
  applied to the typmod-less argument input; the pg-extraction delta is aligned to this (canonical name,
  no composed precision). pg/mysql "stay FULL per their conventions" holds for mysql (`DTD_IDENTIFIER`
  carries the full type); for pg the honest FULL-per-convention result is precisely the typmod-less
  canonical name, because that is all the catalog exposes for arguments.
- `proallargtypes` (all args incl. OUT/INOUT/TABLE) is NULL when only IN args exist → fall back to
  `proargtypes` (IN args only). `arg_names`/`arg_modes`/`arg_type_names` are aligned by index in `map.ts`.
- **direction** from `proargmodes` per element: `i`→`in`, `o`→`out`, `b`→`inout`, `v`→`in` (VARIADIC is
  an input), `t`→ **EXCLUDED** (RETURNS TABLE result columns are the deferred TVF-column-set work, not
  call parameters). **`proargmodes` NULL ⇒ ALL params are `in`** — the genuine honesty point; NEVER emit
  `out`/`inout` unless the mode array proves it.
- **hasDefault** via `pronargdefaults`: the trailing N input-capable parameters (in array order) carry
  defaults. Mark only those `hasDefault: true` — "partial" honesty (pg exposes the count, not per-arg
  flags; we never over-claim).
- **Plumbing**: add the four fields to `RoutineRow` (`pg/map.ts:146`); decode/align in `buildRoutines`
  (`pg/map.ts:539`) into `RawParameter[]`; attach to the routine `RawObject`.

### 4.3 mysql — SEPARATE query (`SQL_MYSQL_PARAMETERS`)

`information_schema.PARAMETERS` is one-row-per-parameter → separate query keyed by `SPECIFIC_NAME`:

```sql
SELECT SPECIFIC_SCHEMA AS routine_schema, SPECIFIC_NAME AS routine_name,
       ORDINAL_POSITION AS ordinal_position, PARAMETER_NAME AS parameter_name,
       PARAMETER_MODE AS parameter_mode, DTD_IDENTIFIER AS data_type
FROM information_schema.PARAMETERS
WHERE SPECIFIC_SCHEMA = DATABASE() AND ORDINAL_POSITION > 0
ORDER BY SPECIFIC_NAME, ORDINAL_POSITION
```

- `ORDINAL_POSITION = 0` (FUNCTION return row, NULL name) is EXCLUDED — not a parameter.
- **direction** from `PARAMETER_MODE`: `IN`→`in`, `OUT`→`out`, `INOUT`→`inout`. **`PARAMETER_MODE` NULL
  (FUNCTION input params) ⇒ `in`** — mysql reports NULL mode for function params (they are implicitly IN);
  this is the mysql analogue of pg's NULL-modes honesty rule.
- `data_type` = `DTD_IDENTIFIER`, verbatim (full declared type, e.g. `int`, `decimal(10,2)`).
- **hasDefault**: `information_schema.PARAMETERS` has NO default column → `hasDefault` is OMITTED
  (undefined) for every mysql parameter. NEVER fabricated (HONESTY).
- **Plumbing**: add `parameters` to `MysqlRowInput` + a `MysqlParameterRow` interface (`mysql/map.ts`);
  add `SQL_MYSQL_PARAMETERS` to the adapter fetch; build a `routine_name → RawParameter[]` map in
  `buildRoutines` (`mysql/map.ts:473`) and attach.

### 4.4 sqlite — HONEST absence (no change)

SQLite has no stored-procedure/function parameter catalog (and no routine objects at all in the golden
catalog). The adapter leaves `RawObject.parameters` unset → `RoutinePayload.parameters` absent →
`renderParameters` returns `[]` → no PARAMETERS section. Declared absent, never fabricated. Verified: no
code change in `sqlite/*`; a negative assertion pins the honest absence.

### Per-engine reality matrix (mirrors proposal, now with mechanism)

| Field | mssql | pg | mysql | sqlite |
|---|---|---|---|---|
| shape | separate `sys.parameters` query, join by `object_id` | extend `pg_proc` row | separate `PARAMETERS` query, join by `SPECIFIC_NAME` | — |
| name | `sys.parameters.name` (keeps `@`) | `proargnames[i]` | `PARAMETER_NAME` | — |
| dataType | `sys.types.name` | `regtype[]::text[]` (SQL-decoded) | `DTD_IDENTIFIER` | — |
| direction | `is_output`→in/out (no inout) | modes i/o/b/v; NULL⇒in; t excluded | mode IN/OUT/INOUT; NULL⇒in | — |
| hasDefault | `has_default_value` flag | trailing `pronargdefaults` (partial) | **omitted** (no column) | — |
| ordinal | `parameter_id` | array position | `ORDINAL_POSITION` (0 excluded) | — |
| provenance | catalog `declared` | catalog `declared` | catalog `declared` | **absent, honest** |

## 5. ADR-style Decisions

### D1 — Extraction shape: per-engine natural join (separate vs extended)
**Decision**: mssql + mysql use a SEPARATE parameter query joined by object identity; pg EXTENDS the
existing `pg_proc` routine query. **Rationale**: matches the catalog's physical shape — `sys.parameters`
and `information_schema.PARAMETERS` are one-row-per-parameter tables; `pg_proc` carries arg arrays inline.
Following the shape avoids awkward denormalization and mirrors existing conventions (mssql
`SQL_MSSQL_TRIGGER_EVENTS` is already a separate family). **Rejected**: (a) one universal query per engine
that inlines params — impossible for mssql/mysql without a cross join that breaks FOR-JSON determinism;
(b) JS-side OID→type-name resolution for pg — adds a `pg_type` round-trip and risks non-verbatim type
strings; SQL `regtype` decode is exact and cheaper.

### D2 — RawParameter plumbing: durable contract field, pure payload copy
**Decision**: add `RawParameter` to the durable `RawObject` contract and copy it into
`RoutinePayload.parameters` in `buildPayload`, ordinal-sorted. **Rationale**: `RawObject` is THE
adapter→core boundary (ADR-004); a first-class field (not `extra` passthrough) makes the contract explicit
and type-checked. **Rejected**: stuffing parameters into `RawObject.extra` — untyped, bypasses the
compile-time contract, and inconsistent with how columns/constraints are modeled.

### D3 — Renderer: ONE shared `renderParameters`, wired into both formatters
**Decision**: a single pure `renderParameters(node)` in `present/payload.ts`, called by
`renderFocusPayload` (explore) AND `formatObject` (object), gated at non-brief detail on both.
**Rationale**: the D1/D2 shared-renderer invariant guarantees byte-identical sections across CLI/MCP and
explore/object with no per-surface branch. Grammar mirrors `renderColumns` for visual consistency.
**Grammar (RATIFIED, golden-locked at apply)**: each line is `  <name>  <dataType>` (2-space indent,
double-space gaps), then UPPERCASE bracket markers `[OUT]` / `[INOUT]` / `[DEFAULT]` joined by two
spaces — matching the existing UPPERCASE COLUMNS markers `[PK]` / `[FK→]` / `[NN]` (verified
`present/payload.ts:141-143`; a lowercase `[in]`/`[out]` would be a convention violation). An `in`
parameter renders NO direction marker (the default, exactly as a nullable column shows no `[NN]`).
`[DEFAULT]` is a PRESENCE marker only — unlike COLUMNS' `DEFAULT <value>`, the parameter default VALUE is
out of scope (D-scope), so parameters expose only the flag. The exact header/marker BYTES are golden-locked
at apply (`docs/format-spec.md` §6 token-delta note). **Rejected**: (a) inline per-formatter rendering —
duplicates grammar, invites drift; (b) rendering only in `renderFocusPayload` and assuming object inherits
— FALSE: `formatObject` does not call `renderFocusPayload`, so object would silently omit PARAMETERS (this
is the proposal's one inaccuracy — Tasks MUST add the object-side PARAMETERS block, gated normal+full,
AFTER CONSTRAINTS and BEFORE BODY).

### D4 — Storage: no migration (payload is schema-less JSON)
**Decision**: no DB migration. **Rationale**: `nodes.payload` is opaque `TEXT` JSON; a new key is
transparent to storage. `stableStringify` keeps the serialized payload deterministic. **Rejected**: a
typed parameters table — over-engineering for a payload-only, render-only feature; violates the
"payload is opaque" model.

### D5 — Determinism & honesty
**Decision**: ordinal order everywhere (query `ORDER BY`, normalize sort, render sort); raw type strings
verbatim per engine (no cross-engine normalization); `hasDefault`/`direction` emitted ONLY from real
catalog signals. **Rationale**: ADR-008 + HONESTY. Per-engine goldens pin exact bytes; `decimal(10,2)`
(mysql) vs `numeric` (pg) vs `decimal` (mssql) are all correct for their engine.

### D6 — Ordinal assignment: contiguous 1..N in source order
**Decision**: `ordinal` = 1-based position among EMITTED parameters, in catalog array/row order (after
excluding pg `t`-mode entries and mssql/mysql return rows). **Rationale**: contiguous ordinals match the
column-ordinal convention and render cleanly. **Rejected**: preserving raw catalog position (would leave
gaps after exclusions) — deterministic but visually confusing. (Flagged as a minor open question — see §9.)

## 6. Golden Blast-Radius (deliberate re-bless, L-009)

| Golden family | Change | Re-bless? |
|---|---|---|
| new unit fixtures | mssql `rows/parameters.json` (new); pg `rows/routines.json` (+arg arrays); mysql `rows/parameters.json` (new) | ADD |
| raw-catalog goldens | mssql/pg/mysql `golden-raw-catalog.json` — routine objects gain `parameters` | **re-bless (deliberate)** |
| e2e goldens | mssql/pg/mysql `golden-e2e.json` — routine node payloads gain `parameters` | **re-bless (deliberate)** |
| mssql dump golden | `dumps/mssql-dump-golden.json` — new `parameters` family | **re-bless (deliberate)** |
| present goldens | NEW `parameter-render` family per engine (routine focus, explore + object) | ADD |
| sqlite golden-raw-catalog | ZERO routines → structurally unchanged | **NO drift (assert)** |
| MCP explore goldens | sqlite-TABLE-focused substrate → no routine params in scope | **NO drift (verify)** |

Blast radius is bounded to mssql/pg/mysql raw-catalog + e2e + the new dump/present families. sqlite and
MCP explore goldens MUST show zero drift — a re-bless there is a red flag, not intent.

## 7. TDD Seams

- **types**: `RoutineParameter`/`RawParameter` compile-time shape (tsc) + a payload round-trip unit.
- **normalize**: `buildPayload` unit — `RawObject.parameters` → `payload.parameters`, ordinal-sorted,
  absent when unset, empty-array elided.
- **renderer**: `renderParameters` unit — grammar (in/out/inout markers, `[DEFAULT]`), empty → `[]`,
  ordinal sort; plus explore + object integration goldens.
- **per-engine map**: mssql `sys.parameters`→`RawParameter` (is_output, has_default, id>0 filter);
  pg NULL-modes⇒all-IN + `b`⇒inout + `t`-exclusion + trailing-defaults; mysql NULL-mode⇒in +
  ordinal-0 exclusion + hasDefault omitted.
- **honesty negatives**: sqlite routine focus renders NO PARAMETERS section (declared absent).
- **mssql FOR JSON**: extend `queries-for-json.integration.test.ts` + `dump-emitter.test.ts` for the
  new family (top-level ORDER BY + FOR JSON PATH coexistence).

## 8. Batch Plan (2 batches — mirrors proposal)

- **Batch A (core, engine-agnostic)**: `RoutineParameter`/`RawParameter` types → normalize mapping →
  `renderParameters` + explore/object wiring → unit + render goldens. No live DB; fully golden-testable.
- **Batch B (per-engine extraction + deliberate re-bless)**: mssql `SQL_MSSQL_PARAMETERS` (+ adapter
  fetch + dump-emitter family), pg extended `SQL_PG_ROUTINES` decode, mysql `SQL_MYSQL_PARAMETERS`;
  per-engine map units + raw-catalog/e2e/dump re-bless; sqlite honest-absence assertion.

## 9. Risks & Open Questions (for sdd-tasks)

- **object.ts wiring** (proposal understatement): `formatObject` needs a PARAMETERS section block — small
  but real. Tasks must include it, else `object`/MCP-object silently omit parameters while explore shows
  them.
- **pg SQL arg-type decode idiom**: `oidvector::oid[]` is not directly castable in all pg versions; the
  `string_to_array(proargtypes::text,' ')::oid[]` fallback is the safe idiom. Exact SQL needs verification
  against the target pg version at apply time (cannot run pg here).
- **pg `proargmodes` `"char"[]` parsing**: MUST cast to `text[]` in SQL for reliable node-postgres array
  parsing — flagged in §4.2.
- **pg `t`-mode / VARIADIC handling**: decision is exclude `t`, map `v`→`in`. Confirm the DOG-1 pg
  fixtures contain no RETURNS TABLE routine that would exercise `t` (else add a fixture).
- **Ordinal contiguity (D6)**: contiguous 1..N vs raw catalog position — both deterministic; tasks should
  confirm the chosen convention against the render goldens.
- **hasDefault over-claim**: emit ONLY from `has_default_value` (mssql) / trailing `pronargdefaults` (pg);
  mysql omits entirely. Golden must pin a defaulted-param routine per capable engine to lock the flag.
- **Fixture parameter data**: mssql/mysql need NEW parameter fixtures; pg needs arg arrays added to
  existing routine rows — the REAL DOG-1 signatures (e.g. mssql `sp_place_order(@order_id int, ...)`,
  mysql `place_order(p_customer, p_product_id, p_qty)`) must be transcribed accurately; leak-scan
  neutrality inherited (commerce/order names, no payroll/finance flavor).

## 10. Spec Coherence (delta inventory & no-delta rationale)

Reconciled against the canonical `openspec/specs/` on branch `post-v1`. Final delta inventory and the
deliberate no-delta decisions:

**Deltas written (WHAT must be true after the change):**
- `graph-model` — `RoutinePayload.parameters` + `RoutineParameter`, `RawObject.parameters` +
  `RawParameter`. The unifying `dataType` principle: composed IDENTICALLY to the SAME engine's COLUMN
  `dataType` → mssql BARE `tp.name`; mysql FULL `DTD_IDENTIFIER`/`COLUMN_TYPE`; pg canonical `regtype`
  name (typmod-less for function args, §4.2).
- `schema-extraction` (THIN, ADDED here) — the engine-agnostic OPTIONAL `RawObject.parameters?` adapter
  obligation, honest-absence, and byte-identical guarantee for non-participating engines. Mirrors the
  existing "Optional RawField model path" precedent (the canonical schema-extraction spec IS the home of
  optional-additive `RawObject` field contracts). Fulfills the proposal's promised
  "schema-extraction: engine-agnostic parameters contract" capability, which had no delta on disk.
- `mssql-extraction`, `pg-extraction`, `mysql-extraction`, `sqlite-extraction` — per-engine sourcing +
  honesty (BARE vs FULL vs typmod-less canonical; pg `v`→in / `t`-exclusion; sqlite absence).
- `mcp-server` — the ONE shared `renderParameters` PARAMETERS section across explore AND object, CLI AND
  MCP; detail-gated normal+full; UPPERCASE markers; brief-absence.

**No delta (deliberate) — rationale recorded here (DOG-1 precedent):**
- `graph-normalization` — NO delta. The canonical graph-normalization spec enumerates NODE/EDGE
  production and graph SHAPE (references, depends_on, reads/writes, `calls`, fires_on, stubs, level
  honoring, inference). It does NOT enumerate routine-PAYLOAD field assembly — `signature`/`returns`/
  `body` were never normalization requirements, and DOG-2's `parameters` is the same kind of pure,
  ordinal-sorted payload COPY that adds NO node, NO edge, NO graph-shape change. The determinism the copy
  relies on is already covered by the existing "Boundary and determinism" requirement (ADR-008) and is
  pinned by the re-blessed goldens. (DOG-1 amended graph-normalization ONLY because it added `calls`
  EDGES — a genuine shape change; DOG-2 has none, so it introduces no new normalization REQUIREMENT.)
- `benchmark` — NO delta. The benchmark capability is the WITH/WITHOUT evaluation METHODOLOGY (question
  set, protocols, blind scorer, token boundary, reporting) — it changes NOTHING in `src/**`. DOG-2 alters
  NO command, question, scorer, or token boundary → zero protocol impact. The "parameter-render golden
  family" named in the proposal is a PRESENT test-golden family under `test/golden/present`, NOT a
  benchmark question family; the proposal's `benchmark` capability line is a naming conflation, corrected
  here.
- `cli-config` — NO separate delta. The PARAMETERS section is added to the ONE shared `present/payload.ts`
  helper backing BOTH `formatExplore` and `formatObject`; the existing cli-config explore requirement
  references that same helper, so the section bytes have a SINGLE source and the `mcp-server` delta covers
  both surfaces (CLI `explore`/`object` + MCP `dbgraph_explore`/`dbgraph_object`).
