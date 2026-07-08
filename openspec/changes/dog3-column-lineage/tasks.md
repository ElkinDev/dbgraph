# Tasks: DOG-3 — Column-Level Lineage (views first, `attrs.dstColumns`)

Standing header (every task): **STRICT TDD** — the failing `vitest` test PRECEDES the code (RED→GREEN→refactor);
**L-009 EXACT-set** assertions ALWAYS (`.toStrictEqual`/`.toContainEqual` the FULL edge shape — `src+dst+kind+confidence`
PLUS the `attrs.dstColumns` array — and explicit `not.toContainEqual` NEGATIVES: no column the view does NOT read, no
fabricated pair under degradation, no per-column edge, no column-node target); existence-only `.toBeDefined()`/`.length`
is FORBIDDEN. HEXAGONAL (ADR-004): the SET rides `EdgeAttrs.dstColumns` in `core/model`, is stamped in `core/normalize`,
filtered in `core/query`, rendered in `core/present`; per-engine sourcing in `adapters/engines/*`; `referenced_minor_id`
NEVER crosses into `core`. **Model A — SETTLED (design D1):** the column grain is `attrs.dstColumns` on the ONE existing
view→table `depends_on` edge — ZERO new edges, ZERO column-node targets, edge-count-CONSTANT at 14k columns; the reserved
singular `srcColumn/dstColumn` stay `references`-scoped and UNTOUCHED (FK/`references` goldens byte-identical). SOURCE-COLUMN
SET only — the columns a view READS — NEVER an OUTPUT↔SOURCE mapping (ADR-006/007). Attrs PERSIST verbatim
(`sqlite-graph-store.ts:337/:97`) → NO storage migration. NO new npm dependency (ADR-007). DETERMINISM (ADR-008): the SET is
`[...new Set(cols)].sort()` code-point ASCENDING, centralized in the normalizer — extract/normalize twice → byte-identical.
Target DB stays strictly READ-ONLY (ADR-004; the engines write-verb scanner MUST stay green — the extended mssql query and
the NEW pg query are catalog `SELECT` only). Strict TS (NO `any`, `exactOptionalPropertyTypes` — `dstColumns?`/`columns?` are
OMITTED, never `[]`); ENGLISH; conventional commits referencing `dog3-column-lineage`, NO AI attribution, **NO push / PR / gh
/ tags** — local commits only. Leak-scan/denylist active — scan before EVERY commit; NEUTRAL fixture names only (commerce/order
themed, INHERITED: `v_order_summary`, `orders`, `order_items`, `products`, `regions`, pg `reporting.v_order_summary`/
`mv_product_stats`/`app.*`, sqlite `active_departments`/`employee_summary`/`departments`/`employees`).

**GOLDEN DISCIPLINE is the sharp edge (D1/D5/mcp §6).** The `attrs.dstColumns` stamp + the pg confidence FLIP + the
column-precise impact drift the graph/impact goldens PER ENGINE. Re-bless is ONE DELIBERATE commit PER BATCH with a
per-golden INVENTORY in the message body — NEVER a per-file drip. The exact sets are pinned by PROGRAMMATIC L-009 tests
FIRST; goldens are re-blessed to match SECOND. **Baseline is RE-MEASURED, not trusted:** apply runs `npm test` and RECORDS
the actual green count BEFORE Batch A (expect ~3506 on `post-v1` — do NOT hard-code a stale number); every gate = that
measured baseline + the batch's NEW suites. **Cross-engine byte-identity is a HARD STOP at every gate (freeze):** Batch A
freezes pg/mysql/sqlite; Batch B freezes mssql/mysql/sqlite; **Batch C's mysql/sqlite view-edge goldens MUST be BYTE-IDENTICAL
by design** (degrade-by-absence adds ZERO edge byte — only the `supportsColumnLineage:false` capability flag, which touches no
edge) and the sqlite present/MCP substrate (TABLE focus, no `dstColumns`) stays byte-identical. A non-target drift means the
shared seam leaked — investigate, NEVER re-bless.

## RESOLVED design decisions — apply MUST NOT re-litigate (design.md §Architecture Decisions; §Open Questions)

- **D1 (Model A — set-attr on the table edge, settled with math):** carry the consumed-column SET as
  `attrs.dstColumns: readonly string[]` on the ONE existing view→`depends_on`→table edge (edge-count math: A = **0 new edges**;
  B column-node = ~1,340→3,350+ new edges + broad node-golden churn). NO per-column edges, NO column-node targets. REJECTED:
  Model B (explodes at 14k columns; churns thousands of column-node goldens).
- **D2 (new plural `dstColumns`, NOT the reserved singular `dstColumn`):** ADD `EdgeAttrs.dstColumns?: readonly string[]`;
  leave `srcColumn/dstColumn` `references`-scoped. **This OVERTURNS the proposal's "make the singular fields load-bearing"
  wording — an ARCHIVE-TIME NOTE must record the lexical drift (reconciler decision b).** A SET needs a plural field; reusing
  singulars would force per-column edges (Model B). Separate field → FK/`references` goldens byte-identical (zero drift).
