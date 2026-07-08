# Schema Extraction Specification

## Purpose

The engine-agnostic `SchemaAdapter` port contract: the lifecycle and guarantees EVERY source-database
adapter MUST honour to feed the existing `graph-normalization` capability. The port turns a live source
database into the engine-agnostic `RawCatalog` defined by `graph-model`. Per ADR-004 the port lives in
`src/core/ports` and references NO driver, adapter, MCP or CLI symbol. Stories: US-026 (first concrete
adapter), US-031 (read-only by construction), US-009 (per-engine fingerprint). This capability
consumes existing `graph-model` contracts (`CapabilityMatrix`, `ExtractionScope`, `RawCatalog`) without
modifying them. Supported dialects: `sqlite` (phase-2-sqlite-extraction), `mssql`
(phase-3-sqlserver-adapter), `pg` (phase-8a-pg), `mysql` (phase-8b-mysql), `mongodb`
(phase-9b-mongodb).

## Requirements

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

### Requirement: Adapter lifecycle is connect → extract/fingerprint → close

A `SchemaAdapter` SHALL follow an explicit lifecycle: `connect()` MUST establish a usable connection
to the source database before any `extract()` or `fingerprint()` call; `extract()` and `fingerprint()`
MAY be called any number of times while connected; `close()` MUST release the connection and MUST be
idempotent (a second `close()` MUST NOT throw).

#### Scenario: extract requires a prior connect

- GIVEN a freshly constructed `SchemaAdapter` that has not been connected
- WHEN `extract(scope)` is called
- THEN the adapter SHALL reject (it does not silently return an empty catalog)

#### Scenario: close is idempotent

- GIVEN a connected `SchemaAdapter`
- WHEN `close()` is called twice in sequence
- THEN the first call releases the connection
- AND the second call MUST NOT throw

### Requirement: Typed errors with actionable messages

The model SHALL define a typed `ConnectionError` raised by `connect()` when the source database is
missing, unreadable or corrupt. The error message MUST be actionable: it MUST name the failing
condition and SHOULD state the corrective action. When a required driver package is absent, the error
message MUST state the exact install command (`npm i <package>`) per the E5 common criteria.

#### Scenario: Missing source file raises ConnectionError

- GIVEN a connection target pointing at a non-existent source database
- WHEN `connect()` is called
- THEN it SHALL reject with a typed `ConnectionError`
- AND the message names the missing/unreadable target and an actionable next step

#### Scenario: Corrupt source file raises ConnectionError

- GIVEN a connection target pointing at a corrupt or unreadable source database
- WHEN `connect()` is called
- THEN it SHALL reject with a typed `ConnectionError` (not an opaque driver error)

#### Scenario: Missing driver names the install command

- GIVEN the adapter's required driver package is not installed
- WHEN the adapter attempts to load it
- THEN the raised error message MUST contain the exact `npm i <package>` command

### Requirement: extract honours ExtractionScope levels

`extract(scope)` SHALL honour the `ExtractionScope` defined by `graph-model`: it MUST extract only the
object types and bodies permitted by the resolved indexing levels (`off`, `metadata`, `full`), and it
MUST NOT emit a `RawObject` for any type configured `off`. An object at `metadata` MUST be extracted
WITHOUT its body; an object at `full` MUST include its body.

#### Scenario: off-level type is absent from the catalog

- GIVEN an `ExtractionScope` that sets a supported object type to `off`
- WHEN `extract(scope)` runs
- THEN the returned `RawCatalog` contains NO object of that type

#### Scenario: metadata level omits the body

- GIVEN an `ExtractionScope` that sets an object type to `metadata`
- WHEN `extract(scope)` runs
- THEN the corresponding `RawObject`s are present
- AND their body is NOT included

### Requirement: extract produces a RawCatalog the normalizer can consume

`extract(scope)` SHALL return a `RawCatalog` conforming to the `graph-model` contract: the value MUST
be consumable by the existing `normalizeCatalog` (graph-normalization) without any adapter import. The
adapter MUST NOT change or extend the `RawCatalog` contract.

#### Scenario: Extracted catalog feeds the normalizer

- GIVEN a `RawCatalog` returned by a `SchemaAdapter.extract`
- WHEN it is passed to `normalizeCatalog`
- THEN normalization succeeds with no adapter or driver import in scope
- AND the catalog requires no further enrichment to be valid normalizer input

