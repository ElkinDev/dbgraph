# Archive Report: phase-8a-pg

**Change**: phase-8a-pg — PostgreSQL Schema Extraction Adapter
**Archived**: 2026-06-18
**PR**: #6 (merged to main, commit 8433352)
**Verification verdict**: PASS WITH WARNINGS — 26/26 requirements compliant, 0 CRITICAL open

---

## What Shipped

### Core Deliverable

The THIRD concrete `SchemaAdapter`: `PgSchemaAdapter` under `src/adapters/engines/pg/`, implementing the
EXISTING port UNCHANGED (no port SHAPE change). Wired via `createPgSchemaAdapter` as the sole join point
through `open-connections.ts` + `src/index.ts`.

### Architecture

- **Adapter shape**: thin class + `PgReadonlyDriver` seam (SQLite-shape, not MSSQL strategy registry);
  lazy `import('pg')` in `factory.ts` (ADR-006). A single short-lived `Client` per extraction run.
- **`PgAdapterConfig`**: host-keyed structural union member (`host` discriminator; `server` = MSSQL,
  `file` = SQLite). Fields: `host`, `port?` (default 5432), `database`, `user`, `password` (env-only
  `${env:VAR}`), `ssl?: boolean | { rejectUnauthorized?: boolean }`, `schema?` (optional scoping).
- **Extracted objects**: schemas (`pg_namespace`); tables/columns/types/defaults/identity & generated
  columns (`pg_class`/`pg_attribute`/`pg_attrdef`); PK/FK/unique/CHECK (`pg_constraint` +
  `pg_get_constraintdef`); indexes including partial/expression/included columns (`pg_index` +
  `pg_get_indexdef`); views and materialized views (`pg_class.relkind 'v'/'m'` + `pg_get_viewdef`);
  functions/procedures (`pg_proc prokind 'f'/'p'` + `pg_get_functiondef`); triggers (`pg_trigger` +
  `tgtype` bitmask); sequences (`pg_sequence`); comments (`obj_description`/`col_description`).
- **Materialized views**: emitted as `kind: 'view'` + `extra.materialized: true`. NO new `NodeKind`
  (promotion deferred).
- **Shared tokenizer**: `engines/_shared/tokenizer-core.ts` extracted from `mssql/tokenizer.ts`;
  MSSQL refactored to import from `_shared/` with BYTE-IDENTICAL goldens. PG supplies its own
  `hasDynamicSql` (`/\bexecute\b/i` minus `EXECUTE FUNCTION|PROCEDURE` trigger-DDL clause) and
  double-quote-only canonicalizer. `_shared/` is the sole artifact `phase-8b-mysql` consumes.
- **Body tokenization**: `confidence: 'parsed'`; `supportsDependencyHints: false` (body tokenizer is
  the SOLE edge source, no `pg_depend`). Dynamic `EXECUTE` → `hasDynamicSql: true`, no fabricated edges.
  Static edges survive alongside dynamic flag via `maskDynamicStrings` (masks only single-quoted
  dynamic-string contents; static operands outside survive `classifyAccess`). `bodyContainsRef` gate
  prevents phantom edges to objects not present in the body.
- **`fingerprint()`**: ONE query — `SELECT MAX(pg_class.oid), MAX(pg_attribute.attnum), COUNT(DISTINCT
  pg_class.oid), COUNT(pg_attribute.attnum)` over non-system schemas via `LEFT JOIN pg_attribute`
  (attnum > 0, NOT attisdropped). SHA-256 over all four components. Stable across DML; moves on DDL
  (including `ALTER TABLE ... ADD COLUMN`, proven by integration test).
- **Read-only posture**: minimal-privilege ROLE (`docs/permissions/pg.md`); catalog SELECTs only; no
  `SET SESSION READ ONLY`. Engines write-verb scanner stays green. `String.fromCharCode(34)` trick
  builds the double-quote-stripping regex without embedding a literal that the naive scanner misreads
  (ADR-007).
