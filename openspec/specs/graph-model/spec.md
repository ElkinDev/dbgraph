# Graph Model Specification

## Purpose

The engine-agnostic domain vocabulary of dbgraph: node kinds, edge kinds, confidence, indexing
levels, the capability matrix and the `RawCatalog` input contract. This is the type layer every
later capability (storage, normalization, query) builds on. Stories: US-006, US-007 (model part),
US-003 (levels semantics). Per ADR-004 these types live in `src/core` and reference NO adapter,
driver, MCP or CLI symbol.

## Requirements

### Requirement: Node taxonomy

The model SHALL define node kinds spanning `database`, `schema`, `table`, `column`, `view`,
`trigger`, `procedure`, `function`, `index`, and `field` (document store). Every node MUST carry a
stable, deterministically derived identity (qualified name) and its kind. A node MAY be a stub
carrying `missing: true` (referenced object absent) or `excluded: true` (filtered object referenced
by an included one); the two flags are mutually exclusive.

#### Scenario: Each node declares kind and stable identity

- GIVEN a normalized `table` node `dbo.orders`
- WHEN its identity is read
- THEN the node exposes a deterministic qualified-name id and `kind: "table"`
- AND re-deriving the id from the same input yields the byte-identical string (ADR-008)

#### Scenario: Stub flags are mutually exclusive

- GIVEN a node value
- WHEN it carries `missing: true`
- THEN it MUST NOT also carry `excluded: true`
- AND a non-stub node carries neither flag

### Requirement: Edge taxonomy with event and dynamic-SQL flag

The model SHALL define edge kinds `references` (plus the aggregated table→table form),
`depends_on`, `reads_from`, `writes_to`, `fires_on`, `indexes`, and `inferred_reference`. An
`inferred_reference` edge is POPULATED by the opt-in inference engine (US-008): it carries
`confidence: inferred` and a numeric `score ∈ [0, 1]` (scoring is NO LONGER deferred). A `fires_on`
edge MUST carry its triggering `event` (e.g. `INSERT`, `UPDATE`, `DELETE`). A module node MUST be
able to carry `has_dynamic_sql: true` to declare analysis blindness (US-007).
(Previously: `inferred_reference` was "type only; scoring deferred to Phase 9, US-008".)

#### Scenario: fires_on carries its event

- GIVEN a `fires_on` edge from a trigger to a table
- WHEN the edge is inspected
- THEN it exposes an `event` field with the firing DML event

#### Scenario: inferred_reference carries a score in range

- GIVEN an `inferred_reference` edge emitted by the inference engine
- WHEN the edge is inspected
- THEN it carries `confidence: "inferred"` and a numeric `score`
- AND that `score` lies within the closed interval `[0, 1]`

### Requirement: Confidence classification

Every edge SHALL carry a `confidence` of exactly one of `declared`, `parsed`, or `inferred`.
Edges with `confidence: inferred` SHALL also carry a numeric `score`. `declared` and `parsed`
edges MUST NOT require a score.

#### Scenario: Declared FK edge is declared with no score

- GIVEN an edge derived from a database-declared foreign key
- WHEN its confidence is read
- THEN it equals `declared`
- AND no `score` is required

#### Scenario: Inferred edge always carries a score

- GIVEN an edge with `confidence: inferred`
- WHEN it is validated
- THEN a numeric `score` is present

### Requirement: Indexing levels with conservative defaults

The model SHALL define three indexing levels per object type — `off`, `metadata`, `full` (ADR-003).
`off` means the object is absent from the graph yet its absence reason is queryable. `metadata`
means node plus edges present, no body, no FTS body. `full` means body present and FTS-indexed.
Defaults MUST be: triggers `full`; procedures and functions `metadata`; statistics and sampling
`off`; structural core (tables, columns, PK/FK, indexes, views) always present.

#### Scenario: Default level resolution

- GIVEN a `CapabilityMatrix` with no explicit per-type level overrides
- WHEN default levels are resolved
- THEN triggers resolve to `full`, procedures and functions to `metadata`, statistics and sampling to `off`

#### Scenario: off level is an absence, not silence

- GIVEN an object type configured `off`
- WHEN the model represents that type
- THEN no node of that type is produced
- AND a queryable absence reason ("not indexed by configuration") is representable

### Requirement: CapabilityMatrix, ExtractionScope and RawCatalog contracts

The model SHALL define a `CapabilityMatrix` (which object types an engine supports and their
configured levels), an `ExtractionScope` (include/exclude intent plus an OPTIONAL
`inferRelationships?: boolean` gate, default `false`, that opts the normalizer into structural
inference — US-008), and a `RawCatalog` — the engine-agnostic, pre-normalization input carrying raw
tables, columns, keys, views, triggers, procedures/functions (with read/write references) and
indexes. These contracts MUST be expressible without importing any adapter or driver symbol
(ADR-004). The `inferRelationships` field MUST be OPTIONAL with a default of `false` so that every
existing call site remains valid unchanged.
(Previously: `ExtractionScope` was described as include/exclude intent only; no `inferRelationships` field.)

#### Scenario: RawCatalog is the normalizer's sole structural input

- GIVEN a `RawCatalog` value
- WHEN it is constructed in a test
- THEN it requires no database connection and no adapter import
- AND it fully describes tables, columns, keys, views, triggers, modules and indexes for normalization

#### Scenario: CapabilityMatrix gates object types

- GIVEN a `CapabilityMatrix` that does not declare `procedure` support (e.g. a store like SQLite)
- WHEN the supported types are queried
- THEN `procedure` is reported as unsupported

#### Scenario: inferRelationships is optional and defaults to off

- GIVEN an `ExtractionScope` constructed WITHOUT the `inferRelationships` field
- WHEN the scope is used to normalize a catalog
- THEN it is valid (the field is optional) and inference is treated as OFF (the prior default behavior)
- AND an `ExtractionScope` MAY set `inferRelationships: true` to opt into inference