- **D3 (determinism centralized in the normalizer):** `buildDependencyEdges` does `[...new Set(cols)].sort()` (code-point
  ascending, deduplicated) BEFORE stamping — `stableStringify` preserves array order so the sort is MANDATORY, applied
  identically for every engine regardless of adapter row order (ADR-008). REJECTED: per-adapter sorting (drift risk).
- **D4 (degrade = ABSENCE of `dstColumns`, no per-edge marker):** mysql/sqlite/`SELECT *`/`minor_id=0`/uncovered-pg emit NO
  `dstColumns` → byte-identical object grain. NO `attrs.degraded` stamp (would churn EVERY mysql/sqlite golden for zero
  function — absence already drives the conservative-include rule). The per-engine `supportsColumnLineage` documents WHY.
- **D5 (confidence — mssql declared as-is; pg upgrades covered pairs):** mssql view `depends_on` is ALREADY `declared` →
  attach the set, NO flip. pg: `view_column_usage` is a CATALOG signal → COVERED (view,table) pairs FLIP `parsed`→`declared`
  + gain `dstColumns`; UNCOVERED (owner-visibility gap / materialized view / `SELECT *`) KEEP the tokenizer's `parsed` object
  grain, no set. REJECTED: leaving covered pg pairs `parsed` (dishonest — a catalog-confirmed pair IS declared).
- **D6 (conservative include-on-absence via ONE pure helper):** `filterReadersByColumn(edges, pivotCol)` in
  `core/query/column-pivot.ts` — `dstColumns` present + INCLUDES pivot → affected; present + EXCLUDES → **EXCLUDE** (precision);
  `dstColumns` ABSENT → **INCLUDE** (degrade = no false negative). ONE helper shared by `getImpact` first-hop AND
  precheck/affected. REJECTED: inferring coverage from the engine capability flag (see §Spec Coherence, reconciler decision a).
- **D7 (FULL-only `consumes:` render, golden-locked):** the shared `present/payload.ts` helper renders a view's consumed
  columns as `consumes: <table>.<column>` (pinned SHAPE) from `edge.attrs.dstColumns`, gated to `full` detail ONLY (NOT
  brief/normal — budget honesty); CLI + MCP BYTE-IDENTICAL (one helper, no per-surface branch); degraded/uncovered → NO
  consumes section. Exact label TEXT + byte layout golden-locked at apply + `docs/format-spec.md` §6 token-delta note.

**§Spec Coherence rulings (apply MUST honor):**
- **`supportsColumnLineage` stays an IMPLEMENTATION DETAIL (`adapters/engines/*/capabilities.ts` + the model
  `CapabilityMatrix`) — NEVER a per-edge coverage oracle (reconciler decision a).** Consumers MUST read coverage from the EDGE
  (`attrs.dstColumns` present-or-absent), NOT from the engine flag: a pg graph legitimately carries a COVERED edge WITH
  `dstColumns` (declared) alongside an UNCOVERED edge WITHOUT (materialized/owner-gap, parsed) on the SAME engine. A dedicated
  test PINS this coexistence (B.3).
- **The column-lineage benchmark family is INSTANTIABLE (edges exist) but the labeled RUN is DEFERRED** — NO `benchmark`
  spec delta, NO N-change, NO run recorded here (standing precedent: sqlite-view-deps, benchmark-harness-hardening).
- **`cli-config` carries NO separate delta** — the `consumes:` section is added to the ONE shared `present/payload.ts` helper
  backing BOTH surfaces; the `mcp-server` delta covers CLI `explore`/`object` + MCP `dbgraph_explore`/`dbgraph_object`.

Design §Open Questions RESOLVED as task decisions (audit during apply, do not defer silently):
- **mssql `SELECT *` (capable-but-columnless) vs sqlite (incapable) render wording** — CAPABILITY-ONLY, no per-dep hint (design
  leans this way): both render NO `consumes:` section (absence), the DISTINCTION lives in `supportsColumnLineage` text, not in a
  per-edge marker. Encoded in C.4/C.5.
- **`object.ts` full-detail ceiling for very wide views** — NO hard cap; list ALL consumed columns at `full`, the
  `docs/format-spec.md` §6 token-delta note RECORDS the measured bytes (ceiling POLICY unchanged: spec-edit + token-delta on
  every golden change). Pin against format-spec in C.6.
- **Does `impact` (US-014) need column pivots, or precheck/affected-only?** — the helper is SHARED; `getImpact` first-hop is
  column-aware (opt-in on a COLUMN-node pivot), precheck/affected reuse the SAME helper (C.2/C.3). Table-pivot impact UNCHANGED.

## Batch A: model + shared normalize seam + mssql (catalog-`declared`)

