# Tasks: Phase 3 — SQL Server Schema Extraction Adapter

Standing header (every task): STRICT TDD (red→green; NEVER mock `tedious`). Pure units (tokenizer, map, error-map,
capabilities) use captured `sys.*` JSON row fixtures — NO DB. Live-catalog contract is integration-first against
Testcontainers. Record any gotcha in `docs/learnings.md`. Integration tests need Docker running (it is). NO new deps
beyond the two justified (`mssql` optional + `testcontainers` dev). Conventional commits with US IDs; English.
Honor: hexagonal ADR-004, determinism ADR-008, closed-deps ADR-007, lazy-import ADR-006, no `any`,
`exactOptionalPropertyTypes` (L-002 conditional spread). Reuse `ConnectionError`/`PermissionError` — no new error types.

## Phase 1: Foundation — config, deps, capabilities (Batch A)

- [x] 1.1 Install deps: `mssql` → `optionalDependencies`, `testcontainers` → `devDependencies` (ADR-007 justified in commit body). Done: both appear in `package.json`; `npm ci` succeeds.
- [x] 1.2 RED+GREEN: widen `src/core/ports/schema-adapter.ts` — add `MssqlAdapterConfig` (server/port?/database/`authentication` nested `type:'sql'|'ntlm'`/encrypt?/trustServerCertificate?), `SchemaAdapterConfig = SqliteAdapterConfig | MssqlAdapterConfig`. Do NOT add `dialect` to `SqliteAdapterConfig`. Re-export via `src/core/ports/index.ts`/`src/core/index.ts`. Spec: union widening. Done: `npx tsc --noEmit`.
- [x] 1.3 Verify Phase-2 green after widening: existing SQLite factory + tests unchanged. Done: `npm test` (all prior suites pass).
- [x] 1.4 RED→GREEN `capabilities.test.ts` + `capabilities.ts`: `MSSQL_CAPABILITIES` — supported set incl. procedure/function/sequence=true, collection/field absent; `supportsBodies`/`supportsDependencyHints`=true; differs from SQLite. Spec: Truthful CapabilityMatrix. Done: `npm test capabilities`.

## Phase 2: Pure logic units — queries, map, tokenizer (Batch A)

- [x] 2.1 Create `src/adapters/engines/mssql/queries.ts`: read-only `sys.*` SELECT constants per design query set (tables/cols, PK/UNIQUE, FK, CHECK, indexes, modules, sequences, extended_properties, sql_expression_dependencies), each ending `ORDER BY schema,object[,ordinal]` (ADR-008). Spec: Read-only by construction. Done: `npx tsc --noEmit`.
- [x] 2.2 Capture `sys.*` JSON row fixtures under `test/fixtures/mssql/rows/*.json` for every family (tables→cols→PK→FK→CHECK→indexes→views→procs→functions→triggers→sequences→comments→deps). Done: files exist, valid JSON.
- [x] 2.3 RED→GREEN `tokenizer.test.ts` + `tokenizer.ts`: classify INSERT/UPDATE/DELETE/MERGE/TRUNCATE→write, SELECT→read, EXEC/sp_executesql→`hasDynamicSql:true` (no edges), bracket/`[schema].[name]` → `canonicalQName` normalization, case-insensitive. Spec: Parsed reads_from/writes_to; Dynamic SQL flagged never guessed (US-007). Done: `npm test tokenizer`.
- [x] 2.4 RED→GREEN `map.test.ts` + `map.ts` per family over the row fixtures → `RawObject[]`, deterministic re-sort by `(KIND_RANK, schema, name)`, grouped FK/index columns by ordinal. Cover computed columns, composite FK grouped, clustered/filtered/included indexes, scalar-vs-TVF distinct, trigger event+timing, sequence, `MS_Description`→comment, body level-gating (full/metadata/off). Spec: tables/cols, PK/FK/unique/check, indexes, views/procs/funcs/triggers, sequences, comments. Done: `npm test map`.

## Phase 3: Driver, factory, error mapping (Batch B)

- [x] 3.1 Create `src/adapters/engines/mssql/driver.ts`: async `MssqlReadonlyDriver` (`query(sql,params?)→Promise<rows>`, `close()`), pool-backed adapter over `mssql.ConnectionPool`. Adapter+map talk only to this seam. Spec: read strategy/lifecycle. Done: `npx tsc --noEmit`.
- [x] 3.2 RED→GREEN error-mapper unit (synthetic tedious errors, NO DB): `ELOGIN`/"Login failed"→`ConnectionError`(creds); `ESOCKET`/`ETIMEOUT`/`ENOTFOUND`→`ConnectionError`(server:port); TLS self-signed/certificate→`ConnectionError`(trustServerCertificate); Kerberos attempted→`ConnectionError`(SSO unsupported, use SQL/NTLM); error 229/permission denied→`PermissionError`(`VIEW DEFINITION` + `docs/permissions/mssql.md`). Spec: Missing VIEW DEFINITION PermissionError; Kerberos unsupported ConnectionError (US-033, ADR-006). Done: `npm test` (mapper suite).
- [x] 3.3 RED→GREEN `factory.ts`: `createMssqlSchemaAdapter` — lazy `import('mssql')` (ADR-006), pool connect, wire driver, map connect errors via 3.2. Missing-driver → error naming `npm i mssql`. Spec: Missing mssql driver names install; Connectivity SQL/NTLM. Done: `npm test` (factory missing-driver suite).
- [x] 3.4 Create `src/adapters/engines/mssql/mssql-schema-adapter.ts`: adapter class. `extract(scope)` honoring levels via queries+map+tokenizer; `fingerprint()`=`sha256(\`${MAX(modify_date)}|${COUNT}\`)` over `sys.objects WHERE is_ms_shipped=0`; `close()` idempotent (`_closed`); lifecycle guard extract/fingerprint-after-close → `ConnectionError`. Spec: fingerprint one cheap query (US-009); read strategy/lifecycle. Done: `npx tsc --noEmit`.
- [x] 3.5 Confirm US-031 scanner covers new SQL: run `test/adapters/engines/security-scan.test.ts` (already scans `engines/**`) — mssql SELECT strings pass, no write-verb false-positive. Spec: mssql SQL passes write-verb scanner (US-031). Done: `npm test security-scan`.

