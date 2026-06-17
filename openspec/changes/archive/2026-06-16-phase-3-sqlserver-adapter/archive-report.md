# Archive Report: phase-3-sqlserver-adapter

**Change**: phase-3-sqlserver-adapter
**Archived**: 2026-06-16
**Artifact store**: openspec
**Final verdict**: PASS — zero carry-over (Batch D remediation resolved all C-1/C-2/W-1/W-2 findings)

## Executive Summary

Phase 3 (SQL Server adapter) delivered the second concrete `SchemaAdapter` implementation, proving the
hexagonal port contract generalizes beyond SQLite and delivering the first `confidence: parsed`
dependency edges. The change ran through four apply batches (A: pure logic, B: driver/factory/error-map,
C: integration/wiring/CI/docs, D: remediation), an initial verification (FAIL — 2 CRITICAL: phantom
trigger target + false-negative L-008 retraction; 2 WARNING) and a re-verification (PASS — zero
carry-over). Final gates: 540 unit + 47 integration, lint clean, tsc clean, goldens byte-identical
across two runs each. The delta spec is promoted to `openspec/specs/mssql-extraction/spec.md` as the
canonical source of truth. The change is closed.

## What Shipped

### Source deliverables

| Path | Description |
|------|-------------|
| `src/core/ports/schema-adapter.ts` | Added `MssqlAdapterConfig`; widened `SchemaAdapterConfig` to plain structural union (`SqliteAdapterConfig \| MssqlAdapterConfig`). `SqliteAdapterConfig` UNCHANGED — no `dialect` field, back-compat preserved |
| `src/core/ports/index.ts` | Re-exports `MssqlAdapterConfig` |
| `src/core/index.ts` | Re-exports `MssqlAdapterConfig` |
| `src/adapters/engines/mssql/capabilities.ts` | `MSSQL_CAPABILITIES` — procedures, functions, sequences SUPPORTED (differs from SQLite); `supportsBodies=true`, `supportsDependencyHints=true` |
| `src/adapters/engines/mssql/queries.ts` | 12 read-only `sys.*` SELECT constants with explicit ORDER BY (ADR-008); US-031 scanner passes |
| `src/adapters/engines/mssql/tokenizer.ts` | Conservative body tokenizer: `canonicalizeQName`, `classifyAccess`, `hasDynamicSql`, `tokenizeModuleDeps`; pure functions, no DB dependency |
| `src/adapters/engines/mssql/map.ts` | `buildMssqlRawCatalog` — all catalog families, body level-gating, composite FK grouping, included index columns, scalar-vs-TVF distinction, trigger parent-table resolution via `tableById`+`parent_object_id` (C-1 fix in Batch D) |
| `src/adapters/engines/mssql/driver.ts` | `MssqlReadonlyDriver` async seam + `createMssqlReadonlyDriver` pool adapter; duck-typed `PoolLike` keeps `mssql` types out of core |
| `src/adapters/engines/mssql/error-mapper.ts` | `mapMssqlError`: pure error-classifier mapping `ELOGIN`/`ESOCKET`/TLS/Kerberos/permission-denied to typed `ConnectionError`/`PermissionError` |
| `src/adapters/engines/mssql/factory.ts` | `createMssqlSchemaAdapter` — lazy `import('mssql')` (ADR-006); pool connect; SQL/NTLM auth branches; error mapping; missing-driver names `npm i mssql` |
| `src/adapters/engines/mssql/mssql-schema-adapter.ts` | `MssqlSchemaAdapter` — `extract`/`fingerprint`/`close`; parallel `Promise.all` of 11 `sys.*` queries; `sha256(MAX(modify_date)\|COUNT(*))` fingerprint; idempotent `close` with lifecycle guard |
| `src/index.ts` | Exports `createMssqlSchemaAdapter` at composition root (ADR-004 — only join point) |
| `docs/permissions/mssql.md` | Minimal readonly login: `CREATE LOGIN`/`CREATE USER` + `GRANT VIEW DEFINITION` + `GRANT CONNECT` only; no `db_datareader`; prod TLS guidance; troubleshooting table for `PermissionError`/`ConnectionError` scenarios (US-033) |

### Test deliverables

540 unit + 47 integration tests (193 new unit tests added in this phase, starting from 394):

