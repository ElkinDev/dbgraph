# Archive Report: phase-2-sqlite-extraction

**Change**: phase-2-sqlite-extraction
**Archived**: 2026-06-12
**Artifact store**: openspec
**Final verdict**: PASS — zero carry-over (Batch C remediation resolved all W-1/W-2/W-3/S-1/S-2 findings)

## Executive Summary

Phase 2 (SQLite extraction) shipped the `SchemaAdapter` port and the first concrete extraction
adapter, proving the full E2E pipeline (source db → extract → normalize → store → query) with zero
infrastructure. The change ran through two apply batches (A + B), a first verification pass (PASS
WITH WARNINGS — 3 warnings, 2 suggestions), and a Batch C remediation cycle that resolved every
finding before archiving. Final gate: 394/394 tests, lint clean, tsc clean, deterministic across two
byte-identical runs. Both delta specs are promoted to canonical main specs. The change is closed.

## What Shipped

### Source deliverables

| Path | Description |
|------|-------------|
| `src/core/ports/schema-adapter.ts` | `SchemaAdapter` port interface — dialect, capabilities, extract/fingerprint/close |
| `src/core/ports/index.ts` | Re-exports `SchemaAdapter`, `SchemaAdapterConfig`, `SqliteAdapterConfig` |
| `src/core/index.ts` | Re-exports port types and new error classes |
| `src/core/errors.ts` | Added `ConnectionError` (E_CONNECTION) and `PermissionError` (E_PERMISSION), both extending `DbgraphError` with `cause` and actionable messages |
| `src/adapters/engines/sqlite/capabilities.ts` | `SQLITE_CAPABILITIES` — truthful matrix: supports table/column/constraint/index/view/trigger; NO procedure/function/sequence/collection |
| `src/adapters/engines/sqlite/driver.ts` | `ReadonlyDriver` interface + `betterSqliteDriver` + `nodeSqliteDriver` adapters + `isNodeSqliteAvailable()` |
| `src/adapters/engines/sqlite/queries.ts` | Read-only SQL constants: sqlite_master + PRAGMA table_info/foreign_key_list/index_list/index_info/schema_version |
| `src/adapters/engines/sqlite/map.ts` | PRAGMA rows → RawObject[]; deterministic ordering (kind-rank, schema, name); extractTables/Columns/FKs/Indexes/Views/Triggers/buildRawCatalog |
| `src/adapters/engines/sqlite/factory.ts` | `createSqliteSchemaAdapter` — explicit driver selection, dynamic import, readonly+fileMustExist, error mapping, validation PRAGMA |
| `src/adapters/engines/sqlite/sqlite-schema-adapter.ts` | `SqliteSchemaAdapter` — extract/fingerprint/close idempotent; lifecycle guard (extract-after-close → ConnectionError); `_testOnlyDriver` accessor |
| `src/index.ts` | Exports `createSqliteSchemaAdapter` at composition root |

### Test deliverables

394 tests across 26+ files (132 new tests added in this phase, up from 262 at phase start):

| Layer | Count | Key files |
|-------|-------|-----------|
| Unit (errors, boundary, capabilities, driver) | ~57 | errors.test.ts, boundaries.test.ts, capabilities.test.ts, driver.test.ts |
| Unit (mappers — extract) | ~60 | extract.test.ts (tables, columns, FKs, indexes, views, triggers, ordering, golden) |
| Integration (factory, lifecycle, fingerprint, readonly) | ~25 | factory.test.ts, factory-missing-driver.test.ts, factory-version-gate.test.ts |
| Golden | 2 | golden-freeze.test.ts (byte-identical RawCatalog; 14 objects post-S-1) |
| Security | 8 | security-scan.test.ts (US-031 write-verb scanner with negative control) |
| Parity | 2 | parity.test.ts (better-sqlite3 vs node:sqlite; RUNS on Node 22.19) |
| E2E | ~15 | e2e.test.ts (extract→normalize→upsert→neighbors/impact/path/search; golden-pinned; 54 nodes post-S-1) |
| Total | 394 | 26+ test files |