> Realizes D1/D2/D3/D5. Lands the additive `dstColumns`/`columns`/`supportsColumnLineage` types, the sorted-unique stamp every
> engine reuses, and the mssql `referenced_minor_id`→`sys.columns` sourcing proved via unit L-009 + `DBGRAPH_INTEGRATION`-gated
> live verification. Blast radius is mssql-only — **pg/mysql/sqlite goldens MUST stay byte-identical**.

- [ ] A.1 **(vitest)** RED→GREEN `test/core/model/column-lineage.test.ts` (new) + `src/core/model/edge.ts` + `catalog.ts` +
  `capability.ts`: add `EdgeAttrs.dstColumns?: readonly string[]` (edge.ts — load-bearing for `depends_on`), mirror
  `RawDependency.columns?: readonly string[]` (catalog.ts), add `supportsColumnLineage?: boolean` to `CapabilityMatrix`
  (capability.ts). Assert under strict TS: `dstColumns`/`columns` OPTIONAL (omit ≠ `[]`); the SET is a SOURCE-column set, NOT a
  mapping; `srcColumn/dstColumn` UNCHANGED (references-scoped). Spec: graph-model "Consumed source-column set on view
  depends_on via attrs.dstColumns" (the model shape + honesty scenarios); schema-extraction "Optional RawDependency.columns is
  an engine-agnostic source-column-set contract". D1/D2.
- [ ] A.2 **(vitest)** RED→GREEN `test/core/normalize/column-lineage.test.ts` (new) +
  `src/core/normalize/reference-resolver.ts`: `buildDependencyEdges` stamps `dep.columns`, `[...new Set()].sort()` code-point
  ascending, onto the view→table `depends_on` edge as `attrs.dstColumns`; UNSET `columns` → `attrs {}` byte-identical; NEVER a
  per-column edge, NEVER a column-node target. L-009: `columns:['status','order_id','order_id','customer_id']` →
  `dstColumns:['customer_id','order_id','status']` (sorted, deduped); UNSET → key ABSENT + byte-identical to pre-DOG-3;
  normalize twice → byte-identical (ADR-008). Spec: graph-normalization "buildDependencyEdges stamps the consumed source-column
  set as sorted-unique attrs.dstColumns" (all 3 scenarios); graph-model "Non-sourced dependency stays byte-identical object
  grain". D3.
- [ ] A.3 **(vitest + integration-gated)** RED→GREEN `test/adapters/engines/mssql/column-lineage.test.ts` (new) +
  `src/adapters/engines/mssql/queries.ts` + `map.ts`: extend `SQL_MSSQL_DEPENDENCIES` with `referenced_minor_id` + LEFT JOIN
  `sys.columns` for the source column NAME (FOR-JSON-safe — single top-level SELECT, scalar cols, top-level `ORDER BY`; DOG-1
  `ref_object_type` precedent); `DepRow`+`coerceDepRow` gain minor_id + col-name (`optionalString`/int); `map.ts` GROUPS rows
  per referenced object → `RawDependency.columns`; `referenced_minor_id = 0` (whole-object / `SELECT *`) contributes NO column;
  NULL/unresolved referenced object SKIPPED (never speculative). Extend the mssql DUMP `dependencies` family
  (`dump-emitter.ts` — DOG-2 precedent) + `queries-for-json.integration.test.ts` for the new columns. L-009 map-unit over
  recorded rows. ALSO wire into the `DBGRAPH_INTEGRATION`-gated `test/cli/mssql.e2e.integration.test.ts`. Spec: mssql-extraction
  "Declared consumed-column set stamped on view depends_on via referenced_minor_id"; schema-extraction "An adapter with a
  view-column catalog populates columns". D5.
- [ ] A.4 **(vitest)** RED→GREEN `test/adapters/engines/mssql/column-lineage-normalize.test.ts` (new) — SYNTHETIC in-memory
  `RawCatalog` (default CI, no container): `dbo.v_order_summary` → view→`dbo.orders` edge
  `attrs.dstColumns=[customer_id,order_id,status,total_amount]` and view→`dbo.order_items` edge
  `attrs.dstColumns=[order_id,product_id]`, both `confidence:'declared'`; observable set EXACTLY the six pairs. NEGATIVES
  (`not.toContainEqual`): `dbo.order_items.region_id`, `dbo.order_items.qty`, `dbo.orders.quantity`, `dbo.orders.unit_price`
  absent from ANY `dstColumns`; NO edge to `dbo.products`/`dbo.regions` carrying columns; a COMPUTED `total_amount` is consumed
  as ITSELF (not expanded to `quantity`/`unit_price`); NO per-column edge, NO column-node. Spec: mssql-extraction scenarios
  "v_order_summary emits its EXACT declared consumed-column set", "Columns the view does NOT read are absent (negative)", "A
  computed source column is consumed as itself (honesty)"; graph-model "A view carries attrs.dstColumns for its exact consumed
  columns". D1/D5.