| Layer | Count | Key files |
|-------|-------|-----------|
| Unit (config union) | 7 | config-union.test.ts (type-level) |
| Unit (capabilities) | 21 | capabilities.test.ts |
| Unit (tokenizer) | 29 | tokenizer.test.ts — all 5 write verbs, EXEC/sp_executesql, bracket normalization, isolation |
| Unit (map — all families) | 36 | map.test.ts — tables/columns/PK/FK/CHECK/indexes/views/procs/funcs/triggers/sequences/comments/deps; +2 Batch D: trigger.table=orders, no phantom |
| Unit (driver seam) | 6 | driver.test.ts (fake pool, no mssql) |
| Unit (error-mapper) | 17 | error-mapper.test.ts (synthetic tedious errors, all 7 error classes) |
| Unit (factory) | 12 | factory.test.ts + factory-missing-driver.test.ts |
| Unit (adapter class) | 18 | mssql-schema-adapter.test.ts (fake driver, scope/fingerprint/lifecycle) |
| Security | 8 | security-scan.test.ts — existing scanner, covers mssql automatically |
| Integration (extract + fingerprint) | 26 | extract.integration.test.ts; +4 Batch D: trigger.table endpoint, no phantom, writes_to dep |
| Integration (fingerprint DDL/DML) | 7 | fingerprint.integration.test.ts |
| Integration (E2E full pipeline) | 14 | e2e.integration.test.ts; +6 Batch D: fires_on dst qname, no stub, writes_to edge, proc dst qnames |
| Total | 540 unit + 47 integration | |

### Fixture deliverables

| Path | Description |
|------|-------------|
| `test/fixtures/mssql/torture.sql` | T-SQL torture DDL: 5 tables (products/orders/order_items/audit_log/regions), computed column, composite FK (2-col), PK/UNIQUE/CHECK per table, filtered index WITH INCLUDE, view, scalar fn, inline TVF, sequence, MS_Description on table+column, `sp_place_order` (writes 2 + reads 1), `trg_audit_order_update` AFTER UPDATE (writes audit_log), `sp_dynamic_search` (EXEC dynamic SQL) |
| `test/fixtures/mssql/container.ts` | Testcontainers harness: `mcr.microsoft.com/mssql/server:2022-latest`; SA password strong; `Wait.forListeningPorts()` + poll `SELECT 1` (TDS readiness); GO-split batch apply; `DBGRAPH_INTEGRATION=1` gate; `hookTimeout >= 240000` |
| `test/fixtures/mssql/rows/*.json` | 11 captured `sys.*` row fixture files for unit tests (no DB dependency) |
| `test/fixtures/mssql/golden/golden-raw-catalog.json` | Deterministic golden RawCatalog (regenerated in Batch D — C-1 fix); byte-identical across runs (ADR-008) |
| `test/fixtures/mssql/golden/golden-e2e.json` | Deterministic golden E2E output (regenerated in Batch D — C-1 fix); byte-identical across runs (ADR-008) |

### Gate results (final, post-Batch D re-verification)

| Gate | Command | Result |
|------|---------|--------|
| Unit tests (run 1) | `npm test` | PASS — 540/540 (exit 0) |
| Unit tests (run 2, determinism) | `npm test` | PASS — 540/540, byte-identical (ADR-008) |
| Lint | `npm run lint` | PASS — 0 errors (exit 0) |
| Type check | `npx tsc --noEmit` | PASS — 0 errors (exit 0) |
| Integration (run 1) | `DBGRAPH_INTEGRATION=1 npm run test:integration` | PASS — 47/47, 33.2s (real SQL Server 2022 container) |
| Integration (run 2, determinism) | `DBGRAPH_INTEGRATION=1 npm run test:integration` | PASS — 47/47, 35.5s; goldens byte-identical |
| US-031 write-verb scanner | auto-covered by `npm test security-scan` | PASS — 8/8 |

## Apply Batches

### Batch A — Tasks 1.1–2.4 (config, deps, capabilities, queries, map, tokenizer)

Pure logic, NO DB, NO Testcontainers. Installed `mssql@12.5.5` (optional) and `testcontainers@10.24.1`
(dev). Widened `SchemaAdapterConfig` to a plain structural union (back-compat: no `dialect` on
`SqliteAdapterConfig`). Phase-2 green gate confirmed (401/401). Built `MSSQL_CAPABILITIES` (21 tests),
12 read-only `sys.*` SELECT constants, 11 JSON row fixtures, `tokenizer.ts` (29 tests), `map.ts` (34 tests).
91 new tests. Notable learnings: L-003 JSDoc apostrophes cause US-031 scanner false-positive; L-004
`RawColumn` has no `extra` field — use intersection type.

