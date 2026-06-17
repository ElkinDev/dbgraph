# Tasks: Phase 2 — SQLite Schema Extraction Adapter

> Standing instructions (apply to every task)
> - STRICT TDD: write the failing test FIRST for every core/adapter unit (red → green). Done-check must pass before moving on.
> - Hexagonal (ADR-004): port in `src/core`, adapter in `src/adapters/engines/sqlite/`. No `any`; typed actionable errors; `exactOptionalPropertyTypes` (L-002 conditional spread); no new deps (ADR-007); determinism (ADR-008); English everywhere.
> - Record any gotcha/edge case in `docs/learnings.md` as you hit it.
> - Conventional commits referencing the US ID (e.g. `feat: ... (US-026)`).
> - After this phase's FINAL commit, run `git status --short` and commit ANY leftover modification (a Phase-1 batch left a refactor uncommitted — do NOT repeat).

Order follows design.md "TDD red→green order" exactly. Two apply batches (S-size phase).

## Batch A — Core port, errors, driver seam, mappers (tasks 1.x–4.x)

## Phase 1: Core foundation (errors + port)

- [x] 1.1 RED+GREEN: add `ConnectionError` (`E_CONNECTION`) and `PermissionError` (`E_PERMISSION`) to `src/core/errors.ts`, extending `DbgraphError`, carrying `cause`, actionable messages. Test `test/core/errors.test.ts` asserts code + message shape. Satisfies schema-extraction "Typed errors with actionable messages" (missing/corrupt source). Done: `npm test -- errors`.
- [x] 1.2 Create `src/core/ports/schema-adapter.ts` with `SchemaAdapter` interface (`dialect`, `capabilities`, `extract`, `fingerprint`, `close`) + `SqliteAdapterConfig`/`SchemaAdapterConfig`; re-export from `src/core/ports/index.ts` and `src/core/index.ts` (port + new errors). Driver-free. Satisfies schema-extraction "SchemaAdapter port lives in core" + "lifecycle". Done: `npx tsc --noEmit`.
- [x] 1.3 RED+GREEN: boundary test asserts `schema-adapter.ts` imports NO driver/adapter/mcp/cli symbol and is implementable by a no-DB test double. Extend `test/core/boundaries.test.ts`. Satisfies "Port type is driver-free". Done: `npm test -- boundaries`.

## Phase 2: Capabilities + driver duality seam

- [x] 2.1 RED+GREEN: create `src/adapters/engines/sqlite/capabilities.ts` exporting `SQLITE_CAPABILITIES` (supports schema/table/column/constraint/index/view/trigger; `supportsBodies:true`, `supportsDependencyHints:false`; NO procedure/function/sequence/collection). Test asserts unsupported types reported unsupported (100% coverage). Satisfies sqlite-extraction "Truthful SQLite CapabilityMatrix" + schema-extraction "Honest capability reporting". Done: `npm test -- capabilities`.
- [x] 2.2 RED+GREEN: create `src/adapters/engines/sqlite/driver.ts` — `ReadonlyDriver` (`all`/`pragma`/`close`), `betterSqliteDriver` + `nodeSqliteDriver` adapters, and `isNodeSqliteAvailable()` (Node ≥22.5 detection). Unit-test `all`/`pragma` against a materialized temp db. Satisfies sqlite-extraction "Driver duality" seam + node-version detection helper. Done: `npm test -- driver`.

## Phase 3: Fixture + materialization helper

- [x] 3.1 Create `test/fixtures/sqlite/torture.sql` — committed plain-text DDL exercising EVERY SQLite capability: typed/nullable/PK columns, single + composite FK, unique/partial/expression indexes, views, triggers (BEFORE/AFTER/INSTEAD OF; INSERT/UPDATE/DELETE), WITHOUT ROWID table. Deterministic names, no random/time data. Satisfies sqlite-extraction "Fixture is a reviewable .sql script" + "exercises every supported object type". Done: file is plain text, no `.db` binary committed.
- [x] 3.2 Create `test/fixtures/sqlite/materialize.ts` exporting `materializeTorture(): { path; cleanup() }` — writes torture.sql into a temp on-disk db (os.tmpdir), opens writable, `db.exec`, closes, returns path; `cleanup()` unlinks. No `:memory:` (parity needs two opens of same bytes). Satisfies "Setup materializes the fixture into a temporary database". Done: helper imports cleanly (`npx tsc --noEmit`).

