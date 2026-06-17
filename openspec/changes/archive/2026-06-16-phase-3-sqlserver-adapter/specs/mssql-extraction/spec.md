# MSSQL Extraction Specification (delta — phase-3-sqlserver-adapter)

## Purpose

The concrete SQL Server `MssqlSchemaAdapter`: which catalog objects it extracts from `sys.*`
(tables, columns with types/nullability/defaults/computed, PK/FK/unique/check constraints, indexes
including clustered/nonclustered/filtered/included, views, stored procedures, scalar and table-valued
functions, triggers with event and timing, sequences, and `MS_Description` extended properties as
comments), its truthful `CapabilityMatrix` (procedures, functions and sequences SUPPORTED — unlike
SQLite), its `confidence: parsed` `reads_from`/`writes_to` classification from module bodies via a
conservative tokenizer with honest `has_dynamic_sql` blindness, its `fires_on` trigger edges
(event + timing), its `fingerprint()` over `sys.objects`, its connectivity (SQL auth and NTLM; Kerberos
SSO unsupported), its minimal `VIEW DEFINITION`-only login plus actionable `PermissionError`, and the
Testcontainers golden-pinned end-to-end pipeline. Stories: US-027 (SQL Server adapter), US-007
(extraction half — body parsing into read/write edges), US-009 (mssql fingerprint), US-031 (read-only
by construction), US-033 (minimal permissions and actionable errors).

This adapter is the SECOND concrete `SchemaAdapter` (see `schema-extraction`, the engine-agnostic port
it MUST satisfy unchanged) and the sibling of the SQLite adapter (see `sqlite-extraction` for the
established pattern). It lives under `src/adapters/engines/mssql/` per ADR-004 (adapter outside core);
the core and the `SchemaAdapter` port MUST NOT change. It consumes the existing `graph-model`
(`CapabilityMatrix`, `ExtractionScope`, `RawCatalog`, edge/confidence vocabulary), `graph-normalization`,
`graph-storage` and `graph-query` contracts unchanged.

> **Honest Phase-3 boundary.** Read/write classification is derived by a CONSERVATIVE body tokenizer
> over `sql_modules.definition` — NOT a full T-SQL grammar parser (ADR-007). Any body the tokenizer
> cannot reliably resolve (notably dynamic SQL via `EXEC`/`sp_executesql`) is marked
> `has_dynamic_sql: true` and yields NO speculative edges. Full-fidelity T-SQL parsing is explicitly
> DEFERRED and NOT committed to any later phase — it is recorded here as a known limitation.

## ADDED Requirements

### Requirement: Extract tables and columns including types, nullability, defaults and computed columns

The mssql adapter SHALL extract every user table and its columns from `sys.tables`/`sys.columns`
(joined to `sys.types`), capturing for each column its name, declared SQL Server type, nullability,
default constraint expression where present, and whether the column is COMPUTED (US-027). A computed
column MUST be represented as computed (its computed nature MUST NOT be dropped or rendered as a plain
column). System and internal objects (e.g. those not user-defined) MUST be excluded.

#### Scenario: Tables and columns are extracted with type, nullability and default

- GIVEN a SQL Server database with user tables containing typed, nullable, and defaulted columns
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains each user table with its columns
- AND each column carries name, declared SQL Server type, nullability and any default expression
- AND system/internal objects are absent from the catalog

#### Scenario: Computed column is represented as computed

- GIVEN a table with a computed column (e.g. `total AS (qty * price)`)
- WHEN `extract(scope)` runs
- THEN the column is present and represented as COMPUTED (its computed nature is not lost)

### Requirement: Extract PK, FK (including composite), unique and check constraints

The mssql adapter SHALL extract primary keys, foreign keys, unique constraints and check constraints
from `sys.key_constraints`, `sys.foreign_keys`/`sys.foreign_key_columns` and `sys.check_constraints`
(US-027). COMPOSITE constraints (a single PK/FK/unique spanning multiple columns) MUST be represented
as ONE constraint with its ordered column membership preserved (grouped, not split into separate
single-column constraints). A foreign key MUST preserve its ordered local→referenced column mapping.

