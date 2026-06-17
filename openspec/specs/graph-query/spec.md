# Graph Query Specification

## Purpose

The read-only query engine powering future MCP tools: neighbors, depth-limited impact closure,
shortest join path, and full-text search over the persisted graph. These are the Phase-1 engine
primitives behind US-013 (related), US-014 (impact), US-015 (path) and US-011 (search); the MCP
compact output format (US-019) is DEFERRED to Phase 5. All query output MUST be deterministic —
same graph plus same arguments yields byte-identical results (ADR-008). Queries read the graph
through the `GraphStore` port (ADR-004).

## Requirements

### Requirement: Neighbors grouped by edge kind with explicit direction

The engine SHALL return a node's direct neighbors grouped by edge kind, each neighbor annotated with
its explicit direction (inbound or outbound). Inferred edges MUST be returned as a distinguished
group carrying their score. An optional `kinds` filter MUST restrict the result to the requested edge
kinds; absent it, all kinds are returned.

#### Scenario: Neighbors grouped with direction

- GIVEN a table with inbound FKs, outbound FKs, a dependent view and a trigger writing it
- WHEN neighbors are requested without a `kinds` filter
- THEN the result groups them by edge kind (`references` in/out, `depends_on`, `writes_to`, `fires_on`)
- AND each entry states its direction

#### Scenario: kinds filter restricts edge kinds

- GIVEN the same node
- WHEN neighbors are requested with `kinds: ["references"]`
- THEN only `references` edges are returned, still annotated with direction

### Requirement: Depth-limited impact closure separating read and write

The engine SHALL compute the transitive impact closure of a node as a visible dependency chain
(a→b→c), not a flat set, SEPARATING read impact from write impact. The walk MUST be bounded by a
`depth` argument (default 3) with a truncation warning when the limit is hit, and MUST terminate on
cyclic graphs via a visited set. If any object in a chain carries `has_dynamic_sql`, the result MUST
include an "impact possibly incomplete" warning.

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

### Requirement: Shortest join path with hop join columns

The engine SHALL return the shortest path between two nodes over `references` edges, exposing the
exact join columns of each hop. If the only available route uses inferred edges, the path MUST be
returned marked as inferred. If no route exists, the engine MUST report the absence and suggest the
closest neighbors of each endpoint.

#### Scenario: Shortest path exposes join columns

- GIVEN tables `customers` and `shipments` connected through declared FKs
- WHEN a path is requested between them
- THEN the shortest route is returned with the exact join columns of each hop

#### Scenario: Inferred-only route is marked

> **Deferred to Phase 9 (US-008)** — inferred edges cannot exist before the inference engine.
> In Phase 1, `findJoinPath` traverses only declared/parsed `references` edges; no
> `inferred_reference` edges are emitted by the normalizer. This scenario will be re-verified
> when the scoring engine (US-008) is implemented. Consistent with other Phase-9 deferrals in this spec.

- GIVEN two tables connected solely by `inferred_reference` edges
- WHEN a path is requested
- THEN the route is returned and marked as inferred

#### Scenario: No route reports neighbors

- GIVEN two tables with no connecting route
- WHEN a path is requested
- THEN the engine reports that no route exists and suggests the closest neighbors of each endpoint

### Requirement: Full-text search over indexed bodies and names

The engine SHALL search nodes by name and by the FTS-indexed content of `full`-level objects,
returning ranked hits each carrying its type and qualified name. Bodies of objects at `metadata` or
`off` MUST NOT be matched on body content.

#### Scenario: Ranked FTS search with typo tolerance over names

- GIVEN a graph containing `customers`
- WHEN a search for the approximate term `custmer` is run
- THEN `customers` is returned among ranked hits, each carrying type and qualified name

#### Scenario: Only full bodies are searchable

- GIVEN one `full` and one `metadata` object whose bodies both contain a token
- WHEN that token is searched
- THEN only the `full` object matches on body content

### Requirement: End-to-end Definition of Done over the fixture graph

GIVEN the Definition-of-Done fixture `RawCatalog` (2 tables, 1 composite FK, 1 view, 1 trigger, and
1 procedure with reads and writes) normalized and persisted, the engine SHALL satisfy golden
expectations for neighbors, impact, path and FTS search, and SHALL be deterministic.

#### Scenario: Golden query results over the persisted fixture

- GIVEN the DoD fixture normalized and persisted to a `GraphStore`
- WHEN neighbors, impact, path and FTS search are run against it
- THEN each result matches its golden file (including the composite-FK aggregated edge and the read/write split)

#### Scenario: Deterministic byte-identical output

- GIVEN the same persisted fixture graph and the same query arguments
- WHEN any query runs twice
- THEN the two outputs are byte-identical (ADR-008)
