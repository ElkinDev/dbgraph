# Proposal: GraphStore storage-side node:sqlite driver parity (phase-9.5b)

## Intent

The ENGINE side is already driver-dual (`ReadonlyDriver` + `betterSqliteDriver`/`nodeSqliteDriver`),
but the STORAGE side is `better-sqlite3`-only: `schema.ts` does a STATIC top-level
`import Database from 'better-sqlite3'` (line 13), and `SqliteGraphStore`/`migrations.ts` are typed
against the native `Database`. A self-contained binary CANNOT bundle a native addon, so the local
`.dbgraph` index write path is the last hard native dependency. Porting storage to a
driver-agnostic handle that ALSO runs on the built-in `node:sqlite` (Node 22+) realizes ADR-005's
documented intended state (better-sqlite3 on npm, node:sqlite for binaries, the `GraphStore` port
absorbs the duality) and is the PREREQUISITE for 9.5c binaries to need ZERO native modules.
Success: identical observable storage behavior on both drivers, better-sqlite3 path byte-identical.

## Scope

### In Scope
- `WritableSqliteHandle` interface + `betterSqliteHandle(db)` and `nodeSqliteHandle(rawHandle)` (mirror the engine-side readonly pattern, writable surface).
- Refactor `schema.ts`, `migrations.ts`, `sqlite-graph-store.ts` to consume the HANDLE (not native `Db`); `factory.ts` selects driver, wraps, passes handle.
- `transaction(fn)` abstraction: native helper on better-sqlite3; `BEGIN`/`COMMIT`/`ROLLBACK`-on-throw on node:sqlite (correct under WAL + foreign_keys).
- node:sqlite parity test path (`:memory:` on Node 22) running the same E2E as better-sqlite3.

### Out of Scope
- Binaries / esbuild / Node-SEA / bun build / release workflow — **9.5c** (gated on the Node-SEA-vs-bun ADR + CI).
- The driver-choice ADR itself; v1.0.0 (9.5d).
- Engine-side adapters (already dual); the `GraphStore` port (NO change — see Capabilities).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `graph-storage`: add a requirement that storage behavior is driver-AGNOSTIC — every existing scenario MUST hold identically on both `better-sqlite3` (default) and `node:sqlite`, selected explicitly at the factory. No change to the port, the schema, the round-trip, FTS, body_hash, snapshot, or migration requirements; only the driver seam widens.

## Approach

Approach A (per explore — consistency, no duplication; NOT two-factory Approach B). Define ONE
`WritableSqliteHandle` covering the EXACT surface storage uses: `prepare()` (statements expose
`run`/`get`/`all` with `@named` and `?` positional binds), `exec()`, `transaction(fn)`, `pragma()`,
`close()`. `betterSqliteHandle` is a thin pass-through. `nodeSqliteHandle` duck-types `node:sqlite`'s
`DatabaseSync` (typed `unknown`, no unconditional import — same tactic as `driver.ts`) and synthesizes
`transaction(fn)` from BEGIN/COMMIT/ROLLBACK. `node:sqlite` supports `@name` binds (Node 22.5+), so NO
SQL rewrites; if a bind dialect differs, the handle normalizes inside `prepare`. Driver selected via a
`SqliteGraphStoreOptions.driver?` ('better-sqlite3' default | 'node:sqlite'), no silent fallback —
default path stays byte-identical, so all existing goldens/tests are untouched.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/storage/sqlite/handle.ts` | New | `WritableSqliteHandle` + both handle factories + `transaction` synthesis. |
| `src/adapters/storage/sqlite/schema.ts` | Modified | Remove static `import Database`; `openRawDb` becomes driver-parameterized, returns a handle. |
| `src/adapters/storage/sqlite/migrations.ts` | Modified | Type against handle; `exec`/`prepare`/`transaction` via handle. |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | Modified | Constructor takes handle; `Statement`/`Db` types → handle types. |
| `src/adapters/storage/sqlite/factory.ts` | Modified | Driver selection + handle wrapping (mirror engine `factory.ts`). |
| `src/core/ports/graph-store.ts` | None | Async port already the seam — UNCHANGED. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `transaction(fn)` WAL/foreign_keys incorrectness on node:sqlite | Med | Pin commit-path + rollback-on-throw tests under WAL + FK pragmas; reuse better-sqlite3 result as oracle. |
| Goldens drift under NO-CI policy | Med | better-sqlite3 stays the DEFAULT, unchanged; run full suite + goldens locally; require byte-identical before merge. |
| Named-param / RunResult.changes parity gap | Low | Confirm `@name` + `info.changes` on node:sqlite (Node 22.5+); normalize in handle if needed; cover with parity test. |
| better-sqlite3 reframed as optional/native dep | Low | Keep it a default prod dep on npm path; node:sqlite is builtin — no package.json behavior change in 9.5b. |

## Rollback Plan

Pure-additive seam on the default path. Revert: restore the static `import Database` and native `Db`
typing in the four storage files, delete `handle.ts` and the node:sqlite test path. No schema, data,
or port migration — the `.dbgraph` DB file format is identical across both drivers.

## Dependencies

- 9.5a (multi-agent install) DONE. Node 22+ locally for the node:sqlite test path (`:memory:`).
- Engine-side `driver.ts` pattern (precedent to mirror). No CI dependency (9.5b is locally TDD-testable).

## Success Criteria

- [ ] All existing storage tests + ALL goldens BYTE-IDENTICAL on the better-sqlite3 (default) path.
- [ ] A node:sqlite path passes the SAME E2E in-memory parity suite (round-trip, FTS, migrate v0→v2, snapshots, transaction commit + rollback).
- [ ] `tsc` strict + lint + test clean; no `any`; determinism (ADR-008) preserved.
- [ ] No change to `GraphStore` port or DB schema; static `better-sqlite3` import removed from `schema.ts`.
- [ ] US-037 (storage half): the local index write path runs with ZERO native modules on node:sqlite — binary-readiness prerequisite satisfied.

## Recommended Apply Batch Ordering

1. `handle.ts` — `WritableSqliteHandle` + `betterSqliteHandle` (RED→GREEN against existing behavior).
2. Refactor `schema.ts`/`migrations.ts`/`sqlite-graph-store.ts`/`factory.ts` to the handle on the better-sqlite3 path — goldens stay green.
3. `nodeSqliteHandle` + `transaction` synthesis; pin commit + rollback tests.
4. node:sqlite E2E parity test path; final byte-identical golden + strict-build gate.
