# Delta for schema-extraction (dog3-column-lineage)

> Thin delta: the adapter→core `RawCatalog` contract gains an OPTIONAL source-column path on view
> dependencies — `RawDependency.columns?: readonly string[]` — mirroring the DOG-2 `RawObject.parameters?`
> honest-absence precedent. Engines with a view-column catalog (mssql, pg) populate it; engines without
> (mysql, sqlite) leave it UNSET and stay byte-identical. Additive and OPTIONAL: NO port method, NO port SHAPE
> change. Stories: US-007, US-027, US-028.

## ADDED Requirements

### Requirement: Optional RawDependency.columns is an engine-agnostic source-column-set contract

The `RawCatalog` contract SHALL carry an OPTIONAL source-column path on view dependencies: a typed
`RawDependency.columns?: readonly string[]` (defined by `graph-model`) naming the SOURCE columns a view
consumes from that dependency's target table. Every adapter whose engine EXPOSES a view-column catalog (mssql
`sys.dm_sql_referenced_entities`; pg `information_schema.view_column_usage`) MUST populate it per view
dependency the catalog sources; every adapter whose engine exposes NO view-column catalog (mysql, sqlite) MUST
leave it UNSET. This path is ADDITIVE and OPTIONAL: it adds NO port method and
does NOT change the `SchemaAdapter` port SHAPE, and an adapter that does not populate `columns` MUST keep its
existing `RawCatalog` goldens BYTE-IDENTICAL (ADR-008). The set MUST be provenance `declared` (catalog-sourced)
— NEVER inferred, never body-parsed, never fabricated — and MUST distinguish "unknown" (UNSET: no
view-column catalog, a whole-object `SELECT *` reference, an unbindable source, or an extraction strategy that
does not carry the view-column family) from a real sourced set.
`columns` is a SOURCE-COLUMN SET only — it MUST NOT encode an OUTPUT-column ↔ source-column MAPPING (ADR-007).

#### Scenario: An adapter with a view-column catalog populates columns

- GIVEN an adapter whose engine exposes a view-column catalog
- WHEN `extract(scope)` returns its `RawCatalog`
- THEN a view's `RawDependency` to a source table carries a `columns` array of the source columns the catalog attributes to it
- AND that set is provenance `declared` (catalog-sourced), never inferred or body-parsed
- AND no new `SchemaAdapter` port method is introduced (the port SHAPE is unchanged)

#### Scenario: An engine without a view-column catalog leaves the field unset and stays byte-identical

- GIVEN an adapter whose engine exposes NO view-column catalog (e.g. mysql or sqlite)
- WHEN `extract(scope)` runs
- THEN no view `RawDependency` carries a `columns` field (UNSET, not `[]`) — honest absence
- AND that adapter's existing `RawCatalog` goldens remain BYTE-IDENTICAL (the field is purely additive)

#### Scenario: columns is a source set, never an output mapping (honesty)

- GIVEN a view whose SELECT renames or computes outputs from source columns
- WHEN its `RawDependency.columns` is populated
- THEN it lists ONLY the source `table.column`s the view reads
- AND it encodes NO correspondence from an output column to a source column (ADR-007)
