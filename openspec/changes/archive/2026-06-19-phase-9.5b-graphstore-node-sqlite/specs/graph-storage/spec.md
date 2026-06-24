# Graph Storage Specification (delta — phase-9.5b-graphstore-node-sqlite)

## Purpose

This delta widens the SQLite storage adapter's driver seam so the LOCAL index write path is
driver-AGNOSTIC and can run on the built-in `node:sqlite` (Node 22+) with ZERO native modules —
the storage half of binary-readiness (US-037) and the documented intended state of ADR-005
(`better-sqlite3` on the npm path; `node:sqlite` for self-contained binaries; the `GraphStore` port
absorbs the duality). It introduces a single `WritableSqliteHandle` (`prepare`/`exec`/`transaction`/
`pragma`/`close`) that `SqliteGraphStore`, `migrations.ts` and `schema.ts` consume in place of a
concrete `better-sqlite3` `Database`; the driver is selected explicitly at the factory.

The change is observable behavior ONLY — it does NOT touch the `GraphStore` PORT, the SQLite schema
(tables, FTS5, snapshots, `snapshot_objects`), the round-trip, FTS, `body_hash`, snapshot or migration
requirements. `better-sqlite3` REMAINS the default driver and its path MUST stay byte-identical (every
existing scenario and golden unchanged); `node:sqlite` is an ADDED parity path. Because `node:sqlite`
lacks a native `.transaction()` helper, the handle SYNTHESIZES `transaction(fn)` from
`BEGIN`/`COMMIT`/`ROLLBACK` and MUST match `better-sqlite3` commit/rollback semantics under WAL +
`foreign_keys`. There is NO CI for this change; the load-bearing guarantee is the byte-identical
default path verified locally, with the parity path covered by an in-memory `node:sqlite` E2E suite.

## MODIFIED Requirements

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

## ADDED Requirements

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
