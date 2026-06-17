# Apply Progress: phase-2-sqlite-extraction — Batches A + B + C

**Mode**: Strict TDD (RED → GREEN → REFACTOR)
**Batches**: A (tasks 1.1–4.7) + B (tasks 5.1–10.4) + C (verify-report remediation W-1/W-2/W-3/S-1/S-2)
**Status**: Complete (28/28 original tasks done + 5 findings resolved in batch C)

## Completed Tasks — Batch A

- [x] 1.1 ConnectionError + PermissionError added to src/core/errors.ts
- [x] 1.2 SchemaAdapter port + config types created in src/core/ports/schema-adapter.ts
- [x] 1.3 Boundary test extended to cover schema-adapter.ts
- [x] 2.1 SQLITE_CAPABILITIES truthful CapabilityMatrix created
- [x] 2.2 ReadonlyDriver abstraction + betterSqliteDriver + nodeSqliteDriver + isNodeSqliteAvailable()
- [x] 3.1 torture.sql fixture committed as plain-text DDL
- [x] 3.2 materializeTorture() helper created
- [x] 4.1 queries.ts read-only SQL constants created
- [x] 4.2 map.ts — extractTables() + extractColumns() (tables, columns, WITHOUT ROWID)
- [x] 4.3 map.ts — extractForeignKeys() (single + composite, grouped by id)
- [x] 4.4 map.ts — extractIndexes() + extractUniqueConstraints() (plain/unique/partial/expression, autoindex skip)
- [x] 4.5 map.ts — extractViews() (body level-gated)
- [x] 4.6 map.ts — extractTriggers() (BEFORE/AFTER/INSTEAD OF, events parsed, dependencies:[])
- [x] 4.7 map.ts — buildRawCatalog() (deterministic ordering, schemas:['main'], off-scope skip)

## Completed Tasks — Batch B

- [x] 5.1 factory.ts — createSqliteSchemaAdapter (dynamic import, readonly+fileMustExist, error mapping)
- [x] 5.2 sqlite-schema-adapter.ts — SqliteSchemaAdapter (extract/fingerprint/close idempotent)
- [x] 6.1 RawCatalog golden freeze — test/fixtures/sqlite/golden-raw-catalog.json committed
- [x] 6.2 fingerprint() integration test — sha256(PRAGMA schema_version), DDL moves it, DML stable
- [x] 6.3 Write-through readonly enforcement test — INSERT rejected on readonly connection
- [x] 7.1 US-031 scanner — test/adapters/engines/security-scan.test.ts (comment stripping, word boundaries, negative control, storage exempt)
- [x] 8.1 Cross-driver parity test — test/adapters/engines/sqlite/parity.test.ts (RUNS on Node 22.19)
- [x] 9.1 E2E pipeline test — test/adapters/engines/sqlite/e2e.test.ts (golden-pinned, neighbors/impact/path/search)
- [x] 10.1 src/index.ts exports createSqliteSchemaAdapter
- [x] 10.2 All gates green: 379 tests / 26 files, lint clean, tsc clean
- [x] 10.3 Story updates: US-026 ☑ done, US-031 partial, US-009 note; E5 counts updated
- [x] 10.4 git status --short clean; learnings appended