### Requirement: Adapters are read-only by construction

Every `SchemaAdapter` SHALL open the source database in read-only mode and SHALL issue catalog reads
only (US-031). A write attempted through the adapter's connection MUST fail by construction, not by
luck. This requirement is a port-level guarantee binding on all concrete source adapters.

#### Scenario: A write through the adapter connection fails

- GIVEN a `SchemaAdapter` connected to a source database
- WHEN a write statement is attempted through that adapter's connection
- THEN the operation MUST fail (read-only enforced by the connection, not by convention)

### Requirement: Honest capability reporting

A `SchemaAdapter` SHALL declare a `CapabilityMatrix` that truthfully matches what the engine actually
supports (E5 common criterion). The matrix MUST report unsupported object types as unsupported; the
adapter MUST NOT emit objects of a type its matrix declares unsupported.

#### Scenario: Declared matrix matches emitted object types

- GIVEN a `SchemaAdapter` whose `capabilities` declares a type unsupported
- WHEN `extract(scope)` runs against a database containing such an object
- THEN the returned `RawCatalog` contains NO object of the unsupported type
- AND the matrix continues to report that type as unsupported

### Requirement: fingerprint is one cheap query for drift detection

`fingerprint()` SHALL compute a drift fingerprint using exactly ONE cheap catalog query (US-009; E5
common criterion). It MUST NOT walk all objects. The fingerprint MUST change when the schema (DDL)
changes and SHOULD remain stable when only data changes; the exact catalog query is engine-specific
(see sqlite-extraction).

#### Scenario: fingerprint does not walk all objects

- GIVEN a connected `SchemaAdapter`
- WHEN `fingerprint()` is called
- THEN it issues a single cheap catalog query
- AND it does NOT enumerate every object to compute the value

### Requirement: Honest dependency hints, deferred body parsing

For module-like objects (views, triggers and, in later phases, procedures/functions), a
`SchemaAdapter` SHALL emit dependency hints (`reads_from`/`writes_to`/`depends_on`) only where they are
trivially and honestly derivable from the catalog. Where a body cannot be reliably parsed, the adapter
MUST mark the object `has_dynamic_sql: true` (US-007) rather than guess. Full SQL body parsing into
read/write references is explicitly DEFERRED beyond Phase 2 (the SQL Server adapter, US-027, Phase 3,
is the first to parse bodies into `confidence: parsed` edges).

#### Scenario: Unparseable body is flagged, not guessed

- GIVEN a module object whose body cannot be reliably parsed into references
- WHEN it is extracted
- THEN the resulting `RawObject` is marked `has_dynamic_sql: true`
- AND NO speculative `reads_from`/`writes_to` edge is fabricated for it

#### Scenario: Full body parsing is out of scope for Phase 2

- GIVEN the Phase 2 `SchemaAdapter` contract
- WHEN dependency hints are produced
- THEN only catalog-trivial hints are required
- AND full SQL-body dependency parsing is deferred to a later phase (first delivered by US-027, Phase 3)

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

### Requirement: Optional RawField model path for schemaless field structure

The `RawCatalog` contract SHALL gain an OPTIONAL field-structure path: a typed `RawField` carried under
an optional `RawObject.fields?`, normalized into `'field'` nodes (US-030; phase-9b-mongodb). A `RawField`
MUST carry a field PATH (the dotted/array-encoded field name), its observed dataType (a UNION encoding
for schemaless engines) and its presence FREQUENCY. The `'field'` `NodeKind`, the `levels.fields` config
and `getLevelForKind('field')` ALREADY exist; this path completes the normalizer's `field` branch. This
is ADDITIVE and OPTIONAL: SQL engines (sqlite, mssql, pg, mysql) MUST leave `RawObject.fields` UNSET and
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

### Requirement: Body-tokenizer primitives factored into a shared module with no MSSQL or PG behavior change

