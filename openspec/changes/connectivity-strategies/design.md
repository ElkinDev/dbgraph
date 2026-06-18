# Design: Connectivity Strategies — Integrated-Security & External-Tool Connectivity

## Technical Approach

Introduce a driver-free `ConnectivityStrategy` port in core (`src/core/ports/connectivity-strategy.ts`,
ADR-004 — imports ONLY `RawCatalog`/`ExtractionScope`, ZERO driver/tool/`child_process` imports). Concrete
strategies live under `src/adapters/engines/mssql/strategies/`. A per-engine ORDERED registry, owned inside
the SINGLE `createMssqlSchemaAdapter` factory, probes strategies in priority order and returns a `SchemaAdapter`
backed by the FIRST that `detect()`s + `canConnect()`s. The linchpin: `buildMssqlRawCatalog` (`map.ts`) is
already tedious-free and consumes plain typed rows (`MssqlRowInput` = `TableRow`/`ColumnRow`/… all exported);
the sqlcmd and manual-dump strategies parse `FOR JSON PATH` output into those SAME rows and call
`buildMssqlRawCatalog` UNCHANGED. `queries.ts` constants are reused verbatim (wrapped in `FOR JSON PATH`).
Shelling out via `node:child_process` (Node builtin, ZERO new npm deps) is a separate OS process — like
invoking `git` — NOT a wire-protocol driver, so ADR-006 ("100% JS drivers") stays intact. Consent gates the
only install path. External strategies issue ONLY the catalog SELECTs, preserving read-only; the existing
write-verb scanner already recurses `src/adapters/engines/**`, so `strategies/` is covered automatically.

## Architecture Decisions

### Decision: `ConnectivityStrategy` port in core, driver-free (ADR-004)

**Choice**: `src/core/ports/connectivity-strategy.ts`, re-exported via `ports/index.ts` + `core/index.ts`.

```ts
import type { RawCatalog } from '../model/catalog.js';
import type { ExtractionScope } from '../model/capability.js';
import type { Logger } from './logger.js';

export interface DetectResult { readonly available: boolean; readonly detail?: string; }

export interface ConnectivityStrategy {
  readonly id: string;                              // 'native-tedious' | 'sqlcmd' | 'manual-dump' | 'consented-install'
  detect(): Promise<DetectResult>;                  // is the prerequisite present? (tool on PATH, dump file, creds)
  canConnect(): Promise<boolean>;                   // cheap probe (SELECT 1 / file readable)
  runCatalog(scope: ExtractionScope): Promise<RawCatalog>;
  close?(): Promise<void>;
}

export interface StrategyAttempt { readonly id: string; readonly reason: string; }  // why it was skipped/failed
```

`StrategyExhaustionError` lives in `src/core/errors.ts` (code `E_STRATEGY_EXHAUSTION`), extends `DbgraphError`,
carries `readonly attempts: readonly StrategyAttempt[]`, message lists each strategy tried + why. Added to the
`core/index.ts` error barrel.

**Alternatives considered**: strategy interface in adapters (rejected — registry selection is engine-agnostic
domain logic; ADR-004 keeps the contract in core); a single mega-adapter with `if (integrated)` branches
(rejected — untestable, violates open/closed, no clean Oracle seam). **Rationale**: a port + per-engine registry
mirrors the existing `SchemaAdapter` seam and lets future engines add their own `strategies/` without touching
core or other engines.

### Decision: Registry lives in the factory; selection iterates in priority order

**Choice**: `src/adapters/engines/mssql/strategies/registry.ts` exports `buildMssqlStrategies(config, deps): ConnectivityStrategy[]`
in fixed order — **native-tedious** (ONLY when `authentication.type !== 'integrated'`) → **sqlcmd** → **manual-dump**
→ **consented-install**. `createMssqlSchemaAdapter` calls a `selectStrategy(strategies, logger)` helper: for each,
`await detect()`; if available, `await canConnect()`; first that passes WINS — log `info("native failed → sqlcmd
found → using sqlcmd", {…})` via the injected `Logger`. Exhausting all → throw `StrategyExhaustionError(attempts)`.
The selected strategy is wrapped in a thin `StrategyBackedSchemaAdapter` whose `extract` delegates to
`runCatalog`, `fingerprint()` delegates (native) or derives from the dump (offline), `close()` calls
`strategy.close?.()`.

