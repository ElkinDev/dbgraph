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
`depends_on`, `reads_from`, `writes_to`, `fires_on`, `calls`, `indexes`, and `inferred_reference`. A
`calls` edge represents a routine (`procedure` or `function`) INVOKING another routine (`EXEC` /
`CALL` / `SELECT fn()`); BOTH its source and destination MUST be routine nodes, it MUST carry a
`confidence` of `declared` or `parsed` (NEVER `inferred`), and it MUST NOT carry a `score`. An
`inferred_reference` edge is POPULATED by the opt-in inference engine (US-008): it carries
`confidence: inferred` and a numeric `score ∈ [0, 1]` (scoring is NO LONGER deferred). A `fires_on`
edge MUST carry its triggering `event` (e.g. `INSERT`, `UPDATE`, `DELETE`). A module node MUST be
able to carry `has_dynamic_sql: true` to declare analysis blindness (US-007).
(Previously: the edge-kind set omitted `calls`; a routine invoking a routine was unmodeled, and a
routine-target dependency defaulted to a `reads_from` edge over a phantom `missing` table stub.)

#### Scenario: calls edge connects two routine nodes

- GIVEN a `calls` edge emitted for a procedure that invokes another procedure
- WHEN the edge is inspected
- THEN its `kind` is `calls` and BOTH its source and destination are routine nodes (`procedure` or `function`)
- AND its `confidence` is `declared` or `parsed` and it carries NO `score`

#### Scenario: fires_on carries its event

- GIVEN a `fires_on` edge from a trigger to a table
- WHEN the edge is inspected
- THEN it exposes an `event` field with the firing DML event

#### Scenario: inferred_reference carries a score in range

- GIVEN an `inferred_reference` edge emitted by the inference engine
- WHEN the edge is inspected
- THEN it carries `confidence: "inferred"` and a numeric `score`
- AND that `score` lies within the closed interval `[0, 1]`

### Requirement: calls edge provenance is engine-determined, never inferred

A `calls` edge SHALL carry the provenance of the engine that emitted it. SQL Server (mssql) resolves
the invocation from the CATALOG — `sys.sql_expression_dependencies` supplies the referenced routine's
IDENTITY and `sys.objects.type` its KIND, with NO body parse establishing the call — so mssql `calls`
edges MUST carry `confidence: declared`. PostgreSQL and MySQL have no cheap call catalog, so their
`calls` edges are derived by the shared body tokenizer and MUST carry `confidence: parsed`. A `calls`
edge MUST NEVER carry `confidence: inferred`. SQLite has NO routine objects (its `CapabilityMatrix`
declares procedures and functions unsupported), so SQLite emits NO `calls` edge at all. This is a
DELIBERATE per-engine split: an mssql `reads_from`/`writes_to` edge stays `parsed` (its ACCESS is
body-derived) while its `calls` edge is `declared` (a call has no access dimension).

#### Scenario: mssql calls is declared, pg/mysql calls is parsed

- GIVEN a `calls` edge produced by the mssql adapter and a `calls` edge produced by the pg or mysql adapter
- WHEN each edge's `confidence` is read
- THEN the mssql edge is `declared` (catalog-resolved) and the pg/mysql edge is `parsed` (body-resolved)
- AND neither is `inferred`

#### Scenario: SQLite emits no calls edge

- GIVEN a SQLite graph (SQLite supports no procedures or functions)
- WHEN its edges are enumerated
- THEN there is NO `calls` edge, because there is no routine node to be a source or destination

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

### Requirement: Consumed source-column set on view depends_on via attrs.dstColumns

Where a catalog sources it, the model SHALL represent a view's read dependency at COLUMN grain by carrying
the sorted-unique SET of consumed source columns as `EdgeAttrs.dstColumns` on the EXISTING
view→source-table `depends_on` edge — NOT as separate per-column edges and NOT as column-node targets. The
view→table `depends_on` edge is UNCHANGED in identity (`edgeId`, endpoints); it merely GAINS
`attrs.dstColumns`. The edge's `confidence` MUST be `declared` where a catalog sources the columns (mssql;
pg covered pairs). Because the view `depends_on` dependency is first emitted by the body tokenizer at
`confidence: 'parsed'`, a COVERED pair FLIPS `parsed`→`declared` at the moment it gains the set — on BOTH
mssql (native `dm_sql_referenced_entities`) and pg (`view_column_usage`); see mssql-extraction and
pg-extraction (the model NEVER treats the covered edge as "already declared"). The represented
relationship is a SOURCE-COLUMN SET — the columns the view READS — and MUST NOT be described, rendered,
or asserted as an OUTPUT-column ↔ source-column MAPPING (ADR-007: the SELECT-list grammar parse a true
mapping needs is OUT of scope). A `depends_on` edge with no sourced column MUST leave `attrs.dstColumns`
UNSET → byte-identical to today's object-grain edge (`attrs {}`).

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
the columns (mssql `sys.dm_sql_referenced_entities`, native path — see mssql-extraction; pg
`information_schema.view_column_usage`) the view→table `depends_on` edge carries `attrs.dstColumns` at
`confidence: 'declared'` (flipped from the tokenizer's `parsed` on covered pairs). Where NO column catalog
exists (mysql, sqlite) OR the catalog OMITS a source (pg materialized views / owner-visibility gaps /
whole-object `SELECT *`; mssql-via-sqlcmd or manual dump / unbindable views), the edge MUST leave
`attrs.dstColumns` UNSET — degradation is expressed by ABSENCE of the set, NOT by a per-edge marker (there
is NO `attrs.degraded` stamp); the per-engine capability (`supportsColumnLineage`) documents WHY. The model
MUST NEVER synthesize a column the catalog cannot supply (ADR-006/007) — degradation is stated plainly,
never back-filled by a body parse. mongodb has no views → the capability is absent, not fabricated.

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
