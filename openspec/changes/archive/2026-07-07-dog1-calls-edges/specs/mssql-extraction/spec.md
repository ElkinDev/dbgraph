# Delta for MSSQL Extraction

> Change `dog1-calls-edges`. mssql sources `calls` edges from the CATALOG: `SQL_MSSQL_DEPENDENCIES`
> gains a `LEFT JOIN sys.objects ref ON ref.object_id = dep.referenced_id` exposing `ref.type`, mapped
> via the existing `moduleTypeToKind` and carried end-to-end on `RawDependency.target.kind`. A
> routine-target dependency becomes a `calls` edge at `confidence: 'declared'`. The existing
> `reads_from`/`writes_to` edges STAY `parsed` (their access is body-derived; a call has none). NEW
> torture routines exercise the path — none exist today, so `calls` coverage is currently ZERO and the
> latent proc→proc stub bug has no fixture to surface it. Stories: US-007, US-027.

## ADDED Requirements

### Requirement: Catalog-declared calls edges for routine invocations

The mssql adapter SHALL preserve the referenced object's KIND on `RawDependency.target.kind` by
joining `sys.objects` on `referenced_id` in `SQL_MSSQL_DEPENDENCIES` (`ref.type AS ref_object_type`),
threading it through `DepRow`, `map.ts` and `tokenizeModuleDeps` (which today drop it). When a
dependency's referenced object is a routine (`procedure` or `function`), the adapter MUST classify it
as a `calls` edge from the calling routine to the referenced routine with `confidence: 'declared'`
(the catalog establishes both identity and kind — no body parse). Dependencies to TABLES/VIEWS MUST
remain `reads_from`/`writes_to` at `confidence: 'parsed'`, UNCHANGED. A row with a NULL
`referenced_id` (unresolved / cross-database) MUST be skipped, never turned into a speculative edge.

#### Scenario: proc EXEC proc yields exactly one declared calls edge and no table stub

- GIVEN the torture procedure `dbo.usp_refresh_totals` whose body does `UPDATE dbo.order_totals ...` and `EXEC dbo.usp_log_change`, and the procedure `dbo.usp_log_change` whose body does `INSERT INTO dbo.audit_log ...`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `dbo.usp_refresh_totals` emits EXACTLY `{ calls dbo.usp_log_change (declared), writes_to dbo.order_totals (parsed) }`
- AND there is NO `reads_from`/`writes_to` edge to `dbo.usp_log_change` and NO `missing` `[table] usp_log_change` stub
- AND `dbo.usp_log_change` emits `{ writes_to dbo.audit_log (parsed) }` and ZERO `calls` edge

#### Scenario: function invoking a function yields a declared calls edge (target.kind = function)

- GIVEN the torture scalar function `dbo.fn_net_amount` whose body returns `dbo.fn_round_money(@x)`, and the scalar function `dbo.fn_round_money`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `dbo.fn_net_amount` emits EXACTLY one `calls dbo.fn_round_money` edge with `confidence: 'declared'`
- AND NO `reads_from`/`writes_to` edge and NO stub is created for `dbo.fn_round_money`

#### Scenario: routine touching only tables emits zero calls edges (negative)

- GIVEN an mssql procedure whose dependencies are only table reads and writes (e.g. an existing torture proc)
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN it emits its `reads_from`/`writes_to` edges as before and ZERO `calls` edge

### Requirement: mssql torture fixture exercises routine-calls-routine

The committed mssql torture `.sql` (`test/fixtures/mssql/`) SHALL add the routine-calls-routine
objects above — `dbo.usp_refresh_totals` (EXEC `dbo.usp_log_change`), `dbo.usp_log_change`,
`dbo.fn_net_amount` (calls `dbo.fn_round_money`), `dbo.fn_round_money`, and the supporting tables
`dbo.order_totals`/`dbo.audit_log` — using NEUTRAL names that leak no validation-database codename.
The golden-pinned `RawCatalog` and end-to-end impact/path goldens MUST be re-blessed DELIBERATELY to
include the new `calls` edges, with L-009 exact-set assertions (`src+dst+kind+confidence`, positives
AND the zero-stub negative). Every added edge assertion MUST pin BOTH endpoints; existence-only
assertions are insufficient.

#### Scenario: fixture adds the routine-calls-routine objects and re-blessed goldens pin the calls edges

- GIVEN the materialized mssql torture database with the new routine objects
- WHEN the adapter extracts it and the pipeline runs extract → normalize → upsert → query
- THEN the re-blessed `RawCatalog` and impact/path goldens contain the `calls` edges `dbo.usp_refresh_totals → dbo.usp_log_change` and `dbo.fn_net_amount → dbo.fn_round_money`, each `confidence: 'declared'`, with exact endpoints
- AND the graph contains ZERO phantom `[table]` stub for any routine, byte-identical on re-run (ADR-008)