**Alternatives considered**: config picks strategy explicitly (rejected — defeats transparent auto-probe, the
core value); parallel probing (rejected — non-deterministic order, wasted spawns). **Rationale**: deterministic,
transparent, logged; native stays the default for explicit creds (full back-compat).

### Decision: `integrated` auth mode — additive, no credentials required

**Choice**: extend the port union and the config schema additively.

```ts
// schema-adapter.ts — MssqlAdapterConfig.authentication gains a third member:
| { readonly type: 'integrated' }            // no user/password/domain — current Windows session
```

`schema.ts` `MssqlSource` adds an optional `auth?: 'sql' | 'ntlm' | 'integrated'` discriminator (default inferred
as today: `domain` → ntlm, else sql). `parse-config.ts` `parseMssqlSource`: when `auth === 'integrated'`, do NOT
call `requireString` on `user`/`password`/`domain` — only `requireString(server)` + `requireString(database)`;
existing sql/ntlm paths unchanged. `resolve-secrets.ts` `resolveMssqlSource`: skip `user`/`password`/`domain`
resolution when absent (guard each with the existing `!== undefined` pattern). `open-connections.ts` (lines
79-91) adds an `integrated` arm building `authentication: { type: 'integrated' }`.

**Alternatives considered**: a separate top-level config block (rejected — breaks the structural union; the
Phase-3 design explicitly mandated additive members). **Rationale**: existing SQL/NTLM configs parse & resolve
byte-identically; round-trip test pins it.

### Decision: sqlcmd strategy — `FOR JSON PATH`, line reassembly, validation boundary

**Choice**: `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts`.
- **detect()**: `spawnSync('where', ['sqlcmd'])` (Win) / `which` (POSIX); fallback capability probe
  `spawnSync('sqlcmd', ['-?'])` exit 0. Capability, NOT version (handles legacy ODBC vs go-sqlcmd).
- **canConnect()**: `spawnSync('sqlcmd', ['-E','-S',server,'-d',db,'-Q','SELECT 1','-h','-1'], {timeout})` exit 0.
  Timeout configurable (default ~10s).
- **runCatalog(scope)**: for each of the 11 `queries.ts` constants, wrap as
  `SELECT ... FOR JSON PATH, INCLUDE_NULL_VALUES` (the `ORDER BY` is preserved INSIDE the wrapped SELECT for
  ADR-008 determinism), spawn `sqlcmd -E -S <server> -d <db> -Q "<wrapped>" -y 0 -h -1 -W`. `-y 0` = unlimited
  column width (FOR JSON emits one wide column), `-h -1` = no headers, `-W` = trim trailing spaces.
- **REASSEMBLY**: `FOR JSON` splits one JSON document across MANY stdout lines at ~2033-byte boundaries. Algorithm:
  capture full stdout, split into lines, trim the trailing `\r`, drop the `(N rows affected)` footer line(s) and
  blank lines, CONCATENATE remaining lines into one string, then `JSON.parse`. Empty result → `[]`.
- **VALIDATION boundary**: before casting to `*Row[]`, validate each parsed object: presence-check required keys,
  coerce SQL Server `bit` `0/1` (sqlcmd JSON emits numbers) → `boolean` for `is_nullable`/`is_computed`/
  `is_unique`/`is_primary_key`/`is_unique_constraint`/`is_included_column`/`is_instead_of_trigger`/`is_cycling`,
  coerce numeric strings → `number` for `object_id`/`column_id`/`*_ordinal`/`*_column_id`/`fk_id`, normalize
  absent → `null` for nullable text fields. Malformed → throw (caught by selection → next strategy + log). THEN
  cast to `MssqlRowInput` and call `buildMssqlRawCatalog(input, scope)` UNCHANGED.
