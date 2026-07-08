# Delta for pg-extraction (dog3-column-lineage)

> A NEW catalog query over `information_schema.view_column_usage` sources the per-view source
> `(table, column)` SET → stamped as `attrs.dstColumns` on the EXISTING view→table `depends_on` edge (Model A
> — ZERO new edges). Because `view_column_usage` is a CATALOG dependency signal, a COVERED (view, table) pair
> FLIPS `confidence: 'parsed'` (body-tokenizer) → `'declared'` and gains the set. HONEST caveats:
> `view_column_usage` (a) surfaces only sources the view OWNER also owns, and (b) does NOT cover MATERIALIZED
> views — any source it omits stays `parsed` object grain WITHOUT `attrs.dstColumns` (degrade-by-absence,
> never guessed). This view-column catalog is DISTINCT from body dependency-hints, so
> `supportsDependencyHints` stays `false`. SOURCE-COLUMN SET only (ADR-007). Fixture anchor:
> `reporting.v_order_summary` (regular view) and `reporting.mv_product_stats` (materialized) in
> `test/fixtures/pg/torture.sql`. Stories: US-028, US-007.

## ADDED Requirements

### Requirement: Declared consumed-column set for regular views via view_column_usage, with confidence flip

The pg adapter SHALL run a NEW catalog `SELECT` over `information_schema.view_column_usage` to source, per
regular view, the set of `(source table, source column)` pairs it reads, threaded onto
`RawDependency.columns` and merged into the tokenizer-derived dependencies. For each (view, source table)
pair the catalog COVERS, the view→table `depends_on` edge MUST FLIP `confidence: 'parsed'` → `'declared'`
(a catalog-confirmed pair IS declared) AND gain `attrs.dstColumns` (the sorted-unique consumed source
columns). The `depends_on` edge is UNCHANGED in identity; it flips confidence and gains the set — NO separate
per-column edge is emitted. The emission is a SOURCE-COLUMN SET; the adapter MUST NOT assert any output↔source
mapping. The new query MUST issue only a catalog `SELECT` (engines write-verb scanner green).

#### Scenario: v_order_summary flips to declared and emits its EXACT consumed-column set

- GIVEN the torture view `reporting.v_order_summary` selecting `o.order_id, o.customer_id, o.status, COUNT(oi.item_id), SUM(oi.total_price)` from `app.orders o` LEFT JOIN `app.order_items oi ON oi.order_id = o.order_id`, grouped by `o.order_id, o.customer_id, o.status`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN the view→`app.orders` `depends_on` edge carries `attrs.dstColumns = [customer_id, order_id, status]` and the view→`app.order_items` edge carries `attrs.dstColumns = [item_id, order_id, total_price]` (each sorted code-point ascending), each FLIPPED to `confidence: 'declared'`
- AND the observable consumed set is EXACTLY `{ app.orders.order_id, app.orders.customer_id, app.orders.status, app.order_items.order_id, app.order_items.item_id, app.order_items.total_price }`
- AND no column the view does not read (e.g. `app.order_items.qty`, `app.order_items.product_id`) appears in any `attrs.dstColumns` (negative)

### Requirement: Sources absent from view_column_usage stay parsed object grain (degrade-by-absence), never guessed

Where `information_schema.view_column_usage` OMITS a source — because the view is a MATERIALIZED view (not
covered by `view_column_usage`) OR because the view owner does not own the referenced object (owner
visibility) — the pg adapter MUST leave that view→table `depends_on` edge at its tokenizer `confidence:
'parsed'` object grain with NO `attrs.dstColumns` (degrade-by-absence — NO per-edge marker, no
`attrs.degraded`). It MUST NOT fabricate a column from the body. The golden MUST pin the EXACT OBSERVABLE
covered set the catalog returns — NEVER a fabricated "complete" set inferred from the body (ADR-006/007).

#### Scenario: materialized view stays parsed object grain (concrete negative)

- GIVEN the torture MATERIALIZED view `reporting.mv_product_stats` reading `app.products` and `app.order_items` (materialized views are absent from `information_schema.view_column_usage`)
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN its `depends_on` edges to `app.products` and `app.order_items` carry NO `attrs.dstColumns` and stay `confidence: 'parsed'` (no flip)
- AND no column is fabricated from its body text

#### Scenario: owner-visibility gap degrades honestly

- GIVEN a regular view reading from a table the view owner does NOT own (absent from `view_column_usage`)
- WHEN the catalog is normalized
- THEN that view→table `depends_on` edge carries NO `attrs.dstColumns` and stays `parsed` object grain
- AND the golden pins the exact covered set the catalog observably returns, never a guessed full set

### Requirement: capability note corrected; view-column goldens re-blessed with the confidence flip

`PG_CAPABILITIES.supportsDependencyHints` MUST remain `false` (it denotes body-derived read/write dep-hints,
which pg still lacks — `view_column_usage` is a DISTINCT, view-scoped catalog). A capability note MUST record
that a DECLARED view-column source now feeds regular-view lineage. The golden-pinned `RawCatalog` and impact
goldens MUST be re-blessed DELIBERATELY with L-009 exact sets: the `v_order_summary` covered edges pinned at
`confidence: 'declared'` with their `attrs.dstColumns` (the parsed→declared FLIP is an intentional re-bless),
AND the `mv_product_stats` edges pinned at `parsed` with NO `attrs.dstColumns`; every unrelated byte unchanged.

#### Scenario: supportsDependencyHints stays false while covered regular-view pairs flip to declared

- GIVEN `PG_CAPABILITIES` after DOG-3
- WHEN `supportsDependencyHints` is read and the capability note is inspected
- THEN `supportsDependencyHints` is STILL `false` (no body dep-hint catalog)
- AND the note records that `information_schema.view_column_usage` supplies DECLARED source columns for covered regular-view pairs (materialized/uncovered stay parsed)
- AND the re-blessed goldens pin the `v_order_summary` covered edges at `confidence: 'declared'` with their `attrs.dstColumns` (the deliberate parsed→declared flip) and the `mv_product_stats` edges at `parsed` with no `dstColumns`, byte-identical on re-run (ADR-008)
