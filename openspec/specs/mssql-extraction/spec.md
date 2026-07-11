# MSSQL Extraction Specification

## Purpose

The concrete SQL Server `MssqlSchemaAdapter`: which catalog objects it extracts from `sys.*`
(tables, columns with types/nullability/defaults/computed, PK/FK/unique/check constraints, indexes
including clustered/nonclustered/filtered/included, views, stored procedures, scalar and table-valued
functions, triggers with event and timing, sequences, and `MS_Description` extended properties as
comments), its truthful `CapabilityMatrix` (procedures, functions and sequences SUPPORTED — unlike
SQLite), its `confidence: parsed` `reads_from`/`writes_to` classification from module bodies via a
conservative tokenizer with honest `has_dynamic_sql` blindness, its `fires_on` trigger edges
(event + timing), its `fingerprint()` over `sys.objects`, its connectivity (SQL auth, NTLM, and
Windows Integrated Security via external-tool strategies), its minimal `VIEW DEFINITION`-only login
plus actionable `PermissionError`, and the Testcontainers golden-pinned end-to-end pipeline. Stories:
US-027 (SQL Server adapter), US-007 (extraction half — body parsing into read/write edges), US-009
(mssql fingerprint), US-031 (read-only by construction), US-033 (minimal permissions and actionable
errors), US-027/US-031 (connectivity-strategies change: integrated auth + sqlcmd + manual-dump).

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
>
> **Body-driven write-target discovery** (finding new write targets NOT already in
> `sys.sql_expression_dependencies` by tokenizing the body text independently) is recorded as a future
> enhancement (S-2) and is NOT a Phase-3 obligation. The current tokenizer only RECLASSIFIES edges
> already returned by the dep view.

## Requirements

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

The `fires_on` destination MUST be the PARENT TABLE (resolved via `sys.objects.parent_object_id`),
NOT the trigger's own identity. The `RawTriggerInfo.table` field at the adapter boundary MUST carry
the parent table (schema and name), per the `graph-model` contract.

> **Boundary note (L-009 promoted).** The tokenizer only RECLASSIFIES edges already returned by
> `sys.sql_expression_dependencies` — it does NOT discover new write targets absent from that view.
> For well-formed T-SQL as in the torture schema, the dep view is complete. Body-driven write-target
> discovery independent of the dep view is recorded as future enhancement S-2 and is NOT a Phase-3
> obligation.

#### Scenario: AFTER UPDATE trigger fires on its table and writes its audit target

- GIVEN an `AFTER UPDATE` trigger on table `T` whose body writes to audit table `A`
- WHEN `extract(scope)` runs at `full`
- THEN a `fires_on` relationship from the trigger to `T` is derivable with `event = UPDATE` and timing `AFTER`
- AND `T` is the PARENT TABLE (not the trigger itself; no phantom stub node named after the trigger appears)
- AND a `writes_to` edge from the trigger to `A` exists with `confidence: parsed`

### Requirement: Dynamic SQL is flagged, never guessed

Where a module body cannot be reliably analyzed by the conservative tokenizer — notably dynamic SQL
executed via `sp_executesql` or an `EXEC`/`EXECUTE` of a STRING EXPRESSION (`EXEC(<string>)`,
`EXEC (@sql)`, `EXECUTE @sql`) — the mssql adapter MUST mark the module `has_dynamic_sql: true` (US-007)
and MUST NOT fabricate any `reads_from`/`writes_to`/`depends_on` edge for the unanalyzable portion. This
is the honest Phase-3 boundary: full-fidelity T-SQL parsing is DEFERRED and not committed to any later
phase.

A bare `EXEC`/`EXECUTE <identifier>` whose operand is a routine name (e.g. `EXEC dbo.usp_log_change`,
`EXECUTE [dbo].[proc]`) is a RESOLVED CALL — it is already captured as a `calls` edge from the catalog
(`sys.sql_expression_dependencies`, DOG-1) and its target is fully visible. It MUST NOT, on its own,
cause `has_dynamic_sql: true`. The marker means "a dependency the STATIC graph cannot see"; a declared
call is NOT such a blind spot, and marking it as one is a false positive that misleads consumers of the
`[DYNAMIC SQL]` marker.

The distinction MUST be conservative and honest, never a full grammar:
- `sp_executesql` present → `has_dynamic_sql: true` (always).
- `EXEC`/`EXECUTE` immediately followed by `(` or `@` (a parenthesized string or a string variable) →
  `has_dynamic_sql: true`.
- `EXEC`/`EXECUTE` followed by an identifier operand (bracketed/quoted or bare) → NOT dynamic by itself.
- A module that does BOTH a resolved call AND a real dynamic-SQL execution → `has_dynamic_sql: true` (the
  presence of ANY real dynamic form flags the module, regardless of also having resolved calls).
