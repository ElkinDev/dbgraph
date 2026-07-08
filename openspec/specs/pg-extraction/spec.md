# PostgreSQL Extraction Specification

## Purpose

The concrete PostgreSQL `PgSchemaAdapter`: which catalog objects it extracts from `pg_catalog.*` /
`information_schema` (schemas; tables, columns with types/nullability/defaults/identity & generated
columns; PK/FK/unique/CHECK constraints; indexes including partial/expression and PG11+ included
columns; views; materialized views emitted as `kind: 'view'` + `extra.materialized: true`; functions;
PG11+ procedures; triggers with event + timing via `CREATE TRIGGER ... EXECUTE FUNCTION`; sequences;
and `obj_description`/`col_description` comments), its truthful `CapabilityMatrix` (procedures,
functions, sequences and triggers SUPPORTED; `supportsBodies: true`; `supportsDependencyHints: false`),
its `confidence: 'parsed'` `reads_from`/`writes_to` classification from `pg_get_functiondef` /
`pg_get_viewdef` bodies via the SHARED tokenizer with honest `hasDynamicSql` blindness on plpgsql
dynamic `EXECUTE`, its `fingerprint()` over a catalog change marker, its connectivity
(host/port/database/user/password + optional ssl, `password` env-only, optional `schema?`), its
minimal read-only role plus actionable `PermissionError` per `docs/permissions/pg.md`, and the gated
Testcontainers golden-pinned end-to-end pipeline. Stories: US-028 (PostgreSQL adapter, Phase 8a),
US-028a (shared body-tokenizer module), US-028b (materialized views without a model change), US-007
(extraction half — body parsing into read/write edges), US-009 (pg fingerprint), US-031 (read-only by
construction), US-033 (minimal permissions and actionable errors).

This adapter is the THIRD concrete `SchemaAdapter` (see `schema-extraction`, the engine-agnostic port
it MUST satisfy UNCHANGED) and the sibling of the SQLite and SQL Server adapters (see `mssql-extraction`
for the established second-engine template it mirrors). It lives under `src/adapters/engines/pg/` per
ADR-004 (adapter outside core); the core and the `SchemaAdapter` port MUST NOT change. It loads its own
`pg` driver via a LAZY dynamic `import()` (ADR-006). It consumes the existing `graph-model`
(`CapabilityMatrix`, `ExtractionScope`, `RawCatalog`, edge/confidence vocabulary), `graph-normalization`,
`graph-storage` and `graph-query` contracts UNCHANGED.

> **Honest Phase-8a boundary.** Read/write classification is derived by the SHARED CONSERVATIVE body
> tokenizer (`engines/_shared/tokenizer-core.ts`) over `pg_get_functiondef`/`pg_get_viewdef` text — NOT
> a full plpgsql/SQL grammar parser (ADR-007). Any body the tokenizer cannot reliably resolve — notably
> plpgsql dynamic SQL via the `EXECUTE` statement — is marked `hasDynamicSql: true` and yields NO
> speculative edges. Full-fidelity plpgsql parsing is explicitly DEFERRED and NOT committed to any later
> phase — it is recorded here as a known limitation.
>
> **Catalog-supplied dependency hints are NOT used in Phase-8a.** `PG_CAPABILITIES.supportsDependencyHints`
> is `false`: there is NO `pg_depend` OID-graph edge list to refine — the body tokenizer is the SOLE edge
> source (exactly as MSSQL behaves when its dep view is absent). `pg_depend`/`pg_rewrite` OID-graph
> mapping is recorded as a future enhancement and is NOT a Phase-8a obligation.

## Requirements

### Requirement: Extract schemas as the extraction namespace

The pg adapter SHALL extract user schemas from `pg_namespace` (US-028). By DEFAULT it MUST extract ALL
non-system schemas (`nspname NOT IN ('pg_catalog', 'information_schema')` and not the internal `pg_toast`/
`pg_temp_*` namespaces); when the config supplies `schema`, extraction MUST be scoped to that single
schema and objects in other schemas MUST be absent. Every extracted object MUST carry its owning schema
so the qualified name is unambiguous downstream.

#### Scenario: All non-system schemas are extracted by default

- GIVEN a PostgreSQL database with two user schemas and the system schemas `pg_catalog`/`information_schema`
- WHEN `extract(scope)` runs with no `schema` configured
- THEN the `RawCatalog` contains objects from both user schemas
- AND no object from `pg_catalog` or `information_schema` appears
- AND each object carries its owning schema name

#### Scenario: Configured schema scopes the extraction to one schema

- GIVEN a database with user schemas `app` and `reporting`
- WHEN `extract(scope)` runs with `schema: 'app'`
- THEN the `RawCatalog` contains only objects in `app`
- AND no object from `reporting` appears

### Requirement: Extract tables and columns including types, nullability, defaults, identity and generated columns

