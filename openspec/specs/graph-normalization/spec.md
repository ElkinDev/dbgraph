# Graph Normalization Specification

## Purpose

Conversion of a `RawCatalog` into dialect-agnostic nodes and edges so queries behave identically
across the five engines. Covers reference resolution, composite-FK aggregation, read/write/fires_on
edges, stub creation, level honoring, and dynamic-SQL blindness. Stories: US-006, US-007 (model
part), US-003 (levels), US-004 (excluded stubs). Output MUST be deterministic — same `RawCatalog`
yields byte-identical nodes and edges (ADR-008). The normalizer MUST import nothing outside
`src/core` (ADR-004). Inference scoring (US-008) is realized by the opt-in, pure-core inference
engine (`src/core/infer/`); it is OFF by default.

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

### Requirement: Opt-in structural inference of references

When inference is enabled via the opt-in gate, the normalizer SHALL emit `inferred_reference`
edges (`confidence: inferred`) derived from node NAMES and declared TYPES only. Each emitted edge
MUST carry a numeric `score` in the closed interval `[0, 1]` and MUST record its join grain in
`attrs.srcColumn` (the matched column/field) and `attrs.dstColumn` (the resolved target column).
An edge SHALL be emitted ONLY when its `score` meets the documented threshold; a candidate whose
score is below the threshold MUST NOT produce an edge. Inference MUST NOT read raw data values —
only names and types already present in the graph (dbgraph-security).

#### Scenario: High-confidence match emits a scored inferred edge

- GIVEN a fixture `NodeMap` with `orders.customer_id` (int) and `customers.id` (int, primary key) and NO declared FK between them
- WHEN the catalog is normalized with inference enabled
- THEN exactly one `inferred_reference` edge from `orders.customer_id` to `customers.id` is emitted
- AND it carries `confidence: inferred` and a `score` of at least `0.8` (convention + compatible type + PK target)
- AND `attrs.srcColumn = "customer_id"` and `attrs.dstColumn = "id"`

#### Scenario: Weak match below threshold emits no edge

- GIVEN a fixture `NodeMap` whose only candidate match scores strictly below the documented threshold
- WHEN the catalog is normalized with inference enabled
- THEN NO `inferred_reference` edge is emitted for that candidate
- AND no other inferred edge is invented in its place

### Requirement: Name-convention matching against real targets

The inference engine SHALL recognize the column/field naming conventions `<entity>_id`, `<entity>Id`
and `id_<entity>`, extract the candidate entity name, and resolve it against ACTUAL target nodes
trying BOTH the singular and plural forms (e.g. `customer_id` resolves to a `customers` OR a
`customer` table). A candidate that resolves to NO existing target node MUST NOT produce an edge
(no invented targets). Every asserted edge MUST pin its exact source and destination qualified names
(L-009 exact-set — never existence-only).

#### Scenario: `<entity>_id` (snake) resolves to a plural target

- GIVEN a `NodeMap` with `orders.customer_id` (int) and target table `customers` with PK `id` (int)
- WHEN the catalog is normalized with inference enabled
- THEN an `inferred_reference` edge from `orders.customer_id` to `customers.id` is emitted (exact src+dst qnames) with a numeric `score`

#### Scenario: `<entity>Id` (camel) resolves to a singular target

- GIVEN a `NodeMap` with `invoices.customerId` (int) and target table `customer` with PK `id` (int)
- WHEN the catalog is normalized with inference enabled
- THEN an `inferred_reference` edge from `invoices.customerId` to `customer.id` is emitted (exact src+dst qnames) with a numeric `score`

#### Scenario: `id_<entity>` (prefix) resolves against a real target

- GIVEN a `NodeMap` with `lines.id_product` (int) and target table `products` with PK `id` (int)
- WHEN the catalog is normalized with inference enabled
- THEN an `inferred_reference` edge from `lines.id_product` to `products.id` is emitted (exact src+dst qnames) with a numeric `score`

#### Scenario: No matching target invents no edge

- GIVEN a `NodeMap` with `orders.status_id` (int) and NO `status` or `statuses` target node present
- WHEN the catalog is normalized with inference enabled
- THEN NO `inferred_reference` edge is emitted for `orders.status_id` (negative golden)

### Requirement: Type compatibility gates inferred edges