- [ ] A.5 **(vitest, fixtures)** VERIFY/EXTEND `test/fixtures/mssql/torture.sql` so `dbo.v_order_summary` reads
  `o.order_id,o.customer_id,o.status,o.total_amount, COUNT(oi.product_id)` from `dbo.orders o` LEFT JOIN `dbo.order_items oi`,
  with `dbo.orders.total_amount` a COMPUTED `(quantity*unit_price)` column and `dbo.order_items` carrying
  `order_id/product_id/region_id/qty` (needed for the A.4 negatives) — then RE-RECORD `test/fixtures/mssql/rows/dependencies.json`
  (add `referenced_minor_id` + source-column names). Leak-scan neutral; no non-view object added beyond what the negatives need.
  Spec: mssql-extraction fixture anchor (`dbo.v_order_summary`). D5.
- [ ] A.6 **(golden — DELIBERATE re-bless, batch-scoped)** Re-bless mssql `golden-raw-catalog.json` (view deps gain `columns`) +
  `golden-e2e.json` (view→table `depends_on` edges gain `attrs.dstColumns`, `confidence:'declared'`) + `dumps/mssql-dump-golden.json`
  (extended `dependencies` family) to match the A.4 pinned sets; EVERY changed byte traces to a `dstColumns` array; positive set
  AND non-consumed negatives asserted; byte-identical on re-run (ADR-008). **pg/mysql/sqlite goldens byte-identical (HARD STOP).**
  Commit body = per-golden inventory. Spec: mssql-extraction "mssql view-column goldens re-blessed deliberately with exact sets".
- [ ] A.7 **(integration-gated)** Add to `test/cli/mssql.e2e.integration.test.ts` (`DBGRAPH_INTEGRATION`-gated Testcontainers
  over `torture.sql`) the LIVE computed-column truth: `dbo.orders.total_amount` (COMPUTED) appears in `v_order_summary`'s
  `attrs.dstColumns` as itself, `quantity`/`unit_price` do NOT — proving the catalog attribution end-to-end, NOT a fabricated
  base-column expansion. Spec: mssql-extraction "A computed source column is consumed as itself", integration tier.
- [ ] A.8 GATE (Batch A): RE-MEASURE baseline FIRST; `npx tsc --noEmit` strict clean (no `any`, `exactOptionalPropertyTypes`);
  `npm run lint` 0/0; `npm test` GREEN (baseline + A suites) with mssql `golden-e2e`/`golden-raw-catalog`/dump byte-identical on
  re-run; engines write-verb scanner GREEN (extended `SQL_MSSQL_DEPENDENCIES` catalog `SELECT` only); **pg/mysql/sqlite goldens
  byte-identical (HARD STOP on drift)**; leak-scan clean; confirm nothing pushed. COMMIT `feat(mssql,core): declared column-lineage set via attrs.dstColumns + referenced_minor_id sourcing`.

## Batch B: pg (catalog-`declared`, owner/materialized degrade + confidence flip)

> Realizes D5/D4. Adds the NEW `view_column_usage` query, merges the source-column sets into the tokenizer deps (covered pairs
> FLIP `parsed`→`declared`), and pins the honest degrade-by-absence for materialized/owner-gap sources. pg files are INDEPENDENT
> of mssql — **mssql/mysql/sqlite goldens MUST stay byte-identical**.

- [ ] B.1 **(vitest)** RED→GREEN `test/adapters/engines/pg/column-lineage.test.ts` (new) + `src/adapters/engines/pg/queries.ts`:
  add const `SQL_PG_VIEW_COLUMN_USAGE` over `information_schema.view_column_usage` sourcing per regular-view `(source table,
  source column)` pairs — catalog `SELECT` ONLY (write-verb scanner green). RED over recorded rows: shape coerces to a
  `(view, table, column)` set; materialized views are ABSENT from the result (they are not covered by `view_column_usage`).
  Spec: pg-extraction "Declared consumed-column set for regular views via view_column_usage" (query half). D5.
- [ ] B.2 **(vitest)** RED→GREEN `test/adapters/engines/pg/column-lineage.test.ts` (extend) + `src/adapters/engines/pg/map.ts` +
  `tokenizer.ts`: MERGE the `view_column_usage` sets into the tokenizer-derived deps — for each COVERED (view, table) pair FLIP
  `confidence:'parsed'`→`'declared'` on the existing `depends_on` edge AND attach `RawDependency.columns`; UNCOVERED sources
  (materialized view / owner-visibility gap / `SELECT *`) KEEP `parsed` object grain with NO `columns` (degrade-by-absence, NO
  marker); NEVER fabricate a column from the body. Spec: pg-extraction "Declared … with confidence flip" + "Sources absent from
  view_column_usage stay parsed object grain (degrade-by-absence), never guessed" (materialized + owner-gap scenarios). D5/D4.
