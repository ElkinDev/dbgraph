# Graph Storage Specification

## Purpose

Persistence of the graph behind the `GraphStore` port (ADR-004) with a SQLite + FTS5
implementation (ADR-005). Covers the schema (`nodes`, `edges`, `nodes_fts`, `snapshots`,
`snapshot_objects`, `meta`), schema versioning with migrations (`CURRENT_SCHEMA_VERSION = 2`),
`body_hash` for incremental sync, snapshot persistence, and the per-object `snapshot_objects`
manifest that enables `diff snapA snapB` without re-querying the source database. Stories:
US-009 (storage part), US-022 (diff via manifest), US-037 (storage half: driver-agnostic
handle, binary-readiness prerequisite). Per-engine fingerprint computation remains the adapter's
responsibility (schema-extraction specs). The `snapshot_objects` manifest was added in
phase-4-cli-config; the local index auto-migrates from v1 to v2 on first open.

The storage adapter operates through a single `WritableSqliteHandle` abstraction (added in
phase-9.5b). `better-sqlite3` is the DEFAULT driver and byte-identical; `node:sqlite` (Node 22+,
built-in, ZERO native modules) is an explicitly-selected parity path. The `GraphStore` port and
the SQLite schema are UNCHANGED across drivers. This realizes ADR-005's documented intended state
and is the prerequisite for 9.5c self-contained binaries to need no native addons for storage.

## Requirements

### Requirement: GraphStore behavior is observable through the port

