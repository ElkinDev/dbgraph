# Design: Phase 8b — MySQL Schema Extraction Adapter

## Technical Approach

Mirror the **archived `pg/` adapter SHAPE one-for-one** (which itself mirrored the SQLite shape): a thin
`MysqlSchemaAdapter` class talking ONLY to a single duck-typed `MysqlReadonlyDriver` seam (ADR-004), with the
lazy `import('mysql2/promise' as string)` + connect + error mapping collapsed into `factory.ts`
(`createMysqlSchemaAdapter` — the ONLY join point, ADR-006). There is NO `strategies/` tree (that is
SQL-Server-only machinery for integrated-auth/external-tool fallback — MySQL has flat host/port/user/password
+ ssl). Per-object `information_schema` SELECTs (every one scoped `WHERE TABLE_SCHEMA = DATABASE()`, every one
`ORDER BY` for ADR-008) build a deterministic, sorted `RawCatalog` (`engine: 'mysql'`) via `map.ts`, feeding
the UNCHANGED `normalizeCatalog → SqliteGraphStore → query` pipeline. View bodies come from
`VIEWS.VIEW_DEFINITION`; routine bodies from `ROUTINES.ROUTINE_DEFINITION`. The SHARED
`_shared/tokenizer-core.ts` classifies each STATIC body reference as read/write at `confidence:'parsed'`,
gated by a presence check over the dynamic-string-MASKED body so NO phantom and NO self edges are emitted (8a
CRITICAL-1 designed out). `supportsDependencyHints:false` — the body tokenizer is the SOLE edge source.
`AUTO_INCREMENT` rides the column via `COLUMNS.EXTRA` (no sequence node; `MYSQL_CAPABILITIES` has no
`sequence`). `schema == database`: `TABLE_SCHEMA` (the connected database) → `RawObject.schema`,
`RawCatalog.schemas = [database]`, no `schema?` knob.

This is intentionally a SMALLER change than 8a: `_shared/tokenizer-core.ts` already exists, so there is no
tokenizer-extraction batch. The two CRITICAL-1 helpers (`maskDynamicStrings` + `bodyContainsRef`) are addressed
explicitly in Decision §4 (the promotion decision) — that is the only architectural fork left to resolve.

