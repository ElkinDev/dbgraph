# Verification Report — phase-9.5b-graphstore-node-sqlite

**Change**: phase-9.5b-graphstore-node-sqlite
**Spec capability**: graph-storage (delta)
**Mode**: Strict TDD
**Branch**: phases-9-and-9-5 (both batches committed: 443cd54, 6c62f06)
**Runtime**: Node v22.19.0 (node:sqlite available, parity suites RAN not skipped)
**Verdict**: PASS (clean, no CRITICAL, no WARNING)

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 12 (Batch 1: 1.1-1.6, Batch 2: 2.1-2.6) |
| Tasks complete | 12 |
| Tasks incomplete | 0 |

All tasks marked done. Definition-of-Done checklist (8 items) all done and independently re-verified below.

## The Gate (full, real execution)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | EXIT 0, clean, strict, no any |
| Lint | npm run lint (eslint .) | EXIT 0, 0 errors / 0 warnings |
| Tests | npm test (vitest run) | EXIT 0, 2813 passed / 0 failed / 0 skipped across 164 files |
| Storage suites verbose | 4 storage test files | 106 passed / 0 skipped, node:sqlite legs RAN |
| Golden byte-identical | git diff --exit-code test/golden/ | EXIT 0, EMPTY (load-bearing safety net intact) |
| Working tree | git status --porcelain | EMPTY, both batches committed, no drift |

The ExperimentalWarning SQLite-is-experimental lines confirm node:sqlite was actually loaded; the parity,
transaction and portability suites executed against a real DatabaseSync, not the skip path.

## PRIORITY Scrutiny Verdicts

### 1. Byte-identical default path (HIGHEST, no CI) PASS
- createSqliteGraphStore with path and no driver routes through openRawDb(path, better-sqlite3) (factory.ts:67
  conditional spread to schema.ts default param better-sqlite3).
- The better path dynamically imports better-sqlite3 INSIDE openRawDbBetterSqlite (schema.ts:146); it is the
  DEFAULT and unchanged; no silent fallback to node:sqlite.
- git diff --exit-code test/golden/ EMPTY means every golden (incl. round-trip oracle
  test/golden/normalize/catalog-minimal.json) byte-identical. The refactor leaked ZERO behavior.
- The round-trip golden test (round-trip matches normalize golden, deep equal) passed.
- VERDICT: default path is byte-identical and remains better-sqlite3. No drift.

### 2. transaction(fn) correctness (the one non-trivial diff) PASS
- nodeSqliteHandle.transaction (handle.ts:197-209) returns a CALLABLE that synthesizes:
  exec(BEGIN) then try { r = fn(); exec(COMMIT); return r } catch (e) { exec(ROLLBACK); throw e }. Matches
  better-sqlite3 .transaction() call-site contract (returned fn invoked separately; upsertGraph, deleteNodes,
  putSnapshot, runMigrations all do: const t = handle.transaction(...); t();).
- COMMIT proven on BOTH drivers (committed rows visible; committed state identical across both drivers).
- ROLLBACK-on-throw proven on BOTH drivers: failed transaction leaves no partial writes (rows.length is 0);
  original error type propagates not wrapped (instanceof MyError); post-rollback state identical across both
  drivers and empty (toStrictEqual, length 0).
- The original error propagates unwrapped (throw error, no rewrap). No partial state on throw.
- VERDICT: rollback cannot leave partial state; error propagates. Correct.

### 3. node:sqlite parity PROVEN PASS
- node-sqlite-parity.test.ts ran the SAME E2E ops (upsertGraph, getNode, getNodesByKind, getNodeByQName,
  getEdgesFrom/To, searchFts incl. body_hash, putSnapshot + getSnapshotObjects manifest, listSnapshots,
  migrate v0-to-v2) against a node:sqlite store and toStrictEqual the better-sqlite3 oracle in the same test.
  All RAN on Node 22.19 (not skipped).
- Null-prototype normalization: nodeSqliteHandle prepare get and all spread each row into a plain object
  (handle.ts:174,178); no consumer sees a null-proto row; toStrictEqual passes.
- Cross-driver file portability PROVEN both directions: better-sqlite3-written db read by node:sqlite AND
  node:sqlite-written db read by better-sqlite3 (toStrictEqual round-trip, schemaVersion is 2).

### 4. No port or schema change PASS
- src/core/ports/graph-store.ts last modified in commit 3f2dad5 (a PRIOR phase), NOT in either phase-9.5b
  commit (443cd54, 6c62f06). Port genuinely unchanged. Type-level compile assertion (15 methods) passes.
- Schema identical on both drivers (same SCHEMA_V1_DDL + SNAPSHOT_OBJECTS_DDL via the shared migrations
  runner; CURRENT_SCHEMA_VERSION is 2). schemaVersion 2 on node:sqlite and snapshot_objects table exists
  after migration on node:sqlite both passed.
