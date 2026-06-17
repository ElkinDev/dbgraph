# Apply Progress: phase-3-sqlserver-adapter — Batches A + B + C + D (ALL DONE)

## Change
phase-3-sqlserver-adapter

## Mode
Strict TDD (RED → GREEN → REFACTOR per task)

## Batches
- Batch A (tasks 1.1–2.4): pure logic, NO DB, NO Testcontainers — DONE
- Batch B (tasks 3.1–3.5): driver seam, error-mapper, factory, adapter class, US-031 scanner — DONE
- Batch C (tasks 4.1–5.5): torture fixture, container harness, integration tests, wiring, CI, docs, closeout — DONE
- Batch D (remediation): fix C-1/C-2/W-1/W-2 from verify FAIL — DONE

## Baseline
28 test files, 394 tests passing before Batch A started.
485 tests passing after Batch A.
538 tests passing after Batch B.
538 unit tests + 39 integration tests (DBGRAPH_INTEGRATION=1) after Batch C.
540 unit tests + 47 integration tests after Batch D (2 unit + 8 integration assertions added).

---

## Completed Tasks

### [x] 1.1 — Install mssql + testcontainers
- Commit: `d26bda6`
- `mssql@12.5.5` → `optionalDependencies`; `testcontainers@10.24.1` → `devDependencies`
- `npm install` updated lockfile; `npm ci` verified clean
- Justification in commit body: ADR-007 closed list + ADR-006 lazy import

### [x] 1.2 — Add MssqlAdapterConfig + widen SchemaAdapterConfig union
- Commit: `d248942`
- Added `MssqlAdapterConfig` to `src/core/ports/schema-adapter.ts`
- Plain structural union: `SchemaAdapterConfig = SqliteAdapterConfig | MssqlAdapterConfig`
- `SqliteAdapterConfig` UNCHANGED — no `dialect` field added (back-compat)
- Re-exported from `src/core/ports/index.ts` and `src/core/index.ts`
- Test: `test/adapters/engines/mssql/config-union.test.ts` (7 type-level tests)

### [x] 1.3 — Phase-2 green gate
- Commit: `d248942` (same as 1.2)
- Full suite: 401 tests passing (was 394 + 7 new type tests)
- No regression in SQLite adapter, factory, or any Phase-2 test

### [x] 1.4 — MSSQL_CAPABILITIES constant + unit test
- Commit: `1c263f3`
- Created `src/adapters/engines/mssql/capabilities.ts`
- procedure/function/sequence=supported; collection/field=unsupported
- supportsBodies=true; supportsDependencyHints=true
- Test: `test/adapters/engines/mssql/capabilities.test.ts` (21 tests)

### [x] 2.1 — queries.ts — read-only sys.* SELECT constants
- Commit: `56e29ac`
- Created `src/adapters/engines/mssql/queries.ts`
- 11 constants: SQL_MSSQL_TABLES, SQL_MSSQL_COLUMNS, SQL_MSSQL_KEY_CONSTRAINTS,
  SQL_MSSQL_FOREIGN_KEYS, SQL_MSSQL_CHECK_CONSTRAINTS, SQL_MSSQL_INDEXES,
  SQL_MSSQL_MODULES, SQL_MSSQL_TRIGGER_EVENTS, SQL_MSSQL_SEQUENCES,
  SQL_MSSQL_EXTENDED_PROPERTIES, SQL_MSSQL_DEPENDENCIES, SQL_MSSQL_FINGERPRINT
- All SELECTs, all end with ORDER BY (ADR-008), US-031 scanner passes

### [x] 2.2 — sys.* JSON row fixtures
- Commit: `45f307e`
- Created `test/fixtures/mssql/rows/` with 11 fixture files:
  tables.json, columns.json, key-constraints.json, foreign-keys.json,
  check-constraints.json, indexes.json, modules.json, trigger-events.json,
  sequences.json, extended-properties.json, dependencies.json