The pg adapter SHALL extract every user table and its columns from `pg_class`/`pg_attribute` (joined to
`pg_attrdef` for defaults and the type catalog for declared types), capturing for each column its name,
declared PostgreSQL type, nullability, default expression where present, whether it is an IDENTITY column
(`GENERATED ... AS IDENTITY`) and whether it is a GENERATED column (`GENERATED ALWAYS AS (...) STORED`)
(US-028). An identity column MUST be represented as identity and a generated column MUST be represented
as generated (their nature MUST NOT be dropped or rendered as a plain column). System, internal and
toast objects MUST be excluded.

#### Scenario: Tables and columns are extracted with type, nullability and default

- GIVEN a PostgreSQL database with user tables containing typed, nullable and defaulted columns
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains each user table with its columns
- AND each column carries name, declared PostgreSQL type, nullability and any default expression
- AND system/internal/toast objects are absent from the catalog

#### Scenario: Identity column is represented as identity

- GIVEN a table with a column declared `GENERATED ALWAYS AS IDENTITY`
- WHEN `extract(scope)` runs
- THEN the column is present and represented as an IDENTITY column (its identity nature is not lost)

#### Scenario: Generated column is represented as generated

- GIVEN a table with a stored generated column (e.g. `total numeric GENERATED ALWAYS AS (qty * price) STORED`)
- WHEN `extract(scope)` runs
- THEN the column is present and represented as a GENERATED column (its generated nature and expression are not lost)

### Requirement: Extract PK, FK (including composite), unique and CHECK constraints

The pg adapter SHALL extract primary keys, foreign keys, unique constraints and CHECK constraints from
`pg_constraint` (US-028). COMPOSITE constraints (a single PK/FK/unique spanning multiple columns) MUST be
represented as ONE constraint with its ordered column membership preserved (grouped, not split into
separate single-column constraints). A foreign key MUST preserve its ordered local→referenced column
mapping. A CHECK constraint MUST carry its predicate expression.

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

#### Scenario: Composite primary, unique and CHECK constraints are extracted

- GIVEN a table with a composite primary key, a multi-column unique constraint and a CHECK constraint
- WHEN `extract(scope)` runs
- THEN each is present as ONE constraint with its ordered column membership preserved
- AND the CHECK constraint carries its predicate expression

### Requirement: Extract indexes including partial, expression and included columns

The pg adapter SHALL extract indexes from `pg_index` (US-028), capturing for each index whether it is
UNIQUE, whether it is PARTIAL (its `WHERE` predicate), whether it is an EXPRESSION index (a key over an
expression rather than a bare column), and its INCLUDED (non-key) columns where present (PG11+ `INCLUDE`).
The partial predicate, the expression keys and the included columns MUST be represented honestly (not
dropped or conflated with plain key columns). Indexes auto-created to back PK/unique constraints MUST be
attributed consistently (not double-counted as a free-standing index AND a constraint inconsistently).

#### Scenario: Partial index keeps its WHERE predicate

- GIVEN an index defined with a `WHERE` clause (partial index)
- WHEN `extract(scope)` runs
- THEN the index is present and its filter predicate is represented (not dropped)

#### Scenario: Expression index is represented honestly

- GIVEN an index whose key is an expression (e.g. `lower(email)`)
- WHEN `extract(scope)` runs
- THEN the index is present and its expression key is represented (not silently dropped or treated as a bare column)

#### Scenario: Included (non-key) columns are distinguished from key columns

- GIVEN a PG11+ index with key columns and `INCLUDE`d non-key columns
- WHEN `extract(scope)` runs
- THEN the index is present
- AND its included columns are represented and distinguished from its key columns

### Requirement: Extract views and materialized views with bodies per level

The pg adapter SHALL extract views and materialized views, taking their definition bodies from
`pg_get_viewdef` (US-028). Bodies MUST be governed by the resolved indexing level (schema-extraction): at
`full` the body is included; at `metadata` the object is present WITHOUT its body; an object type
configured `off` MUST be absent from the catalog. A materialized view MUST be emitted as a `RawObject`
with `kind: 'view'` carrying `extra.materialized: true` (US-028b) — NO new `NodeKind` is introduced.

#### Scenario: View is extracted with its definition body at full

- GIVEN a view and an `ExtractionScope` resolving views to `full`
- WHEN `extract(scope)` runs
- THEN the view is present with its definition body from `pg_get_viewdef`

#### Scenario: Materialized view is emitted as a view flagged materialized

- GIVEN a materialized view in the source database
- WHEN `extract(scope)` runs at `full`
- THEN the materialized view is present as a `RawObject` with `kind: 'view'`
- AND it carries `extra.materialized: true`
- AND NO new `NodeKind` is introduced for it (the core model is unchanged)

#### Scenario: Metadata level omits the view body, off level omits the object

- GIVEN a view resolved to `metadata` and a materialized view resolved to `off`
- WHEN `extract(scope)` runs
- THEN the `metadata` view is present WITHOUT its body
- AND no materialized view appears in the catalog

