# MySQL Extraction Specification

## Purpose

The concrete MySQL `MysqlSchemaAdapter`: which catalog objects it extracts from `information_schema.*`
(the connected database AS the single schema; tables, columns with types/nullability/defaults and the
`AUTO_INCREMENT` flag surfaced ON THE COLUMN via `COLUMNS.EXTRA` — NOT a sequence; PK/FK/unique/CHECK
constraints, CHECK via `CHECK_CONSTRAINTS` on MySQL 8.0.16+; indexes from `STATISTICS` including
composite ordering and uniqueness; views with bodies from `VIEWS.VIEW_DEFINITION`; functions and
procedures with bodies from `ROUTINES.ROUTINE_DEFINITION`; triggers with event + timing; and
`TABLE_COMMENT`/`COLUMN_COMMENT` comments), its truthful `CapabilityMatrix` `MYSQL_CAPABILITIES`
(tables, columns, constraints, indexes, views, procedures, functions and triggers SUPPORTED;
NO `sequence`; NO standalone `schema` kind; `supportsBodies: true`; `supportsDependencyHints: false`),
its `confidence: 'parsed'` `reads_from`/`writes_to` classification from view/routine bodies via the
SHARED conservative tokenizer (`engines/_shared/tokenizer-core.ts`) with PHANTOM-FREE presence-gated
edge emission and honest `hasDynamicSql` blindness on MySQL `PREPARE`/`EXECUTE`, its `fingerprint()`
over a DDL-sensitive catalog change marker (moves on `ADD COLUMN`, stable on DML), its connectivity
(host/port/database/user/password + optional ssl, `password` env-only, NO `schema?` knob), its minimal
read-only user plus actionable `PermissionError` per `docs/permissions/mysql.md`, and the gated
`mysql:8` Testcontainers golden-pinned end-to-end pipeline. Stories: US-029 (MySQL adapter, Phase 8b),
US-028a (shared body-tokenizer module — consumed unchanged), US-007 (extraction half — body parsing
into read/write edges), US-009 (per-engine fingerprint), US-031 (read-only by construction), US-033
(minimal permissions and actionable errors).

This adapter is the FOURTH concrete `SchemaAdapter` (see `schema-extraction`, the engine-agnostic port
it MUST satisfy UNCHANGED) and mirrors the PostgreSQL adapter (see `pg-extraction`) file-for-file. It
lives under `src/adapters/engines/mysql/` per ADR-004 (adapter outside core); the core and the
`SchemaAdapter` port MUST NOT change. It loads its own `mysql2` driver via a LAZY dynamic `import()`
(ADR-006). It consumes the existing `graph-model` (`CapabilityMatrix`, `ExtractionScope`, `RawCatalog`,
edge/confidence vocabulary), `graph-normalization`, `graph-storage` and `graph-query` contracts
UNCHANGED.