## Phase 4: Integration fixtures, container, goldens, E2E (Batch C)

- [x] 4.1 Create `test/fixtures/mssql/torture.sql` (reviewable plain-text): proc writing 2 tables + reading a 3rd, `AFTER UPDATE` trigger writing audit, filtered index w/ included columns, computed column, TVF, sequence, extended property; exercises 100% of the matrix. Spec: Committed T-SQL torture fixture. Done: file parses (applied in 4.2).
- [x] 4.2 Create `test/fixtures/mssql/container.ts`: Testcontainers harness — image `mcr.microsoft.com/mssql/server:2022-latest`, `ACCEPT_EULA=Y`/`MSSQL_SA_PASSWORD`; wait-strategy = poll `SELECT 1` (NOT port-open), cap ~120s; apply `torture.sql`; expose `{config, stop()}`; `mssqlContainerAvailable()` + `skipIf(!process.env.DBGRAPH_INTEGRATION)` with clear reason. Spec: ephemeral container, skips without Docker. Done: harness imports cleanly.
- [x] 4.3 RED→GREEN `extract.integration.test.ts` (skipIf-gated): extract → seed `golden-raw-catalog.json` via `stableStringify`; second run byte-identical. Spec: RawCatalog golden deterministic (ADR-008). Done: `DBGRAPH_INTEGRATION=1 npm run test:integration`.
- [x] 4.4 fingerprint DDL/DML integration test (in extract suite, gated): CREATE TABLE→value changes; INSERT→unchanged. Spec: fingerprint changes on DDL / stable on DML (US-009). Done: `DBGRAPH_INTEGRATION=1 npm run test:integration`.
- [x] 4.5 RED→GREEN `e2e.integration.test.ts` (gated): extract → `normalizeCatalog` → `SqliteGraphStore.upsertGraph` → `impact`/`path` queries → seed `golden-e2e.json`, byte-identical re-run. Spec: full pipeline golden-pinned (US-027). Done: `DBGRAPH_INTEGRATION=1 npm run test:integration`.

## Phase 5: Wiring, CI, docs, closeout (Batch C)

- [x] 5.1 Modify `src/index.ts`: export `createMssqlSchemaAdapter` (composition root, ADR-004). Done: `npx tsc --noEmit`.
- [x] 5.2 Modify `package.json` scripts: add `test:integration` using vitest.integration.config.ts; make default `test` EXCLUDE `*.integration.test.ts` (vitest config exclude glob). Done: `npm test` skips integration; `npm run test:integration` targets only them (39 tests, all passing).
- [x] 5.3 Modify `.github/workflows/ci.yml`: KEEP existing `test` job (matrix 22.x/24.x, checkout@v6, setup-node@v6) — unchanged. ADD separate `mssql-integration` job (Linux-only, `needs: []`) setting `DBGRAPH_INTEGRATION=1`, running ONLY `npm run test:integration`; never references the validation database. Done: YAML valid; two distinct jobs.
- [x] 5.4 Create `docs/permissions/mssql.md`: minimal `CREATE LOGIN`/`CREATE USER` granting only `VIEW DEFINITION` + `CONNECT` (no `db_datareader`); prod TLS guidance. Done: doc present.
- [x] 5.5 Final gates + story updates: `npm test` 538/538 pass; `npm run lint` clean; `npx tsc --noEmit` clean; `DBGRAPH_INTEGRATION=1 npm run test:integration` 39/39 pass (Docker running, real SQL Server 2022). US-027 done; US-007 extraction half done; US-009 mssql note; US-031 mssql confirmed; US-033 partial (doc done); US-034 partial (CI job added); E5 = 3 pending / 2 done. Learnings L-006/L-007/L-008 recorded. Done: all gates green.

## Apply Batch Grouping (one sub-agent session each)

- **Batch A** (1.1–2.4): config widening + Phase-2-green verify, capabilities, queries, map, tokenizer — pure logic, NO DB.
- **Batch B** (3.1–3.5): driver seam, error-mapper, factory, adapter class, US-031 scanner confirm — pure/synthetic, NO DB.
- **Batch C** (4.1–5.5): torture fixture, Testcontainers harness, RawCatalog golden, fingerprint DDL/DML, E2E, wiring, CI, docs, closeout — Docker-gated.

### Dependency bottlenecks

- 1.2 (union widening) gates EVERYTHING — must land + Phase-2 stay green (1.3) before any mssql module.
- 2.x (queries/map/tokenizer) MUST precede 3.4 (adapter wires them) and 4.x (goldens assert their output).
- 3.1 (driver seam) gates 3.3/3.4; 3.2 (error-mapper) gates 3.3.
- 4.1 torture.sql + 4.2 container gate ALL integration (4.3–4.5) — Batch C is the Docker-dependent critical path.
- 5.2 (test:integration script + exclude glob) MUST precede 5.3 CI job and the 4.x done-checks running cleanly.