#### Scenario: Single-column primary and foreign keys are extracted

- GIVEN a table with a single-column primary key and a single-column foreign key to another table
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains that primary key and that foreign key
- AND the foreign key carries its local and referenced column

#### Scenario: Composite foreign key keeps its column pairs grouped

- GIVEN a table with a composite foreign key over two or more columns
- WHEN `extract(scope)` runs
- THEN the foreign key is represented as ONE constraint
- AND its ordered local→referenced column pairs are all preserved (not split into separate single-column FKs)

#### Scenario: Composite primary, unique and check constraints are extracted

- GIVEN a table with a composite primary key, a multi-column unique constraint and a check constraint
- WHEN `extract(scope)` runs
- THEN each is present as ONE constraint with its ordered column membership preserved
- AND the check constraint carries its predicate expression

### Requirement: Extract indexes including clustered/nonclustered, filtered and included columns

The mssql adapter SHALL extract indexes from `sys.indexes`/`sys.index_columns` (US-027), capturing for
each index whether it is CLUSTERED or NONCLUSTERED, whether it is UNIQUE, whether it is FILTERED (its
`WHERE` predicate) and its INCLUDED (non-key) columns where present. The clustered/nonclustered nature,
the filter predicate and the included columns MUST be represented honestly (not dropped or conflated
with key columns). Indexes auto-created to back PK/unique constraints MUST be attributed consistently
(not double-counted as a free-standing index AND a constraint inconsistently).

#### Scenario: Clustered vs nonclustered nature is captured

- GIVEN a table with a clustered index and a separate nonclustered index
- WHEN `extract(scope)` runs
- THEN both indexes are present
- AND each reports its clustered/nonclustered nature

#### Scenario: Filtered index keeps its WHERE predicate

- GIVEN a nonclustered index defined with a `WHERE` clause (filtered index)
- WHEN `extract(scope)` runs
- THEN the index is present and its filter predicate is represented (not dropped)

#### Scenario: Included (non-key) columns are distinguished from key columns

- GIVEN a nonclustered index with key columns and `INCLUDE`d non-key columns
- WHEN `extract(scope)` runs
- THEN the index is present
- AND its included columns are represented and distinguished from its key columns

### Requirement: Extract views, procedures, functions and triggers with bodies per level

The mssql adapter SHALL extract views, stored procedures, scalar functions, table-valued functions and
triggers, taking their definition bodies from `sys.sql_modules.definition` (US-027). Bodies MUST be
governed by the resolved indexing level (schema-extraction): at `full` the body is included; at
`metadata` the object is present WITHOUT its body; an object type configured `off` MUST be absent from
the catalog. Scalar functions and table-valued functions MUST both be extracted and distinguishable.
Each trigger MUST carry its firing event AND its timing so `graph-model`'s `fires_on` edge (with
`event`) can be derived downstream.

#### Scenario: View is extracted with its definition body at full

- GIVEN a view and an `ExtractionScope` resolving views to `full`
- WHEN `extract(scope)` runs
- THEN the view is present with its definition body from `sys.sql_modules.definition`

#### Scenario: Stored procedure and both function kinds are extracted and distinguishable

- GIVEN a stored procedure, a scalar function and a table-valued function
- WHEN `extract(scope)` runs
- THEN all three are present in the `RawCatalog`
- AND the scalar function and the table-valued function are distinguishable from each other and from the procedure

#### Scenario: Trigger carries its firing event and timing

- GIVEN an `AFTER UPDATE` trigger on a table
- WHEN `extract(scope)` runs
- THEN the trigger is present
- AND it carries its firing event (`UPDATE`) and its timing (`AFTER`)

#### Scenario: Metadata level omits the body, off level omits the object

- GIVEN a procedure resolved to `metadata` and another module type resolved to `off`
- WHEN `extract(scope)` runs
- THEN the `metadata` procedure is present WITHOUT its body
- AND no object of the `off` type appears in the catalog

