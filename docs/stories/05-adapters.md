# E5 — Engine adapters

Goal: one adapter per engine implementing the `SchemaAdapter` port, tested against its real
"torture schema" in a container. References: §4.3, Phases 2, 3, 8, 9.
Rule common to ALL: catalog queries only (see E6/US-031); 100% JS driver, dynamically loaded.

**Common criteria (apply to US-026..030, not repeated):**
- The declared `CapabilityMatrix` matches what the engine actually supports.
- The engine's torture schema exercises EVERY supported object type and produces the expected golden file.
- If the npm driver is missing, the error states the exact command (`npm i <package>`).
- `fingerprint()` implemented with ONE cheap query.

---

### US-026 — SQLite adapter
**As** the project, **I want** the SQLite adapter first, **so that** the E2E pipeline is validated with zero infrastructure.
**Phase:** 2 · **Depends on:** US-006 · **Status:** ☑ done (phase-2-sqlite-extraction)

**Acceptance criteria:**
- Extracts tables/columns (PRAGMA `table_info`), FKs (`foreign_key_list`), indexes (`index_list`), views and triggers from `sqlite_master`. ✓
- Works with `better-sqlite3` and with the `node:sqlite` fallback (same result, tested against both — parity test runs on Node 22.19). ✓
- Zero containers: the fixture is a committable `.sql` DDL script (supersedes the `.db` file criterion — a
  reviewable text script satisfies the requirement better than a binary blob). ✓

_Note: fixture format superseded — committed as `test/fixtures/sqlite/torture.sql` (plain DDL text)
rather than a `.db` binary. The spec originally stated a `.db` file; a DDL script is strictly
better (reviewable diffs, deterministic materialization per-run). The acceptance criterion is satisfied._

### US-027 — SQL Server adapter
**As** an enterprise user, **I want** full SQL Server catalog extraction, **so that** dbgraph is validated against a real enterprise database.
**Phase:** 3 · **Depends on:** US-026, US-007 · **Status:** ☑ done (phase-3-sqlserver-adapter)

**Acceptance criteria:**
- Extracts: tables/columns/types/defaults/computed, PK/FK/unique/check, indexes (clustered/filtered/included), views, procs, functions (scalar/TVF), triggers with event, sequences, extended properties (`MS_Description`). ✓
- `sys.sql_expression_dependencies` → reads/writes classification from the body (US-007) with `confidence: parsed`; `hasDynamicSql: true` when sp_executesql detected. ✓
- Supports SQL auth and NTLM (Windows auth); Kerberos SSO unsupported (documented, fast-fail ConnectionError). ✓
- Integration against `mcr.microsoft.com/mssql/server:2022-latest` in Testcontainers with the T-SQL torture schema (39/39 integration tests pass). ✓
- `docs/permissions/mssql.md` with the minimal read-only login script (`VIEW DEFINITION` + `CONNECT`, no `db_datareader`). ✓

_Note: sys.sql_expression_dependencies does not reliably report DML targets inside trigger bodies on SQL Server 2022 (known open question in design). The fires_on edge (from trigger metadata) is the canonical assertion; writes_to from trigger bodies is best-effort._

### US-028 — PostgreSQL adapter
**Phase:** 8 · **Depends on:** US-027 (patterns established) · **Status:** ☐ partial (phase-8a-pg)

**Acceptance criteria:**
- Extracts the common set plus: materialized views (emitted as `kind:'view'` + `extra.materialized:true` — no new `NodeKind`), sequences, comments (`obj_description` / `col_description`), identity and generated columns, partial/expression/`INCLUDE` indexes. Custom types/enums and RLS policies deferred (post phase-8a-pg).
- Dependencies classified via `pg_get_functiondef` / `pg_get_viewdef` body tokenization at `confidence:'parsed'`; `supportsDependencyHints:false` (body tokenizer is the sole edge source, not `pg_depend`); `pg_depend`-based dependency hints deferred.
- Functions and triggers fully extracted (incl. `CREATE TRIGGER … EXECUTE FUNCTION`); trigger `fires_on` targets the parent table with decoded timing+events from `tgtype` bitmask.
- `docs/permissions/pg.md` with the minimal read-only role (`CONNECT` + `USAGE` + world-readable catalogs). ☑ done (phase-8a-pg)
- Integration-tested against `postgres:16` Testcontainers with a torture DDL fixture (Batch 7).