- Representative rows covering: computed column, composite FK, filtered+included index,
  scalar fn, inline TVF, AFTER UPDATE trigger, dynamic-SQL proc, MS_Description

### [x] 2.3 — tokenizer.ts + tokenizer.test.ts
- Commit: `755c711`
- Created `src/adapters/engines/mssql/tokenizer.ts` (pure functions)
- `canonicalizeQName`: strips [brackets] and "quotes", lowercases
- `classifyAccess(targetQName, body)`: write if target follows write-verb; read otherwise
- `hasDynamicSql(body)`: EXEC/sp_executesql detection
- `tokenizeModuleDeps(body, deps)`: full dep classification, null refs skipped (US-007)
- Test: `test/adapters/engines/mssql/tokenizer.test.ts` (29 tests)
- Security scanner issue discovered and fixed: JSDoc apostrophes caused scanner to
  read comment text as SQL string literals (possessive quote false-positive).
  Fixed by removing apostrophes from JSDoc in tokenizer.ts.

### [x] 2.4 — map.ts + map.test.ts
- Commit: `2acedbf`
- Created `src/adapters/engines/mssql/map.ts`
- `buildMssqlRawCatalog(input, scope)`: tables+columns+constraints+indexes,
  modules (level-gated), sequences, deterministic sort by KIND_RANK
- `MssqlRowInput` interface: all pre-fetched sys.* row arrays; pure/testable
- Computed column extra via RawColumn intersection (RawColumn has no extra field)
- Composite FK grouped by fk_id, ordered by constraint_column_id
- Included columns in extra.includedColumns, separated from key columns array
- Type_desc (CLUSTERED/NONCLUSTERED) in extra.typeDesc, filter in extra.where
- Scalar fn vs TVF distinguished via extra.functionType ('FN'/'IF'/'TF')
- Trigger timing (AFTER/INSTEAD OF) and events from triggerEventMap
- tokenizeModuleDeps wired for dep classification
- MS_Description comment map for objects and columns
- Test: `test/adapters/engines/mssql/map.test.ts` (34 tests)

### [x] 3.1 — MssqlReadonlyDriver async seam
- Commit: `79132ed`
- Created `src/adapters/engines/mssql/driver.ts`
- `MssqlReadonlyDriver` interface: `query(sql): Promise<readonly Record[]>`, `close(): Promise<void>`
- `createMssqlReadonlyDriver(pool: PoolLike)`: wraps any duck-typed pool
- PoolLike duck-typed interface keeps mssql types out of this module
- Test: `test/adapters/engines/mssql/driver.test.ts` (6 unit tests, fake pool, no mssql)

### [x] 3.2 — error-mapper unit tests + implementation
- Commit: `4ab2964`
- Created `src/adapters/engines/mssql/error-mapper.ts`
- `mapMssqlError(cause)`: pure function, always returns ConnectionError or PermissionError
- Mapping table:
  - ELOGIN / "Login failed" → ConnectionError (credentials guidance)
  - ESOCKET/ETIMEOUT/ENOTFOUND → ConnectionError (server:port unreachable)
  - self-signed/certificate → ConnectionError (trustServerCertificate hint)
  - Kerberos/SSPI → ConnectionError (SSO unsupported, use SQL/NTLM)
  - error 229 / "permission denied" → PermissionError (VIEW DEFINITION + docs link)
  - generic → ConnectionError fallback
- Test: `test/adapters/engines/mssql/error-mapper.test.ts` (17 unit tests, synthetic errors)

### [x] 3.3 — createMssqlSchemaAdapter factory
- Commit: `ddd96f5`
- Created `src/adapters/engines/mssql/factory.ts`
- Lazy `import('mssql' as string) as unknown as LocalDuckType` (ADR-006; mssql 12.x has no bundled types)
- Builds mssql ConnectionPool config from MssqlAdapterConfig (sql + ntlm auth branches)
- Maps pool.connect() failures via mapMssqlError (task 3.2)
- Missing mssql → ConnectionError naming "npm i mssql"
- Tests: factory.test.ts (9 tests: SQL/NTLM construct, login-failed, Kerberos)
         factory-missing-driver.test.ts (3 tests: MODULE_NOT_FOUND → "npm i mssql")

