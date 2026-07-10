# Delta for mssql-extraction (dog3-column-lineage)

> `SQL_MSSQL_DEPENDENCIES` already runs (object-grain view→table deps) and stays UNCHANGED. DOG-3 sources the
> per-view source-column SET from `sys.dm_sql_referenced_entities('<view>','OBJECT')` via a NATIVE-driver per-view
> loop (each call individually try/caught), plumbed through `map.ts` onto `RawDependency.columns`, and stamped by
> the normalizer as `attrs.dstColumns` on the EXISTING view→table `depends_on` edge (Model A — ZERO new edges). The
> mssql view `depends_on` is ALREADY `confidence: 'declared'`, so the set attaches with NO confidence flip.
> **Live finding (2026-07-07):** `sys.sql_expression_dependencies.referenced_minor_id` = 0 (whole-object) for
> non-schemabound views — INERT — so the per-object TVF is the TRUTH source. **Column lineage is NATIVE-driver-only:**
> the sqlcmd/manual-dump strategies carry NO view-columns family (the single-SELECT-per-family contract, DOG-2), so
> mssql-via-sqlcmd/dump yields OBJECT GRAIN — the project's FIRST strategy-dependent coverage difference. SOURCE-COLUMN
> SET only — never an output mapping (ADR-007). Fixture anchor: the existing `dbo.v_order_summary`
> (`test/fixtures/mssql/torture.sql`). Stories: US-027, US-007.

## ADDED Requirements

### Requirement: Declared consumed-column set stamped on view depends_on via dm_sql_referenced_entities (native path)

On the NATIVE driver path, the mssql adapter SHALL, for each view, call
`sys.dm_sql_referenced_entities('<view>','OBJECT')` in a per-view loop and, for each returned row that resolves a
referenced source COLUMN, thread that column onto `RawDependency.columns` (grouped per referenced object via
`map.ts`) so the normalizer stamps the sorted-unique set as `attrs.dstColumns` on the view→source-table
`depends_on` edge at `confidence: 'declared'`. The `depends_on` edge is UNCHANGED in identity; it merely GAINS
`attrs.dstColumns` — NO separate per-column edge is emitted. `SQL_MSSQL_DEPENDENCIES` is UNCHANGED; it keeps
sourcing the object-grain view→table deps. EACH `dm_sql_referenced_entities` call MUST be individually
error-handled: an UNBINDABLE view (the TVF raises — a source table/column was renamed or dropped) MUST be SKIPPED
and its `depends_on` edge MUST stay object grain, and extraction MUST complete for the rest of the catalog
(degrade-by-absence, never abort). A whole-object reference that resolves NO source column (e.g. `SELECT *`) MUST
NOT contribute a column — that dependency stays object grain (`attrs.dstColumns` unset). The emission is a
SOURCE-COLUMN SET; the adapter MUST NOT assert any output↔source mapping. A NULL/unresolved referenced object MUST
be skipped, never turned into a speculative column. Views MUST be iterated in a stable order so extraction is
deterministic (ADR-008).

#### Scenario: v_order_summary emits its EXACT declared consumed-column set

- GIVEN the torture view `dbo.v_order_summary` selecting `o.order_id, o.customer_id, o.status, o.total_amount, COUNT(oi.product_id)` from `dbo.orders o` LEFT JOIN `dbo.order_items oi ON oi.order_id = o.order_id`, grouped by `o.order_id, o.customer_id, o.status, o.total_amount`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN the view→`dbo.orders` `depends_on` edge carries `attrs.dstColumns = [customer_id, order_id, status, total_amount]` and the view→`dbo.order_items` edge carries `attrs.dstColumns = [order_id, product_id]` (each sorted code-point ascending), both `confidence: 'declared'`
- AND the observable consumed set is EXACTLY `{ dbo.orders.order_id, dbo.orders.customer_id, dbo.orders.status, dbo.orders.total_amount, dbo.order_items.order_id, dbo.order_items.product_id }`
- AND NO separate per-column `depends_on` edge and NO column-node target is emitted (Model A)

#### Scenario: Columns the view does NOT read are absent from dstColumns (negative, exact-set)

