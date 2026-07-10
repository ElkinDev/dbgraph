# Delta for graph-query (dog3-column-lineage)

> Under Model A, a view→table `depends_on` edge carries the consumed source-column SET in `attrs.dstColumns`
> (declared on mssql/pg — graph-model). This makes impact column-PRECISE: `getImpact` (and precheck/affected
> via the shared engine) now FILTERS the dependent views on a COLUMN pivot by `attrs.dstColumns` membership —
> a BEHAVIOR change to the impact closure, so this MODIFIES the DOG-1 impact-closure requirement rather than
> adding a parallel one (extends the same MODIFIED chain). The read/write split, depth bound, cycle
> termination, `calls`-as-read semantics, and the table-pivot result are UNCHANGED. Stories: US-014.

## MODIFIED Requirements

### Requirement: Depth-limited impact closure separating read and write

The engine SHALL compute the transitive impact closure of a node as a visible dependency chain
(a→b→c), not a flat set, SEPARATING read impact from write impact. The set of traversed edge kinds
(`IMPACT_EDGE_KINDS`) SHALL include `calls`, followed as a READ-impact kind — a caller depends on its
callee like a read, not a write — so the impact closure of a routine reaches its CALLERS through
inbound `calls` edges, while WRITE impact remains `writes_to`-only (a call is not a mutation). The walk
MUST be bounded by a `depth` argument (default 3) with a truncation warning when the limit is hit, and
MUST terminate on cyclic graphs via a visited set. If any object in a chain carries `has_dynamic_sql`,
the result MUST include an "impact possibly incomplete" warning.

Where a view's `depends_on` edge carries a consumed source-column set (`attrs.dstColumns`, declared on
mssql/pg — graph-model), an impact query pivoted on a COLUMN node MUST FILTER the dependent views by
column MEMBERSHIP: a view whose `depends_on` edge INCLUDES the pivot column in `attrs.dstColumns` is
affected; a view whose edge EXCLUDES it MUST be ABSENT (column-grain precision). A view whose
`depends_on` edge carries NO `attrs.dstColumns` (degraded engines mysql/sqlite, or uncovered pg pairs)
MUST be INCLUDED at object grain (absence = conservative include, no false negative). Impact pivoted on a
TABLE node MUST be UNCHANGED — the view→table `depends_on` edge still surfaces every dependent view
regardless of `attrs.dstColumns`. Output MUST remain deterministic and byte-identical on re-run (ADR-008).
(Previously: `IMPACT_EDGE_KINDS` traversed inbound `writes_to`/`reads_from`/`depends_on`/`references`
only; a routine invoking another routine was unmodeled, so altering a called routine did NOT surface its
callers in the impact closure — the caller was invisible to `getImpact`.)
(Previously: a column-node pivot surfaced EVERY view over the column's table — `getImpact` did NOT filter
view `depends_on` edges by `attrs.dstColumns`, so dropping a column marked every view over the table as
affected, even views that never read it.)

#### Scenario: Impact separates read from write with visible chain

- GIVEN `orders.status` referenced by an index, a view selecting it, a proc reading it and a trigger writing it
- WHEN impact is requested
- THEN the result lists the dependency CHAIN for each path (not just the set)
- AND READ impact is reported separately from WRITE impact

#### Scenario: Depth limit truncates with a warning

- GIVEN a chain deeper than the requested `depth`
- WHEN impact is requested with that `depth`
- THEN the walk stops at the limit and the result carries a truncation warning

#### Scenario: Cyclic graph terminates

- GIVEN a graph containing a dependency cycle
- WHEN impact is requested
- THEN the walk terminates (visited set) without revisiting nodes

#### Scenario: Dynamic SQL in the chain warns of incompleteness

- GIVEN an impact chain that includes a node with `has_dynamic_sql: true`
- WHEN impact is requested
- THEN the result includes an "impact possibly incomplete" warning

#### Scenario: Impact of a called routine reaches its callers through the inbound calls chain

- GIVEN the mssql torture graph normalized and persisted, containing the edge `calls dbo.usp_refresh_totals → dbo.usp_log_change` (the caller invokes the callee)
- WHEN the impact closure of `dbo.usp_log_change` is requested
- THEN its READ impact is EXACTLY `{dbo.usp_refresh_totals}`, reached through the inbound `calls` edge
- AND `dbo.usp_refresh_totals` appears in NO write-impact set (a `calls` edge is READ-impact, not write)
- AND the output is byte-identical on re-run (ADR-008)

#### Scenario: dropping a consumed column surfaces the consuming view (exact set)

- GIVEN the mssql torture graph where `dbo.v_order_summary`'s `depends_on` edge to `dbo.order_items` carries `attrs.dstColumns` INCLUDING `product_id`, `confidence: 'declared'`
- WHEN impact is requested on the COLUMN node `dbo.order_items.product_id`
- THEN the affected views are EXACTLY `{dbo.v_order_summary}` (it reads `product_id` via `COUNT(oi.product_id)`), reported in READ impact
- AND the output is byte-identical on re-run (ADR-008)

#### Scenario: dropping a non-consumed column of the same table excludes the view (negative, precision)

- GIVEN the same graph; `dbo.v_order_summary`'s `depends_on` edge to `dbo.order_items` does NOT list `region_id` in `attrs.dstColumns`
- WHEN impact is requested on the COLUMN node `dbo.order_items.region_id`
- THEN `dbo.v_order_summary` is ABSENT from the affected views (column-grain precision)
- AND under the pre-DOG-3 table-grain behavior it WOULD have surfaced — this is a DELIBERATE precision improvement, re-blessed with justification

#### Scenario: table pivot impact is unchanged

- GIVEN the same graph
- WHEN impact is requested on the TABLE node `dbo.order_items`
- THEN `dbo.v_order_summary` is surfaced (unchanged object-grain impact via its view→table `depends_on` edge, regardless of `attrs.dstColumns`)

#### Scenario: degraded engine keeps table-grain view impact

- GIVEN a mysql or sqlite graph (view `depends_on` edges carry no `attrs.dstColumns`)
- WHEN impact is requested on a column node of a table that a view reads
- THEN view impact resolves at object grain (every view over the table) — the honest degrade-by-absence, unchanged
