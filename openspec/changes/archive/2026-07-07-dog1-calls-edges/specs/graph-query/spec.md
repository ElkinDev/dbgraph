# Delta for Graph Query

> Change `dog1-calls-edges`. The depth-limited impact closure now traverses `calls` edges as a
> READ-impact kind (`IMPACT_EDGE_KINDS += 'calls'`): a caller depends on its callee like a read, not a
> write, so `getImpact` reaches CALLERS through inbound `calls` chains while WRITE impact stays
> `writes_to`-only (a call is not a mutation). This spec is the CANONICAL home of the
> `IMPACT_EDGE_KINDS` traversal semantics; the `mcp-server` precheck/`whatToTest` delta CONSUMES this
> behavior. The two deltas are pinned BYTE-CONSISTENT over the mssql routine chain
> (`calls dbo.usp_refresh_totals → dbo.usp_log_change`): altering/dropping `dbo.usp_log_change` yields
> the exact set `{dbo.usp_refresh_totals}` in BOTH the graph-query READ closure and the mcp-server
> `whatToTest`. Output stays deterministic (ADR-008). Stories: US-014, US-007.

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
(Previously: `IMPACT_EDGE_KINDS` traversed inbound `writes_to`/`reads_from`/`depends_on`/`references`
only; a routine invoking another routine was unmodeled, so altering a called routine did NOT surface
its callers in the impact closure — the caller was invisible to `getImpact`.)

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
