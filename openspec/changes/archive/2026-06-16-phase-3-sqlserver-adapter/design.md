# Design: Phase 3 — SQL Server Schema Extraction Adapter

## Technical Approach

Mirror the Phase-2 hexagonal seam (ADR-004) one-for-one. The EXISTING `SchemaAdapter` port is
unchanged; a new `createMssqlSchemaAdapter` factory under `src/adapters/engines/mssql/` is the
ONLY join point and lazily `import('mssql')` (optionalDependency, ADR-006). The factory opens a
connection pool, maps `tedious`/`mssql` connect failures to typed `ConnectionError`/`PermissionError`,
and returns an `MssqlSchemaAdapter` that issues read-only `sys.*` SELECTs and maps rows into a
deterministic `RawCatalog` (ADR-008), consumed unchanged by `normalizeCatalog → SqliteGraphStore →
query`. SQL Server is the first engine to emit `confidence:'parsed'` dependency edges: a conservative
body tokenizer over `sys.sql_modules.definition` (NO new T-SQL parser, ADR-007) classifies the
object→object edges from `sys.sql_expression_dependencies` as read vs write; ambiguous/dynamic bodies
set `hasDynamicSql:true`. The module layout copies sqlite exactly: `factory`, adapter class,
`capabilities`, `queries`, `map`, plus a new `tokenizer` module. Integration-first per dbgraph-testing:
pure tokenizer + mapping unit-tested on captured JSON row fixtures; live behaviour via Testcontainers,
gated in a SEPARATE CI job that never blocks the unit matrix and never touches the validation database.

## Architecture Decisions

### Decision: Per-adapter config types via a PLAIN STRUCTURAL union (NOT a generic config, NOT a dialect-discriminated union)

**Choice**: Extend the existing `SchemaAdapterConfig` union with `MssqlAdapterConfig` as a plain
union member. CRITICAL back-compat constraint (verified against the live code): `SqliteAdapterConfig`
today is `{ file: string; driver?: ... }` with NO `dialect` field, and `SchemaAdapterConfig =
SqliteAdapterConfig`. We MUST NOT add a required `dialect` to `SqliteAdapterConfig` — that would break
every existing SQLite caller and its Phase-2 tests. Instead, each member is distinguished STRUCTURALLY
(`SqliteAdapterConfig` has `file`; `MssqlAdapterConfig` has `server`+`database`+`authentication`), and
each engine keeps its OWN factory (`createSqliteSchemaAdapter` / `createMssqlSchemaAdapter`) taking its
concrete config type directly — so no runtime discriminant is even needed. `SchemaAdapterConfig` is
just the umbrella union. `MssqlAdapterConfig` carries a nested `authentication` discriminated by
`type: 'sql' | 'ntlm'` (that nested discriminant is internal to the mssql config and touches nothing else).

```ts
export interface MssqlAdapterConfig {
  readonly server: string;
  readonly port?: number;            // default 1433
  readonly database: string;
  readonly authentication:
    | { readonly type: 'sql'; readonly user: string; readonly password: string }
    | { readonly type: 'ntlm'; readonly domain: string; readonly user: string; readonly password: string };
  readonly encrypt?: boolean;              // default true
  readonly trustServerCertificate?: boolean; // default true for dev; document prod guidance
}
// SqliteAdapterConfig is UNCHANGED (no dialect field added).
export type SchemaAdapterConfig = SqliteAdapterConfig | MssqlAdapterConfig;
```

**Alternatives considered**: (a) one generic `{ url, options }` config — rejected (ADR-007/YAGNI):
file-path vs server/auth/TLS have no honest common shape; a `url` blob hides required fields and
defeats compile-time safety. (b) A `dialect`-discriminated union forcing `dialect` onto
`SqliteAdapterConfig` — REJECTED: it is a breaking change to the Phase-2 SQLite contract and its
tests. (c) Adding mssql fields onto `SqliteAdapterConfig` — rejected: pollutes the SQLite contract.
**Rationale**: a plain structural union keeps each engine's config truthful and additive — future
engines append a member, touching neither existing one (the Phase-2 design comment explicitly
anticipated this: "future engines add their own member without touching SqliteAdapterConfig").