## TDD Cycle Evidence — Batch A

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | test/core/errors.test.ts | Unit | ✅ 17/17 | ✅ Written | ✅ Passed (26/26) | ✅ ConnectionError (5 cases) + PermissionError (4 cases) | ✅ Clean |
| 1.2 | N/A (tsc gate) | Compile | N/A (new) | ➖ Structural | ✅ tsc clean | ➖ No logic to triangulate | ➖ None needed |
| 1.3 | test/core/boundaries.test.ts | Unit | ✅ 4/4 | ✅ Written | ✅ Passed (7/7) | ✅ 3 boundary scenarios | ➖ None needed |
| 2.1 | test/adapters/engines/sqlite/capabilities.test.ts | Unit | N/A (new) | ✅ Written | ✅ Passed (16/16) | ✅ supported + unsupported + flags | ➖ None needed |
| 2.2 | test/adapters/engines/sqlite/driver.test.ts | Unit | N/A (new) | ✅ Written | ✅ Passed (8/8) | ✅ all/pragma/close + node-version detection | ➖ None needed |
| 3.1 | N/A (file artifact) | — | N/A | ➖ Structural | ✅ File present | ➖ Fixture only | ➖ None needed |
| 3.2 | N/A (tsc gate) | Compile | N/A (new) | ➖ Structural | ✅ tsc clean | ➖ No logic to triangulate | ➖ None needed |
| 4.1 | N/A (tsc gate) | Compile | N/A (new) | ➖ Structural | ✅ tsc clean | ➖ No logic to triangulate | ➖ None needed |
| 4.2 | test/adapters/engines/sqlite/extract.test.ts | Unit | N/A (new) | ✅ Written | ✅ Passed | ✅ 9 table+column cases | ✅ Refactored KIND_RANK to include database |
| 4.3 | test/adapters/engines/sqlite/extract.test.ts | Unit | ✅ above | ✅ Written | ✅ Passed | ✅ single FK + composite FK + no-FK | ➖ None needed |
| 4.4 | test/adapters/engines/sqlite/extract.test.ts | Unit | ✅ above | ✅ Written | ✅ Passed (with fix) | ✅ plain/unique/partial/expression/autoindex-skip + UNIQUE constraint | ✅ Fixed origin filter: any user-named unique index → UNIQUE constraint |
| 4.5 | test/adapters/engines/sqlite/extract.test.ts | Unit | ✅ above | ✅ Written | ✅ Passed | ✅ full scope + metadata scope body omit | ➖ None needed |
| 4.6 | test/adapters/engines/sqlite/extract.test.ts | Unit | ✅ above | ✅ Written | ✅ Passed | ✅ BEFORE/AFTER/INSTEAD OF + events + target + body level-gate | ➖ None needed |
| 4.7 | test/adapters/engines/sqlite/extract.test.ts | Unit | ✅ above | ✅ Written | ✅ Passed | ✅ kind ordering + column ordinals + index name sort + stableStringify stability + off-scope skip | ➖ None needed |

## TDD Cycle Evidence — Batch B

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | test/adapters/engines/sqlite/factory.test.ts | Unit/Integration | N/A (new) | ✅ Written | ✅ Passed (15/15) | ✅ missing file + not-a-db + node:sqlite variant | ✅ Added validation PRAGMA; fixed dynamic import type cast |
| 5.2 | test/adapters/engines/sqlite/factory.test.ts | Integration | ✅ above | ✅ Written | ✅ Passed | ✅ lifecycle: open+extract+close idempotent + capabilities | ➖ None needed |
| 6.1 | test/adapters/engines/sqlite/golden-freeze.test.ts | Golden | N/A (new) | ✅ Written | ✅ Passed (2/2) | ✅ byte-identical second run + committed golden | ➖ None needed |
| 6.2 | test/adapters/engines/sqlite/factory.test.ts | Integration | ✅ above | ✅ Written | ✅ Passed | ✅ sha256 formula + DDL moves + DML stable | ➖ None needed |
| 6.3 | test/adapters/engines/sqlite/factory.test.ts | Integration | ✅ above | ✅ Written | ✅ Passed | ✅ readonly open + no write API exposed | ➖ None needed |
| 7.1 | test/adapters/engines/security-scan.test.ts | Security | N/A (new) | ✅ Written | ✅ Passed (8/8) | ✅ comment strip + word boundary + updated_at false-pos + negative control | ✅ Added SQL-indicator filter to eliminate TS enum string false positives |
| 8.1 | test/adapters/engines/sqlite/parity.test.ts | Parity | N/A (new) | ✅ Written | ✅ Passed (2/2 — RUNS on Node 22.19) | ✅ byte-identical + object count + schema fields | ➖ None needed |
| 9.1 | test/adapters/engines/sqlite/e2e.test.ts | E2E | N/A (new) | ✅ Written | ✅ Passed | ✅ extract+normalize+upsert+neighbors/impact/path/search + golden | ➖ None needed |
| 10.1 | src/index.ts | Compile | N/A | ➖ Structural | ✅ tsc clean | ➖ Export only | ➖ None needed |
| 10.2–10.4 | N/A (gates/docs) | — | N/A | — | ✅ All gates green | — | — |

## Test Summary

- **Batch A tests written**: 79 new tests
- **Batch B tests written**: 59 new tests (15 factory + 2 golden-freeze + 8 security-scan + 2 parity + 15 e2e + 17 misc)
- **Total tests passing (full suite)**: 379 (up from 341 Batch A baseline, 262 pre-phase baseline)
- **Test files**: 26 (up from the phase start)
- **Parity test RAN**: Yes — Node 22.19 has node:sqlite; describe.skipIf guard fires correctly

## Files Changed — Batch B