### Requirement: Extract sequences

The mssql adapter SHALL extract user-defined sequences from `sys.sequences` (US-027). Each sequence
MUST be present in the `RawCatalog` as a sequence object consistent with the adapter's
`CapabilityMatrix` declaring sequences supported.

#### Scenario: Sequence is extracted

- GIVEN a SQL Server database containing a user-defined sequence
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains that sequence as a sequence object

### Requirement: Surface MS_Description extended properties as comments

The mssql adapter SHALL read `MS_Description` extended properties from `sys.extended_properties`
(US-027) and surface them as the comment/description of the object or column they annotate. The comment
MUST be attached to the correct target (table, column, view, procedure, etc.); an object without an
`MS_Description` MUST simply carry no comment (absence is not an error).

#### Scenario: MS_Description is surfaced as the object comment

- GIVEN a table and a column each annotated with an `MS_Description` extended property
- WHEN `extract(scope)` runs
- THEN the table and the column each carry their `MS_Description` text as their comment
- AND an object with no `MS_Description` carries no comment

### Requirement: Truthful SQL Server CapabilityMatrix

The mssql adapter's `CapabilityMatrix` SHALL truthfully report that SQL Server supports tables,
columns, foreign keys, indexes, views, triggers, procedures, functions and sequences (US-027; E5 common
criterion). Unlike SQLite, the matrix MUST report procedures, functions and sequences as SUPPORTED, and
it MUST itself say so (supported types are explicitly declared supported, not merely emitted). The
adapter MUST NOT emit any object of a type its matrix declares unsupported, and 100% of the matrix MUST
be exercised by the torture fixture.

#### Scenario: Matrix declares procedures, functions and sequences supported

- GIVEN the mssql adapter's `CapabilityMatrix`
- WHEN the supported types are queried
- THEN procedures, functions and sequences are each reported as SUPPORTED
- AND tables, columns, foreign keys, indexes, views and triggers are also reported as supported

#### Scenario: Matrix differs from SQLite on procedures/functions/sequences

- GIVEN the mssql `CapabilityMatrix` compared against the SQLite `CapabilityMatrix`
- WHEN procedure, function and sequence support is compared
- THEN mssql reports them SUPPORTED while SQLite reports them unsupported (the matrices are truthfully different)

### Requirement: Parsed reads_from and writes_to from module bodies

The mssql adapter SHALL classify dependency edges with `confidence: 'parsed'` (US-007, US-027) by
combining `sys.sql_expression_dependencies` (object→object relationships) with a CONSERVATIVE tokenizer
over `sql_modules.definition`. A target written by `INSERT`/`UPDATE`/`DELETE`/`MERGE` MUST produce a
`writes_to` edge from the module to that object; an object only read (e.g. `SELECT FROM`) MUST produce a
`reads_from` edge from the module to that object. Both edge kinds MUST carry `confidence: parsed` (no
`score`, per `graph-model`). The classification MUST be conservative: ambiguous direction MUST NOT be
guessed as a write or a read — it MUST instead fall under the dynamic-SQL blindness rule below.

#### Scenario: Procedure writing one object and reading another yields directed parsed edges

- GIVEN a stored procedure whose body does `INSERT INTO a` and `SELECT FROM b`
- WHEN `extract(scope)` runs at `full`
- THEN a `writes_to` edge from the procedure to `a` exists with `confidence: parsed`
- AND a `reads_from` edge from the procedure to `b` exists with `confidence: parsed`

#### Scenario: Procedure writing two objects and reading a third

- GIVEN a stored procedure whose body writes to objects `X` and `Y` (e.g. `INSERT`/`UPDATE`/`DELETE`/`MERGE`) and reads object `Z`
- WHEN `extract(scope)` runs at `full`
- THEN `writes_to` edges from the procedure to `X` and to `Y` exist with `confidence: parsed`
- AND a `reads_from` edge from the procedure to `Z` exists with `confidence: parsed`

### Requirement: Trigger fires_on plus its write/read effects