### Batch B — Tasks 3.1–3.5 (driver seam, error-mapper, factory, adapter class, US-031 scan)

Pure/synthetic, NO DB. Built `MssqlReadonlyDriver` async seam (duck-typed `PoolLike`, 6 tests),
`mapMssqlError` pure error classifier (17 tests, all 7 error classes including Kerberos and
VIEW DEFINITION denial), `createMssqlSchemaAdapter` factory with lazy `import('mssql')` (12 tests),
`MssqlSchemaAdapter` class with lifecycle guard and fingerprint formula (18 tests). US-031 scanner
confirmed green over all mssql files. 53 new tests. Notable learning: L-005 mssql 12.x has no bundled
types — use `import('mssql' as string) as unknown as T` pattern.

### Batch C — Tasks 4.1–5.5 (torture fixture, Testcontainers, goldens, wiring, CI, docs, closeout)

Docker-gated. Created torture.sql T-SQL fixture, Testcontainers harness (poll `SELECT 1` wait strategy,
GO-split batch apply, `DBGRAPH_INTEGRATION=1` gate), extract integration tests + RawCatalog golden (22
tests), fingerprint DDL/DML integration test (CREATE TABLE more reliable than ALTER TABLE — L-007),
E2E integration golden (14 tests). Wired `createMssqlSchemaAdapter` at composition root (`src/index.ts`).
Added `test:integration` script + vitest config split (unit excludes `*.integration.test.ts`). Added
separate `mssql-integration` CI job (Linux-only, `DBGRAPH_INTEGRATION=1`, no `needs:`, never touches
the validation database). Shipped `docs/permissions/mssql.md`. Final gates: 538 unit + 39 integration. Notable learning:
L-008 (LATER RETRACTED IN BATCH D) — recorded incorrectly that dep view misses trigger DML targets.

### Batch D — Remediation: C-1/C-2/W-1/W-2 (TDD red→green per finding)

Strict TDD throughout. 10 new assertions (2 unit + 8 integration).

| Finding | Root cause | Fix | Commits |
|---------|------------|-----|---------|
| C-1 Trigger fires_on phantom stub | `map.ts:541` used `mod.object_name` (trigger name) as parent-table name | Built `tableById = Map<object_id,{schema,name}>` from `input.tables`; resolve trigger.table via `te.parentObjectId → tableById` | fb77f36 |
| C-2 L-008 false negative | `writes_to(trigger→audit_log)` assertion removed based on wrong claim that dep view misses trigger DML targets | Retracted L-008 in `docs/learnings.md`; restored `writes_to` assertion at both extract + e2e integration layers; recorded real (narrower) boundary | b5e7d6c |
| W-1 Edge endpoints unasserted | `e2e.integration.test.ts` asserted `firesOnEdges.length >= 1` only | Added destination-qname assertions for all edges (fires_on dst=dbo.orders, writes_to trigger→audit_log, proc src/dst qnames for writes_to+reads_from) | b5e7d6c |
| W-2 RawTriggerInfo.table contract violated | Same root as C-1 — map used trigger own name | Fixed by C-1 fix; added DB-free map unit test proving `trigger.table.name === 'orders'` and no phantom | fb77f36 |

Goldens regenerated atomically (commit b5e7d6c): each changed by exactly 1 line (trigger.table flip),
confirmed byte-identical across two integration runs post-regeneration. L-009 (edge endpoint assertion
rule) promoted to `dbgraph-testing` skill and `.atl/skill-registry.md` compact rules.

## Story Status at Archive

| Story | Status | Evidence |
|-------|--------|---------|
| US-027 SQL Server extraction adapter | **Done** | All catalog families extracted; torture.sql covers 100% capability matrix; golden RawCatalog + E2E pipeline green; `docs/permissions/mssql.md` ships the minimal login |
| US-007 Body parsing into read/write edges (extraction half) | **Done** | `sp_place_order` writes_to orders+order_items, reads_from products (all `confidence:parsed`, dst-qname asserted); `trg_audit_order_update` fires_on dbo.orders (dst-asserted) + writes_to audit_log (dst-asserted, `confidence:parsed`); `sp_dynamic_search` marked `has_dynamic_sql:true` with zero speculative edges |
| US-009 mssql fingerprint | **Done** | `sha256(MAX(modify_date)\|COUNT(*) over sys.objects WHERE is_ms_shipped=0)`; one query; DDL-moves (CREATE TABLE), DML-stable (INSERT) — proven live |
| US-031 Read-only by construction (mssql) | **Done** | All queries are `sys.*` SELECTs; US-031 write-verb scanner passes (8/8); minimal-permission login in docs; no app-level write path |
| US-033 Minimal permissions + actionable errors (mssql) | **Done** | `docs/permissions/mssql.md` ships `VIEW DEFINITION + CONNECT` only (no `db_datareader`); missing permission → typed `PermissionError` naming the permission + doc link |
| US-034 CI integration job (mssql) | **Done** | `mssql-integration` job added to `.github/workflows/ci.yml`; Linux-only, `DBGRAPH_INTEGRATION=1`, no `needs:`, ephemeral container, never references the validation database |

