# Schema Extraction Specification (delta — phase-2-sqlite-extraction)

## Purpose

The engine-agnostic `SchemaAdapter` port contract: the lifecycle and guarantees EVERY source-database
adapter MUST honour to feed the existing `graph-normalization` capability. This delta ADDS the port
that turns a live source database into the engine-agnostic `RawCatalog` already defined by
`graph-model`. Per ADR-004 the port lives in `src/core/ports` and references NO driver, adapter, MCP
or CLI symbol. Stories: US-026 (first concrete adapter), US-031 (read-only by construction), US-009
(per-engine fingerprint). This capability is purely additive; it consumes existing `graph-model`
contracts (`CapabilityMatrix`, `ExtractionScope`, `RawCatalog`) without modifying them.

## ADDED Requirements

### Requirement: SchemaAdapter port lives in core and imports no driver

The model SHALL define a `SchemaAdapter` port in `src/core/ports` exposing a `dialect` identifier, a
`capabilities: CapabilityMatrix`, and the lifecycle methods `connect()`, `extract(scope): Promise<RawCatalog>`,
`fingerprint(): Promise<string>` and `close()`. The port MUST be expressible without importing any
driver, adapter, MCP or CLI symbol (ADR-004); the concrete join to a driver belongs to an adapter
outside core.

#### Scenario: Port type is driver-free

- GIVEN the `SchemaAdapter` port type declaration in `src/core/ports`
- WHEN the core module graph is statically analysed (boundary lint)
- THEN it imports NO driver (`better-sqlite3`, `node:sqlite`), adapter, MCP or CLI symbol
- AND it is implementable by a test double that requires no database connection

#### Scenario: Port exposes dialect and capability matrix

- GIVEN a value implementing `SchemaAdapter`
- WHEN its `dialect` and `capabilities` are read
- THEN `dialect` is a stable engine identifier
- AND `capabilities` is a `CapabilityMatrix` as defined by `graph-model`

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