## Phase 4: Extraction queries + mappers (one mapper family per task, golden built incrementally)

- [x] 4.1 Create `src/adapters/engines/sqlite/queries.ts` — read-only SQL strings: `sqlite_master` filtered (`NOT LIKE 'sqlite_%'`) + PRAGMA `table_info`/`foreign_key_list`/`index_list`/`index_info`/`schema_version`. No write verbs. Done: `npx tsc --noEmit`.
- [x] 4.2 RED+GREEN: `map.ts` tables+columns — `kind:'table'`, `schema:'main'`, WITHOUT ROWID → `extra.withoutRowid`; columns carry name/declared-type-as-is (`''` when typeless, no invention)/nullable/default/ordinal/PK; exclude `sqlite_*`. Test in `test/adapters/engines/sqlite/extract.test.ts`. Satisfies sqlite-extraction "Extract tables and columns". Done: `npm test -- extract`.
- [x] 4.3 RED+GREEN: `map.ts` FKs from `foreign_key_list` — GROUP rows by `id` (one FK per id; composite = multiple rows), order target cols by `seq`, preserve local→referenced pairs as ONE constraint. Satisfies "Extract foreign keys including composite" (both scenarios). Done: `npm test -- extract`.
- [x] 4.4 RED+GREEN: `map.ts` indexes from `index_list`+`index_info` — unique flag; partial → `extra.where` parsed from `sqlite_master.sql`; expression columns (`index_info.name` null) → `'(expr)'` placeholder (NOT a fake column); UNIQUE origin='u' also emitted as `RawConstraint{type:'UNIQUE'}`; SKIP `sqlite_autoindex_*`. Satisfies "Extract indexes including unique, partial and expression" (all 3 scenarios). Done: `npm test -- extract`.
- [x] 4.5 RED+GREEN: `map.ts` views — `kind:'view'`, `body = sql` level-gated (omit unless `levels.views==='full'`). Satisfies "Extract views ... with bodies per level" (view + metadata scenarios). Done: `npm test -- extract`.
- [x] 4.6 RED+GREEN: `map.ts` triggers — body level-gated; tolerant parse of `sql` for timing (`BEFORE|AFTER|INSTEAD OF`), events (`INSERT|UPDATE|DELETE`, `UPDATE OF`→UPDATE), target (`ON <table>`); `dependencies:[]`, no guessing; mark `hasDynamicSql` honestly. Satisfies "Trigger carries its firing event" + "Honest minimal dependency hints" (flagged-not-guessed, deferred parsing). Done: `npm test -- extract`.
- [x] 4.7 RED+GREEN: deterministic ordering in `map.ts` — `objects` by `(kind-rank, schema, name)`, columns by ordinal, constraints/indexes by name, FK/index cols preserve seqno, `schemas:['main']`. Test asserts `stableStringify` stability across two extract calls. Satisfies sqlite-extraction determinism (ADR-008). Done: `npm test -- extract`.

## Batch B — Factory, golden, parity, security, E2E, wiring, closeout (tasks 5.x–10.x)

## Phase 5: Factory (open + read-only + error mapping)

- [x] 5.1 RED+GREEN: create `src/adapters/engines/sqlite/factory.ts` `createSqliteSchemaAdapter(config)` — explicit `config.driver` (default `better-sqlite3`, NO silent fallback; `node:sqlite` on Node <22.5 → `ConnectionError`), dynamic import, open read-only (`{readonly:true, fileMustExist:true}` / node:sqlite read-only flags), wrap in `ReadonlyDriver`, return `SqliteSchemaAdapter`. Map missing/not-a-db/locked → `ConnectionError`; missing driver → message with exact `npm i <pkg>`. Satisfies schema-extraction error scenarios + sqlite "Read-only ... construction". Done: `npm test -- factory`.
- [x] 5.2 Create `src/adapters/engines/sqlite/sqlite-schema-adapter.ts` — `extract(scope)` (honors ExtractionScope: off-type absent, metadata omits body; requires prior connect via factory), `fingerprint()`, `close()` idempotent. Satisfies schema-extraction lifecycle (extract-requires-connect, close-idempotent) + "extract honours ExtractionScope" + "produces a RawCatalog the normalizer can consume". Done: `npm test -- factory extract`.