- [ ] B.3 **(vitest)** RED→GREEN `test/adapters/engines/pg/capabilities.test.ts` (extend) +
  `src/adapters/engines/pg/capabilities.ts`: set `supportsColumnLineage: true` (owner caveat in the note); `supportsDependencyHints`
  STAYS `false` (`view_column_usage` is a DISTINCT view-scoped catalog, not a body dep-hint); add a capability NOTE that a
  DECLARED view-column source now feeds regular-view lineage. **RECONCILER (a): PIN per-edge coverage** — assert a pg graph
  where a COVERED edge carries `dstColumns` (declared) COEXISTS with an UNCOVERED edge WITHOUT (parsed) on the SAME engine;
  coverage is read from the EDGE, NEVER inferred from `supportsColumnLineage`. Spec: pg-extraction "capability note corrected;
  view-column goldens re-blessed with the confidence flip" (the capability scenario). §Spec Coherence.
- [ ] B.4 **(vitest)** RED→GREEN `test/adapters/engines/pg/column-lineage-normalize.test.ts` (new) — SYNTHETIC in-memory
  `RawCatalog`: `reporting.v_order_summary` → view→`app.orders` edge `attrs.dstColumns=[customer_id,order_id,status]` and
  view→`app.order_items` edge `attrs.dstColumns=[item_id,order_id,total_price]`, EACH FLIPPED to `confidence:'declared'`;
  observable set EXACTLY the six pairs; NEGATIVE: `app.order_items.qty`/`product_id` absent. `reporting.mv_product_stats`
  (materialized) → edges to `app.products`/`app.order_items` carry NO `dstColumns`, stay `parsed` (no flip, no fabrication); an
  owner-gap view degrades identically. Spec: pg-extraction "v_order_summary flips to declared and emits its EXACT consumed-column
  set", "materialized view stays parsed object grain", "owner-visibility gap degrades honestly". D5/D4.
- [ ] B.5 **(vitest, fixtures)** VERIFY/EXTEND `test/fixtures/pg/torture.sql` with the regular view `reporting.v_order_summary`
  (reads `app.orders` + `app.order_items`) and the MATERIALIZED view `reporting.mv_product_stats` (reads `app.products` +
  `app.order_items`); re-record any offline pg row fixtures for `view_column_usage`. Leak-scan neutral. Spec: pg-extraction
  fixture anchors (`reporting.v_order_summary`, `reporting.mv_product_stats`).
- [ ] B.6 **(golden — DELIBERATE re-bless, batch-scoped)** Re-bless pg `golden-raw-catalog.json`/`golden-e2e.json`: the
  `v_order_summary` covered edges pinned `confidence:'declared'` with their `attrs.dstColumns` (the parsed→declared FLIP is an
  INTENTIONAL re-bless), the `mv_product_stats` edges pinned `parsed` with NO `dstColumns`; every unrelated byte unchanged;
  byte-identical on re-run. **mssql/mysql/sqlite goldens byte-identical (HARD STOP).** Commit body = per-golden inventory
  (call out the flip + the materialized-absence). Spec: pg-extraction "supportsDependencyHints stays false while covered
  regular-view pairs flip to declared".
- [ ] B.7 **(integration-gated)** Add to `test/cli/pg.e2e.integration.test.ts` (`DBGRAPH_INTEGRATION`-gated) the LIVE
  verifications: `view_column_usage` COVERAGE (`v_order_summary` covered edges declared with exact `dstColumns`) AND
  MATERIALIZED-VIEW EXCLUSION (`mv_product_stats` edges parsed, no `dstColumns`) over the real container. Spec: pg-extraction
  covered + materialized scenarios, integration tier.
- [ ] B.8 GATE (Batch B): RE-MEASURE baseline; `npx tsc --noEmit` strict clean; `npm run lint` 0/0; `npm test` GREEN (baseline +
  A+B suites) with pg goldens byte-identical on re-run; engines write-verb scanner GREEN (`SQL_PG_VIEW_COLUMN_USAGE` catalog
  `SELECT` only); **mssql/mysql/sqlite goldens byte-identical (HARD STOP)**; leak-scan clean; nothing pushed. COMMIT
  `feat(pg): declared column-lineage via view_column_usage with parsed→declared flip + materialized/owner degrade`.

## Batch C: impact precision + `consumes:` render + mysql/sqlite degrade + final re-bless + DoD

> Realizes D6/D7/D4 + §Spec Coherence. Adds the ONE shared `filterReadersByColumn` helper (impact first-hop + precheck/affected),
> the FULL-only `consumes:` render, and the mysql/sqlite degrade-by-absence guards, then the final deliberate re-bless. **mysql/
> sqlite view-edge goldens + the sqlite present/MCP substrate MUST stay byte-identical.** Ends in the consolidated gate + DoD.

