# Design: Phase 8a — PostgreSQL Schema Extraction Adapter

## Technical Approach

Mirror the **SQLite adapter SHAPE** (thin `PgSchemaAdapter` class → single duck-typed driver seam), NOT the
MSSQL strategy registry. The MSSQL strategy machinery (`strategies/`, `selectStrategy`) exists solely for
SQL Server's integrated-security / external-tool fallback — a problem PG does NOT have (host/port/user/password
+ ssl only). So PG collapses the lazy-`import('pg')` + connect + fingerprint logic (currently spread across
`native-tedious.strategy.ts`) directly into `factory.ts`, exactly as `sqlite/factory.ts` owns its open. The
adapter class talks ONLY to `PgReadonlyDriver` (ADR-004), builds a deterministic `RawCatalog` via `map.ts`, and
feeds the UNCHANGED `normalizeCatalog → SqliteGraphStore → query` pipeline. Per-object catalog SELECTs +
`pg_get_functiondef`/`pg_get_viewdef` bodies → the SHARED `_shared/tokenizer-core.ts` classifies read/write at
`confidence:'parsed'`. `supportsDependencyHints:false` (body tokenizer is the sole edge source).

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Adapter shape | Thin class + direct `PgReadonlyDriver` seam, lazy import in `factory.ts` | MSSQL strategy registry | No external-tool/integrated-auth problem for PG; the registry would be dead abstraction. Matches `sqlite/`. |
| Union discriminator | `PgAdapterConfig` keyed by `host` (MSSQL uses `server`, SQLite uses `file`) | Add a `dialect` tag to the union | `SchemaAdapterConfig` is a STRUCTURAL union (schema-adapter.ts:68); each factory takes its concrete type. `host` keeps it distinguishable with zero churn to existing members. |
| Read-only posture | Minimal-privilege ROLE (`docs/permissions/pg.md`); catalog SELECTs only | `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` | DECISION locked (proposal). Session flag is bypassable theatre; the role + write-verb scanner is by-construction. |
| Matviews | `kind:'view'` + `extra.materialized:true` | New `materialized_view` NodeKind | No core-model churn; `extra` is queryable; first-class kind deferred. |
| Dynamic-SQL boundary | `hasDynamicSql` matches plpgsql statement `EXECUTE`, explicitly NOT the `EXECUTE FUNCTION`/`EXECUTE PROCEDURE` trigger-DDL clause | Reuse MSSQL `/\bexec\b/` | A naive `\bexecute\b` would false-positive on every trigger body. Boundary designed below. |

## Data Flow

    factory.ts (lazy import('pg'), Client.connect)
        └─ createPgReadonlyDriver(client) ─→ PgSchemaAdapter
                                                  │ extract(scope)
        queries.ts (pg_catalog/information_schema SELECTs) ──┐
                                                  ▼           │
        map.ts: rows → RawObject[]  ◀── _shared/tokenizer-core (bodies)
                                                  │
                                   deterministic RawCatalog (engine:'pg')
                                                  ▼
                       normalizeCatalog → SqliteGraphStore → query  (UNCHANGED)

## File Changes

