# Design: Phase 2 — SQLite Schema Extraction Adapter

## Technical Approach

Port-first, mirroring Phase 1's hexagonal seam (ADR-004). A new `SchemaAdapter` driven
port lands in `src/core/ports/` and imports NO driver. A `createSqliteSchemaAdapter`
factory under `src/adapters/engines/sqlite/` is the ONLY join point that dynamically
imports a driver, exactly mirroring `createSqliteGraphStore`. The factory selects a driver
(`better-sqlite3` or `node:sqlite`), opens it READ-ONLY, and returns a `SqliteSchemaAdapter`
that maps `sqlite_master` rows + PRAGMA output into a deterministic `RawCatalog` consumed
unchanged by `normalizeCatalog`. This proves the full E2E pipeline (source db → extract →
normalize → store → query) with zero infrastructure (US-026), and forces read-only-by-
construction (US-031) plus a truthful SQLite `CapabilityMatrix`.

## Architecture Decisions

### Decision: SchemaAdapter port shape (async, lifecycle-symmetric with GraphStore)

**Choice**: `interface SchemaAdapter` in `src/core/ports/schema-adapter.ts`, all methods async:

```ts
export interface SqliteAdapterConfig {
  readonly file: string;          // path to source .db (or ':memory:' for tests)
  readonly driver?: 'better-sqlite3' | 'node:sqlite'; // default: better-sqlite3
}
// Phase-2-honest config union; future engines add their own member without touching this one.
export type SchemaAdapterConfig = SqliteAdapterConfig;

export interface SchemaAdapter {
  readonly dialect: string;                 // 'sqlite'
  readonly capabilities: CapabilityMatrix;  // truthful matrix
  extract(scope: ExtractionScope): Promise<RawCatalog>;
  fingerprint(): Promise<string>;
  close(): Promise<void>;
}
```

`connect`/`open` is performed by the FACTORY (returns an already-open adapter), mirroring
`createSqliteGraphStore` which returns an open store. The port therefore exposes no `open()`
— symmetry with `GraphStore` (lifecycle = `close()` only; construction via factory).

**Alternatives considered**: (a) sync methods like the storage internals — rejected: the port
is the seam for `node:sqlite` (async-capable) and future networked engines (ADR-005 rationale,
identical to GraphStore). (b) `open()` on the port — rejected: factory already owns dynamic
import + connection; double lifecycle is redundant. (c) Generic `Config` with `url` now —
rejected as over-building (ADR-007 / YAGNI): SQLite is file-based; URL engines arrive Phase 6+.

**Rationale**: Maximal symmetry with the proven Phase-1 port; minimal honest config.

### Decision: Driver selection = explicit option, default better-sqlite3, NO silent auto-fallback

**Choice**: `config.driver` selects explicitly; absent → `better-sqlite3`. The factory dynamic-
imports the chosen driver. `node:sqlite` requires Node ≥22.5; if requested on an older runtime
the factory throws `ConnectionError` with an actionable message (NOT a silent downgrade).

**Alternatives considered**: auto-fallback (`node:sqlite` if present else `better-sqlite3`) —
rejected: silent driver swaps make parity bugs invisible and tests non-deterministic (ADR-008).
The whole point of duality is to ASSERT parity, which requires deterministic selection.

**Rationale**: Determinism and honesty over convenience; parity must be observable.

### Decision: Driver abstraction — minimal shared `sqlite-driver` handle extracted NOW

**Choice**: A tiny `src/adapters/engines/sqlite/driver.ts` exposing
`interface ReadonlyDriver { all(sql, ...params): readonly Record<string,unknown>[]; pragma(name): readonly Record<string,unknown>[]; close(): void }`
with two adapters: `betterSqliteDriver(handle)` and `nodeSqliteDriver(handle)`. Extraction +
fingerprint code talks ONLY to `ReadonlyDriver`, so one logic path runs on both drivers.

**Alternatives considered**: duplicate extraction per driver — rejected: duplication is the
exact source of behavioral drift the parity test exists to catch; two code paths guarantee
divergence. Note: this helper is engine-LOCAL, not shared with `storage/` (storage talks
better-sqlite3 directly and its driver swap is Phase 9.5). Extracting a project-wide driver
now would be premature (YAGNI); the engine-local seam is justified because node:sqlite parity
matters for engines TODAY.

