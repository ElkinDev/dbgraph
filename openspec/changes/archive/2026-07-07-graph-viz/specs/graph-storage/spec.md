# Delta for Graph Storage

> Added by graph-viz: a whole-graph BULK read on the `GraphStore` port so an exporter can make ONE
> deterministic pass instead of an N-per-node query storm. Strictly READ-ONLY; deterministic ordering;
> the port stays otherwise unchanged and identical across drivers (ADR-004, ADR-005).

## ADDED Requirements

### Requirement: Bulk read-only whole-graph traversal seam

The `GraphStore` port SHALL expose a BULK read-only traversal seam that returns the whole graph — ALL
nodes and ALL edges — in a BOUNDED number of store queries (the exact shape is fixed by the design:
`getAllNodes()`/`getAllEdges()` OR a streamed/paged equivalent). It MUST NOT fan out into a per-node /
per-edge query STORM (no N-per-node reads). The seam MUST be strictly READ-ONLY — no write, DDL or DML
against the local index or the target database — and MUST return nodes and edges in a DETERMINISTIC,
stable order (by node id / edge identity) so downstream deterministic consumers (viz, mermaid) stay
byte-reproducible. The seam MUST behave IDENTICALLY across storage drivers (`better-sqlite3` and
`node:sqlite`), consistent with the existing no-port-change-across-drivers guarantee; the SQLite adapter
implements it read-only.

#### Scenario: whole-graph read uses a bounded number of queries

- GIVEN the torture graph persisted in the store
- WHEN the bulk seam loads all nodes and all edges
- THEN the total number of store queries issued is BOUNDED and independent of node count (no N-per-node storm)
- AND every node and every edge in the graph is returned

#### Scenario: bulk read ordering is deterministic

- GIVEN the same persisted graph read twice through the bulk seam
- WHEN the two result sequences are compared
- THEN nodes and edges are returned in an identical, stable order on both reads

#### Scenario: bulk read is strictly read-only

- GIVEN a bulk read executed over the store
- WHEN it runs
- THEN it issues NO write, DDL or DML against the local index or the target database
- AND the ADR-004 boundary / read-only test stays green

#### Scenario: bulk seam is driver-agnostic

- GIVEN a store backed by `better-sqlite3` and, separately, by `node:sqlite`
- WHEN the bulk seam reads the same graph through each driver
- THEN the returned nodes/edges and their order are identical across both drivers
- AND the `GraphStore` port surface is unchanged by this addition
