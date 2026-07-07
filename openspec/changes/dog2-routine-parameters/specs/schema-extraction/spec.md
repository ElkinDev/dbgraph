# Schema Extraction Delta (dog2-routine-parameters)

> THIN additive port-contract note. Registers the engine-agnostic OPTIONAL `RawObject.parameters?`
> obligation every adapter must honor — mirroring the existing "Optional RawField model path" precedent
> in this capability. It adds NO `SchemaAdapter` port method and does NOT change the port SHAPE; the
> `RawParameter` type itself is defined by `graph-model`.

## ADDED Requirements

### Requirement: Optional RawObject.parameters is an engine-agnostic, honest-absence contract

The `RawCatalog` contract SHALL carry an OPTIONAL routine-parameter path: a typed `RawParameter` (defined
by `graph-model`) under an OPTIONAL `RawObject.parameters?`. Every adapter whose engine EXPOSES a
parameter catalog (mssql `sys.parameters`, pg `pg_proc` argument arrays, mysql
`information_schema.PARAMETERS`) MUST populate it on each procedure/function `RawObject`; every adapter
whose engine exposes NO parameter catalog (sqlite) MUST leave it UNSET. This path is ADDITIVE and
OPTIONAL: it adds NO port method and does NOT change the `SchemaAdapter` port SHAPE, and an adapter that
does not populate `parameters` MUST keep its existing `RawCatalog` goldens BYTE-IDENTICAL (ADR-008).
Parameters MUST be provenance `declared` (catalog-sourced) — NEVER inferred, never fabricated — ordered
by ascending `ordinal`, and MUST distinguish "unknown" (UNSET, no parameter catalog) from "known-zero"
(an empty array for a real no-argument routine). Per-engine `dataType` composition follows the SAME
engine's COLUMN `dataType` convention (`graph-model`); this port contract does NOT normalize type strings
across engines.

#### Scenario: An adapter with a parameter catalog populates parameters

- GIVEN an adapter whose engine exposes a routine-parameter catalog
- WHEN `extract(scope)` returns its `RawCatalog`
- THEN each procedure/function `RawObject` carries a `parameters` array of `RawParameter` in ascending `ordinal`
- AND the array is provenance `declared` (catalog-sourced), never inferred
- AND no new `SchemaAdapter` port method is introduced (the port SHAPE is unchanged)

#### Scenario: An engine without a parameter catalog leaves the field unset and stays byte-identical

- GIVEN an adapter whose engine exposes NO parameter catalog (e.g. sqlite)
- WHEN `extract(scope)` runs
- THEN no `RawObject` carries a `parameters` field (UNSET, not `[]`) — honest absence, declared
- AND that adapter's existing `RawCatalog` goldens remain BYTE-IDENTICAL (the field is purely additive)