- **Spawn safety**: ALL config values passed as ARGV array elements (never a shell string); `{ shell: false }`.

**Alternatives considered**: native bcp/osql (out of scope); `-s` delimited columns + manual reassembly per query
(rejected — `FOR JSON` reuses `map.ts` row shapes exactly). **Rationale**: one parse path feeding the unchanged
mapper; multi-line reassembly is the documented FOR JSON behavior and is pinned by a golden.

### Decision: native-tedious strategy wraps the existing factory

**Choice**: `strategies/native-tedious.strategy.ts` = `NativeTediousStrategy`. `detect()` returns
`{available: authentication.type !== 'integrated'}` (tedious cannot do integrated SSPI, ADR-006). `canConnect()`
attempts the lazy `import('mssql')` + `pool.connect()` (mapping via `mapMssqlError`); `runCatalog` reuses the
EXISTING `createMssqlReadonlyDriver` + `MssqlSchemaAdapter.extract`. Existing `factory.ts` connect/pool/error-map
logic is MOVED into this strategy; `createMssqlSchemaAdapter` becomes the registry selector.

**Rationale**: zero behavior change for explicit creds; the tedious path is one strategy among peers.

### Decision: manual-dump strategy + dump-script emitter

**Choice**: `strategies/manual-dump.strategy.ts` + `strategies/dump-emitter.ts`.
- **Emitter**: composes a single runnable `.sql` script from the 11 `queries.ts` constants, each wrapped in
  `FOR JSON PATH` and aliased so the operator can run it via SSMS/sqlcmd and save ONE combined JSON object
  `{ tables: [...], columns: [...], …, dependencies: [...] }` matching `MssqlRowInput`.
- **detect()**: the configured dump file exists & is readable under a gitignored dir (default `.dbgraph/dumps/`).
- **runCatalog**: read the file, `JSON.parse`, run the SAME validation boundary as sqlcmd, cast to `MssqlRowInput`,
  call `buildMssqlRawCatalog`. **File format**: one JSON object, the exact `MssqlRowInput` shape.
- **.gitignore**: add `.dbgraph/dumps/` (schema + proc source are sensitive — R8).

**Rationale**: a fully offline path for air-gapped/no-tool machines, reusing the identical mapper + validation.

### Decision: consented-install (B1 guided) — recipe registry + consent gate, B2 seam

**Choice**: `strategies/consented-install.strategy.ts` + `strategies/install-recipes.ts`. The recipe registry
maps `tool → { os: 'win32'|'darwin'|'linux'; method: 'winget'|'brew'|'url'; id?: string; url: string }[]` of
OFFICIAL sources (e.g. sqlcmd → winget `Microsoft.Sqlcmd` / Microsoft Learn URL). `runCatalog` does NOT install;
it PRINTS the matching recipe behind an explicit consent notice via `Logger.info` and throws
`StrategyExhaustionError` carrying the guidance (B1 = guided only). A clearly-marked seam
(`// B2: automated execution goes here`) leaves room for future consented `spawn`.

**Alternatives considered**: automated install now (DEFERRED per proposal — B2 out of scope). **Rationale**:
honors "no install without consent"; the registry + gate are modeled now so B2 is a localized change.

### Decision: Read-only inviolable on every path; scanner covers `strategies/`

**Choice**: every strategy issues ONLY the existing catalog SELECTs (no new SQL verbs). The write-verb scanner
(`test/adapters/engines/security-scan.test.ts`) already recurses `src/adapters/engines/**` via `collectTsFiles`,
so `strategies/` is scanned with NO test change. `winget`/URL recipe strings are not SQL-looking, so
`looksLikeSql` does not flag them; the `FOR JSON PATH` wrapper adds no write verb.

**Rationale**: read-only is enforced structurally + by the existing negative-control scanner.

## Data Flow

