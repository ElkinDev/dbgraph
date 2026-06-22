# Delta for Graph Normalization

> Phase 9a (US-008). Adds the SHARED, opt-in, pure-core structural-inference behavior to the
> normalizer: `inferReferences` emits scored, thresholded, deterministic `inferred_reference`
> edges from node NAMES and TYPES alone. Default OFF — the four shipped SQL engines stay
> byte-identical to their goldens.
>
> Purpose-line amendment: the canonical `Purpose` sentence "Inference scoring (US-008) is
> DEFERRED to Phase 9." is REPLACED by "Inference scoring (US-008) is realized by the opt-in,
> pure-core inference engine (`src/core/infer/`); it is OFF by default."

## ADDED Requirements

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

## MODIFIED Requirements

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