**Rationale**: Single extraction path is the only way the parity guarantee is real.

### Decision: Read-only enforcement + error mapping

**Choice**: `better-sqlite3` opened `new Database(file, { readonly: true, fileMustExist: true })`;
`node:sqlite` opened with read-only flags (`{ readOnly: true }` / `SQLITE_OPEN_READONLY`).
The factory wraps open in try/catch and maps:
- missing file → `ConnectionError('Source database not found at <file>. Check the path.')`
- not-a-database / malformed header → `ConnectionError('<file> is not a valid SQLite database.')`
- locked / busy → `ConnectionError('<file> is locked by another process. Close it and retry.')`
- read-only violation surfaced at runtime → `PermissionError`
Both new errors extend `DbgraphError` (codes `E_CONNECTION`, `E_PERMISSION`), carry `cause`,
and follow the `StorageError` pattern (actionable message, no swallowing).

**Rationale**: Typed, actionable errors (project standard); read-only by construction (US-031).

### Decision: Trigger dependency hints — Phase-2-honest, hasDynamicSql honesty (NO body parsing)

**Choice**: For triggers/views, extract timing/events/target-table from the structured
`sqlite_master` row where available, and the BODY from `sqlite_master.sql` (level-gated). Do
NOT parse the body into `reads_from`/`writes_to`. Emit `dependencies: []` and set
`hasDynamicSql: false` only when the object is fully structural; otherwise leave dependency
hints empty and rely on the normalizer's honesty flags. `supportsDependencyHints: false` in
the matrix — we declare blindness rather than guess (US-007).

**Alternatives considered**: conservative identifier matching to populate `parsed` deps —
rejected for Phase 2: false-positive-prone, and the proposal scopes body parsing OUT.

**Rationale**: Honest emptiness beats unreliable guesses; matrix declares the limitation.

### Decision: Canonical deterministic RawCatalog ordering (ADR-008)

**Choice**: `objects` sorted by `(kind, schema, name)` using a fixed `NODE_KINDS`-derived
kind rank then locale-independent string compare. `columns` by `ordinal`. `constraints`,
`indexes` by `name`. FK/index `columns` preserve SQLite's declared order (seqno), which IS
semantically ordered. `schemas` = `['main']` (single namespace) — SQLite has no schemas; we
emit the canonical `'main'`. This is asserted by the parity test via `stableStringify`.

**Rationale**: Byte-identical output across runs and across drivers (ADR-008).

## Data Flow

```
createSqliteSchemaAdapter(config)
   │  (factory: dynamic import → open readonly → wrap in ReadonlyDriver)
   ▼
SqliteSchemaAdapter.extract(scope)
   │  queries.ts: sqlite_master + PRAGMA(table_info, foreign_key_list,
   │              index_list, index_info) → map.ts → RawObject[]
   ▼
RawCatalog ──→ normalizeCatalog(scope) ──→ GraphStore.upsertGraph ──→ query API
   ▲
fingerprint() = hash(PRAGMA schema_version)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/ports/schema-adapter.ts` | Create | `SchemaAdapter` port + `SchemaAdapterConfig`/`SqliteAdapterConfig` |
| `src/core/ports/index.ts` | Modify | Re-export new port + config types |
| `src/core/index.ts` | Modify | Re-export port types + new errors |
| `src/core/errors.ts` | Modify | Add `ConnectionError` (`E_CONNECTION`), `PermissionError` (`E_PERMISSION`) |
| `src/adapters/engines/sqlite/factory.ts` | Create | `createSqliteSchemaAdapter` — driver select, open readonly, error map |
| `src/adapters/engines/sqlite/driver.ts` | Create | `ReadonlyDriver` + better-sqlite3 / node:sqlite adapters + Node≥22.5 detect |
| `src/adapters/engines/sqlite/sqlite-schema-adapter.ts` | Create | Adapter class (extract/fingerprint/close) |
| `src/adapters/engines/sqlite/capabilities.ts` | Create | `SQLITE_CAPABILITIES` constant |
| `src/adapters/engines/sqlite/queries.ts` | Create | sqlite_master + PRAGMA SQL strings (read-only) |
| `src/adapters/engines/sqlite/map.ts` | Create | PRAGMA rows → `RawObject[]`, deterministic ordering |
| `src/index.ts` | Modify | Export `createSqliteSchemaAdapter` (composition root) |
| `test/fixtures/sqlite/torture.sql` | Create | Committed DDL exercising every SQLite capability |
| `test/fixtures/sqlite/materialize.ts` | Create | Helper: run torture.sql into a temp db, return path + cleanup |
| `test/fixtures/sqlite/golden-raw-catalog.json` | Create | RawCatalog golden for torture fixture |
| `test/adapters/engines/sqlite/extract.test.ts` | Create | Unit: RawCatalog golden assertions |
| `test/adapters/engines/sqlite/parity.test.ts` | Create | Cross-driver byte-identical (Node≥22.5 skip-with-reason) |
| `test/adapters/engines/sqlite/e2e.test.ts` | Create | E2E: extract→normalize→store→query goldens |
| `test/adapters/engines/security-scan.test.ts` | Create | US-031 write-verb scanner over `engines/**` |