- **Error mapping**: `mapPgError` (pure) — SQLSTATE `28P01`/`28000` → `ConnectionError` (auth);
  `42501` → `PermissionError` naming the privilege + linking `docs/permissions/pg.md`; `3D000`/`08*`
  → `ConnectionError`; `MODULE_NOT_FOUND` → `ConnectionError('npm i pg')`; else → actionable fallback.

### Dispatch Touch Points (6 mechanical changes)

| Touch point | Change |
|---|---|
| `src/core/ports/schema-adapter.ts` | `PgAdapterConfig` added; `SchemaAdapterConfig` union extended |
| `src/infra/config/schema.ts` | `'pg'` added to `SUPPORTED_DIALECTS`; `PgSource` shape added |
| `src/infra/config/parse-config.ts` | `parsePgSource` + `case 'pg'` branch; env-only password enforced |
| `src/infra/open-connections.ts` | `createPgSchemaAdapter` wired into `AdapterAndStore` union + dispatch |
| `src/index.ts` | `case 'pg'` in `capabilitiesFor()`; `PG_CAPABILITIES` + `createPgSchemaAdapter` re-exported |
| `src/core/errors.ts` | `UnsupportedDialectError` message updated to list `sqlite, mssql, pg` (pinned assertion + code-4 regression guard in same batch; `exit-code.ts` untouched) |

### New Files

| File | Description |
|---|---|
| `src/adapters/engines/_shared/tokenizer-core.ts` | Shared `canonicalizeQName`, `classifyAccess`, `extractWriteTargets`, `WRITE_VERB_PATTERNS` |
| `src/adapters/engines/pg/driver.ts` | `PgReadonlyDriver`, `ClientLike`, `createPgReadonlyDriver` |
| `src/adapters/engines/pg/capabilities.ts` | `PG_CAPABILITIES` |
| `src/adapters/engines/pg/queries.ts` | Catalog SELECT constants + `SQL_PG_FINGERPRINT` |
| `src/adapters/engines/pg/map.ts` | `buildPgRawCatalog` — deterministic `RawCatalog`, `engine: 'pg'` |
| `src/adapters/engines/pg/error-mapper.ts` | `mapPgError` (SQLSTATE → typed errors) |
| `src/adapters/engines/pg/tokenizer.ts` | PG `hasDynamicSql` + `tokenizePgBody` wiring `_shared/` |
| `src/adapters/engines/pg/factory.ts` | `createPgSchemaAdapter` |
| `src/adapters/engines/pg/pg-schema-adapter.ts` | `PgSchemaAdapter` |
| `docs/permissions/pg.md` | Minimal read-only role (CONNECT + USAGE + SELECT on catalogs) |
| `test/fixtures/pg/torture.sql` | Reviewable torture schema exercising 100% of `PG_CAPABILITIES` |
| `test/fixtures/pg/container.ts` | Testcontainers harness (`postgres:16`, poll-`SELECT 1` wait) |
| `test/fixtures/pg/golden-raw-catalog.json` | Pinned `RawCatalog` (edgeCount: 47, stubCount: 0) |
| `test/fixtures/pg/golden-e2e.json` | Pinned E2E pipeline output |

---