The mssql adapter SHALL emit, for each trigger at `full`, the data it derives so that a `fires_on`
edge (carrying its `event`, per `graph-model`) is derivable, AND the trigger's body effects classified
as `reads_from`/`writes_to` with `confidence: parsed` (US-007). An `AFTER UPDATE` trigger on a table
`T` that writes an audit table `A` MUST yield a `fires_on` relationship from the trigger to `T` with
`event = UPDATE` (and `timing = AFTER` captured per the trigger-extraction requirement) AND a
`writes_to` edge from the trigger to `A` with `confidence: parsed`.

#### Scenario: AFTER UPDATE trigger fires on its table and writes its audit target

- GIVEN an `AFTER UPDATE` trigger on table `T` whose body writes to audit table `A`
- WHEN `extract(scope)` runs at `full`
- THEN a `fires_on` relationship from the trigger to `T` is derivable with `event = UPDATE` and timing `AFTER`
- AND a `writes_to` edge from the trigger to `A` exists with `confidence: parsed`

### Requirement: Dynamic SQL is flagged, never guessed

Where a module body cannot be reliably analyzed by the conservative tokenizer — notably dynamic SQL
executed via `EXEC`/`sp_executesql` — the mssql adapter MUST mark the module `has_dynamic_sql: true`
(US-007) and MUST NOT fabricate any `reads_from`/`writes_to`/`depends_on` edge for the unanalyzable
portion. This is the honest Phase-3 boundary: full-fidelity T-SQL parsing is DEFERRED and not committed
to any later phase.

#### Scenario: Dynamic-SQL procedure is flagged with no invented edges

- GIVEN a stored procedure whose body builds and runs dynamic SQL via `EXEC`/`sp_executesql`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure's `RawObject` is marked `has_dynamic_sql: true`
- AND NO speculative `reads_from`/`writes_to`/`depends_on` edge is fabricated for the dynamic portion

#### Scenario: Full-fidelity parsing is an acknowledged limitation, not a hidden gap

- GIVEN the Phase-3 conservative tokenizer
- WHEN a body cannot be resolved to definite read/write targets
- THEN the module is marked `has_dynamic_sql: true` rather than guessed
- AND full T-SQL grammar parsing is recorded as DEFERRED (not committed to any later phase)

### Requirement: fingerprint via one cheap query over sys.objects

The mssql adapter's `fingerprint()` SHALL run exactly ONE cheap catalog query — combining
`MAX(modify_date)` and a COUNT over `sys.objects` — to derive a drift fingerprint (US-009; E5 common
criterion). It MUST NOT enumerate every object. The fingerprint MUST change when the schema (DDL)
changes and MUST remain stable across data-only changes (inserts/updates/deletes that do not alter the
schema).

#### Scenario: fingerprint changes on DDL change

- GIVEN a connected mssql adapter with a computed fingerprint
- WHEN a DDL statement alters the schema (e.g. adding a column or object)
- THEN a subsequent `fingerprint()` returns a different value

#### Scenario: fingerprint is stable across data-only changes

- GIVEN a connected mssql adapter with a computed fingerprint
- WHEN only data changes (rows inserted/updated/deleted, no DDL)
- THEN a subsequent `fingerprint()` returns the same value

#### Scenario: fingerprint uses one cheap query and does not walk objects

- GIVEN a connected mssql adapter
- WHEN `fingerprint()` is called
- THEN it issues exactly ONE query combining `MAX(modify_date)` and a COUNT over `sys.objects`
- AND it does NOT enumerate every object to compute the value

### Requirement: Read-only by construction — catalog SELECTs only

The mssql adapter SHALL issue catalog read queries (`SELECT` over `sys.*`) ONLY and MUST NOT issue any
write statement through its connection (US-031). This adapter's SQL falls under the existing engines
write-verb scanner (sqlite-extraction) which scans `src/adapters/engines/**` and fails on write verbs;
the mssql adapter MUST NOT introduce SQL that fails that scan. Read-only posture is a port-level
guarantee (schema-extraction) reinforced at runtime by the minimal-permission login below.