- [ ] C.1 **(vitest)** RED→GREEN `test/core/query/column-pivot.test.ts` (new) + `src/core/query/column-pivot.ts`: pure
  `filterReadersByColumn(edges, pivotCol)` — `dstColumns` present + INCLUDES pivot → affected; present + EXCLUDES → EXCLUDE;
  ABSENT → INCLUDE (degrade, no false negative). L-009 over synthetic edge sets: pin all three branches, INCLUDE-on-absence
  explicitly. Spec: graph-query "Depth-limited impact closure" (the `attrs.dstColumns` membership + absence-include rule). D6.
- [ ] C.2 **(vitest)** RED→GREEN `test/core/query/impact-column.test.ts` (new) + `src/core/query/impact.ts`: a COLUMN-node pivot
  resolves to its owning TABLE then applies `filterReadersByColumn` at the view first-hop; TABLE-node pivot UNCHANGED. L-009 over
  the mssql torture graph: impact on `dbo.order_items.product_id` → affected views EXACTLY `{dbo.v_order_summary}` (READ impact);
  impact on `dbo.order_items.region_id` → `dbo.v_order_summary` ABSENT (negative precision, DELIBERATE improvement); TABLE pivot
  `dbo.order_items` → surfaces the view (object grain, unchanged); a mysql/sqlite column pivot → object-grain (every view over
  the table). Regressions GREEN (read/write, depth-truncation, cyclic visited-set, dynamic-SQL warning, `calls` read-impact);
  byte-identical on re-run. Spec: graph-query scenarios "dropping a consumed column surfaces the consuming view (exact set)",
  "dropping a non-consumed column of the same table excludes the view (negative, precision)", "table pivot impact is unchanged",
  "degraded engine keeps table-grain view impact". D6.
- [ ] C.3 **(vitest)** RED→GREEN `test/mcp/precheck.test.ts` (extend) — precheck/affected reuse `filterReadersByColumn` for
  `DROP COLUMN` pivots: `dbgraph_precheck({ ddl: DROP dbo.order_items.product_id })` → `whatToTest` READERS includes
  `dbo.v_order_summary`, tagged `confidence:'parsed'` (DDL identifiers are parsed even though the edge is declared); DROP
  `dbo.order_items.region_id` → does NOT surface it; `dbgraph affected script.sql --json` mirrors via the shared engine
  (exit 1); non-matchable identifiers reported unmatched. Spec: mcp-server "precheck and affected surface column-grain view
  precision (declared engines)" (both scenarios). D6.
- [ ] C.4 **(vitest + golden)** RED→GREEN `test/core/present/column-lineage.test.ts` (new) + `src/core/present/payload.ts`
  (+ `explore.ts`/`object.ts` wiring) — over a SYNTHETIC view-focus `PresentView` carrying `attrs.dstColumns`: render
  `consumes: <table>.<column>` (pinned SHAPE, code-point order) at `full` ONLY; `brief`/`normal` render NONE; `explore` and
  `object` (CLI + MCP) BYTE-IDENTICAL (one shared helper); a view whose edges carry NO `dstColumns` → NO consumes section
  (negative); the lines name ONLY consumed source columns, NEVER an output↔source pair. Spec: mcp-server "explore and object
  render a view's consumed source columns at full detail, honest" (view-focus-full, honesty, degraded-negative scenarios). D7.
- [ ] C.5 **(vitest)** RED→GREEN `test/adapters/engines/{mysql,sqlite}/column-lineage-absence.test.ts` (new) +
  `src/adapters/engines/{mysql,sqlite}/capabilities.ts`: set `supportsColumnLineage: false` (documents WHY, touches NO edge
  byte); PIN degrade-by-absence over the EXISTING torture views — mysql views to `b`/`c` and sqlite `main.active_departments`/
  `main.employee_summary` retain object-grain `depends_on` (`parsed`), carry NO `attrs.dstColumns`, NO marker, byte-identical to
  pre-DOG-3; NEGATIVE: bodies naming specific columns mint NO `dstColumns` (no body-parse, ADR-007); NO fixture object added.
  Per-edge coverage: capability `false` does NOT imply the edge — coverage read from the EDGE. Spec: mysql-extraction "View
  column lineage degrades by absence" (all 3 scenarios); sqlite-extraction "View column lineage degrades by absence" (all 3);
  graph-model "Per-engine column provenance and honest degradation-by-absence" (declared-vs-absent + no-fabrication). D4.
- [ ] C.6 **(golden — DELIBERATE re-bless, batch-scoped)** Re-bless the mssql/pg impact + precheck goldens that genuinely gain
  COLUMN precision (DELIBERATE, with the column-grain justification: a non-consumed column no longer surfaces the view) + add the
  new present `consumes:` golden family (synthetic view focus, `full`) + the `docs/format-spec.md` §6 token-delta note.
  **mysql/sqlite view-edge goldens BYTE-IDENTICAL (only the `supportsColumnLineage:false` flag, no edge byte); the sqlite
  present/MCP substrate (TABLE focus, no `dstColumns`) shows ZERO drift (HARD STOP).** Byte-identical on re-run; per-golden
  inventory. Spec: mcp-server render scenarios; graph-query precision scenario; sqlite/mysql zero-drift.
