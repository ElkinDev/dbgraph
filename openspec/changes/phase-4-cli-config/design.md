# Design: Phase 4 — CLI & Config

## Technical Approach

`src/cli/` is a new DRIVING adapter: it imports ONLY the public barrel `src/index.ts` plus Node builtins
(`node:fs`, `node:path`, `node:readline`, `node:process`) — NEVER `src/adapters/**` (ADR-004). Each command maps
to the existing public API verified in the live code: `init/sync` → `createSqliteSchemaAdapter`/
`createMssqlSchemaAdapter` (composition-root factories already exported) + `adapter.extract`/`fingerprint` +
`store.getNodesByKind`/`deleteNodes`/`upsertGraph`/`putSnapshot`; `status` → `listSnapshots`+`fingerprint`+`getNodesByKind`
counts; `query` → `search(store, {term})` → `SearchResult{hits,total}`; `explore` → `getNeighbors(store, {nodeId})` →
`NeighborGroups`; `diff` → the new `snapshot_objects` manifest. All stdout flows through PURE, driver-free,
golden-pinned formatters (ADR-008); the `explore` formatter is the seed Phase-5 MCP reuses. Two new typed errors —
`ConfigError`, `UnsupportedDialectError` — join `src/core/errors.ts` (referenced in conventions, absent from the live
file). Storage gains a v2 migration adding `snapshot_objects`; `dbgraph.config.json` lives at the project root with
`${env:VAR}`-only identity fields; `.dbgraph/` stays fully gitignored. ZERO new runtime deps.

## Architecture Decisions

### Decision 1: Local-index v1→v2 — AUTO-MIGRATE via an appended forward migration (NOT `sync --full`)