### Decision: Async engine-local driver seam (`MssqlReadonlyDriver`), pool-backed

**Choice**: Add an async sibling to sqlite's `ReadonlyDriver`:
`interface MssqlReadonlyDriver { query(sql, params?): Promise<readonly Record<string,unknown>[]>; close(): Promise<void> }`,
backed by a single `mssql.ConnectionPool`. The adapter and `map.ts` talk ONLY to this interface
(never to `mssql` directly), exactly as sqlite talks only to `ReadonlyDriver`.

**Alternatives considered**: reuse the synchronous sqlite `ReadonlyDriver` — impossible: `tedious` is
network/async. Per-query connections — rejected: wasteful, racy; a pool with a single connection is
the tedious idiom. **Rationale**: one logic path over an async seam; the port is already async, so this
is symmetric and keeps `mssql` types out of core (ADR-004).

### Decision: Conservative body tokenizer, never a T-SQL grammar (ADR-007)

**Choice**: `sys.sql_expression_dependencies` yields candidate object→object edges (with referenced
schema/name). For each referencing module, the tokenizer scans `sys.sql_modules.definition`
case-insensitively: an edge target is `write` if its normalized `[schema].[name]` (brackets stripped,
lowercased → `canonicalQName`) appears as the operand of `INSERT INTO`, `UPDATE`, `DELETE FROM`,
`MERGE INTO`, or `TRUNCATE TABLE`; otherwise `read`. Presence of `EXEC`/`sp_executesql` (dynamic SQL)
sets `hasDynamicSql:true` on that module. All emitted edges carry `confidence:'parsed'`.

**Deliberately NOT attempted**: control flow, variable/temp-table resolution, synonym expansion,
cross-database three-part names, CTE write-back nuance, parsing dynamic-SQL string contents. Those →
`hasDynamicSql:true` (declared blindness, US-007), never a guess. **Rationale**: the proposal scopes
a full parser OUT; conservative classification + honest dynamic-SQL flag beats an unreliable guess and
adds zero runtime dependencies.

### Decision: Deterministic `sys.*` ordering baked into every query (ADR-008)

**Choice**: Every catalog SELECT carries an explicit `ORDER BY schema_name, object_name [, ordinal]`;
`map.ts` re-sorts the assembled `objects` by `(kindRank, schema, name)` reusing sqlite's `KIND_RANK`.
Grouped rows (FK columns, index columns) order by `key_ordinal`/`index_column_id`. **Rationale**:
byte-identical `RawCatalog` across runs, asserted by the golden (mirrors Phase-2 golden-freeze).

### Decision: Reuse existing `ConnectionError`/`PermissionError` — no new error types

**Choice**: Map tedious/mssql failures by inspecting `err.code`/message: login failed (`ELOGIN`,
"Login failed for user") → `ConnectionError` with credential guidance; host unreachable
(`ESOCKET`/`ETIMEOUT`/`ENOTFOUND`) → `ConnectionError` naming server:port; TLS
(`self-signed`/`certificate`) → `ConnectionError` suggesting `trustServerCertificate` for dev;
Kerberos attempted → `ConnectionError` stating SSO unsupported, use SQL/NTLM (ADR-006). Missing
`VIEW DEFINITION` (error 229/`EREQUEST` "permission was denied") → `PermissionError` naming the
permission + linking `docs/permissions/mssql.md` (US-033). **Rationale**: errors already model exactly
these cases (Phase-2 design); adding types would be redundant.

### Decision: `fingerprint()` = MAX(modify_date)+COUNT over `sys.objects`, hashed

