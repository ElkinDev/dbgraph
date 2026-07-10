# Proposal: DOG-3 — Column-Level Lineage (views first)

> Third child of the **deep-object-graph** epic (`openspec/changes/deep-object-graph/proposal.md`).
> Size **L**, depends on **DOG-1** (kind-preservation seam, ARCHIVED/shipped). The epic's hardest
> child; ordered after DOG-1, parallel-safe with DOG-2. Ships in **3 apply batches + a deferred
> benchmark run**.

## Intent

dbgraph knows WHICH tables a view reads (`depends_on` at OBJECT grain) but not WHICH COLUMNS. Dropping
`orders.customer_id` today marks EVERY view over `orders` as affected — even views that never read that
column. That is table-grain imprecision, and it is traced in code:

1. `buildDependencyEdges` (`reference-resolver.ts:317`) emits every view `depends_on` edge with
   `attrs: {}` — column grain is structurally absent.
2. `RawDependency.target` (`catalog.ts:103`) is `{ schema, name, kind? }` — NO column field; the
   adapter→core contract cannot carry a source column even if the engine had one.
3. Only FK `references` edges populate `attrs.srcColumn/dstColumn` (`reference-resolver.ts:227`), and
   `EdgeAttrs` (`edge.ts:44`) already reserves `srcColumn/dstColumn` "for reads_from/writes_to at column
   grain" — the DESIGN anticipated this; it was never wired.

