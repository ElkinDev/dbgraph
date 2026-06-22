# Delta for Schema Extraction

## ADDED Requirements

### Requirement: Optional RawField model path for schemaless field structure

The `RawCatalog` contract SHALL gain an OPTIONAL field-structure path: a typed `RawField` carried under
an optional `RawObject.fields?`, normalized into `'field'` nodes (US-030). A `RawField` MUST carry a
field PATH (the dotted/array-encoded field name), its observed dataType (a UNION encoding for
schemaless engines) and its presence FREQUENCY. The `'field'` `NodeKind`, the `levels.fields` config and
`getLevelForKind('field')` ALREADY exist; this path completes the normalizer's `field` branch. This is
ADDITIVE and OPTIONAL: SQL engines (sqlite, mssql, pg, mysql) MUST leave `RawObject.fields` UNSET and
their existing `RawCatalog` goldens MUST remain BYTE-IDENTICAL. A `'field'` node MUST be consumable by
`inferReferences` identically to a `'column'` node (it reads `payload.dataType`).

#### Scenario: A RawObject with fields normalizes into field nodes

- GIVEN a `RawObject` of `kind: 'collection'` carrying `fields` with paths, union dataTypes and frequencies
- WHEN it is passed to `normalizeCatalog`
- THEN each `RawField` becomes a `'field'` node carrying its dataType and frequency
- AND the `'field'` node is consumable by `inferReferences` exactly as a `'column'` node is

#### Scenario: SQL engines leaving fields unset stay byte-identical

- GIVEN the sqlite, mssql, pg and mysql adapters, none of which sets `RawObject.fields`
- WHEN their torture extractions and goldens are re-run
- THEN their `RawCatalog` and golden outputs are BYTE-IDENTICAL to before this change (ADR-008)
- AND no `'field'` node appears for any SQL engine

## MODIFIED Requirements

### Requirement: SchemaAdapter port lives in core and imports no driver

The model SHALL define a `SchemaAdapter` port in `src/core/ports` exposing a `dialect` identifier, a
`capabilities: CapabilityMatrix`, and the lifecycle methods `connect()`, `extract(scope): Promise<RawCatalog>`,
`fingerprint(): Promise<string>` and `close()`. The port MUST be expressible without importing any
driver, adapter, MCP or CLI symbol (ADR-004); the concrete join to a driver belongs to an adapter
outside core. The `SchemaAdapterConfig` discriminated union (the config side of the port) SHALL include a
`MongodbAdapterConfig` variant for the `mongodb` dialect alongside the existing `sqlite`, `mssql`, `pg`
and `mysql` variants; this extends the union ONLY — it adds no new port method and does not change the
port SHAPE.
(Previously: the union added the `mysql` variant; this delta adds the `mongodb` variant.)

The union is INTENTIONALLY non-discriminable by structural shape; runtime dispatch (config parsing and
adapter construction) keys on the EXPLICIT `dialect` field of the source config, NEVER on the union
member's structural shape; each engine keeps its own factory taking its concrete config type directly.
Unlike the host/port SQL variants, `MongodbAdapterConfig` MUST carry a connection URI (a `${env:VAR}`
reference, env-only), a `database`, an optional `sampleSize?` (default `100`) and an optional `tls?`; it
MUST NOT carry a `schema?` field (the connected database is the extraction scope) and MUST NOT carry
host/port/user/password members (those are folded into the URI).

#### Scenario: Port type is driver-free

- GIVEN the `SchemaAdapter` port type declaration in `src/core/ports`
- WHEN the core module graph is statically analysed (boundary lint)
- THEN it imports NO driver (`better-sqlite3`, `node:sqlite`, `mssql`, `pg`, `mysql2`, `mongodb`), adapter, MCP or CLI symbol
- AND it is implementable by a test double that requires no database connection

#### Scenario: Port exposes dialect and capability matrix

- GIVEN a value implementing `SchemaAdapter`
- WHEN its `dialect` and `capabilities` are read
- THEN `dialect` is a stable engine identifier
- AND `capabilities` is a `CapabilityMatrix` as defined by `graph-model`

#### Scenario: SchemaAdapterConfig union includes the mongodb variant without a shape change

- GIVEN the `SchemaAdapterConfig` discriminated union in `src/core/ports`
- WHEN its variants are enumerated
- THEN it includes a `MongodbAdapterConfig` variant for the `mongodb` dialect alongside `sqlite`, `mssql`, `pg` and `mysql`
- AND `MongodbAdapterConfig` carries a `${env:VAR}` URI, a `database`, optional `sampleSize?` and optional `tls?`, and NO `schema?` and NO host/port/user/password fields
- AND no new method is added to the `SchemaAdapter` port (the port SHAPE is unchanged)

#### Scenario: Dispatch keys on the explicit dialect, not on shape

- GIVEN the `mongodb` source config and the existing SQL config variants
- WHEN the runtime resolves which adapter to construct from a source config
- THEN it dispatches on the explicit `dialect` field, NOT on the union member's structural shape

### Requirement: Supported dialects, capabilitiesFor and UnsupportedDialectError recognize mongodb

The dialect registry SHALL recognize `mongodb` as a supported dialect across all touch points TOGETHER:
`SUPPORTED_DIALECTS` (config schema) MUST include `'mongodb'` (alongside `'sqlite'`, `'mssql'`, `'pg'`
and `'mysql'`); `capabilitiesFor(dialect)` MUST return `MONGODB_CAPABILITIES` for `'mongodb'`; and the
pinned `UnsupportedDialectError` message MUST list the supported dialects as
`sqlite, mssql, pg, mysql, mongodb`. The message is a CONTRACT: its updated text and its pinned assertion
MUST change in the SAME batch, and the `UnsupportedDialectError` → exit code `4` mapping MUST be VERIFIED
unchanged (no `exit-code.ts` code change — only a regression assertion). An unknown dialect MUST still
raise `UnsupportedDialectError` (not an opaque error), and `'mongodb'` MUST NOT be reported as
unsupported.
(Previously: the registry recognized `mysql`, message `sqlite, mssql, pg, mysql`.)

Previous dialect history: `pg` added (phase-8a-pg, message `sqlite, mssql, pg`); `mysql` added
(phase-8b-mysql, message `sqlite, mssql, pg, mysql`); `mongodb` added (phase-9b-mongodb, message
`sqlite, mssql, pg, mysql, mongodb`).

#### Scenario: mongodb is a supported dialect and resolves its capabilities

- GIVEN the dialect registry after this change
- WHEN `'mongodb'` is checked against `SUPPORTED_DIALECTS` and passed to `capabilitiesFor`
- THEN `'mongodb'` is reported as supported
- AND `capabilitiesFor('mongodb')` returns `MONGODB_CAPABILITIES`

#### Scenario: UnsupportedDialectError lists mongodb and maps to exit code 4

- GIVEN an unknown (still-unsupported) dialect string
- WHEN the dialect is resolved
- THEN it raises `UnsupportedDialectError` whose message lists the supported dialects as `sqlite, mssql, pg, mysql, mongodb`
- AND the `UnsupportedDialectError` → exit code mapping remains exit code `4` (verified unchanged, no code change)

#### Scenario: Pinned message and its assertion change together

- GIVEN the pinned `UnsupportedDialectError` message and its test assertion
- WHEN the supported-dialect list is updated to include `mongodb`
- THEN the message text and its pinned assertion are updated in the SAME batch (the contract stays in sync)