## Interfaces / Contracts

### CapabilityMatrix (truthful SQLite)

```ts
export const SQLITE_CAPABILITIES: CapabilityMatrix = {
  engine: 'sqlite',
  supported: new Set<NodeKind>(['schema','table','column','constraint','index','view','trigger']),
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: true,            // view + trigger SQL from sqlite_master
  supportsDependencyHints: false,  // declared blindness (US-007)
};
```

NO `procedure`/`function`/`sequence`/`collection`/`field` — SQLite has none. 100% matrix coverage.

### Extraction mapping (object by object → RawCatalog)

| Object | Source | Mapping notes |
|--------|--------|---------------|
| tables | `sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'` | `kind:'table'`, `schema:'main'`. WITHOUT ROWID → flag in `extra.withoutRowid` (parse `sql`). |
| columns | `PRAGMA table_info(t)` | `dataType` = declared type AS-IS (affinity honesty — emit `''` when typeless, do NOT invent). `nullable = notnull===0`, `default = dflt_value`, `ordinal = cid`, pk via `pk>0`. |
| PK | `table_info` rows with `pk>0` | `RawConstraint{type:'PK', columns ordered by pk}` (composite supported). |
| FKs | `PRAGMA foreign_key_list(t)` | GROUP rows by `id` (each id = one FK; multiple rows = composite). Order target columns by `seq`. `references.table` from `table`, `columns` from `to`. |
| UNIQUE / indexes | `PRAGMA index_list(t)` + `PRAGMA index_info(idx)` | `unique = origin!=='c'?...`; emit `RawIndex{unique, columns}`. Partial → `extra.where` parsed from `sqlite_master.sql`. Expression columns: `index_info.name` is null → map to `'(expr)'` placeholder honestly (NOT a fake column). UNIQUE from `index_list.unique` also emitted as `RawConstraint{type:'UNIQUE'}` when origin='u'. |
| auto-indexes | `sqlite_autoindex_*` | SKIP — they are implementation artifacts of PK/UNIQUE already modeled; including them double-counts. Justified skip. |
| views | `sqlite_master WHERE type='view'` | `kind:'view'`, `body = sql` (level-gated: omit unless `levels.views==='full'`). |
| triggers | `sqlite_master WHERE type='trigger'` | `kind:'trigger'`, `body = sql` (level-gated). `RawTriggerInfo` from tolerant parse of the `sql` text: regex for `BEFORE|AFTER|INSTEAD OF`, events `INSERT|UPDATE|DELETE` (UPDATE OF → UPDATE), target `ON <table>`. `dependencies: []`, no guessing. |
| internal | `sqlite_%`, `sqlite_sequence`, `sqlite_stat*` | SKIP entirely. |

### fingerprint()

```ts
fingerprint() = sha256(String(PRAGMA schema_version))  // hex
```