**Verified plumbing (no surprises):** edge `attrs` PERSIST — `sqlite-graph-store.ts:337` serializes
`JSON.stringify(edge.attrs)` and round-trips via `JSON.parse` (`:97`); so column attrs need **NO storage
migration** (epic's open "verify" → CONFIRMED). DOG-1 preserved `RawDependency.target.kind` end-to-end;
DOG-3 reuses that same seam to carry a source COLUMN.

**The honesty crux (decides scope).** NO SQL engine exposes cheap OUTPUT-column → SOURCE-column MAPPING.
What the catalogs give is a column-grain SOURCE SET — "this view CONSUMES these `table.column`s" — which
is exactly what sharpens impact. DOG-3 delivers the honest source-column SET, NOT a fabricated output↔source
map (that needs the SELECT-list grammar parse ADR-007 forbids — deferred). Per-engine reality is
catalog-or-DEGRADE, verified against `capabilities.ts`/`queries.ts` below.

Success = where the catalog sources it, a view carries column-grain `depends_on` edges to the source
columns it reads; dropping a column surfaces ONLY the views reading it; where the catalog cannot,
the edge DEGRADES to object grain with provenance — NEVER a fabricated column pair (ADR-006/007).

## Scope

### In Scope
- **Contract extension** — add an OPTIONAL source-column signal to `RawDependency` (e.g.
  `columns?: readonly string[]`, source-side only). Non-column deps leave it unset → existing object-grain
  behaviour byte-identical.
- **Shared normalize seam** — `buildDependencyEdges` emits, PER sourced column, a column-grain
  `depends_on` edge (view → source column, carried in `attrs`), PLUS the existing object-grain edge
  retained as the aggregate — mirroring the FK per-column + aggregate pattern (`buildFKEdges`).
  Discriminated via `edgeId` (like `references`). ADR-008 deterministic ordering.
- **mssql (catalog / declared)** — extend `SQL_MSSQL_DEPENDENCIES` with `referenced_minor_id` → the
  source-column SET per view dependency; map plumbs it → column-grain `depends_on`.
- **pg (catalog / declared)** — NEW query over `information_schema.view_column_usage` → per-view source
  `(table, column)` set; map builds column-grain deps. Honest caveat: it only surfaces sources the view
  owner also owns → uncovered sources DEGRADE to object grain.
- **mysql + sqlite (DEGRADE, honest)** — no view-column catalog exists (verified); object-grain
  `depends_on` stays, marked provenance-degraded. NEVER body-parsed into a column pair (ADR-007).
- **Impact precision** — `getImpact`/`affected` become column-aware: an inbound query on a COLUMN node
  surfaces exactly the views reading it; table-grain impact unchanged for degraded engines.
- **Render** — `explore`/`object` (CLI + MCP) show a view's source columns, budget-gated per detail
  level (format-spec honesty; brief stays object-grain).
- **L-009 exact-set goldens** — assert the EXACT `{view → source table.column}` set (positives AND
  negatives: a column a view does NOT read yields NO edge), per engine, with confidence tier pinned.

### Out of Scope (deferred, justified)
- **True OUTPUT-column ↔ SOURCE-column mapping** — needs SELECT-list grammar parsing (ADR-007 forbids);
  we ship the source-column SET only.
- **Routine-body column lineage** (T-SQL/PLpgSQL body column refs) — the epic's deferred **DOG-3b**;
  grammar-scale, NOT committed here.
- **Expression / computed-column lineage** (which sources feed a derived output column) — same parse
  barrier; out.
- **Cross-view transitive column closure** — ALREADY FREE via `getImpact`'s depth BFS over the emitted
  edges; no new extraction, not a deliverable.
- **Benchmark PROTOCOL change** (new column-lineage question family, N bump, re-run) — DEFERRED to its
  OWN labeled run (standing precedent: sqlite-view-deps, benchmark-harness-hardening). This change makes
  the family INSTANTIABLE; running it re-freezes the question set and belongs in a separate run.
- **Structural inference of column lineage** — `declared`/degraded only; US-008 inference untouched.
- **mongodb** — no views; capability declared absent, not fabricated.

## Capabilities

> Contract for sdd-spec. Names verbatim from `openspec/specs/`.

### New Capabilities
- None. Extends the EXISTING `graph-model` edge-attrs (`srcColumn/dstColumn`) and the shared normalizer;
  no new capability directory.

### Modified Capabilities
- `graph-model`: `EdgeAttrs.srcColumn/dstColumn` become LOAD-BEARING for `depends_on`; document the
  column-grain + aggregate edge pair and the per-engine confidence/degradation rule.
- `graph-normalization`: `buildDependencyEdges` emits per-source-column `depends_on` + aggregate;
  deterministic ordering; degrade-to-object when no column sourced.
- `graph-query`: `impact`/`affected` are column-aware — dropping a column surfaces only the reading views.
- `schema-extraction`: engine-agnostic contract for the source-column set on `RawDependency`.
- `mssql-extraction`: `sys.sql_expression_dependencies.referenced_minor_id` → declared column set.
- `pg-extraction`: `information_schema.view_column_usage` → declared column set (owner-visibility caveat).
- `mysql-extraction`, `sqlite-extraction`: DEGRADE to object grain, provenance-marked (no catalog).
- `mcp-server`, `cli-config`: `explore`/`object` render source columns, budget-gated.
- `benchmark`: column-lineage family becomes instantiable (the run itself deferred).

## Approach

**Extend, don't reinvent** (epic invariant). ONE seam: carry a source-column set on `RawDependency` and
branch in `buildDependencyEdges` — every engine is an adapter feeding it. Column attrs already PERSIST
(verified) and column NODES already exist (`normalize.ts` `has_column`), so both modeling options are
available with ZERO storage work.

**Modeling decision — present both, design settles (grain-explosion honesty).** The corporate graph has
~14k columns; a 50-column view reading 20 sources yields 20 column edges. Two candidates:
- **(A) Attrs on table edge** — view → source TABLE `depends_on`, `attrs.dstColumn = source column`.
  Matches the EdgeAttrs design intent + FK per-column+aggregate precedent; impact must filter by
  `attrs.dstColumn`.
- **(B) Column-node target** — view → source COLUMN node `depends_on`. Impact-NATURAL (inbound edges to
  the column node ARE the answer), reuses existing column nodes; but diverges from EdgeAttrs intent and
  can enlarge impact chains. **Recommend (A)** (consistent with the codebase's stated model + FK
  precedent), with (B) as the documented alternative — design phase resolves against the edge-count budget.

**Provenance is per-engine and NEVER blurred (HONESTY / L-009).** mssql/pg column edges are
CATALOG-declared (`confidence: 'declared'`); mysql/sqlite carry NO column edge and their object-grain
`depends_on` is marked DEGRADED. Goldens pin the exact tier + exact column set per engine. We never
synthesize a column pair the catalog can't source (ADR-006/007).

### Per-engine reality matrix (verified against `capabilities.ts` + `queries.ts`)

| Engine | Column source | Verdict |
|---|---|---|
| **mssql** | `sys.sql_expression_dependencies.referenced_minor_id` (source-column set; query already runs, add the column) | **catalog / declared** |
| **pg** | `information_schema.view_column_usage` (NEW query; today `supportsDependencyHints:false`, body-only) | **catalog / declared** (owner-visibility caveat → degrade uncovered) |
| **mysql** | none — no `VIEW_COLUMN_USAGE`/dependency catalog (verified) | **DEGRADE to object grain** |
| **sqlite** | none — no dependency catalog | **DEGRADE to object grain** |
| **mongodb** | no views | **N/A** |

### Apply batches (Size L → 3 core + deferred benchmark)
- **A) Model + shared seam + mssql (declared):** extend `RawDependency`; `buildDependencyEdges`
  column-grain + aggregate emission; `EdgeAttrs` wiring; mssql `referenced_minor_id` + map plumb;
  fixtures + L-009 declared goldens; deliberate impact re-bless.
- **B) pg (declared):** `information_schema.view_column_usage` query + map; owner-visibility degrade;
  pg fixtures + L-009 goldens; capability note corrected (view-column catalog present).
- **C) Impact precision + render + mysql/sqlite degrade:** column-aware `getImpact`/`affected`;
  `explore`/`object` render (CLI+MCP, budget-gated); mysql/sqlite provenance-degraded markers;
  affected/precheck integration; goldens.