### Requirement: Extract functions and procedures with bodies per level

The pg adapter SHALL extract functions and PG11+ procedures from `pg_proc`, taking their definition
bodies from `pg_get_functiondef` (US-028). Functions and procedures MUST both be extracted and
distinguishable from each other. Bodies MUST be governed by the resolved indexing level: at `full` the
body is included; at `metadata` the object is present WITHOUT its body; a type configured `off` MUST be
absent. The adapter MUST NOT emit a procedure object on a server predating PG11 (where `CREATE PROCEDURE`
does not exist), consistent with its capability matrix.

#### Scenario: Function and procedure are extracted and distinguishable

- GIVEN a PG11+ database containing a function and a stored procedure
- WHEN `extract(scope)` runs
- THEN both are present in the `RawCatalog`
- AND the function and the procedure are distinguishable from each other

#### Scenario: Metadata level omits the function body, off level omits the object

- GIVEN a function resolved to `metadata` and a procedure type resolved to `off`
- WHEN `extract(scope)` runs
- THEN the `metadata` function is present WITHOUT its body
- AND no procedure appears in the catalog

### Requirement: Extract triggers with event and timing via EXECUTE FUNCTION

The pg adapter SHALL extract triggers from `pg_trigger` (US-028), capturing for each trigger its firing
EVENT (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`) and its TIMING (`BEFORE`/`AFTER`/`INSTEAD OF`), as declared
by `CREATE TRIGGER ... {BEFORE|AFTER} {event} ... EXECUTE FUNCTION fn()`. Each trigger MUST carry its
firing event AND its timing so `graph-model`'s `fires_on` edge (with `event`) can be derived downstream.
The `fires_on` destination MUST be the PARENT TABLE the trigger is defined on, NOT the trigger's own
identity nor the executed function. Internal/system triggers (e.g. constraint-backing triggers) MUST be
excluded.

#### Scenario: Trigger carries its firing event and timing

- GIVEN an `AFTER UPDATE` trigger on a table that calls a trigger function via `EXECUTE FUNCTION`
- WHEN `extract(scope)` runs
- THEN the trigger is present
- AND it carries its firing event (`UPDATE`) and its timing (`AFTER`)

#### Scenario: Trigger fires_on resolves to the parent table, not the function

- GIVEN an `AFTER UPDATE` trigger on table `T` defined `... EXECUTE FUNCTION audit_fn()`
- WHEN `extract(scope)` runs at `full`
- THEN a `fires_on` relationship from the trigger to `T` is derivable with `event = UPDATE` and timing `AFTER`
- AND `T` is the PARENT TABLE (not the trigger itself and not the executed function `audit_fn`; no phantom stub node appears)

### Requirement: Extract sequences

The pg adapter SHALL extract user-defined sequences from `pg_sequence` /
`information_schema.sequences` (US-028). Each sequence MUST be present in the `RawCatalog` as a sequence
object consistent with the adapter's `CapabilityMatrix` declaring sequences supported. Internal sequences
implicitly owned by identity/serial columns are extracted consistently with the matrix and not
double-counted against their owning column.

#### Scenario: Sequence is extracted

- GIVEN a PostgreSQL database containing a user-defined sequence
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains that sequence as a sequence object

### Requirement: Surface obj_description and col_description comments

The pg adapter SHALL read object comments via `obj_description` and column comments via `col_description`
(backed by `pg_description`) (US-028) and surface them as the comment/description of the object or column
they annotate. The comment MUST be attached to the correct target (table, column, view, function,
sequence, etc.); an object without a comment MUST simply carry no comment (absence is not an error).

#### Scenario: obj_description and col_description are surfaced as comments

- GIVEN a table and a column each annotated with a `COMMENT ON`
- WHEN `extract(scope)` runs
- THEN the table carries its `obj_description` text as its comment
- AND the column carries its `col_description` text as its comment
- AND an object with no comment carries no comment

### Requirement: Truthful PostgreSQL CapabilityMatrix

The pg adapter's `CapabilityMatrix` (`PG_CAPABILITIES`) SHALL truthfully report that PostgreSQL supports
schemas, tables, columns, constraints, indexes, views, procedures, functions, triggers and sequences
(US-028; E5 common criterion), with `supportsBodies: true` and `supportsDependencyHints: false`. The
matrix MUST itself declare these supported types (supported types are explicitly declared supported, not
merely emitted). The adapter MUST NOT emit any object of a type its matrix declares unsupported, and 100%
of the matrix MUST be exercised by the torture fixture. The matrix MUST report
`supportsDependencyHints: false` because Phase-8a derives edges from bodies ONLY (no `pg_depend`).

#### Scenario: Matrix declares the supported object types

- GIVEN the pg adapter's `CapabilityMatrix` (`PG_CAPABILITIES`)
- WHEN the supported types are queried
- THEN schema, table, column, constraint, index, view, procedure, function, trigger and sequence are each reported as SUPPORTED

#### Scenario: Matrix reports supportsBodies true and supportsDependencyHints false

- GIVEN `PG_CAPABILITIES`
- WHEN `supportsBodies` and `supportsDependencyHints` are read
- THEN `supportsBodies` is `true` (bodies come from `pg_get_functiondef`/`pg_get_viewdef`)
- AND `supportsDependencyHints` is `false` (no `pg_depend` edge list in Phase-8a; body tokenizer is the sole edge source)

### Requirement: Parsed reads_from and writes_to from function, procedure and view bodies

The pg adapter SHALL classify dependency edges with `confidence: 'parsed'` (US-007, US-028) by running
the SHARED CONSERVATIVE tokenizer (`engines/_shared/tokenizer-core.ts`) over the bodies returned by
`pg_get_functiondef` / `pg_get_viewdef`. A target written by `INSERT`/`UPDATE`/`DELETE`/`MERGE` MUST
produce a `writes_to` edge from the module to that object; an object only read (e.g. `SELECT FROM`) MUST
produce a `reads_from` edge from the module to that object. Both edge kinds MUST carry `confidence: parsed`
(no `score`, per `graph-model`). The classification MUST be conservative: ambiguous direction MUST NOT be
guessed as a write or a read — it MUST instead fall under the dynamic-SQL blindness rule below. Because
`supportsDependencyHints: false`, the tokenizer is the SOLE edge source; there is NO catalog-supplied edge
list to refine.

#### Scenario: Function writing one object and reading another yields directed parsed edges

- GIVEN a plpgsql function whose body does `INSERT INTO a` and `SELECT FROM b`
- WHEN `extract(scope)` runs at `full`
- THEN a `writes_to` edge from the function to `a` exists with `confidence: parsed`
- AND a `reads_from` edge from the function to `b` exists with `confidence: parsed`

#### Scenario: View reading its base tables yields parsed reads_from edges

- GIVEN a view whose `pg_get_viewdef` body selects from tables `b` and `c`
- WHEN `extract(scope)` runs at `full`
- THEN a `reads_from` edge from the view to `b` exists with `confidence: parsed`
- AND a `reads_from` edge from the view to `c` exists with `confidence: parsed`

#### Scenario: Procedure writing two objects and reading a third

- GIVEN a PG11+ procedure whose body writes to objects `X` and `Y` (e.g. `INSERT`/`UPDATE`/`DELETE`) and reads object `Z`
- WHEN `extract(scope)` runs at `full`
- THEN `writes_to` edges from the procedure to `X` and to `Y` exist with `confidence: parsed`
- AND a `reads_from` edge from the procedure to `Z` exists with `confidence: parsed`

### Requirement: Trigger fires_on plus its function body effects

The pg adapter SHALL emit, for each trigger at `full`, the data it derives so that a `fires_on` edge
(carrying its `event`, per `graph-model`) is derivable to the PARENT TABLE, AND it SHALL classify the
read/write effects of the trigger's executed FUNCTION body as `reads_from`/`writes_to` with
`confidence: parsed` (US-007). An `AFTER UPDATE` trigger on a table `T` whose `EXECUTE FUNCTION` target
writes an audit table `A` MUST yield a `fires_on` relationship from the trigger to `T` with
`event = UPDATE` (and `timing = AFTER` captured per the trigger-extraction requirement) AND the body
effects of `A` derived from the trigger function via the body tokenizer.

#### Scenario: AFTER UPDATE trigger fires on its table and its function writes the audit target

- GIVEN an `AFTER UPDATE` trigger on table `T` whose `EXECUTE FUNCTION` target body writes to audit table `A`
- WHEN `extract(scope)` runs at `full`
- THEN a `fires_on` relationship from the trigger to `T` is derivable with `event = UPDATE` and timing `AFTER`
- AND `T` is the PARENT TABLE (not the trigger itself; no phantom stub node named after the trigger appears)
- AND a `writes_to` edge to `A` is derived from the trigger function body with `confidence: parsed`

### Requirement: Dynamic SQL is flagged via plpgsql EXECUTE, never guessed; trigger EXECUTE FUNCTION is NOT dynamic

Where a body cannot be reliably analyzed by the shared conservative tokenizer — notably plpgsql dynamic
SQL run via the `EXECUTE` STATEMENT — the pg adapter MUST mark the module `hasDynamicSql: true` (US-007)
and MUST NOT fabricate any `reads_from`/`writes_to`/`depends_on` edge for the unanalyzable portion. The
tokenizer's dynamic-SQL detection MUST match the plpgsql `EXECUTE` statement form ONLY; the `EXECUTE
FUNCTION` clause of a `CREATE TRIGGER` DDL MUST NOT be flagged as dynamic SQL (it names a static
function, not a dynamic statement). This distinction MUST be pinned by the torture golden. This is the
honest Phase-8a boundary: full-fidelity plpgsql parsing is DEFERRED and not committed to any later phase.

#### Scenario: plpgsql dynamic EXECUTE statement is flagged with no invented edges

- GIVEN a plpgsql function whose body builds and runs dynamic SQL via the `EXECUTE` statement
- WHEN `extract(scope)` runs at `full`
- THEN the function's `RawObject` is marked `hasDynamicSql: true`
- AND NO speculative `reads_from`/`writes_to`/`depends_on` edge is fabricated for the dynamic portion

#### Scenario: Trigger EXECUTE FUNCTION clause is NOT flagged as dynamic SQL

- GIVEN a trigger whose DDL is `CREATE TRIGGER ... AFTER UPDATE ... EXECUTE FUNCTION audit_fn()` and a plain (non-dynamic) `audit_fn`
- WHEN `extract(scope)` runs at `full`
- THEN the trigger and `audit_fn` are NOT marked `hasDynamicSql: true` on account of the `EXECUTE FUNCTION` clause
- AND a `fires_on` edge to the parent table and the static body edges of `audit_fn` are derived normally

#### Scenario: Full-fidelity parsing is an acknowledged limitation, not a hidden gap

- GIVEN the Phase-8a conservative tokenizer
- WHEN a body cannot be resolved to definite read/write targets
- THEN the module is marked `hasDynamicSql: true` rather than guessed
- AND full plpgsql grammar parsing is recorded as DEFERRED (not committed to any later phase)

### Requirement: fingerprint via one cheap catalog query

The pg adapter's `fingerprint()` SHALL run exactly ONE cheap catalog query that derives a drift
fingerprint from a catalog change marker plus an object COUNT over the in-scope schemas (US-009; E5 common
criterion). It MUST NOT enumerate every object. The fingerprint MUST change when the schema (DDL) changes
and MUST remain stable across data-only changes (inserts/updates/deletes that do not alter the schema).
The marker combines `MAX(pg_class.oid)`, `MAX(pg_attribute.attnum)`, and counts of relations/attributes
across non-system schemas; the adapter hashes all four components with SHA-256.

#### Scenario: fingerprint changes on DDL change

- GIVEN a connected pg adapter with a computed fingerprint
- WHEN a DDL statement alters the schema (e.g. adding a column or object)
- THEN a subsequent `fingerprint()` returns a different value

#### Scenario: fingerprint is stable across data-only changes

- GIVEN a connected pg adapter with a computed fingerprint
- WHEN only data changes (rows inserted/updated/deleted, no DDL)
- THEN a subsequent `fingerprint()` returns the same value

#### Scenario: fingerprint uses one cheap query and does not walk objects

- GIVEN a connected pg adapter
- WHEN `fingerprint()` is called
- THEN it issues exactly ONE cheap catalog query combining a change marker and an object COUNT
- AND it does NOT enumerate every object to compute the value

### Requirement: Read-only by construction — catalog SELECTs only

The pg adapter SHALL issue catalog read queries (`SELECT` over `pg_catalog.*` / `information_schema`)
ONLY and MUST NOT issue any write statement through its connection (US-031). The adapter MUST NOT issue
`SET SESSION ... READ ONLY` or any session-flag workaround in place of the minimal-privilege role; the
read-only posture is enforced by the role below plus the existing engines write-verb scanner. This
adapter's SQL falls under the existing engines write-verb scanner (sqlite-extraction) which scans
`src/adapters/engines/**` and fails on write verbs; the pg adapter MUST NOT introduce SQL that fails that
scan.

#### Scenario: Adapter issues only catalog SELECTs

- GIVEN the pg adapter connected to a source database
- WHEN it extracts or fingerprints
- THEN every statement it issues is a catalog `SELECT` over `pg_catalog.*` / `information_schema`
- AND no `INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL statement is issued
- AND no `SET SESSION ... READ ONLY` statement is issued

#### Scenario: pg SQL passes the engines write-verb scanner

- GIVEN the pg adapter source under `src/adapters/engines/pg/**`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write verb in the adapter's SQL
- AND the scan passes (write verbs appearing only in comments or string literals do not false-positive)

### Requirement: Minimal read-only role documented

The repository SHALL ship `docs/permissions/pg.md` containing a MINIMAL read-only role/login script that
grants only what catalog metadata extraction needs — `CONNECT` on the database, `USAGE` on the target
schema(s), and the `SELECT` on catalogs required to read object definitions — and MUST NOT require broad
data-read grants beyond catalog access (US-033). This role MUST be sufficient to extract the full torture
schema (catalog metadata only), proving no table-data permission is needed for metadata extraction.

#### Scenario: Permission doc ships the minimal read-only role script

- GIVEN the repository
- WHEN `docs/permissions/pg.md` is inspected
- THEN it contains a role/login script granting only `CONNECT`, `USAGE` on the schema(s) and catalog `SELECT`
- AND it does NOT require broad table-data read grants for metadata extraction

#### Scenario: A minimal read-only role extracts the full torture schema

- GIVEN a PostgreSQL role holding only the minimal grants from `docs/permissions/pg.md`
- WHEN the adapter extracts the torture schema
- THEN the full catalog is extracted successfully
- AND no table-data access permission was required

### Requirement: Missing privilege raises an actionable PermissionError

When the connected role lacks a catalog privilege required at runtime, the pg adapter SHALL reject with
the existing typed `PermissionError` (schema-extraction; reused, not redefined). The error MUST be mapped
from the `pg` privilege `SQLSTATE` (`42501` insufficient privilege). The message MUST be actionable: it
MUST name the missing privilege, SHOULD name the object that required it, and MUST point to
`docs/permissions/pg.md` (US-033). The adapter MUST NOT degrade to a partial/silent catalog when the
permission is missing.

#### Scenario: Missing catalog privilege yields a typed, actionable PermissionError

- GIVEN a role WITHOUT a catalog privilege required to read definitions (driver returns `SQLSTATE 42501`)
- WHEN `extract(scope)` attempts to read the catalog
- THEN it SHALL reject with the typed `PermissionError`
- AND the message names the missing privilege and links to `docs/permissions/pg.md`
- AND the adapter does NOT return a partial or silent catalog

### Requirement: Connectivity via host/port/database/user/password with optional ssl

The pg adapter SHALL connect via the `pg` driver using host, port (default `5432`), database, user and
password, with optional `ssl` (US-028). The `password` MUST be supplied by reference as `${env:VAR}`
(env-only, never a literal in config — US-032 alignment). There is NO integrated-security or external-tool
machinery (that was SQL-Server-specific). The optional `schema?` field scopes extraction per the schemas
requirement above. When the database is unreachable or authentication fails (driver returns auth
`SQLSTATE 28P01`), the adapter MUST reject with the existing typed `ConnectionError` carrying an actionable
message — it MUST NOT surface an opaque driver error.

#### Scenario: Connects with explicit credentials and default port

- GIVEN a pg config with host, database, user and a `${env:VAR}` password and no explicit port
- WHEN `connect()` is called
- THEN it connects to port `5432` by default and establishes a usable connection for `extract`/`fingerprint`

#### Scenario: Password must be supplied by env reference, not a literal

- GIVEN a pg config whose `password` is a literal string rather than `${env:VAR}`
- WHEN the config is parsed
- THEN it is rejected (the password must be an `${env:VAR}` reference, env-only)

#### Scenario: Authentication failure raises an actionable ConnectionError

- GIVEN a pg config with invalid credentials (driver returns `SQLSTATE 28P01`)
- WHEN `connect()` is called
- THEN it SHALL reject with the typed `ConnectionError`
- AND the message is actionable and does NOT surface an opaque driver error

### Requirement: Missing pg driver names the install command

Because `pg` is an optional dependency loaded via a dynamic `import()` (ADR-006), when the package is
absent the adapter factory (`createPgSchemaAdapter`) SHALL fail with an error whose message contains the
exact install command (`npm i pg`), per the schema-extraction port contract and the E5 common criterion.

#### Scenario: Absent pg driver names npm i pg

- GIVEN the `pg` package is not installed
- WHEN the adapter attempts to load it via dynamic import
- THEN the raised error message MUST contain the exact `npm i pg` command

### Requirement: Committed PostgreSQL torture fixture materialized via Testcontainers

The repository SHALL provide a committed PostgreSQL torture schema (a plain-text `.sql` script under
`test/fixtures/pg/`) that exercises 100% of the PostgreSQL capability matrix and, at minimum: a
materialized view, a partial (and/or expression) index, a generated column, a plpgsql function that
writes two tables and reads a third, a plpgsql function using a dynamic `EXECUTE` statement, an
`AFTER UPDATE` trigger whose `EXECUTE FUNCTION` target writes an audit table, a sequence, and `COMMENT ON`
annotations (US-028). The integration setup MUST materialize this script into an ephemeral `postgres:16`
Testcontainers instance; the committed artifact MUST be the reviewable `.sql` script (no binary database
blob). The integration job MUST NOT require Docker for the unit matrix and MUST skip-with-reason where
Docker is unavailable rather than fail.

Integration tests are gated by `DBGRAPH_INTEGRATION=1` (NOT mere Docker presence), ensuring the unit
matrix never accidentally runs containers.

#### Scenario: Fixture is a reviewable .sql script

- GIVEN the pg torture fixture in the repository
- WHEN the committed artifact is inspected
- THEN it is a plain-text `.sql` script (not a binary database file)
- AND it is human-reviewable in a pull request

#### Scenario: Fixture exercises the required torture objects

- GIVEN the materialized torture database
- WHEN the adapter extracts it
- THEN the catalog covers a materialized view, a partial/expression index, a generated column, a function writing two tables and reading a third, a dynamic-`EXECUTE` function, an `AFTER UPDATE` trigger whose `EXECUTE FUNCTION` target writes an audit table, a sequence and `COMMENT ON` annotations
- AND 100% of the PostgreSQL capability matrix is exercised

#### Scenario: Integration setup uses an ephemeral container and skips without DBGRAPH_INTEGRATION

- GIVEN the pg integration test
- WHEN `DBGRAPH_INTEGRATION=1` is set and Docker is available
- THEN setup materializes the `.sql` into an ephemeral `postgres:16` Testcontainers instance
- AND WHEN `DBGRAPH_INTEGRATION` is not set the integration test is skipped with an explicit reason (the unit matrix never runs integration tests)

### Requirement: Golden-pinned RawCatalog and end-to-end pipeline

There SHALL be a deterministic golden test pinning the `RawCatalog` extracted from the torture schema:
the catalog MUST be serialized via the existing `stableStringify` and MUST be byte-identical across runs
(ADR-008). There SHALL ALSO be an end-to-end test driving the full pipeline — torture `.sql` →
materialize → adapter `extract` → `normalizeCatalog` → `SqliteGraphStore` upsert → query (`impact`,
`path`) — whose outputs are golden-pinned and byte-identical on re-run (US-028). The pg CI job MUST be
gated (`pg-integration`, `DBGRAPH_INTEGRATION=1`), MUST NOT block the unit matrix, and MUST NOT touch any
validation database.

Edge endpoint assertions MUST pin both source and destination qnames (L-009). Asserting only that an edge
exists (without its endpoints) is insufficient — a wrong-destination edge passes existence-only assertions
silently. The verified golden encodes: `edgeCount: 47`, `stubCount: 0` (post-remediation R1, commit
`8433352`).

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

#### Scenario: pg CI job is gated and never touches a validation database

- GIVEN the `pg-integration` job in CI
- WHEN the unit matrix runs
- THEN it does NOT depend on the gated `pg-integration` job
- AND the `pg-integration` job uses only an ephemeral `postgres:16` container and never connects to any validation database

### Requirement: Body-parsed calls edges for routine invocations

The pg adapter SHALL extend the shared tokenizer's candidate list to include ROUTINE names (functions
and PG11+ procedures) so a routine-invocation reference in a `pg_get_functiondef` body (`SELECT fn()`
/ `PERFORM fn()` / `CALL proc()`) that resolves to a REAL routine node produces a `calls` edge from
the calling routine to the referenced routine with `confidence: 'parsed'`. Emission MUST stay
PRESENCE-GATED over the dynamic-string-MASKED static body (`maskDynamicStrings` + `bodyContainsRef`):
a name appearing only in a comment, a string literal, or a dynamic `EXECUTE` string MUST NOT produce
an edge. A reference to a BUILTIN (e.g. `now()`, `count()`) that resolves to no routine node MUST
produce NO edge. The adapter MUST NEVER emit a SELF-reference `calls` edge unless the routine is
genuinely recursive. Extending the candidate list MUST NOT reclassify existing table dependencies —
routines only ADD candidates.

#### Scenario: function invoking a function yields exactly one parsed calls edge

- GIVEN the torture function `app.fn_wrapper` whose body does `SELECT app.fn_inner()`, and the function `app.fn_inner` whose body does `SELECT ... FROM app.orders`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `app.fn_wrapper` emits EXACTLY one `calls app.fn_inner` edge with `confidence: 'parsed'` and NO `reads_from`/`writes_to` edge to `app.fn_inner`
- AND `app.fn_inner` emits `{ reads_from app.orders (parsed) }` and ZERO `calls` edge

#### Scenario: builtin invocation and body-absent routines emit no calls edge (negative)

- GIVEN a routine whose static body invokes only builtins (`now()`, `count()`) and names no user routine
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN ZERO `calls` edge is emitted (no builtin resolves to a routine node)
- AND no `calls` edge is fabricated for any routine whose name does not appear in the masked static body

#### Scenario: routine name only inside a dynamic EXECUTE string yields no calls edge (negative)

- GIVEN a plpgsql routine that builds `'SELECT app.fn_inner()'` and runs it via the dynamic `EXECUTE` statement
- WHEN `extract(scope)` runs at `full`
- THEN the routine is marked `hasDynamicSql: true` and emits NO `calls` edge to `app.fn_inner` (the name is inside the masked dynamic string)

### Requirement: pg torture fixture exercises routine-calls-routine

The committed pg torture `.sql` (`test/fixtures/pg/`) SHALL add `app.fn_wrapper` (invoking
`app.fn_inner`) and `app.fn_inner`, using NEUTRAL names. The golden-pinned `RawCatalog` and
end-to-end impact/path goldens MUST be re-blessed DELIBERATELY to include the `calls app.fn_wrapper →
app.fn_inner` edge (`confidence: 'parsed'`), with L-009 exact-set assertions pinning both endpoints,
`stubCount: 0`, and no self-reference edge.

#### Scenario: fixture adds the routine-calls-routine objects and re-blessed golden pins the parsed calls edge

- GIVEN the materialized pg torture database with `app.fn_wrapper` and `app.fn_inner`
- WHEN the adapter extracts it and the pipeline runs extract → normalize → upsert → query
- THEN the re-blessed goldens contain EXACTLY the edge `app.fn_wrapper → app.fn_inner` of kind `calls`, `confidence: 'parsed'`, with exact endpoints and `stubCount: 0`, byte-identical on re-run (ADR-008)

### Requirement: Decode routine parameters from pg_proc arrays

The pg adapter SHALL extend `SQL_PG_ROUTINES` with `proargnames`, `proargmodes` and `proallargtypes`
(argument type names decoded via `regtype` in SQL — see design §4.2) and decode them into
`RawObject.parameters`. For each argument it MUST capture `name` (from `proargnames` by array position;
NULL when unnamed), `dataType` (the canonical type name as PostgreSQL exposes it for FUNCTION ARGUMENTS —
the SAME type vocabulary the adapter's COLUMN `dataType` uses, e.g. `integer`, `numeric`; NOTE PostgreSQL
does NOT store per-argument length/precision typmod, so a `numeric(10,2)` argument HONESTLY surfaces as
`numeric` — the precision a COLUMN would show is PHYSICALLY absent for a function argument and MUST NOT be
fabricated), `direction` from `proargmodes` (`i`→`in`, `o`→`out`, `b`→`inout`, `v` VARIADIC→`in` — a
VARIADIC argument IS an input; `t` TABLE→**EXCLUDED** from `parameters` — `RETURNS TABLE` entries are
RESULT columns, NOT call parameters, mirroring the mysql `ORDINAL_POSITION = 0` return-row exclusion; they
belong to the deferred TVF-column-set work), and `ordinal` from array position (contiguous 1..N over the
EMITTED arguments, after excluding any `t`-mode entry). When `proargmodes` is NULL, ALL arguments are `in`
(the PostgreSQL encoding for an all-IN routine — the adapter MUST NOT emit `out`/`inout` unless the mode
array PROVES it). `hasDefault` MAY be set for the trailing `pronargdefaults` arguments ONLY; where it
cannot be cleanly attributed it MUST be OMITTED, never fabricated. A routine with no arguments MUST carry
an empty parameters array.

#### Scenario: zero-parameter routines pinned exactly (fn_wrapper/fn_inner)

- GIVEN the torture functions `app.fn_wrapper()` and `app.fn_inner()` (no arguments)
- WHEN `extract(scope)` runs
- THEN each carries `parameters: []` (a real empty signature) — NOT unset
- AND no direction or `hasDefault` is fabricated for either

#### Scenario: NULL proargmodes yields all-IN (fn_place_order)

- GIVEN `app.fn_place_order(p_order_id int, p_customer_id int, p_product_id int, p_qty int)` with `proargmodes = NULL`
- WHEN `extract(scope)` runs
- THEN its `parameters` are EXACTLY four entries at ordinals 1..4, each `direction:"in"` and `dataType:"integer"`, names `p_order_id` / `p_customer_id` / `p_product_id` / `p_qty` in order
- AND NO parameter is emitted as `out` or `inout`

#### Scenario: VARIADIC is an input; RETURNS TABLE columns are excluded (pinned modes)

- GIVEN a routine with a VARIADIC argument (`proargmodes` element `v`) and, separately, a `RETURNS TABLE`
  routine whose `proargmodes` carries `t` entries
- WHEN `extract(scope)` runs
- THEN the VARIADIC argument is emitted with `direction:"in"` (it is an input)
- AND every `t` (TABLE) entry is EXCLUDED from `parameters` — the result columns are NOT call parameters
  (mirror of the mysql `ORDINAL_POSITION = 0` return-row exclusion)
- AND note: no current DOG-1 pg fixture exercises `v` or `t`; unit-fixture coverage for both modes is
  added at apply so the goldens pin these bytes

#### Scenario: pg parameter dataType carries no fabricated precision (typmod-less args)

- GIVEN a pg routine argument declared with a precision type (e.g. `numeric(10,2)`)
- WHEN `extract(scope)` runs
- THEN its `dataType` is the canonical type name `numeric` — NOT `numeric(10,2)` — because PostgreSQL
  stores no per-argument typmod; the precision is honestly absent, never invented

#### Scenario: pg goldens gain parameters deliberately, scanner stays green

- GIVEN the pg raw-catalog and e2e goldens
- WHEN parameters are added
- THEN the pg goldens are re-blessed DELIBERATELY to carry the pinned arrays; every unrelated byte is unchanged
- AND `SQL_PG_ROUTINES` still passes the engines write-verb scanner (catalog `SELECT` only)