### Gate results (final, post-Batch C)

| Gate | Command | Result |
|------|---------|--------|
| Tests (run 1) | `npm test` | PASS — 394/394 (exit 0) |
| Tests (run 2, determinism) | `npm test` | PASS — 394/394, byte-identical (ADR-008) |
| Lint | `npm run lint` | PASS — 0 errors, 0 warnings (exit 0) |
| Type check | `npx tsc --noEmit` | PASS — 0 errors (exit 0) |
| Git tree | `git status --short` | PASS — clean |

CI matrix: Node 22.x / 24.x (Node 20 dropped; `engines.node >=22` in package.json; ADR-001 amended for Node 20 EOL).

## Apply Batches

### Batch A — Tasks 1.1–4.7 (port, errors, driver seam, mappers)

Built `ConnectionError`/`PermissionError`, the `SchemaAdapter` port, hexagonal boundary extension,
`SQLITE_CAPABILITIES`, the `ReadonlyDriver` abstraction, torture.sql fixture, materializeTorture()
helper, and all PRAGMA mappers (tables, columns, PKs, FKs, indexes, views, triggers) with deterministic
ordering. 79 new tests. Notable deviation: UNIQUE constraint origin filter corrected (design said
`origin='u'`; empirically `CREATE UNIQUE INDEX` produces `origin='c'`; applied correct semantic —
design text was wrong).

### Batch B — Tasks 5.1–10.4 (factory, golden, parity, security, E2E, wiring, closeout)

Built `createSqliteSchemaAdapter` factory (dynamic import, readonly+fileMustExist, error mapping,
validation PRAGMA), `SqliteSchemaAdapter`, RawCatalog golden freeze (13 objects), fingerprint
integration test, write-through readonly enforcement, US-031 write-verb scanner with negative control,
cross-driver parity test (RUNS on Node 22.19), E2E golden pipeline, and composition-root wiring.
59 new tests. Notable deviation: scanner added SQL-indicator pre-filter to prevent TS enum-string false
positives while preserving actual SQL detection (re-proven live).

### Batch C — Verify-report remediation (W-1, W-2, W-3, S-1, S-2)

| Finding | Resolution | Commits |
|---------|------------|---------|
| W-1 Missing-driver install-command untested | `factory-missing-driver.test.ts` with `vi.mock` hoisting MODULE_NOT_FOUND; 3 tests assert ConnectionError message contains `npm i better-sqlite3` | d10c994 |
| W-2 Readonly write-through via parallel connection | Replaced parallel tests with `_testOnlyDriver` @internal accessor; ReadonlyDriver direct seam test + port-level test (3 tests replacing 2) | 4215215 |
| W-3 extract-after-close unguarded | Added lifecycle guard in `sqlite-schema-adapter.ts:66-69`; 3 tests assert ConnectionError code=E_CONNECTION, actionable message, and idempotent close | 4215215 |
| S-1 UPDATE OF branch unexercised | Added `trg_emp_salary_update` (BEFORE UPDATE OF salary) to torture.sql; goldens regenerated atomically (13→14 objects / 53→54 nodes); 4 new extract.test.ts assertions | 26628b3 |
| S-2 Version-gate test no-op on Node >=22.5 | `factory-version-gate.test.ts` with `vi.spyOn(isNodeSqliteAvailable)` returning false; 4 tests assert version-gate ConnectionError on any runtime | 610390f |

All 5 findings resolved. Zero carry-over confirmed by orchestrator re-check (394/394, lint, tsc, tree clean).

## Story Status at Archive