```
createMssqlSchemaAdapter(config, { logger })
   │  buildMssqlStrategies(config) → [native?, sqlcmd, manual-dump, consented-install]
   │  selectStrategy: for each → detect() → canConnect()  (first pass WINS; log via Logger)
   │     none pass → throw StrategyExhaustionError(attempts)
   ▼
StrategyBackedSchemaAdapter.extract(scope)
   │  sqlcmd:      spawn FOR JSON → reassemble lines → JSON.parse → VALIDATE/COERCE → MssqlRowInput
   │  manual-dump: read gitignored JSON      → JSON.parse → VALIDATE/COERCE → MssqlRowInput
   │  native:      pool → 11 sys.* SELECTs (unchanged MssqlSchemaAdapter)      → MssqlRowInput
   ▼
buildMssqlRawCatalog(input, scope)  ── UNCHANGED ──▶ RawCatalog
   ▼
normalizeCatalog → SqliteGraphStore.upsertGraph → query API
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/ports/connectivity-strategy.ts` | Create | `ConnectivityStrategy`, `DetectResult`, `StrategyAttempt` (core types only) |
| `src/core/ports/index.ts` + `src/core/index.ts` | Modify | Re-export the new port types |
| `src/core/errors.ts` + `core/index.ts` barrel | Modify | Add `StrategyExhaustionError` (`E_STRATEGY_EXHAUSTION`, lists attempts) |
| `src/core/ports/schema-adapter.ts` | Modify | Add `{ type: 'integrated' }` to `MssqlAdapterConfig.authentication` |
| `src/infra/config/schema.ts` | Modify | `MssqlSource` gains optional `auth` discriminator (sql/ntlm/integrated) |
| `src/infra/config/parse-config.ts` | Modify | `integrated` → do NOT `requireString` user/password/domain |
| `src/infra/config/resolve-secrets.ts` | Modify | Skip absent credential fields for `integrated` |
| `src/infra/open-connections.ts` | Modify | Add `integrated` arm (lines 79-91) |
| `src/adapters/engines/mssql/strategies/registry.ts` | Create | `buildMssqlStrategies` + `selectStrategy` (ordered, logged) |
| `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` | Create | Wraps existing factory connect/pool/error-map |
| `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts` | Create | `-E` detect/connect/run; FOR JSON reassembly + validation |
| `src/adapters/engines/mssql/strategies/manual-dump.strategy.ts` | Create | Offline JSON ingest → `map.ts` |
| `src/adapters/engines/mssql/strategies/dump-emitter.ts` | Create | Composes `queries.ts` + FOR JSON → runnable script |
| `src/adapters/engines/mssql/strategies/install-recipes.ts` | Create | Official recipe registry (winget/brew/URL per OS) |
| `src/adapters/engines/mssql/strategies/consented-install.strategy.ts` | Create | Consent gate; prints recipe; B2 seam |
| `src/adapters/engines/mssql/strategies/json-rows.ts` | Create | Shared FOR-JSON validation/coercion → `MssqlRowInput` |
| `src/adapters/engines/mssql/factory.ts` | Modify | Becomes the registry selector (back-compat for sql/ntlm) |
| `src/adapters/engines/mssql/map.ts` / `queries.ts` | Reused | UNCHANGED — fed by parsed/validated rows |
| `.gitignore` | Modify | Ignore `.dbgraph/dumps/` (sensitive schema/proc source) |
| `test/adapters/engines/mssql/strategies/*.test.ts` + golden JSON | Create | Mocked `child_process`/stdout; recorded ANONYMIZED dump golden |

## Interfaces / Contracts

`ConnectivityStrategy` / `DetectResult` / `StrategyAttempt` / `StrategyExhaustionError` as in the decisions above.
The dump file and sqlcmd FOR-JSON output BOTH conform to `MssqlRowInput` after the shared `json-rows.ts`
validation/coercion. `buildMssqlRawCatalog`, `queries.ts`, `RawCatalog`, `ExtractionScope`, `Logger`,
`createMssqlReadonlyDriver`, `MssqlSchemaAdapter` are consumed UNCHANGED.

