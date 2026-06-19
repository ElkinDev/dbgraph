# Schema Extraction Specification (delta — phase-8b-mysql)

## Purpose

This delta registers MySQL as the FOURTH dialect of the engine-agnostic `SchemaAdapter` port. The port
SHAPE is UNCHANGED: this change adds a `MysqlAdapterConfig` member to the `SchemaAdapterConfig` union,
adds `'mysql'` to `SUPPORTED_DIALECTS`, makes `capabilitiesFor('mysql')` resolve `MYSQL_CAPABILITIES`,
and extends the pinned `UnsupportedDialectError` message to list `mysql`. It ALSO resolves the
config-discriminator wrinkle exposed by adding a second `host`-bearing member to the union (the stale
"distinguished by `host`" JSDoc), recording that the union is INTENTIONALLY non-discriminable by
structural shape (dispatch keys on the explicit `dialect` field, never on shape). Stories: US-029 (MySQL
adapter, Phase 8b). This delta consumes the existing `graph-model` contracts (`CapabilityMatrix`,
`ExtractionScope`, `RawCatalog`) UNCHANGED and adds no new port method.

## MODIFIED Requirements

### Requirement: SchemaAdapter port lives in core and imports no driver

The model SHALL define a `SchemaAdapter` port in `src/core/ports` exposing a `dialect` identifier, a
`capabilities: CapabilityMatrix`, and the lifecycle methods `connect()`, `extract(scope): Promise<RawCatalog>`,
`fingerprint(): Promise<string>` and `close()`. The port MUST be expressible without importing any
driver, adapter, MCP or CLI symbol (ADR-004); the concrete join to a driver belongs to an adapter
outside core. The `SchemaAdapterConfig` discriminated union (the config side of the port) SHALL include a
`MysqlAdapterConfig` variant for the `mysql` dialect alongside the existing `sqlite`, `mssql` and `pg`
variants; this extends the union ONLY — it adds no new port method and does not change the port SHAPE.

The union is INTENTIONALLY non-discriminable by structural shape: both `PgAdapterConfig` and
`MysqlAdapterConfig` carry `host`, so the now-stale `PgAdapterConfig` JSDoc claiming it is "distinguished
by `host`" MUST be corrected. Runtime dispatch (config parsing and adapter construction) keys on the
EXPLICIT `dialect` field of the source config, NEVER on the union member's structural shape; each engine
keeps its own factory taking its concrete config type directly. `MysqlAdapterConfig` MUST carry
`host`, `port` (default `3306`), `database`, `user`, `password` (a `${env:VAR}` reference, env-only) and
an optional `ssl`; it MUST NOT carry a `schema?` field (the connected database is the extraction scope).

#### Scenario: Port type is driver-free

- GIVEN the `SchemaAdapter` port type declaration in `src/core/ports`
- WHEN the core module graph is statically analysed (boundary lint)
- THEN it imports NO driver (`better-sqlite3`, `node:sqlite`, `mssql`, `pg`, `mysql2`), adapter, MCP or CLI symbol
- AND it is implementable by a test double that requires no database connection

#### Scenario: SchemaAdapterConfig union includes the mysql variant without a shape change

- GIVEN the `SchemaAdapterConfig` discriminated union in `src/core/ports`
- WHEN its variants are enumerated
- THEN it includes a `MysqlAdapterConfig` variant for the `mysql` dialect alongside `sqlite`, `mssql` and `pg`
- AND `MysqlAdapterConfig` carries `host`, optional `port`, `database`, `user`, `password` and optional `ssl`, and NO `schema?` field
- AND no new method is added to the `SchemaAdapter` port (the port SHAPE is unchanged)

#### Scenario: The union is non-discriminable by shape and dispatch keys on the explicit dialect

- GIVEN both `PgAdapterConfig` and `MysqlAdapterConfig` carry a `host` field
- WHEN the runtime resolves which adapter to construct from a source config
- THEN it dispatches on the explicit `dialect` field, NOT on the union member's structural shape
- AND the stale `PgAdapterConfig` JSDoc claiming it is "distinguished by `host`" is corrected to record the union is intentionally non-discriminable by shape

### Requirement: Supported dialects, capabilitiesFor and UnsupportedDialectError recognize mysql

The dialect registry SHALL recognize `mysql` as a supported dialect across all four touch points
TOGETHER: `SUPPORTED_DIALECTS` (config schema) MUST include `'mysql'` (alongside `'sqlite'`, `'mssql'`
and `'pg'`); `capabilitiesFor(dialect)` MUST return `MYSQL_CAPABILITIES` for `'mysql'`; and the pinned
`UnsupportedDialectError` message MUST list the supported dialects as `sqlite, mssql, pg, mysql`. The
message is a CONTRACT: its updated text and its pinned assertion MUST change in the SAME batch, and the
`UnsupportedDialectError` → exit code `4` mapping (exit-code mapping) MUST be VERIFIED unchanged (no
`exit-code.ts` code change — only a regression assertion). An unknown dialect MUST still raise
`UnsupportedDialectError` (not an opaque error), and `'mysql'` MUST NOT be reported as unsupported.

#### Scenario: mysql is a supported dialect and resolves its capabilities

- GIVEN the dialect registry after this change
- WHEN `'mysql'` is checked against `SUPPORTED_DIALECTS` and passed to `capabilitiesFor`
- THEN `'mysql'` is reported as supported
- AND `capabilitiesFor('mysql')` returns `MYSQL_CAPABILITIES`

#### Scenario: UnsupportedDialectError lists mysql and maps to exit code 4

- GIVEN an unknown (still-unsupported) dialect string
- WHEN the dialect is resolved
- THEN it raises `UnsupportedDialectError` whose message lists the supported dialects as `sqlite, mssql, pg, mysql`
- AND the `UnsupportedDialectError` → exit code mapping remains exit code `4` (verified unchanged, no code change)

#### Scenario: Pinned message and its assertion change together

- GIVEN the pinned `UnsupportedDialectError` message and its test assertion
- WHEN the supported-dialect list is updated to include `mysql`
- THEN the message text and its pinned assertion are updated in the SAME batch (the contract stays in sync)