### [x] 3.4 — MssqlSchemaAdapter class + unit tests
- Commit: `ddd96f5` (same as 3.3 — factory created the file stub, tests in 5c53f10)
- Created `src/adapters/engines/mssql/mssql-schema-adapter.ts`
- dialect='mssql', capabilities=MSSQL_CAPABILITIES
- extract(scope): parallel Promise.all of 11 sys.* queries → buildMssqlRawCatalog
- fingerprint(): sha256(`${MAX(modify_date)}|${COUNT}`) — one query, DDL-sensitive (US-009)
- close(): idempotent (_closed guard), calls driver.close() exactly once
- Lifecycle guard: extract/fingerprint after close() → ConnectionError
- Tests: test/adapters/engines/mssql/mssql-schema-adapter.test.ts (18 unit tests)
  - Fake driver returns Batch-A JSON fixtures
  - Proves extract→RawCatalog WITHOUT container (live contract is Batch C)
  - Asserts fingerprint formula, lifecycle guard, close idempotency

### [x] 3.5 — US-031 scanner confirmed over new mssql files
- No new files needed; security-scan.test.ts already scans `engines/**`
- All new mssql files (driver.ts, error-mapper.ts, factory.ts, mssql-schema-adapter.ts)
  contain only SELECT strings (in queries.ts) — no write verbs
- 8/8 scanner tests pass (including negative control)

### [x] 4.1 — torture.sql T-SQL fixture
- Commit: `0402db3`
- Tables: products, orders, order_items, audit_log, regions
- Computed column: orders.total_amount AS (quantity * unit_price)
- Composite FK: order_items (product_id, region_id) → products (product_id, region_id)
- PK/UNIQUE/CHECK on every table; filtered index idx_orders_active WITH INCLUDE
- View: v_order_summary; scalar fn: fn_discount_price; inline TVF: fn_orders_by_region
- Sequence: dbo.order_seq; MS_Description on products + product_name column
- sp_place_order (writes orders + order_items, reads products)
- trg_audit_order_update AFTER UPDATE writes audit_log
- sp_dynamic_search uses sp_executesql (hasDynamicSql=true)
- GO batch separators required for CREATE PROC/TRIG/FUNC/VIEW (L-006)

### [x] 4.2 — Testcontainers harness (container.ts)
- Commit: `08aea97`
- Image: mcr.microsoft.com/mssql/server:2022-latest
- SA password: strong (8+ chars, upper/lower/digit/symbol)
- Wait strategy: Wait.forListeningPorts() (fast) + poll SELECT 1 (TDS readiness, 120s cap)
- Applies torture.sql via GO-split batches
- Exposes MssqlContainerHandle { config, stop() }
- Gate: mssqlIntegrationEnabled() = process.env.DBGRAPH_INTEGRATION === '1'
- Container beforeAll hookTimeout must be >= 240 000 ms (documented on startMssqlContainer)

### [x] 4.3 — extract.integration.test.ts (RawCatalog golden)
- Commit: `ed5069a`
- 22 tests: all torture objects verified (tables, computed col, composite FK, filtered index,
  view+body, scalar fn, TVF, sequence, trigger timing/event, MS_Description, parsed deps,
  hasDynamicSql, deterministic sort, byte-identical second run, golden file)
- Golden seeded: test/fixtures/mssql/golden/golden-raw-catalog.json

### [x] 4.4 — fingerprint.integration.test.ts (DDL/DML stability)
- Commit: `ed5069a` (same as 4.3) + fixed in `f24619e`
- DML INSERT → fingerprint unchanged ✓
- DDL CREATE TABLE → fingerprint changes ✓ (L-007: CREATE TABLE more reliable than ALTER TABLE)
- Used CREATE TABLE (not ALTER TABLE) because ALTER TABLE col add may not change modify_date within same second