- RunResult.changes parity: node:sqlite changes/lastInsertRowid normalized to changes-only (handle.ts:
  165-166). Proven by run with object/positional bind returns changes number.

### 5. No static native import survives PASS
- schema.ts: NO static top-level import of better-sqlite3; dynamic await import of better-sqlite3 inside the
  better path only (schema.ts:146). node:sqlite via dynamic await import of node:sqlite-as-string
  (schema.ts:166), gated by isNodeSqliteAvailable() (schema.ts:156) with an explicit throw, no fallback.
- handle.ts:15 has import-type Database-as-BetterSqliteDb from better-sqlite3, a TYPE-ONLY import (erased at
  compile, zero runtime native load). Explicitly permitted by spec/tasks (import type allowed; only static
  VALUE imports forbidden). NOT a violation.
- migrations.ts, sqlite-graph-store.ts, factory.ts: no driver import of any kind (only intra-package + core
  type imports). Confirmed by grep.

### 6. Strict TS, no any PASS
- npx tsc --noEmit EXIT 0 under strict + exactOptionalPropertyTypes. Grep for any-annotation, as-any,
  angle-bracket-any and any-array across the storage source: ZERO hits. The duck-typed NodeSqliteDb and
  NodeSqliteStatement interfaces (handle.ts:118-132) are explicitly typed; the raw handle enters as unknown
  and is cast once at the boundary. exactOptionalPropertyTypes honored via conditional spread of opts.driver
  in factory.ts:67.

## Spec Compliance Matrix

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| GraphStore behavior observable through port (MODIFIED) | Store depends on the handle not a concrete driver | handle/schema/store tests + grep | COMPLIANT |
| Storage operates through a driver-agnostic handle | Same store behavior holds on either driver | node-sqlite-parity E2E toStrictEqual | COMPLIANT |
| Storage operates through a driver-agnostic handle | node:sqlite handle has no unconditional import | schema.ts dynamic import + grep | COMPLIANT |
| better-sqlite3 default and byte-identical | Default path preserves existing behavior and goldens | full suite + git diff test/golden EMPTY | COMPLIANT |
| better-sqlite3 default and byte-identical | No silent driver fallback on default path | factory default + explicit node gate throw | COMPLIANT |
| node:sqlite driver parity | node:sqlite in-memory store passes same behavior | node-sqlite-parity (12 E2E tests) | COMPLIANT |
| node:sqlite driver parity | Schema migrate v0-to-v2 runs on node:sqlite | schema.test schemaVersion is 2 on node:sqlite | COMPLIANT |
| transaction(fn) semantics match on both drivers | Commit on normal return (both drivers) | handle.test COMMIT both + identical-state | COMPLIANT |
| transaction(fn) semantics match on both drivers | Rollback on throw leaves no partial writes (both) | handle.test ROLLBACK both + identical-empty | COMPLIANT |
| No port or schema-shape change across drivers | Identical schema shape on both drivers | schema.test node:sqlite migrate + snapshot_objects | COMPLIANT |
| No port or schema-shape change across drivers | Port unchanged and file format portable | type-level assertion + cross-driver portability | COMPLIANT |

Compliance summary: 11/11 scenarios COMPLIANT. Every node:sqlite-dependent scenario RAN on Node 22.19.

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Single WritableSqliteHandle (not two factories) | Yes | one interface, all 4 files type against it |
| Synthesize transaction(fn) on node:sqlite | Yes | BEGIN/try-COMMIT/catch-ROLLBACK-throw, returns callable |
| pragma() write-only on storage seam | Yes | node path maps to exec PRAGMA, discards echo |
| named bind dialect, no SQL rewrites | Yes | all binds verbatim; variadic StatementHandle |
| Driver selection via factory option, default better-sqlite3 | Yes | optional driver defaults better-sqlite3 |

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (nice to have):
- node-sqlite-parity.test.ts has two unused helper functions buildOracle and buildNodeSqlite (silenced with
  void statements). Dead scaffolding, harmless, lint-clean, removable for clarity. Non-blocking.
- A few parity assertions use count + per-field toBe rather than one top-level toStrictEqual on the whole
  array (getNodesByKind loops field-by-field). Equivalent rigor. Load-bearing object comparisons (getNode,
  getNodeByQName, manifest, portability) already use toStrictEqual. Non-blocking.

## Verdict

PASS. Implementation is complete and behaviorally compliant with the graph-storage delta. The two
highest-risk guarantees hold under real execution: the better-sqlite3 default path is byte-identical (golden
diff empty, the no-CI safety net), and the synthesized node:sqlite transaction(fn) commits on return and
rolls back on throw with no partial writes and unwrapped error propagation, proven equal to the better-sqlite3
oracle. Port and schema unchanged; no static native import survives; strict TS, no any. Ready for sdd-archive.
