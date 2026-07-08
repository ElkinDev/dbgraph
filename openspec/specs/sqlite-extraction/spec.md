# SQLite Extraction Specification (delta — phase-2-sqlite-extraction)

## Purpose

The concrete SQLite `SchemaAdapter`: which catalog objects it extracts (tables, columns, foreign keys
including composite, indexes including unique/partial/expression, views, triggers), its truthful
`CapabilityMatrix`, its `fingerprint()` via `PRAGMA schema_version`, its driver duality
(`better-sqlite3` and the `node:sqlite` builtin producing the SAME `RawCatalog`), and the
golden-pinned end-to-end pipeline that proves the whole chain with ZERO infrastructure. Stories:
US-026 (SQLite adapter), US-031 (read-only by construction + write-verb scanner), US-009 (fingerprint
SQLite part). This adapter is the first concrete `SchemaAdapter` (see schema-extraction) and lives
under `src/adapters/engines/sqlite/` per ADR-004 (adapter outside core).

> **Story criterion superseded (US-026).** US-026's acceptance criterion "the fixture is a committable
> `.db` file" is REFINED by a locked project decision: the torture fixture is a committed `.sql`
> script that the test setup materializes into a temporary database via the driver — NOT a committed
> binary `.db`. This keeps the fixture reviewable in PRs with no binary churn while preserving the
> "zero containers" intent of US-026. The apply phase will annotate the story accordingly.

## ADDED Requirements

### Requirement: Extract tables and columns via PRAGMA table_info

The SQLite adapter SHALL extract every user table and its columns from `sqlite_master` and
`PRAGMA table_info`, capturing column name, declared type, nullability, default value and primary-key
membership. System tables (e.g. `sqlite_*`) MUST be excluded.

#### Scenario: Tables and columns are extracted

- GIVEN a SQLite database with user tables containing typed, nullable and primary-key columns
- WHEN the adapter extracts the catalog
- THEN the `RawCatalog` contains each user table with its columns
- AND each column carries name, declared type, nullability, default and PK membership
- AND `sqlite_*` system tables are absent from the catalog

### Requirement: Extract foreign keys including composite via foreign_key_list

The SQLite adapter SHALL extract foreign keys from `PRAGMA foreign_key_list`, including COMPOSITE
foreign keys (a single constraint spanning multiple column pairs), preserving the ordered local→referenced
column mapping for each constraint.

#### Scenario: Single-column foreign key is extracted

- GIVEN a table with a single-column foreign key to another table
- WHEN the adapter extracts the catalog
- THEN the `RawCatalog` contains that FK with its local and referenced column

#### Scenario: Composite foreign key keeps its column pairs together

- GIVEN a table with a composite foreign key over two or more columns
- WHEN the adapter extracts the catalog
- THEN the FK is represented as ONE constraint
- AND its ordered local→referenced column pairs are all preserved (not split into separate single-column FKs)

### Requirement: Extract indexes including unique, partial and expression

The SQLite adapter SHALL extract indexes from `PRAGMA index_list` and `PRAGMA index_info`, including
UNIQUE indexes, PARTIAL indexes (those with a `WHERE` clause) and EXPRESSION indexes (those indexing an
expression rather than a plain column). Uniqueness and the partial/expression nature MUST be represented
honestly.

#### Scenario: Unique index is marked unique

- GIVEN a table with a unique index
- WHEN the adapter extracts the catalog
- THEN the index is present and reported as unique

#### Scenario: Partial index is captured

- GIVEN an index defined with a `WHERE` clause (partial index)
- WHEN the adapter extracts the catalog
- THEN the index is present and its partial nature is represented (not dropped)

#### Scenario: Expression index is captured

- GIVEN an index over an expression rather than a plain column
- WHEN the adapter extracts the catalog
- THEN the index is present and its expression nature is represented (not silently omitted)

### Requirement: Extract views and triggers from sqlite_master with bodies per level

The SQLite adapter SHALL extract views and triggers from `sqlite_master`, taking their bodies from
`sqlite_master.sql`. Bodies MUST be governed by the resolved indexing level (schema-extraction): at
`full` the body is included, at `metadata` the object is present without its body. Each trigger MUST
carry its firing event so `graph-model`'s `fires_on` edge can be derived downstream.

#### Scenario: View is extracted with its body at full

- GIVEN a view and an `ExtractionScope` resolving views to `full`
- WHEN the adapter extracts the catalog
- THEN the view is present with its definition body from `sqlite_master.sql`

#### Scenario: Trigger carries its firing event

- GIVEN a trigger defined for a DML event (e.g. `INSERT`)
- WHEN the adapter extracts the catalog
- THEN the trigger is present and its firing event is captured

