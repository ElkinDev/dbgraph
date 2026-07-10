# Delta for graph-normalization (dog3-column-lineage)

> Thin delta: `buildDependencyEdges` (`reference-resolver.ts`) now STAMPS the consumed source-column set from
> `RawDependency.columns` (schema-extraction) as sorted-unique `attrs.dstColumns` on the EXISTING view→table
> `depends_on` edge (Model A — ZERO new edges, ZERO column-node targets). ADR-008 canonical ordering is
> centralized HERE so every engine is consistent regardless of adapter row order. Absent set → `attrs {}`,
> byte-identical to the pre-DOG-3 edge. Stories: US-006, US-007.

## ADDED Requirements

### Requirement: buildDependencyEdges stamps the consumed source-column set as sorted-unique attrs.dstColumns

When a `RawDependency` for a view carries a source-column set (`RawDependency.columns` — schema-extraction),
the normalizer's `buildDependencyEdges` SHALL stamp it, SORTED-UNIQUE, onto the resulting view→source-table
`depends_on` edge as `attrs.dstColumns`. Ordering MUST be CODE-POINT ASCENDING on the column NAME string,
deduplicated, so the serialized edge is golden-pinnable and byte-identical on re-run (ADR-008) — because
`stableStringify` preserves array order, the sort is MANDATORY and centralized in the normalizer, applied
identically for every engine regardless of adapter row order. A `RawDependency` with NO source-column set
MUST leave `attrs.dstColumns` UNSET → the edge is byte-identical to the pre-DOG-3 object-grain `depends_on`
edge (`attrs {}`). The normalizer MUST NOT emit any per-column `depends_on` edge and MUST NOT create any
column-node target — the column grain is carried SOLELY in `attrs.dstColumns` on the existing view→table edge
(Model A).

#### Scenario: a view dependency with a source-column set stamps sorted-unique dstColumns

- GIVEN a `RawDependency` from a view to table `t` carrying `columns: ['status', 'order_id', 'order_id', 'customer_id']` (unsorted, with a duplicate)
- WHEN the catalog is normalized
- THEN the view→`t` `depends_on` edge carries `attrs.dstColumns = ['customer_id', 'order_id', 'status']` (sorted code-point ascending, deduplicated)
- AND NO per-column `depends_on` edge and NO column-node target is emitted

#### Scenario: ordering is deterministic and byte-identical on re-run

- GIVEN the same `RawCatalog` normalized twice
- WHEN the two `depends_on` edge arrays are serialized
- THEN each `attrs.dstColumns` is in identical code-point ascending order and the two serializations are byte-identical (ADR-008)

#### Scenario: a dependency with no source-column set stays byte-identical object grain

- GIVEN a `RawDependency` for a view whose `columns` is UNSET
- WHEN the catalog is normalized
- THEN the resulting `depends_on` edge leaves `attrs.dstColumns` UNSET (`attrs {}`)
- AND the serialized edge is byte-identical to its pre-DOG-3 form