## Validation

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run lint` | PASS (0 errors / 0 warnings) |
| `npm test` (unit, vitest) | PASS — 1739 passed / 113 files / 0 failed |
| `DBGRAPH_INTEGRATION=1 npm run test:integration` (real `postgres:16`) | PASS — 140 passed / 8 files / 0 failed |

**Verify**: PASS WITH WARNINGS (sdd-verify report 2026-06-18, commit 8433352)
- 26/26 requirement-groups fully compliant
- 0 CRITICAL open
- CRITICAL-1 (phantom edges), WARNING-1 (suppress-all dynamic branch), SUGGESTION-1 (ssl type),
  SUGGESTION-2 (fingerprint attnum) all RESOLVED with remediation R1

### Remediation History

- **R1** (commit 8433352): fixed CRITICAL-1 phantom-edge defect (`bodyContainsRef` gate in
  `pg/tokenizer.ts:216`; removed suppress-all dynamic branch from `pg/map.ts:578-583`);
  golden-e2e.json edgeCount 68→47, stubCount 2→0; added 7 unit + 12 integration exact-set
  negative assertions.
- **R2** (same commit): resolved NEW-1 — `maskDynamicStrings` isolates single-quoted dynamic
  content so static edges survive alongside `hasDynamicSql: true`; design.md updated (ssl type).

### Stories Closed

- **US-028** (PostgreSQL adapter, Phase 8a) — complete
- **US-028a** (shared body-tokenizer module) — complete
- **US-028b** (materialized views without a model change) — complete
- **US-031/033/034** — advanced for `pg` (read-only posture, permission doc, actionable errors)

### E2E Graph

- **47 edges / 0 stubs** in the normalized graph from the torture schema (golden-pinned, byte-identical)

---

## Deferred Follow-Ups

These items are non-blocking and must be tracked for future changes:

| Item | Tracking location | Description |
|---|---|---|
| WARNING-2: restricted-role negative E2E | `docs/stories/06-security.md:35` (PENDING) | A user without USAGE (pg) receiving the actionable `PermissionError` via a live negative integration test. Positive path proven at unit + superuser-integration level. |
| NEW-1: missing combined static+dynamic regression guard | `docs/stories/` or quality spec | No test exercises a routine with BOTH a reliable static INSERT/UPDATE AND a dynamic EXECUTE keeping the static edge while flagging `hasDynamicSql: true`. Code path correct; regression guard absent. Add one `tokenizePgBody` unit test. |
| NEW-2: `bodyContainsRef` simple-name aliasing | quality/resilience spec | `bodyContainsRef` uses word-boundary matching; could in principle match a column or alias sharing a table name. Long-term: restrict reads to FROM/JOIN operands (symmetric with write-verb operand extraction). Non-blocking; all current goldens exact. |
| `pg_depend` OID-graph edges | future phase | `supportsDependencyHints: false` in Phase-8a; full `pg_depend`/`pg_rewrite` mapping deferred. |
| Materialized-view first-class NodeKind | future phase | Matviews ship as `kind: 'view'` + `extra.materialized: true`; promotion to a first-class kind is deferred. |
| US-031 scanner apostrophe/quote fragility | quality spec | `extractStringLiterals` false spans on apostrophes/smart-quotes; JSDoc fragility noted for future hardening. |

---

## Next Change

**`phase-8b-mysql`** — MySQL/MariaDB schema-extraction adapter (pre-planned; zero carry-over from 8a;
sole artifact consumed from 8a is `engines/_shared/tokenizer-core.ts`).

---

## Specs Synced (Canonical Sources of Truth Updated)

| Canonical spec | Action | Details |
|---|---|---|
| `openspec/specs/pg-extraction/spec.md` | **CREATED** | New capability spec (17 requirements, all scenarios from the verified implementation) |
| `openspec/specs/schema-extraction/spec.md` | **UPDATED** | (1) "SchemaAdapter port" requirement: `PgAdapterConfig` union sentence + `pg` driver in the driver-free scenario + new `SchemaAdapterConfig union includes the pg variant` scenario. (2) ADDED: "Supported dialects, capabilitiesFor and UnsupportedDialectError recognize pg" requirement (3 scenarios). (3) ADDED: "Body-tokenizer primitives factored into a shared module with no MSSQL behavior change" requirement (3 scenarios). |

---

## Archive Location

Folder to move: `openspec/changes/phase-8a-pg/`
Destination: `openspec/changes/archive/2026-06-18-phase-8a-pg/`

Git command (orchestrator to execute):
```
git mv openspec/changes/phase-8a-pg openspec/changes/archive/2026-06-18-phase-8a-pg
```

---

## Artifact Inventory (change folder, all present)

- `proposal.md`
- `design.md`
- `tasks.md` (47/47 tasks `[x]`)
- `verify-report.md` (PASS WITH WARNINGS, 2026-06-18, commit 8433352)
- `specs/pg-extraction/spec.md`
- `specs/schema-extraction/spec.md`
- `archive-report.md` (this file)

---

## SDD Cycle Status

COMPLETE. Phase-8a-pg was fully planned, implemented (7 batches, 47 tasks, PR #6), verified
(PASS WITH WARNINGS, 26/26 compliant), and archived. Canonical specs updated. Ready for
`phase-8b-mysql`.