#### Scenario: Metadata level omits the body

- GIVEN a view or trigger and an `ExtractionScope` resolving it to `metadata`
- WHEN the adapter extracts the catalog
- THEN the object is present
- AND its body is NOT included

### Requirement: Truthful SQLite CapabilityMatrix

The SQLite adapter's `CapabilityMatrix` SHALL truthfully report that SQLite supports tables, columns,
foreign keys, indexes, views and triggers, and that it does NOT support procedures, functions,
sequences or collections. The matrix MUST itself say so (the unsupported types are explicitly reported
as unsupported, not merely omitted), and the adapter MUST NOT emit any object of an unsupported type.

#### Scenario: Matrix declares the unsupported types

- GIVEN the SQLite adapter's `CapabilityMatrix`
- WHEN the supported types are queried
- THEN procedures, functions, sequences and collections are each reported as unsupported
- AND tables, columns, foreign keys, indexes, views and triggers are reported as supported

#### Scenario: No unsupported objects are emitted

- GIVEN a SQLite database (which cannot contain procedures, functions, sequences or collections)
- WHEN the adapter extracts the catalog
- THEN the `RawCatalog` contains no object of those unsupported types

### Requirement: Driver duality yields the same RawCatalog

The SQLite adapter SHALL run the SAME extraction logic over both `better-sqlite3` and the `node:sqlite`
builtin via a factory that dynamically imports the driver (ADR-006). Both drivers MUST produce THE SAME
`RawCatalog` for the same source database. Because `node:sqlite` is a Node >=22.5 builtin while CI runs
a Node 20 matrix entry, the cross-driver parity test SHALL be CONDITIONAL on Node >=22.5 and MUST
skip-with-reason on Node 20 (ADR-006/007) rather than fail.

#### Scenario: better-sqlite3 and node:sqlite produce identical catalogs (Node >=22.5)

- GIVEN the same source database extracted via `better-sqlite3` and via `node:sqlite`
- WHEN both `RawCatalog`s are compared
- THEN they are identical
- AND this scenario runs ONLY on Node >=22.5

#### Scenario: Parity test skips with reason on Node 20

- GIVEN a CI runner on Node 20 where `node:sqlite` is unavailable
- WHEN the cross-driver parity test is collected
- THEN it is skipped with an explicit reason (`node:sqlite` requires Node >=22.5)
- AND the suite does NOT fail for the missing builtin (ADR-007, no new dependency)

### Requirement: Read-only by construction on the SQLite connection

The SQLite adapter SHALL open every source database read-only (driver opened with `{ readonly: true }`,
US-031). A write statement attempted through the adapter's connection MUST fail by the connection's
read-only mode, not by convention.

#### Scenario: Write through the SQLite connection fails

- GIVEN a SQLite source database opened by the adapter
- WHEN a write statement (e.g. `INSERT`/`UPDATE`/`CREATE`) is attempted on that connection
- THEN it MUST fail because the connection is read-only

### Requirement: Write-verb scanner over engines, exempting storage

A repository test SHALL scan all SQL embedded under `src/adapters/engines/**` and FAIL on write verbs
(`INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`, `MERGE`, non-catalog `EXEC`)
(US-031). The scanner MUST NOT false-positive on those verbs when they appear inside string literals or
comments (e.g. a trigger-body fixture string or an explanatory comment). `src/adapters/storage/**` is
EXEMPT by design because it writes the local index (ADR-005).

#### Scenario: Injected write verb in engines fails the scan

- GIVEN a write verb such as `INSERT` placed in executable SQL under `src/adapters/engines/**`
- WHEN the write-verb scanner runs
- THEN the test FAILS and names the offending verb and location

#### Scenario: Write verbs inside string literals or comments do not false-positive

- GIVEN a write verb appearing only inside a string literal or a comment under `src/adapters/engines/**`
- WHEN the write-verb scanner runs
- THEN the test PASSES (no false positive on non-executable occurrences)

#### Scenario: Storage is exempt from the scan

- GIVEN write SQL under `src/adapters/storage/**` (local index writes per ADR-005)
- WHEN the write-verb scanner runs
- THEN those files are EXEMPT and do NOT fail the scan

### Requirement: fingerprint via PRAGMA schema_version

The SQLite adapter's `fingerprint()` SHALL run exactly ONE cheap query — `PRAGMA schema_version` — to
derive a drift fingerprint (US-009). The value MUST change when the schema (DDL) changes and MUST remain
stable across data-only changes (inserts/updates/deletes that do not alter the schema).

#### Scenario: fingerprint changes on DDL change

- GIVEN a SQLite database with a computed fingerprint
- WHEN a DDL statement alters the schema (e.g. adding a column)
- THEN a subsequent `fingerprint()` returns a different value

