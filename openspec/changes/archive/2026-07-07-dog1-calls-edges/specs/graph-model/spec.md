# Delta for Graph Model

> Change `dog1-calls-edges`. Adds the `calls` edge kind (routine→routine invocation) to the edge
> taxonomy and pins its per-engine provenance. NOTE (honesty): the `declared`/`parsed`/`inferred`
> confidence tiers ALREADY exist in the model (a foreign key is `declared`; a body-parsed read/write
> is `parsed`). This delta introduces NO new confidence tier — it introduces a new EDGE KIND whose
> tier is ENGINE-DETERMINED: mssql resolves `calls` from the catalog (`declared`), pg/mysql resolve it
> from the body tokenizer (`parsed`). `calls` is NEVER `inferred`. Stories: US-007.

## MODIFIED Requirements

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

## ADDED Requirements

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