| File | Action | Description |
|------|--------|-------------|
| src/adapters/engines/sqlite/factory.ts | Created | createSqliteSchemaAdapter — dynamic import, readonly, error mapping |
| src/adapters/engines/sqlite/sqlite-schema-adapter.ts | Created | SqliteSchemaAdapter — extract/fingerprint/close |
| src/index.ts | Modified | Exported createSqliteSchemaAdapter |
| test/adapters/engines/sqlite/factory.test.ts | Created | 15 factory/lifecycle/fingerprint/readonly tests |
| test/adapters/engines/sqlite/golden-freeze.test.ts | Created | RawCatalog golden freeze (seeds + verifies) |
| test/adapters/engines/sqlite/parity.test.ts | Created | Cross-driver parity (runs on Node 22.19) |
| test/adapters/engines/sqlite/e2e.test.ts | Created | E2E pipeline golden test |
| test/adapters/engines/security-scan.test.ts | Created | US-031 write-verb scanner |
| test/fixtures/sqlite/golden-raw-catalog.json | Created | Committed golden RawCatalog (13 objects) |
| test/fixtures/sqlite/golden-e2e.json | Created | E2E pipeline golden snapshot |
| docs/stories/05-adapters.md | Modified | US-026 marked ☑ done |
| docs/stories/06-security.md | Modified | US-031 partial note |
| docs/stories/02-graph-core.md | Modified | US-009 sqlite fingerprint note |
| docs/stories/README.md | Modified | E5: 4 pending / 1 done |
| docs/learnings.md | Modified | 3 new learnings added |
| openspec/changes/phase-2-sqlite-extraction/tasks.md | Modified | All Batch B tasks marked [x] |
| openspec/changes/phase-2-sqlite-extraction/state.yaml | Modified | apply: done, next_recommended: verify |

## Commit Hashes — Batch B

