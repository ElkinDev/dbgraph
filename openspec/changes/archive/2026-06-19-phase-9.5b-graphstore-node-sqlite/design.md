# Design: GraphStore storage-side node:sqlite driver parity (phase-9.5b)

## Technical Approach

Approach A from the proposal: ONE `WritableSqliteHandle` interface in `src/adapters/storage/sqlite/handle.ts`
that captures the EXACT writable surface `SqliteGraphStore` + `migrations.ts` use. Two thin adapters:
`betterSqliteHandle(db)` (pass-through) and `nodeSqliteHandle(db)` (duck-typed `node:sqlite`, mirrors
engine `driver.ts`). `schema.ts`/`migrations.ts`/`sqlite-graph-store.ts` type against the handle, never
native `Db`. `factory.ts` selects the driver and wraps the raw handle. better-sqlite3 stays the DEFAULT
and byte-identical; node:sqlite is opt-in. Port `graph-store.ts` UNCHANGED.

## Architecture Decisions

### Decision: Single writable handle interface (not two factories)
**Choice**: One `WritableSqliteHandle` consumed by all four storage files. | **Alternatives**: two parallel store classes (Approach B); generic `Db` cast. | **Rationale**: one logic path, no query duplication, mirrors engine-side `ReadonlyDriver`. ADR-004 boundary preserved.

### Decision: Synthesize `transaction(fn)` on node:sqlite
**Choice**: better-sqlite3 delegates to native `.transaction()`; node:sqlite synthesizes `exec('BEGIN')` → `try{ r=fn(); exec('COMMIT'); return r } catch(e){ exec('ROLLBACK'); throw e }`. | **Alternatives**: SAVEPOINT nesting; rely on autocommit. | **Rationale**: better-sqlite3 wraps `fn` and returns a callable; we must return a `(...args)=>T` to match call sites (`upsert()`, `del()`, `migrate()`). BEGIN/COMMIT/ROLLBACK is correct under WAL + foreign_keys (deferred FK checks fire at COMMIT; ROLLBACK undoes WAL frames). No nested transactions exist in the store, so flat BEGIN is safe.

### Decision: `pragma()` is write-only on the storage seam
**Choice**: handle `pragma(name)` only needs to SET (`journal_mode=WAL`, `foreign_keys=ON`) — no caller reads a pragma return. node:sqlite maps `pragma(s)` → `db.exec('PRAGMA ' + s)`. | **Alternatives**: return parsed rows (engine `ReadonlyDriver` does). | **Rationale**: storage never consumes the result; `schemaVersion` reads `meta` via `prepare().get()`, not a pragma. Keep the surface minimal.

### Decision: `@named` bind dialect, no SQL rewrites
**Choice**: keep all existing `@name` and `?` binds verbatim. | **Alternatives**: rewrite to `$name`/`:name`. | **Rationale**: node:sqlite (Node 22.5+) `StatementSync` accepts `@name` named binds and `?` positional binds — same as better-sqlite3. If a future Node normalizes differently, normalize INSIDE `nodeSqliteHandle.prepare` only.

### Decision: Driver selection via factory option, default better-sqlite3
**Choice**: `SqliteGraphStoreOptions.driver?: 'better-sqlite3' | 'node:sqlite'` (default `'better-sqlite3'`), mirroring engine `SqliteAdapterConfig.driver`. No silent fallback. | **Alternatives**: env-var auto-detect; runtime probe. | **Rationale**: explicit selection keeps the default path deterministic; `openConnections`/CLI call `createSqliteGraphStore({ path })` with no `driver`, so they stay on better-sqlite3 byte-identical.