#### Scenario: Adapter issues only catalog SELECTs

- GIVEN the mssql adapter connected to a source database
- WHEN it extracts or fingerprints
- THEN every statement it issues is a catalog `SELECT` over `sys.*`
- AND no `INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL statement is issued

#### Scenario: mssql SQL passes the engines write-verb scanner

- GIVEN the mssql adapter source under `src/adapters/engines/mssql/**`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write verb in the adapter's SQL
- AND the scan passes (write verbs appearing only in comments or string literals do not false-positive)

### Requirement: Minimal VIEW DEFINITION-only login documented

The repository SHALL ship `docs/permissions/mssql.md` containing a MINIMAL read-only login/user script
that grants only `VIEW DEFINITION` (plus `CONNECT`) and MUST NOT require `db_datareader` when statistics
and sampling are off (US-033). This login MUST be sufficient to extract the full torture schema (catalog
metadata only), proving no data-access permission is needed for metadata extraction.

#### Scenario: Permission doc ships the minimal login script

- GIVEN the repository
- WHEN `docs/permissions/mssql.md` is inspected
- THEN it contains a login/user script granting only `VIEW DEFINITION` and `CONNECT`
- AND it does NOT require `db_datareader` (no data access) for metadata extraction

#### Scenario: A VIEW DEFINITION-only login extracts the full torture schema

- GIVEN a SQL Server login holding only `VIEW DEFINITION` and `CONNECT` (no `db_datareader`)
- WHEN the adapter extracts the torture schema with statistics and sampling off
- THEN the full catalog is extracted successfully
- AND no data-access permission was required

### Requirement: Missing VIEW DEFINITION raises an actionable PermissionError

When the connected login lacks the catalog permission required at runtime (notably `VIEW DEFINITION`),
the mssql adapter SHALL reject with the existing typed `PermissionError` (schema-extraction; reused, not
redefined). The message MUST be actionable: it MUST name the missing permission (`VIEW DEFINITION`),
SHOULD name the object that required it, and MUST point to `docs/permissions/mssql.md` (US-033). The
adapter MUST NOT degrade to a partial/silent catalog when the permission is missing.

#### Scenario: Missing VIEW DEFINITION yields a typed, actionable PermissionError

- GIVEN a login WITHOUT `VIEW DEFINITION`
- WHEN `extract(scope)` attempts to read catalog definitions
- THEN it SHALL reject with the typed `PermissionError`
- AND the message names the missing `VIEW DEFINITION` permission and links to `docs/permissions/mssql.md`
- AND the adapter does NOT return a partial or silent catalog

### Requirement: Connectivity via SQL auth and NTLM; Kerberos SSO unsupported

The mssql adapter SHALL connect via the `mssql` driver (tedious/TDS) supporting BOTH SQL authentication
and NTLM (Windows authentication) with explicit credentials (US-027). Integrated Kerberos SSO is
explicitly NOT supported (a documented limitation, ADR-006). Attempting integrated Kerberos SSO MUST
fail fast with the existing typed `ConnectionError` whose message states that Kerberos SSO is
unsupported and directs the user to SQL auth or NTLM with explicit credentials — it MUST NOT hang or
emit an opaque driver error.

#### Scenario: SQL authentication connects with explicit credentials

- GIVEN a connection target configured for SQL authentication with explicit username and password
- WHEN `connect()` is called
- THEN it establishes a usable connection for subsequent `extract`/`fingerprint`

#### Scenario: NTLM authentication connects with explicit credentials

- GIVEN a connection target configured for NTLM (Windows) authentication with explicit credentials
- WHEN `connect()` is called
- THEN it establishes a usable connection for subsequent `extract`/`fingerprint`

#### Scenario: Integrated Kerberos SSO fails fast with an actionable ConnectionError

- GIVEN a connection target requesting integrated Kerberos SSO (no explicit credentials)
- WHEN `connect()` is called
- THEN it SHALL reject with the typed `ConnectionError`
- AND the message states Kerberos SSO is unsupported and points to SQL auth or NTLM with explicit credentials
- AND it does NOT hang or surface an opaque driver error

### Requirement: Missing mssql driver names the install command

Because `mssql` is an optional dependency loaded via a dynamic `import()` (ADR-006), when the package is
absent the adapter factory SHALL fail with an error whose message contains the exact install command
(`npm i mssql`), per the schema-extraction port contract and the E5 common criterion.

#### Scenario: Absent mssql driver names npm i mssql

- GIVEN the `mssql` package is not installed
- WHEN the adapter attempts to load it via dynamic import
- THEN the raised error message MUST contain the exact `npm i mssql` command

### Requirement: Committed T-SQL torture fixture materialized via Testcontainers

The repository SHALL provide a committed T-SQL torture schema (a plain-text `.sql` script under
`test/fixtures/mssql/`) that exercises 100% of the SQL Server capability matrix and, at minimum, a stored
procedure that writes two tables and reads a third, an `AFTER UPDATE` trigger that writes an audit table,
a filtered index with included columns, a computed column, and a table-valued function (US-027). The
integration setup MUST materialize this script into an ephemeral `mcr.microsoft.com/mssql/server`
Testcontainers instance; the committed artifact MUST be the reviewable `.sql` script (no binary
database blob). The integration job MUST NOT require Docker for the unit matrix and MUST skip-with-reason
where Docker is unavailable rather than fail.

#### Scenario: Fixture is a reviewable .sql script

- GIVEN the mssql torture fixture in the repository
- WHEN the committed artifact is inspected
- THEN it is a plain-text `.sql` script (not a binary database file)
- AND it is human-reviewable in a pull request

#### Scenario: Fixture exercises the required torture objects

- GIVEN the materialized torture database
- WHEN the adapter extracts it
- THEN the catalog covers a procedure writing two tables and reading a third, an `AFTER UPDATE` trigger writing an audit table, a filtered index with included columns, a computed column and a table-valued function
- AND 100% of the SQL Server capability matrix is exercised

#### Scenario: Integration setup uses an ephemeral container and skips without Docker

- GIVEN the mssql integration test
- WHEN Docker is available
- THEN setup materializes the `.sql` into an ephemeral `mcr.microsoft.com/mssql/server` Testcontainers instance
- AND WHEN Docker is unavailable the integration test is skipped with an explicit reason (the unit matrix never depends on Docker)

### Requirement: Golden-pinned RawCatalog and end-to-end pipeline

There SHALL be a deterministic golden test pinning the `RawCatalog` extracted from the torture schema:
the catalog MUST be serialized via the existing `stableStringify` and MUST be byte-identical across runs
(ADR-008). There SHALL ALSO be an end-to-end test driving the full pipeline — torture `.sql` →
materialize → adapter `extract` → `normalizeCatalog` → `SqliteGraphStore` upsert → query (`impact`,
`path`) — whose outputs are golden-pinned and byte-identical on re-run (US-027). The mssql CI job MUST
be gated, MUST NOT block the unit matrix, and MUST NOT touch the validation database.

#### Scenario: RawCatalog golden is deterministic and byte-identical

- GIVEN the materialized torture database
- WHEN the adapter `extract` output is serialized via `stableStringify`
- THEN it matches the golden `RawCatalog` file
- AND a second extraction on the same fixture produces byte-identical output (ADR-008)

#### Scenario: Full pipeline reaches impact and path queries golden-pinned

- GIVEN the materialized torture database
- WHEN the pipeline runs extract → `normalizeCatalog` → `SqliteGraphStore` upsert → query
- THEN `impact` and `path` queries return results over the persisted graph
- AND those outputs match their golden files and are byte-identical on re-run (ADR-008)

#### Scenario: mssql CI job is gated and never touches the validation database

- GIVEN the mssql integration/E2E job in CI
- WHEN the unit matrix runs
- THEN it does NOT depend on the gated mssql job
- AND the mssql job uses only an ephemeral container and never connects to the validation database