- No `sp_executesql` and no `EXEC`/`EXECUTE (`/`@` form → `has_dynamic_sql` absent/false.

#### Scenario: Dynamic-SQL procedure via sp_executesql is flagged with no invented edges

- GIVEN the torture procedure `dbo.sp_dynamic_search` whose body builds a string and runs it via `EXEC sp_executesql @sql`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure's `RawObject` is marked `has_dynamic_sql: true`
- AND NO speculative `reads_from`/`writes_to`/`depends_on` edge is fabricated for the dynamic portion

#### Scenario: Bare EXEC of a resolved routine is NOT flagged as dynamic (the benchmark-v2 false positive)

- GIVEN the torture procedure `dbo.usp_refresh_totals` whose body does `UPDATE dbo.order_totals ...` and `EXEC dbo.usp_log_change @order_id, N'refreshed'` (no `sp_executesql`, no `EXEC(...)`/`EXEC @var`)
- WHEN `extract(scope)` runs at `full`
- THEN `dbo.usp_refresh_totals` is NOT marked `has_dynamic_sql` (the key is absent / false)
- AND it STILL emits its `calls dbo.usp_log_change (declared)` and `writes_to dbo.order_totals (parsed)` edges UNCHANGED (the DOG-1 behaviour is untouched)

#### Scenario: EXEC/EXECUTE of a string expression IS flagged

- GIVEN a procedure body that runs `EXEC('SELECT ...')`, or `EXEC (@sql)`, or `EXECUTE @sql`, or `EXECUTE('SELECT ...')`
- WHEN `has_dynamic_sql` is derived from the body
- THEN it is `true` for each of those string-execution forms (the full keyword `EXECUTE` is covered, not only the `EXEC` abbreviation)

#### Scenario: A routine doing BOTH a resolved call and real dynamic SQL still flags

- GIVEN a procedure whose body contains `EXEC dbo.usp_log_change` (a resolved call) AND `EXEC(@sql)` (real dynamic SQL)
- WHEN `has_dynamic_sql` is derived
- THEN it is `true` (any real dynamic form flags the module; the presence of a resolved call does not suppress the flag)

#### Scenario: Full-fidelity parsing is an acknowledged limitation, not a hidden gap

- GIVEN the Phase-3 conservative tokenizer
- WHEN a body runs genuine dynamic SQL that cannot be resolved to definite read/write targets
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

Integration tests are gated by `DBGRAPH_INTEGRATION=1` (NOT mere Docker presence), ensuring the unit
matrix on CI (which has Docker available on ubuntu-latest) never accidentally runs containers.

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

#### Scenario: Integration setup uses an ephemeral container and skips without DBGRAPH_INTEGRATION

- GIVEN the mssql integration test
- WHEN `DBGRAPH_INTEGRATION=1` is set and Docker is available
- THEN setup materializes the `.sql` into an ephemeral `mcr.microsoft.com/mssql/server` Testcontainers instance
- AND WHEN `DBGRAPH_INTEGRATION` is not set the integration test is skipped with an explicit reason (the unit matrix never runs integration tests)

### Requirement: Golden-pinned RawCatalog and end-to-end pipeline

There SHALL be a deterministic golden test pinning the `RawCatalog` extracted from the torture schema:
the catalog MUST be serialized via the existing `stableStringify` and MUST be byte-identical across runs
(ADR-008). There SHALL ALSO be an end-to-end test driving the full pipeline — torture `.sql` →
materialize → adapter `extract` → `normalizeCatalog` → `SqliteGraphStore` upsert → query (`impact`,
`path`) — whose outputs are golden-pinned and byte-identical on re-run (US-027). The mssql CI job MUST
be gated, MUST NOT block the unit matrix, and MUST NOT touch the validation database.

Edge endpoint assertions MUST pin both source and destination qnames (L-009). Asserting only that an
edge exists (without its endpoints) is insufficient — a wrong-destination edge passes existence-only
assertions silently.

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

---

## Requirements Added by connectivity-strategies (2026-06-18)

> These requirements extend the SQL Server adapter with external-tool connectivity (integrated auth,
> sqlcmd, manual-dump). The existing tedious path (SQL auth / NTLM with explicit credentials) is UNCHANGED.
> `map.ts` is the equivalence anchor: native, sqlcmd and manual-dump paths all converge on the SAME
> `buildMssqlRawCatalog(input: MssqlRowInput, scope)`. Stories: US-027, US-031; ADR-004, ADR-006, ADR-008.

### Requirement: integrated auth mode selects an external-tool strategy