- [ ] C.7 **(integration-gated)** Add the C.2/C.3/C.4 column-precise impact + `whatToTest` + `consumes:` render assertions to
  the `DBGRAPH_INTEGRATION`-gated `test/cli/{mssql,pg}.e2e.integration.test.ts` over the real containers — end-to-end
  column-drop precision + render. Spec: mcp-server precheck/render, integration tier.
- [ ] C.8 GATE (Batch C — FINAL): RE-MEASURE baseline; `npx tsc --noEmit` strict clean (no `any`); `npm run lint` 0/0;
  `npm test` FULL GREEN (baseline + ALL A/B/C suites) with EVERY re-blessed golden byte-identical on re-run; **mysql/sqlite
  view-edge goldens + sqlite present/MCP substrate byte-identical (HARD STOP)**; engines write-verb scanner GREEN; ADR-004
  read-only + ADR-008 determinism green; leak-scan clean; confirm NOTHING pushed (no push/PR/gh/tag). Trace the DoD below.
  COMMIT `feat(query,present): column-precise impact + full-only consumes render + mysql/sqlite degrade-by-absence`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch A** (A.1–A.8): MODEL + SEAM + MSSQL — `edge.ts`/`catalog.ts`/`capability.ts` types, `reference-resolver.ts`
  sorted-unique stamp, mssql `queries.ts`/`map.ts` `referenced_minor_id`+`sys.columns` sourcing + dump family, `v_order_summary`
  fixture/rows, synthetic + integration-gated computed-column pins, the single mssql re-bless.
- **Batch B** (B.1–B.8): PG — `queries.ts` `SQL_PG_VIEW_COLUMN_USAGE`, `map.ts`/`tokenizer.ts` merge + parsed→declared flip,
  `capabilities.ts` note + per-edge-coverage pin, `mv_product_stats` fixture, synthetic + integration-gated coverage/exclusion
  pins, the single pg re-bless (flip inventoried).
- **Batch C** (C.1–C.8): IMPACT + RENDER + DEGRADE — `column-pivot.ts` helper, `impact.ts` first-hop, precheck/affected reuse,
  `present/payload.ts` FULL-only `consumes:`, mysql/sqlite `capabilities.ts` + absence guards, final impact/precheck/present
  re-bless + format-spec §6 note, consolidated gate + DoD.

### Parallel vs sequential

- **Batches are STRICTLY SEQUENTIAL: A → B → C.** B's pg flip reuses the A.2 normalize stamp; C's impact/render/precheck depend
  on `attrs.dstColumns` EXISTING (A mssql + B pg). C cannot precede B.
- **Within Batch A, A.1 (model) → A.2 (normalize stamp)** are the prerequisites for everything; A.3 (mssql adapter) can proceed
  in parallel with A.2 but A.4 (synthetic) depends on A.1+A.2+A.3 and A.5 (fixture/rows); A.6 (re-bless) depends on A.4+A.5;
  A.7 (integration) mirrors A.4. **A is single-engine → no intra-batch engine parallelism.**
- **Within Batch B, B.1 (query) → B.2 (map merge/flip) → B.4 (synthetic)**; B.3 (capabilities + coverage pin) is independent
  of B.2 ordering but consumes the same graph; B.5 (fixture) precedes B.6 (re-bless); B.7 (integration) mirrors B.4.
- **Within Batch C, C.1 (helper) → C.2 (impact) + C.3 (precheck)** (both reuse `filterReadersByColumn`; C.2/C.3 touch
  independent files → parallel-safe after C.1); C.4 (render) is independent of C.2/C.3; **C.5 (mysql/sqlite) touches INDEPENDENT
  files → parallel-safe** (assertion + capability flag only); C.6 (re-bless) depends on C.2+C.3+C.4+C.5; C.8 gates all.

### Dependency bottlenecks

- **The normalize stamp (A.2) is the architectural bottleneck** — every engine and both downstream batches reuse the
  `[...new Set()].sort()` `dstColumns` stamp. It MUST land in A, correct and centralized (ADR-008), before B's flip and C's
  filter build on it. A per-adapter sort would re-introduce ordering drift.
- **`filterReadersByColumn` (C.1) is the impact/precheck bottleneck** — `getImpact` first-hop AND precheck/affected reuse the
  ONE helper. The include-on-absence branch (D6) is the single guard against false negatives on degraded engines; a
  present-but-excludes shortcut that also excluded ABSENT edges would silently drop mysql/sqlite views.
- **Golden re-bless is PER-BATCH and PER-ENGINE, never piecemeal** — A re-blesses mssql graph/dump, B pg graph (the flip), C the
  impact/precheck/present surface. A non-target engine golden that moves means the shared normalize/impact seam leaked: HARD
  STOP, investigate, do NOT re-bless.