### [x] 4.5 — e2e.integration.test.ts (full pipeline golden)
- Commit: `ed5069a` (same as 4.3) + fixed in `f24619e`
- 14 tests: extract → normalizeCatalog → SqliteGraphStore → impact/path queries
- writes_to edges from sp_place_order (2 targets) ✓
- reads_from edge from sp_place_order to products ✓
- fires_on from trg_audit_order_update ✓
- hasDynamicSql on sp_dynamic_search ✓
- Golden seeded: test/fixtures/mssql/golden/golden-e2e.json
- Note: writes_to trigger→audit_log not asserted (sys.sql_expression_dependencies gap — L-008)

### [x] 5.1 — src/index.ts export createMssqlSchemaAdapter
- Commit: `50099fe`
- ADR-004 composition root: only join point for mssql factory

### [x] 5.2 — vitest.config.ts exclude + test:integration script
- Commit: `663d412` + config in `f24619e`
- vitest.config.ts: exclude ['**/*.integration.test.ts']
- vitest.integration.config.ts: include only integration tests, hookTimeout 300s
- package.json: test:integration = vitest run --config vitest.integration.config.ts
- Unit: 538/538 passing; integration: 39/39 passing; skip without DBGRAPH_INTEGRATION

### [x] 5.3 — ci.yml mssql-integration job
- Commit: `ed5641b`
- Added mssql-integration job (ubuntu-latest, needs: [], DBGRAPH_INTEGRATION=1)
- Runs npm run test:integration only; never references the validation database
- Existing test job (matrix 22/24 x ubuntu+windows) UNCHANGED

### [x] 5.4 — docs/permissions/mssql.md
- Commit: `eebc03b`
- CREATE LOGIN + CREATE USER + GRANT VIEW DEFINITION + GRANT CONNECT
- NO db_datareader; explains what each grant does
- Verification query + revocation instructions + production TLS guidance
- Troubleshooting table for PermissionError/ConnectionError scenarios

### [x] 5.5 — Final gates + story updates
- Commit: `1e1812d`
- npm test: 538/538 ✓ | npm run lint: clean ✓ | npx tsc --noEmit: clean ✓
- DBGRAPH_INTEGRATION=1 npm run test:integration: 39/39 ✓ (Docker running, real SQL Server 2022)
- US-027 ☑ done; US-007 extraction half ☑ done; US-009 mssql note; US-031 mssql confirmed
- US-033 partial (doc done); US-034 partial (CI job added); E5 = 3 pending / 2 done
- L-006/L-007/L-008 recorded in docs/learnings.md

---

## Batch D — Remediation (2026-06-16): C-1/C-2/W-1/W-2

### [x] D-1 — C-1 fix: resolve trigger fires_on target to parent table (W-2 unit test first)
- Commit: `fb77f36`
- TDD RED: added two failing unit tests in `map.test.ts`:
  - `trigger.table.name === 'orders'` (expected 'orders', received 'tr_audit_orders' — RED)
  - no phantom table node named after trigger — RED
- TDD GREEN: fixed `map.ts` `buildModules`:
  - Added `tableById = Map<object_id, {schema,name}>` from `input.tables`
  - Expanded `triggerEventMap` entries to include `parentObjectId`
  - Changed `table: { schema: mod.schema_name, name: mod.object_name }` →
    `table: parentTable ?? fallback` (resolves via `te.parentObjectId → tableById`)
- Unit suite: 540/540 (was 538 before Batch D; 2 new assertions)

### [x] D-2 — W-1+C-2: endpoint assertions + restore writes_to + regenerate goldens
- Commit: `b5e7d6c`
- Goldens DELETED and REGENERATED atomically (intentional: goldens enshrined C-1 bug)
- New integration assertions in `extract.integration.test.ts`:
  - `trigger.table.name === 'orders'` + no phantom table object (W-1)
  - `writes_to(trg→audit_log, confidence:parsed)` present in RawCatalog deps (C-2)
