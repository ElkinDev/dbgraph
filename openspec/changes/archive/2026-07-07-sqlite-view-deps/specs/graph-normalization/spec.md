# Delta for Graph Normalization

> Change `sqlite-view-deps`. Cross-engine correctness fix in `reference-resolver.ts`
> `buildFiresOnEdges`: a trigger's `fires_on` target is resolved to the ACTUAL node kind (view OR
> table) instead of the hardcoded `resolveOrStub('table', …)`. This kills the phantom
> `missing: true` `[table]` stub minted for triggers that fire on a VIEW (e.g. the SQLite
> INSTEAD OF trigger on `active_departments`). The change is shared across ALL engines. The
> presentation prefer-`!missing` masking stays as defense-in-depth (unchanged).

## MODIFIED Requirements

### Requirement: Catalog-to-graph node and edge production

The normalizer SHALL convert each `RawCatalog` object into its corresponding node and produce
`references`, `depends_on` and `fires_on` edges for declared relationships. A declared foreign key
MUST yield a `references` edge with `confidence: declared`; a view's dependency on its source MUST
yield `depends_on`; a trigger's binding to its firing OBJECT MUST yield `fires_on` with the event.
The `fires_on` target MUST be resolved to the ACTUAL existing node — a trigger firing on a VIEW
resolves to that `view` node, a trigger firing on a TABLE resolves to that `table` node — and MUST
NOT be minted as a hardcoded `table` stub. A missing target still becomes a `missing: true` stub of
the resolved kind, never a phantom `[table]` stub over an object that exists as a view.
(Previously: `buildFiresOnEdges` resolved every `fires_on` target via a hardcoded `resolveOrStub('table', …)`, minting a phantom `missing: true` `[table]` stub for triggers that fire on a view.)

#### Scenario: Minimal fixture normalizes to the golden graph

- GIVEN the `catalog-minimal.json` fixture (2 tables, 1 FK, 1 view, 1 trigger)
- WHEN it is normalized
- THEN the graph contains the expected `table`, `column`, `view` and `trigger` nodes
- AND exactly one `references`, one `depends_on` and one `fires_on` edge, matching the golden file

#### Scenario: Trigger firing on a view resolves to the view node (cross-engine)

- GIVEN any engine catalog with a trigger defined on an existing VIEW (e.g. an INSTEAD OF trigger)
- WHEN it is normalized
- THEN its `fires_on` edge targets that `view` node (kind `view`)
- AND NO phantom `missing: true` `[table]` stub is created for the view

#### Scenario: SQLite INSTEAD OF trigger fires on the view, no phantom stub (exact)

- GIVEN the SQLite torture graph with `trg_active_dept_instead_insert` (INSTEAD OF INSERT ON the `active_departments` VIEW)
- WHEN it is normalized
- THEN `fires_on` is EXACTLY `main.trg_active_dept_instead_insert → main.active_departments` and the target node kind is `view`
- AND NO `[table] active_departments` stub appears in the normalized graph (the phantom stub count for it is zero)