- GIVEN the same `dbo.v_order_summary`
- WHEN its `depends_on` edges are enumerated
- THEN `dbo.order_items.region_id`, `dbo.order_items.qty`, `dbo.orders.quantity` and `dbo.orders.unit_price` do NOT appear in any `attrs.dstColumns` (none is named in the view)
- AND there is NO `depends_on` edge to `dbo.products` or `dbo.regions` (unreferenced tables) carrying columns

#### Scenario: A computed source column is consumed as itself, not expanded (honesty)

- GIVEN `dbo.orders.total_amount` is a COMPUTED column `(quantity * unit_price)` that `dbo.v_order_summary` reads by name
- WHEN the view→`dbo.orders` `attrs.dstColumns` is pinned
- THEN it contains `total_amount` (the column the view names)
- AND it does NOT contain `quantity` or `unit_price` — expanding a computed column to its base columns is a DEEPER grain the catalog does not attribute to the view; it MUST NOT be fabricated

#### Scenario: An unbindable view is skipped and extraction completes (per-call resilience)

- GIVEN a view whose `sys.dm_sql_referenced_entities('<view>','OBJECT')` call RAISES (an unbindable view — a source table or column was renamed or dropped) alongside the bindable `dbo.v_order_summary`
- WHEN `extract(scope)` runs on the native driver path
- THEN the unbindable view's `depends_on` edges STAY object grain (`attrs.dstColumns` unset), NO error propagates, and extraction COMPLETES
- AND `dbo.v_order_summary` still emits its EXACT declared consumed-column set — one unbindable view MUST NOT abort the whole family (degrade-by-absence; a set-based `CROSS APPLY` is rejected precisely because it would abort)

#### Scenario: Extraction via sqlcmd or manual dump yields object grain, byte-identical (strategy coverage difference)

- GIVEN the mssql catalog is extracted through the sqlcmd or manual-dump strategy (NOT the native driver)
- WHEN the catalog is normalized
- THEN the `dbo.v_order_summary` view→table `depends_on` edges carry NO `attrs.dstColumns` (object grain) — the single-SELECT-per-family dump contract carries NO view-columns family
- AND those edges are BYTE-IDENTICAL to pre-DOG-3 (no `dstColumns`, no marker) and extraction raises NO error — this is the project's FIRST strategy-dependent coverage difference, stated plainly

### Requirement: mssql view-column goldens re-blessed deliberately with exact sets

The NATIVE-path golden-pinned `RawCatalog` and the end-to-end impact/path goldens MUST be re-blessed DELIBERATELY
so the `dbo.v_order_summary` view→table `depends_on` edges carry `attrs.dstColumns`, with L-009 exact-set
assertions: the edge endpoints, the sorted `attrs.dstColumns` array, AND `confidence: 'declared'` pinned; the
positive set AND the non-consumed negatives asserted; every unrelated byte unchanged. The mssql DUMP golden
(sqlcmd/manual-dump path) MUST STAY object grain — its view→table `depends_on` edges carry NO `attrs.dstColumns`
and remain BYTE-IDENTICAL to pre-DOG-3 (the dump family is NOT extended). The new
`SQL_MSSQL_VIEW_REFERENCED_COLUMNS` query (`sys.dm_sql_referenced_entities`) MUST pass the engines write-verb
scanner (catalog `SELECT` only), as MUST the unchanged `SQL_MSSQL_DEPENDENCIES`.

#### Scenario: re-blessed goldens pin dstColumns, the declared confidence, and stay scanner-green

- GIVEN the materialized mssql torture database extracted via the NATIVE driver (the `dm_sql_referenced_entities` per-view loop)
- WHEN the pipeline runs extract → `normalizeCatalog` → `SqliteGraphStore` upsert → query
- THEN the re-blessed native-path goldens carry the `dbo.v_order_summary` view→table `depends_on` edges with `attrs.dstColumns = [customer_id, order_id, status, total_amount]` (to `dbo.orders`) and `[order_id, product_id]` (to `dbo.order_items`), `confidence: 'declared'`, byte-identical on re-run (ADR-008)
- AND the mssql DUMP golden keeps those edges at OBJECT grain (no `attrs.dstColumns`), byte-identical to pre-DOG-3
- AND both `SQL_MSSQL_VIEW_REFERENCED_COLUMNS` and `SQL_MSSQL_DEPENDENCIES` pass the engines write-verb scanner