`PRAGMA schema_version` increments on EVERY DDL change (CREATE/ALTER/DROP) and NEVER on
data-only DML. This is exactly the drift signal we want (US-009): the index is keyed to
SCHEMA shape, not row contents, so re-sync triggers only when structure changes.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | Each PRAGMA mapper, FK grouping, expression-index honesty, trigger parse | `map.ts` against materialized torture db; assert `RawObject` fields |
| Unit | RawCatalog golden | `extract()` on torture fixture → `stableStringify` === committed golden |
| Unit | Error mapping | missing/not-a-db/locked file → `ConnectionError` with code + message |
| Unit | Capability matrix | `SQLITE_CAPABILITIES` excludes proc/func/seq/collection (100% coverage) |
| Integration | fingerprint moves on DDL, not DML | open writable temp db, ALTER → fingerprint changes; INSERT → unchanged |
| Parity | better-sqlite3 vs node:sqlite | same torture.sql → `stableStringify` byte-identical; skip-with-reason on Node<22.5 |
| Security | US-031 write-verb scan | vitest scans `src/adapters/engines/**` SQL strings for write verbs |
| E2E | full pipeline goldens | extract→normalize→upsert→neighbors/impact/path/search vs golden (reuses Phase-1 store/query) |

### Torture fixture (LOCKED: committed .sql, materialized at setup)

- Location: `test/fixtures/sqlite/torture.sql` — plain DDL text, reviewable in diffs.
- Materializer: `materialize.ts` exports `materializeTorture(): { path: string; cleanup(): void }`.
  Creates a temp file (`os.tmpdir()` + unique name), opens it WRITABLE with the storage
  `openRawDb` path style, `db.exec(readFileSync(torture.sql))`, closes it, returns the path.
  Adapter tests then open it READ-ONLY via the factory.
- Determinism: fixed schema, NO random/time-based data, NO `AUTOINCREMENT` seeding side effects
  that vary; deterministic object names. Same bytes every run → stable golden.
- Cleanup: `cleanup()` unlinks the temp file in `afterAll`; `:memory:` NOT used because parity
  must compare two independent driver opens of the SAME on-disk bytes.

### US-031 write-verb scanner (mirrors `boundaries.test.ts`)

- Reuse the `collectTsFiles` walk pattern from `test/core/boundaries.test.ts`.
- Scope: `src/adapters/engines/**`. EXEMPT: `src/adapters/storage/**` (documented in
  `storage/sqlite/factory.ts` header — local index MUST write, ADR-005).
- Tokenization: extract SQL only from string/template literals, then strip `--` line comments
  and `/* */` block comments BEFORE matching, and match write verbs on WORD BOUNDARIES
  (`\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|REPLACE)\b`, case-insensitive).
  This avoids false positives like `updated_at` (boundary) or verbs inside comments (stripped).
  Negative-control test: inject a write verb into a fixture string → scanner FAILS (proves it bites).

### node:sqlite conditionality

- `driver.ts` exports `isNodeSqliteAvailable(): boolean` (try `process.versions.node` ≥ 22.5,
  or attempt `import('node:sqlite')` guarded). Parity/node:sqlite tests use
  `describe.skipIf(!isNodeSqliteAvailable())('...', ...)` with a logged reason string, so CI on
  Node 20 reports skipped-with-reason rather than failing (ADR-006/007).
- Parity assertion: `stableStringify(rawBetter) === stableStringify(rawNode)` on the SAME
  materialized torture db opened independently by each driver.

### TDD red→green order

1. Errors (`ConnectionError`/`PermissionError`) — red test on code+message → green.
2. Port type + capabilities constant — compile + matrix test.
3. `driver.ts` `ReadonlyDriver` + Node detect — unit on `all`/`pragma`.
4. `queries.ts` + `map.ts` per object type (tables→columns→PK→FK→indexes→views→triggers),
   each red mapper test → green, building the golden incrementally.
5. Factory open + read-only + error mapping.
6. RawCatalog golden (full torture) → freeze golden.
7. Parity test (skip-aware).
8. US-031 security scan (+ negative control).
9. E2E goldens reusing `createSqliteGraphStore` + query API.

## Migration / Rollout

No migration required. Fully additive (proposal Rollback Plan). Public API gains exactly one
export: `createSqliteSchemaAdapter` from `src/index.ts`. No Phase-1 contract changes.

## Open Questions

- [ ] node:sqlite read-only flag exact API name across Node 22.5→24 (`readOnly` vs open-flags)
      — resolve in apply by reading the installed Node's `node:sqlite` typings; does not change
      the design (isolated inside `driver.ts`).
- [ ] WITHOUT ROWID / partial-index `where` require parsing `sqlite_master.sql` — confirm the
      minimal regex is tolerant enough for the torture cases (validated by the golden).
