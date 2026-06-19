# Schema Extraction Specification (delta — phase-8a-pg)

## Purpose

A SMALL delta to the engine-agnostic `SchemaAdapter` capability for the PostgreSQL adapter
(`pg-extraction`). The port SHAPE is UNCHANGED — `dialect`, `capabilities`, `connect`, `extract`,
`fingerprint`, `close` are exactly as defined by `phase-2-sqlite-extraction`. This delta records only the
DIALECT-REGISTRY touch points that must learn about `pg` (the `SchemaAdapterConfig` union,
`SUPPORTED_DIALECTS`, `capabilitiesFor`, and the pinned `UnsupportedDialectError` message together with
its exit-code-4 mapping), and the relocation of the body-tokenizer primitives into a SHARED
`engines/_shared/tokenizer-core.ts` module with NO behavioral change to the SQL Server adapter (its
goldens stay byte-identical). Stories: US-028 (PostgreSQL adapter), US-028a (shared body-tokenizer
module). This delta adds NO new port method, NO new lifecycle step and NO change to `graph-model`,
`graph-normalization`, `graph-storage` or `graph-query`.

## MODIFIED Requirements

### Requirement: SchemaAdapter port lives in core and imports no driver

The model SHALL define a `SchemaAdapter` port in `src/core/ports` exposing a `dialect` identifier, a
`capabilities: CapabilityMatrix`, and the lifecycle methods `connect()`, `extract(scope): Promise<RawCatalog>`,
`fingerprint(): Promise<string>` and `close()`. The port MUST be expressible without importing any
driver, adapter, MCP or CLI symbol (ADR-004); the concrete join to a driver belongs to an adapter
outside core. The `SchemaAdapterConfig` discriminated union (the config side of the port) SHALL include a
`PgAdapterConfig` variant for the `pg` dialect alongside the existing `sqlite` and `mssql` variants; this
extends the union ONLY — it adds no new port method and does not change the port SHAPE (the port file
already cites `'pg'` as an example dialect).

#### Scenario: Port type is driver-free

- GIVEN the `SchemaAdapter` port type declaration in `src/core/ports`
- WHEN the core module graph is statically analysed (boundary lint)
- THEN it imports NO driver (`better-sqlite3`, `node:sqlite`, `mssql`, `pg`), adapter, MCP or CLI symbol
- AND it is implementable by a test double that requires no database connection

#### Scenario: Port exposes dialect and capability matrix

- GIVEN a value implementing `SchemaAdapter`
- WHEN its `dialect` and `capabilities` are read
- THEN `dialect` is a stable engine identifier
- AND `capabilities` is a `CapabilityMatrix` as defined by `graph-model`

#### Scenario: SchemaAdapterConfig union includes the pg variant without a shape change

- GIVEN the `SchemaAdapterConfig` discriminated union in `src/core/ports`
- WHEN its variants are enumerated
- THEN it includes a `PgAdapterConfig` variant for the `pg` dialect alongside `sqlite` and `mssql`
- AND no new method is added to the `SchemaAdapter` port (the port SHAPE is unchanged)

## ADDED Requirements

### Requirement: Supported dialects, capabilitiesFor and UnsupportedDialectError recognize pg

The dialect registry SHALL recognize `pg` as a supported dialect across all four touch points TOGETHER:
`SUPPORTED_DIALECTS` (config schema) MUST include `'pg'` (alongside `'sqlite'` and `'mssql'`);
`capabilitiesFor(dialect)` MUST return `PG_CAPABILITIES` for `'pg'`; and the pinned `UnsupportedDialectError`
message MUST list the supported dialects as `sqlite, mssql, pg`. The message is a CONTRACT: its updated
text and its pinned assertion MUST change in the SAME batch, and the `UnsupportedDialectError` → exit code
`4` mapping (exit-code mapping) MUST be VERIFIED unchanged. An unknown dialect MUST still raise
`UnsupportedDialectError` (not an opaque error), and `'pg'` MUST NOT be reported as unsupported.

#### Scenario: pg is a supported dialect and resolves its capabilities

- GIVEN the dialect registry after this change
- WHEN `'pg'` is checked against `SUPPORTED_DIALECTS` and passed to `capabilitiesFor`
- THEN `'pg'` is reported as supported
- AND `capabilitiesFor('pg')` returns `PG_CAPABILITIES`

#### Scenario: UnsupportedDialectError lists pg and maps to exit code 4

- GIVEN an unknown (still-unsupported) dialect string
- WHEN the dialect is resolved
- THEN it raises `UnsupportedDialectError` whose message lists the supported dialects as `sqlite, mssql, pg`
- AND the `UnsupportedDialectError` → exit code mapping remains exit code `4` (verified unchanged)

#### Scenario: Pinned message and its assertion change together

- GIVEN the pinned `UnsupportedDialectError` message and its test assertion
- WHEN the supported-dialect list is updated to include `pg`
- THEN the message text and its pinned assertion are updated in the SAME batch (the contract stays in sync)

### Requirement: Body-tokenizer primitives factored into a shared module with no MSSQL behavior change

The read/write body-tokenizer primitives (`canonicalizeQName`, `classifyAccess`, `extractWriteTargets`)
SHALL be factored from `src/adapters/engines/mssql/tokenizer.ts` into a SHARED
`src/adapters/engines/_shared/tokenizer-core.ts` module (US-028a). The SQL Server adapter MUST be
refactored to import these primitives from `_shared/` with NO behavioral change: the MSSQL `RawCatalog`
and all MSSQL goldens MUST remain BYTE-IDENTICAL after the refactor. Each engine SHALL supply its own
dialect specifics (quoting and the `hasDynamicSql` pattern — `EXEC`/`sp_executesql` for MSSQL, the plpgsql
`EXECUTE` statement for PG) on top of the shared primitives. The shared module is the SOLE tokenizer
artifact the pre-planned `phase-8b-mysql` change consumes; this delta neither imports `pg` nor changes the
core/port shape.

#### Scenario: Shared tokenizer-core is the single source of the primitives

- GIVEN the engines tree after this change
- WHEN the body-tokenizer primitives are located
- THEN `canonicalizeQName`, `classifyAccess` and `extractWriteTargets` live in `src/adapters/engines/_shared/tokenizer-core.ts`
- AND the MSSQL adapter imports them from `_shared/` rather than defining its own copies

#### Scenario: MSSQL goldens stay byte-identical after the refactor

- GIVEN the MSSQL adapter refactored to import the tokenizer primitives from `_shared/`
- WHEN the MSSQL torture extraction and its goldens are re-run
- THEN the MSSQL `RawCatalog` and golden outputs are BYTE-IDENTICAL to before the refactor (ADR-008)
- AND the MSSQL behavior is unchanged

#### Scenario: Each engine supplies its own dynamic-SQL pattern over the shared primitives

- GIVEN the shared `tokenizer-core.ts` primitives
- WHEN MSSQL and PG classify their bodies
- THEN MSSQL flags `hasDynamicSql` on `EXEC`/`sp_executesql` and PG flags it on the plpgsql `EXECUTE` statement
- AND each engine applies its own dialect quoting while reusing the shared primitives