- New integration assertions in `e2e.integration.test.ts`:
  - `fires_on` dst qname === `dbo.orders` (W-1)
  - no stub node `dbo.trg_audit_order_update` in `normResult.stubs` (W-1)
  - `writes_to(trigger→audit_log)` edge present by node IDs (C-2)
  - `sp_place_order writes_to` dst qnames: `dbo.orders` + `dbo.order_items` (W-1)
  - `sp_place_order reads_from` dst qname: `dbo.products` (W-1)
- Integration: 47/47 first run (goldens seeded); 47/47 second run (determinism confirmed)

### [x] D-3 — docs: correct L-008, add L-009, promote to skill, mark US-007 done
- Commit: `0e4b4f2`
- `docs/learnings.md`: L-008 RETRACTED and corrected; L-009 added (edge endpoint rule)
- `.claude/skills/dbgraph-testing/SKILL.md`: updated with L-009 rule, false-negative policy, golden discipline, endpoint assertion pattern
- `.atl/skill-registry.md`: dbgraph-testing compact rules updated to include L-009 and false-negative rule
- `docs/stories/02-graph-core.md`: US-007 marked ☑ done with corrected acceptance criteria and note retracting L-008
- `openspec/changes/phase-3-sqlserver-adapter/state.yaml`: apply batch_d done; verify pending

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | n/a (package.json only) | N/A | ✅ 394/394 | N/A (structural) | ✅ npm ci clean | ➖ Structural only | ✅ Clean |
| 1.2 | config-union.test.ts | Unit (type-level) | ✅ 394/394 | ✅ tsc error before impl | ✅ 7/7 pass | ✅ SQL + NTLM + optional fields | ✅ Clean |
| 1.3 | full suite | Unit | ✅ 394/394 | N/A (regression check) | ✅ 401/401 | N/A | N/A |
| 1.4 | capabilities.test.ts | Unit | N/A (new file) | ✅ import error | ✅ 21/21 pass | ✅ SQLite diff, unsupported types | ✅ Clean |
| 2.1 | n/a (string constants) | N/A | N/A (new file) | N/A (structural) | ✅ tsc --noEmit clean | ➖ Structural: single output (constants) | ✅ Clean |
| 2.2 | n/a (JSON fixtures) | N/A | N/A (new files) | N/A (structural) | ✅ valid JSON | ➖ Structural: representative data | ✅ Clean |
| 2.3 | tokenizer.test.ts | Unit | N/A (new file) | ✅ import error | ✅ 29/29 pass | ✅ All 5 write verbs, EXEC, case, isolation | ✅ Clean (JSDoc fix) |
| 2.4 | map.test.ts | Unit | N/A (new file) | ✅ import error | ✅ 34/34 pass | ✅ All families, levels, ordering | ✅ tsc + scanner fix |
| 3.1 | driver.test.ts | Unit | N/A (new file) | ✅ module not found | ✅ 6/6 pass | ✅ empty result, SQL passthrough, readonly | ✅ Clean |
| 3.2 | error-mapper.test.ts | Unit | N/A (new file) | ✅ module not found | ✅ 17/17 pass | ✅ All 7 error classes, non-Error values | ✅ Clean |
| 3.3 | factory.test.ts + factory-missing-driver.test.ts | Unit | N/A (new file) | ✅ module not found | ✅ 12/12 pass | ✅ SQL+NTLM auth, login-failed, Kerberos | ✅ tsc import cast fix |
| 3.4 | mssql-schema-adapter.test.ts | Unit | N/A (new file) | ✅ import error | ✅ 18/18 pass | ✅ scope off, fingerprint formula, lifecycle | ✅ fake driver routing fixed |
| 3.5 | security-scan.test.ts | Security | ✅ 8/8 (existing) | N/A (scanner already existed) | ✅ 8/8 pass | N/A (existing test suite) | N/A |
| D-1 (C-1/W-2) | map.test.ts (2 new assertions) | Unit | ✅ 538/538 | ✅ trigger.table.name==='tr_audit_orders' (wrong, RED) | ✅ 540/540 after map.ts fix | ✅ no phantom table node | ✅ tsc + lint clean |
| D-2 (W-1/C-2) | extract + e2e integration (8 new assertions) | Integration | ✅ 540 unit | ✅ goldens deleted (mismatch confirmed) | ✅ 47/47 seeded + 47/47 second run | ✅ src+dst qnames, stub absent, writes_to restored | ✅ goldens byte-identical x2 |
| D-3 (docs/skill) | N/A | N/A | N/A | N/A | ✅ L-008 corrected, L-009 added, skill updated | N/A | N/A |