#### Scenario: fingerprint is stable across data-only changes

- GIVEN a SQLite database with a computed fingerprint
- WHEN only data changes (rows inserted/updated/deleted, no DDL)
- THEN a subsequent `fingerprint()` returns the same value

#### Scenario: fingerprint uses one cheap query

- GIVEN a connected SQLite adapter
- WHEN `fingerprint()` is called
- THEN it issues exactly one `PRAGMA schema_version` query and does NOT enumerate all objects

### Requirement: Torture fixture is a committed .sql materialized at setup

The SQLite torture fixture SHALL be a committed `.sql` script that exercises EVERY SQLite-supported
object type (tables, typed/nullable/PK columns, single and composite foreign keys, unique/partial/expression
indexes, views, triggers with events). The test setup MUST materialize it into a temporary database via
the driver at run time. The committed artifact MUST NOT be a binary `.db` file (locked decision
superseding US-026's `.db` criterion), keeping the fixture reviewable with no binary churn and zero
containers.

#### Scenario: Fixture is a reviewable .sql script

- GIVEN the SQLite torture fixture in the repository
- WHEN the committed artifact is inspected
- THEN it is a plain-text `.sql` script (not a binary `.db` file)
- AND it is human-reviewable in a pull request

#### Scenario: Setup materializes the fixture into a temporary database

- GIVEN the committed `.sql` torture script
- WHEN the test setup runs
- THEN it materializes the script into a temporary database via the driver
- AND no container or external service is required

#### Scenario: Fixture exercises every supported object type

- GIVEN the materialized torture database
- WHEN the adapter extracts it
- THEN the catalog covers tables, columns, single and composite FKs, unique/partial/expression indexes, views and triggers (100% SQLite capability-matrix coverage)

### Requirement: Golden-pinned end-to-end pipeline

There SHALL be an end-to-end test driving the full pipeline: torture `.sql` → materialize → adapter
`extract` → `normalizeCatalog` → `SqliteGraphStore` upsert → query (`neighbors`, `impact`, `path`,
`search`). Its outputs MUST be golden-pinned, and re-running the pipeline on the same fixture MUST
produce byte-identical results (ADR-008 determinism).

#### Scenario: Full pipeline reaches the query layer

- GIVEN the materialized torture database
- WHEN the pipeline runs extract → normalize → upsert into `SqliteGraphStore`
- THEN `neighbors`, `impact`, `path` and `search` return results over the persisted graph

#### Scenario: Pipeline output is golden-pinned and deterministic

- GIVEN the golden-pinned expectations for the torture fixture
- WHEN the end-to-end pipeline runs
- THEN its output matches the golden files
- AND a second run on the same fixture produces byte-identical output (ADR-008)

### Requirement: View and trigger dependency edges derived from bodies via the shared tokenizer

The SQLite adapter SHALL derive dependency edges for views and triggers from their bodies in
`sqlite_master.sql` using the shared conservative presence-gate tokenizer
(`maskDynamicStrings` + `bodyContainsRef`, byte-identical to pg/mysql/mssql), matched against a
candidate list of all tables and views. A view body SHALL yield `depends_on` edges (a view's read
dependency normalizes to `depends_on`); a trigger's ACTION body (`BEGIN…END` only) SHALL yield
`writes_to` (INSERT/UPDATE/DELETE targets) and `reads_from` (read targets). The `CREATE TRIGGER … ON
<object>` header MUST be STRIPPED before presence-gating so the fires_on object never leaks a
`reads_from`/`writes_to` edge. All emitted edges MUST carry `confidence: 'parsed'`. The presence-gate
MUST match only real catalog objects (word-boundary, dynamic strings masked): a name appearing only in
a comment or string literal, a `NEW.`/`OLD.` pseudo-reference, or a self-reference MUST NOT fabricate
an edge, and an unparseable/dynamic body MUST be marked `has_dynamic_sql: true` rather than guessed.
`supportsDependencyHints` MUST remain `false` and its comment MUST be corrected to state that SQLite
derives edges from bodies (the flag denotes cheap catalog hints, which SQLite lacks).
(Previously: full SQL-body dependency parsing was DEFERRED beyond Phase 2; `extractViews`/`extractTriggers`
hardcoded `dependencies: []`, so view and trigger nodes carried no `depends_on`/`reads_from`/`writes_to` edges.)

#### Scenario: View bodies emit exact `depends_on` edges

- GIVEN the torture fixture views `active_departments` and `employee_summary`
- WHEN the adapter extracts and the catalog is normalized
- THEN `depends_on` edges are EXACTLY `main.active_departments → {main.departments, main.employees}`
  and `main.employee_summary → {main.employees, main.departments}` — no other, no fewer
- AND every such edge carries `confidence: 'parsed'`

#### Scenario: Trigger action bodies emit exact `writes_to` edges

- GIVEN the torture triggers
- WHEN the adapter extracts and the catalog is normalized
- THEN `writes_to` edges are EXACTLY `main.trg_emp_before_insert`, `main.trg_emp_after_insert`,
  `main.trg_emp_before_update`, `main.trg_emp_after_delete`, `main.trg_emp_salary_update` each
  `→ main.audit_log`, and `main.trg_active_dept_instead_insert → main.departments`
- AND every such edge carries `confidence: 'parsed'`

#### Scenario: Trigger header never leaks a `reads_from`/`writes_to` edge (negative)

- GIVEN the same triggers whose `ON <object>` header names `employees` / `active_departments`
- WHEN the catalog is normalized
- THEN NO trigger emits `reads_from` or `writes_to` to its fires_on object
  (no `trg_emp_* → main.employees`, no `trg_active_dept_instead_insert → main.active_departments`)
- AND no trigger emits any `reads_from` edge at all (the bodies only write)

#### Scenario: No self-edges and no phantom edges (negative)

- GIVEN view/trigger bodies referencing `NEW.`/`OLD.` pseudo-columns and their own names
- WHEN the catalog is normalized
- THEN no view or trigger emits a `depends_on`/`reads_from`/`writes_to` edge to itself
- AND no edge is fabricated for a `NEW.`/`OLD.` pseudo-reference or a name appearing only in a comment or string literal

#### Scenario: `supportsDependencyHints` stays false, comment corrected

- GIVEN the SQLite `CapabilityMatrix`
- WHEN `supportsDependencyHints` is inspected
- THEN it is `false` (matching pg/mysql/mongodb) even though body-derived edges are emitted
- AND the accompanying comment states edges are derived from bodies; the flag denotes cheap catalog hints SQLite lacks

#### Scenario: Edge set is deterministic

- GIVEN the same materialized torture catalog extracted twice
- WHEN both edge sets are serialized
- THEN they are byte-identical (ADR-008) — same catalog yields the identical view/trigger dependency edge set

### Requirement: SQLite emits no calls edges (capability honestly absent)

Because the SQLite `CapabilityMatrix` declares procedures and functions UNSUPPORTED, the SQLite
adapter MUST NOT emit any `calls` edge under any circumstance: there is no routine node to originate or
receive one. A trigger body naming an identifier that looks like a function invocation MUST NOT be
turned into a `calls` edge (SQLite has no stored routine to resolve against; host-registered UDFs are
not catalog objects). The `CapabilityMatrix` MUST remain UNCHANGED — procedures and functions stay
unsupported. No new fixture object is added for `calls`.

#### Scenario: SQLite torture graph contains zero calls edges

- GIVEN the existing SQLite torture graph (tables, views, triggers — no routines)
- WHEN the adapter extracts it and the catalog is normalized
- THEN the graph contains ZERO edges of kind `calls`
- AND the SQLite `CapabilityMatrix` still reports procedures and functions as unsupported

#### Scenario: a function-like token in a trigger body invents no calls edge (negative)

- GIVEN a SQLite trigger whose action body references a function-like identifier (e.g. `some_udf(x)`)
- WHEN the catalog is normalized
- THEN NO `calls` edge is fabricated (no routine node exists to resolve the invocation against)
- AND no routine stub is minted for the identifier

### Requirement: SQLite emits no routine parameters (capability honestly absent)

Because the SQLite `CapabilityMatrix` declares procedures and functions UNSUPPORTED, the SQLite adapter
MUST NOT populate `RawObject.parameters` under any circumstance — there is no routine node to carry
them. `parameters` MUST remain UNSET on every SQLite `RawObject` (honest absence, declared — NEVER an
empty array, never fabricated). The `CapabilityMatrix` MUST remain UNCHANGED and NO fixture object is
added.

#### Scenario: SQLite catalog carries no parameters field

- GIVEN the existing SQLite torture catalog (tables, views, triggers — no routines)
- WHEN the adapter extracts it
- THEN no `RawObject` carries a `parameters` field (the field is UNSET, not `[]`)
- AND the SQLite `CapabilityMatrix` still reports procedures and functions unsupported

#### Scenario: SQLite present/MCP goldens show zero drift (negative)

- GIVEN the existing sqlite-substrate explore/object goldens (focusing a TABLE, `main.employees`)
- WHEN DOG-2 is applied
- THEN those goldens are byte-identical — the parameters feature adds NO SQLite output (no routine node, no PARAMETERS section)
