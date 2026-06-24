# Archive Report — phase-9.5b-graphstore-node-sqlite

**Project**: dbgraph
**Change**: phase-9.5b-graphstore-node-sqlite
**Branch**: phases-9-and-9-5
**Archived**: 2026-06-19
**Verdict at archive**: PASS — 0 CRITICAL / 0 WARNING (2 cosmetic SUGGESTIONs, deferred)
**Phase 9.5 series**: 9.5a DONE, **9.5b DONE**, 9.5c GATED, 9.5d BLOCKED

---

## What Shipped

### Storage-side SQLite driver port (the storage half of binary-readiness)

The local index write path (`SqliteGraphStore` + `migrations.ts` + `schema.ts`) was decoupled from the
concrete `better-sqlite3` native addon via a single `WritableSqliteHandle` abstraction. This realizes
ADR-005's documented intended state and is the prerequisite for 9.5c self-contained binaries to need
ZERO native modules for storage.

**New file — `src/adapters/storage/sqlite/handle.ts`**
- `StatementHandle` interface: variadic `run/get/all` (handles both `run({id,...})` object binds AND
  positional `run(id, id)` / `all(kind)` / `get(id)`); `run()` always returns `{ changes: number }`.
- `WritableSqliteHandle` interface: `prepare(sql)`, `exec(sql)`, `transaction<T>(fn: () => T): () => T`,
  `pragma(name)` (write-only, void), `close()`.
- `betterSqliteHandle(db)`: thin pass-through over a `better-sqlite3` `Database`; native
  `RunResult.changes` passed through as `{ changes }`. The DEFAULT; byte-identical.
- `nodeSqliteHandle(db: unknown)`: duck-typed wrapper over `node:sqlite` `DatabaseSync` (Node 22.5+, NO
  unconditional top-level import — same tactic as `src/adapters/engines/sqlite/driver.ts`). Key details:
  - Null-prototype row normalization: `prepare().get/all` spread each row into a plain object so
    consumers always receive a standard-prototype object (critical for `toStrictEqual` parity).
  - `{ changes }` normalization from `StatementSync.run` return regardless of native field naming.
  - `transaction<T>(fn)` SYNTHESIZED: returns a callable `() => { exec('BEGIN'); try { const r = fn();
    exec('COMMIT'); return r } catch (e) { exec('ROLLBACK'); throw e } }`. Correct under WAL +
    `foreign_keys = ON` (deferred FK checks fire at COMMIT; ROLLBACK undoes WAL frames). No nested
    transactions in the store, so flat BEGIN is safe.
  - `pragma(name)` → `exec('PRAGMA ' + name)`, discards echo (void).

**Refactored — 4 storage files (pure-additive seam on the default path)**
- `schema.ts`: static top-level `import Database from 'better-sqlite3'` REMOVED; `openRawDb(path,
  driver?)` does a dynamic `import('better-sqlite3')` inside the better path (default) or dynamic
  `await import('node:sqlite' as string)` inside the node path (gated by `isNodeSqliteAvailable()`),
  then wraps and returns a `WritableSqliteHandle`. `pragma('journal_mode = WAL')` +
  `pragma('foreign_keys = ON')` applied via the handle on open.
- `migrations.ts`: `Migration.up(db: Db)` → `up(h: WritableSqliteHandle)`; `runMigrations(db)` →
  `runMigrations(h)`; all `db.*` call sites → `h.*`. Behavior unchanged.
- `sqlite-graph-store.ts`: constructor `(db: Db)` → `(handle: WritableSqliteHandle)`; `Statement` →
  `StatementHandle`; `this.db.transaction(...)` callables → `handle.transaction(...)`; `this.db.close()`
  → `handle.close()`. ALL SQL, `@named` binds, positional binds, FTS delete+reinsert, and
  `StorageError` wrapping unchanged.
- `factory.ts`: `SqliteGraphStoreOptions.driver?: 'better-sqlite3' | 'node:sqlite'` (default
  `'better-sqlite3'`); routes through `openRawDb(path, driver)` → `runMigrations(handle)` → `new
  SqliteGraphStore(handle)`. Node:sqlite version gate: explicit error on Node < 22.5, NO silent
  fallback. `exactOptionalPropertyTypes` honored via conditional spread of `opts.driver`.

**Existing callers unchanged**: `open-connections.ts` and CLI pass no `driver` → stay on
`better-sqlite3` byte-identical. `src/core/ports/graph-store.ts` UNCHANGED (last touched in a prior
phase commit, not in 443cd54 or 6c62f06).

**Driver selection**: `createSqliteGraphStore({ path })` → `better-sqlite3` (default, byte-identical);
`createSqliteGraphStore({ path, driver: 'node:sqlite' })` → node:sqlite parity path (Node 22.5+).

---

## Validation

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (strict, no `any`) | EXIT 0, clean |
| `npm run lint` | EXIT 0, 0 errors / 0 warnings |
| `npm test` (vitest run) | EXIT 0, **2813 passed / 0 failed / 0 skipped**, 164 files |
| Storage suites verbose (4 files) | 106 passed / 0 skipped — node:sqlite legs RAN on Node 22.19 |
| `git diff --exit-code test/golden/` | EXIT 0, **EMPTY** — load-bearing safety net held |
| Working tree | EMPTY — both batches committed (443cd54, 6c62f06), no drift |
| `GraphStore` port | Unchanged — last modified in commit 3f2dad5 (prior phase) |
| SQLite schema | Identical on both drivers (same DDL, `CURRENT_SCHEMA_VERSION = 2`) |

