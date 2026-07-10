# Proposal: Deep Object Graph — the INTERNALS of programmable objects (EPIC)

> **PLANNING — this is an EPIC scoping proposal, not a single shippable change.** It defines the
> problem, the per-engine reality, and a decomposition into **four independently shippable child
> changes** (DOG-1..DOG-4). Each child gets its OWN proposal → spec → design → tasks cycle. This
> document is the parent contract: it fixes scope, ordering, the reality matrix, and the honesty
> discipline every child inherits. It creates NO code and NO spec deltas of its own.

## Intent

Today dbgraph models WHERE a routine/trigger/view reaches (object-grain `reads_from`/`writes_to`/
`depends_on`/`fires_on`, `confidence: parsed`) but not its INTERNALS: what it CALLS, its PARAMETERS,
and the column-level data flow through it. The user asked precisely for "lo INTERNO de cada uno: qué
tablas toca, con qué se relaciona, qué otro SP llama, de qué depende, parámetros, qué ejecuta".

Two of these are already shipped (touches/relates = `reads_from`/`writes_to`; dynamic-SQL blindness is
surfaced). The GAPS, verified in code, are: (1) **no `calls` edge** — a proc invoking another proc is
NOT modeled and is in fact MIS-modeled (see Risks); (2) **no parameters** — `RoutinePayload` has no
parameter field and no engine queries `sys.parameters`/`pg_proc`/`information_schema.PARAMETERS`;
(3) **no column-level lineage** — `EdgeAttrs.srcColumn/dstColumn` exist but routine/view body edges are
object-grain only. This is our differentiation: competitors (SchemaSpy, graphify, dbdiagram) draw FK
diagrams; NONE model a routine call graph with per-edge **confidence tiers** and per-engine **honesty**
(parsed vs catalog-declared vs impossible). Now is the moment: the shared tokenizer, `RawDependency`
plumbing, and confidence model already exist — we extend them, we don't invent them.

## Scope

### In Scope (the EPIC — realized by the child changes below)
- **DOG-1 `calls` edges** — routine→routine invocation (`EXEC`/`CALL`/`SELECT fn()`) as a first-class
  edge; catalog-sourced where the engine exposes it, tokenizer-parsed elsewhere; traversed by impact.
- **DOG-2 routine parameters** — name/type/direction/default as `RoutinePayload.parameters`, rendered
  in explore/object; per-engine catalog sources; pure payload, no graph-shape change.
- **DOG-3 column-level lineage (views first)** — view output column → source table.column edges at
  column grain, feeding impact precision; per-engine catalog-or-degrade.
- **DOG-4 dynamic-SQL honesty hardening** — promote the existing `hasDynamicSql` caveat from `full`-only
  to `normal` detail and mark per-node confidence degradation in `affected` output.
- The **per-engine reality matrix** (below) and the **confidence/honesty discipline** every child obeys.

### Out of Scope
- **Runtime/execution-plan analysis** ("qué ejecuta" at runtime) — we model STATIC structure only
  (ADR-007 conservative tokenizer, no grammar engine); no query planner, no cost, no cardinality.
- **Cursors, temp tables, table variables, `@variable` data-flow, control-flow graphs** inside bodies.
- **Function RETURN-type table shape** beyond the scalar `returns` string already captured.
- **Column-level lineage through multi-hop ROUTINE bodies** (DOG-3 does VIEWS first; routine-body
  column lineage is a deferred DOG-3b, not committed here).
- **Turning on structural inference** for these edges — `calls`/lineage are `parsed`/`declared`, never
  `inferred`; the US-008 inference engine is untouched.
- Any single monolithic implementation — the epic MUST ship as the ordered children below.

## Capabilities

> Contract for sdd-spec. This EPIC authors NO deltas directly — each child change authors its own.
> Listed here so the decomposition's spec surface is explicit. Names are verbatim from `openspec/specs/`.

### New Capabilities
- None at the epic level. (DOG-1 adds the `calls` edge kind to the EXISTING `graph-model` taxonomy; no
  new capability spec directory is created.)

### Modified Capabilities (which child touches which — deltas authored per child)
- `graph-model` — DOG-1 (`calls` edge kind + confidence rule); DOG-2 (`RoutinePayload.parameters`,
  `RawObject.parameters`, target-kind on `RawDependency`); DOG-3 (column-grain edge attrs semantics).
- `graph-normalization` — DOG-1 (preserve referenced object KIND → emit `calls`, not a mis-typed table
  stub; deterministic ordering); DOG-3 (column-grain edge construction).
