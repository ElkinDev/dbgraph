# Delta for mssql-extraction (dog3-column-lineage)

> `SQL_MSSQL_DEPENDENCIES` already runs. DOG-3 threads `sys.sql_expression_dependencies.referenced_minor_id`
> (the referenced COLUMN id) → the per-view source-column SET, plumbed via `DepRow` and `map.ts` onto
> `RawDependency.columns`, and stamped by the normalizer as `attrs.dstColumns` on the EXISTING view→table
> `depends_on` edge (Model A — ZERO new edges). The mssql view `depends_on` is ALREADY `confidence:
> 'declared'`, so the set attaches with NO confidence flip. SOURCE-COLUMN SET only — never an output mapping
> (ADR-007). Fixture anchor: the existing `dbo.v_order_summary` (`test/fixtures/mssql/torture.sql`). Stories:
> US-027, US-007.

## ADDED Requirements

### Requirement: Declared consumed-column set stamped on view depends_on via referenced_minor_id

The mssql adapter SHALL extend `SQL_MSSQL_DEPENDENCIES` to carry `referenced_minor_id` and, for each view
dependency whose `referenced_minor_id` resolves to a source COLUMN, thread that column onto
`RawDependency.columns` (via `DepRow` and `map.ts`, grouped per referenced object) so the normalizer stamps
the sorted-unique set as `attrs.dstColumns` on the view→source-table `depends_on` edge at `confidence:
'declared'`. The `depends_on` edge is UNCHANGED in identity; it merely GAINS `attrs.dstColumns` — NO separate
per-column edge is emitted. A dependency row with `referenced_minor_id = 0` (whole-object reference, e.g.
`SELECT *`) MUST NOT contribute a column — that dependency stays object grain (`attrs.dstColumns` unset). The
emission is a SOURCE-COLUMN SET; the adapter MUST NOT assert any output↔source mapping. A NULL/unresolved
referenced object MUST be skipped, never turned into a speculative column.

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

### Requirement: mssql view-column goldens re-blessed deliberately with exact sets

The golden-pinned `RawCatalog` and the end-to-end impact/path goldens MUST be re-blessed DELIBERATELY so the
`dbo.v_order_summary` view→table `depends_on` edges carry `attrs.dstColumns`, with L-009 exact-set
assertions: the edge endpoints, the sorted `attrs.dstColumns` array, AND `confidence: 'declared'` pinned; the
positive set AND the non-consumed negatives asserted; every unrelated byte unchanged. The extended
`SQL_MSSQL_DEPENDENCIES` MUST pass the engines write-verb scanner (catalog `SELECT` only).

#### Scenario: re-blessed goldens pin dstColumns, the declared confidence, and stay scanner-green

- GIVEN the materialized mssql torture database with the extended dependency query
- WHEN the pipeline runs extract → `normalizeCatalog` → `SqliteGraphStore` upsert → query
- THEN the re-blessed goldens carry the `dbo.v_order_summary` view→table `depends_on` edges with `attrs.dstColumns = [customer_id, order_id, status, total_amount]` (to `dbo.orders`) and `[order_id, product_id]` (to `dbo.order_items`), `confidence: 'declared'`, byte-identical on re-run (ADR-008)
- AND `SQL_MSSQL_DEPENDENCIES` passes the engines write-verb scanner
