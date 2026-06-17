# Graph Storage Specification

## Purpose

Persistence of the graph behind the `GraphStore` port (ADR-004) with a SQLite + FTS5
implementation (ADR-005). Covers the schema (`nodes`, `edges`, `nodes_fts`, `snapshots`, `meta`),
schema versioning with migrations, `body_hash` for incremental sync, and snapshot persistence.
Story: US-009 (storage part). Per-engine fingerprint computation, live drift detection and
`diff snapA snapB` are DEFERRED to Phase 3 / Phase 5.

## Requirements

### Requirement: GraphStore behavior is observable through the port

All persistence behavior REQUIRED by this spec SHALL be expressed through the `GraphStore` port
defined in `src/core/ports`. The SQLite implementation MUST live outside `src/core` (in
`src/adapters/storage/sqlite`) and MUST be the only place importing the SQLite driver. Core code
MUST NOT import the driver, and every scenario below MUST be satisfiable against any conforming
`GraphStore` implementation (ADR-004).

#### Scenario: Core depends only on the port

- GIVEN the `src/core` source tree
- WHEN its imports are inspected by the boundary lint rule
- THEN no import resolves to an adapter, driver, MCP or CLI module
- AND persistence is reached solely via the `GraphStore` port

### Requirement: Persist and reload a graph round-trip

The store SHALL persist nodes and edges and reload them with no loss of identity, kind, edge
direction, event, confidence or score. A graph written and then read back MUST be equivalent to the
input graph.

#### Scenario: Round-trip preserves the graph

- GIVEN a normalized graph with tables, columns, a view, a trigger and a procedure
- WHEN it is saved via the `GraphStore` port and then loaded
- THEN every node and edge is recovered with identical id, kind, direction, confidence and (where present) event and score

### Requirement: Schema versioning and migrations

The store SHALL record its schema version in the `meta` table and apply forward migrations to reach
the current version. Opening a store at an older schema version MUST migrate it without data loss;
opening at the current version MUST be a no-op.

#### Scenario: Older schema migrates forward

- GIVEN a database file at schema version N-1
- WHEN the store opens it
- THEN migrations run to the current version N and existing nodes and edges are preserved

#### Scenario: Current schema opens without migrating

- GIVEN a database file already at the current schema version
- WHEN the store opens it
- THEN no migration runs and the recorded version is unchanged

### Requirement: FTS5 body indexing honors levels

The store SHALL maintain a `nodes_fts` FTS5 index. Bodies of objects at `full` level MUST be
indexed for search; objects at `metadata` or `off` MUST NOT have their body present in `nodes_fts`.

#### Scenario: full body is searchable, metadata body is not

- GIVEN one object stored at `full` and one stored at `metadata`, both whose body contains the token `reconcile`
- WHEN `nodes_fts` is queried for `reconcile`
- THEN the `full` object matches
- AND the `metadata` object does not match on body content

### Requirement: body_hash supports incremental sync

Each indexed object body SHALL persist a deterministic `body_hash` (ADR-005). The same body MUST
yield the same hash, and a changed body MUST yield a different hash, enabling a later phase to detect
unchanged objects without re-extracting them.

#### Scenario: Stable hash for unchanged body, different for changed

- GIVEN an object stored with a `body_hash`
- WHEN the identical body is hashed again
- THEN the hash is byte-identical
- AND hashing a modified body produces a different hash

### Requirement: Snapshot persistence

Every persisted sync SHALL record a `snapshots` entry carrying a timestamp, the engine version, a
fingerprint value and per-object-type counts. Snapshots MUST be retrievable in insertion order.

#### Scenario: A sync writes a retrievable snapshot

- GIVEN a graph persisted as one sync
- WHEN the snapshot is written and later read
- THEN it exposes a timestamp, engine version, fingerprint and per-type counts
- AND (DEFERRED, Phase 3) per-engine fingerprint computation and `diff snapA snapB` are out of scope here
