# Proposal: Phase 8b — MySQL Schema Extraction Adapter

> **SCOPE SPLIT — MySQL on `mysql:8` ONLY.** This is the SECOND half of the original Phase-8 "Núcleo 5"
> engine work; `phase-8a-pg` shipped and is ARCHIVED. MySQL mirrors the PostgreSQL adapter ALMOST exactly.
> The architecture is SETTLED and is NOT re-litigated here: SQLite-shape thin adapter + a single duck-typed
> read-only driver seam with the lazy `import('mysql2/promise')` collapsed into `factory.ts` (NEVER a
> `strategies/` tree — that is SQL-Server-only). `_shared/tokenizer-core.ts` ALREADY EXISTS (shipped in 8a)
> and is REUSED — there is NO tokenizer-extraction batch. MariaDB-specific behaviour (real `SEQUENCE`
> objects) is OUT of scope, noted as a future `phase-8c`.

## Intent

`phase-8a-pg` delivered the THIRD `SchemaAdapter` (PostgreSQL), proved the 6 dialect touch points, the
gated-Testcontainers pattern and the per-engine permission doc, and — critically — its verify cycle exposed a
PHANTOM-EDGE defect (CRITICAL-1: a `supportsDependencyHints:false` body-tokenizer path that defaulted every
candidate to a `reads_from` edge and self-referenced). MySQL is the dominant open-source RDBMS and the next
Core-5 engine (ADR-002). We need the FOURTH concrete adapter — implementing the EXISTING `SchemaAdapter` port
UNCHANGED — by mirroring the proven `pg/` template one-for-one, with the MySQL deltas below. Going SECOND, we
DESIGN OUT the 8a lessons from day one: the presence-gated edge emission, dynamic-SQL masking, exact negative
assertions, scanner-safe JSDoc, and a DDL-sensitive `fingerprint()`.

Success = Testcontainers E2E green against a `mysql:8` torture schema with 100% MySQL capability-matrix
coverage; `reads_from`/`writes_to` classified from `INFORMATION_SCHEMA` view/routine bodies at
`confidence: parsed` with ZERO phantom/self edges (exact-set assertions); deterministic golden-pinned
`RawCatalog`; the write-verb engines scanner staying green; NO new runtime dep beyond the PRE-APPROVED
optional `mysql2`; and a gated `mysql-integration` CI job that never blocks the unit matrix.

## Scope

### In Scope
1. **`MysqlSchemaAdapter`** under `src/adapters/engines/mysql/` implementing the EXISTING `SchemaAdapter`
   port, mirroring `pg/` file-for-file: `capabilities.ts`, `queries.ts` (catalog SELECTs), `map.ts` (rows →
   `RawObject`/`RawCatalog`), `driver.ts` (a `MysqlReadonlyDriver` seam over a duck-typed `ConnectionLike`),
   `error-mapper.ts` (`mysql2` error code → typed `ConnectionError`/`PermissionError`), `tokenizer.ts` (MySQL
   `hasDynamicSql` wiring `_shared/`), `factory.ts` (`createMysqlSchemaAdapter` — the ONLY join point, lazy
   `import('mysql2/promise' as string)`), and the adapter class. Extracts: the connected database AS the
   schema; tables/columns/types/nullability/defaults; `AUTO_INCREMENT` surfaced via `COLUMNS.EXTRA` ON THE
   COLUMN (NOT a sequence node); PK/FK (incl. composite, ordered)/unique/CHECK constraints (CHECK via
   `CHECK_CONSTRAINTS`, MySQL 8.0.16+); indexes; views (body from `VIEWS.VIEW_DEFINITION`); procedures and
   functions (bodies from `ROUTINES.ROUTINE_DEFINITION`); triggers (event+timing); `COLUMN_COMMENT`/table
   comments. Sources: `information_schema.{SCHEMATA,TABLES,COLUMNS,STATISTICS,KEY_COLUMN_USAGE,
   TABLE_CONSTRAINTS,CHECK_CONSTRAINTS,VIEWS,ROUTINES,TRIGGERS}`, all filtered `TABLE_SCHEMA = DATABASE()`.