- `graph-query` — DOG-1 (impact/affected traverse `calls`); DOG-3 (lineage sharpens impact); DOG-4
  (per-node dynamic-SQL confidence marking).
- `schema-extraction` — DOG-1/DOG-2/DOG-3 (engine-agnostic contract for referenced-kind, parameters,
  column deps).
- `mssql-extraction`, `pg-extraction`, `mysql-extraction`, `sqlite-extraction` — per-engine catalog
  sourcing per the reality matrix (each child touches the engines it can honestly serve).
- `mcp-server` / `cli-config` — DOG-2/DOG-4 (explore/object render parameters + caveats).
- `benchmark` — each child adds its golden family (see matrix).

## Approach

**Extend, don't reinvent.** Every child reuses three existing assets: the shared tokenizer
(`_shared/tokenizer-core.ts`), the `RawDependency` contract, and the `declared|parsed|inferred`
confidence model. The unifying architectural move is in **DOG-1**: today `mssql/map.ts` DROPS the
referenced object type when building deps (`deps.map(d => ({ref_schema_name, ref_object_name}))`) and
`buildDependencyEdges` defaults `targetKind = dep.target.kind ?? 'table'`. So a proc→proc reference is
currently emitted as a `reads_from` edge to a NON-EXISTENT table, creating a spurious `missing` stub.
DOG-1 fixes this by **preserving `RawDependency.target.kind`** end-to-end and branching on it: target is
routine → `calls`; target is table/column → existing read/write logic. That same kind-preservation
plumbing is the foundation DOG-3 needs, which is why DOG-1 leads.

**Honesty is non-negotiable (project HONESTY standard).** Each edge/payload declares its provenance:
CATALOG-declared (e.g. mssql `sys.sql_expression_dependencies` already resolves referenced procs →
`confidence: declared`) vs BODY-parsed (tokenizer `EXEC`/`CALL`/`SELECT fn()` → `confidence: parsed`)
vs IMPOSSIBLE (sqlite has no parameter catalog → the payload declares the capability absent, it does not
fabricate). Per-engine capability differences are stated plainly; parsed-vs-catalog confidence is never
blurred (L-009 exact edge sets — never existence-only assertions).

### Per-engine reality matrix (verified against catalog queries)

| Capability | mssql | pg | mysql | sqlite | mongodb |
|---|---|---|---|---|---|
| **DOG-1 calls** | `sys.sql_expression_dependencies` resolves referenced procs → **catalog/declared** (kind currently dropped) | tokenizer `SELECT fn()`/`CALL` over `pg_get_functiondef` → **parsed** | tokenizer `CALL`/`fn()` over body → **parsed** | tokenizer over body → **parsed** (limited routine surface) | N/A (no routines) |
| **DOG-2 parameters** | `sys.parameters` → **catalog** | `pg_proc` (proargnames/types/modes) → **catalog** | `information_schema.PARAMETERS` → **catalog** | **impossible** — no param catalog (declared absent, honest) | N/A |
| **DOG-3 column lineage (views)** | `sys.sql_dependencies.referenced_minor_id` (column) → **catalog** | `pg_depend`/`pg_rewrite` partial → **parse-assisted/degrade** | body-parse or **degrade** | body-parse or **degrade** | N/A |
| **DOG-4 dynamic-SQL** | already populated + surfaced | already | already | already | N/A |

## Epic Decomposition (ordered, each independently shippable)

| # | Child change | Size | Depends on | Delivers | Benchmark family |
|---|---|---|---|---|---|
| 1 | **DOG-1 `calls` edges** | M | none (fixes latent bug) | proc→proc call graph; impact traverses calls; kind-preservation plumbing | call-graph traversal / affected-through-calls goldens |
| 2 | **DOG-2 routine parameters** | S | none (parallel with DOG-1) | params in explore/object; pure payload, zero graph-shape risk | parameter-render goldens per engine |
| 3 | **DOG-3 column lineage (views)** | L | DOG-1 (reuses kind/column plumbing) | view col → source col edges; sharper impact | column-lineage precision goldens |
| 4 | **DOG-4 dynamic-SQL honesty** | XS | none (may fold into DOG-1) | caveat at `normal` detail; per-node confidence in `affected` | dynamic-SQL honesty goldens |