**Choice**: Append `{ version: 2, up }` to the existing `MIGRATIONS` array in `migrations.ts` and bump
`CURRENT_SCHEMA_VERSION` 1→2. The live runner is ALREADY forward-only and idempotent: it reads
`meta.schema_version` (the project uses `meta`, NOT the `user_version` PRAGMA the proposal mentioned), runs
`MIGRATIONS.filter(m => m.version > current)` inside ONE transaction, then writes the new version. The v2 `up`
runs `CREATE TABLE IF NOT EXISTS snapshot_objects(...)` + its index. A pre-v2 index opened by a v2 binary
silently migrates on the next `createSqliteGraphStore` (factory calls `runMigrations`); EXISTING v1 snapshots
simply have NO manifest rows, so `diff` against them degrades gracefully (reported as "no manifest — re-sync to
enable per-object diff"), never crashes.
**`SchemaVersionError` interaction**: it fires ONLY when `observed > supported` (v2 index opened by an old v1
binary) — exactly the forward-incompat guard already in `runMigrations`. v1→v2 is `observed < supported`, the
normal pending-migration path; it never throws.
**Alternatives**: require `sync --full` rebuild — REJECTED: the index is a rebuildable cache but forcing a full
re-extract on every existing user is gratuitous when an additive `CREATE TABLE` is transactional and free; auto
also keeps the proposal's "byte-identical incremental" promise for unchanged objects.
**Rationale**: the migration framework was built for exactly this; auto-migrate is additive, transactional, and
reversible (rollback drops the table + restores the constant). The manifest is rebuilt on the first `sync`.

### Decision 2: ONE pure `explore` formatter in `src/cli/format/` consuming core types only

**Choice**: `formatExplore(input: ExploreView, detail: ExploreDetail): string` — a PURE function (no `process`,
no `Date.now()`, no driver, no adapter/cli-state imports) living at `src/cli/format/explore.ts`. Its input
`ExploreView` is assembled by the command from the public `GraphNode` + `NeighborGroups` types (both exported
from `src/index.ts`), so the formatter is import-clean and Phase-5's MCP tool can call the SAME function over
the SAME `ExploreView` → identical goldens ("same source, same golden" holds STRUCTURALLY). `--detail` levels:
`brief` (qname + kind + 1-line counts), `normal` (default: + grouped neighbors by edge kind, in/out, qname-sorted —
the order `getNeighbors` already guarantees), `full` (+ body presence/hash, level, dynamic-SQL warning).
**Where (boundary)**: it lives UNDER `src/cli/`, not in core, because core must stay free of presentation; it is
nonetheless pure and import-free of adapters, so Phase-5 (`src/mcp/`) may import `src/cli/format/explore.ts`
directly (cli→mcp is not a forbidden edge; only core→cli/adapters and cli→adapters are). If a future ADR forbids
mcp→cli, the file moves to a neutral `src/format/` with zero code change — flagged as Open Question.
**Alternatives**: put the formatter in core — REJECTED (presentation in core violates ADR-004's spirit; core has
`no console`/pure-domain rule). Duplicate the format in CLI and MCP — REJECTED (two goldens drift; the proposal's
whole point is one shared formatter).
**Rationale**: purity + core-only inputs give reuse without a boundary break; goldens pin bytes.

### Decision 3: `snapshot_objects` written BY the store at `putSnapshot` time from its OWN node rows

**Choice**: `SnapshotRecord` (verified) carries NO node list — only counts. Rather than widen the public port
signature, `putSnapshot(s)` ALSO populates `snapshot_objects(snapshot_id, node_id, kind, qname, body_hash)` by
reading the store's CURRENT `nodes` table inside the same transaction (`INSERT ... SELECT id, kind, qname,
body_hash FROM nodes WHERE missing=0 AND excluded=0 ORDER BY qname, id`). The manifest is thus a faithful
photograph of what is indexed at snapshot time. The port interface is UNCHANGED; only the SQLite implementation
gains the manifest write. `diff(a,b)` then reads two manifests and compares by `node_id`: added / removed /
changed (`body_hash` differs).
**Alternatives**: add a `nodes`/`manifest` parameter to `putSnapshot` — REJECTED (breaks the port and every
caller; the store already HAS the rows). Compute diff by re-extracting both states — impossible (old DB state is
gone). Store the manifest as JSON on the `snapshots` row — REJECTED (not queryable per-object; a child table with
a `snapshot_id` index is the honest relational shape and matches the existing `snapshots` design).
**Rationale**: keeps the public surface stable, sources the manifest from ground truth, and lifts the per-object
`diff` DEFERRAL with one additive table.

### Decision 4: Hand-rolled subcommand parser; `init -i` and flag form share ONE config-builder

**Choice**: `src/cli/parse/args.ts` — a tiny pure tokenizer: `parseArgv(argv): { command, positionals, flags }`
(supports `--flag value`, `--flag=value`, boolean `--json`/`--full`/`--last`, `-i`). `dispatch.ts` maps command →
handler. BOTH `init` paths (`-i` wizard and explicit flags) build a `DbgraphConfig` object via ONE pure function
`buildConfig(inputs): DbgraphConfig`, then serialize via ONE `writeConfig` (`JSON.stringify(cfg, null, 2) + '\n'`,
keys emitted in a FIXED order) → BYTE-IDENTICAL output, asserted by a golden. The wizard (`init/wizard.ts`) uses
`node:readline`; it offers ONLY object types present in the dialect's `CapabilityMatrix.supported` (see Decision 6).
**Password masking**: `readline` has no native mask; we set `output` to a muting writer (a `Writable` that drops
echo while `_masked` is true) for secret prompts, mirroring the common `readline` mask idiom — ZERO new deps.
Secrets are NEVER written to config: the wizard records the ENV VAR NAME (e.g. `DBGRAPH_DB_PASSWORD`), not the value.
**Alternatives**: adopt `commander`/`yargs` — REJECTED (proposal mandates zero new runtime deps; six commands need
no framework). Two separate config builders — REJECTED (byte-identical guarantee impossible).
**Rationale**: a 6-command surface is trivially hand-parsable; one builder is the only way to honor byte-identity.

### Decision 5: `dbgraph.config.json` schema — ALL connection-identity fields are `${env:VAR}`; plaintext REJECTED

**Choice**: committeable `dbgraph.config.json` at PROJECT ROOT, schema below. `parseConfig` validates shape;
`resolveSecrets` expands `${env:VAR}` against `process.env` (missing var → `ConfigError` naming the var); the
WRITER (`buildConfig`/`writeConfig`) REJECTS any identity field whose value is not a `${env:VAR}` token →
`ConfigError`. Identity = host/port/database/user/domain/password (per the new security rule — NOT only secrets).
Env var names are GENERIC (`DBGRAPH_DB_HOST`, `DBGRAPH_DB_USER`, …); never project-specific. Resolved connection
objects are NEVER logged (no `console.log` of URLs; errors quote the VAR NAME, never the value).
**Alternatives**: secrets-only as env, identity inline — REJECTED by the new security rule (host/db names leak the
target). `.env` auto-load — REJECTED (adds `dotenv` dep; users export vars or use their own loader).
**Rationale**: a committeable file with zero resolvable identity is the only safe shareable artifact.

### Decision 6: Dialect→`CapabilityMatrix` lookup exposed through the public barrel (resolves the wizard boundary)

**Choice**: the wizard needs each dialect's capability matrix, but those constants live in
`src/adapters/engines/*/capabilities.ts` — which the CLI MUST NOT import. Resolution: `src/index.ts` (the
composition root, the legal core↔adapter seam) re-exports a `capabilitiesFor(dialect): CapabilityMatrix` lookup
(or the `SQLITE_CAPABILITIES`/`MSSQL_CAPABILITIES` constants). The CLI imports it from `src/index.ts` like
everything else. `CapabilityMatrix` is already a CORE type, so no driver leaks.
**Alternatives**: CLI imports `engines/*/capabilities.ts` — REJECTED (boundary violation, fails Decision 7's test).
Hard-code the object-type list in the CLI — REJECTED (drifts from the truthful matrix; wizard would offer
unsupported types).
**Rationale**: the barrel is the sanctioned seam; routing the matrix through it keeps the CLI adapter-free.

### Decision 7: Boundary test extended — `src/cli/**` must not import `src/adapters/**`

**Choice**: ADD `test/cli/boundaries.test.ts` reusing the EXISTING dependency-free scanner pattern from
`test/core/boundaries.test.ts` (`collectTsFiles` + `extractImportSpecifiers` regex). New rule: any `src/cli/**`
file importing a specifier containing `/adapters/` OR a forbidden driver package FAILS. The CLI MAY import
`../index.js` / `@niklerk23/dbgraph` and `node:*`. (The existing core test already forbids core→cli; this is the
reverse edge it does not yet cover.)
**Rationale**: the build must fail the instant the CLI reaches around the public API — the central hexagonal
invariant for this phase.

### Decision 8: Build — `tsup.config.ts` with TWO entries + `bin`

**Choice**: replace the inline `tsup src/index.ts ...` script with a `tsup.config.ts` exporting two entries:
`index` (`src/index.ts`, esm+cjs+dts — unchanged library output) and `cli` (`src/cli/cli.ts`, ESM only, no dts,
with `banner: { js: '#!/usr/bin/env node' }`). `package.json` gains `"bin": { "dbgraph": "./dist/cli.js" }` and the
`build` script becomes `tsup`. `src/cli/cli.ts` is the shebang entry that parses argv, dispatches, maps thrown
`DbgraphError`s to exit codes, and `process.exit`s.
**Alternatives**: chain a second `tsup src/cli/cli.ts` invocation in the script — REJECTED (`--clean` on the second
run wipes the first; a config file builds both atomically). Bundle the CLI into `index` — REJECTED (the library
must not carry a shebang/CLI entry).
**Rationale**: one config, atomic two-target build, correct executable bit via banner.

### Decision 9: Exit-code contract (CI-gate usable)

**Choice**: `0` success; `query --json` / `query` exits `1` on ZERO results (greppable in CI); `diff` exits `1`
when changes exist, `0` when none; any `DbgraphError` → exit `2` with the typed message on `stderr`
(`ConfigError`/`ConnectionError`/`PermissionError`/`UnsupportedDialectError`/`SchemaVersionError`); unknown command
→ exit `2` + usage. Mapping lives in `cli.ts` only; commands THROW or RETURN, never call `process.exit`
themselves — so commands stay unit-testable.
**Rationale**: deterministic codes make the CLI scriptable; centralizing exit in `cli.ts` keeps handlers pure.

## Data Flow

```
argv ─→ parseArgv ─→ dispatch ─→ handler
init:  buildConfig(flags|wizard) ─→ writeConfig (reject plaintext) ─→ dbgraph.config.json (root)
sync:  parseConfig+resolveSecrets ─→ createXxxSchemaAdapter ─→ extract(scope) ─→ normalizeCatalog
         ─→ createSqliteGraphStore (.dbgraph/, auto-migrate v1→v2)
         ─→ incremental: getNodesByKind → compare body_hash → deleteNodes(stale)+upsertGraph(changed)
         ─→ putSnapshot ──(writes snapshot_objects from current nodes)
status: listSnapshots + fingerprint() + getNodesByKind counts        ─┐
query:  search(store,{term}) → SearchResult                           ├─→ pure formatter → stdout
explore:getNeighbors(store,{nodeId}) → ExploreView → formatExplore    │   (exit code per Decision 9)
diff:   read snapshot_objects(a) vs (b|--last) → added/removed/changed ┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/errors.ts` | Modify | Add `ConfigError` (`E_CONFIG`), `UnsupportedDialectError` (`E_UNSUPPORTED_DIALECT`) |
| `src/core/index.ts` | Modify | Re-export the two new errors |
| `src/index.ts` | Modify | Re-export `capabilitiesFor`/dialect matrices (Decision 6) |
| `src/cli/cli.ts` | Create | Shebang entry: parse → dispatch → exit-code map (Decision 9) |
| `src/cli/parse/args.ts` | Create | Pure `parseArgv` tokenizer |
| `src/cli/dispatch.ts` | Create | command → handler table |
| `src/cli/config/{schema,parse-config,resolve-secrets,build-config,write-config}.ts` | Create | `DbgraphConfig` type, parse/validate, `${env:VAR}` resolve, shared builder, plaintext-rejecting writer |
| `src/cli/commands/{init,sync,status,query,explore,diff}.ts` | Create | Six handlers (throw/return; never `process.exit`) |
| `src/cli/init/wizard.ts` | Create | `node:readline` wizard, masked secret prompts, matrix-driven object types |
| `src/cli/sync/incremental.ts` | Create | `body_hash` delta: select stale/changed via `getNodesByKind` |
| `src/cli/diff/engine.ts` | Create | Pure manifest comparison (added/removed/changed) |
| `src/cli/format/{explore,query,status,diff}.ts` | Create | Pure golden-pinned formatters; `formatExplore` shared with P5 |
| `src/adapters/storage/sqlite/schema.ts` | Modify | Add `SNAPSHOT_OBJECTS_DDL` (table + `idx_snapshot_objects_snapshot`) |
| `src/adapters/storage/sqlite/migrations.ts` | Modify | Append `{version:2,up}`; `CURRENT_SCHEMA_VERSION = 2` |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | Modify | `putSnapshot` also fills `snapshot_objects`; add manifest read for `diff` |
| `package.json` | Modify | `"bin": { "dbgraph": "./dist/cli.js" }`; `build` → `tsup` |
| `tsup.config.ts` | Create | Two entries (`index`, `cli` ESM + shebang banner) |
| `.dbgraph/` (gitignore) | Modify | Ensure `.dbgraph/` ignored; `dbgraph.config.json` committed |
| `test/cli/boundaries.test.ts` | Create | Fail if `src/cli/**` imports `src/adapters/**`/driver (Decision 7) |
| `test/cli/**` (unit) | Create | RED-first units (see Testing Strategy) |
| `test/cli/e2e.test.ts` | Create | SQLite torture `init→sync→query/status/diff` (no Docker) |
| `test/cli/mssql.e2e.integration.test.ts` | Create | MSSQL `init→sync→query` via Testcontainers, `skipIf(!DBGRAPH_INTEGRATION)` |

## Interfaces / Contracts

```ts
// src/cli/config/schema.ts — committeable; identity fields are ${env:VAR} only
export interface DbgraphConfig {
  readonly dialect: 'sqlite' | 'mssql';
  readonly source:                                  // ${env:VAR} tokens, never plaintext
    | { readonly file: string }                      // sqlite (path may be literal)
    | { readonly server: string; readonly port?: string; readonly database: string;
        readonly user: string; readonly domain?: string; readonly password: string };
  readonly levels?: Partial<ObjectTypeLevels>;       // overrides CapabilityMatrix.defaultLevels
  readonly driver?: 'better-sqlite3' | 'node:sqlite';
}

// src/cli/format/explore.ts — PURE, core-typed input, shared with Phase-5 MCP
export type ExploreDetail = 'brief' | 'normal' | 'full';
export interface ExploreView { readonly node: GraphNode; readonly neighbors: NeighborGroups; }
export function formatExplore(view: ExploreView, detail: ExploreDetail): string;

// src/core/errors.ts — additions
export class ConfigError extends DbgraphError { constructor(m: string){ super(m,'E_CONFIG'); } }
export class UnsupportedDialectError extends DbgraphError {
  constructor(d: string){ super(`Unsupported dialect: "${d}".`, 'E_UNSUPPORTED_DIALECT'); } }
```

```sql
-- migrations.ts v2 up (additive, transactional)
CREATE TABLE IF NOT EXISTS snapshot_objects (
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  node_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  qname       TEXT NOT NULL,
  body_hash   TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshot_objects_snapshot ON snapshot_objects(snapshot_id);
```

## Testing Strategy

Strict TDD — every unit below is written RED FIRST, then made green. Test runner: `npm test` (vitest, excludes
`*.integration.test.ts`). CLI stdout is pinned by testing the PURE formatters against goldens — NOT by mocking
`process.stdout`. Handlers throw/return; `cli.ts` exit mapping is the only `process.exit` site and is covered by a
thin spawn-based check in E2E.

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | `parseArgv` flags/positionals/`=`/booleans | inline argv arrays → expected struct |
| Unit | `parseConfig` shape validation | valid/invalid JSON → `DbgraphConfig` or `ConfigError` |
| Unit | `${env:VAR}` resolution | set/unset `process.env` → resolved value or `ConfigError` naming var |
| Unit | plaintext rejection | literal host/user/password in `buildConfig` → `ConfigError` |
| Unit | `buildConfig` byte-identity | flag inputs vs equivalent wizard inputs → identical `writeConfig` string (golden) |
| Unit | wizard object-type offering | fed a `CapabilityMatrix` → offers only `supported` kinds |
| Unit | incremental node-selection | FAKE `GraphStore` (in-memory `GraphStore` double) seeded with `body_hash`es → asserts exact `deleteNodes`/`upsertGraph` id sets |
| Unit | diff engine | two manifest arrays → added/removed/changed sets |
| Unit | formatters (`explore`/`query`/`status`/`diff`) | fixed inputs → goldens (seed-on-first-run, ADR-008) |
| Unit | exit-code map | each `DbgraphError`/zero-result/diff-changed → expected code (pure mapper) |
| Boundary | `src/cli/**` ⇏ `src/adapters/**` | reuse `core/boundaries` scanner (Decision 7) |
| Integration | SQLite `init→sync→query/status/diff` | committed torture fixture; real `.dbgraph/`; assert stdout goldens + exit codes; second `sync` is no-op (incremental) |
| Integration | per-object `diff` across two syncs | mutate fixture body → `diff --last` shows `changed`, exit 1 |
| Integration (gated) | MSSQL `init→sync→query` | Testcontainers, `skipIf(!process.env.DBGRAPH_INTEGRATION)`; reuses Phase-3 harness; never touches the validation database |

## Migration / Rollout

Local-index auto-migrate v1→v2 (Decision 1) — additive `CREATE TABLE` on first store open; no user action. Code
layer fully additive. Rollback: delete `src/cli/`, revert `package.json` `bin`+`build`/`tsup.config.ts`, remove the
two errors, drop `snapshot_objects`, restore `CURRENT_SCHEMA_VERSION = 1` (existing v1 indexes still open; rebuild
via `sync --full`). No target-DB migration — target stays strictly read-only.

## Apply Batch Ordering (largest phase — sliced)

1. **A — errors + config**: `ConfigError`/`UnsupportedDialectError` + barrels; `config/*` (schema, parse, resolve,
   build, write) with all config units RED→green.
2. **B — parser + dispatch + cli skeleton**: `parse/args.ts`, `dispatch.ts`, `cli.ts` exit-code map (units).
3. **C — sync + status**: `createXxxSchemaAdapter` wiring, `sync/incremental.ts` against the fake store, `status`;
   formatters for status.
4. **D — query + explore**: `query`/`explore` handlers + the shared pure `explore` formatter (+ `capabilitiesFor`
   barrel export) + query formatter goldens.
5. **E — storage delta + diff**: schema/migrations v2, `putSnapshot` manifest write, `diff/engine.ts` + formatter,
   diff units + cross-sync integration.
6. **F — wiring/build/boundary/E2E**: `bin` + `tsup.config.ts`, `test/cli/boundaries.test.ts`, SQLite E2E, gated
   MSSQL E2E, gitignore check.

## Open Questions

- [ ] If a future ADR forbids `mcp → cli` imports, move `src/cli/format/explore.ts` to a neutral `src/format/`
      (zero code change). Confirm acceptable for Phase-5, or pre-empt by placing it in `src/format/` now.
- [ ] `readline` password masking on Windows terminals: confirm the muting-writer idiom hides echo in the
      target shells during apply (fallback: print a one-time "input hidden" notice, never echo).
- [ ] US-001's literal `.dbgraph/config.json` wording must be reworded to `dbgraph.config.json` at root (spec edit,
      flagged in the proposal; not a design blocker).