## Architecture Decisions (ADR-style)

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|---|
| D1 | Adapter shape | Thin `MysqlSchemaAdapter` + single `MysqlReadonlyDriver` seam; lazy `import('mysql2/promise')` in `factory.ts` | MSSQL `strategies/` registry | MySQL has no integrated-auth/external-tool problem. Registry would be dead abstraction. Matches `pg/` + `sqlite/`. |
| D2 | Driver result normalization | `execute(sql, params)` → `[rows, fields]`; driver returns `rows` (cast to `Record<string,unknown>[]`) | Expose `[rows,fields]` tuple to the adapter | `pg` driver returns `result.rows`; MSSQL returns `recordset`. Normalizing to a flat `rows[]` keeps the adapter/map identical to the pg template. The seam absorbs the dialect shape. |
| D3 | `query` vs `execute` | Use the connection's `query()` method (text protocol), NOT `execute()` (prepared/binary) | `execute()` (prepared statements) | Catalog queries are scoped by `DATABASE()` (a function, not a bind param) so almost all take ZERO params. `query()` avoids the prepared-statement protocol restrictions and matches the conservative read-only posture. The driver seam method is named `query()` regardless, so the adapter is unchanged. (`mysql2/promise` `connection.query()` also returns `[rows, fields]`.) |
| D4 | `schema == database` | `TABLE_SCHEMA` (database) → `RawObject.schema`; `RawCatalog.schemas = [DATABASE()]`; every query `WHERE TABLE_SCHEMA = DATABASE()`; NO `schema?` config knob | Treat MySQL "schemas" as multiple namespaces; add a `schema?` filter | MySQL has no schema-vs-database distinction — a database IS the namespace. A `schema?` knob would be meaningless. The single connected database is the entire scope. |
| D5 | AUTO_INCREMENT | Column attribute via `ExtendedRawColumn.extra = { autoIncrement: true }` from `COLUMNS.EXTRA LIKE '%auto_increment%'` | New `sequence` node (PG-style) | MySQL AUTO_INCREMENT is a per-table column property, not a first-class object. Mirrors pg's identity-column handling (`ExtendedRawColumn & { extra }`). `MYSQL_CAPABILITIES` omits `sequence`. Golden asserts NO sequence object + the column carries the flag. |
| D6 | Generated columns | `extra = { generated: true, generationKind: 'STORED' \| 'VIRTUAL' }` from `COLUMNS.EXTRA` (`STORED GENERATED` / `VIRTUAL GENERATED`) + `GENERATION_EXPRESSION` | Ignore generated columns | Mirrors pg's `generated:true` extra. MySQL distinguishes STORED vs VIRTUAL — both surfaced. |
| D7 | Read-only posture | Minimal-privilege user (`docs/permissions/mysql.md`); catalog SELECTs only; write-verb scanner stays green | `SET TRANSACTION READ ONLY` session flag | Locked in proposal. Session flag is bypassable theatre. By-construction read-only = no write verbs in `engines/**` + minimal grant. |
| D8 | Dynamic-SQL boundary | `hasMysqlDynamicSql = /\b(prepare\|execute)\b/i` on the ORIGINAL (unmasked) body | Reuse pg's `EXECUTE FUNCTION` strip; reuse MSSQL `exec` | MySQL dynamic SQL = `PREPARE stmt FROM ...` / `EXECUTE stmt`. There is NO trigger `EXECUTE FUNCTION` DDL clause in MySQL (triggers reference no functions in their CREATE), so no strip step is needed — simpler than pg. |
| D9 | Phantom-edge prevention | Mask dynamic-SQL string literals, then emit an edge ONLY for a candidate present in the MASKED static body (presence gate); never default-to-read, never self-reference | Default candidates to `read` (the 8a CRITICAL-1 defect) | MANDATORY — designs out 8a CRITICAL-1 from day one. See Decision §4 for where the gate code lives. |
| D10 | `_shared` promotion | **PROMOTE** `maskDynamicStrings` + `bodyContainsRef` into `_shared/tokenizer-core.ts`; refactor `pg/tokenizer.ts` to import them; prove pg golden byte-identical | (b) duplicate the two small functions in `mysql/tokenizer.ts` | RECOMMENDED with rationale in Decision §4. Both functions are PURE, engine-agnostic (single-quote masking + word-boundary presence check are ANSI, not pg-specific). Duplication would fork the CRITICAL-1 fix across two files — a latent regression risk. The move is mechanical (like the original 8a `_shared` extraction) and is provable byte-identical by re-running the pg golden + tokenizer suite in the SAME batch. |
| D11 | Config union discrimination | Keep `SchemaAdapterConfig` a STRUCTURAL union; add `MysqlAdapterConfig`; FIX the stale "distinguished by `host`" JSDoc on `PgAdapterConfig`; document the union is intentionally NON-discriminable-by-shape (pg and mysql both have `host`); runtime dispatch keys on the EXPLICIT `dialect` field in `parse-config.ts`/`open-connections.ts` | Add a `dialect` discriminant to every union member | VERIFIED against live `open-connections.ts` (`if (resolved.dialect === 'sqlite') … else if (resolved.dialect === 'pg') …`): dispatch is on the config `dialect` string, NOT structural narrowing. Each factory takes its own concrete type. Adding a discriminant would churn all three existing members for zero runtime benefit. See Decision §7. |
| D12 | View-body caveat | Document that `VIEW_DEFINITION` is the SERVER-REPARSED/normalized body (and may be truncated by the server's internal limit) — the tokenizer is presence-gated so a normalized body still resolves real referenced names | Use `SHOW CREATE VIEW` for the verbatim body | `SHOW CREATE VIEW` is NOT a plain catalog SELECT — it would trip the write-verb scanner pattern matcher and is not parameterizable cleanly. The reparsed body is an HONEST caveat, not a defect; golden pins the actual `mysql:8` output. |
| D13 | Fingerprint marker | ONE SELECT producing counts over `information_schema` COLUMNS + TABLES + ROUTINES, SHA-256'd in the adapter; avoids `UPDATE_TIME` | `MAX(UPDATE_TIME)`; bare object count | `UPDATE_TIME` is NULL for InnoDB until a flush and is DML-flaky. A `COUNT` over `COLUMNS` moves on `ADD COLUMN` (a new column row) AND on `CREATE/DROP TABLE`; adding `TABLES` + `ROUTINES` counts covers object add/drop and routine changes. Stable on pure DML. See Decision §6. |

## Data Flow

    factory.ts (lazy import('mysql2/promise'), createConnection, connect)
        └─ createMysqlReadonlyDriver(conn) ─→ MysqlSchemaAdapter
                                                  │ extract(scope)
        queries.ts (information_schema SELECTs, all WHERE TABLE_SCHEMA = DATABASE()) ──┐
                                                  ▼                                     │
        map.ts: rows → RawObject[]  ◀── _shared/tokenizer-core (bodies; masked+gated)
                                                  │
                                   deterministic RawCatalog (engine:'mysql')
                                                  ▼
                       normalizeCatalog → SqliteGraphStore → query  (UNCHANGED)

## File Changes

| File | Action | Description |
|---|---|---|
| `src/adapters/engines/mysql/capabilities.ts` | Create | `MYSQL_CAPABILITIES` (Decision §New-capabilities table). |
| `src/adapters/engines/mysql/driver.ts` | Create | `MysqlReadonlyDriver { query, close }` + duck-typed `ConnectionLike { query(sql, params?): Promise<[rows, fields]>; end(): Promise<void> }`. `createMysqlReadonlyDriver(conn)` normalizes `[rows,fields]` → `rows`. No top-level `mysql2` import. |
| `src/adapters/engines/mysql/queries.ts` | Create | Read-only `information_schema` SELECT constants + `SQL_MYSQL_FINGERPRINT`. All `WHERE TABLE_SCHEMA = DATABASE()`, all `ORDER BY` (ADR-008). |
| `src/adapters/engines/mysql/map.ts` | Create | `*Row` shapes + `buildMysqlRawCatalog(input, scope)`. `schema=database`; AUTO_INCREMENT/generated on column `extra`; index assembly from STATISTICS grouping; trigger event/timing grouping. |
| `src/adapters/engines/mysql/error-mapper.ts` | Create | Pure `mapMysqlError(cause)` — `errno`/`code` → typed errors (Decision §5 table). |
| `src/adapters/engines/mysql/tokenizer.ts` | Create | `hasMysqlDynamicSql` (`PREPARE`/`EXECUTE`) + `tokenizeMysqlBody` wiring `_shared/` with a MySQL canonicalizer (backtick stripping). |
| `src/adapters/engines/mysql/factory.ts` | Create | `createMysqlSchemaAdapter(config, deps?)`: lazy `import('mysql2/promise' as string)`, build conn config, `createConnection().connect()`, map errors, wrap. |
| `src/adapters/engines/mysql/mysql-schema-adapter.ts` | Create | `MysqlSchemaAdapter` (mirrors `PgSchemaAdapter`: parallel queries, `fingerprint`, idempotent `close`). |
| `src/adapters/engines/_shared/tokenizer-core.ts` | Modify (Decision §4 / D10) | PROMOTE `maskDynamicStrings` + `bodyContainsRef` here (engine-agnostic, exported). If duplication is chosen instead, this file is UNCHANGED. |
| `src/adapters/engines/pg/tokenizer.ts` | Modify (Decision §4 / D10) | Import `maskDynamicStrings` + `bodyContainsRef` from `_shared/`; delete the local copies. Behaviour byte-identical (re-run pg golden + tokenizer suite SAME batch). If duplication is chosen, UNCHANGED. |
| `src/core/ports/schema-adapter.ts` | Modify | Add `MysqlAdapterConfig`; extend the union; FIX the stale "distinguished by `host`" JSDoc on `PgAdapterConfig`; add union JSDoc per Decision §7. |
| `src/infra/config/schema.ts` | Modify | `'mysql'` into `SUPPORTED_DIALECTS`; add `MysqlSource`; add the `mysql` `DbgraphConfig` member. |
| `src/infra/config/parse-config.ts` | Modify | `parseMysqlSource` (host/port/database/user/password env-only + optional ssl) + `case 'mysql'`. |
| `src/infra/open-connections.ts` | Modify | `createMysqlSchemaAdapter` in `AdapterAndStore` union + `else if (resolved.dialect === 'mysql')` dispatch branch. |
| `src/index.ts` | Modify | `case 'mysql'` in `capabilitiesFor`; export `createMysqlSchemaAdapter` + `MYSQL_CAPABILITIES`. |
| `src/core/errors.ts` | Modify | `UnsupportedDialectError` message → `sqlite, mssql, pg, mysql` (MESSAGE-ONLY). |
| `src/cli/exit-code.ts` | UNCHANGED | Maps via `instanceof` (code 4). Regression assertion only — NO code change. |
| `docs/permissions/mysql.md` | Create | Minimal read-only user (catalog reads only). |
| `test/fixtures/mysql/torture.sql` | Create | MySQL torture schema (Decision §9). |
| `test/fixtures/mysql/container.ts` | Create | `mysql:8` Testcontainers harness (mirrors `pg/container.ts`). |
| `test/adapters/engines/mysql/*.test.ts` + golden | Create | Unit (tokenizer/map/error-mapper/config-union) + gated integration/e2e (Decision §9). |
| `package.json` | Modify | `mysql2` as `optionalDependency`. |
| `.github/workflows/ci.yml` | Modify | Gated `mysql-integration` job (mirrors `pg-integration`). |
| `docs/stories/05-adapters.md` | Modify | Refine US-029 to MySQL-8-only with locked decisions. |

## Interfaces / Contracts

```ts
// schema-adapter.ts — structural union member; dispatch is by the EXPLICIT `dialect` field,
// NOT by shape (pg and mysql both have `host` — see Decision §7).
export interface MysqlAdapterConfig {
  readonly host: string;
  readonly port?: number;            // default 3306
  readonly database: string;         // the database IS the schema scope (no `schema?` knob)
  readonly user: string;
  readonly password: string;         // resolved from ${env:VAR}; literals REJECTED by parser
  readonly ssl?: boolean | { readonly rejectUnauthorized?: boolean };
}
export type SchemaAdapterConfig = SqliteAdapterConfig | MssqlAdapterConfig | PgAdapterConfig | MysqlAdapterConfig;

// driver.ts — duck-typed mysql2/promise connection; seam normalizes [rows,fields] → rows
export interface ConnectionLike {
  query(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[], unknown]>;
  end(): Promise<void>;
}
export interface MysqlReadonlyDriver {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}
```

**`MysqlReadonlyDriver` seam**: `createMysqlReadonlyDriver(conn)` wraps a connected `mysql2/promise`
connection. `query()` calls `conn.query(sql, params)`, destructures `const [rows] = await conn.query(...)`,
and returns `rows`. A SINGLE short-lived connection (`mysql.createConnection`, NOT a pool) — one extraction
run, then `conn.end()`. No top-level `mysql2` import anywhere (ADR-006).

### `MYSQL_CAPABILITIES`

```ts
export const MYSQL_CAPABILITIES: CapabilityMatrix = {
  engine: 'mysql',
  supported: new Set([
    'table', 'column', 'constraint', 'index', 'view', 'procedure', 'function', 'trigger',
  ] as const),          // NO 'sequence' (AUTO_INCREMENT is a column attr); NO standalone 'schema' (= database)
  defaultLevels: DEFAULT_LEVELS,
  supportsBodies: true,           // VIEW_DEFINITION + ROUTINE_DEFINITION
  supportsDependencyHints: false, // body tokenizer is the SOLE edge source
} as const;
```

### Catalog query strategy (Decision §2)

All SELECT-only, all `WHERE TABLE_SCHEMA = DATABASE()` (FKs/triggers scope on their own table-schema column),
all `ORDER BY` for determinism (ADR-008). No `?` params needed (`DATABASE()` is a function, not a bind).

| Object | Source | Key columns | Why |
|---|---|---|---|
| tables | `information_schema.TABLES` (`TABLE_TYPE = 'BASE TABLE'`) | `TABLE_NAME`, `TABLE_COMMENT` | base tables only; views handled separately |
| columns | `information_schema.COLUMNS` | `COLUMN_NAME`, `ORDINAL_POSITION`, `COLUMN_TYPE`, `IS_NULLABLE`, `COLUMN_DEFAULT`, `EXTRA`, `GENERATION_EXPRESSION`, `COLUMN_COMMENT` | `EXTRA` carries `auto_increment` / `STORED GENERATED` / `VIRTUAL GENERATED` / `DEFAULT_GENERATED` |
| PK/UNIQUE/FK | `TABLE_CONSTRAINTS` + `KEY_COLUMN_USAGE` (+ `REFERENTIAL_CONSTRAINTS` for FK ref + ON UPDATE/DELETE) | `CONSTRAINT_NAME`, `CONSTRAINT_TYPE`, `COLUMN_NAME`, `ORDINAL_POSITION`, `REFERENCED_TABLE_SCHEMA/TABLE/COLUMN`, `POSITION_IN_UNIQUE_CONSTRAINT` | FK column order via `ORDINAL_POSITION`; ref column alignment via `POSITION_IN_UNIQUE_CONSTRAINT` |
| CHECK | `TABLE_CONSTRAINTS` (`CONSTRAINT_TYPE='CHECK'`) + `CHECK_CONSTRAINTS` (`CHECK_CLAUSE`) | `CONSTRAINT_NAME`, `CHECK_CLAUSE` | MySQL 8.0.16+; document the floor |
| indexes | `information_schema.STATISTICS` | `INDEX_NAME`, `SEQ_IN_INDEX`, `COLUMN_NAME`, `NON_UNIQUE`, `EXPRESSION`, `INDEX_TYPE`, `SUB_PART` | group by `INDEX_NAME` ordered by `SEQ_IN_INDEX`; `PRIMARY` excluded (captured in constraints); `NON_UNIQUE=0` → unique; `EXPRESSION` (8.0.13+) → functional index; `SUB_PART` → prefix index |
| views | `information_schema.VIEWS` | `TABLE_NAME`, `VIEW_DEFINITION` | body from `VIEW_DEFINITION` (reparsed/truncation caveat — D12) |
| routines | `information_schema.ROUTINES` (`ROUTINE_TYPE IN ('PROCEDURE','FUNCTION')`) | `ROUTINE_NAME`, `ROUTINE_TYPE`, `ROUTINE_DEFINITION`, `ROUTINE_COMMENT` | body from `ROUTINE_DEFINITION` |
| triggers | `information_schema.TRIGGERS` | `TRIGGER_NAME`, `EVENT_MANIPULATION`, `ACTION_TIMING`, `EVENT_OBJECT_TABLE`, `ACTION_STATEMENT` | timing+event direct (no bitmask decode, unlike pg `tgtype`); `EVENT_OBJECT_TABLE` is the parent table |

Comments: surfaced inline (`TABLE_COMMENT`, `COLUMN_COMMENT`, `ROUTINE_COMMENT`) — no separate comment query.

### `error-mapper.ts` (`mapMysqlError`, pure; reads `err.errno` (number) and `err.code` (string))

| `errno` / `code` | Typed error | Message |
|---|---|---|
| `1045` ER_ACCESS_DENIED_ERROR | `ConnectionError` | auth failed — check user/password in `MysqlAdapterConfig` |
| `1044` ER_DBACCESS_DENIED_ERROR | `PermissionError` | user denied access to the database — grant catalog read; names db + `docs/permissions/mysql.md` |
| `1142` ER_TABLEACCESS_DENIED_ERROR | `PermissionError` | missing the named privilege on the catalog table; names privilege + `docs/permissions/mysql.md` |
| `1143` ER_COLUMNACCESS_DENIED_ERROR | `PermissionError` | missing the named column privilege; names privilege + `docs/permissions/mysql.md` |
| `1049` ER_BAD_DB_ERROR | `ConnectionError` | database not found — verify host/port/database |
| `code === 'ECONNREFUSED'` / `ETIMEDOUT` / `ENOTFOUND` / `1130` ER_HOST_NOT_PRIVILEGED | `ConnectionError` | host/port unreachable or host not allowed |
| `MODULE_NOT_FOUND` (in factory only) | `ConnectionError` | `Required driver 'mysql2' is not installed. Run: npm i mysql2` |
| else | `ConnectionError` | generic actionable fallback including `cause.message` |

Note: `mysql2` errors carry BOTH `.code` (string, e.g. `ER_ACCESS_DENIED_ERROR`) and `.errno` (number).
The mapper switches on `errno` first (stable across locales/versions), falling back to `.code` for the
system-level network errors (`ECONNREFUSED` etc., which have no `errno`).

### `map.ts` determinism (ADR-008)

Reuse the pg `KIND_RANK` + `compareObjects` verbatim (objects by `(kindRank, schema, name)`). Columns by
`ORDINAL_POSITION`. Constraints by name. FK columns by `ORDINAL_POSITION`; ref columns aligned by
`POSITION_IN_UNIQUE_CONSTRAINT`. Indexes assembled by grouping STATISTICS rows on `INDEX_NAME`, columns ordered
by `SEQ_IN_INDEX`, `unique = (NON_UNIQUE === 0)`, functional-index expression captured in `extra` when
`EXPRESSION` is non-null, prefix length in `extra` when `SUB_PART` is non-null. Triggers grouped by name with
`timing = ACTION_TIMING` and `events = [EVENT_MANIPULATION]` (MySQL one event per trigger; events stays an
array for the shared `RawTriggerInfo` contract). `schemas = [DATABASE()]` (the single connected database).
`engine: 'mysql'`. AUTO_INCREMENT/generated via `ExtendedRawColumn & { extra }` (the exact pg pattern —
`RawColumn` has no first-class `extra` field; the intersection rides the structural passthrough).

### `fingerprint()`

ONE query (`SQL_MYSQL_FINGERPRINT`) over `information_schema`, scoped `= DATABASE()`:

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES   WHERE TABLE_SCHEMA = DATABASE())  AS table_count,
  (SELECT COUNT(*) FROM information_schema.COLUMNS  WHERE TABLE_SCHEMA = DATABASE())  AS column_count,
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()) AS routine_count
```

The adapter computes `sha256(`${table_count}|${column_count}|${routine_count}`)`.
- `column_count` MOVES on `ADD COLUMN` (a new `COLUMNS` row) — the 8a SUGGESTION-2 lesson (a bare
  table-count marker misses add-column).
- `table_count` MOVES on `CREATE`/`DROP TABLE`/`VIEW`.
- `routine_count` MOVES on `CREATE`/`DROP PROCEDURE`/`FUNCTION`.
- All three are STABLE under pure DML (`INSERT`/`UPDATE`/`DELETE` change no catalog row counts).
- Deliberately AVOIDS `MAX(UPDATE_TIME)`, which is NULL for InnoDB until a flush and is DML-flaky.

Pinned behaviorally in integration (Decision §9): fp MOVES on `CREATE TABLE`, MOVES on `ALTER TABLE ADD
COLUMN`, STABLE on `INSERT`; is a 64-char hex string; issues exactly one query.

## Decision §4 — Tokenizer + the `_shared/` PROMOTION DECISION (resolved)

**Current state (verified against live code):** `maskDynamicStrings` and `bodyContainsRef` exist ONLY in
`src/adapters/engines/pg/tokenizer.ts`. `bodyContainsRef` is a PRIVATE (non-exported) function there;
`maskDynamicStrings` is exported but only consumed by pg. `_shared/tokenizer-core.ts` currently exports just
`canonicalizeQName`, `WRITE_VERB_PATTERNS`, `extractWriteTargets`, `classifyAccess`. The MSSQL tokenizer
re-exports the 3 original primitives and does NOT use mask/presence-gate (its edges come from a catalog dep
view, so it never had the phantom-edge problem).

**DECISION (D10): PROMOTE — option (a).** Move `maskDynamicStrings` and `bodyContainsRef` (export it) into
`_shared/tokenizer-core.ts` as engine-agnostic primitives; refactor `pg/tokenizer.ts` to import them and delete
its local copies. MySQL's `tokenizeMysqlBody` then consumes the same shared helpers.

Rationale:
- Both functions are PURE and ANSI-generic: single-quote string-literal masking (`'...'` with `''` escape) and
  word-boundary identifier presence checking are NOT pg-specific. (Dollar-quoting is pg-only, but
  `maskDynamicStrings` only masks single-quoted literals — it never touched `$$`.)
- The CRITICAL-1 fix is a SAFETY-CRITICAL invariant (no phantom edges). Forking it across `pg/tokenizer.ts` and
  `mysql/tokenizer.ts` (option b) creates a latent regression: a future fix to one file silently diverges from
  the other. One shared source is the hexagonal-correct home (the `_shared/` module exists precisely for this).
- The move is MECHANICAL and provable byte-identical, exactly like the original 8a `_shared` extraction of the
  3 primitives. Proof obligation: re-run the pg tokenizer suite (`test/adapters/engines/pg/tokenizer.test.ts`)
  AND the pg golden integration (`extract.integration.test.ts`) in the SAME batch as the move, BEFORE MySQL
  consumes the shared helpers — goldens MUST stay byte-identical. (MSSQL is unaffected — it never imported
  these two functions, so no MSSQL re-run is required for THIS move, unlike the 8a extraction which did touch
  MSSQL.)

**Scanner-safety note for `bodyContainsRef` promotion:** the function builds `new RegExp(...)` from canonical
qnames — these are regex literals, not SQL string literals, and contain no write verbs, so the write-verb
scanner is unaffected. Keep the existing `escapeRegex` helper alongside it.

**MySQL canonicalizer** (`mysqlCanonicalize`): MySQL quotes identifiers with BACKTICKS (and double-quotes only
under `ANSI_QUOTES` mode). Strip backticks and (defensively) double-quotes, lowercase. Build the backtick
pattern WITHOUT a literal backtick char that could confuse tooling — use a `String.fromCharCode(96)` template
(mirrors the pg `String.fromCharCode(34)` dquote trick) to keep the source lint/scanner-clean. Pass
`mysqlCanonicalize` as the `canon` argument to the shared `classifyAccess`/`bodyContainsRef`.

**`hasMysqlDynamicSql`** = `/\b(prepare|execute)\b/i.test(body)` on the ORIGINAL (unmasked) body. NO
`EXECUTE FUNCTION` strip (MySQL trigger DDL has no such clause — simpler than pg). `PREPARE`/`EXECUTE` are NOT
in the scanner's write-verb list, so this regex literal is scanner-safe.

**`tokenizeMysqlBody(body, deps)`** (mirrors `tokenizePgBody`):
1. `dynamic = hasMysqlDynamicSql(body)`.
2. `staticBody = maskDynamicStrings(body)`.
3. For each dep with non-empty schema+name: skip unless `bodyContainsRef(staticBody, canon(qname))` (PRESENCE
   GATE — never default to read); then `classifyAccess(qname, staticBody, mysqlCanonicalize)`; push
   `{ target, access, confidence:'parsed' }`.
4. Static edges SURVIVE when `dynamic` is true (only dynamic-string refs are excluded — consistent with pg).
Self-edges are impossible (an object body never contains its own qname as a referenced target; the presence
gate naturally filters it).

## Decision §5 — Error mapper

See the `error-mapper.ts` table above. Pure function: same input → same output, no side effects, no top-level
`mysql2` import (reads only `err.errno` / `err.code`). Unit-tested with captured `mysql2`-shaped error objects
(`{ errno, code, message }`) — NEVER a live connection. The factory's `MODULE_NOT_FOUND` path is mapped
separately in `factory.ts` (catch around the lazy import) to `ConnectionError('… npm i mysql2')`, mirroring pg.

## Decision §6 — Fingerprint

See the `fingerprint()` section above. The marker is intentionally COUNT-based over COLUMNS + TABLES +
ROUTINES (not `UPDATE_TIME`) so it MOVES on `ADD COLUMN` and on object add/drop while staying STABLE on DML.

## Decision §7 — Config & the discriminator wrinkle (resolved)

**Verified:** `src/infra/open-connections.ts` dispatches with `if (resolved.dialect === 'sqlite') … else if
(resolved.dialect === 'pg') … else { /* mssql */ }` — i.e. on the EXPLICIT `dialect` STRING from the parsed
config, NOT by structurally narrowing `SchemaAdapterConfig`. `parse-config.ts` likewise switches on the
`dialect` field. Therefore adding `MysqlAdapterConfig` (which ALSO has `host`, like `PgAdapterConfig`) is SAFE
at runtime — there is no shape-based narrowing to break.

Actions (MANDATORY, no ambiguity left):
1. **FIX the stale JSDoc** on `PgAdapterConfig` (`schema-adapter.ts:63-67`) that claims it is "distinguished
   from SqliteAdapterConfig by the presence of `host`". After this change pg and mysql BOTH have `host`, so
   that claim is false. Rewrite it (and the union JSDoc) to state: "These config shapes are NOT discriminable
   by structure (pg and mysql both carry `host`). The union is a plain structural union for typing only;
   runtime dispatch is by the EXPLICIT config `dialect` field in parse-config.ts / open-connections.ts, and
   each engine factory takes its own concrete config type directly. No `dialect` discriminant is added to the
   union members."
2. **Do NOT** add a `dialect` tag to the union members — that would churn `SqliteAdapterConfig`,
   `MssqlAdapterConfig`, and `PgAdapterConfig` for zero runtime benefit (dispatch already keys on the parsed
   config `dialect`).
3. Add `MysqlAdapterConfig` to the union; add `MysqlSource` (config schema, `port`/`ssl` as strings parsed
   later); add `'mysql'` to `SUPPORTED_DIALECTS` and the `mysql` `DbgraphConfig` member.
4. `parseMysqlSource`: require `host`/`database`/`user`/`password`; REJECT a literal `password` (reuse the
   `isEnvRef` / `ENV_REF_RE` pattern from `parsePgSource`); optional `port`/`ssl`. NO `schema` field (database
   IS the scope).
5. `open-connections.ts`: add an `else if (resolved.dialect === 'mysql')` branch wiring
   `createMysqlSchemaAdapter({ host, port?: parseInt, database, user, password, ssl?: ssl === 'true' })`; add
   `createMysqlSchemaAdapter` to the `AdapterAndStore` adapter union and the local `let adapter:` union.

## Decision §8 — The pinned-error change

`src/core/errors.ts` `UnsupportedDialectError` message → `Available dialects: sqlite, mssql, pg, mysql.`
(MESSAGE-ONLY; class, `code: 'E_UNSUPPORTED_DIALECT'`, and `instanceof` behaviour UNCHANGED). Update its pinned
assertion in the SAME batch: a `test/core/errors-mysql.test.ts` mirroring `errors-pg.test.ts` asserting the
message `toContain('sqlite, mssql, pg, mysql')` and still contains `mysql`/`pg`/`mssql`/`sqlite` + the bad
dialect name + unchanged code/name. Add `test/cli/exit-code-mysql.test.ts` (mirror `exit-code-pg.test.ts`)
asserting `exitCodeFor(new UnsupportedDialectError('mysql')) === 4` and `('redis') === 4` via the `instanceof`
path — proving the message change did NOT perturb the mapping. **`src/cli/exit-code.ts` gets NO code change.**

## Decision §9 — Testing strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `tokenizeMysqlBody` (PREPARE/EXECUTE → dynamic; presence gate; mask; backtick canon), `map.ts`, `mapMysqlError`, `parseMysqlSource` (`mysql`), `capabilitiesFor('mysql')`, config-union | Vitest, captured-row fixtures, NO db/mocks |
| Unit (gate) | pg golden + pg tokenizer byte-identical AFTER the `_shared` promotion (D10) | Re-run in the promotion batch BEFORE MySQL consumes `_shared/` |
| Golden | `torture.sql` → `buildMysqlRawCatalog` → pinned `RawCatalog` JSON | Deterministic snapshot via `stableStringify` |
| Integration/E2E | `mysql:8` Testcontainers: extract → normalize → upsert → query | Gated `DBGRAPH_INTEGRATION=1`; `describe.skipIf(!mysqlIntegrationEnabled())`; per-suite 120s hookTimeout |
| CI | `mysql-integration` job in `ci.yml` | Mirrors `pg-integration` (Linux, `needs: []`, `DBGRAPH_INTEGRATION=1`, `npm run test:integration`); NEVER blocks the unit matrix |
| Scanner | write-verb scanner over `engines/**` | Must stay green; no scanner-false JSDoc literals in `mysql/**` |

**`test/fixtures/mysql/container.ts`** mirrors `pg/container.ts`: `mysql:8` image, `MYSQL_ROOT_PASSWORD` /
`MYSQL_DATABASE` env, poll `SELECT 1` over a real `mysql2` connection (port-open is insufficient — MySQL takes
seconds to accept after the port opens), apply `torture.sql` (split on `;` if the multi-statement driver flag
is not enabled; prefer `multipleStatements: true` on the seed connection only). Expose a `MysqlContainerHandle`
with a ready `MysqlAdapterConfig` + `stop()`.

**`test/fixtures/mysql/torture.sql`** MUST exercise 100% of `MYSQL_CAPABILITIES`:
- tables: `products`, `orders`, `order_items`, `audit_log`.
- `AUTO_INCREMENT` column (`audit_log.audit_id INT AUTO_INCREMENT PRIMARY KEY`) — golden asserts NO sequence
  object + the column carries `extra.autoIncrement: true`.
- generated column (`order_items.total_price ... GENERATED ALWAYS AS (qty * unit_price) STORED`).
- composite/ordered FK (`order_items (order_id, product_id)` → … ; at least one multi-column or two FKs with
  explicit `ORDINAL_POSITION` ordering) + a CHECK (`products CHECK (unit_price >= 0)`, 8.0.16+) + PK + UNIQUE.
- prefix index and/or functional index (`idx_products_name_lower ON products ((lower(name)))` for the
  `EXPRESSION` path) + a composite index for `SEQ_IN_INDEX` ordering.
- view (`v_order_summary` reading `orders` + `order_items`).
- procedure `fn_place_order`-equivalent writing TWO tables, reading ONE (for exact edge assertions); a function
  `audit_fn`-equivalent writing ONE table, zero reads; a routine with a STATIC write AND a dynamic
  `PREPARE`/`EXECUTE` block whose ONLY references to a third table are INSIDE the prepared-statement string
  literal (proves the mask gate: ZERO edges + `hasDynamicSql: true`).
- trigger (`AFTER UPDATE ON orders`) → assert `timing: 'AFTER'`, `events: ['UPDATE']`, `table.name: 'orders'`.
- comments: `TABLE_COMMENT` on a table + `COLUMN_COMMENT` on a column.

**EXACT-set edge assertions from the start** (mirror `pg/extract.integration.test.ts`, the CRITICAL-1 regression
style — NOT existence-only `find().toBeDefined()`):
- the writer routine: `deps.length === N`, `writes === 2`, `reads === 1`, `expect(names).toEqual([...sorted])`,
  and explicit `expect(deps.find(d => d.target.name === '<self>')).toBeUndefined()` + no-phantom-to-absent.
- the view: `expect(names).toEqual(['order_items','orders'])` + no-self + no-phantom.
- the dynamic routine: `expect(fn.hasDynamicSql).toBe(true)` AND `expect(deps.length).toBe(0)`.
- determinism: second extract `stableStringify(a) === stableStringify(b)`; golden seeds on first run, byte-equal
  thereafter.

## Migration / Rollout

No data migration. Fully additive (proposal Rollback). `mysql2` is a lazy optional dep — absence yields
`ConnectionError('… npm i mysql2')`, never a load-time crash. `_shared/tokenizer-core.ts` change is a pure move
proven byte-identical for pg (the only existing consumer of the promoted helpers).

## Batch Ordering (for sdd-tasks / sdd-apply)

The proposal lists 6 batches (no `_shared` extraction). The D10 PROMOTION adds ONE small, well-bounded
move-and-prove step at the FRONT. Net: **7 batches** (still leaner than 8a's 7-with-MSSQL-gate because the
promotion touches only pg, not MSSQL).

1. **`_shared` promotion + pg byte-identical gate (D10).** Move `maskDynamicStrings` + `bodyContainsRef` into
   `_shared/tokenizer-core.ts` (export both); refactor `pg/tokenizer.ts` to import them; delete pg local
   copies. RE-RUN `pg/tokenizer.test.ts` + `pg/extract.integration.test.ts` (golden) — MUST be byte-identical.
   No MySQL code yet.
2. **Config + capabilities plumbing.** `MYSQL_CAPABILITIES` (`capabilities.ts`) + `MysqlAdapterConfig` on the
   union (and the `host` JSDoc fix + union JSDoc, Decision §7) + `MysqlSource` + `'mysql'` in
   `SUPPORTED_DIALECTS` + `parseMysqlSource`/`case 'mysql'`. No live connection.
3. **Driver seam + factory + error-mapper.** `driver.ts` (`MysqlReadonlyDriver` over `ConnectionLike`,
   normalize `[rows,fields]` → rows) + `error-mapper.ts` (`mapMysqlError`, unit-tested) + `factory.ts`
   (`createMysqlSchemaAdapter`, lazy `import('mysql2/promise')`, `MODULE_NOT_FOUND` → `ConnectionError`).
4. **Queries + map + tokenizer + adapter.** `queries.ts` (`information_schema` SELECTs, all `= DATABASE()`,
   all `ORDER BY`) + `map.ts` (rows → sorted `RawCatalog`; `schema=database`; AUTO_INCREMENT/generated on
   column; CHECK; index grouping; trigger timing/event; `engine:'mysql'`) + `tokenizer.ts`
   (`hasMysqlDynamicSql` = `PREPARE`/`EXECUTE`; `tokenizeMysqlBody` wiring shared mask+gate) +
   `mysql-schema-adapter.ts`. UNIT tests assert EXACT dep sets / no-self / no-phantom.
5. **Dispatch wiring + pinned message.** `open-connections.ts` `mysql` branch, `capabilitiesFor('mysql')` +
   barrel re-export (`createMysqlSchemaAdapter` + `MYSQL_CAPABILITIES`), the `UnsupportedDialectError` message
   → `sqlite, mssql, pg, mysql` + its pinned assertion + the `exitCodeFor → 4` regression assertion (SAME
   batch; NO `exit-code.ts` code change).
6. **Permissions doc.** `docs/permissions/mysql.md` (minimal read-only user) + `PermissionError` doc-link
   wiring verified in `error-mapper.ts`.
7. **Fixtures + Testcontainers E2E + CI.** `test/fixtures/mysql/{torture.sql,container.ts}` + `mysql:8` extract
   → golden `RawCatalog` → normalize → upsert → query E2E (EXACT edge counts / endpoints / no-self / dynamic
   ZERO-edge) + the gated `mysql-integration` CI job + write-verb scanner re-run + lint. Refine US-029 in
   `docs/stories/05-adapters.md`.

## Open Questions

- [ ] None blocking. The exact `mysql:8` `information_schema` row shapes (e.g. precise `EXTRA` string for a
      generated-stored column, `EXPRESSION`/`SUB_PART` presence for the functional/prefix index) are finalized
      in `sdd-tasks`/`sdd-apply` against the live container and pinned by the golden. If duplication (D10
      option b) is preferred by a reviewer over promotion, only Batch 1 changes (drop the pg refactor; add the
      two functions to `mysql/tokenizer.ts` instead) — the rest of the design is unaffected.