The inference engine SHALL emit an `inferred_reference` edge only when the source column/field type
is compatible with the resolved target column type. `int` and `bigint` MUST be treated as compatible;
`ObjectId` MUST be treated as compatible with an `_id` identity field; `string` MUST be compatible
with `string`. An incompatible type family (e.g. a `string` source against an `int` target identity)
MUST NOT yield an edge — equivalently, it scores below the threshold and is dropped.

#### Scenario: Compatible int/bigint match is emitted

- GIVEN a `NodeMap` with `orders.customer_id` (int) and `customers.id` (bigint, PK)
- WHEN the catalog is normalized with inference enabled
- THEN an `inferred_reference` edge from `orders.customer_id` to `customers.id` is emitted with a numeric `score` (int↔bigint are compatible)

#### Scenario: Incompatible types yield no edge

- GIVEN a `NodeMap` with `orders.customer_id` declared `string` and `customers.id` (int, PK)
- WHEN the catalog is normalized with inference enabled
- THEN NO `inferred_reference` edge from `orders.customer_id` to `customers.id` is emitted (type families incompatible)

### Requirement: Inference is opt-in and OFF by default

The normalizer SHALL invoke inference ONLY when `ExtractionScope.inferRelationships === true` OR
the graph contains `collection`/`field` nodes (the documented secondary auto-trigger). When neither
condition holds — the DEFAULT for every shipped SQL `ExtractionScope` — the normalizer MUST NOT emit
any `inferred_reference` edge, and its declared/parsed edge output MUST be byte-identical to the
output produced before this change. Enabling the gate MUST be the ONLY way an `inferred_reference`
edge appears.

#### Scenario: Gate OFF on an SQL fixture is byte-identical to its golden

- GIVEN the existing `catalog-minimal.json` SQL fixture and an `ExtractionScope` with `inferRelationships` unset and no `collection`/`field` nodes
- WHEN it is normalized
- THEN NO `inferred_reference` edge appears in the graph
- AND the serialized edge array is BYTE-IDENTICAL to the committed golden `test/golden/normalize/catalog-minimal.json` (the four shipped SQL engines untouched)

#### Scenario: Gate ON surfaces inferred edges

- GIVEN a `NodeMap` with a high-confidence convention+type match and an `ExtractionScope` with `inferRelationships: true`
- WHEN it is normalized
- THEN at least one `inferred_reference` edge (`confidence: inferred`, numeric `score`) appears that was ABSENT when the gate was OFF

### Requirement: Deterministic ordering of inferred edges

The inference engine SHALL return its emitted edges in a deterministic order — by `src`, then `dst`,
then `score`, then `attrs.srcColumn`, with the deterministic `id` as the final tie-break — so the
resulting `RawCatalog`/graph is golden-pinnable. The same input `NodeMap` MUST yield a byte-identical
inferred-edge array across runs (ADR-008). The ordering MUST NOT depend on `score` being honored by
the normalizer's shared edge comparator (which is score-blind); the engine self-orders before
returning.

#### Scenario: Multiple candidate matches order deterministically

- GIVEN a fixture `NodeMap` producing several inferred edges with differing `src`/`dst`/`score`
- WHEN it is normalized with inference enabled twice
- THEN both runs emit the inferred edges in the identical order (by `src`, `dst`, `score`, `srcColumn`, then `id`)
- AND the two serialized edge arrays are byte-identical (ADR-008), matching the golden

### Requirement: Boundary and determinism

The normalizer SHALL import nothing outside `src/core` (ADR-004) and SHALL produce deterministic
output: the same `RawCatalog` MUST yield byte-identical nodes and edges across runs (ADR-008). The
inference engine under `src/core/infer/` SHALL likewise import nothing outside the core model types
(no adapter, driver, cli, mcp, `child_process`, or I/O) and SHALL be deterministic: the same input
`NodeMap` MUST yield a byte-identical `inferred_reference` edge array.
(Previously: covered only the normalizer; did not mention the `src/core/infer/` boundary or its determinism.)

#### Scenario: Deterministic, boundary-clean normalization

- GIVEN the same `RawCatalog` fixture normalized twice
- WHEN the two outputs are serialized
- THEN they are byte-identical
- AND a boundary lint over the normalizer reports no import outside `src/core`

#### Scenario: Inference engine is boundary-clean and deterministic

- GIVEN the `src/core/infer/` module
- WHEN a boundary lint runs over it
- THEN it reports no import outside the core model types (no adapter/driver/cli/mcp/`child_process`/I/O)
- AND the same input `NodeMap` normalized twice yields a byte-identical `inferred_reference` edge array