| File | Action | Description |
|---|---|---|
| `src/adapters/engines/_shared/tokenizer-core.ts` | Create | Pure: `canonicalizeQName`, `classifyAccess(target, body, opts)`, `extractWriteTargets`. `WRITE_VERB_PATTERNS` constant. Dialect-specific bits (`hasDynamicSql`, quoting) injected per engine. |
| `src/adapters/engines/mssql/tokenizer.ts` | Modify | Re-import the 3 primitives from `_shared/`; keep MSSQL `hasDynamicSql` (`exec|sp_executesql`) + `tokenizeModuleDeps` local. Goldens byte-identical (re-run same batch). |
| `src/adapters/engines/pg/driver.ts` | Create | `PgReadonlyDriver { query, close }` + `PoolLike`-style `ClientLike { query(sql):Promise<{rows}>; end() }`. `createPgReadonlyDriver(client)`. |
| `src/adapters/engines/pg/capabilities.ts` | Create | `PG_CAPABILITIES` (table below). |
| `src/adapters/engines/pg/queries.ts` | Create | Catalog SELECT constants + `SQL_PG_FINGERPRINT`. All ORDER BY (ADR-008). |
| `src/adapters/engines/pg/map.ts` | Create | `*Row` shapes + `buildPgRawCatalog(input, scope)`. Matview→view+extra. |
| `src/adapters/engines/pg/error-mapper.ts` | Create | Pure `mapPgError(cause)` SQLSTATE→typed (table below). |
| `src/adapters/engines/pg/tokenizer.ts` | Create | PG `hasDynamicSql` + `tokenizePgBody` wiring `_shared/` with PG quoting. |
| `src/adapters/engines/pg/factory.ts` | Create | `createPgSchemaAdapter(config, deps?)`: lazy `import('pg')`, build conn config, `Client.connect()`, map errors, wrap. |
| `src/adapters/engines/pg/pg-schema-adapter.ts` | Create | `PgSchemaAdapter` (mirrors `MssqlSchemaAdapter`: parallel queries, `fingerprint`, idempotent `close`). |
| `src/core/ports/schema-adapter.ts` | Modify | Add `PgAdapterConfig`; extend the union. |
| `src/infra/config/schema.ts` | Modify | `'pg'` into `SUPPORTED_DIALECTS`; add `PgSource`; add the `pg` `DbgraphConfig` member. |
| `src/infra/config/parse-config.ts` | Modify | `parsePgSource` + `case 'pg'`. |
| `src/infra/open-connections.ts` | Modify | `createPgSchemaAdapter` in `AdapterAndStore` union + the dispatch branch. |
| `src/index.ts` | Modify | `case 'pg'` in `capabilitiesFor`; export `createPgSchemaAdapter` + `PG_CAPABILITIES`. |
| `src/core/errors.ts` | Modify | `UnsupportedDialectError` message → `sqlite, mssql, pg`. |
| `docs/permissions/pg.md` | Create | Minimal read-only role (CONNECT + USAGE + SELECT). |
| `test/fixtures/pg/torture.sql` + golden + integration/e2e | Create | See Testing. |
| `package.json` / `.github/workflows/` / `docs/stories/05-adapters.md` | Modify | `pg` optionalDependency; gated `pg-integration` job; US-028/a/b. |

## Interfaces / Contracts

```ts
// schema-adapter.ts — structural union member, discriminated by `host`
export interface PgAdapterConfig {
  readonly host: string;
  readonly port?: number;            // default 5432
  readonly database: string;
  readonly user: string;
  readonly password: string;         // resolved from ${env:VAR}
  readonly ssl?: boolean;
  readonly schema?: string;          // omit = all non-system schemas
}
export type SchemaAdapterConfig = SqliteAdapterConfig | MssqlAdapterConfig | PgAdapterConfig;

// _shared/tokenizer-core.ts — quoting + dynamic-SQL injected, no behaviour change
export function classifyAccess(
  targetQName: string, body: string,
  canon: (s: string) => string,     // MSSQL: bracket+quote; PG: dquote only
): 'read' | 'write';

// PG_CAPABILITIES: supported = schema,table,column,constraint,index,view,
//   procedure,function,trigger,sequence; supportsBodies:true; supportsDependencyHints:false
```

**`PgReadonlyDriver` seam**: `ClientLike` = `{ query(sql): Promise<{ rows: Record<string,unknown>[] }>; end(): Promise<void> }`
(maps `pg.Client`); driver returns `result.rows` (vs MSSQL `recordset`). A SINGLE short-lived `Client` (not a
`Pool`) — one extraction run, then `end()`. No top-level `pg` import anywhere (ADR-006).

**Dynamic-SQL boundary**: `hasDynamicSql = /\bexecute\b/i` minus the trigger-DDL clause. Implementation:
strip/ignore `EXECUTE\s+(FUNCTION|PROCEDURE)\b` (the `CREATE TRIGGER … EXECUTE FUNCTION fn()` form) before
testing for a bare statement-form `EXECUTE` (`EXECUTE 'sql'` / `EXECUTE format(...)`). The torture fixture pins
BOTH (a plpgsql `EXECUTE format(...)` body → `true`; a trigger using `EXECUTE FUNCTION` whose body has no
dynamic SQL → `false`).

**Catalog query strategy** (SELECT-only; non-system filter `nspname NOT IN ('pg_catalog','information_schema')`;
optional `AND nspname = $schema`):

| Object | Source | Why |
|---|---|---|
| schemas/tables/cols/types/defaults | `pg_namespace`/`pg_class`/`pg_attribute`/`pg_attrdef` (+ `format_type`, `attidentity`, `attgenerated`) | identity/generated need `pg_attribute` flags absent from `information_schema` |
| PK/FK/UNIQUE/CHECK | `pg_constraint` (+ `pg_get_constraintdef`) | one source; FK col order via `conkey`/`confkey` arrays |
| indexes (partial/expression/included) | `pg_index` + `pg_get_indexdef` | `information_schema` cannot express partial/expression/`INCLUDE` |
| views / matviews | `pg_class.relkind 'v'/'m'` + `pg_get_viewdef` (+ `pg_matviews`) | matview is `relkind='m'`; body via `pg_get_viewdef` for both |
| functions/procedures | `pg_proc` (`prokind 'f'/'p'`) + `pg_get_functiondef` | PG11 procedures; body for tokenizer |
| triggers | `pg_trigger` (non-internal) + `pg_get_triggerdef`; events/timing via `tgtype` bitmask | timing/event decode from `tgtype` bits |
| sequences | `pg_sequence` + `pg_class` | richer than `information_schema.sequences` |
| comments | `obj_description(oid, catalog)` / `col_description(oid, attnum)` | object + column comments |