All persistence behavior REQUIRED by this spec SHALL be expressed through the `GraphStore` port
defined in `src/core/ports`. The SQLite implementation MUST live outside `src/core` (in
`src/adapters/storage/sqlite`) and MUST be the only place where a SQLite driver is selected. Within the
adapter the store MUST NOT depend on a CONCRETE driver: `SqliteGraphStore`, `migrations.ts` and
`schema.ts` MUST operate through the `WritableSqliteHandle` abstraction (see "Storage operates through
a driver-agnostic handle"), and only the factory MAY choose and wrap a concrete driver. Core code MUST
NOT import any driver, and every scenario below MUST be satisfiable against any conforming `GraphStore`
implementation regardless of the backing driver (ADR-004).
(Previously: required the SQLite implementation to be the only place importing the SQLite driver,
implicitly assuming a single concrete `better-sqlite3` `Database`; the store types were bound to that
native driver. The boundary now widens to a driver-agnostic handle while keeping the same core-isolation
guarantee.)

#### Scenario: Core depends only on the port

- GIVEN the `src/core` source tree
- WHEN its imports are inspected by the boundary lint rule
- THEN no import resolves to an adapter, driver, MCP or CLI module
- AND persistence is reached solely via the `GraphStore` port

#### Scenario: The store depends on the handle, not a concrete driver

- GIVEN the `SqliteGraphStore`, `migrations.ts` and `schema.ts` source under `src/adapters/storage/sqlite`
- WHEN their type and value imports are inspected
- THEN they reference the `WritableSqliteHandle` abstraction rather than a concrete `better-sqlite3` `Database`/`Statement` type
- AND only the factory selects and wraps a concrete driver
- AND no static top-level `import` of `better-sqlite3` remains in `schema.ts`

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

### Requirement: Storage operates through a driver-agnostic handle

The SQLite store SHALL operate through a single `WritableSqliteHandle` abstraction that exposes the
exact surface storage uses — `prepare()` (statements expose `run`/`get`/`all` with `@named` and `?`
positional binds), `exec()`, `transaction(fn)`, `pragma()` and `close()` — and MUST NOT depend on a
concrete driver type. There SHALL be two conforming handle factories: `betterSqliteHandle` (a thin
pass-through over a `better-sqlite3` `Database`) and `nodeSqliteHandle` (a duck-typed wrapper over
`node:sqlite`'s `DatabaseSync`, with NO unconditional import). The `GraphStore` PORT is UNCHANGED. The
SAME store behavior — every scenario in this capability — MUST hold whether the store is backed by
`better-sqlite3` OR `node:sqlite`; the choice of driver MUST NOT be observable through the port.

#### Scenario: Same store behavior holds on either driver

- GIVEN a `SqliteGraphStore` constructed over a `WritableSqliteHandle`
- WHEN it is backed by a `better-sqlite3` handle AND, separately, by a `node:sqlite` handle
- THEN the observable behavior through the `GraphStore` port is identical in both cases
- AND the store code references only the handle surface (`prepare`/`exec`/`transaction`/`pragma`/`close`), never a concrete driver type

#### Scenario: node:sqlite handle has no unconditional import

- GIVEN the `nodeSqliteHandle` factory and the `node:sqlite` builtin
- WHEN the module graph is inspected
- THEN `node:sqlite` is referenced via a duck-typed handle (no unconditional top-level import that breaks on runtimes lacking it)
- AND selecting the `better-sqlite3` driver never requires `node:sqlite` to be present

### Requirement: better-sqlite3 is the default driver and byte-identical

`better-sqlite3` SHALL remain the DEFAULT storage driver. When no driver is explicitly selected, the
store MUST behave EXACTLY as before this change: every existing storage scenario in this capability MUST
hold, and every storage golden MUST be byte-identical (ADR-008). There MUST be NO observable behavior
change, NO silent fallback to another driver, and NO change to the on-disk `.dbgraph` database file
format on the default path.

#### Scenario: Default path preserves existing behavior and goldens

- GIVEN the store opened with no explicit driver selection
- WHEN the full storage suite and its goldens are run
- THEN `better-sqlite3` is the active driver
- AND every existing storage scenario passes unchanged
- AND every storage golden is byte-identical to its pre-change value (ADR-008)

#### Scenario: No silent driver fallback on the default path

- GIVEN the default (`better-sqlite3`) driver selection
- WHEN the store is constructed
- THEN it uses `better-sqlite3` and does NOT silently substitute `node:sqlite`
- AND the `.dbgraph` database file format is unchanged

### Requirement: node:sqlite driver parity

The store SHALL behave identically when explicitly backed by `node:sqlite`. An in-memory
(`:memory:`) `node:sqlite`-backed store (Node 22+) MUST pass the SAME upsert/round-trip, FTS, snapshot
and `snapshot_objects` manifest behavior as the `better-sqlite3` path, requiring ZERO native modules.
This realizes the storage half of binary-readiness (US-037): the local index write path runs with no
native addon on the `node:sqlite` driver.

#### Scenario: node:sqlite in-memory store passes the same behavior

- GIVEN an in-memory `SqliteGraphStore` explicitly backed by a `node:sqlite` handle on Node 22+
- WHEN the upsert/round-trip, FTS body-by-level, `body_hash`, snapshot and `snapshot_objects` scenarios are exercised
- THEN every one passes with the same observable results as the `better-sqlite3` path
- AND no native module is required to run the `node:sqlite` path

#### Scenario: Schema migrate v0→v2 runs on node:sqlite

- GIVEN a fresh in-memory `node:sqlite`-backed store
- WHEN it is opened and forward migrations run to the current schema version (2)
- THEN the full schema (nodes, edges, `nodes_fts`, snapshots, `snapshot_objects`, meta) is created
- AND the recorded `schema_version` is the current version, identical to the `better-sqlite3` path

### Requirement: transaction(fn) semantics match on both drivers

The handle's `transaction(fn)` SHALL provide all-or-nothing semantics identical on both drivers. When
`fn` returns normally the work MUST be COMMITTED; when `fn` throws the transaction MUST be ROLLED BACK
with NO partial writes, and the original error MUST propagate. Because `node:sqlite` lacks a native
`.transaction()` helper, the synthesized `BEGIN`/`COMMIT`/`ROLLBACK` MUST reproduce `better-sqlite3`'s
commit-and-rollback behavior, and it MUST be correct under WAL journal mode + `foreign_keys = ON`. The
`better-sqlite3` result MUST serve as the oracle for the `node:sqlite` synthesis.

#### Scenario: Commit on normal return (both drivers)

- GIVEN a `WritableSqliteHandle` over `better-sqlite3` and, separately, over `node:sqlite`, each under WAL + `foreign_keys = ON`
- WHEN `transaction(fn)` runs and `fn` returns normally after writing rows
- THEN the writes are COMMITTED and visible after the transaction on both drivers
- AND the committed state is identical across the two drivers

#### Scenario: Rollback on throw leaves no partial writes (both drivers)

- GIVEN a `WritableSqliteHandle` over `better-sqlite3` and, separately, over `node:sqlite`, each under WAL + `foreign_keys = ON`
- WHEN `transaction(fn)` runs and `fn` writes some rows then THROWS
- THEN the transaction is ROLLED BACK with NO partial writes persisted on either driver
- AND the original error propagates to the caller
- AND the post-rollback state is identical across the two drivers

### Requirement: No port or schema-shape change across drivers

The SQLite schema and the `GraphStore` interface SHALL be IDENTICAL on both drivers. The DDL — the
`nodes`, `edges`, `nodes_fts` (FTS5), `snapshots`, `snapshot_objects` and `meta` tables, their indexes,
and `CURRENT_SCHEMA_VERSION = 2` — MUST be the same regardless of driver, and the `GraphStore` port in
`src/core/ports` MUST NOT change. The `.dbgraph` database file written by one driver MUST be a valid
input for the other; there is NO data, file-format or port migration introduced by this change.

#### Scenario: Identical schema shape on both drivers

- GIVEN a store created fresh on `better-sqlite3` and, separately, on `node:sqlite`
- WHEN the resulting schema (tables, FTS5 virtual table, indexes and recorded `schema_version`) is inspected
- THEN the schema shape is identical on both drivers
- AND `CURRENT_SCHEMA_VERSION` is 2 in both cases

#### Scenario: Port is unchanged and file format is portable

- GIVEN the `GraphStore` port in `src/core/ports` and a `.dbgraph` file written by one driver
- WHEN the port surface is inspected and the file is opened by the OTHER driver
- THEN the `GraphStore` interface is unchanged by this phase
- AND the file opens and reads back its graph identically (no file-format, data or port migration)
