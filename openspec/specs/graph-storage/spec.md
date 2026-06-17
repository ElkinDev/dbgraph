# Graph Storage Specification

## Purpose

Persistence of the graph behind the `GraphStore` port (ADR-004) with a SQLite + FTS5
implementation (ADR-005). Covers the schema (`nodes`, `edges`, `nodes_fts`, `snapshots`,
`snapshot_objects`, `meta`), schema versioning with migrations (`CURRENT_SCHEMA_VERSION = 2`),
`body_hash` for incremental sync, snapshot persistence, and the per-object `snapshot_objects`
manifest that enables `diff snapA snapB` without re-querying the source database. Stories:
US-009 (storage part), US-022 (diff via manifest). Per-engine fingerprint computation remains
the adapter's responsibility (schema-extraction specs). The `snapshot_objects` manifest was
added in phase-4-cli-config; the local index auto-migrates from v1 to v2 on first open.

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
the current version. The current local-index schema version is `CURRENT_SCHEMA_VERSION = 2` (raised
from 1 to accommodate the `snapshot_objects` manifest). Opening a store at an older schema version MUST
NOT lose existing nodes and edges; opening at the current version MUST be a no-op. Because the local
index is a REBUILDABLE cache of the target database, the migration MAY be satisfied either by an
automatic forward migration on open or by requiring a `sync --full` rebuild — the chosen strategy is
fixed by the design, but in either case an existing v1 index MUST remain usable and MUST NOT silently
corrupt or drop data.

#### Scenario: Current schema opens without migrating

- GIVEN a database file already at the current schema version (2)
- WHEN the store opens it
- THEN no migration runs and the recorded version is unchanged

#### Scenario: Existing v1 index is handled without data loss

- GIVEN a local index file at schema version 1 (no `snapshot_objects` manifest)
- WHEN the store opens it
- THEN the existing nodes and edges are preserved (no data loss and no silent corruption)
- AND the index reaches the current version either by forward migration on open or by a `sync --full` rebuild, per the design's chosen strategy

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

### Requirement: Per-object snapshot manifest

`putSnapshot` SHALL persist, for each snapshot, a `snapshot_objects` manifest with one row per indexed
object carrying `snapshot_id`, `node_id`, `kind`, `qname` and `body_hash`. The manifest MUST capture
enough per-object identity and content state for a later phase to compute a per-object diff between two
snapshots (added/removed by `node_id`/`qname`; modified by `body_hash` difference) WITHOUT re-querying
the source database. The manifest is part of the LOCAL index only; it MUST NOT be written to the target
database. Manifest rows MUST be retrievable for a given `snapshot_id`.

#### Scenario: putSnapshot writes one manifest row per object

- GIVEN a graph persisted as one sync
- WHEN `putSnapshot` records the snapshot
- THEN a `snapshot_objects` row exists for each indexed object carrying `snapshot_id`, `node_id`, `kind`, `qname` and `body_hash`
- AND those rows are retrievable by `snapshot_id`

#### Scenario: Two manifests support a per-object diff

- GIVEN two snapshots whose `snapshot_objects` manifests differ by an added object, a removed object and one object with a changed `body_hash`
- WHEN the two manifests are compared
- THEN the added and removed objects are identifiable by `node_id`/`qname`
- AND the changed object is identifiable by its differing `body_hash`
- AND no query against the target database is required to determine the difference

#### Scenario: Manifest is local-index only

- GIVEN a `putSnapshot` operation
- WHEN the manifest is written
- THEN it is persisted in the LOCAL SQLite index
- AND no write of any kind is issued against the target database

### Requirement: Snapshot persistence

Every persisted sync SHALL record a `snapshots` entry carrying a timestamp, the engine version, a
fingerprint value and per-object-type counts, AND a `snapshot_objects` manifest (see "Per-object
snapshot manifest"). Snapshots MUST be retrievable in insertion order. With per-object manifests now
persisted, a per-object `diff snapA snapB` over two snapshots IS supported by this capability (the
Phase-3 deferral is LIFTED). Per-engine fingerprint COMPUTATION remains the adapter's responsibility
(schema-extraction / per-engine adapter specs), not this store's.

#### Scenario: A sync writes a retrievable snapshot with its manifest

- GIVEN a graph persisted as one sync
- WHEN the snapshot is written and later read
- THEN it exposes a timestamp, engine version, fingerprint and per-type counts
- AND its `snapshot_objects` manifest is retrievable for that snapshot

#### Scenario: Per-object diff between two snapshots is supported

- GIVEN two persisted snapshots with their `snapshot_objects` manifests
- WHEN a per-object diff is requested between them
- THEN added, removed and modified objects are derivable from the manifests
- AND this is no longer deferred (the Phase-3 `diff snapA snapB` deferral is lifted)