**`error-mapper.ts`** (`mapPgError`, pure; reads `err.code` SQLSTATE):

| SQLSTATE | Typed error | Message |
|---|---|---|
| `28P01`, `28000` | `ConnectionError` | auth failed — check user/password |
| `42501` / `insufficient_privilege` | `PermissionError` | grant SELECT on catalogs; names privilege + `docs/permissions/pg.md` |
| `3D000` (bad db), `08*` (connection) | `ConnectionError` | host/port/database unreachable |
| `MODULE_NOT_FOUND` (in factory) | `ConnectionError` | `npm i pg` |
| else | `ConnectionError` | generic actionable fallback |

**`map.ts` determinism** (ADR-008): reuse the MSSQL `KIND_RANK` + `compareObjects`; columns by `attnum`;
constraints by name; FK/index columns by array ordinal; trigger events grouped by name with decoded
timing+events; `schemas` distinct-sorted; `engine:'pg'`. Matview → `{kind:'view', extra:{materialized:true}}`.

**`fingerprint()`**: ONE query — `SELECT MAX(...) , COUNT(*)` over a DDL change-marker. PG has no per-object
`modify_date`; use a marker that moves on DDL: `MAX` over `pg_class.oid + pg_attribute.attnum` plus
`COUNT(*)` of relations/attrs in non-system schemas (OIDs advance on CREATE; count moves on CREATE/DROP).
`sha256(`${m}|${c}`)` in the adapter — stable across data-only DML (US-009).

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `_shared` tokenizer (`EXECUTE` vs `EXECUTE FUNCTION`), `map.ts`, `error-mapper.ts`, parse-config `pg`, `capabilitiesFor('pg')` | Vitest, fixtures, NO db/mocks |
| Unit (gate) | MSSQL goldens byte-identical post-`_shared` refactor | Re-run in Batch 1 BEFORE PG consumes `_shared/` |
| Golden | `torture.sql` → `buildPgRawCatalog` → pinned `RawCatalog` JSON | Deterministic snapshot |
| Integration/E2E | `postgres:16` Testcontainers: extract → normalize → upsert → query | Gated `DBGRAPH_INTEGRATION=1`; skip-with-reason locally |
| CI | `pg-integration` job | Separate workflow; NEVER blocks unit matrix |
| Scanner | write-verb scanner over `engines/**` | Must stay green (SELECT-only) |

`torture.sql` MUST contain: matview; partial index + expression index (+ `INCLUDE` on PG11+); plpgsql function
with `EXECUTE format(...)`; trigger using `EXECUTE FUNCTION`; sequence; generated column (`GENERATED ALWAYS AS`);
identity column; object + column comments; a FK + CHECK. `docs/permissions/pg.md` ships a `CREATE ROLE …
NOSUPERUSER` + `GRANT CONNECT/USAGE/SELECT` script (catalog reads only).

## Migration / Rollout

No data migration. Fully additive (see proposal Rollback). `pg` is a lazy optional dep — absence yields a
`ConnectionError('npm i pg')`, never a load-time crash.

## Batch Ordering

KEEP the proposal's 7 batches — verified sound against live code. One refinement: in **Batch 5**, change ONLY
the `UnsupportedDialectError` MESSAGE and its pinned assertion. `exit-code.ts` maps the error via `instanceof`
(`exit-code.ts:55`), NOT the string — so add an explicit regression assertion that `exitCodeFor` still returns
`4` for `UnsupportedDialectError`, but make NO code change there. (B1 `_shared` extract+MSSQL-golden gate · B2
capabilities+config plumbing · B3 driver+error-mapper+factory · B4 queries+map+tokenizer · B5 dispatch wiring +
pinned message · B6 permissions doc+`PermissionError` link · B7 fixtures+Testcontainers E2E+CI+scanner+lint.)

## Open Questions

- [ ] None blocking. Exact `tgtype` bit decode and the precise `fingerprint` marker columns are finalized in
      `sdd-tasks`/`sdd-apply` against the live `postgres:16` catalog (pinned by the golden).