_Note: `pg_depend`-based dependency hints (`supportsDependencyHints:true`) deferred to a future phase. The body tokenizer (`confidence:'parsed'`) is the edge source for phase-8a-pg. Materialized views are intentionally modelled as `{kind:'view', extra:{materialized:true}}` to avoid core-model churn; a first-class `materialized_view` NodeKind is deferred._

### US-028a — Shared body-tokenizer primitives
**Phase:** 8 · **Depends on:** US-027 · **Status:** ☑ done (phase-8a-pg)

**Acceptance criteria:**
- `canonicalizeQName`, `classifyAccess`, `extractWriteTargets`, and `WRITE_VERB_PATTERNS` factored into `src/adapters/engines/_shared/tokenizer-core.ts`. ✓
- `classifyAccess` accepts a dialect canonicalizer as an injected parameter (`canon?: (s: string) => string`), defaulting to `canonicalizeQName` so existing MSSQL callers are unchanged. ✓
- MSSQL golden (`test/fixtures/mssql/dumps/mssql-dump-golden.json`) stays byte-identical after the refactor (ADR-008). ✓
- PG tokenizer (`pg/tokenizer.ts`) wires the shared primitives with a PG-specific canonicalizer (double-quote stripping only, no square brackets). ✓

### US-028b — Materialized view as view with `extra.materialized`
**Phase:** 8 · **Depends on:** US-028 · **Status:** ☑ done (phase-8a-pg)

**Acceptance criteria:**
- PostgreSQL materialized views extracted as `{ kind: 'view', extra: { materialized: true } }` — no new `NodeKind` added to the core model. ✓
- `pg_matviews` + `pg_class.relkind = 'm'` used as the source; body retrieved via `pg_get_viewdef`. ✓
- Queries and map verified against captured `pg_catalog` JSON row fixtures (pure unit, no DB). ✓

### US-029 — MySQL adapter (Phase 8b)
**Phase:** 8b · **Depends on:** US-027, US-028a (shared tokenizer) · **Status:** ☐ partial (phase-8b-mysql — Batches 1-6 done; Batch 7 integration/E2E pending)