> **Honest Phase-8b boundary.** Read/write classification is derived by the SHARED CONSERVATIVE body
> tokenizer (`engines/_shared/tokenizer-core.ts`) over `VIEWS.VIEW_DEFINITION` /
> `ROUTINES.ROUTINE_DEFINITION` text — NOT a full SQL/stored-program grammar parser (ADR-007). Any body
> the tokenizer cannot reliably resolve — notably MySQL dynamic SQL via `PREPARE`/`EXECUTE` — is marked
> `hasDynamicSql: true` and yields NO speculative edges. Full-fidelity stored-program parsing is
> explicitly DEFERRED and NOT committed to any later phase — it is recorded here as a known limitation.
>
> **Catalog-supplied dependency hints are NOT used in Phase-8b.** `MYSQL_CAPABILITIES.supportsDependencyHints`
> is `false`: MySQL exposes NO `information_schema` dependency view (no `pg_depend`/
> `sys.sql_expression_dependencies` equivalent) — the body tokenizer is the SOLE edge source. There is
> no catalog edge list to refine, now or later.
>
> **`VIEW_DEFINITION` is a REPARSED body.** MySQL stores view definitions in normalized/reparsed form
> (the server's canonical rewrite of the original SQL), and `information_schema` columns can be
> length-bounded so a very large body MAY be TRUNCATED. The tokenizer is presence-gated, so a normalized
> body still resolves the real referenced object names; the golden pins the actual `mysql:8` output. This
> caveat is HONEST behaviour, not a defect. `SHOW CREATE VIEW` is NOT used (it is not a plain catalog
> `SELECT` and would break the engines write-verb scanner).
>
> **MySQL has NO schema-vs-database distinction.** The connected database IS the extraction namespace
> (`schema == database`). Every catalog query is filtered `TABLE_SCHEMA = DATABASE()`; every emitted
> object carries the connected database as its `schema`; `RawCatalog.schemas` is exactly that one
> database. There is NO `schema?` config knob (the database is the scope). MariaDB-specific behaviour
> (real `SEQUENCE` objects, `EVENT` objects) is OUT of scope and deferred to a future `phase-8c`.

## Requirements

### Requirement: Extract the connected database as the single extraction namespace

The mysql adapter SHALL treat the connected database as its single extraction namespace (`schema ==
database`) (US-029). Every catalog query MUST be filtered `TABLE_SCHEMA = DATABASE()` so only objects in
the connected database are extracted and objects in OTHER databases on the same server MUST be absent.
Every extracted object MUST carry the connected database name as its `schema`, and `RawCatalog.schemas`
MUST be exactly that one database. There is NO `schema?` config knob.

#### Scenario: Only the connected database is extracted

- GIVEN a MySQL server with the connected database `app` and another database `other`
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains only objects whose `TABLE_SCHEMA` is the connected database `app`
- AND no object from `other` appears
- AND each object carries `app` as its schema

#### Scenario: RawCatalog.schemas is the single connected database

- GIVEN a connected mysql adapter on database `app`
- WHEN `extract(scope)` runs
- THEN `RawCatalog.schemas` is exactly `['app']` (the one connected database)
- AND there is no separate standalone schema object beyond the database itself

### Requirement: Extract tables and columns including types, nullability, defaults and AUTO_INCREMENT

The mysql adapter SHALL extract every base table and its columns from `information_schema.TABLES` /
`information_schema.COLUMNS` (filtered `TABLE_SCHEMA = DATABASE()`), capturing for each column its name,
declared MySQL type, nullability, default expression where present, and whether the column is
`AUTO_INCREMENT` (US-029). The `AUTO_INCREMENT` nature MUST be surfaced ON THE COLUMN from
`COLUMNS.EXTRA` (which contains the token `auto_increment`) — it MUST NOT be modelled as a sequence
object, and NO sequence object MUST be emitted on its behalf. System schemas (`information_schema`,
`mysql`, `performance_schema`, `sys`) MUST be excluded.

#### Scenario: Tables and columns are extracted with type, nullability and default

- GIVEN a MySQL database with base tables containing typed, nullable and defaulted columns
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains each base table with its columns
- AND each column carries name, declared MySQL type, nullability and any default expression
- AND system-schema objects are absent from the catalog

#### Scenario: AUTO_INCREMENT is represented on the column, never as a sequence

- GIVEN a table with an `id INT AUTO_INCREMENT PRIMARY KEY` column
- WHEN `extract(scope)` runs
- THEN the `id` column is present and carries its `AUTO_INCREMENT` flag (derived from `COLUMNS.EXTRA`)
- AND NO sequence object is emitted for that column
- AND the `RawCatalog` contains ZERO objects of kind `sequence`

### Requirement: Extract PK, FK (including composite), unique and CHECK constraints

The mysql adapter SHALL extract primary keys, foreign keys, unique constraints and CHECK constraints
(US-029). PK/FK/unique membership comes from `information_schema.TABLE_CONSTRAINTS` joined to
`KEY_COLUMN_USAGE` (ordered by `ORDINAL_POSITION`); CHECK constraints come from
`information_schema.CHECK_CONSTRAINTS` (MySQL 8.0.16+). COMPOSITE constraints (a single PK/FK/unique
spanning multiple columns) MUST be represented as ONE constraint with its ordered column membership
preserved (grouped, not split into separate single-column constraints). A foreign key MUST preserve its
ordered local→referenced column mapping (from `KEY_COLUMN_USAGE.REFERENCED_*`). A CHECK constraint MUST
carry its predicate expression (`CHECK_CONSTRAINTS.CHECK_CLAUSE`).

#### Scenario: Single-column primary and foreign keys are extracted

- GIVEN a table with a single-column primary key and a single-column foreign key to another table
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains that primary key and that foreign key
- AND the foreign key carries its local and referenced column

#### Scenario: Composite foreign key keeps its column pairs grouped and ordered

- GIVEN a table with a composite foreign key over two or more columns
- WHEN `extract(scope)` runs
- THEN the foreign key is represented as ONE constraint
- AND its ordered local→referenced column pairs are all preserved (not split into separate single-column FKs)

#### Scenario: Composite primary, unique and CHECK constraints are extracted

- GIVEN a table with a composite primary key, a multi-column unique constraint and a CHECK constraint
- WHEN `extract(scope)` runs
- THEN each is present as ONE constraint with its ordered column membership preserved
- AND the CHECK constraint carries its predicate expression from `CHECK_CONSTRAINTS`

### Requirement: Extract indexes including composite and uniqueness from STATISTICS

The mysql adapter SHALL extract indexes from `information_schema.STATISTICS` (US-029), capturing for each
index whether it is UNIQUE (derived from `NON_UNIQUE = 0`) and its ordered column membership (grouped by
index name, ordered by `SEQ_IN_INDEX`) so that a COMPOSITE index is represented as ONE index with its
columns in order. The uniqueness and the ordered column membership MUST be represented honestly (not
dropped or conflated). Indexes auto-created to back PK/unique constraints MUST be attributed
consistently (not double-counted as a free-standing index AND a constraint inconsistently).

#### Scenario: Composite index keeps its ordered column membership

- GIVEN a composite (multi-column) index
- WHEN `extract(scope)` runs
- THEN the index is present as ONE index
- AND its columns are represented in `SEQ_IN_INDEX` order (not split into per-column indexes)

#### Scenario: Unique versus non-unique index is represented honestly

- GIVEN a unique index and a non-unique index
- WHEN `extract(scope)` runs
- THEN the unique index is represented as UNIQUE (`NON_UNIQUE = 0`)
- AND the non-unique index is represented as non-unique (its uniqueness is not dropped or conflated)

### Requirement: Extract views with bodies per level from VIEW_DEFINITION

The mysql adapter SHALL extract views, taking their definition bodies from
`information_schema.VIEWS.VIEW_DEFINITION` (US-029). Bodies MUST be governed by the resolved indexing
level (schema-extraction): at `full` the body is included; at `metadata` the object is present WITHOUT
its body; a view type configured `off` MUST be absent from the catalog. The adapter MUST NOT use `SHOW
CREATE VIEW` (not a plain catalog `SELECT`). The extracted body is the MySQL-REPARSED (normalized) form
and MAY be TRUNCATED for a very large view; this is honest server behaviour and MUST be documented, not
treated as an error.

#### Scenario: View is extracted with its definition body at full

- GIVEN a view and an `ExtractionScope` resolving views to `full`
- WHEN `extract(scope)` runs
- THEN the view is present with its definition body from `VIEWS.VIEW_DEFINITION`
- AND the body is sourced from `VIEW_DEFINITION` (NOT from `SHOW CREATE VIEW`)

#### Scenario: Reparsed/truncated view body still resolves referenced names

- GIVEN a view whose `VIEW_DEFINITION` is stored in MySQL's reparsed/normalized form
- WHEN `extract(scope)` runs at `full`
- THEN the view is present and the reparsed body is captured as-is (the caveat is documented, not a defect)
- AND the body tokenizer still resolves the real referenced object names from the reparsed body

#### Scenario: Metadata level omits the view body, off level omits the object

- GIVEN one view resolved to `metadata` and the view type otherwise resolved to `off` for a second view set
- WHEN `extract(scope)` runs
- THEN the `metadata` view is present WITHOUT its body
- AND no `off` view appears in the catalog

### Requirement: Extract functions and procedures with bodies per level from ROUTINE_DEFINITION

The mysql adapter SHALL extract stored functions and stored procedures from
`information_schema.ROUTINES` (filtered `ROUTINE_SCHEMA = DATABASE()`), taking their bodies from
`ROUTINES.ROUTINE_DEFINITION` (US-029). Functions and procedures MUST both be extracted and
distinguishable from each other (via `ROUTINE_TYPE`). Bodies MUST be governed by the resolved indexing
level: at `full` the body is included; at `metadata` the object is present WITHOUT its body; a type
configured `off` MUST be absent.

#### Scenario: Function and procedure are extracted and distinguishable

- GIVEN a MySQL database containing a stored function and a stored procedure
- WHEN `extract(scope)` runs
- THEN both are present in the `RawCatalog`
- AND the function and the procedure are distinguishable from each other (by `ROUTINE_TYPE`)

#### Scenario: Metadata level omits the routine body, off level omits the object

- GIVEN a function resolved to `metadata` and a procedure type resolved to `off`
- WHEN `extract(scope)` runs
- THEN the `metadata` function is present WITHOUT its body
- AND no procedure appears in the catalog

### Requirement: Extract triggers with event and timing

The mysql adapter SHALL extract triggers from `information_schema.TRIGGERS` (filtered
`TRIGGER_SCHEMA = DATABASE()`) (US-029), capturing for each trigger its firing EVENT
(`EVENT_MANIPULATION` — `INSERT`/`UPDATE`/`DELETE`) and its TIMING (`ACTION_TIMING` —
`BEFORE`/`AFTER`). Each trigger MUST carry its firing event AND its timing so `graph-model`'s `fires_on`
edge (with `event`) can be derived downstream. The `fires_on` destination MUST be the PARENT TABLE the
trigger is defined on (`EVENT_OBJECT_TABLE`), NOT the trigger's own identity.

#### Scenario: Trigger carries its firing event and timing

- GIVEN an `AFTER INSERT` trigger on a table
- WHEN `extract(scope)` runs
- THEN the trigger is present
- AND it carries its firing event (`INSERT`) and its timing (`AFTER`)

#### Scenario: Trigger fires_on resolves to the parent table, not the trigger

- GIVEN an `AFTER INSERT` trigger on table `T`
- WHEN `extract(scope)` runs at `full`
- THEN a `fires_on` relationship from the trigger to `T` is derivable with `event = INSERT` and timing `AFTER`
- AND `T` is the PARENT TABLE (`EVENT_OBJECT_TABLE`), not the trigger itself (no phantom stub node appears)

### Requirement: Surface TABLE_COMMENT and COLUMN_COMMENT comments

The mysql adapter SHALL read table comments from `information_schema.TABLES.TABLE_COMMENT` and column
comments from `information_schema.COLUMNS.COLUMN_COMMENT` (US-029) and surface them as the
comment/description of the object or column they annotate. The comment MUST be attached to the correct
target (table, column, view, etc.); an object without a comment MUST simply carry no comment (an empty
`TABLE_COMMENT`/`COLUMN_COMMENT` is absence, not an error).

#### Scenario: TABLE_COMMENT and COLUMN_COMMENT are surfaced as comments

- GIVEN a table and a column each declared with a `COMMENT`
- WHEN `extract(scope)` runs
- THEN the table carries its `TABLE_COMMENT` text as its comment
- AND the column carries its `COLUMN_COMMENT` text as its comment
- AND an object with no comment carries no comment (empty comment is absence)

### Requirement: Truthful MySQL CapabilityMatrix

The mysql adapter's `CapabilityMatrix` (`MYSQL_CAPABILITIES`) SHALL truthfully report that MySQL supports
tables, columns, constraints, indexes, views, procedures, functions and triggers (US-029; E5 common
criterion), with `supportsBodies: true` and `supportsDependencyHints: false`. The matrix MUST NOT report
`sequence` as supported (MySQL has no sequence objects — `AUTO_INCREMENT` rides the column), and it MUST
NOT declare a standalone `schema` kind (the connected database IS the namespace, surfaced via
`RawCatalog.schemas`). The matrix MUST itself declare its supported types (supported types are
explicitly declared, not merely emitted). The adapter MUST NOT emit any object of a type its matrix
declares unsupported, and 100% of the matrix MUST be exercised by the torture fixture. The matrix MUST
report `supportsDependencyHints: false` because Phase-8b derives edges from bodies ONLY (no MySQL
dependency view exists).

#### Scenario: Matrix declares the supported object types

- GIVEN the mysql adapter's `CapabilityMatrix` (`MYSQL_CAPABILITIES`)
- WHEN the supported types are queried
- THEN table, column, constraint, index, view, procedure, function and trigger are each reported as SUPPORTED

#### Scenario: Matrix reports no sequence and no standalone schema kind

- GIVEN `MYSQL_CAPABILITIES`
- WHEN its supported set is inspected
- THEN `sequence` is NOT reported as supported (MySQL has no sequence objects)
- AND no standalone `schema` kind is declared (the connected database is the namespace)

#### Scenario: Matrix reports supportsBodies true and supportsDependencyHints false

- GIVEN `MYSQL_CAPABILITIES`
- WHEN `supportsBodies` and `supportsDependencyHints` are read
- THEN `supportsBodies` is `true` (bodies come from `VIEW_DEFINITION`/`ROUTINE_DEFINITION`)
- AND `supportsDependencyHints` is `false` (no MySQL dependency view; body tokenizer is the sole edge source)

### Requirement: Parsed reads_from and writes_to from view and routine bodies, presence-gated with no phantom or self edges

The mysql adapter SHALL classify dependency edges with `confidence: 'parsed'` (US-007, US-029) by running
the SHARED CONSERVATIVE tokenizer (`engines/_shared/tokenizer-core.ts`, reusing `maskDynamicStrings` and
`bodyContainsRef`) over the bodies returned by `VIEW_DEFINITION` / `ROUTINE_DEFINITION`. A target written
by `INSERT`/`UPDATE`/`DELETE`/`REPLACE`/`MERGE` MUST produce a `writes_to` edge from the module to that
object; an object only read (e.g. `SELECT FROM`) MUST produce a `reads_from` edge from the module to that
object. Both edge kinds MUST carry `confidence: parsed` (no `score`, per `graph-model`).

Edge emission MUST be PRESENCE-GATED (carries the Phase-8a CRITICAL-1 remediation): an edge MUST be
emitted ONLY for an object whose canonical name actually APPEARS in the dynamic-string-MASKED STATIC body
(`bodyContainsRef`). The adapter MUST NOT default-to-`reads_from` for every candidate catalog object, and
MUST NEVER emit a SELF-reference edge (a module to itself). Because `supportsDependencyHints: false`, the
tokenizer is the SOLE edge source; there is NO catalog-supplied edge list to refine.

#### Scenario: Routine writing two objects and reading a third yields the EXACT directed parsed edge set

- GIVEN a procedure whose body writes objects `X` and `Y` (e.g. `INSERT`/`UPDATE`/`DELETE`) and reads object `Z`, with NO other table named in its static body
- WHEN `extract(scope)` runs at `full`
- THEN the procedure's outgoing edge set is EXACTLY `{ writes_to X, writes_to Y, reads_from Z }` — three edges, all `confidence: parsed`
- AND there is NO edge to any other catalog object
- AND there is NO self-reference edge from the procedure to itself

#### Scenario: View reading its base tables yields exactly the reads_from edges for those tables

- GIVEN a view whose `VIEW_DEFINITION` body selects from tables `b` and `c` only
- WHEN `extract(scope)` runs at `full`
- THEN the view's outgoing edge set is EXACTLY `{ reads_from b, reads_from c }` — two edges, all `confidence: parsed`
- AND no `reads_from` edge is emitted to any table NOT named in the body
- AND no self-reference edge from the view to itself is emitted

#### Scenario: No edge is defaulted for objects absent from the body (no phantom edges)

- GIVEN a database with many tables and a routine whose static body names only a strict subset of them
- WHEN `extract(scope)` runs at `full`
- THEN edges are emitted ONLY for the objects whose canonical name appears in the masked static body (presence-gated)
- AND the count of outgoing edges equals the number of distinct referenced objects in the body (NOT the total table count)
- AND NO edge is fabricated by default for any object absent from the body

### Requirement: Dynamic SQL via PREPARE/EXECUTE is flagged, never guessed; a non-dynamic body is not flagged

Where a body uses MySQL dynamic SQL — a `PREPARE` statement and/or an `EXECUTE` of a prepared statement
— the mysql adapter MUST mark the module `hasDynamicSql: true` (US-007) and MUST NOT fabricate any
`reads_from`/`writes_to`/`depends_on` edge for the dynamically-constructed portion. The dynamic-SQL
string literal contents MUST be MASKED (`maskDynamicStrings`) BEFORE reference extraction, so a table
name appearing ONLY inside a dynamic string MUST NOT produce an edge. A routine whose body contains NO
`PREPARE`/`EXECUTE` MUST NOT be flagged `hasDynamicSql`. This is the honest Phase-8b boundary:
full-fidelity stored-program parsing is DEFERRED and not committed to any later phase.

#### Scenario: PREPARE/EXECUTE routine is flagged with no invented edges

- GIVEN a procedure whose body builds a statement string and runs it via `PREPARE` and `EXECUTE`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure's `RawObject` is marked `hasDynamicSql: true`
- AND NO speculative `reads_from`/`writes_to`/`depends_on` edge is fabricated for the dynamic portion
- AND a table named ONLY inside the masked dynamic string yields NO edge

#### Scenario: Non-dynamic routine is NOT flagged as dynamic SQL

- GIVEN a procedure whose body is plain static SQL with no `PREPARE` and no `EXECUTE`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure is NOT marked `hasDynamicSql: true`
- AND its static body edges are derived normally (presence-gated, no phantom, no self-reference)

#### Scenario: Full-fidelity parsing is an acknowledged limitation, not a hidden gap

- GIVEN the Phase-8b conservative tokenizer
- WHEN a body cannot be resolved to definite read/write targets (dynamic `PREPARE`/`EXECUTE`)
- THEN the module is marked `hasDynamicSql: true` rather than guessed
- AND full stored-program grammar parsing is recorded as DEFERRED (not committed to any later phase)

### Requirement: fingerprint via one cheap catalog query sensitive to ADD COLUMN

The mysql adapter's `fingerprint()` SHALL run exactly ONE cheap catalog query over the connected database
(`= DATABASE()`) that derives a drift fingerprint from a catalog change marker (US-009; E5 common
criterion). It MUST NOT enumerate every object. The fingerprint MUST change when the schema (DDL) changes
— INCLUDING `ADD COLUMN` (a bare table-count marker is INSUFFICIENT, per the Phase-8a lesson) — and MUST
remain stable across data-only changes (inserts/updates/deletes that do not alter the schema). The
marker combines a `TABLES`-level signal AND a `COLUMNS`-level signal over the connected database (e.g.
table and column counts plus a column-level change marker), hashed with SHA-256.

#### Scenario: fingerprint changes on ADD COLUMN

- GIVEN a connected mysql adapter with a computed fingerprint
- WHEN a DDL statement adds a column to an existing table (`ALTER TABLE ... ADD COLUMN`)
- THEN a subsequent `fingerprint()` returns a different value (the column-level marker moves)

#### Scenario: fingerprint changes on other DDL

- GIVEN a connected mysql adapter with a computed fingerprint
- WHEN a DDL statement alters the schema (e.g. creating or dropping a table)
- THEN a subsequent `fingerprint()` returns a different value

#### Scenario: fingerprint is stable across data-only changes

- GIVEN a connected mysql adapter with a computed fingerprint
- WHEN only data changes (rows inserted/updated/deleted, no DDL)
- THEN a subsequent `fingerprint()` returns the same value

#### Scenario: fingerprint uses one cheap query and does not walk objects

- GIVEN a connected mysql adapter
- WHEN `fingerprint()` is called
- THEN it issues exactly ONE cheap catalog query combining a `TABLES` and a `COLUMNS` change marker over `DATABASE()`
- AND it does NOT enumerate every object to compute the value

### Requirement: Read-only by construction — catalog SELECTs only

The mysql adapter SHALL issue catalog read queries (`SELECT` over `information_schema.*`) ONLY and MUST
NOT issue any write statement through its connection (US-031). The adapter MUST NOT issue any session
read-only flag (e.g. `SET TRANSACTION READ ONLY` / `SET SESSION TRANSACTION READ ONLY`) or any session
workaround in place of the minimal-privilege user; the read-only posture is enforced by the user below
plus the existing engines write-verb scanner. This adapter's SQL falls under the existing engines
write-verb scanner (sqlite-extraction) which scans `src/adapters/engines/**` and fails on write verbs;
the mysql adapter MUST NOT introduce SQL — nor JSDoc string literals — that fail that scan.

#### Scenario: Adapter issues only catalog SELECTs

- GIVEN the mysql adapter connected to a source database
- WHEN it extracts or fingerprints
- THEN every statement it issues is a catalog `SELECT` over `information_schema.*`
- AND no `INSERT`/`UPDATE`/`DELETE`/`REPLACE`/DDL statement is issued
- AND no `SET TRANSACTION READ ONLY` / `SET SESSION ... READ ONLY` statement is issued

#### Scenario: mysql SQL passes the engines write-verb scanner

- GIVEN the mysql adapter source under `src/adapters/engines/mysql/**`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write verb in the adapter's SQL
- AND the scan passes (write verbs appearing only in comments or string literals do not false-positive)

### Requirement: Minimal read-only user documented

The repository SHALL ship `docs/permissions/mysql.md` containing a MINIMAL read-only user/grant script
that grants only what catalog metadata extraction needs (catalog/`information_schema` read access
sufficient to read object definitions, view bodies and routine bodies) and MUST NOT require broad
table-data read grants beyond catalog access (US-033). This user MUST be sufficient to extract the full
torture schema (catalog metadata only), proving no table-data permission is needed for metadata
extraction.

#### Scenario: Permission doc ships the minimal read-only user script

- GIVEN the repository
- WHEN `docs/permissions/mysql.md` is inspected
- THEN it contains a user/grant script granting only the minimal catalog read access (no broad table-data grant)
- AND it does NOT require broad table-data read grants for metadata extraction

#### Scenario: A minimal read-only user extracts the full torture schema

- GIVEN a MySQL user holding only the minimal grants from `docs/permissions/mysql.md`
- WHEN the adapter extracts the torture schema
- THEN the full catalog is extracted successfully (including view and routine bodies)
- AND no table-data access permission was required

### Requirement: Missing privilege raises an actionable PermissionError

When the connected user lacks a privilege required at runtime (e.g. to read a routine/view body), the
mysql adapter SHALL reject with the existing typed `PermissionError` (schema-extraction; reused, not
redefined). The error MUST be mapped from the `mysql2` privilege error code (e.g.
`ER_DBACCESS_DENIED_ERROR` / `ER_TABLEACCESS_DENIED_ERROR` / `ER_SPECIFIC_ACCESS_DENIED_ERROR`). The
message MUST be actionable: it MUST name the missing privilege, SHOULD name the object that required it,
and MUST point to `docs/permissions/mysql.md` (US-033). The adapter MUST NOT degrade to a partial/silent
catalog when the permission is missing.

#### Scenario: Missing catalog privilege yields a typed, actionable PermissionError

- GIVEN a user WITHOUT a privilege required to read definitions (driver returns a privilege error code)
- WHEN `extract(scope)` attempts to read the catalog
- THEN it SHALL reject with the typed `PermissionError`
- AND the message names the missing privilege and links to `docs/permissions/mysql.md`
- AND the adapter does NOT return a partial or silent catalog

### Requirement: Connectivity via host/port/database/user/password with optional ssl

The mysql adapter SHALL connect via the `mysql2` driver using host, port (default `3306`), database, user
and password, with optional `ssl` (US-029). The `password` MUST be supplied by reference as `${env:VAR}`
(env-only, never a literal in config — US-032 alignment, reusing the pg rejection pattern). There is NO
`schema?` field (the connected database IS the scope). When the database is unreachable or authentication
fails (driver returns an access-denied error code, e.g. `ER_ACCESS_DENIED_ERROR`), the adapter MUST
reject with the existing typed `ConnectionError` carrying an actionable message — it MUST NOT surface an
opaque driver error.

#### Scenario: Connects with explicit credentials and default port

- GIVEN a mysql config with host, database, user and a `${env:VAR}` password and no explicit port
- WHEN `connect()` is called
- THEN it connects to port `3306` by default and establishes a usable connection for `extract`/`fingerprint`

#### Scenario: Password must be supplied by env reference, not a literal

- GIVEN a mysql config whose `password` is a literal string rather than `${env:VAR}`
- WHEN the config is parsed
- THEN it is rejected (the password must be an `${env:VAR}` reference, env-only)

#### Scenario: There is no schema config knob

- GIVEN a mysql config
- WHEN its accepted fields are enumerated
- THEN there is NO `schema?` field (the connected `database` is the extraction scope)

#### Scenario: Authentication failure raises an actionable ConnectionError

- GIVEN a mysql config with invalid credentials (driver returns `ER_ACCESS_DENIED_ERROR`)
- WHEN `connect()` is called
- THEN it SHALL reject with the typed `ConnectionError`
- AND the message is actionable and does NOT surface an opaque driver error

### Requirement: Missing mysql2 driver names the install command

Because `mysql2` is an optional dependency loaded via a dynamic `import('mysql2/promise')` (ADR-006),
when the package is absent the adapter factory (`createMysqlSchemaAdapter`) SHALL fail with an error
whose message contains the exact install command (`npm i mysql2`), per the schema-extraction port
contract and the E5 common criterion.

#### Scenario: Absent mysql2 driver names npm i mysql2

- GIVEN the `mysql2` package is not installed
- WHEN the adapter attempts to load it via dynamic import
- THEN the raised error message MUST contain the exact `npm i mysql2` command

### Requirement: Committed MySQL torture fixture materialized via Testcontainers

The repository SHALL provide a committed MySQL torture schema (a plain-text `.sql` script under
`test/fixtures/mysql/`) that exercises 100% of the MySQL capability matrix and, at minimum: a table with
an `AUTO_INCREMENT` column, a CHECK constraint, a composite foreign key, a multi-column index, a view, a
routine that writes two tables and reads a third (proving the exact directed edge set), a routine using
dynamic `PREPARE`/`EXECUTE` (proving `hasDynamicSql` and string masking), a trigger (event + timing), and
`TABLE_COMMENT`/`COLUMN_COMMENT` annotations (US-029). The integration setup MUST materialize this script
into an ephemeral `mysql:8` Testcontainers instance; the committed artifact MUST be the reviewable `.sql`
script (no binary database blob). The integration job MUST NOT require Docker for the unit matrix and
MUST skip-with-reason where Docker is unavailable rather than fail.

Integration tests are gated by `DBGRAPH_INTEGRATION=1` (NOT mere Docker presence), ensuring the unit
matrix never accidentally runs containers.

#### Scenario: Fixture is a reviewable .sql script

- GIVEN the mysql torture fixture in the repository
- WHEN the committed artifact is inspected
- THEN it is a plain-text `.sql` script (not a binary database file)
- AND it is human-reviewable in a pull request

#### Scenario: Fixture exercises the required torture objects

- GIVEN the materialized torture database
- WHEN the adapter extracts it
- THEN the catalog covers an `AUTO_INCREMENT` column, a CHECK constraint, a composite foreign key, a multi-column index, a view, a routine writing two tables and reading a third, a dynamic `PREPARE`/`EXECUTE` routine, a trigger (event + timing) and `TABLE_COMMENT`/`COLUMN_COMMENT` annotations
- AND 100% of the MySQL capability matrix is exercised

#### Scenario: Integration setup uses an ephemeral container and skips without DBGRAPH_INTEGRATION

- GIVEN the mysql integration test
- WHEN `DBGRAPH_INTEGRATION=1` is set and Docker is available
- THEN setup materializes the `.sql` into an ephemeral `mysql:8` Testcontainers instance
- AND WHEN `DBGRAPH_INTEGRATION` is not set the integration test is skipped with an explicit reason (the unit matrix never runs integration tests)

### Requirement: Golden-pinned RawCatalog and end-to-end pipeline

There SHALL be a deterministic golden test pinning the `RawCatalog` extracted from the torture schema:
the catalog MUST be serialized via the existing `stableStringify` and MUST be byte-identical across runs
(ADR-008). There SHALL ALSO be an end-to-end test driving the full pipeline — torture `.sql` →
materialize → adapter `extract` → `normalizeCatalog` → `SqliteGraphStore` upsert → query (`impact`,
`path`) — whose outputs are golden-pinned and byte-identical on re-run (US-029). The mysql CI job MUST be
gated (`mysql-integration`, `DBGRAPH_INTEGRATION=1`), MUST NOT block the unit matrix, and MUST NOT touch
any validation database.

Edge endpoint assertions MUST pin both source and destination qnames. Asserting only that an edge exists
(without its endpoints) is INSUFFICIENT — a wrong-destination or phantom edge passes existence-only
assertions silently (this is the Phase-8a CRITICAL-1 lesson). The golden MUST therefore pin exact edge
counts AND endpoints, MUST assert `stubCount: 0`, and MUST assert no self-reference edge exists.

#### Scenario: RawCatalog golden is deterministic and byte-identical

- GIVEN the materialized torture database
- WHEN the adapter `extract` output is serialized via `stableStringify`
- THEN it matches the golden `RawCatalog` file
- AND a second extraction on the same fixture produces byte-identical output (ADR-008)
- AND the golden contains ZERO sequence objects (`AUTO_INCREMENT` rides the column)

#### Scenario: Full pipeline reaches impact and path queries golden-pinned with exact edges

- GIVEN the materialized torture database
- WHEN the pipeline runs extract → `normalizeCatalog` → `SqliteGraphStore` upsert → query
- THEN `impact` and `path` queries return results over the persisted graph
- AND those outputs match their golden files and are byte-identical on re-run (ADR-008)
- AND the golden pins exact edge counts AND both endpoints of every edge, with `stubCount: 0` and NO self-reference edge

#### Scenario: mysql CI job is gated and never touches a validation database

- GIVEN the `mysql-integration` job in CI
- WHEN the unit matrix runs
- THEN it does NOT depend on the gated `mysql-integration` job
- AND the `mysql-integration` job uses only an ephemeral `mysql:8` container and never connects to any validation database

### Requirement: Body-parsed calls edges for routine invocations, presence-gated with no phantom or self edges

The mysql adapter SHALL extend the shared tokenizer's candidate list to include ROUTINE names
(procedures and functions) so a routine invocation in a `ROUTINE_DEFINITION` body (`CALL proc()` /
`SELECT fn()`) that resolves to a REAL routine node produces a `calls` edge from the calling routine
to the referenced routine with `confidence: 'parsed'`. Emission MUST be PRESENCE-GATED over the
dynamic-string-MASKED static body (`maskDynamicStrings` + `bodyContainsRef`): a routine name appearing
only inside a masked `PREPARE`/`EXECUTE` dynamic string, a comment, or a string literal MUST NOT
produce an edge. The adapter MUST NEVER default-to-`calls` for every catalog routine, and MUST NEVER
emit a SELF-reference `calls` edge unless the routine is genuinely recursive. Extending the candidate
list MUST NOT reclassify existing table dependencies.

#### Scenario: proc CALL proc yields exactly one parsed calls edge

- GIVEN the torture procedure `app.proc_orchestrate` whose body does `CALL app.proc_step()`, and the procedure `app.proc_step` whose body does `INSERT INTO app.audit_log ...`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `app.proc_orchestrate` emits EXACTLY one `calls app.proc_step` edge with `confidence: 'parsed'` and NO `reads_from`/`writes_to` edge to `app.proc_step`
- AND `app.proc_step` emits `{ writes_to app.audit_log (parsed) }` and ZERO `calls` edge

#### Scenario: routine touching only tables emits zero calls edges (negative)

- GIVEN a procedure whose static body writes/reads only tables and CALLs no routine
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN it emits its `reads_from`/`writes_to` edges as before and ZERO `calls` edge
- AND no self-reference `calls` edge is emitted

#### Scenario: CALL name only inside a masked dynamic string yields no calls edge (negative)

- GIVEN a procedure that builds `'CALL app.proc_step()'` and runs it via `PREPARE`/`EXECUTE`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure is marked `hasDynamicSql: true` and emits NO `calls` edge to `app.proc_step` (the name is inside the masked dynamic string)

### Requirement: mysql torture fixture exercises routine-calls-routine

The committed mysql torture `.sql` (`test/fixtures/mysql/`) SHALL add `app.proc_orchestrate` (CALLing
`app.proc_step`) and `app.proc_step`, using NEUTRAL names. The golden-pinned `RawCatalog` and
end-to-end impact/path goldens MUST be re-blessed DELIBERATELY to include the `calls
app.proc_orchestrate → app.proc_step` edge (`confidence: 'parsed'`), with L-009 exact-set assertions
pinning both endpoints, exact edge counts, `stubCount: 0`, and no self-reference edge.

#### Scenario: fixture adds the routine-calls-routine objects and re-blessed golden pins the parsed calls edge

- GIVEN the materialized mysql torture database with `app.proc_orchestrate` and `app.proc_step`
- WHEN the adapter extracts it and the pipeline runs extract → normalize → upsert → query
- THEN the re-blessed goldens contain EXACTLY the edge `app.proc_orchestrate → app.proc_step` of kind `calls`, `confidence: 'parsed'`, with exact endpoints, `stubCount: 0` and no self-reference edge, byte-identical on re-run (ADR-008)

### Requirement: Extract routine parameters from information_schema.PARAMETERS

The mysql adapter SHALL source routine parameters from `information_schema.PARAMETERS` (filtered
`SPECIFIC_SCHEMA = DATABASE()`), attaching them to each routine's `RawObject.parameters`. For each it
MUST capture `name` (`PARAMETER_NAME`), `dataType` (`DTD_IDENTIFIER`, composed IDENTICALLY to the
adapter's COLUMN `dataType`, e.g. `int`, `varchar(20)`), `direction` from `PARAMETER_MODE` (`IN`→`in`,
`OUT`→`out`, `INOUT`→`inout`; a NULL mode — as MySQL reports for FUNCTION parameters — maps to `in`),
and `ordinal` from `ORDINAL_POSITION`. The FUNCTION RETURN row (`ORDINAL_POSITION = 0`, NULL
`PARAMETER_NAME`) MUST be EXCLUDED — it is not a parameter. MySQL exposes NO parameter default column,
so `hasDefault` MUST NEVER be emitted for any mysql parameter (the field is OMITTED, not set false). A
routine with no parameters MUST carry an empty parameters array.

#### Scenario: zero-parameter procedures pinned exactly (proc_orchestrate/proc_step)

- GIVEN the torture procedures `app.proc_orchestrate()` and `app.proc_step()`
- WHEN `extract(scope)` runs
- THEN each carries `parameters: []`
- AND NO `hasDefault` field appears on any mysql parameter

#### Scenario: function return row (ordinal 0) excluded (fn_audit_write)

- GIVEN the function `fn_audit_write(p_order_id INT, p_old_status VARCHAR(20), p_new_status VARCHAR(20)) RETURNS INT`
- WHEN `extract(scope)` runs
- THEN its `parameters` are EXACTLY `[{name:"p_order_id", dataType:"int", direction:"in", ordinal:1}, {name:"p_old_status", dataType:"varchar(20)", direction:"in", ordinal:2}, {name:"p_new_status", dataType:"varchar(20)", direction:"in", ordinal:3}]`
- AND the `ORDINAL_POSITION = 0` return row is EXCLUDED and NO parameter carries `hasDefault`

#### Scenario: mysql goldens gain parameters deliberately, scanner stays green

- GIVEN the mysql raw-catalog and e2e goldens
- WHEN parameters are added
- THEN the mysql goldens are re-blessed DELIBERATELY to carry the pinned arrays; every unrelated byte is unchanged
- AND the new PARAMETERS query passes the engines write-verb scanner (catalog `SELECT` only)

### Requirement: View column lineage degrades by absence (no view-column catalog)

Because MySQL has no view-column catalog, the mysql adapter MUST leave `RawDependency.columns` UNSET for
every view dependency, so the view→table `depends_on` edges carry NO `attrs.dstColumns` — degradation is
expressed by ABSENCE (NO per-edge marker, no `attrs.degraded`). The adapter MUST NOT fabricate a column from
the view body text (ADR-007) — the absence is stated plainly (HONESTY). The mysql view `depends_on` edges
(`confidence: 'parsed'`, body-derived) stay BYTE-IDENTICAL to pre-DOG-3 (zero drift). A new per-engine
`supportsColumnLineage: false` capability documents WHY; `supportsDependencyHints` and the existing edges are
otherwise UNCHANGED. Coverage is read from the EDGE (`attrs.dstColumns`), never inferred from the flag.

#### Scenario: mysql view carries object-grain depends_on, zero dstColumns, byte-identical

- GIVEN a mysql torture view whose body reads base tables `b` and `c`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN the view carries object-grain `depends_on` to `b` and to `c`, each `confidence: 'parsed'` with NO `attrs.dstColumns`
- AND those edges are byte-identical to their pre-DOG-3 form (degrade-by-absence, no marker)

#### Scenario: no body-parsed column is fabricated (negative)

- GIVEN the same view whose body names specific columns of `b`/`c`
- WHEN the catalog is normalized
- THEN the adapter MUST NOT mint an `attrs.dstColumns` entry from the body text (ADR-007)
- AND no column claim appears on any view edge

#### Scenario: mysql goldens show zero column-lineage drift

- GIVEN the mysql raw-catalog and e2e goldens
- WHEN DOG-3 is applied
- THEN the view-edge goldens are BYTE-IDENTICAL (no `attrs.dstColumns`, no marker); the only additive change is the `supportsColumnLineage: false` capability flag, which changes no edge byte
- AND the adapter's SQL still passes the engines write-verb scanner (catalog `SELECT` only)