## Test Summary
- **Total tests written (Batch A)**: 91 new tests (7 + 21 + 29 + 34)
- **Total tests written (Batch B)**: 53 new tests (6 + 17 + 12 + 18)
- **Total tests written (Batch D)**: 10 new tests (2 unit + 8 integration)
- **Total tests passing**: 540 unit + 47 integration (was 538/39 before Batch D)
- **Layers used**: Unit (146), Integration (47)
- **Approval tests (refactoring)**: None — all new code
- **Pure functions created (Batch B)**: 1 (mapMssqlError)

---

## Files Changed

### Batch A
| File | Action | Notes |
|------|--------|-------|
| `package.json` | Modified | mssql optional + testcontainers dev |
| `package-lock.json` | Modified | updated lockfile (npm install) |
| `src/core/ports/schema-adapter.ts` | Modified | MssqlAdapterConfig + union widening |
| `src/core/ports/index.ts` | Modified | re-export MssqlAdapterConfig |
| `src/core/index.ts` | Modified | re-export MssqlAdapterConfig |
| `src/adapters/engines/mssql/capabilities.ts` | Created | MSSQL_CAPABILITIES constant |
| `src/adapters/engines/mssql/queries.ts` | Created | sys.* SELECT constants |
| `src/adapters/engines/mssql/tokenizer.ts` | Created | body tokenizer (pure) |
| `src/adapters/engines/mssql/map.ts` | Created | sys.* rows → RawCatalog |
| `test/adapters/engines/mssql/config-union.test.ts` | Created | type-level union tests |
| `test/adapters/engines/mssql/capabilities.test.ts` | Created | capability matrix tests |
| `test/adapters/engines/mssql/tokenizer.test.ts` | Created | tokenizer unit tests |
| `test/adapters/engines/mssql/map.test.ts` | Created | map unit tests |
| `test/fixtures/mssql/rows/*.json` | Created | 11 sys.* row fixture files |
| `openspec/changes/phase-3-sqlserver-adapter/tasks.md` | Modified | [x] marks on 1.1–2.4 |

### Batch B
| File | Action | Notes |
|------|--------|-------|
| `src/adapters/engines/mssql/driver.ts` | Created | MssqlReadonlyDriver async seam |
| `src/adapters/engines/mssql/error-mapper.ts` | Created | mapMssqlError pure function |
| `src/adapters/engines/mssql/factory.ts` | Created | createMssqlSchemaAdapter factory |
| `src/adapters/engines/mssql/mssql-schema-adapter.ts` | Created | MssqlSchemaAdapter class |
| `test/adapters/engines/mssql/driver.test.ts` | Created | 6 unit tests |
| `test/adapters/engines/mssql/error-mapper.test.ts` | Created | 17 unit tests |
| `test/adapters/engines/mssql/factory.test.ts` | Created | 9 unit tests (vi.mock) |
| `test/adapters/engines/mssql/factory-missing-driver.test.ts` | Created | 3 unit tests (vi.mock) |
| `test/adapters/engines/mssql/mssql-schema-adapter.test.ts` | Created | 18 unit tests (fake driver) |
| `docs/learnings.md` | Modified | L-005 mssql no bundled types |
| `openspec/changes/phase-3-sqlserver-adapter/tasks.md` | Modified | [x] marks on 3.1–3.5 |
| `openspec/changes/phase-3-sqlserver-adapter/state.yaml` | Modified | batch_b: done |
| `openspec/changes/phase-3-sqlserver-adapter/apply-progress.md` | Modified | merged A+B |