**Recommended priority order:** **DOG-1 → (DOG-2 in parallel) → DOG-3 → DOG-4.** Rationale: DOG-1 is
highest differentiation, fixes a live correctness bug, and lays the kind-preservation foundation DOG-3
depends on. DOG-2 is pure-additive payload (no goldens on existing edges shift) so it runs in PARALLEL
with DOG-1 with near-zero collision. DOG-3 is the hardest and benefits from DOG-1's plumbing. DOG-4 is
XS polish and MAY be folded into DOG-1's PR if convenient.

## Epic Status (as of 2026-07-10) — ✅ COMPLETE

| Child | Status | Evidence / Archive ref |
|---|---|---|
| **DOG-1 `calls` edges** | ✅ DONE — ARCHIVED 2026-07-07 | `openspec/changes/archive/2026-07-07-dog1-calls-edges/`; `calls` edge kind + provenance live in canonical `graph-model`, `graph-normalization`, `graph-query` and per-engine extraction specs |
| **DOG-2 routine parameters** | ✅ DONE — ARCHIVED 2026-07-07 | `openspec/changes/archive/2026-07-07-dog2-routine-parameters/`; `RoutinePayload.parameters` + per-engine parameter sourcing live in canonical `graph-model`, `schema-extraction`, `mcp-server`, mssql/pg/mysql/sqlite specs |
| **DOG-3 column lineage (views)** | ✅ DONE — ARCHIVED 2026-07-10 | `openspec/changes/archive/2026-07-10-dog3-column-lineage/`; 9 column-lineage deltas merged into canonical specs; verify verdict ARCHIVE-READY (0 CRITICAL); shipped over `post-v1` (HEAD `287be4a`) |
| **DOG-4 dynamic-SQL honesty** | ✅ DONE — ARCHIVED 2026-07-10 | `openspec/changes/archive/2026-07-10-dog4-dynamic-sql/`; caveat promoted to `normal`+`full` in explore/object + per-node degradation in precheck/affected/impact; 2 deltas (`mcp-server`, `graph-query`) merged into canonical specs; verify verdict ARCHIVE-READY (0 CRITICAL, 1 WARNING); shipped over `post-v1` (HEAD `fdf2dc2`) |

## Epic Closure — deep-object-graph COMPLETE (2026-07-10)

ALL FOUR children have shipped and archived. The epic is CLOSED; this proposal is archived alongside its
last child (DOG-4).

| # | Child | Shipped | Archive folder |
|---|-------|---------|----------------|
| 1 | DOG-1 calls-edges | 2026-07-07 | `2026-07-07-dog1-calls-edges` |
| 2 | DOG-2 routine-parameters | 2026-07-07 | `2026-07-07-dog2-routine-parameters` |
| 3 | DOG-3 column-lineage | 2026-07-10 | `2026-07-10-dog3-column-lineage` |
| 4 | DOG-4 dynamic-sql | 2026-07-10 | `2026-07-10-dog4-dynamic-sql` |

The INTERNALS of programmable objects — call graph (DOG-1), parameters (DOG-2), view column lineage
(DOG-3), and dynamic-SQL honesty (DOG-4) — are now modeled, surfaced, and specified in the canonical
specs, each with per-edge/per-payload provenance and per-engine honesty (parsed vs catalog-declared vs
absent). No child touched the FK/reference/inference paths or the storage schema beyond the listed
additive extensions. The benchmark column-lineage family (DOG-3) is INSTANTIABLE; the labeled benchmark
RUN remains DEFERRED to its own future change (standing precedent), and is NOT a blocker for this epic's
closure. Follow-ups tracked in the DOG-4 archive report (W1 CLI `affected --json` e2e; S2 impact
pre-cache line) are non-blocking and belong to any future hardening change.

## Affected Areas