## Data Flow

    createSqliteGraphStore({path, driver?})
        │ default → openRawDb(path,'better-sqlite3') → dynamic import('better-sqlite3') → betterSqliteHandle
        │ opt-in  → openRawDb(path,'node:sqlite')    → dynamic import('node:sqlite')    → nodeSqliteHandle
        ▼
    WritableSqliteHandle ──→ runMigrations(handle) ──→ new SqliteGraphStore(handle)
        │                                                     │
        └── prepare/exec/transaction/pragma/close ◄───────────┘ (only contact with the driver)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/adapters/storage/sqlite/handle.ts` | Create | `WritableSqliteHandle` + `StatementHandle` types; `betterSqliteHandle(db)`; `nodeSqliteHandle(db)` with synthesized `transaction`; reuse `isNodeSqliteAvailable` (import from engine `driver.ts` or duplicate small). |
| `src/adapters/storage/sqlite/schema.ts` | Modify | Remove static `import Database`; `openRawDb(path, driver)` does the dynamic import inside the better-sqlite3 path and returns `WritableSqliteHandle`. |
| `src/adapters/storage/sqlite/migrations.ts` | Modify | `Migration.up(h: WritableSqliteHandle)`, `runMigrations(h)`; `db.*` → `h.*`. |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | Modify | Constructor `(db: Db)` → `(handle: WritableSqliteHandle)`; `Statement` → `StatementHandle`; `info.changes` unchanged. |
| `src/adapters/storage/sqlite/factory.ts` | Modify | Add `driver?`; select + open via `openRawDb(path, driver)`; node:sqlite version gate (reuse engine error pattern). |
| `src/adapters/storage/sqlite/sqlite-graph-store.test.ts` | Modify | Pass a `betterSqliteHandle`; add node:sqlite parity + transaction tests (new file allowed). |
| `src/core/ports/graph-store.ts` | None | Unchanged. |

## Interfaces / Contracts

```typescript
export interface StatementHandle {
  run(params?: unknown): { changes: number };       // params: object (@named) | positional via run(a,b)
  get(params?: unknown): unknown;                    // undefined when no row
  all(params?: unknown): unknown[];
}
export interface WritableSqliteHandle {
  prepare(sql: string): StatementHandle;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;              // returns a callable, matching better-sqlite3
  pragma(pragma: string): void;                      // write-only ('journal_mode = WAL')
  close(): void;
}
```
Call-site note: store passes BOTH object binds (`stmt.run({id,...})`) AND positional (`stmt.run(id,id)`, `stmt.all(kind)`, `stmt.get(id)`). `StatementHandle.run/get/all` MUST accept `(...args: unknown[])` (variadic) so both better-sqlite3 and node:sqlite `StatementSync` pass through identically. `RunResult.changes` → `{changes:number}` on both.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `betterSqliteHandle` pass-through; `nodeSqliteHandle` map; `transaction` commit + rollback-on-throw for BOTH | Throw inside `fn`, assert rows un-persisted; assert committed rows persist |
| Integration | Existing `sqlite-graph-store.test.ts` + ALL storage goldens on better-sqlite3 | Construct store via `betterSqliteHandle` — must be BYTE-IDENTICAL (load-bearing gate, L-009) |
| Integration | node:sqlite parity: SAME ops (upsertGraph nodes/edges, getNode/byKind/byQName, edges, FTS search, putSnapshot+manifest, migrate v0→v2) on `:memory:` | Run identical fixtures on a `nodeSqliteHandle`; assert equivalent results vs better-sqlite3 oracle (Node 22 local) |

WAL/FK/FTS5 on node:sqlite: `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, and FTS5 are compiled into Node's bundled SQLite (Node 22.5+). `journal_mode` may report `memory` for `:memory:` DBs on BOTH drivers — that is identical behavior, not a divergence; the parity test asserts row results, not the journal_mode echo. If any pragma echoes differently, normalize inside `nodeSqliteHandle.pragma` (which discards return anyway).

## Migration / Rollout

No data migration — the `.dbgraph` DB file format is identical across drivers. Pure-additive seam on the default path. Rollback: restore static `import Database` + native `Db` typing in the four files, delete `handle.ts` + node:sqlite test path.

## Apply Batch Ordering (TDD)

1. **Load-bearing gate** — `handle.ts` (`WritableSqliteHandle` + `betterSqliteHandle`) + refactor `schema`/`migrations`/`sqlite-graph-store`/`factory` to the handle; prove ALL existing tests + goldens BYTE-IDENTICAL on the better-sqlite3 default.
2. **node:sqlite path** — `nodeSqliteHandle` (incl. synthesized `transaction`) + factory `driver: 'node:sqlite'` gate + `:memory:` parity test + commit/rollback tests for both handles; final byte-identical golden + strict-build gate.

## Open Questions

- [ ] node:sqlite `:memory:` may force `journal_mode=memory` — confirm WAL request is a no-op (not an error) on `:memory:`; if file-backed parity is needed, use a temp file in that one test.
- [ ] Confirm `StatementSync.run` returns `{ changes, lastInsertRowid }` (not `info.changes` naming) on the target Node — adapter must expose `{changes}` regardless.
