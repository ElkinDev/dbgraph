# Delta for Graph Model

> Phase 9a (US-008). No structural type change — `inferred_reference`, `confidence: 'inferred'`
> and `GraphEdge.score` already exist. This delta (1) lifts the "scoring deferred to Phase 9"
> wording now that scoring is REAL and POPULATED, and (2) documents the new optional
> `ExtractionScope.inferRelationships?: boolean` field (default `false`) that gates inference.

## MODIFIED Requirements

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