| Area | Impact | Child |
|------|--------|-------|
| `src/core/model/edge.ts` | Modified | DOG-1 (add `calls` to `EdgeKind`/`EDGE_KINDS`) |
| `src/core/model/node.ts` (`RoutinePayload`) | Modified | DOG-2 (`parameters`) |
| `src/core/model/catalog.ts` (`RawObject`/`RawDependency`) | Modified | DOG-1 (`target.kind` preserved), DOG-2 (`parameters`) |
| `src/core/normalize/reference-resolver.ts` | Modified | DOG-1 (branch on target kind), DOG-3 (column grain) |
| `src/core/query/impact.ts` (`IMPACT_EDGE_KINDS`) | Modified | DOG-1 (traverse `calls`) |
| `src/core/present/explore.ts` / `present/payload.ts` | Modified | DOG-2 (params), DOG-4 (caveat at `normal`) |
| `src/adapters/engines/{mssql,pg,mysql,sqlite}/{queries,map,tokenizer}.ts` | Modified | per matrix |
| `openspec/specs/{graph-model,graph-normalization,graph-query,schema-extraction,*-extraction}/` | Modified (deltas per child) | all |
| `docs/stories/` (US-007 family) | Modified | refine per child |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Latent bug surfaced by DOG-1**: proc→proc dep currently emits `reads_from`→non-existent table = spurious `missing` stub | High (exists today) | DOG-1 preserves `target.kind`; a regression golden asserts a proc→proc fixture yields exactly one `calls` edge and ZERO table stub |
| Adding `calls` to `IMPACT_EDGE_KINDS` shifts existing impact goldens | High | Expected & intentional; re-pin every affected golden in DOG-1, review each diff; L-009 exact sets |
| Epic shipped as one monolith → unreviewable, correlated golden churn | Med | Enforce the 4-child decomposition; each child owns its goldens and ships independently |
| Column lineage over-claims precision where the catalog can't source it (DOG-3) | Med | Honesty: emit column-grain edges ONLY from catalog-sourced columns; otherwise DEGRADE to object grain and mark provenance — never fabricate a column pair |
| Parameter direction/type semantics differ per engine (INOUT, table-valued, defaults) | Med | DOG-2 stores raw engine type string + normalized direction enum; per-engine golden pins exact rendering; sqlite declares absent |
| Tokenizer false positives for `calls` (a table named like a function, `SELECT count()` builtins) | Med | Resolve against ACTUAL routine nodes only (like inference resolves targets); builtin allowlist; ADR-007 conservative — no target routine → no edge |
| Confidence blurring (catalog `calls` vs parsed `calls` treated alike) | Low | Each edge carries `declared` (catalog) or `parsed` (body); goldens assert the exact confidence per engine |

## Rollback Plan

The epic is a set of purely additive, independently revertible children. Per child: DOG-1 revert =
remove `calls` from `EdgeKind`/`IMPACT_EDGE_KINDS`, restore the `targetKind ?? 'table'` default, drop
the tokenizer call patterns and re-pin goldens. DOG-2 revert = delete `RoutinePayload.parameters` +
the per-engine parameter queries (optional field, no consumer breaks). DOG-3 revert = drop column-grain
edge emission (object-grain edges unchanged). DOG-4 revert = restore `full`-only caveat. No child
touches the FK/reference/inference paths, storage schema, or the query port surface beyond the listed
additions, so reverting any one child leaves the other three and all shipped engines green.

## Dependencies

- Builds on US-007 (routine/trigger/view extraction), the shared tokenizer (US-028a), the
  `RawDependency`/confidence model, and the existing `hasDynamicSql` surfacing — all shipped.
- **DOG-3 depends on DOG-1** (kind/column-preservation plumbing). DOG-2 and DOG-4 depend on nothing.
- ZERO new npm dependencies (catalog queries + existing tokenizer only). ADR-004/007/008 intact.
- No storage-schema migration required for DOG-1/DOG-2/DOG-4; DOG-3 reuses existing `srcColumn/dstColumn`
  edge attrs (already persisted) — verify during DOG-3 design.

## Success Criteria (epic-level; each child pins its own detailed acceptance)

- [x] The four child changes exist as separate SDD changes with their own proposal→spec→design→tasks.
- [x] **DOG-1**: a proc calling a proc yields exactly one `calls` edge with the engine's correct
      confidence (mssql `declared`, pg/mysql/sqlite `parsed`) and produces NO spurious table stub; impact
      traverses `calls` (affected of a leaf table reaches procs that reach it through call chains).
- [x] **DOG-2**: explore/object renders each routine's parameters (name/type/direction/default) for
      mssql/pg/mysql; sqlite HONESTLY reports parameters unavailable — never fabricated.
- [x] **DOG-3**: at least one view's output columns map to source `table.column` via column-grain edges
      where the catalog sources them; where it cannot, the edge DEGRADES to object grain with provenance.
- [x] **DOG-4**: the dynamic-SQL caveat is visible at `normal` detail and `affected` marks the affected
      nodes' confidence as degraded.
- [x] Every new edge/payload declares provenance; per-engine capability differences are stated plainly
      (HONESTY); all assertions are exact-set (L-009), never existence-only; `tsc`/lint/test green.
