# Delta for graph-model (dog3-column-lineage)

> ADDS a NEW plural `EdgeAttrs.dstColumns?: readonly string[]` (`edge.ts`) as the LOAD-BEARING signal for a
> view's column-grain read dependency: the sorted-unique SET of source `table.column`s the view CONSUMES,
> stamped on the EXISTING view→source-table `depends_on` edge. This is a SOURCE-COLUMN SET, NEVER an
> OUTPUT↔SOURCE MAPPING (ADR-006/007; the naming discipline is normative, not cosmetic). Epic:
> deep-object-graph (DOG-3). Stories: US-006 (model), US-007 (extraction seam), US-014 (impact consumer).
>
> **Model A — SETTLED (design D-MODEL).** The column grain rides as `attrs.dstColumns` on the ONE existing
> view→table `depends_on` edge (ZERO new edges; edge-count-constant at 14k columns). The reserved singular
> `srcColumn/dstColumn` stay `references`-scoped and UNCHANGED (FK/`references` goldens byte-identical). NO
> per-column `depends_on` edges, NO column-node targets (the rejected Model B). The observable is the UNION
> of `attrs.dstColumns` across a view's `depends_on` edges: which source columns it consumes, the confidence
> tier, and degradation expressed by ABSENCE of the set.

## ADDED Requirements

### Requirement: Consumed source-column set on view depends_on via attrs.dstColumns

Where a catalog sources it, the model SHALL represent a view's read dependency at COLUMN grain by carrying
the sorted-unique SET of consumed source columns as `EdgeAttrs.dstColumns` on the EXISTING
view→source-table `depends_on` edge — NOT as separate per-column edges and NOT as column-node targets. The
view→table `depends_on` edge is UNCHANGED in identity (`edgeId`, endpoints); it merely GAINS
`attrs.dstColumns`. The edge's `confidence` MUST be `declared` where a catalog sources the columns (mssql;
pg covered pairs). The represented relationship is a SOURCE-COLUMN SET — the columns the view READS — and
MUST NOT be described, rendered, or asserted as an OUTPUT-column ↔ source-column MAPPING (ADR-007: the
SELECT-list grammar parse a true mapping needs is OUT of scope). A `depends_on` edge with no sourced column
MUST leave `attrs.dstColumns` UNSET → byte-identical to today's object-grain edge (`attrs {}`).

#### Scenario: A view carries attrs.dstColumns for its exact consumed columns

- GIVEN a view that reads source columns `{c1, c2}` from table `t`, sourced by the catalog
- WHEN its `depends_on` edge to `t` is inspected
- THEN the edge carries `attrs.dstColumns = [c1, c2]` (sorted-unique, code-point order) and `confidence: 'declared'`
- AND no column of `t` absent from `{c1, c2}` appears in `attrs.dstColumns` (negative)
- AND NO separate per-column `depends_on` edge and NO column-node target is emitted (Model A)

#### Scenario: The relationship is a source-column SET, never an output mapping (honesty)

- GIVEN a view whose SELECT list renames or computes outputs from source columns
- WHEN its `depends_on` edges are inspected
- THEN `attrs.dstColumns` asserts ONLY which source `table.column`s the view consumes
- AND NO attribute asserts a correspondence from an OUTPUT column to a source column

#### Scenario: Non-sourced dependency stays byte-identical object grain (unset signal)

- GIVEN a `depends_on` dependency for which no catalog sources a column
- WHEN its edge is emitted
- THEN `attrs.dstColumns` is UNSET and the edge is byte-identical to the pre-DOG-3 object-grain edge

### Requirement: Per-engine column provenance and honest degradation-by-absence, never blurred

The model SHALL make column-grain view lineage PROVENANCE-EXPLICIT and per-engine. Where a catalog sources
the columns (mssql `sys.sql_expression_dependencies.referenced_minor_id`; pg
`information_schema.view_column_usage`) the view→table `depends_on` edge carries `attrs.dstColumns` at
`confidence: 'declared'`. Where NO column catalog exists (mysql, sqlite) OR the catalog OMITS a source (pg
materialized views / owner-visibility gaps / whole-object `SELECT *`), the edge MUST leave `attrs.dstColumns`
UNSET — degradation is expressed by ABSENCE of the set, NOT by a per-edge marker (there is NO `attrs.degraded`
stamp); the per-engine capability (`supportsColumnLineage`) documents WHY. The model MUST NEVER synthesize a
column the catalog cannot supply (ADR-006/007) — degradation is stated plainly, never back-filled by a body
parse. mongodb has no views → the capability is absent, not fabricated.

#### Scenario: Declared where catalog-sourced, absent where not

- GIVEN one view on a catalog-sourcing engine and one on a non-sourcing engine
- WHEN their view `depends_on` edges are inspected
- THEN the sourcing engine's edge carries `attrs.dstColumns` at `confidence: 'declared'`
- AND the non-sourcing engine's edge leaves `attrs.dstColumns` UNSET (degrade-by-absence, no marker) and is byte-identical to its pre-DOG-3 object-grain edge

#### Scenario: No fabricated column under degradation (negative)

- GIVEN a view on mysql or sqlite (no view-column catalog)
- WHEN its `depends_on` edges are enumerated
- THEN NO `attrs.dstColumns` is present (no body-parsed guess) and NO per-column edge exists
- AND the object-grain edge names only the source TABLE