## Phase Boundaries Documented

| Boundary | Spec reference | Notes |
|----------|----------------|-------|
| Conservative body tokenizer only — no full T-SQL grammar parser (ADR-007) | spec Purpose section + "Dynamic SQL flagged" requirement | Modules with EXEC/sp_executesql → `has_dynamic_sql:true`, no speculative edges; full parser explicitly DEFERRED |
| Tokenizer only reclassifies dep-view edges — does NOT discover write targets absent from `sys.sql_expression_dependencies` | spec "Trigger fires_on" boundary note (L-009/S-2) | Body-driven write-target discovery is future enhancement S-2, NOT Phase-3 obligation |
| Integrated Kerberos SSO unsupported (ADR-006) | spec "Connectivity" requirement; `ConnectionError` message | SQL auth + NTLM with explicit credentials are the supported auth paths |
| Validation against the enterprise database deferred to Phase 6 | proposal Out of Scope | SQL Server adapter ready; dedicated readonly login documented; validation is manual Phase 6 |

## Next Change Pointer

Per the master plan, the strategic next phases are:
- **Phase 4 (CLI/config)** or **Phase 8 (PostgreSQL/MySQL adapter)** — depending on master-plan ordering
- **Phase 6 (that validation)** depends on CLI + MCP being available first; the SQL Server adapter is
  now ready for that validation with the documented `VIEW DEFINITION`-only login

The user/orchestrator should confirm which phase follows based on the current master-plan priority.

Relevant artifacts for any follow-on extraction adapter:
- `openspec/specs/mssql-extraction/spec.md` — this file, now canonical; use as pattern for next adapter
- `openspec/specs/schema-extraction/spec.md` — port contract all adapters must satisfy
- `src/adapters/engines/mssql/` — reference implementation for the hexagonal async adapter pattern
- `src/adapters/engines/sqlite/` — synchronous adapter reference (Phase 2 pattern)
- `.claude/skills/dbgraph-testing/SKILL.md` — updated with L-009 endpoint-assertion rule + false-negative policy
- `docs/learnings.md` — L-003 through L-009 with mssql-specific gotchas

## Specs Merged to Main

| Domain | Action | Path |
|--------|--------|------|
| mssql-extraction | Created (greenfield — new capability, no prior main spec) | `openspec/specs/mssql-extraction/spec.md` |

The spec is a full canonical spec (not an incremental delta). Annotations preserved:
- Honest Phase-3 boundary (conservative tokenizer, full T-SQL parser deferred, no commitment to future phase)
- Body-driven write-target discovery as future enhancement S-2 (added during archive merge)
- L-009 edge-endpoint assertion rule codified in "Trigger fires_on" and "Golden-pinned" requirements
- `DBGRAPH_INTEGRATION=1` gate clarification (not mere Docker presence) in "Committed T-SQL torture fixture" requirement

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/mssql-extraction/spec.md` | Present (delta spec as originally written — canonical version at `openspec/specs/mssql-extraction/spec.md`) |
| `design.md` | Present |
| `tasks.md` | Present (23/23 original tasks + 3 Batch D remediation tasks complete) |
| `apply-progress.md` | Present (Batches A + B + C + D) |
| `verify-report.md` | Present (initial FAIL + Batch D re-verification PASS appended) |
| `state.yaml` | Present (archive: done, change_closed: true) |
| `archive-report.md` | This file |

## SDD Cycle Complete

phase-3-sqlserver-adapter has been fully planned, implemented, verified, and archived.
The `mssql-extraction` capability delta spec is promoted to `openspec/specs/` as the canonical source of truth.
The change folder is closed at `openspec/changes/archive/2026-06-16-phase-3-sqlserver-adapter/`.