The mssql adapter SHALL accept an `integrated` authentication mode carrying NO `user`, `password` or
`domain`. In this mode the native tedious strategy MUST be SKIPPED (it cannot perform integrated
security, ADR-006) and an external-tool strategy (sqlcmd first) MUST be selected through the connectivity
registry (see `connectivity`). The existing explicit-credential SQL-auth and NTLM paths MUST remain
unchanged and continue to use the native tedious driver. Strategy selection MUST happen INSIDE the single
`createMssqlSchemaAdapter` factory — no second public export is added.

#### Scenario: Integrated config drives the sqlcmd strategy

- GIVEN an mssql config whose authentication mode is `integrated` (no user/password/domain)
- WHEN `createMssqlSchemaAdapter(config)` runs on a machine with `sqlcmd` available
- THEN the native tedious strategy is skipped and the sqlcmd strategy is selected
- AND the returned adapter satisfies the unchanged `SchemaAdapter` port

#### Scenario: Explicit-credential config still uses the native driver

- GIVEN an mssql config with SQL or NTLM explicit credentials
- WHEN `createMssqlSchemaAdapter(config)` runs
- THEN the native tedious strategy is selected as before (behaviour unchanged)
- AND no second public factory export is introduced

### Requirement: sqlcmd strategy reuses queries.ts and feeds the unchanged map.ts

The sqlcmd strategy SHALL run the EXISTING `queries.ts` catalog SELECTs, each wrapped in
`FOR JSON PATH`, by invoking `sqlcmd` with integrated auth and JSON-friendly flags
(`-E -S <server> -d <db> -y 0 -h -1 -W`) via `node:child_process` (no shell interpolation of untrusted
input). It MUST reassemble the `FOR JSON` output that SQL Server splits across multiple stdout lines into
a single JSON document BEFORE parsing, parse it to the EXACT `MssqlRowInput` row shapes (`TableRow`,
`ColumnRow`, …), VALIDATE/normalize those rows at the strategy boundary before `map.ts`, and feed the
UNCHANGED `buildMssqlRawCatalog`. The resulting `RawCatalog` MUST be IDENTICAL to the native path's for
the same schema (ADR-008). Malformed or unparseable output MUST be rejected (falling to the next strategy
with a logged reason), never cast blindly.

#### Scenario: sqlcmd output reassembled and parsed to typed rows

- GIVEN a `FOR JSON PATH` result that `sqlcmd` emits split across several stdout lines
- WHEN the sqlcmd strategy processes stdout
- THEN it reassembles all lines into one JSON document before `JSON.parse`
- AND it parses the document into the exact `MssqlRowInput` row shapes

#### Scenario: sqlcmd path yields a catalog identical to the native path

- GIVEN the same SQL Server schema reachable by both the native driver and `sqlcmd`
- WHEN each strategy extracts at the same scope and the rows feed `buildMssqlRawCatalog`
- THEN the sqlcmd `RawCatalog` is byte-identical to the native `RawCatalog` (ADR-008)

#### Scenario: Malformed sqlcmd output is rejected, not cast

- GIVEN `sqlcmd` stdout that is not valid JSON for the expected row shapes
- WHEN the sqlcmd strategy parses it
- THEN it rejects the output (the strategy falls through with a logged reason)
- AND it does NOT cast the malformed data into typed rows

### Requirement: manual-dump strategy ingests one combined JSON offline

dbgraph SHALL provide a manual-dump strategy for environments where no tool can connect for it directly.
dbgraph MUST EMIT a runnable dump script composed from the existing `queries.ts` constants wrapped in
`FOR JSON PATH`; the USER runs that script themselves (e.g. `sqlcmd -E` or SSMS) and produces ONE combined
JSON file shaped `{ "tables": [...], "columns": [...], ... }` matching `MssqlRowInput`. dbgraph MUST
ingest that single file from a GITIGNORED local directory, validate it to the typed row shapes, and feed
the UNCHANGED `buildMssqlRawCatalog`, yielding the SAME `RawCatalog`. The strategy MUST itself issue no
write; the emitted script MUST contain only catalog SELECTs; the output directory MUST be gitignored
(schema and procedure source are sensitive).

#### Scenario: Combined JSON dump ingests to the same RawCatalog

- GIVEN a combined JSON file matching `MssqlRowInput` in the gitignored dump directory
- WHEN the manual-dump strategy ingests it
- THEN it validates the rows and feeds `buildMssqlRawCatalog`
- AND the resulting `RawCatalog` matches the native path for the same schema (an anonymized recorded dump is the golden, ADR-008)

#### Scenario: Emitted dump script is read-only and output is gitignored

- GIVEN the dump script emitted by dbgraph from `queries.ts` + `FOR JSON PATH`
- WHEN the script is inspected
- THEN it contains only catalog `SELECT` statements (no write verb)
- AND the local directory holding the produced JSON is gitignored

### Requirement: Read-only reinforced across the new external paths