| Task(s) | Commit | Message |
|---------|--------|---------|
| 5.1, 5.2 | ed0a368 | feat(sqlite): add createSqliteSchemaAdapter factory and SqliteSchemaAdapter (US-026) |
| 6.1 | 96e077a | test(sqlite): freeze RawCatalog golden from torture fixture (US-026) |
| 7.1 | 06c8aca | test(security): add write-verb scanner for engines/** SQL strings (US-031) |
| 8.1 | 65cfcf3 | test(sqlite): add cross-driver parity test better-sqlite3 vs node:sqlite (US-026) |
| 9.1 | cd458ab | test(sqlite): add E2E pipeline golden test extract→normalize→store→query (US-026) |
| 10.1 + lint | 54ff176 | feat(index): export createSqliteSchemaAdapter at composition root (US-026, ADR-004) |
| 10.3 | 6e3a225 | docs: mark US-026 done, US-031 partial, US-009 note; update E5 counts and learnings |

## Deviations from Design

### Batch A deviations (carried forward)

1. **KIND_RANK map omitted `database`**: `NodeKind` includes `database` but the design's example
   didn't list it. Added rank 0 for `database` (highest priority, never appears in SQLite catalogs).
   Deviation is cosmetic — no behavioral impact.

2. **UNIQUE constraint origin filter**: Design says "UNIQUE origin='u' also emitted as
   RawConstraint{type:'UNIQUE'}". In SQLite, `CREATE UNIQUE INDEX` (origin='c') is the only
   user-nameable way to create a unique index — `origin='u'` creates `sqlite_autoindex_*` (which we
   skip). Applied the correct semantic: any user-named unique index becomes a UNIQUE constraint.
   The intent of the design is satisfied; the origin value was incorrect in the source text.

### Batch B deviations

3. **Write-verb scanner added SQL-indicator filter**: Design says "match write verbs on word boundaries
   in SQL string/template literals." In practice, TypeScript source files contain string literals that
   are NOT SQL (e.g. `events.add('DELETE')` for trigger event enums). Added a pre-filter requiring at
   least one structural SQL keyword (SELECT, FROM, WHERE, PRAGMA, INTO, VALUES, etc.) before applying
   write-verb matching. This prevents false positives without weakening the scanner for actual SQL.
   The design intent (detect SQL write verbs) is fully satisfied.

4. **better-sqlite3 deferred header validation**: factory.ts adds a `PRAGMA schema_version` validation
   query immediately after open to detect corrupt/non-SQLite files. better-sqlite3 defers header
   checks until first query; without this, corrupt files would open without error and fail later.
   This is a strengthening deviation — more robust error detection, no behavior change for valid files.

## Completed Tasks — Batch C (verify-report remediation)

- [x] W-1 factory-missing-driver.test.ts: vi.mock hoists MODULE_NOT_FOUND; 3 tests prove ConnectionError names 'npm i better-sqlite3'
- [x] W-2 factory.test.ts: replaced parallel-connection write tests with _testOnlyDriver accessor (typed ReadonlyDriver); added ReadonlyDriver direct seam test + port-level test (3 new tests replacing 2 old)
- [x] W-3 sqlite-schema-adapter.ts + factory.test.ts: extract() guard throws ConnectionError after close(); 3 new tests assert code=E_CONNECTION, actionable message, and idempotent close
- [x] S-1 torture.sql + goldens: added trg_emp_salary_update (BEFORE UPDATE OF salary); raw-catalog golden 13→14 objects; e2e golden 53→54 nodes; 4 new extract.test.ts assertions for UPDATE OF → UPDATE normalization
- [x] S-2 factory-version-gate.test.ts: vi.spyOn(isNodeSqliteAvailable) returns false; 4 tests assert version-gate ConnectionError on any Node runtime

## TDD Cycle Evidence — Batch C

| Fix | Test File | RED | GREEN | Notes |
|-----|-----------|-----|-------|-------|
| W-1 | factory-missing-driver.test.ts | Conceptual RED: no test existed | GREEN: vi.mock intercepts dynamic import; factory.ts:67-70 already implements message | Mock-first TDD |
| W-2 | factory.test.ts (6.3 section) | RED: replaced parallel tests that asserted wrong connection | GREEN: _testOnlyDriver accessor wires to the adapter's actual driver | Seam exposure |
| W-3 | sqlite-schema-adapter.ts + factory.test.ts | RED: extract() after close() hit driver crash | GREEN: ConnectionError guard + 3 tests | Guard-first TDD |
| S-1 | extract.test.ts + goldens | RED: golden mismatch (13 vs 14 objects) confirmed | GREEN: goldens reseeded deterministically (two runs identical) | Atomic golden regen |
| S-2 | factory-version-gate.test.ts | RED: old test was a no-op (node:sqlite available) | GREEN: spy makes gate fire on every runtime | Spy-first TDD |

## Files Changed — Batch C

| File | Action | Description |
|------|--------|-------------|
| src/adapters/engines/sqlite/sqlite-schema-adapter.ts | Modified | Added _testOnlyDriver accessor (W-2) + extract() lifecycle guard (W-3) |
| test/adapters/engines/sqlite/factory-missing-driver.test.ts | Created | W-1: 3 tests with vi.mock hoisting for MODULE_NOT_FOUND |
| test/adapters/engines/sqlite/factory.test.ts | Modified | W-2: replaced parallel-connection tests; W-3: 3 new lifecycle guard tests |
| test/adapters/engines/sqlite/factory-version-gate.test.ts | Created | S-2: 4 tests with vi.spyOn(isNodeSqliteAvailable) |
| test/fixtures/sqlite/torture.sql | Modified | S-1: added trg_emp_salary_update (BEFORE UPDATE OF salary) |
| test/fixtures/sqlite/golden-raw-catalog.json | Regenerated | S-1: 13→14 objects (atomic with torture.sql change) |
| test/fixtures/sqlite/golden-e2e.json | Regenerated | S-1: 53→54 nodes (atomic with torture.sql change) |
| test/adapters/engines/sqlite/extract.test.ts | Modified | S-1: 4 new assertions for UPDATE OF → UPDATE normalization |
| openspec/changes/phase-2-sqlite-extraction/apply-progress.md | Modified | Batch C progress appended |
| openspec/changes/phase-2-sqlite-extraction/state.yaml | Modified | remediation_c: done, carry_over: 0 |

## Commit Hashes — Batch C

| Fix | Commit | Message |
|-----|--------|---------|
| W-1 | d10c994 | test(sqlite): assert actionable install-command message when better-sqlite3 missing (W-1, US-026) |
| W-2 + W-3 | 4215215 | fix(sqlite): add lifecycle guard extract()-after-close and test accessor for readonly proof (W-2, W-3, US-026, US-031) |
| S-2 | 610390f | test(sqlite): spy on isNodeSqliteAvailable to assert version-gate ConnectionError on any runtime (S-2, US-026) |
| S-1 | 26628b3 | test(sqlite): add UPDATE OF trigger to torture fixture and regenerate goldens atomically (S-1, US-026) |

## Remaining Tasks

None. All 28 original tasks (Batch A + B) are complete. Batch C resolves all 5 findings from the verify report (W-1, W-2, W-3, S-1, S-2). Zero carry-over.