**Choice**: `SELECT MAX(modify_date) AS m, COUNT(*) AS c FROM sys.objects WHERE is_ms_shipped = 0`;
`fingerprint = sha256(\`${m}|${c}\`)` hex. **Rationale**: `modify_date` advances on DDL (CREATE/ALTER)
and the COUNT catches drops/creates; neither moves on DML — exactly the DDL-sensitive / DML-stable
drift signal (US-009), one cheap query, never walks objects.

## Data Flow

```
createMssqlSchemaAdapter(config)
   │  factory: import('mssql') → new ConnectionPool(cfg).connect()
   │           → map connect errors → wrap in MssqlReadonlyDriver
   ▼
MssqlSchemaAdapter.extract(scope)
   │  queries.ts: sys.* SELECTs → map.ts → RawObject[]
   │  tokenizer.ts: sql_expression_dependencies + sql_modules.definition
   │               → RawDependency[] (read|write, confidence:'parsed', hasDynamicSql)
   ▼
RawCatalog ──→ normalizeCatalog(scope) ──→ SqliteGraphStore.upsertGraph ──→ query API
   ▲
fingerprint() = sha256(MAX(modify_date)|COUNT(*) over sys.objects)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/ports/schema-adapter.ts` | Modify | Add `MssqlAdapterConfig`; widen `SchemaAdapterConfig` to a PLAIN union (`SqliteAdapterConfig \| MssqlAdapterConfig`). Do NOT add `dialect` to `SqliteAdapterConfig` (back-compat) |
| `src/core/ports/index.ts` / `src/core/index.ts` | Modify | Re-export `MssqlAdapterConfig` |
| `src/adapters/engines/mssql/factory.ts` | Create | `createMssqlSchemaAdapter` — `import('mssql')`, pool connect, error map |
| `src/adapters/engines/mssql/driver.ts` | Create | `MssqlReadonlyDriver` (async) + pool adapter |
| `src/adapters/engines/mssql/mssql-schema-adapter.ts` | Create | Adapter class: extract/fingerprint/close (idempotent + lifecycle guard) |
| `src/adapters/engines/mssql/capabilities.ts` | Create | `MSSQL_CAPABILITIES` constant |
| `src/adapters/engines/mssql/queries.ts` | Create | `sys.*` SELECT string constants (read-only) |
| `src/adapters/engines/mssql/map.ts` | Create | rows → `RawObject[]`, deterministic ordering |
| `src/adapters/engines/mssql/tokenizer.ts` | Create | Body read/write classifier + dynamic-SQL detector |
| `src/index.ts` | Modify | Export `createMssqlSchemaAdapter` (composition root, ADR-004) |
| `docs/permissions/mssql.md` | Create | `VIEW DEFINITION`+`CONNECT`-only login script (US-033) |
| `test/fixtures/mssql/torture.sql` | Create | T-SQL torture DDL (proc/trigger/TVF/filtered+included index/computed/sequence) |
| `test/fixtures/mssql/container.ts` | Create | Testcontainers harness: start, apply torture.sql, teardown, skip helper |
| `test/fixtures/mssql/rows/*.json` | Create | Captured `sys.*` row shapes for pure unit fixtures |
| `test/fixtures/mssql/golden-raw-catalog.json` / `golden-e2e.json` | Create | Goldens (seed-on-first-run) |
| `test/adapters/engines/mssql/tokenizer.test.ts` | Create | Unit: read/write/dynamic classification (no DB) |
| `test/adapters/engines/mssql/map.test.ts` | Create | Unit: row fixtures → `RawObject` fields (no DB) |
| `test/adapters/engines/mssql/capabilities.test.ts` | Create | Matrix: procs/functions/sequences=true; collections/fields=false |
| `test/adapters/engines/mssql/extract.integration.test.ts` | Create | Container: extract → golden `RawCatalog` (skip-with-reason) |
| `test/adapters/engines/mssql/e2e.integration.test.ts` | Create | Container: full pipeline → query goldens (skip-with-reason) |
| `package.json` | Modify | `mssql` → `optionalDependencies`; `testcontainers` → `devDependencies` |
| `.github/workflows/ci.yml` | **Modify** | File ALREADY EXISTS (unit matrix Node 22/24, checkout@v6, setup-node@v6). ADD a SEPARATE gated `mssql-integration` job (Linux-only); do NOT recreate or alter the existing `test` job |

