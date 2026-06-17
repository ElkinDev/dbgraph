# Graph Storage Specification (delta — phase-4-cli-config)

## Purpose

This delta extends LOCAL-index snapshot persistence so that a per-object `diff snapA snapB` becomes
possible. It ADDS a `snapshot_objects` manifest written by `putSnapshot`, MODIFIES the schema-version
requirement to bump the local-index `CURRENT_SCHEMA_VERSION` from 1 to 2 (with an explicit
existing-v1-index migration scenario), and MODIFIES the snapshot-persistence requirement to LIFT the
Phase-3 `diff snapA snapB` deferral. All changes are to the LOCAL SQLite index ONLY — they NEVER touch
the target database, which remains strictly read-only. The exact v1→v2 migration strategy (auto-migrate
on open vs require `sync --full`) is the design's call; this spec pins only the observable behavior:
existing v1 indexes MUST keep working with no data loss.

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Schema versioning and migrations

The store SHALL record its schema version in the `meta` table and apply forward migrations to reach
the current version. The current local-index schema version is `CURRENT_SCHEMA_VERSION = 2` (raised
from 1 to accommodate the `snapshot_objects` manifest). Opening a store at an older schema version MUST
NOT lose existing nodes and edges; opening at the current version MUST be a no-op. Because the local
index is a REBUILDABLE cache of the target database, the migration MAY be satisfied either by an
automatic forward migration on open or by requiring a `sync --full` rebuild — the chosen strategy is
fixed by the design, but in either case an existing v1 index MUST remain usable and MUST NOT silently
corrupt or drop data.
(Previously: stated only a generic "version N-1 → N" migration with no `snapshot_objects` manifest and `CURRENT_SCHEMA_VERSION = 1`.)

#### Scenario: Current schema opens without migrating

- GIVEN a database file already at the current schema version (2)
- WHEN the store opens it
- THEN no migration runs and the recorded version is unchanged

#### Scenario: Existing v1 index is handled without data loss

- GIVEN a local index file at schema version 1 (no `snapshot_objects` manifest)
- WHEN the store opens it
- THEN the existing nodes and edges are preserved (no data loss and no silent corruption)
- AND the index reaches the current version either by forward migration on open or by a `sync --full` rebuild, per the design's chosen strategy

### Requirement: Snapshot persistence

Every persisted sync SHALL record a `snapshots` entry carrying a timestamp, the engine version, a
fingerprint value and per-object-type counts, AND a `snapshot_objects` manifest (see "Per-object
snapshot manifest"). Snapshots MUST be retrievable in insertion order. With per-object manifests now
persisted, a per-object `diff snapA snapB` over two snapshots IS supported by this capability (the
Phase-3 deferral is LIFTED). Per-engine fingerprint COMPUTATION remains the adapter's responsibility
(schema-extraction / per-engine adapter specs), not this store's.
(Previously: snapshot entry carried only timestamp/engine/fingerprint/counts and explicitly DEFERRED `diff snapA snapB` to Phase 3 / Phase 5.)

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