The read/write body-tokenizer primitives (`canonicalizeQName`, `classifyAccess`, `extractWriteTargets`,
`maskDynamicStrings`, `bodyContainsRef`) SHALL live in a SHARED
`src/adapters/engines/_shared/tokenizer-core.ts` module (US-028a, phase-8b-mysql D10). The original three
primitives (`canonicalizeQName`, `classifyAccess`, `extractWriteTargets`) were factored from
`src/adapters/engines/mssql/tokenizer.ts` (US-028a / phase-8a-pg). The SAFETY-CRITICAL phantom-edge
helpers (`maskDynamicStrings` + `bodyContainsRef`) were promoted from `pg/tokenizer.ts` into `_shared/`
(phase-8b-mysql D10) so both the PG and MySQL tokenizers share one implementation of the CRITICAL-1 fix
with no risk of divergence. All adapters MUST import these primitives from `_shared/` rather than
defining local copies; NO behavioral change to MSSQL or PG — their `RawCatalog` goldens MUST remain
BYTE-IDENTICAL. Each engine SHALL supply its own dialect specifics (quoting and the `hasDynamicSql`
pattern — `EXEC`/`sp_executesql` for MSSQL, plpgsql `EXECUTE` for PG, `PREPARE`/`EXECUTE` for MySQL)
on top of the shared primitives.

#### Scenario: Shared tokenizer-core is the single source of all body-tokenizer primitives

- GIVEN the engines tree after phase-8b-mysql
- WHEN the body-tokenizer primitives are located
- THEN `canonicalizeQName`, `classifyAccess`, `extractWriteTargets`, `maskDynamicStrings` and `bodyContainsRef` all live in `src/adapters/engines/_shared/tokenizer-core.ts`
- AND no adapter defines local copies of these functions

#### Scenario: MSSQL and PG goldens stay byte-identical after the _shared promotion

- GIVEN the MSSQL and PG adapters importing the tokenizer primitives from `_shared/`
- WHEN the torture extractions and their goldens are re-run
- THEN the MSSQL and PG `RawCatalog` and golden outputs are BYTE-IDENTICAL to before the refactor (ADR-008)
- AND neither MSSQL nor PG behavior is changed

#### Scenario: Each engine supplies its own dynamic-SQL pattern over the shared primitives

- GIVEN the shared `tokenizer-core.ts` primitives
- WHEN MSSQL, PG and MySQL classify their bodies
- THEN MSSQL flags `hasDynamicSql` on `EXEC`/`sp_executesql`, PG on the plpgsql `EXECUTE` statement, and MySQL on `PREPARE`/`EXECUTE`
- AND each engine applies its own dialect quoting while reusing the shared primitives

### Requirement: Optional RawObject.parameters is an engine-agnostic, honest-absence contract

The `RawCatalog` contract SHALL carry an OPTIONAL routine-parameter path: a typed `RawParameter` (defined
by `graph-model`) under an OPTIONAL `RawObject.parameters?`. Every adapter whose engine EXPOSES a
parameter catalog (mssql `sys.parameters`, pg `pg_proc` argument arrays, mysql
`information_schema.PARAMETERS`) MUST populate it on each procedure/function `RawObject`; every adapter
whose engine exposes NO parameter catalog (sqlite) MUST leave it UNSET. This path is ADDITIVE and
OPTIONAL: it adds NO port method and does NOT change the `SchemaAdapter` port SHAPE, and an adapter that
does not populate `parameters` MUST keep its existing `RawCatalog` goldens BYTE-IDENTICAL (ADR-008).
Parameters MUST be provenance `declared` (catalog-sourced) — NEVER inferred, never fabricated — ordered
by ascending `ordinal`, and MUST distinguish "unknown" (UNSET, no parameter catalog) from "known-zero"
(an empty array for a real no-argument routine). Per-engine `dataType` composition follows the SAME
engine's COLUMN `dataType` convention (`graph-model`); this port contract does NOT normalize type strings
across engines.

#### Scenario: An adapter with a parameter catalog populates parameters

- GIVEN an adapter whose engine exposes a routine-parameter catalog
- WHEN `extract(scope)` returns its `RawCatalog`
- THEN each procedure/function `RawObject` carries a `parameters` array of `RawParameter` in ascending `ordinal`
- AND the array is provenance `declared` (catalog-sourced), never inferred
- AND no new `SchemaAdapter` port method is introduced (the port SHAPE is unchanged)

#### Scenario: An engine without a parameter catalog leaves the field unset and stays byte-identical

- GIVEN an adapter whose engine exposes NO parameter catalog (e.g. sqlite)
- WHEN `extract(scope)` runs
- THEN no `RawObject` carries a `parameters` field (UNSET, not `[]`) — honest absence, declared
- AND that adapter's existing `RawCatalog` goldens remain BYTE-IDENTICAL (the field is purely additive)