| Story | Status | Evidence |
|-------|--------|---------|
| US-026 SQLite extraction adapter | **Done** | Adapter extracts all SQLite object types; torture.sql materialization; golden RawCatalog; E2E pipeline green; `.sql` criterion supersedes `.db` criterion (annotated in spec + story) |
| US-031 Read-only by construction + write-verb scanner | **Partial** — scanner done (security-scan.test.ts), readonly-by-connection done (factory, tests), per-engine permission docs and README security section pending (Phase 3+) | factory.test.ts W-2 + security-scan.test.ts |
| US-009 Schema fingerprint (SQLite part) | **Partial** — SQLite fingerprint via `sha256(PRAGMA schema_version)` done; per-engine fingerprint abstraction + `diff snapA snapB` deferred to Phase 3 / Phase 5 | factory.test.ts 6.2 section |

## Phase Boundaries Documented

| Deferral | Target phase | Spec reference |
|----------|-------------|----------------|
| Full SQL-body dependency parsing into reads_from/writes_to edges | Phase 3 (US-027, SQL Server adapter) | `schema-extraction` spec: "deferred body parsing" requirement; `sqlite-extraction` spec: "honest minimal dependency hints" requirement |
| .sql supersedes .db fixture criterion | Locked Phase-2 decision (no deferral needed) | `sqlite-extraction` spec: Purpose section supersede note |
| Per-engine fingerprint abstraction + diff snapA snapB | Phase 3 / Phase 5 | US-009 story note |
| Per-engine README security documentation | Phase 3+ | US-031 partial note in docs/stories/06-security.md |

## Next Change Pointer

**Phase 3 (per master plan): SQL Server adapter** — implement `SchemaAdapter` for SQL Server using
Testcontainers, NTLM/SQL authentication, and `sys.sql_expression_dependencies` for reads/writes
dependency parsing. This is the first phase to parse SQL bodies into `confidence: parsed` edges
(US-027), which is the body-parsing deferral annotated in Phase 2 specs.

Alternatively, **Phase 4 CLI** if the master plan prioritises the command-line interface before
additional engine adapters. Check `docs/master-plan.md` for the confirmed ordering.

Relevant artifacts for Phase 3:
- `openspec/specs/schema-extraction/spec.md` — `SchemaAdapter` port contract Phase 3 adapters must satisfy
- `src/core/ports/schema-adapter.ts` — port interface
- `src/adapters/engines/sqlite/` — reference implementation for the hexagonal adapter pattern
- `docs/stories/03-sql-server.md` (or equivalent) — US-027 and related SQL Server stories
- `docs/adr/ADR-004.md` — hexagonal boundary rules; SQL Server adapter goes in `src/adapters/engines/sqlserver/`

## Specs Merged to Main

| Domain | Action | Path |
|--------|--------|------|
| schema-extraction | Created (greenfield — new capability) | `openspec/specs/schema-extraction/spec.md` |
| sqlite-extraction | Created (greenfield — new capability) | `openspec/specs/sqlite-extraction/spec.md` |

Both specs are full canonical specs (not incremental deltas). All deferral annotations are preserved
(full body parsing deferred to Phase 3; .sql supersede note for US-026).

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/schema-extraction/spec.md` | Present (deferral annotations preserved) |
| `specs/sqlite-extraction/spec.md` | Present (.sql supersede note + body-parsing deferral preserved) |
| `design.md` | Present |
| `tasks.md` | Present (28/28 complete) |
| `apply-progress.md` | Present (Batches A + B + C) |
| `verify-report.md` | Present (initial PASS WITH WARNINGS + Orchestrator re-check PASS appended) |
| `state.yaml` | Present (archive: done, change_closed: true) |
| `archive-report.md` | This file |

## SDD Cycle Complete

phase-2-sqlite-extraction has been fully planned, implemented, verified, and archived.
Both capability delta specs are promoted to `openspec/specs/` as canonical source of truth.
The change folder is closed at `openspec/changes/archive/2026-06-12-phase-2-sqlite-extraction/`.
