# Graph Normalization Specification

## Purpose

Conversion of a `RawCatalog` into dialect-agnostic nodes and edges so queries behave identically
across the five engines. Covers reference resolution, composite-FK aggregation, read/write/fires_on
edges, stub creation, level honoring, and dynamic-SQL blindness. Stories: US-006, US-007 (model
part), US-003 (levels), US-004 (excluded stubs). Output MUST be deterministic — same `RawCatalog`
yields byte-identical nodes and edges (ADR-008). The normalizer MUST import nothing outside
`src/core` (ADR-004). Inference scoring (US-008) is DEFERRED to Phase 9.

## Requirements

### Requirement: Catalog-to-graph node and edge production

The normalizer SHALL convert each `RawCatalog` object into its corresponding node and produce
`references`, `depends_on` and `fires_on` edges for declared relationships. A declared foreign key
MUST yield a `references` edge with `confidence: declared`; a view's dependency on its source MUST
yield `depends_on`; a trigger's binding to its table MUST yield `fires_on` with the event.

#### Scenario: Minimal fixture normalizes to the golden graph

- GIVEN the `catalog-minimal.json` fixture (2 tables, 1 FK, 1 view, 1 trigger)
- WHEN it is normalized
- THEN the graph contains the expected `table`, `column`, `view` and `trigger` nodes
- AND exactly one `references`, one `depends_on` and one `fires_on` edge, matching the golden file

### Requirement: Composite foreign keys aggregate

For a foreign key spanning multiple columns, the normalizer SHALL emit one `references` edge per
column pair AND exactly one aggregated table→table `references` edge. The aggregated edge MUST be
distinguishable from the per-column edges.

#### Scenario: Two-column FK yields per-pair plus aggregated edge

- GIVEN a `RawCatalog` with a foreign key over two columns
- WHEN it is normalized
- THEN two column-level `references` edges are produced (one per column pair)
- AND exactly one aggregated table→table `references` edge is produced

### Requirement: Read and write edges from module bodies

When a module body is analyzable, the normalizer SHALL produce `reads_from` and `writes_to` edges
with `confidence: parsed`. A statement reading a table yields `reads_from`; a statement writing a
table yields `writes_to`. A trigger that writes a table MUST produce `writes_to` in addition to its
`fires_on` edge.

#### Scenario: Procedure read and write edges

- GIVEN a procedure whose body does `INSERT INTO a` and `SELECT FROM b`
- WHEN it is normalized
- THEN `writes_to(proc → a)` and `reads_from(proc → b)` exist with `confidence: parsed`

#### Scenario: Trigger fires and writes

- GIVEN an `AFTER UPDATE` trigger on `orders` that writes to `audit`
- WHEN it is normalized
- THEN `fires_on(trigger → orders, event = UPDATE)` and `writes_to(trigger → audit)` exist

### Requirement: Dynamic SQL declares blindness

When a module body contains non-analyzable dynamic SQL, the normalizer SHALL mark the module node
`has_dynamic_sql: true` rather than silently omitting edges. The graph MUST declare its blindness
instead of hiding it (US-007).

#### Scenario: Non-analyzable dynamic SQL is flagged

- GIVEN a module whose body builds and executes dynamic SQL that cannot be statically analyzed
- WHEN it is normalized
- THEN the module node carries `has_dynamic_sql: true`

### Requirement: Stub nodes never let the graph lie

A reference to a missing object SHALL NOT fail normalization; instead the normalizer creates a stub
node `missing: true` and reports it in the normalization result. A reference from an included object
to an excluded one SHALL keep the edge and create a stub node `excluded: true`. In both cases the
relationship is preserved (US-006, US-004).

#### Scenario: Dangling reference becomes a missing stub

- GIVEN a `RawCatalog` with a view over a dropped table
- WHEN it is normalized
- THEN normalization succeeds, a stub node with `missing: true` is created for the dropped table
- AND that stub is reported in the normalization result

#### Scenario: Excluded target keeps the edge

- GIVEN an included table with a foreign key to a table excluded by filters
- WHEN it is normalized
- THEN the `references` edge is preserved
- AND its target is a stub node with `excluded: true`

### Requirement: Level honoring during normalization

The normalizer SHALL honor configured per-type levels (ADR-003). At `off` the object produces no
node and a queryable absence reason. At `metadata` the node and its edges are produced but no body
is retained and nothing is queued for FTS body indexing. At `full` the body is retained and queued
for FTS indexing.

#### Scenario: metadata keeps the node and edges but not the body

- GIVEN a procedure type configured `metadata`
- WHEN the catalog is normalized
- THEN the procedure node and its reads/writes edges exist
- AND no body content is retained for that node

#### Scenario: off omits the node but records the reason

- GIVEN the `indexes` type configured `off`
- WHEN the catalog is normalized
- THEN no `index` node is produced
- AND a queryable absence reason ("indexes not indexed by configuration") is recorded for affected tables

### Requirement: Boundary and determinism

The normalizer SHALL import nothing outside `src/core` (ADR-004) and SHALL produce deterministic
output: the same `RawCatalog` MUST yield byte-identical nodes and edges across runs (ADR-008).

#### Scenario: Deterministic, boundary-clean normalization

- GIVEN the same `RawCatalog` fixture normalized twice
- WHEN the two outputs are serialized
- THEN they are byte-identical
- AND a boundary lint over the normalizer reports no import outside `src/core`