## Interfaces / Contracts

### CapabilityMatrix (truthful SQL Server)

```ts
export const MSSQL_CAPABILITIES: CapabilityMatrix = {
  engine: 'mssql',
  supported: new Set<NodeKind>([
    'schema','table','column','constraint','index','view',
    'procedure','function','trigger','sequence',
  ]),
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: true,            // sys.sql_modules.definition (level-gated)
  supportsDependencyHints: true,   // sys.sql_expression_dependencies + parsed tokenizer
};
// NO 'collection'/'field' (MongoDB-only). 100% matrix coverage.
```

### Catalog query set (`queries.ts` — read-only string constants)

| Object family | Source `sys.*` | Mapping notes |
|---------------|----------------|---------------|
| tables + columns | `tables` ⋈ `columns` ⋈ `types` ⋈ `computed_columns` ⋈ `default_constraints` | `dataType` from `types.name` + length/precision/scale; `nullable=is_nullable`; `default` from default_constraints; computed → `extra.computed` + definition |
| PK / UNIQUE | `key_constraints` ⋈ `index_columns` | `type='PK'`/`'UNIQUE'`; columns by `key_ordinal` |
| FK | `foreign_keys` ⋈ `foreign_key_columns` (GROUPED by fk id) | `references.{schema,table,columns}`; columns by `constraint_column_id` |
| CHECK | `check_constraints` | `type='CHECK'`, `definition` |
| indexes | `indexes` ⋈ `index_columns` | `unique`, `type_desc`→clustered/nonclustered (`extra`), `filter_definition`→`extra.where`, included via `is_included_column` |
| views/procs/functions/triggers | `objects` ⋈ `sql_modules` (body level-gated) | kind from `objects.type`; trigger `fires_on` (event+timing) from `trigger_events`/`is_instead_of_trigger` |
| sequences | `sequences` | `kind:'sequence'` (+ type/start/increment in `extra`) |
| comments | `extended_properties` WHERE `name='MS_Description'` | → `comment` on matching object/column |
| dependencies | `sql_expression_dependencies` | feed tokenizer → `RawDependency[]` |

Every query ends `ORDER BY ...` for determinism (ADR-008). All are SELECTs — the US-031 scanner runs over `engines/**`.

### fingerprint()

