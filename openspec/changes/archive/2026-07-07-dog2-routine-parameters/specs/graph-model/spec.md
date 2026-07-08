# Graph Model Delta (dog2-routine-parameters)

> Additive payload contract. No new node/edge kind, no impact/traversal change.

## ADDED Requirements

### Requirement: Routine parameters payload contract

The model SHALL define an OPTIONAL `RoutinePayload.parameters?: readonly RoutineParameter[]` accessor
view and a mirroring OPTIONAL `RawObject.parameters?: readonly RawParameter[]` adapter→core contract.
Each parameter view MUST carry `name` (verbatim, engine-native — INCLUDING any sigil such as `@`),
`dataType` (the RAW catalog type STRING, composed IDENTICALLY to how the SAME engine composes COLUMN
`dataType` — NO cross-engine normalization), `direction: 'in' | 'out' | 'inout'`, `ordinal: number`,
and an OPTIONAL `hasDefault?: boolean`. Parameters MUST be ordered by ascending `ordinal`
(deterministic, ADR-008). `parameters` MUST be OPTIONAL: an engine with NO parameter catalog (e.g.
SQLite) leaves it UNSET, distinguishing "unknown" from "known-zero" — a real empty signature MAY carry
an empty array. Parameters are ALWAYS provenance `declared` (catalog-sourced) — NEVER `inferred`
(US-008 untouched). `hasDefault` MUST be present ONLY where a real catalog FLAG sources it; it MUST NOT
be fabricated where the catalog cannot express it.

#### Scenario: parameter view carries name, raw type, direction and ordinal

- GIVEN a normalized routine node with two declared parameters
- WHEN its `parameters` view is read
- THEN each parameter exposes `name`, `dataType` (raw engine type string), `direction` and `ordinal`
- AND the parameters are ordered by ascending `ordinal`, byte-identical on re-derivation (ADR-008)

#### Scenario: absent parameter catalog leaves the field unset (honest absence)

- GIVEN a routine from an engine whose `CapabilityMatrix` declares no parameter catalog
- WHEN its payload is read
- THEN `parameters` is UNSET (undefined) — NOT an empty array — separating "unknown" from "known-zero"

#### Scenario: hasDefault only where the catalog sources it

- GIVEN one engine exposing a catalog default flag and another exposing NO default column
- WHEN parameters are mapped
- THEN `hasDefault` is present only for the former; the latter OMITS the field entirely (never fabricated)