## Phase 6: RawCatalog golden + fingerprint + readonly enforcement

- [x] 6.1 RED+GREEN: full-torture `extract()` → `stableStringify` === committed `test/fixtures/sqlite/golden-raw-catalog.json`; freeze golden. Satisfies "exercises every supported object type" (100% capability-matrix coverage). Done: `npm test -- extract`.
- [x] 6.2 RED+GREEN: `fingerprint()` = `sha256(String(PRAGMA schema_version))`; integration test on a writable temp db — ALTER (DDL) changes fingerprint, INSERT (DML) leaves it stable; asserts exactly one PRAGMA query (no object walk). Satisfies sqlite-extraction "fingerprint via PRAGMA schema_version" (all 3 scenarios) + schema-extraction "fingerprint is one cheap query". Done: `npm test -- fingerprint`.
- [x] 6.3 RED+GREEN: write through the adapter's read-only connection MUST fail (e.g. INSERT rejected). Satisfies schema-extraction "Adapters are read-only by construction" + sqlite "Write through the SQLite connection fails". Done: `npm test -- factory`.

## Phase 7: Security scanner (US-031)

- [x] 7.1 RED+GREEN: create `test/adapters/engines/security-scan.test.ts` — reuse `collectTsFiles` walk; scan `src/adapters/engines/**` SQL in string/template literals, strip `--` and `/* */` comments, match write verbs on word boundaries (`INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|REPLACE`); EXEMPT `src/adapters/storage/**`. Negative control: injected verb FAILS scan; `updated_at` and verbs in strings/comments PASS. Satisfies sqlite-extraction "Write-verb scanner" (all 3 scenarios). Done: `npm test -- security-scan`.

## Phase 8: Cross-driver parity (US-026/ADR-006)

- [x] 8.1 RED+GREEN: create `test/adapters/engines/sqlite/parity.test.ts` — `stableStringify(better) === stableStringify(node)` on the SAME materialized torture db opened independently per driver; `describe.skipIf(!isNodeSqliteAvailable())` with logged reason. Satisfies sqlite-extraction "Driver duality yields the same RawCatalog" + "Parity test skips with reason on Node 20". Done: `npm test -- parity`. (RUNS on this machine — Node 22.19, node:sqlite available)

## Phase 9: E2E pipeline (golden-pinned)

- [x] 9.1 RED+GREEN: create `test/adapters/engines/sqlite/e2e.test.ts` — torture.sql → materialize → `extract` → `normalizeCatalog` → `createSqliteGraphStore` upsert → `neighbors`/`impact`/`path`/`search`; outputs golden-pinned, second run byte-identical (ADR-008). Satisfies sqlite-extraction "Golden-pinned end-to-end pipeline" (both scenarios). Done: `npm test -- e2e`.

## Phase 10: Wiring + closeout

- [x] 10.1 Modify `src/index.ts` — export `createSqliteSchemaAdapter` at the composition root (only new public export). Done: `npx tsc --noEmit` + `npm test`.
- [x] 10.2 Run all gates: `npm test`, `npm run lint`, `npx tsc --noEmit` — all green. Done: 3 commands pass. (379 tests, 26 files)
- [x] 10.3 Story updates: `docs/stories/05-adapters.md` — mark US-026 ☑ done WITH the `.sql`-refinement annotation superseding the `.db` criterion; `docs/stories/06-security.md` — US-031 partial note (scanner done, per-engine permission docs pending); `docs/stories/02-graph-core.md` — US-009 note (sqlite fingerprint done). Update `docs/stories/README.md` counts: E5 → 4 pending / 1 done. Done: edits present, README table updated.
- [x] 10.4 Final commit, then `git status --short`; commit ANY leftover modification. Append any gotchas to `docs/learnings.md`. Done: `git status --short` is clean.