2. **`schema == database`** — MySQL has no schema-vs-database distinction. Map `TABLE_SCHEMA` (the database)
   → `RawObject.schema`; `RawCatalog.schemas = [the connected database]`; filter every query on
   `= DATABASE()`. There is NO `schema?` config knob (the database IS the scope).
3. **`reads_from`/`writes_to` classification** from view/routine bodies via the SHARED
   `_shared/tokenizer-core.ts` at `confidence: 'parsed'`. `supportsDependencyHints: false` — MySQL has NO
   `information_schema` dependency view, so the body tokenizer is the SOLE edge source. MySQL `hasDynamicSql`
   pattern = `PREPARE`/`EXECUTE`.
4. **Phantom-edge prevention (carries 8a CRITICAL-1)** — the MySQL tokenizer path MUST (a) MASK dynamic-SQL
   string-literal contents BEFORE extracting references, and (b) emit a `reads_from`/`writes_to` edge ONLY for
   an object whose name appears in the masked STATIC body (presence gate) — NEVER default-to-read for all
   candidates, NEVER self-reference. Reuse 8a's `maskDynamicStrings` + `bodyContainsRef`.
5. **Config types** — add `MysqlAdapterConfig` to the `SchemaAdapterConfig` union
   (`src/core/ports/schema-adapter.ts`) and `MysqlSource` to the config schema. Flat connectivity:
   `host`/`port` (default 3306)/`database`/`user`/`password` + optional `ssl`. `password` is `${env:VAR}`
   ENV-ONLY (reuse `parsePgSource`'s rejection pattern). NO `schema?` (database = scope).
6. **The dialect touch points** (4th dialect — verified against post-8a code):
   - `src/core/ports/schema-adapter.ts` — add `MysqlAdapterConfig` to the union.
   - `src/infra/config/schema.ts` — add `'mysql'` to `SUPPORTED_DIALECTS` (now `['sqlite','mssql','pg']`) +
     `MysqlSource` + the `mysql` `DbgraphConfig` member.
   - `src/infra/config/parse-config.ts` — add `parseMysqlSource` + `case 'mysql'`.
   - `src/infra/open-connections.ts` — wire `createMysqlSchemaAdapter` into `AdapterAndStore` + the
     `dialect === 'mysql'` dispatch branch (dispatch keys on the EXPLICIT `dialect`, NOT structural shape).
   - `src/index.ts` — `case 'mysql'` in `capabilitiesFor()` + re-export `MYSQL_CAPABILITIES`.
   - `src/core/errors.ts` — `UnsupportedDialectError` message → `sqlite, mssql, pg, mysql`; update its pinned
     assertion AND keep the `exit-code.ts` `instanceof` guard returning code 4 (regression assertion, no code
     change there).
7. **`MYSQL_CAPABILITIES`** — truthful matrix: supports table, column, constraint, index, view, procedure,
   function, trigger. NO `sequence`; NO standalone `schema` kind (handled as the database).
   `supportsBodies: true`; `supportsDependencyHints: false`.
8. **Read-only by construction** — a MINIMAL-PRIVILEGE MySQL user documented in `docs/permissions/mysql.md`
   (NOT a session flag — no `SET TRANSACTION READ ONLY`). The write-verb engines scanner over
   `src/adapters/engines/**` MUST stay green (catalog SELECTs only).
9. **`fingerprint()`** — ONE cheap query whose marker moves on DDL INCLUDING `ADD COLUMN` and is stable on
   DML (8a learned a bare object-count/id marker misses add-column). Combine a `TABLES`+`COLUMNS` change
   marker over `DATABASE()` (e.g. counts + a column-level marker), SHA-256 hashed.
10. **Gated Testcontainers integration** — `mysql:8` + a committed `test/fixtures/mysql/torture.sql` → golden
    `RawCatalog`; full E2E extract → `normalizeCatalog` → `SqliteGraphStore` → query. A gated
    `mysql-integration` CI job (`DBGRAPH_INTEGRATION=1`), never blocking the unit matrix.
11. **`mysql2` as `optionalDependency`** (ADR-002/006 — PRE-APPROVED on the closed driver list), lazy dynamic
    `import('mysql2/promise' as string)`; `execute()` returns `[rows, fields]`. `testcontainers` already a dev
    dep.

### Out of Scope (explicit — NOT carry-over)
- **MariaDB** and its real `SEQUENCE` objects / behavioural forks — deferred to a future `phase-8c-mariadb`.
- **PostgreSQL** — the archived `phase-8a-pg` change (its own complications).
- **`SHOW CREATE VIEW`** — NOT used (not a plain catalog SELECT; would break the write-verb scanner).
  View bodies come from `VIEWS.VIEW_DEFINITION` only.
- **MySQL `EVENT` objects** — not in the truthful matrix below; deferred (no existing `NodeKind`).
- **Inferred relationships** (`inferred_reference`) — Phase 9 (US-008/US-030).
- **`_shared/` tokenizer extraction** — already done in 8a; consumed as-is.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim. MySQL mirrors the
> `pg-extraction` precedent.

### New Capabilities
- `mysql-extraction`: the MySQL adapter's concrete behaviour — catalog objects extracted from
  `information_schema` (filtered `= DATABASE()`); `schema == database`; `AUTO_INCREMENT` on the column (no
  sequence node); CHECK via `CHECK_CONSTRAINTS`; view bodies from `VIEW_DEFINITION` (document the
  reparsed/normalized + truncation caveat) and routine bodies from `ROUTINE_DEFINITION` (`supportsBodies:
  true`); truthful `MYSQL_CAPABILITIES` (no sequence); parsed reads/writes via the SHARED tokenizer with
  PHANTOM-FREE presence-gated emission and `PREPARE`/`EXECUTE` → `hasDynamicSql` (`supportsDependencyHints:
  false`); DDL-sensitive `fingerprint()`; host/port/user/password (+ssl) connectivity; the minimal-privilege
  user + `docs/permissions/mysql.md` + actionable `PermissionError`; the gated `mysql:8` Testcontainers
  golden-pinned E2E + `mysql-integration` CI job.

### Modified Capabilities
- `schema-extraction` (the engine-agnostic port spec): a SMALL DELTA only — record that
  `SchemaAdapterConfig`, `SUPPORTED_DIALECTS`, `capabilitiesFor` and the `UnsupportedDialectError` message now
  include `mysql`, and RESOLVE the config-discriminator wrinkle (below). The port SHAPE is UNCHANGED.
- `graph-model`, `graph-normalization`, `graph-storage`, `graph-query`: UNCHANGED — consumed as-is.

## Approach

Mirror the `pg/` hexagonal template (ADR-004) one-for-one. The adapter lives under
`src/adapters/engines/mysql/`, talks ONLY to a `MysqlReadonlyDriver` seam, and `createMysqlSchemaAdapter` is
the ONLY join point — lazy `import('mysql2/promise' as string)`, connect, map errors, wrap. `mysql2`'s
`execute()` returns `[rows, fields]`; the driver normalizes to `{ rows }` (vs pg's `result.rows`). Catalog
`information_schema` SELECTs (all `WHERE TABLE_SCHEMA = DATABASE()`, all `ORDER BY` for ADR-008) map to a
DETERMINISTIC, sorted `RawCatalog` (`engine: 'mysql'`), golden-pinned. View bodies come from
`VIEW_DEFINITION` (a real SELECT → write-verb scanner stays green); routine bodies from `ROUTINE_DEFINITION`.
The SHARED `_shared/tokenizer-core.ts` classifies each STATIC body reference as read/write at
`confidence: 'parsed'` — gated by `bodyContainsRef` over the dynamic-string-MASKED body, so NO phantom and NO
self edges are emitted (8a CRITICAL-1 designed out); `PREPARE`/`EXECUTE` sets `hasDynamicSql: true`. Because
`supportsDependencyHints: false`, the tokenizer is the SOLE edge source. `AUTO_INCREMENT` rides the column via
`COLUMNS.EXTRA`; there is NO sequence node. Read-only posture = the minimal-privilege user in
`docs/permissions/mysql.md` plus the write-verb scanner. Integration-first per `dbgraph-testing` (NEVER mock
`mysql2`): pure mappers/tokenizer/error-mapper unit-tested with captured-row fixtures; live behaviour tested
against `mysql:8` Testcontainers behind `DBGRAPH_INTEGRATION=1`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/mysql/` | New | `capabilities.ts`, `queries.ts`, `map.ts`, `driver.ts`, `error-mapper.ts`, `tokenizer.ts`, `factory.ts` (lazy `import('mysql2/promise')`), adapter class — mirrors `pg/` |
| `src/adapters/engines/_shared/tokenizer-core.ts` | Unchanged | REUSED as-is (no behaviour change; see design wrinkle re: promoting `maskDynamicStrings`/`bodyContainsRef`) |
| `src/core/ports/schema-adapter.ts` | Modified | Add `MysqlAdapterConfig` to the union; FIX the now-stale "discriminated by `host`" JSDoc (both pg and mysql have `host`) |
| `src/infra/config/schema.ts` | Modified | `'mysql'` into `SUPPORTED_DIALECTS`; add `MysqlSource`; add the `mysql` `DbgraphConfig` member |
| `src/infra/config/parse-config.ts` | Modified | `parseMysqlSource` (host/port/database/user/password env-only + optional ssl) + `case 'mysql'` |
| `src/infra/open-connections.ts` | Modified | Wire `createMysqlSchemaAdapter` into `AdapterAndStore` + the `dialect === 'mysql'` dispatch branch |
| `src/index.ts` | Modified | `case 'mysql'` in `capabilitiesFor()`; re-export `createMysqlSchemaAdapter` + `MYSQL_CAPABILITIES` |
| `src/core/errors.ts` | Modified | `UnsupportedDialectError` message → `sqlite, mssql, pg, mysql` |
| `src/cli/exit-code.ts` | Unchanged | Maps via `instanceof` (code 4); add a regression assertion only — NO code change |
| `docs/permissions/mysql.md` | New | Minimal read-only user (catalog reads only; no `db_datareader`-equivalent broad grant) |
| `test/fixtures/mysql/torture.sql` | New | MySQL torture schema (AUTO_INCREMENT col / CHECK / composite FK / view / routine writing two tables reading a third / dynamic `PREPARE`/`EXECUTE` routine / trigger / comments) |
| `test/` integration + e2e | New | Testcontainers `mysql:8` extract → golden `RawCatalog`; full E2E to query (gated `DBGRAPH_INTEGRATION=1`) |
| `package.json` | Modified | `mysql2` as `optionalDependency` (ADR-002/006, pre-approved) |
| `.github/workflows/` | Modified | Gated `mysql-integration` job (never blocks the unit matrix) |
| `docs/stories/05-adapters.md` | Modified | Refine US-029 to encode the locked decisions (mirrors how US-028 was refined) |

## User Stories — refine E5 / US-029 (for the spec phase to finalize scenarios)

> US-029 (MySQL/MariaDB adapter, Phase 8) ALREADY EXISTS (`docs/stories/05-adapters.md`, status `☐ pending`).
> It currently lists "MySQL 8 AND MariaDB LTS (CI matrix)" + "events" — which CONTRADICTS the locked scope.
> This change REFINES US-029 to MySQL-`8`-ONLY and encodes the locked decisions; the spec phase writes the
> acceptance scenarios.

- **US-029 (refined) — MySQL adapter (Phase 8b).** Scope narrowed to MySQL on `mysql:8` ONLY (MariaDB
  sequences/forks → `phase-8c`). Encode: `schema == database` (`TABLE_SCHEMA = DATABASE()`); `AUTO_INCREMENT`
  surfaced via `COLUMNS.EXTRA` on the column (NO sequence node, `MYSQL_CAPABILITIES` has no `sequence`); CHECK
  via `CHECK_CONSTRAINTS` (8.0.16+); view bodies via `VIEW_DEFINITION` (reparsed/truncation caveat
  documented, NO `SHOW CREATE VIEW`); routine bodies via `ROUTINE_DEFINITION` (`supportsBodies: true`); edges
  via the SHARED body tokenizer with PHANTOM-FREE presence-gated emission (`confidence: parsed`,
  `supportsDependencyHints: false`); `PREPARE`/`EXECUTE` → `hasDynamicSql`; `docs/permissions/mysql.md`
  minimal read-only user; `host/port/database/user/password` (+ssl) connectivity. EVENTS are OUT of scope.
  **Depends on:** US-027, US-028a (shared tokenizer). **Status:** ☐ pending.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Phantom/self edges** re-introduced (the 8a CRITICAL-1) because `supportsDependencyHints:false` | High | DESIGN IT OUT from day one: presence-gated emission (`bodyContainsRef` over the dynamic-string-MASKED body), NO default-to-read, NO self-reference; EXACT-set negative assertions (toEqual dep sets, toBe(N) counts, explicit no-self/no-phantom) — NOT existence-only `find().toBeDefined()` |
| `VIEW_DEFINITION` stores the REPARSED/normalized body (and may TRUNCATE) → tokenizer reads a rewritten form | Med | Document the caveat in the spec + `mysql-extraction`; the tokenizer is presence-gated so a normalized body still resolves real referenced names; golden pins the actual `mysql:8` output (caveat is honest, not a defect) |
| **Config-discriminator wrinkle** — `PgAdapterConfig` JSDoc claims it is "distinguished by `host`", but `MysqlAdapterConfig` ALSO has `host` → the structural `SchemaAdapterConfig` union can no longer narrow Pg vs Mysql by shape | Med | VERIFIED: runtime dispatch in `parse-config.ts` and `open-connections.ts` keys on the EXPLICIT `dialect` field, NOT structural shape — so it is SAFE at runtime. Design phase MUST (a) FIX the stale `host` JSDoc and (b) decide whether to add an explicit discriminant to the union or document that the union is intentionally non-discriminable (each factory takes its concrete type). Do NOT leave ambiguous |
| CHECK constraints absent below MySQL 8.0.16 | Low | Scope is `mysql:8` (has `CHECK_CONSTRAINTS`); the matrix declares CHECK supported; document the 8.0.16+ floor; the torture fixture pins a CHECK |
| `AUTO_INCREMENT` mis-modelled as a sequence (PG habit) | Med | DECISION locked: surface via `COLUMNS.EXTRA` on the column; `MYSQL_CAPABILITIES` has NO `sequence`; golden asserts no sequence object and the column carries the auto-increment flag |
| **Scanner fragility** — apostrophes/double-quotes in `engines/**` JSDoc create false literal spans (US-031 `extractStringLiterals`) | Med | Do NOT put apostrophes or quoted examples in JSDoc of `engines/mysql/**`; reuse 8a's `String.fromCharCode`-style trick if a quote char is unavoidable in a regex; write-verb scanner re-run in the test batch |
| `fingerprint()` misses `ADD COLUMN` (8a learned a bare id/count marker is insufficient) | Med | Marker combines a `TABLES`+`COLUMNS`-level change signal over `DATABASE()` (counts + a column marker), SHA-256 hashed; torture/integration asserts the fp MOVES on `ADD COLUMN` and is STABLE on `INSERT` |
| The PINNED `UnsupportedDialectError` test breaks when the message changes | High | Treat the message as a contract: update the message AND its pinned assertion in the SAME batch; add a regression assertion that `exitCodeFor(UnsupportedDialectError)` still returns 4 (no `exit-code.ts` code change) |
| `mysql2` driver SSL/auth surface | Low | Flat `host/port/database/user/password` + `ssl`; `error-mapper.ts` maps `mysql2` codes (e.g. `ER_ACCESS_DENIED_ERROR`/`ER_DBACCESS_DENIED_ERROR` → typed errors); `MODULE_NOT_FOUND` → `ConnectionError('npm i mysql2')` |
| Testcontainers needs Docker (some contributors lack it) | Med | Gate behind `DBGRAPH_INTEGRATION=1`; skip-with-reason locally; the `mysql-integration` CI job never blocks the unit matrix (proven 8a/Phase-3 pattern) |

## Rollback Plan

Fully additive — no Phase 1/2/3/8a contract changes; `_shared/tokenizer-core.ts` is consumed UNCHANGED.
Revert by deleting `src/adapters/engines/mysql/`, removing the `mysql` entries from the dialect touch points
(`SchemaAdapterConfig` union, `SUPPORTED_DIALECTS`, `parse-config.ts` branch, `open-connections.ts` wiring,
`capabilitiesFor`/barrel, `UnsupportedDialectError` message — and reverting the `host` JSDoc fix), deleting
`docs/permissions/mysql.md`, the MySQL fixtures/tests and the `mysql-integration` CI job, and dropping the
`mysql2` `optionalDependency`. Existing core, storage, normalization, query, and the SQLite/MSSQL/PG adapters
remain untouched and green.

## Dependencies

- `mysql2` — `optionalDependency`, lazy dynamic `import('mysql2/promise' as string)` (ADR-006); PRE-APPROVED
  on the ADR-002/006 closed driver list; installing it is part of this change. NO other new runtime deps.
- `testcontainers` — `devDependency`, already present.
- Builds on the ARCHIVED `phase-8a-pg` template: the `pg/` adapter structure (file-for-file), the SHARED
  `_shared/tokenizer-core.ts` (consumed UNCHANGED, incl. `maskDynamicStrings`/`bodyContainsRef`), the
  per-engine permission-doc pattern, and the gated-integration CI pattern.
- Consumes UNCHANGED: `CapabilityMatrix`, `ExtractionScope`, `RawCatalog`, `RawObject`, `RawDependency`,
  `normalizeCatalog`, `SqliteGraphStore`, the query API, the `Logger` port, and the existing
  `ConnectionError`/`PermissionError` typed errors.

## Recommended Apply Batch Ordering (for the future apply phase)

> NOTE: NO `_shared` extraction batch — it ALREADY EXISTS (8a). Hence FEWER batches than 8a (6 vs 7).

1. **Config + capabilities plumbing** — `MYSQL_CAPABILITIES` (`capabilities.ts`) + `MysqlAdapterConfig` on the
   union (and the `host` JSDoc fix) + `MysqlSource` + `parseMysqlSource`/`case 'mysql'` (no live connection).
2. **Driver seam + factory** — `driver.ts` (`MysqlReadonlyDriver` over `ConnectionLike`, normalize
   `[rows,fields]` → `{rows}`) + `error-mapper.ts` (`mysql2` code → typed errors) + `factory.ts`
   (`createMysqlSchemaAdapter`, lazy `import('mysql2/promise')`).
3. **Queries + map + tokenizer** — `queries.ts` (`information_schema` SELECTs, all `= DATABASE()`, all
   `ORDER BY`) + `map.ts` (rows → sorted `RawCatalog`; `schema=database`; `AUTO_INCREMENT` on column; CHECK;
   `engine:'mysql'`) + `tokenizer.ts` (MySQL `hasDynamicSql` = `PREPARE`/`EXECUTE`; wire `_shared/` with the
   presence-gated, dynamic-string-masked emission). UNIT tests assert EXACT dep sets / no-self / no-phantom.
4. **Dispatch wiring + pinned message** — `open-connections.ts` wiring, `capabilitiesFor`/barrel re-export,
   the `UnsupportedDialectError` message + its pinned assertion, and the `exitCodeFor → 4` regression
   assertion (same batch).
5. **Permissions doc** — `docs/permissions/mysql.md` (minimal read-only user) + `PermissionError` doc-link
   wiring.
6. **Fixtures + Testcontainers E2E + CI** — `test/fixtures/mysql/torture.sql` + `mysql:8` extract → golden
   `RawCatalog` → normalize → upsert → query E2E (exact edge counts / endpoints / no-self) + the gated
   `mysql-integration` CI job + write-verb scanner re-run + lint.

## Success Criteria

- [ ] `MysqlSchemaAdapter` implements the EXISTING `SchemaAdapter` port (no port SHAPE change) and is wired via
      `createMysqlSchemaAdapter` through the composition root.
- [ ] Extracts a MySQL `8` torture schema into a coherent `RawCatalog`: the connected database AS the schema;
      tables/columns/types/nullability/defaults; `AUTO_INCREMENT` on the column (NO sequence node); PK/FK
      (incl. composite)/unique/CHECK; indexes; views (`VIEW_DEFINITION`); procedures/functions
      (`ROUTINE_DEFINITION`); triggers (event+timing); comments.
- [ ] `reads_from`/`writes_to` classified from view/routine bodies at `confidence: 'parsed'` via the SHARED
      tokenizer; `PREPARE`/`EXECUTE` marks `hasDynamicSql: true`; `supportsDependencyHints: false` (body
      tokenizer only). EXACT-set negative assertions prove NO phantom and NO self edges (8a CRITICAL-1 designed
      out).
- [ ] `MYSQL_CAPABILITIES` is truthful: supports table/column/constraint/index/view/procedure/function/trigger;
      NO `sequence`; `supportsBodies: true`; `supportsDependencyHints: false` — 100% matrix coverage by the
      torture fixture.
- [ ] `schema == database`: every object carries the connected database as its schema; `RawCatalog.schemas` is
      that one database; every catalog query is filtered `TABLE_SCHEMA = DATABASE()`.
- [ ] Connectivity via host/port (3306)/database/user/password (+ optional ssl); `password` is `${env:VAR}`
      env-only; NO `schema?` knob; absent `mysql2` raises `ConnectionError('npm i mysql2')`.
- [ ] `docs/permissions/mysql.md` ships the minimal read-only user; a missing privilege raises an actionable
      `PermissionError` naming the privilege + doc; no `SET TRANSACTION READ ONLY` workaround; NO
      `SHOW CREATE VIEW`.
- [ ] `fingerprint()` returns a cheap (one-query) value that MOVES on DDL including `ADD COLUMN` and is STABLE
      on data-only DML.
- [ ] Determinism (ADR-008): the `RawCatalog` is deterministic and golden-pinned; the E2E pins exact edge
      counts AND endpoints (no existence-only assertions).
- [ ] The write-verb scanner over `src/adapters/engines/**` stays green (catalog SELECTs only; no scanner-false
      JSDoc literals).
- [ ] The config-discriminator wrinkle is RESOLVED: the stale `host` JSDoc is corrected AND Pg-vs-Mysql
      discrimination is explicitly decided (runtime dispatch keys on `dialect`; design records the union
      decision).
- [ ] NO new runtime deps beyond the optional `mysql2`; `tsc`/lint/test clean; CI green including the gated
      `mysql-integration` job (`DBGRAPH_INTEGRATION=1`), which never blocks the unit matrix.
- [ ] The pinned `UnsupportedDialectError` message updated to `sqlite, mssql, pg, mysql` with its assertion and
      the exit-code-4 mapping verified unchanged.
- [ ] US-029 refined to MySQL-`8`-only with the locked decisions encoded; MariaDB sequences recorded as the
      pre-planned `phase-8c` follow-up.