The sqlcmd and manual-dump strategies SHALL preserve the INVIOLABLE read-only guarantee: they issue ONLY
the existing catalog SELECTs (from `queries.ts`, wrapped in `FOR JSON`) and MUST NOT issue any
`INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL. Their source under `src/adapters/engines/mssql/strategies/` MUST
fall within the existing engines write-verb scanner scope and pass it. No SQL Server validation-database
codename may be written into any strategy, fixture, dump, or doc.

#### Scenario: Strategy SQL passes the write-verb scanner

- GIVEN the mssql strategy source under `src/adapters/engines/mssql/strategies/`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write verb in any strategy's SQL and the scan passes

#### Scenario: No codename leaks into strategy artifacts

- GIVEN the strategies, their fixtures, the recorded dump golden and any docs
- WHEN they are inspected
- THEN none contains the validation-database codename (dumps are anonymized; the output directory is gitignored)

---

## Requirements Added by dog1-calls-edges (2026-07-07)

> These requirements source `calls` edges from the SQL Server CATALOG: `SQL_MSSQL_DEPENDENCIES` gains a
> `LEFT JOIN sys.objects ref ON ref.object_id = dep.referenced_id` exposing `ref.type`, mapped via the
> existing `moduleTypeToKind` and carried end-to-end on `RawDependency.target.kind`. A routine-target
> dependency becomes a `calls` edge at `confidence: 'declared'`; the existing `reads_from`/`writes_to`
> edges STAY `parsed` (their access is body-derived; a call has none). NEW torture routines exercise the
> path. Stories: US-007, US-027.

### Requirement: Catalog-declared calls edges for routine invocations

The mssql adapter SHALL preserve the referenced object's KIND on `RawDependency.target.kind` by
joining `sys.objects` on `referenced_id` in `SQL_MSSQL_DEPENDENCIES` (`ref.type AS ref_object_type`),
threading it through `DepRow`, `map.ts` and `tokenizeModuleDeps` (which today drop it). When a
dependency's referenced object is a routine (`procedure` or `function`), the adapter MUST classify it
as a `calls` edge from the calling routine to the referenced routine with `confidence: 'declared'`
(the catalog establishes both identity and kind — no body parse). Dependencies to TABLES/VIEWS MUST
remain `reads_from`/`writes_to` at `confidence: 'parsed'`, UNCHANGED. A row with a NULL
`referenced_id` (unresolved / cross-database) MUST be skipped, never turned into a speculative edge.

#### Scenario: proc EXEC proc yields exactly one declared calls edge and no table stub

- GIVEN the torture procedure `dbo.usp_refresh_totals` whose body does `UPDATE dbo.order_totals ...` and `EXEC dbo.usp_log_change`, and the procedure `dbo.usp_log_change` whose body does `INSERT INTO dbo.audit_log ...`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `dbo.usp_refresh_totals` emits EXACTLY `{ calls dbo.usp_log_change (declared), writes_to dbo.order_totals (parsed) }`
- AND there is NO `reads_from`/`writes_to` edge to `dbo.usp_log_change` and NO `missing` `[table] usp_log_change` stub
- AND `dbo.usp_log_change` emits `{ writes_to dbo.audit_log (parsed) }` and ZERO `calls` edge

#### Scenario: function invoking a function yields a declared calls edge (target.kind = function)

- GIVEN the torture scalar function `dbo.fn_net_amount` whose body returns `dbo.fn_round_money(@x)`, and the scalar function `dbo.fn_round_money`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `dbo.fn_net_amount` emits EXACTLY one `calls dbo.fn_round_money` edge with `confidence: 'declared'`
- AND NO `reads_from`/`writes_to` edge and NO stub is created for `dbo.fn_round_money`

#### Scenario: routine touching only tables emits zero calls edges (negative)

- GIVEN an mssql procedure whose dependencies are only table reads and writes (e.g. an existing torture proc)
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN it emits its `reads_from`/`writes_to` edges as before and ZERO `calls` edge

### Requirement: mssql torture fixture exercises routine-calls-routine

The committed mssql torture `.sql` (`test/fixtures/mssql/`) SHALL add the routine-calls-routine
objects above — `dbo.usp_refresh_totals` (EXEC `dbo.usp_log_change`), `dbo.usp_log_change`,
`dbo.fn_net_amount` (calls `dbo.fn_round_money`), `dbo.fn_round_money`, and the supporting tables
`dbo.order_totals`/`dbo.audit_log` — using NEUTRAL names that leak no validation-database codename.
The golden-pinned `RawCatalog` and end-to-end impact/path goldens MUST be re-blessed DELIBERATELY to
include the new `calls` edges, with L-009 exact-set assertions (`src+dst+kind+confidence`, positives
AND the zero-stub negative). Every added edge assertion MUST pin BOTH endpoints; existence-only
assertions are insufficient.

#### Scenario: fixture adds the routine-calls-routine objects and re-blessed goldens pin the calls edges

- GIVEN the materialized mssql torture database with the new routine objects
- WHEN the adapter extracts it and the pipeline runs extract → normalize → upsert → query
- THEN the re-blessed `RawCatalog` and impact/path goldens contain the `calls` edges `dbo.usp_refresh_totals → dbo.usp_log_change` and `dbo.fn_net_amount → dbo.fn_round_money`, each `confidence: 'declared'`, with exact endpoints
- AND the graph contains ZERO phantom `[table]` stub for any routine, byte-identical on re-run (ADR-008)

---

## Requirements Added by dog2-routine-parameters (2026-07-07)

> These requirements source routine parameters from the SQL Server CATALOG via a new
> `SQL_MSSQL_PARAMETERS` query over `sys.parameters` joined to `sys.types` (FOR JSON PATH-compatible,
> per the existing `SQL_MSSQL_*` convention, and carried through the sqlcmd/manual-dump strategy paths),
> attaching them to each procedure/function `RawObject.parameters` with BARE catalog type names (matching
> the adapter's existing COLUMN `dataType`, e.g. `int`/`nvarchar`/`decimal`), `direction` from
> `is_output`, `ordinal` from `parameter_id`, and `hasDefault` from `has_default_value`; the
> `parameter_id = 0` FUNCTION RETURN row is EXCLUDED. Epic: deep-object-graph (DOG-2); ADR-004, ADR-008.

### Requirement: Extract routine parameters from sys.parameters

The mssql adapter SHALL source routine parameters via a new `SQL_MSSQL_PARAMETERS` query over
`sys.parameters` joined to `sys.types` (FOR JSON PATH-compatible, per the existing `SQL_MSSQL_*`
convention), attaching them to each procedure/function `RawObject.parameters`. For each parameter it
MUST capture `name` (verbatim, e.g. `@order_id`), `dataType` (the `sys.types` type NAME — BARE,
consistent with the adapter's existing COLUMN `dataType` which stores the bare catalog type name, e.g.
`int` / `nvarchar` / `decimal`, NOT `decimal(12,2)`), `direction` mapped from `is_output` (`0`→`in`,
`1`→`out`; SQL Server exposes no explicit INOUT in `sys.parameters`), `ordinal` from `parameter_id`,
and `hasDefault` from `has_default_value`. The FUNCTION RETURN row (`parameter_id = 0`, empty name)
MUST be EXCLUDED — it is not a parameter (the scalar return is already captured by `returns`). A
routine with no parameters MUST carry an empty parameters array.

#### Scenario: procedure parameters pinned exactly (usp_log_change)

- GIVEN the torture procedure `dbo.usp_log_change (@order_id int, @new_status nvarchar(20))`
- WHEN `extract(scope)` runs
- THEN its `parameters` are EXACTLY `[{name:"@order_id", dataType:"int", direction:"in", ordinal:1}, {name:"@new_status", dataType:"nvarchar", direction:"in", ordinal:2}]`
- AND no parameter carries `hasDefault: true` (none is defaulted)

#### Scenario: single-parameter procedure and scalar functions pinned exactly

- GIVEN `dbo.usp_refresh_totals (@order_id int)`, `dbo.fn_net_amount (@gross decimal(12,2))` and `dbo.fn_round_money (@amount decimal(12,2))`
- WHEN `extract(scope)` runs
- THEN `usp_refresh_totals.parameters` is EXACTLY `[{name:"@order_id", dataType:"int", direction:"in", ordinal:1}]`
- AND `fn_net_amount.parameters` is EXACTLY `[{name:"@gross", dataType:"decimal", direction:"in", ordinal:1}]` and `fn_round_money.parameters` is EXACTLY `[{name:"@amount", dataType:"decimal", direction:"in", ordinal:1}]`, each with the `parameter_id = 0` return row EXCLUDED

#### Scenario: mssql goldens gain parameters deliberately, scanner stays green

- GIVEN the mssql raw-catalog and e2e goldens
- WHEN parameters are added
- THEN the mssql goldens are re-blessed DELIBERATELY to carry the pinned `parameters` arrays; every other byte is unchanged
- AND the new `SQL_MSSQL_PARAMETERS` passes the engines write-verb scanner (catalog `SELECT` only)

---

## Requirements Added by dog3-column-lineage (2026-07-10)

> DOG-3 sources the per-view source-column SET from `sys.dm_sql_referenced_entities('<view>','OBJECT')` via a
> NATIVE-driver per-view loop (each call individually try/caught), plumbed through `map.ts` onto
> `RawDependency.columns`, and stamped by the normalizer as `attrs.dstColumns` on the EXISTING view→table
> `depends_on` edge (Model A — ZERO new edges). `SQL_MSSQL_DEPENDENCIES` stays UNCHANGED (object-grain deps).
> **Confidence flip (reconciler d — corrects the original D5 narrative):** the mssql view `depends_on` deps are
> emitted by the body tokenizer at `confidence: 'parsed'` (exactly like pg — they are NOT "already declared");
> a COVERED (view, table) pair FLIPS `parsed`→`declared` as it gains `attrs.dstColumns`. Uncovered / unbindable
> / whole-object `SELECT *` deps stay `parsed` object grain. **Live finding (2026-07-07):**
> `sys.sql_expression_dependencies.referenced_minor_id` = 0 (whole-object) for non-schemabound views — INERT —
> so the per-object TVF is the TRUTH source. **Column lineage is NATIVE-driver-only:** the sqlcmd/manual-dump
> strategies carry NO view-columns family (the single-SELECT-per-family contract, DOG-2), so mssql-via-sqlcmd/dump
> yields OBJECT GRAIN — the project's FIRST strategy-dependent coverage difference. SOURCE-COLUMN SET only —
> never an output mapping (ADR-007). Fixture anchor: `dbo.v_order_summary` (`test/fixtures/mssql/torture.sql`).
> Stories: US-027, US-007.

### Requirement: Declared consumed-column set stamped on view depends_on via dm_sql_referenced_entities (native path)

On the NATIVE driver path, the mssql adapter SHALL, for each view, call
`sys.dm_sql_referenced_entities('<view>','OBJECT')` in a per-view loop and, for each returned row that resolves a
referenced source COLUMN, thread that column onto `RawDependency.columns` (grouped per referenced object via
`map.ts`) so the normalizer stamps the sorted-unique set as `attrs.dstColumns` on the view→source-table
`depends_on` edge. Because that view `depends_on` dependency is first emitted at `confidence: 'parsed'` (body
tokenizer), a COVERED pair MUST FLIP `confidence: 'parsed'` → `'declared'` as it gains `attrs.dstColumns` (a
catalog-confirmed pair IS declared — mirroring pg; the edge is NEVER treated as "already declared"). The
`depends_on` edge is UNCHANGED in identity; it flips confidence and gains the set — NO separate per-column edge
is emitted. `SQL_MSSQL_DEPENDENCIES` is UNCHANGED; it keeps sourcing the object-grain view→table deps. EACH
`dm_sql_referenced_entities` call MUST be individually error-handled: an UNBINDABLE view (the TVF raises — a
source table/column was renamed or dropped) MUST be SKIPPED and its `depends_on` edge MUST stay `parsed` object
grain, and extraction MUST complete for the rest of the catalog (degrade-by-absence, never abort). A whole-object
reference that resolves NO source column (e.g. `SELECT *`) MUST NOT contribute a column — that dependency stays
`parsed` object grain (`attrs.dstColumns` unset). The emission is a SOURCE-COLUMN SET; the adapter MUST NOT
assert any output↔source mapping. A NULL/unresolved referenced object MUST be skipped, never turned into a
speculative column. Views MUST be iterated in a stable order so extraction is deterministic (ADR-008).

#### Scenario: v_order_summary emits its EXACT declared consumed-column set

- GIVEN the torture view `dbo.v_order_summary` selecting `o.order_id, o.customer_id, o.status, o.total_amount, COUNT(oi.product_id)` from `dbo.orders o` LEFT JOIN `dbo.order_items oi ON oi.order_id = o.order_id`, grouped by `o.order_id, o.customer_id, o.status, o.total_amount`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN the view→`dbo.orders` `depends_on` edge carries `attrs.dstColumns = [customer_id, order_id, status, total_amount]` and the view→`dbo.order_items` edge carries `attrs.dstColumns = [order_id, product_id]` (each sorted code-point ascending), both FLIPPED to `confidence: 'declared'`
- AND the observable consumed set is EXACTLY `{ dbo.orders.order_id, dbo.orders.customer_id, dbo.orders.status, dbo.orders.total_amount, dbo.order_items.order_id, dbo.order_items.product_id }`
- AND NO separate per-column `depends_on` edge and NO column-node target is emitted (Model A)

#### Scenario: Columns the view does NOT read are absent from dstColumns (negative, exact-set)

- GIVEN the same `dbo.v_order_summary`
- WHEN its `depends_on` edges are enumerated
- THEN `dbo.order_items.region_id`, `dbo.order_items.qty`, `dbo.orders.quantity` and `dbo.orders.unit_price` do NOT appear in any `attrs.dstColumns` (none is named in the view)
- AND there is NO `depends_on` edge to `dbo.products` or `dbo.regions` (unreferenced tables) carrying columns

#### Scenario: A computed source column is consumed as itself, not expanded (honesty)

- GIVEN `dbo.orders.total_amount` is a COMPUTED column `(quantity * unit_price)` that `dbo.v_order_summary` reads by name
- WHEN the view→`dbo.orders` `attrs.dstColumns` is pinned
- THEN it contains `total_amount` (the column the view names)
- AND it does NOT contain `quantity` or `unit_price` — expanding a computed column to its base columns is a DEEPER grain the catalog does not attribute to the view; it MUST NOT be fabricated

#### Scenario: An unbindable view is skipped and extraction completes (per-call resilience)

- GIVEN a view whose `sys.dm_sql_referenced_entities('<view>','OBJECT')` call RAISES (an unbindable view — a source table or column was renamed or dropped) alongside the bindable `dbo.v_order_summary`
- WHEN `extract(scope)` runs on the native driver path
- THEN the unbindable view's `depends_on` edges STAY `parsed` object grain (`attrs.dstColumns` unset, no flip), NO error propagates, and extraction COMPLETES
- AND `dbo.v_order_summary` still emits its EXACT declared consumed-column set — one unbindable view MUST NOT abort the whole family (degrade-by-absence; a set-based `CROSS APPLY` is rejected precisely because it would abort)

#### Scenario: Extraction via sqlcmd or manual dump yields object grain, byte-identical (strategy coverage difference)

- GIVEN the mssql catalog is extracted through the sqlcmd or manual-dump strategy (NOT the native driver)
- WHEN the catalog is normalized
- THEN the `dbo.v_order_summary` view→table `depends_on` edges carry NO `attrs.dstColumns` and stay `confidence: 'parsed'` (object grain) — the single-SELECT-per-family dump contract carries NO view-columns family
- AND those edges are BYTE-IDENTICAL to pre-DOG-3 (no `dstColumns`, no marker) and extraction raises NO error — this is the project's FIRST strategy-dependent coverage difference, stated plainly

### Requirement: mssql view-column goldens re-blessed deliberately with exact sets

The NATIVE-path golden-pinned `RawCatalog` and the end-to-end impact/path goldens MUST be re-blessed DELIBERATELY
so the `dbo.v_order_summary` view→table `depends_on` edges carry `attrs.dstColumns` AND flip to
`confidence: 'declared'`, with L-009 exact-set assertions: the edge endpoints, the sorted `attrs.dstColumns`
array, AND `confidence: 'declared'` pinned; the positive set AND the non-consumed negatives asserted; every
unrelated byte unchanged. The mssql DUMP golden (sqlcmd/manual-dump path) MUST STAY `parsed` object grain — its
view→table `depends_on` edges carry NO `attrs.dstColumns` and remain BYTE-IDENTICAL to pre-DOG-3 (the dump
family is NOT extended). The new `SQL_MSSQL_VIEW_REFERENCED_COLUMNS` query (`sys.dm_sql_referenced_entities`)
MUST pass the engines write-verb scanner (catalog `SELECT` only), as MUST the unchanged `SQL_MSSQL_DEPENDENCIES`.

#### Scenario: re-blessed goldens pin dstColumns, the flipped declared confidence, and stay scanner-green

- GIVEN the materialized mssql torture database extracted via the NATIVE driver (the `dm_sql_referenced_entities` per-view loop)
- WHEN the pipeline runs extract → `normalizeCatalog` → `SqliteGraphStore` upsert → query
- THEN the re-blessed native-path goldens carry the `dbo.v_order_summary` view→table `depends_on` edges with `attrs.dstColumns = [customer_id, order_id, status, total_amount]` (to `dbo.orders`) and `[order_id, product_id]` (to `dbo.order_items`), each FLIPPED to `confidence: 'declared'`, byte-identical on re-run (ADR-008)
- AND the mssql DUMP golden keeps those edges at `parsed` OBJECT grain (no `attrs.dstColumns`), byte-identical to pre-DOG-3
- AND both `SQL_MSSQL_VIEW_REFERENCED_COLUMNS` and `SQL_MSSQL_DEPENDENCIES` pass the engines write-verb scanner

---

## Requirements Added by shipped-artifact-fixes (2026-07-11)

> Bug 2 fix. Two NEW requirements — the interop-safe resolution contract and the dist-level
> verification tier. These sit alongside the existing "Missing mssql driver names the install command"
> requirement (both govern the ADR-006 dynamic `import('mssql')`), and do not modify it.

### Requirement: Optional mssql driver is resolved interop-safely across ESM and bundled CJS

The mssql adapter loads the optional `mssql` driver via a dynamic `import()` (ADR-006). Because the SHIPPED
artifact is a bundled CJS dist, `await import('mssql')` resolves under Node's CJS->ESM interop, which exposes
the CommonJS module ONLY under the namespace `.default` property. The native-tedious strategy MUST therefore
resolve `ConnectionPool` interop-safely — reading it from the module namespace OR from `.default` — matching
the existing pg / mysql2 / mongodb factory pattern. It MUST NOT destructure a named export directly off the
dynamic-import result, which yields `undefined` (and a `new undefined()` crash) in the bundled dist.

#### Scenario: ConnectionPool resolves when the driver arrives under `.default` (bundled-CJS shape)

- GIVEN the mssql module is provided in the bundled-CJS interop shape `{ default: { ConnectionPool } }`
- WHEN the native-tedious strategy loads the driver and builds a pool
- THEN it resolves `ConnectionPool` from `.default` and constructs a real pool (never `new undefined()`)

#### Scenario: ConnectionPool resolves when the driver exposes a top-level named export (ESM/vitest shape)

- GIVEN the mssql module exposes `ConnectionPool` at the namespace top level
- WHEN the strategy loads the driver
- THEN it resolves the same constructor without relying on `.default`

#### Scenario: Absent driver still names the install command (unchanged behavior)

- GIVEN the `mssql` package is not installed
- WHEN the strategy loads it via dynamic import
- THEN the raised `ConnectionError` message still contains the exact `npm i mssql` command

### Requirement: Live SQL Server connectivity is verified against the bundled dist, not vitest-loaded src

A gated integration test MUST exercise the BUNDLED `dist/index.cjs` `createMssqlSchemaAdapter` against a live
SQL Server container — NOT the vitest-loaded `src` — so that Node's real CJS->ESM interop is on the connection
path. This closes the masking class in which vitest lifts CommonJS named exports and hides a defect that only
manifests in the shipped artifact. The test MUST self-gate on `DBGRAPH_INTEGRATION=1` AND the presence of a
built `dist/`, skipping cleanly when either is absent so the default `npm test` gate is unaffected and remains
CI-independent (`dist/` is gitignored).

#### Scenario: Bundled dist connects live with SQL authentication

- GIVEN a running SQL Server container and a built `dist/index.cjs`
- WHEN `createMssqlSchemaAdapter(config)` from the DIST is invoked through real Node against the container with SQL auth
- THEN it establishes a usable connection and extracts a catalog (no `new undefined()` failure)

#### Scenario: Gate is skipped cleanly when the dist or Docker is absent

- GIVEN `DBGRAPH_INTEGRATION` is unset OR `dist/` has not been built
- WHEN the suite runs under the default `npm test`
- THEN the dist-level test is SKIPPED (never failing) and the suite floor of 3731 tests (incl. 4 skipped) holds

---

## Requirements Added by mssql-dynamic-sql-granularity (2026-07-11)

> Companion to the MODIFIED "Dynamic SQL is flagged, never guessed" requirement above: pins the
> deliberate golden re-bless that drops the resolved-call false positive on `dbo.usp_refresh_totals`
> while keeping the true positive on `dbo.sp_dynamic_search`, and freezes the sibling-engine goldens.
> Stories: US-007, US-027; ADR-007, ADR-008.

### Requirement: mssql goldens re-blessed to drop the resolved-call false positive

The mssql golden-pinned `RawCatalog` (`test/fixtures/mssql/golden/golden-raw-catalog.json`) and any
end-to-end / normalize golden that embeds the routine payload MUST be re-blessed DELIBERATELY so that
`dbo.usp_refresh_totals` NO LONGER carries `has_dynamic_sql: true`, while `dbo.sp_dynamic_search` KEEPS
`has_dynamic_sql: true`. The re-bless MUST be surgical: ONLY the false `has_dynamic_sql` on
resolved-call-only routines is removed; every other byte (edges, parameters, ordering) is unchanged and
byte-identical on re-run (ADR-008). The pg, mysql, sqlite and mongodb goldens MUST be BYTE-IDENTICAL to
before this change (they are not affected). The mssql live-tier suite MUST additionally assert a NEGATIVE
control: a resolved-call-only routine (`dbo.usp_refresh_totals`) has `has_dynamic_sql` absent/false, while
`dbo.sp_dynamic_search` remains flagged — both against the REAL materialized torture database.

#### Scenario: re-blessed mssql golden drops only the false flag, byte-identical otherwise

- GIVEN the materialized mssql torture database extracted at `full`
- WHEN the `RawCatalog` is serialized via `stableStringify`
- THEN `dbo.usp_refresh_totals` carries NO `has_dynamic_sql` key and `dbo.sp_dynamic_search` carries `has_dynamic_sql: true`
- AND every other byte of the golden is unchanged and byte-identical on a second extraction (ADR-008)

#### Scenario: sibling-engine goldens are untouched

- GIVEN the pg, mysql, sqlite and mongodb golden-raw-catalog files
- WHEN this change ships
- THEN each is BYTE-IDENTICAL to before (the fix is scoped to the mssql tokenizer only)