## Testing Strategy (Strict TDD — RED first)

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | sqlcmd `detect()` | mock `child_process.spawnSync` (where/which present+absent, `-?` probe) |
| Unit | sqlcmd `canConnect()` | mock spawnSync exit 0 / non-zero / timeout |
| Unit | sqlcmd `runCatalog()` + REASSEMBLY | mock stdout incl. a MULTI-LINE split-JSON payload (proves concat) + `(rows affected)` footer stripping |
| Unit | FOR-JSON row validation/coercion | `json-rows.test.ts`: `0/1`→bool, numeric-string→number, absent→null, malformed→throw |
| Unit | dump emitter | asserts every `queries.ts` constant is wrapped in `FOR JSON PATH`, aliased, read-only |
| Unit | manual-dump ingest | golden from a RECORDED ANONYMIZED JSON dump → byte-identical `RawCatalog` (ADR-008) |
| Unit | registry selection order + exhaustion | mocked strategies: native skipped for integrated; first-pass wins; all fail → `StrategyExhaustionError` lists attempts |
| Unit | config integrated round-trip | `parse-config`/`resolve-secrets`: integrated needs no creds; sql/ntlm unchanged |
| Security | write-verb scan over `strategies/` | EXISTING `security-scan.test.ts` recurses `engines/**` — confirm it lists a `strategies/` file; no test change |
| Boundary | port import hygiene | `boundaries.test.ts`: `connectivity-strategy.ts` imports no driver/tool/`child_process` |

NO Docker needed — all `child_process` interaction is mocked; the dump golden is a committed anonymized fixture.

## Migration / Rollout

Additive and back-compatible. Public API gains the port types + `StrategyExhaustionError`; `createMssqlSchemaAdapter`
keeps its signature (add an optional `{ logger }` dep). Existing SQL/NTLM configs and the SQLite adapter are
untouched and green. Revert per the proposal Rollback Plan (delete the port, `strategies/`, the `integrated` arm,
`StrategyExhaustionError`; restore `open-connections.ts`).

## Apply Batch Ordering

- **A** — Port + `StrategyExhaustionError` + `{type:'integrated'}` on `MssqlAdapterConfig`; `schema.ts`/`parse-config.ts`/`resolve-secrets.ts` integrated arm; barrels.
- **B** — `native-tedious.strategy.ts` (move factory logic) + `sqlcmd.strategy.ts` + `json-rows.ts` (FOR JSON reassembly + validation), reusing `map.ts`/`queries.ts`.
- **C** — `registry.ts` (`buildMssqlStrategies` + `selectStrategy`) in `createMssqlSchemaAdapter`; `open-connections.ts` wiring; `Logger` transparency/verbosity.
- **D** — `manual-dump.strategy.ts` + `dump-emitter.ts` + `.gitignore` dump dir + recorded golden.
- **E** — `install-recipes.ts` + `consented-install.strategy.ts` (B1 consent gate) + `StrategyExhaustionError` UX.
- **F** — Tests / E2E / boundary (port hygiene, read-only-on-all-paths, write-verb scan over `strategies/`) / lint sweep.

## Engine-Agnostic Extensibility

Oracle/others later add their own `src/adapters/engines/<engine>/strategies/` + a `build<Engine>Strategies` registry
and call `selectStrategy` inside their OWN factory. The core port and `StrategyExhaustionError` are shared; no core
or cross-engine change is required — exactly the additive seam the `SchemaAdapter` union already established.

## Open Questions

- [ ] Exact sqlcmd `FOR JSON` line-split byte boundary across sqlcmd versions — pinned by the multi-line golden; reassembly is split-agnostic (pure concat).
- [ ] Whether `INCLUDE_NULL_VALUES` vs `WITHOUT_ARRAY_WRAPPER` is needed for single-row families (e.g. fingerprint) — resolve in apply against a real capture; isolated in `json-rows.ts`.
