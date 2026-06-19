# Archive Report — phase-8b-mysql

**Change**: phase-8b-mysql (MySQL Schema Extraction Adapter — FOURTH SchemaAdapter)
**Archived**: 2026-06-19
**Branch**: phase-8b-mysql (CI green; merge pending)
**Verify verdict**: PASS — 0 CRITICAL, 2 WARNING (both non-blocking), 2 SUGGESTION
**Batches**: 7 / 7 complete (49/49 tasks)

---

## What Shipped

### Core capability: MysqlSchemaAdapter (the FOURTH SchemaAdapter)

- `src/adapters/engines/mysql/` — 8 flat files mirroring the `pg/` hexagonal template one-for-one:
  `capabilities.ts`, `queries.ts`, `map.ts`, `driver.ts`, `error-mapper.ts`, `tokenizer.ts`,
  `factory.ts`, `mysql-schema-adapter.ts`. No `strategies/` tree.
- `createMysqlSchemaAdapter` is the ONLY join point (ADR-006): lazy `import('mysql2/promise' as string)`,
  connect, map errors, wrap in `MysqlReadonlyDriver` seam, return `MysqlSchemaAdapter`.
- `mysql2/promise` `connection.query()` — text protocol, returns `[rows, fields]`; driver normalizes to
  `rows` (mirrors pg's `result.rows` normalization). Single short-lived connection, NOT a pool.

### Schema == database (D4)

`TABLE_SCHEMA` (the connected database) → `RawObject.schema`; `RawCatalog.schemas = [DATABASE()]`;
every catalog query filtered `WHERE TABLE_SCHEMA = DATABASE()`. NO `schema?` config knob.

### AUTO_INCREMENT as column attribute, no sequence node (D5)

`COLUMNS.EXTRA LIKE '%auto_increment%'` → `ExtendedRawColumn.extra.autoIncrement: true`. `MYSQL_CAPABILITIES`
declares NO `sequence` kind. Golden asserts ZERO sequence objects.

### CHECK_CONSTRAINTS (MySQL 8.0.16+)

CHECK constraints extracted from `information_schema.CHECK_CONSTRAINTS` (`CHECK_CLAUSE`), joined to
`TABLE_CONSTRAINTS`. Floor documented: MySQL 8.0.16+; the torture fixture pins a CHECK.

### VIEW_DEFINITION and ROUTINE_DEFINITION bodies

View bodies from `VIEWS.VIEW_DEFINITION` (server-reparsed/normalized form; may be truncated — honest
caveat documented, NOT a defect; `SHOW CREATE VIEW` intentionally NOT used). Routine bodies from
`ROUTINES.ROUTINE_DEFINITION`. `supportsBodies: true`.

### _shared promotion: maskDynamicStrings + bodyContainsRef (D10, Batch 1)

`maskDynamicStrings` and `bodyContainsRef` PROMOTED from `pg/tokenizer.ts` into
`src/adapters/engines/_shared/tokenizer-core.ts` (exported, engine-agnostic). `pg/tokenizer.ts`
refactored to import them; local copies deleted. PG golden + PG tokenizer suite re-run in the SAME
batch: byte-identical (diff empty). MySQL `tokenizer.ts` consumes the same shared helpers. One source
for the SAFETY-CRITICAL CRITICAL-1 fix — no fork risk.

### Phantom-edge prevention (D9) — 8a CRITICAL-1 designed out from day one

`tokenizeMysqlBody`: (1) `hasMysqlDynamicSql(body)` on original body; (2) `maskDynamicStrings(body)` →
`staticBody`; (3) presence gate — emit edge ONLY if `bodyContainsRef(staticBody, mysqlCanonicalize(qname))`;
(4) `classifyAccess` for direction. NEVER default-to-read; NEVER self-reference. `backtick` canonicalizer
via `String.fromCharCode(96)` (scanner-safe). `PREPARE`/`EXECUTE` → `hasDynamicSql: true`; no
`EXECUTE FUNCTION` strip needed (MySQL triggers have no such clause).

### fingerprint() — DDL-sensitive, stable on DML (D13)

ONE query `SQL_MYSQL_FINGERPRINT`: `COUNT(TABLES) | COUNT(COLUMNS) | COUNT(ROUTINES)` over `DATABASE()`,
SHA-256. Moves on `ADD COLUMN` (`column_count` row changes), `CREATE/DROP TABLE/VIEW`, `CREATE/DROP
PROCEDURE/FUNCTION`. Stable on pure DML. Avoids `MAX(UPDATE_TIME)` (InnoDB flaky until flush).
Returns a 64-char hex string; issues exactly ONE query. Integration-proven: 5 dedicated DDL/DML tests.

### docs/permissions/mysql.md (Batch 6)

Minimal read-only user/grant script: catalog `information_schema` read access only; no broad
table-data grants. Sufficient to extract the full torture schema. `PermissionError` error-mapper
names the privilege AND links to `docs/permissions/mysql.md`.

### Gated mysql:8 Testcontainers + mysql-integration CI job (Batch 7)

`test/fixtures/mysql/torture.sql` — reviewable plain-text `.sql` exercising 100% of `MYSQL_CAPABILITIES`:
`AUTO_INCREMENT`, generated column, composite FK, CHECK, functional/prefix/composite index, view, a
routine writing 2 tables + reading 1, a dynamic `PREPARE`/`EXECUTE` routine (mask-gate proof), a trigger
(`AFTER UPDATE ON orders`), `TABLE_COMMENT`/`COLUMN_COMMENT`.

`test/fixtures/mysql/container.ts` — `mysql:8` image; wait-strategy = poll `SELECT 1` over a REAL
`mysql2` connection; `multipleStatements: true` on the seed connection; `MysqlContainerHandle { config,
stop() }`.

Goldens: `test/fixtures/mysql/golden/golden-raw-catalog.json` + `test/fixtures/mysql/golden/golden-e2e.json`
— byte-identical on every re-run (ADR-008).

`.github/workflows/ci.yml` — `mysql-integration` job (Linux-only, `needs: []`, `DBGRAPH_INTEGRATION=1`,
separate from unit matrix). Mirrors the `pg-integration` pattern. Never blocks the unit matrix.

---

## Validation

### Test counts (final gate, Batch 7 closeout)

| Suite | Count | Result |
|-------|-------|--------|
| Unit (`npm test`) | 1 935 tests, 125 files | PASS |
| Integration (`DBGRAPH_INTEGRATION=1 npm run test:integration`) | 206 tests, 10 files | PASS |
| Type-check (`npx tsc --noEmit`) | — | PASS |
| Lint (`npm run lint`) | 0 errors / 0 warnings | PASS |
| Write-verb scanner (`security-scan.test.ts` over `engines/**`) | — | PASS |

Docker 29.5.3. Integration tested against real `mysql:8`, `postgres:16`, and SQL Server containers.

### Edge correctness — 8a phantom-edge CRITICAL designed out and golden-pinned phantom-free

All routines and views in the torture golden carry EXACT-set edge assertions (not existence-only):

| Object | Edge set | Phantom check |
|--------|----------|---------------|
| `v_order_summary` (view) | EXACTLY `reads_from app.order_items` + `reads_from app.orders` | NOT products (absent from body) |
| `proc_place_order` (procedure) | EXACTLY `writes_to app.order_items` + `writes_to app.orders` + `reads_from app.products` — 3 edges | NOT audit_log |
| `fn_audit_write` (function) | EXACTLY `writes_to app.audit_log` — 1 edge | 0 reads |
| `proc_dynamic_query` | `hasDynamicSql: true`, ZERO edges | orders masked inside CONCAT string |
| `trg_after_order_update` | `table = orders`, `events = [UPDATE]`, `timing = AFTER` | no phantom stub |

E2E: `stubCount === 0`, `selfEdges.length === 0` over the whole graph. Golden byte-identical on re-run.

### _shared promotion byte-identical (PG + MSSQL unchanged)

`git diff merge-base HEAD` on PG and MSSQL golden fixtures is EMPTY. pg+mssql suites green in the
integration run. `pg/tokenizer.ts` imports `maskDynamicStrings` and `bodyContainsRef` from `_shared/`
with NO local copies.

### factory.ts mysql2/promise API correction (Batch 7 closeout)

`createConnectionFn` returns `Promise<ConnectionLike>` (auto-connected on Promise resolution). No
`.connect()` call. Unit fake mirrors the real API faithfully.

### Pinned error + exit-code.ts unchanged

`src/core/errors.ts` message: `Available dialects: sqlite, mssql, pg, mysql.`
`git diff merge-base HEAD src/cli/exit-code.ts` is EMPTY.
`exitCodeFor(new UnsupportedDialectError(...)) === 4` via `instanceof` — proven unchanged.

### mysql2 in optionalDependencies only

`package.json optionalDependencies.mysql2 = "^3.22.5"`. NOT in `dependencies` or `devDependencies`.
Lazy import. No other new runtime dependency.

### Determinism + read-only scanner

Golden byte-stable: two extractions on the same torture fixture produce byte-identical output.
`security-scan.test.ts` over `engines/**` green: all `queries.ts` SELECTs pass, no write-verb
false-positive. No apostrophes or quoted examples in `mysql/**` JSDoc; `String.fromCharCode(96)`
backtick is scanner-safe.

---

## Stories Closed

| Story | Scope | Status |
|-------|-------|--------|
| US-029 | MySQL adapter (Phase 8b) — MySQL 8 ONLY; `mysql:8` Testcontainers, `mysql2` driver | done (phase-8b-mysql) |
| US-033 (mysql) | `docs/permissions/mysql.md` + actionable `PermissionError` (errno 1044/1142/1143/1370 → named privilege + doc link) | done (phase-8b-mysql) |

US-033 overall status remains `partial` — the restricted-user integration test is a known deferred item
(restricted MySQL user setup is costly to automate; full extraction under the torture user has been
manually validated but not yet added to the gated integration suite).

---

## Deferred / Tracked Follow-ups

| Item | Priority | Tracking |
|------|----------|---------|
| WARNING-2: No apply-progress TDD-evidence artifact (Engram disconnected this session; openspec dir has none) | Low | Ensure `apply-progress` is persisted on future sessions. TDD adherence confirmed indirectly (full RED/GREEN test files exist per batch, all green, pg/mssql safety-net byte-identical). |
| S-2: Add explicit `docs/permissions/mysql.md` doc-link test assertion in `error-mapper.test.ts` | Low | Consider pinning the US-033 doc-link contract explicitly (mapper already includes the link; an assertion pins it against drift). |
| S-1: design.md File-Changes table omits `build-config.ts` (mysql ordered-source branch) and `resolve-secrets.ts` (resolveMysqlSource) | Cosmetic | The design is being archived; the omission is noted here for the record only — no action needed. |
| US-031: US-031 scanner JSDoc-quote fragility (extractStringLiterals apostrophe/double-quote edge cases) | Low | Tracked on US-031 as a known open question. |
| MariaDB sequences/`EVENT` objects | Deferred | Pre-planned `phase-8c-mariadb`. Out of scope for phase-8b by design. |
| US-033: Restricted-user integration test | Deferred | Full extraction under a minimal-privilege MySQL user validated manually; automation is costly. Add in a future security pass. |

---

## Next Change: resilient-connectivity

The next recommended change is `resilient-connectivity` — refine and spec/design/tasks/apply the
deferred E8 proposal covering connection reliability and resilience (retry, timeout, health-check, and
the F-1..F-9 findings from the original E8 exploration). Start with `/sdd-new resilient-connectivity`
or `/sdd-ff resilient-connectivity`.

---

## Spec Sync Summary

| Spec | Action | Details |
|------|--------|---------|
| `openspec/specs/mysql-extraction/spec.md` | CREATED (new canonical) | Full canonical spec for the MySQL adapter — 16 Requirements, 35 Scenarios. Resolved from the change's delta spec (new capability, no prior canonical). |
| `openspec/specs/schema-extraction/spec.md` | UPDATED (delta applied) | `SchemaAdapterConfig` union gains `MysqlAdapterConfig`; stale `host` JSDoc corrected; union non-discriminability documented; `SUPPORTED_DIALECTS` now `sqlite, mssql, pg, mysql`; `capabilitiesFor('mysql')` added; `UnsupportedDialectError` message updated to `sqlite, mssql, pg, mysql`; exit-code-4 guard confirmed unchanged; `maskDynamicStrings`/`bodyContainsRef` promotion recorded in the body-tokenizer primitives requirement. |

---

## Archive Location

Change folder to be moved by the orchestrator (git mv — no Bash available at archive time):

```
openspec/changes/phase-8b-mysql/
  → openspec/changes/archive/2026-06-19-phase-8b-mysql/
```

Git command:

```
git mv openspec/changes/phase-8b-mysql openspec/changes/archive/2026-06-19-phase-8b-mysql
```