**Runtime**: Node v22.19.0 — `node:sqlite` available; ALL parity, transaction, and portability suites
RAN (not skipped). `ExperimentalWarning SQLite-is-experimental` lines confirm real `DatabaseSync` load.

**Key guarantees proven under real execution**:
- `better-sqlite3` default path is byte-identical (`git diff test/golden/` EMPTY, the no-CI safety net).
- Synthesized `node:sqlite` `transaction(fn)`: COMMITS on normal return (both drivers, committed state
  identical); ROLLS BACK on throw (no partial writes, original error propagates unwrapped, post-rollback
  state empty and identical across both drivers).
- node:sqlite parity E2E: upsertGraph, getNode, getNodesByKind, getNodeByQName, getEdgesFrom/To,
  searchFts (body-by-level + `body_hash`), putSnapshot + getSnapshotObjects manifest, listSnapshots,
  migrate v0→v2 — all `toStrictEqual` the `better-sqlite3` oracle.
- Cross-driver file portability PROVEN both directions: better-sqlite3-written `.dbgraph` opened by
  node:sqlite AND node:sqlite-written `.dbgraph` opened by better-sqlite3 (round-trip `toStrictEqual`,
  `schemaVersion` is 2).
- No static top-level `import 'better-sqlite3'` or `import 'node:sqlite'` survives outside dynamic seams.
  `import type` in `handle.ts` is TYPE-ONLY (compile-erased, zero runtime native load) — permitted.

**Spec compliance**: 11/11 scenarios COMPLIANT. All 12 tasks complete. Definition-of-Done (8 items) all
independently re-verified by sdd-verify.

---

## Stories

| Story | Status | Notes |
|-------|--------|-------|
| US-037 (storage half) | ADVANCED — storage done | Local index write path runs ZERO native modules on `node:sqlite`. Binary-readiness storage prerequisite satisfied for 9.5c. The binary build itself (esbuild/Node-SEA/bun) is 9.5c, gated on the Node-SEA-vs-bun ADR. |

---

## Deferred / Tracked

Two cosmetic SUGGESTIONs from verify-report, non-blocking, no behavior impact:

1. `node-sqlite-parity.test.ts` has two unused helper functions (`buildOracle`, `buildNodeSqlite`)
   silenced with void statements — dead scaffolding, lint-clean, removable for clarity.
2. A few parity assertions use count + per-field `toBe` loops rather than one top-level `toStrictEqual`
   on the whole array (`getNodesByKind` assertions). Equivalent rigor; load-bearing object comparisons
   already use `toStrictEqual`. Minor consistency improvement.

These may be addressed in a future cleanup task or in a 9.5c prep pass. Neither is a spec violation.

---

## Phase 9.5 Series Status

| Phase | Status | Notes |
|-------|--------|-------|
| 9.5a (multi-agent install) | DONE | |
| **9.5b (storage driver port)** | **DONE — this change** | Storage half of binary-readiness complete |
| 9.5c (binaries + release) | GATED | Gate: Node-SEA-vs-bun ADR (user ratification) + CI setup. Storage prerequisite now satisfied by 9.5b. |
| 9.5d (v1.0.0) | BLOCKED | Blocked on benchmark + Phase 7 completion. |

**Branch `phases-9-and-9-5`** is ready for the user's single merge to main once 9.5c is complete.

---

## Next Recommended

`/sdd-new` for the Node-SEA-vs-bun ADR (9.5c gate). Write the ADR document presenting the tradeoffs
(Node-SEA: zero extra tooling, slower startup, no npm scripts; bun: faster startup, new dependency,
potential compat surface) for the user to ratify. Once ratified, 9.5c can begin: binary build
configuration, esbuild/bundler setup, and CI pipeline.

Separately: the branch `phases-9-and-9-5` is clean and ready for a merge-to-main PR whenever the user
decides 9.5c is complete.

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Preserved |
| `design.md` | Preserved |
| `tasks.md` | Preserved (all 12 tasks `[x]`) |
| `specs/graph-storage/spec.md` | Preserved (delta, source for canonical merge) |
| `verify-report.md` | Preserved (PASS, 0 CRITICAL, 0 WARNING) |
| `archive-report.md` | This file |

**Canonical spec updated**: `openspec/specs/graph-storage/spec.md`
- MODIFIED: "GraphStore behavior is observable through the port" (widened to driver-agnostic handle,
  added "The store depends on the handle, not a concrete driver" scenario)
- ADDED: "Storage operates through a driver-agnostic handle"
- ADDED: "better-sqlite3 is the default driver and byte-identical"
- ADDED: "node:sqlite driver parity"
- ADDED: "transaction(fn) semantics match on both drivers"
- ADDED: "No port or schema-shape change across drivers"

**Archive destination** (pending orchestrator `git mv`):
`openspec/changes/archive/2026-06-19-phase-9.5b-graphstore-node-sqlite/`

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (2 batches, commits 443cd54 + 6c62f06) → VERIFY (PASS) → **ARCHIVE (complete)**

The change has been fully planned, implemented, verified, and archived. The SDD cycle is closed.