- **(Deferred) Benchmark:** make the column-lineage family instantiable; the labeled RUN ships separately.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/model/catalog.ts` | Modified | `RawDependency` gains optional source-column signal |
| `src/core/model/edge.ts` | Verify | `EdgeAttrs.srcColumn/dstColumn` become load-bearing for `depends_on` (documented) |
| `src/core/normalize/reference-resolver.ts` | Modified | `buildDependencyEdges` per-column + aggregate; degrade path |
| `src/core/query/impact.ts` | Modified | column-aware inbound traversal (drop-column precision) |
| `src/adapters/engines/mssql/queries.ts` + `map.ts` | Modified | `referenced_minor_id` → column set |
| `src/adapters/engines/pg/queries.ts` + `map.ts` + `capabilities.ts` | Modified | `view_column_usage` query; owner-visibility degrade; capability note |
| `src/adapters/engines/{mysql,sqlite}/map.ts` | Modified | mark object-grain deps provenance-degraded (no catalog) |
| `src/core/present/*` (`explore.ts`, `object.ts`, payload) | Modified | render source columns, budget-gated |
| `test/fixtures/{mssql,pg,mysql,sqlite}/torture.sql` + goldens | New/Modified | column-lineage fixtures; L-009 exact-set; deliberate impact re-bless |
| `openspec/specs/{graph-model,graph-normalization,graph-query,schema-extraction,mssql-extraction,pg-extraction,mysql-extraction,sqlite-extraction,mcp-server,cli-config,benchmark}/` | Modified | deltas per Capabilities |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-claiming: source-column SET presented as OUTPUT↔source mapping | Med | Name edges "column consumed"; render never asserts an output col; scope frozen to source set; L-009 pins exact set |
| Grain explosion (14k cols; a wide view) inflates edges/render | Med | Aggregate object edge + per-column edges (FK precedent); budget-gate render; measure edge count in design |
| pg `view_column_usage` owner-visibility gaps under-report sources | Med | Honest caveat; uncovered sources DEGRADE to object grain; L-009 pins the exact OBSERVABLE set, not a guessed full set |
| mysql/sqlite tempt a body-parse to "fill the gap" → fabrication | Med | ADR-006/007: DEGRADE only; NO column pair the catalog can't source; provenance flag; negative goldens |
| Column-grain edges shift existing impact/affected goldens | High (by design) | Deliberate re-bless; L-009 exact sets; review each diff |
| `RawDependency` change ripples every engine | Low-Med | Optional field; unset = byte-identical object-grain path for all non-column deps |
| Modeling choice (attrs vs column-node) churns twice if flipped mid-flight | Med | Decide in design BEFORE batch A; recommend (A); one seam either way |
| Storage rejects column attrs | Low | None expected — attrs persist verbatim (verified `:337`); no schema/CHECK on edge kind (reuses `depends_on`) |

## Rollback Plan

Purely additive, revertible per batch. Revert by: restoring `buildDependencyEdges` to `attrs: {}`
object-grain emission; dropping the `RawDependency` source-column field; reverting mssql
`referenced_minor_id` and the pg `view_column_usage` query + map wiring; removing the mysql/sqlite
degrade markers; restoring `getImpact` to table-grain; reverting the present-layer column render;
`git revert` of the golden commit to restore byte-pins; removing the fixtures. No storage migration to
undo (attrs already persisted). No FK/reference/inference path or query-port surface touched beyond the
listed additions — reverting DOG-3 leaves DOG-1/DOG-2/DOG-4 and every shipped engine green; target DB
stays strictly read-only (ADR-004).

## Dependencies

- **Depends on DOG-1** (kind/column-preservation seam in `buildDependencyEdges`) — ARCHIVED/shipped.
- Reuses `EdgeAttrs.srcColumn/dstColumn`, existing column NODES (`has_column`), `edgeId` discriminator,
  and the FK per-column+aggregate precedent — ZERO new npm packages (ADR-004/007/008 intact).
- View bodies + `sys.sql_expression_dependencies` already extracted; pg adds ONE `view_column_usage`
  query. NO storage migration (edge `attrs` persist — verified `sqlite-graph-store.ts:337/:97`).

## Success Criteria

- [ ] Where the catalog sources it (mssql/pg), a view emits column-grain `depends_on` edges to the exact
      source `table.column`s it reads — exact set + `confidence: 'declared'` asserted (L-009).
- [ ] Dropping a COLUMN surfaces ONLY the views reading it (not every view over the table) — verified via
      `getImpact`; a view NOT reading the column yields NO edge (negative assertion, L-009).
- [ ] mysql/sqlite DEGRADE to object grain with a provenance marker — NO fabricated column pair; the
      absence is stated plainly (HONESTY), never a body-parsed guess.
- [ ] `explore`/`object` (CLI + MCP) render a view's source columns at the appropriate detail level,
      brief stays object-grain (format-spec budget honesty).
- [ ] The column-lineage benchmark family is INSTANTIABLE (edges exist); the labeled run is deferred.
- [ ] Every column edge declares provenance; per-engine capability differences stated plainly; all
      assertions exact-set (L-009), never existence-only; re-blessed goldens committed as DELIBERATE with
      the column-grain justification; `tsc`/lint/test green; ADR-004 read-only boundary green.