### Batch D
| File | Action | Notes |
|------|--------|-------|
| `src/adapters/engines/mssql/map.ts` | Modified | C-1 fix: tableById lookup + parent_object_id resolution for trigger.table |
| `test/adapters/engines/mssql/map.test.ts` | Modified | W-2: 2 new unit assertions (trigger.table = parent table, no phantom node) |
| `test/adapters/engines/mssql/extract.integration.test.ts` | Modified | W-1+C-2: 4 new integration assertions (trigger.table endpoint, no phantom, writes_to dep) |
| `test/adapters/engines/mssql/e2e.integration.test.ts` | Modified | W-1+C-2: 6 new integration assertions (fires_on dst, no stub, writes_to edge, proc dst qnames) |
| `test/fixtures/mssql/golden/golden-raw-catalog.json` | Modified | Regenerated atomically — C-1 fix changes trigger.table value |
| `test/fixtures/mssql/golden/golden-e2e.json` | Modified | Regenerated atomically — C-1 fix changes fires_on dst, stub count |
| `docs/learnings.md` | Modified | L-008 corrected (false negative retracted); L-009 added (endpoint assertion rule) |
| `docs/stories/02-graph-core.md` | Modified | US-007 marked ☑ done; acceptance criteria corrected; L-008 note retracted |
| `.claude/skills/dbgraph-testing/SKILL.md` | Modified | L-009 promoted; false-negative policy; golden discipline updated |
| `.atl/skill-registry.md` | Modified | dbgraph-testing compact rules updated with L-009 + false-negative rule |
| `openspec/changes/phase-3-sqlserver-adapter/state.yaml` | Modified | batch_d: done; verify: pending |
| `openspec/changes/phase-3-sqlserver-adapter/apply-progress.md` | Modified | Batch D merged |

---

## Deviations from Design

1. **RawColumn.extra**: Same as Batch A — computed column info surfaces via intersection type.
   No design change.

2. **Security scanner false-positive on apostrophes (Batch A)**: Fixed in tokenizer.ts JSDoc.

3. **Triangulation skipped for tasks 1.1, 2.1, 2.2, 3.5**: Purely structural or verification-only.

4. **mssql 12.x no bundled types (NEW in Batch B)**: `import('mssql' as string) as unknown as LocalType`
   pattern (mirrors node:sqlite). No @types package needed. Documented as L-005.

5. **Factory also creates MssqlSchemaAdapter in same commit**: Task 3.4 was specified as separate
   from 3.3, but mssql-schema-adapter.ts is required by factory.ts (import). Both were implemented
   in the same commit to avoid a broken intermediate state. Tests for 3.4 are in a separate commit.

6. **Batch D golden regeneration**: Goldens were intentionally deleted and reseeded after C-1 fix.
   Both golden files ran twice to confirm byte-identical determinism before committing.

---

## Learnings (→ docs/learnings.md)

- L-003 (Batch A): JSDoc apostrophes cause US-031 scanner false-positive (avoid in engines/**)
- L-004 (Batch A): RawColumn has no extra field — use intersection type at adapter boundary
- L-005 (Batch B): mssql 12.x no bundled types — use `import('mssql' as string) as unknown as T`
- L-008 (Batch C — RETRACTED in Batch D): original claim that dep view misses trigger DML targets was a false negative; corrected to reflect real (narrower) boundary
- L-009 (Batch D, PROMOTED): edge/graph tests MUST assert both src and dst qnames; existence-only assertions let phantom-stub bugs pass green CI

---

## Remaining Tasks

NONE — all 23 original tasks + 3 remediation tasks complete.

## Status
All tasks complete. Unit: 540 passing. Integration (DBGRAPH_INTEGRATION=1): 47 passing.
next_recommended: sdd-verify (re-run to confirm zero findings after Batch D remediation)
next_recommended: sdd-verify