> **Refined for `phase-8b-mysql`.** Scope is MySQL **8 ONLY** (`mysql:8` Testcontainers, `mysql2` driver).
> MariaDB (real `SEQUENCE` objects, behavioural forks) and MySQL `EVENT` objects are DEFERRED to the
> pre-planned `phase-8c` follow-up. The shared `_shared/tokenizer-core.ts` is consumed UNCHANGED
> (no tokenizer-extraction batch).
>
> **Locked decisions (phase-8b-mysql):**
> - `schema == database`: `TABLE_SCHEMA` (the connected database) is the sole namespace; NO `schema?` config knob.
> - `AUTO_INCREMENT` is a **column attribute** (`COLUMNS.EXTRA LIKE '%auto_increment%'`), never a sequence node — `MYSQL_CAPABILITIES` has no `sequence` and no standalone `schema` kind.
> - CHECK constraints via `CHECK_CONSTRAINTS` (MySQL 8.0.16+); floor documented.
> - `VIEW_DEFINITION` is the server-reparsed/normalized body (may be truncated by the server's internal limit); `SHOW CREATE VIEW` is NOT used (it is not a catalog SELECT).
> - Routine bodies via `ROUTINES.ROUTINE_DEFINITION`.
> - Body tokenizer at `confidence:'parsed'` with presence gate (phantom-free; no default-to-read; no self-edges — phase-8a CRITICAL-1 designed out); `supportsDependencyHints:false`.
> - `PREPARE`/`EXECUTE` → `hasDynamicSql:true`; non-dynamic bodies are NOT flagged.
> - MySQL `EVENT` objects are out of scope for this phase.
> - MariaDB sequences and fork behaviour → `phase-8c`.
> - `docs/permissions/mysql.md` ships the minimal read-only user (catalog SELECTs only, no user-table data access).

**Acceptance criteria:**
- `schema == database`: every catalog query is filtered `TABLE_SCHEMA = DATABASE()`; each object carries the connected database as its schema; `RawCatalog.schemas` is that one database; NO `schema?` config knob. ☑ (Batch 2/4)
- Extracts the common set: tables/columns/types/nullability/defaults; `AUTO_INCREMENT` surfaced ON THE COLUMN via `COLUMNS.EXTRA` (NO sequence node — `MYSQL_CAPABILITIES` has no `sequence` and no standalone `schema` kind); PK/FK (incl. composite, ordered)/unique/CHECK (CHECK via `CHECK_CONSTRAINTS`, MySQL 8.0.16+); indexes from `STATISTICS` (uniqueness via `NON_UNIQUE`, composite via `SEQ_IN_INDEX`); triggers (event + timing); `TABLE_COMMENT`/`COLUMN_COMMENT`. ☑ (Batch 4)
- View bodies via `VIEWS.VIEW_DEFINITION` (reparsed/possibly-truncated form documented, NO `SHOW CREATE VIEW`); routine bodies (functions + procedures) via `ROUTINES.ROUTINE_DEFINITION`; `supportsBodies: true`. ☑ (Batch 4)
- `reads_from`/`writes_to` classified via the SHARED body tokenizer at `confidence: parsed`; `supportsDependencyHints: false` (no MySQL dependency view — body tokenizer is the sole edge source). Emission is PHANTOM-FREE and presence-gated (edge ONLY for an object whose name appears in the dynamic-string-MASKED static body; never default-to-read; never a self-reference — carries the phase-8a CRITICAL-1 remediation). `PREPARE`/`EXECUTE` → `hasDynamicSql: true`; a non-dynamic body is NOT flagged. ☑ (Batch 4)
- `fingerprint()`: ONE cheap query whose marker MOVES on DDL INCLUDING `ADD COLUMN` (combines `TABLES` + `COLUMNS` + `ROUTINES` markers over `DATABASE()`, SHA-256) and is STABLE on data-only DML. ☑ (Batch 4)
- Connectivity via host/port (3306)/database/user/password (+ optional ssl); `password` is `${env:VAR}` env-only; absent `mysql2` raises `ConnectionError('npm i mysql2')`. ☑ (Batch 2/3)
- Read-only by construction: catalog SELECTs only (write-verb scanner stays green); NO `SET TRANSACTION READ ONLY`; `docs/permissions/mysql.md` with the minimal read-only user; a missing privilege raises an actionable `PermissionError` naming the privilege + doc. ☑ (Batches 3/4/6)
- Determinism (ADR-008): golden-pinned `RawCatalog` (zero sequence objects); gated `mysql:8` Testcontainers E2E (`DBGRAPH_INTEGRATION=1`, never blocks the unit matrix) pinning exact edge counts AND endpoints, `stubCount: 0`, no self-reference. ☐ pending (Batch 7)

_Note: original US-029 stated "MySQL 8 AND MariaDB LTS (CI matrix)" + "events". REFINED here: MySQL-8-only; MariaDB sequences/forks and MySQL `EVENT` objects → pre-planned `phase-8c`. `mysql2` is a PRE-APPROVED `optionalDependency` (ADR-002/006), lazy `import('mysql2/promise')`._

### US-030 — MongoDB adapter + structural sampling
**As** a NoSQL user, **I want** an inferred schema of my collections WITHOUT persisting values, **so that** the AI knows the structure with zero data risk.
**Phase:** 9 · **Depends on:** US-008 · **Status:** ☐ pending

**Acceptance criteria:**
- Extracts collections, indexes (`getIndexes`), `$jsonSchema` validation rules when present.
- Sampling via `$sample` (default 100 docs, configurable): infers fields with observed types and frequency (`email: string 100%, age: int 87%`); VALUES are never written to the index (a test verifies no fixture values appear in the resulting .db).
- Nested fields and arrays represented as paths (`address.city`, `items[].sku`).
- Relationships ONLY via `inferred_reference` (US-008) over field names like `customer_id`/Mongo refs.