- **Cross-engine freeze is the phase-wide invariant** — A freezes pg/mysql/sqlite; B freezes mssql/mysql/sqlite; **C's
  mysql/sqlite view-edge goldens are BYTE-IDENTICAL BY DESIGN** (degrade-by-absence adds zero edge byte) and the sqlite
  present/MCP substrate carries no `dstColumns` → zero drift. Any movement there is the shared seam fabricating a section.
- **L-009 exactness is load-bearing** — the positive exact-sets + `not.toContainEqual` NEGATIVES (non-consumed columns absent,
  no fabricated pair under degradation, no per-column edge, no column-node, no output↔source mapping) are the ONLY guard
  against honesty violations; existence-only asserts would silently pass a fabricated or over-approximated set.
- **Per-edge coverage ≠ engine flag (reconciler a)** — `supportsColumnLineage` is an impl-detail; a pg graph legitimately mixes
  a covered (declared, with `dstColumns`) and an uncovered (parsed, without) edge on the SAME engine. B.3 PINS the coexistence;
  consumers MUST read coverage from the edge.
- **Proposal lexical drift (reconciler b)** — the proposal's "make the singular `srcColumn/dstColumn` load-bearing" wording is
  SUPERSEDED by design D2 (new plural `dstColumns`). Apply follows D2; an ARCHIVE-TIME NOTE records the overturn (not an apply
  action, but flagged so archive does not mis-merge the graph-model delta).
- **Benchmark column-lineage family INSTANTIABLE, labeled RUN DEFERRED** (§Spec Coherence) — no `benchmark` delta, no N-change,
  no run recorded in this change.

## Definition of Done (tied to the proposal Success Criteria; 34 DOG-3 scenarios + 5 carried graph-query regressions across 14 requirements / 9 deltas traced)

- [ ] Where a catalog sources it (mssql; pg covered pairs), a view→table `depends_on` edge carries `attrs.dstColumns` = the
  EXACT sorted-unique consumed source columns at `confidence:'declared'` — exact set + negatives (L-009). — A (A.2, A.4), B
  (B.2, B.4) [graph-model "Consumed source-column set…"; graph-normalization stamp; mssql "Declared consumed-column set…"; pg
  "…with confidence flip"; schema-extraction "Optional RawDependency.columns…"]
- [ ] Dropping a COLUMN surfaces ONLY the views reading it (a non-consumed column of the same table yields NO reader);
  table-pivot impact UNCHANGED; degraded engines keep object-grain view impact. — C (C.1, C.2, C.3) [graph-query "dropping a
  consumed/non-consumed column…", "table pivot unchanged", "degraded engine keeps table-grain"; mcp-server precheck/affected]
- [ ] mysql/sqlite DEGRADE by ABSENCE — NO `dstColumns`, NO per-edge marker, view edges BYTE-IDENTICAL to pre-DOG-3, no
  body-parsed fabrication; `supportsColumnLineage:false` documents WHY. — C (C.5) [mysql-extraction "…degrades by absence";
  sqlite-extraction "…degrades by absence"; graph-model "Per-engine column provenance…"]
- [ ] `explore`/`object` (CLI + MCP) render a `consumes: <table>.<column>` section at `full` ONLY, byte-identical across
  surfaces, degraded/uncovered → no section — exact bytes + `docs/format-spec.md` §6 note. — C (C.4, C.6) [mcp-server "explore
  and object render a view's consumed source columns at full detail, honest"] (D7)
- [ ] pg covered regular-view pairs FLIP `parsed`→`declared` + gain `dstColumns`; materialized/owner-gap sources STAY `parsed`
  object grain (degrade-by-absence, never guessed); `supportsDependencyHints` STAYS `false`. — B (B.2, B.3, B.4) [pg-extraction
  all 3 requirements] (D5/D4)
- [ ] Coverage is read from the EDGE, never inferred from `supportsColumnLineage` — a covered + an uncovered edge coexist on the
  SAME pg engine (reconciler a). — B (B.3) [pg-extraction capability scenario; §Spec Coherence]
- [ ] Every re-blessed golden (mssql A.6, pg B.6, impact/precheck/present C.6) is ONE DELIBERATE per-batch commit with a
  per-golden inventory, byte-identical on re-run; cross-engine freeze honored (A: pg/mysql/sqlite; B: mssql/mysql/sqlite; C:
  mysql/sqlite edges + sqlite present substrate); write-verb scanner green. — A (A.6, A.7), B (B.6, B.7), C (C.6, C.7)
  [mssql re-bless; pg re-bless; graph-query/mcp-server determinism]
- [ ] `npx tsc --noEmit` strict clean (no `any`); `npm run lint` 0/0; `npm test` GREEN (re-measured baseline + all new suites)
  every golden byte-identical on re-run; ADR-004 read-only + ADR-008 determinism green; leak-scan clean; nothing pushed. —
  every batch GATE (A.8, B.8, C.8)