```ts
fingerprint() = sha256(`${MAX(modify_date)}|${COUNT(*)}`)  // sys.objects WHERE is_ms_shipped=0
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | Tokenizer read/write/dynamic classification | `tokenizer.test.ts` over inline T-SQL strings + bracket/case fixtures; NO DB |
| Unit | Row→RawObject mapping (all families) | `map.test.ts` over captured `sys.*` JSON fixtures; NO DB |
| Unit | Capability matrix coverage | `capabilities.test.ts` asserts supported set + bodies/hints flags |
| Security | US-031 write-verb scan | existing `security-scan.test.ts` already scans `engines/**` — covers mssql automatically |
| Integration | extract → golden `RawCatalog` | `extract.integration.test.ts` against container; `stableStringify` === golden |
| Integration | fingerprint moves on DDL, not DML | ALTER → changes; INSERT → unchanged (container) |
| E2E | full pipeline goldens | `e2e.integration.test.ts`: extract→normalize→upsert→neighbors/impact/path/search vs golden |

### Testcontainers harness (`test/fixtures/mssql/container.ts`)

- Image `mcr.microsoft.com/mssql/server:2022-latest`; env `ACCEPT_EULA=Y`, `MSSQL_SA_PASSWORD=<strong>`.
- **Wait strategy**: poll `SELECT 1` until success (SQL Server accepts TDS ~20–40s AFTER the port opens —
  a port-open probe is NOT sufficient); cap ~120s, then fail with an actionable message.
- Apply `torture.sql` once connected (consistent with Phase-2 committed-`.sql` decision); expose
  `{ config: MssqlAdapterConfig, stop() }`.
- **Skip-with-reason**: a `mssqlContainerAvailable()` guard probes Docker; integration suites use
  `describe.skipIf(!available)('...', ...)` logging a reason. Contributors without Docker and the unit
  matrix stay GREEN.
- **Naming**: integration files use the `*.integration.test.ts` suffix so they are separable in CI.

### CI gating (`.github/workflows/ci.yml`)

- The EXISTING job is named `test` (matrix, all OS) — KEEP that name; do NOT rename it. It runs
  `npm test`; NEVER references the validation database. Its `npm test` MUST exclude `*.integration.test.ts` (configure
  the default `vitest` run to exclude that glob, with a separate `test:integration` script) — because
  `ubuntu-latest` HAS Docker in Actions, so a Docker-presence guard alone would make the matrix run
  containers. Gate integration on an EXPLICIT env flag (e.g. `DBGRAPH_INTEGRATION=1`), not mere Docker
  presence.
- ADD a SEPARATE job `mssql-integration` (**Linux only**, `needs: []` — independent, does not block
  `test`): sets `DBGRAPH_INTEGRATION=1` and runs ONLY `npm run test:integration`
  (`vitest run test/**/*.integration.test.ts`). Testcontainers starts SQL Server on the runner's
  Docker. NEVER references the validation database (ephemeral container only — that validation is manual Phase 6).
- Locally: `npm test` skips integration (fast, no Docker needed); `npm run test:integration` runs them
  when the developer has Docker. The skip guard = `skipIf(!process.env.DBGRAPH_INTEGRATION)` with a
  clear reason, so a Docker-less contributor and the unit matrix both stay green.

### Read strategy / lifecycle

- Single `ConnectionPool` opened by the factory; all reads are catalog SELECTs (US-031). `close()` is
  idempotent (`_closed` flag, second call no-op). Lifecycle guard: `extract()`/`fingerprint()` after
  `close()` throw `ConnectionError` (mirrors `SqliteSchemaAdapter`).

### TDD red→green order

1. `MssqlAdapterConfig` union widening (compile) + `MSSQL_CAPABILITIES` matrix test.
2. `tokenizer.ts` — pure unit tests FIRST (read/write/MERGE/TRUNCATE/EXEC-dynamic/bracket/case), red→green.
3. `map.ts` per family over captured JSON row fixtures (tables→columns→PK→FK→CHECK→indexes→views→procs→functions→triggers→sequences→comments→deps), each red→green.
4. `driver.ts` async seam + `factory.ts` connect + error mapping (unit on error-mapper with synthetic tedious errors).
5. Integration: `container.ts` harness; `extract.integration.test.ts` → seed RawCatalog golden.
6. fingerprint DDL/DML integration test.
7. E2E integration → seed E2E golden.

Pure tokenizer/mapping/error-map tests (steps 1–4) run in the unit matrix with NO Docker; steps 5–7 are container-gated.

## Migration / Rollout

No migration. Fully additive (proposal Rollback Plan): public API gains exactly one export,
`createMssqlSchemaAdapter`. `mssql` is an optionalDependency (lazy import), so consumers not using
SQL Server are unaffected and installs without it still succeed.

## Open Questions

- [ ] Exact tedious `err.code` strings for NTLM/Kerberos failures across `mssql` major versions —
      resolve in apply by capturing real errors against the container; isolated inside the factory error-mapper.
- [ ] Whether `sql_expression_dependencies` resolves all torture-schema edges or some surface as
      unresolved (`referenced_id IS NULL`) — validated by the RawCatalog golden; unresolved → skip honestly.
