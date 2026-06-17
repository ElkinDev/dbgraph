# Apply Progress — phase-4-cli-config (Batches A + B + C)

---

## Batch A (tasks 1.1–1.6) — COMPLETE

Core errors + barrel seams (`capabilitiesFor`) + config layer (pure, fully unit-tested).

### Tasks completed

- [x] 1.1 RED→GREEN `ConfigError` (`E_CONFIG`) and `UnsupportedDialectError` (`E_UNSUPPORTED_DIALECT`) added to `src/core/errors.ts`. Both extend `DbgraphError` with stable codes and actionable messages. `ConnectionError`/`PermissionError` unchanged.
- [x] 1.2 Both errors re-exported via `src/core/index.ts` (explicit named export in the errors block) and reachable through `src/index.ts` (via `export * from './core/index.js'`).
- [x] 1.3 `capabilitiesFor(dialect: string): CapabilityMatrix` added to `src/index.ts` (composition root). Maps `'sqlite'` → `SQLITE_CAPABILITIES`, `'mssql'` → `MSSQL_CAPABILITIES`. Unknown dialect → `UnsupportedDialectError`. CLI will consume this without importing adapters directly.
- [x] 1.4 RED→GREEN `src/cli/config/schema.ts` (`DbgraphConfig` discriminated union, `SqliteSource`, `MssqlSource`, `VALID_LEVELS`, `SUPPORTED_DIALECTS`) + `src/cli/config/parse-config.ts` (`parseConfig(raw: unknown): DbgraphConfig`). Validates shape; unknown dialect → `UnsupportedDialectError`; malformed level or missing field → `ConfigError` naming the field.
- [x] 1.5 RED→GREEN `src/cli/config/resolve-secrets.ts` (`resolveSecrets(cfg, envMap)`). Expands `${env:VAR}` from the injected env map; unset var → `ConfigError` naming the variable; non-token literals pass through unchanged; pure (no `process.env` read inside, env map injected for testability).
- [x] 1.6 RED→GREEN `src/cli/config/build-config.ts` (`buildConfig(input): DbgraphConfig`, `writeConfig(cfg): string`). `buildConfig` is the SINGLE builder for both flag form and wizard; connection-identity fields (server/database/user/domain/password) MUST be `${env:VAR}` references → `ConfigError` on literal values. `writeConfig` uses `JSON.stringify(ordered, null, 2) + '\n'` with FIXED key order for determinism (ADR-008).

### Files created (Batch A)

- `src/core/errors.ts` — modified (added `ConfigError`, `UnsupportedDialectError`)
- `src/core/index.ts` — modified (added `ConfigError`, `UnsupportedDialectError` to exports)
- `src/index.ts` — modified (added `capabilitiesFor` function + engine capability imports)
- `src/cli/config/schema.ts` — created (`DbgraphConfig`, `SqliteSource`, `MssqlSource`, constants)
- `src/cli/config/parse-config.ts` — created (`parseConfig`)
- `src/cli/config/resolve-secrets.ts` — created (`resolveSecrets`)
- `src/cli/config/build-config.ts` — created (`buildConfig`, `writeConfig`)

### Test files created/modified (Batch A)

- `test/core/errors.test.ts` — extended (added `ConfigError` + `UnsupportedDialectError` describe blocks; 40 tests total)
- `test/core/barrel.test.ts` — extended (added 4 tests for new error exports in core + root barrels)
- `test/core/capabilities-for.test.ts` — created (15 tests for `capabilitiesFor`)
- `test/cli/config/parse-config.test.ts` — created (21 tests)
- `test/cli/config/resolve-secrets.test.ts` — created (10 tests)
- `test/cli/config/build-config.test.ts` — created (18 tests)

### Gate result (Batch A)

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 42 test files, 625 tests, 0 failures

---

## Batch B (tasks 2.1–2.4) — COMPLETE

Hand-rolled argument parser, dispatch table, exit-code mapper, and `cli.ts` skeleton.

### Tasks completed

- [x] 2.1 RED→GREEN `src/cli/parse/args.ts` (`parseArgv(argv): ParsedArgs`). Pure tokenizer: supports `--flag value`, `--flag=value` (first `=` as separator, embedded `=` in value preserved), boolean long flags (`--json`, `--full`, `--last` — do NOT consume next token), `-i` short boolean. Unknown commands pass through unchanged (dispatch decides). ZERO new deps.
- [x] 2.2 RED→GREEN `src/cli/dispatch.ts` (`dispatch(command): DispatchResult`). Pure command→handler table for six commands (`init`, `sync`, `status`, `query`, `explore`, `diff`). Unknown commands return `{ type: 'unknown', command }` — no raw Error thrown. Handlers are stubs (later batches fill in); all handlers throw/return, never `process.exit`. Exported: `CommandHandler`, `HandlerOutcome`, `DispatchResult` types.
- [x] 2.3 RED→GREEN `src/cli/exit-code.ts` (`exitCodeFor(input: ExitCodeInput): 0|1|2|3|4`). Pure mapper per Design Decision 9: 0 success; 1 negative (zero-hits/diff-has-changes); 2 `ConnectionError`+unknown-command+`ConfigError`+other `DbgraphError`; 3 `PermissionError`; 4 `UnsupportedDialectError`. Input union covers `HandlerOutcome | UnknownCommandInput | DbgraphError`. Exported: `ExitCodeInput`, `UnknownCommandInput` types.
- [x] 2.4 `src/cli/cli.ts` created — shebang `#!/usr/bin/env node`; exports `USAGE_TEXT` (used by test + help output) and `runCli(argv): Promise<number>`. Wires `parseArgv → dispatch → handler → exitCodeFor → return code`. Handlers throw `DbgraphError` → caught here → `exitCodeFor` → code. Unknown command → stderr usage + code 2. `process.exit` call is in the ESM direct-run guard only. `npx tsc --noEmit` CLEAN.

### Files created (Batch B)

- `src/cli/parse/args.ts` — created (`parseArgv`, `ParsedArgs`)
- `src/cli/dispatch.ts` — created (`dispatch`, `CommandHandler`, `HandlerOutcome`, `DispatchResult`)
- `src/cli/exit-code.ts` — created (`exitCodeFor`, `ExitCodeInput`, `UnknownCommandInput`)
- `src/cli/cli.ts` — created (shebang entry, `USAGE_TEXT`, `runCli`)

### Test files created (Batch B)

- `test/cli/parse/args.test.ts` — created (29 tests: subcommand extraction, `--flag value`, `--flag=value`, boolean flags, `-i`, positionals, mixed)
- `test/cli/dispatch.test.ts` — created (14 tests: known commands → handler, unknown → flagged not thrown, DispatchResult shape)
- `test/cli/exit-code.test.ts` — created (15 tests: success→0, negative→1, ConnectionError→2, unknown→2, PermissionError→3, UnsupportedDialectError→4, ConfigError/other DbgraphError→2)
- `test/cli/cli.test.ts` — created (7 tests: USAGE_TEXT non-empty + contains all six command names)

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `test/cli/parse/args.test.ts` | Unit | N/A (new) | Written (module not found) | 29/29 pass | 8 describe blocks covering all flag forms + booleans + positionals + edge cases | Clean — extracted constants, consistent naming |
| 2.2 | `test/cli/dispatch.test.ts` | Unit | N/A (new) | Written (module not found) | 14/14 pass | 3 describe blocks: known/unknown/shape | Clean — dispatch table is minimal pure lookup |
| 2.3 | `test/cli/exit-code.test.ts` | Unit | N/A (new) | Written (module not found) | 15/15 pass | Every exit code variant covered (success/negative/ConnectionError/UnknownCommand/PermissionError/UnsupportedDialectError/ConfigError/SchemaVersionError/StorageError/custom DbgraphError) | Clean — single switch + instanceof chain |
| 2.4 | `test/cli/cli.test.ts` | Unit | N/A (new) | Written (module not found) | 7/7 pass | USAGE_TEXT content asserted per command; full E2E gated to Batch G | Clean — ESM entry guard |

### Gate result (Batch B)

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 46 test files, 690 tests, 0 failures (65 new tests added in Batch B)

---

## Batch C (tasks 3.1–3.3) — COMPLETE

`init` command + `node:readline` wizard + `.gitignore` writer + byte-identity golden.

### Tasks completed

- [x] 3.1 RED→GREEN `src/cli/init/wizard.ts`. `node:readline` wizard driven by `CapabilityMatrix.supported` (via `capabilitiesFor` from barrel — ADR-004 boundary preserved). Offers ONLY kinds in the dialect matrix. Connection-identity fields must be `${env:VAR}` references; literal values trigger a re-prompt with guidance message. Secret prompts: readline created with `terminal:false` (no echo). Async iterator pattern used (`rl[Symbol.asyncIterator]()`) — NOT `rl.question()` — to work correctly with injected `Readable.from()` test streams (see L-010 in `docs/learnings.md`). `SQLITE_CAPABILITIES`/`MSSQL_CAPABILITIES` re-exported from `src/index.ts` (barrel) so CLI/tests can consume them without importing adapters. Done: 17 unit tests pass.
- [x] 3.2 RED→GREEN `src/cli/commands/init.ts`. Both paths (flag form and `-i`) feed through ONE `buildConfig` → `writeConfig` pipeline (byte-identity). Writes `dbgraph.config.json` at `projectRoot`. Appends `.dbgraph/` to `.gitignore` (idempotent — checks for exact-line match before appending; creates file if absent). Batch D sync seam exported as `syncAfterInit()` — no-op stub for now. `dispatch.ts` updated to wire the real `handleInit` (reads flags for dialect/file/server etc., falls back to interactive if no dialect supplied). Done: 13 unit tests pass.
- [x] 3.3 RED→GREEN byte-identity golden. Both paths (flag form + wizard) call `buildConfig` → `writeConfig` with the same structured input → IDENTICAL string output (ADR-008). Test in `init.test.ts` writes via wizard, reads the file back, and asserts equality with a direct `writeConfig(buildConfig(...))` call. Done: 2 dedicated byte-identity tests pass.

### Files created/modified (Batch C)

- `src/index.ts` — modified (re-exported `SQLITE_CAPABILITIES`, `MSSQL_CAPABILITIES` constants for CLI/tests without adapter imports)
- `src/cli/init/wizard.ts` — created (`runWizard`, `WizardResult`, `WizardOptions`, `Level` types; `LineReader` class with async iterator + muting pattern)
- `src/cli/commands/init.ts` — created (`runInit`, `InitOptions`, `syncAfterInit` seam, `ensureGitignored`, `wizardResultToBuildInput`)
- `src/cli/dispatch.ts` — modified (wired real `handleInit` replacing stub; imports `runInit` from `./commands/init.js`)
- `docs/learnings.md` — appended L-010 (readline async iterator vs question() for testability)

### Test files created (Batch C)

- `test/cli/init/wizard.test.ts` — created (17 tests: capability-driven offering, SQLite no-procedure, MSSQL includes procedure, literal-credential re-prompt, masking, WizardResult shape)
- `test/cli/commands/init.test.ts` — created (13 tests: flag-form writes config, appends .gitignore, idempotent, preserves existing gitignore, success outcome, MSSQL env refs, literal password rejected, interactive form writes config + gitignore, byte-identity x2)

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `test/cli/init/wizard.test.ts` | Unit | N/A (new) | Written (module not found) | 17/17 pass | Capability-driven (SQLite vs MSSQL matrices), literal→re-prompt, masking, WizardResult shape across dialects | Removed no-op `void` suppressor; async iterator AsyncIterator<string> type fix |
| 3.2 | `test/cli/commands/init.test.ts` | Unit | N/A (new) | Written (module not found) | 13/13 pass | Flag form (sqlite+mssql), idempotent .gitignore, literal rejection, interactive form, Batch D seam | Removed unused NodeKind import + void suppressor |
| 3.3 | `test/cli/commands/init.test.ts` | Unit | N/A (new) | Written (module not found) | 2/2 pass (within init test file) | wizard→file vs direct writeConfig assertion; golden for determinism | None needed — trivially clean |

### Learnings (Batch C)

**Windows readline masking (L-010):** `readline.question()` fails with `Readable.from()` test streams because `Readable.from` emits all lines in a synchronous burst before any `question()` callback can be queued. Readline closes and throws "readline was closed". Fix: use `rl[Symbol.asyncIterator]()` (lazy consumption, one line per iteration step). Also `output: null` causes immediate close — pass a real writable and use `terminal: false` to prevent echo. Documented in `docs/learnings.md` as L-010.

### Gate result (Batch C)

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 48 test files, 720 tests, 0 failures (30 new tests added in Batch C)

---

---

## Batch D (tasks 4.1–4.3) — COMPLETE

`sync` incremental selector (pure, fake store) + `sync` command + `syncAfterInit` seam + `status` formatter + `status` command. `dispatch.ts` wired with real `handleSync`/`handleStatus`.

### Tasks completed

- [x] 4.1 RED→GREEN `src/cli/sync/incremental.ts`: pure `computeDelta(existing, fresh): DeltaResult`. Compares nodes by id and `bodyHash`: absent in fresh → `toDelete`, new or `bodyHash` mismatch → `toUpsert`, identical → no-op. Handles null bodyHash correctly (null=null is unchanged; hash→null is changed). 11 unit tests pass.
- [x] 4.2 RED→GREEN `src/cli/commands/sync.ts` (`SyncOptions`, `runSync`). Fingerprint short-circuit: if `liveFingerprint === lastSnapshot.fingerprint && !full` → skips extraction entirely (no-op). Otherwise: `adapter.extract` → `normalizeCatalog` → `computeDelta` (all node kinds via `NODE_KINDS`) → `deleteNodes` + `upsertGraph` for changed/new → `putSnapshot` with `randomUUID` id + ISO timestamp + per-kind counts. `--full` skips fingerprint check. Filled `syncAfterInit` seam in `init.ts`: reads `dbgraph.config.json` → `parseConfig` → `resolveSecrets` → creates adapter + store → calls `runSync`. Added `_syncFn` injection to `InitOptions` for test isolation (Batch C tests updated). Wired real `handleSync`/`handleStatus` in `dispatch.ts` (shared `openAdapterAndStore` helper). 6 unit tests pass.
- [x] 4.3 RED→GREEN `src/cli/format/status.ts` (PURE `formatStatus(view: StatusView): string`) + `src/cli/commands/status.ts` (`runStatus` → `StatusOutcome`). Formatter: Graph section (per-kind counts sorted, excluded count when > 0), Last Snapshot section (takenAt/engine/fingerprint/snapshot counts), DRIFT section (uppercase label + "Run: dbgraph sync") — deterministic (sorted keys, no Date.now). Status command gathers all nodes via `NODE_KINDS`, builds kindCounts + excludedCount, gets last snapshot, computes hasDrift from live vs stored fingerprint. 11 formatter tests + 8 command tests pass.

### Files created (Batch D)

- `src/cli/sync/incremental.ts` — created (`computeDelta`, `DeltaResult`)
- `src/cli/commands/sync.ts` — created (`runSync`, `SyncOptions`)
- `src/cli/commands/status.ts` — created (`runStatus`, `StatusOptions`, `StatusOutcome`)
- `src/cli/format/status.ts` — created (`formatStatus`, `StatusView`)
- `src/cli/commands/init.ts` — modified (filled `syncAfterInit` seam; added `_syncFn` injection to `InitOptions` for test isolation)
- `src/cli/dispatch.ts` — modified (wired real `handleSync`/`handleStatus`; added `openAdapterAndStore` shared helper)

### Test files created/modified (Batch D)

- `test/cli/sync/incremental.test.ts` — created (11 tests: no-change, new nodes, removed nodes, changed bodyHash, mixed, null bodyHash cases)
- `test/cli/commands/sync.test.ts` — created (6 tests: fingerprint short-circuit, first sync, --full override, delta application, snapshot counts, success outcome)
- `test/cli/format/status.test.ts` — created (11 tests: kind counts, last snapshot, no snapshot, excluded count, DRIFT indicator, determinism, golden)
- `test/cli/commands/status.test.ts` — created (8 tests: table/view counts, snapshot timestamp, never synced, drift detected, no drift, no snapshots no drift, return type)
- `test/cli/commands/init.test.ts` — modified (added `_syncFn: noSync` to all `runInit` calls to isolate init tests from the now-real sync seam)

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `test/cli/sync/incremental.test.ts` | Unit | N/A (new) | Written (module not found) | 11/11 pass | 6 describe blocks: no-change, new, removed, changed, mixed (all 3 at once), null bodyHash | Clean — two-pass O(n) algorithm; no map iteration issues |
| 4.2 | `test/cli/commands/sync.test.ts` | Unit | N/A (new) | Written (module not found) | 6/6 pass | Fingerprint equal/different/absent, --full, snapshot recorded, success outcome; fake adapter RawCatalog fixed for exactOptionalPropertyTypes | Added _syncFn injection to InitOptions to isolate Batch C tests from real sync |
| 4.3 (fmt) | `test/cli/format/status.test.ts` | Unit | N/A (new) | Written (module not found) | 11/11 pass | Counts/snapshot/no-snapshot/excluded/DRIFT/no-DRIFT/determinism/golden | Clean — sorted keys, deterministic sections |
| 4.3 (cmd) | `test/cli/commands/status.test.ts` | Unit | N/A (new) | Written (module not found) | 8/8 pass | table/view counts, snapshot info, never-synced, drift yes/no, no-snapshots-no-drift, return type | Fixed makeNode default kind bug (test fix) |

### Learnings (Batch D)

**`_syncFn` injection for `syncAfterInit` seam (L-011):** When Batch D filled the `syncAfterInit` seam with a real sync, all Batch C init tests failed (ConnectionError: fixture.db doesn't exist in temp dirs). Fix: added `_syncFn?: (root: string) => Promise<void>` to `InitOptions` so tests can inject a no-op, keeping init tests isolated from the sync path. Pattern: injectable sync hook on the options object is cleaner than module-level mocking with vi.mock.

**`exactOptionalPropertyTypes` in fake adapters (L-012):** With `exactOptionalPropertyTypes: true`, you cannot pass `body: undefined` as an optional field — TypeScript treats it as assigning `undefined` to a required-absent key. Fix: use a conditional spread `n.bodyHash !== null ? { body: n.bodyHash } : {}` or a type guard to only include the key when it has a value.

### Gate result (Batch D)

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 52 test files, 756 tests, 0 failures (36 new tests added in Batch D)

---

---

## Batch E (tasks 5.1–5.3) — COMPLETE

Shared `src/core/present/explore.ts` formatter (pure, core-types-only, boundary-clean) + `explore` command + `query` formatter + `query` command + `dispatch.ts` wired with real handlers.

### Tasks completed

- [x] 5.1 RED→GREEN `src/core/present/explore.ts`. Pure `formatExplore(view: ExploreView, detail: ExploreDetail): string`. ExploreView = `{ node: GraphNode; neighbors: NeighborGroups }`. Levels: `brief` (qname/kind/neighbor-kind counts), `normal` (+ grouped neighbors by edge kind/direction/qname-sorted), `full` (+ bodyHash + level + hasDynamicSql warning). Re-exported via `src/core/index.ts` (new "present/" section before errors). Reachable via `src/index.ts` through `export * from './core/index.js'`. `test/core/boundaries.test.ts` still green — `src/core/present/explore.ts` imports ONLY `../model/node.js` and `../ports/graph-store.js` (core-internal). 20 unit tests pass.
- [x] 5.2 RED→GREEN `src/cli/commands/explore.ts`. `runExplore(options: ExploreOptions): Promise<ExploreOutcome>`. Resolves qname by iterating NODE_KINDS via `store.getNodeByQName`; throws `NotFoundError` when not found. Calls `getNeighbors(store, { nodeId })` (public barrel, ADR-004 boundary preserved). Assembles `ExploreView` → `formatExplore(view, detail)`. Returns `{ type: 'success', output }`. `dispatch.ts` wired with real `handleExplore` (reads `args.positionals[0]` as qname, `args.flags['detail']` defaulting to `'normal'`). 9 unit tests pass.
- [x] 5.3 RED→GREEN `src/cli/format/query.ts` (`formatQueryText` + `formatQueryJson`) + `src/cli/commands/query.ts` (`runQuery`). Text formatter: one line per hit `kind.padEnd(14) qname`. JSON formatter: stable `{ term, total, hits: [{kind, qname, id, score}] }` (ADR-008 fixed key order). `runQuery` calls `search(store, {term})`, formats, returns `{ type: 'success'|'negative', output }`. Zero hits → `type: 'negative'` (maps to exit 1 via `exitCodeFor`, US-020). `dispatch.ts` wired with real `handleQuery` (reads `args.positionals[0]` as term, `args.flags['json']` as boolean). 22 unit tests pass (12 formatter + 10 command).

### Files created (Batch E)

- `src/core/present/explore.ts` — created (`formatExplore`, `ExploreView`, `ExploreDetail`)
- `src/core/index.ts` — modified (added present/ section exporting `formatExplore`, `ExploreDetail`, `ExploreView`)
- `src/cli/commands/explore.ts` — created (`runExplore`, `ExploreOptions`, `ExploreOutcome`)
- `src/cli/commands/query.ts` — created (`runQuery`, `QueryOptions`, `QueryOutcome`)
- `src/cli/format/query.ts` — created (`formatQueryText`, `formatQueryJson`, `QueryResultView`)
- `src/cli/dispatch.ts` — modified (wired real `handleQuery`/`handleExplore` replacing stubs; added imports for `runQuery`, `runExplore`)

### Test files created/modified (Batch E)

- `test/core/present/explore-format.test.ts` — created (20 tests: brief/normal/full levels, determinism x3, purity, goldens)
- `test/core/barrel.test.ts` — modified (added 1 test for `formatExplore` export from `src/core/index.ts`)
- `test/cli/commands/explore.test.ts` — created (9 tests: qname resolution, kind in output, neighbor qnames, detail levels, not-found, determinism, return type)
- `test/cli/commands/query.test.ts` — created (10 tests: success outcome, text output, zero-hit negative, JSON mode, JSON determinism, return type)
- `test/cli/format/query.test.ts` — created (12 tests: text kind+qname, multiple hits, procedure kind, empty, newline, JSON parseable, JSON structure, JSON determinism, goldens)

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | `test/core/present/explore-format.test.ts` | Unit | N/A (new) | Written (module not found) | 20/20 pass | 3 describe blocks: brief/normal/full; determinism x3 levels; empty neighbors; purity | Fixed `ExploreOutcome extends HandlerOutcome` TS error (union type cannot be extended directly — removed extends, inlined the shape) |
| 5.2 | `test/cli/commands/explore.test.ts` | Unit | N/A (new) | Written (module not found) | 9/9 pass | qname resolution, brief/normal/full each tested, not-found throw, determinism | Fixed `NotFoundError(kind, id)` signature (takes two args, not one) |
| 5.3 (fmt) | `test/cli/format/query.test.ts` | Unit | N/A (new) | Written (module not found) | 12/12 pass | `formatQueryText` (text, multi-hit, procedure, empty, newline); `formatQueryJson` (parseable, kind+qname, total, determinism, newline); golden x2 | Clean — fixed key order via object literal shape |
| 5.3 (cmd) | `test/cli/commands/query.test.ts` | Unit | N/A (new) | Written (module not found) | 10/10 pass | success/text, multi-hit, zero→negative, JSON mode, zero in JSON mode, JSON determinism, return type | Matches handleSync/handleStatus adapter.close() pattern in dispatch |

### Learnings (Batch E)

**`NotFoundError` takes two arguments (L-013):** `NotFoundError(kind: string, identifier: string)` — not a single message string. Discovered during RED→GREEN cycle for `explore.ts`. Pattern consistent with `StorageError(message, cause?)`.

**`ExploreOutcome extends HandlerOutcome` rejected by TS:** `HandlerOutcome` is a union type (`{type:'success'}|{type:'negative'}`). TypeScript disallows `interface X extends UnionType`. Fix: declare `ExploreOutcome` as a standalone interface with `type: 'success'` — does not extend the union.

### Gate result (Batch E)

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 56 test files, 808 tests, 0 failures (52 new tests added in Batch E)
`test/core/boundaries.test.ts`: 7/7 pass — `src/core/present/explore.ts` imports only core model/port types (PURE, boundary-clean)

---

---

## Batch F (tasks 6.1–6.5) — COMPLETE

Storage schema v1→v2 (`snapshot_objects` table + auto-migration), `putSnapshot` manifest write inside same transaction, `getSnapshotObjects` port method, pure diff engine, PURE golden-pinned `diff` formatter, `diff` command with `--last` and pre-v2 degradation, `dispatch.ts` wired with real `handleDiff`.

### Tasks completed

- [x] 6.1 RED→GREEN `SNAPSHOT_OBJECTS_DDL` added to `src/adapters/storage/sqlite/schema.ts`. Single export constant containing two SQL statements (table DDL + index). `CREATE TABLE IF NOT EXISTS snapshot_objects(snapshot_id, node_id, kind, qname, body_hash)` + `CREATE INDEX IF NOT EXISTS idx_snapshot_objects_snapshot ON snapshot_objects(snapshot_id)`. Tests: 4 unit tests covering export, columns, index name, IF NOT EXISTS.
- [x] 6.2 RED→GREEN `CURRENT_SCHEMA_VERSION` bumped 1→2. Appended `{ version: 2, up }` migration to `MIGRATIONS` array in `migrations.ts`. v2 `up` runs `SNAPSHOT_OBJECTS_DDL` split by `;\n`. Tests: 5 new tests — fresh DB at v2, v1→v2 auto-migrate with node preservation (file-based temp DB), v2 no-op idempotent open, `snapshot_objects` table exists post-migration. Existing v1 tests updated to expect version=2.
- [x] 6.3 RED→GREEN `putSnapshot` in `sqlite-graph-store.ts` now wraps snapshot INSERT + `INSERT INTO snapshot_objects ... SELECT ... FROM nodes WHERE missing=0 AND excluded=0 ORDER BY qname,id` in a single `db.transaction()`. Added `getSnapshotObjects(snapshotId): Promise<readonly SnapshotObjectRow[]>` to the port interface (`src/core/ports/graph-store.ts`) and SQLite implementation. `SnapshotObjectRow` added to the port + exported via `src/core/index.ts`. All existing fake `GraphStore` doubles in tests updated with `getSnapshotObjects: async () => []`. Tests: 5 new unit tests on manifest round-trip; existing 31 store tests still green.
- [x] 6.4 RED→GREEN `src/cli/diff/engine.ts` — pure `diffManifests(a, b): DiffResult`. Comparison by `nodeId`. Added/removed/changed with `oldBodyHash`/`newBodyHash` for changed rows. Types: `DiffAddedRow`, `DiffRemovedRow`, `DiffChangedRow`, `DiffResult`. Tests: 14 unit tests — basic added/removed/changed, all-three-at-once, grouping by kind, null hash edge cases, empty manifests, identity comparison by nodeId not qname, purity/determinism, no-mutation.
- [x] 6.5 RED→GREEN `src/cli/format/diff.ts` — PURE formatter `formatDiff(result: DiffResult): string`. Sections: ADDED / REMOVED / MODIFIED (sorted by kind then qname). For MODIFIED: `definition changed (hash: X... -> Y...)`. `formatDiffNoManifest(snapA, snapB)` for pre-v2 degradation. `src/cli/commands/diff.ts` — `runDiff(options: DiffOptions): Promise<DiffOutcome>`. Supports explicit `snapA`/`snapB` IDs and `last: true` (two most-recent from `listSnapshots`). Pre-v2 degradation: either manifest empty -> `formatDiffNoManifest`. `dispatch.ts` wired with real `handleDiff` (reads `--last` flag or positionals[0]/[1] as snap IDs). Exit: 'success' (exit 0) when no changes; 'negative' (exit 1) when changes or degradation. Tests: 14 formatter tests + 8 command tests.

### Files created (Batch F)

- `src/adapters/storage/sqlite/schema.ts` — modified (added `SNAPSHOT_OBJECTS_DDL` constant)
- `src/adapters/storage/sqlite/migrations.ts` — modified (`CURRENT_SCHEMA_VERSION` 1->2, appended v2 migration)
- `src/adapters/storage/sqlite/sqlite-graph-store.ts` — modified (`putSnapshot` fills manifest in same transaction; added `getSnapshotObjects`; new prepared statements)
- `src/core/ports/graph-store.ts` — modified (added `SnapshotObjectRow` type; added `getSnapshotObjects` to `GraphStore` interface)
- `src/core/index.ts` — modified (exported `SnapshotObjectRow` from ports section)
- `src/cli/diff/engine.ts` — created (`diffManifests`, `DiffResult`, `DiffAddedRow`, `DiffRemovedRow`, `DiffChangedRow`)
- `src/cli/format/diff.ts` — created (`formatDiff`, `formatDiffNoManifest`)
- `src/cli/commands/diff.ts` — created (`runDiff`, `DiffOptions`, `DiffOutcome`)
- `src/cli/dispatch.ts` — modified (wired real `handleDiff` replacing stub; added `runDiff` import)

### Test files created/modified (Batch F)

- `test/adapters/storage/sqlite/schema.test.ts` — modified (existing v1 tests updated to v2; 9 new tests for 6.1 DDL + 5 new tests for 6.2 migration)
- `test/adapters/storage/sqlite/sqlite-graph-store.test.ts` — modified (5 new tests for 6.3 manifest; removed unused @ts-expect-error directives)
- `test/cli/diff/engine.test.ts` — created (14 tests)
- `test/cli/format/diff.test.ts` — created (14 tests)
- `test/cli/commands/diff.test.ts` — created (8 tests)
- `test/cli/commands/explore.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/cli/commands/query.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/cli/commands/status.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/cli/commands/sync.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/core/query/impact.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/core/query/neighbors.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/core/query/path.test.ts` — modified (added `getSnapshotObjects` to fake store)
- `test/core/query/search.test.ts` — modified (added `getSnapshotObjects` to fake store)

### Learnings (Batch F)

**`@ts-expect-error` becomes an error once the type is added (L-014):** When `getSnapshotObjects` was written with `@ts-expect-error`, adding it to the port made those directives into TypeScript errors. Fix: remove `@ts-expect-error` after the port is official.

**Fake store doubles break on new port methods (L-015):** Adding a method to `GraphStore` requires updating every fake double. Quick scan: `grep -rn "async listSnapshots" test/` finds all doubles. Always add a no-op at the same time as the port change.

**`readonly T[]` cannot be cast directly to `T[]` (L-016):** `readonly SnapshotObjectRow[]` cannot be `as Array<{...}>` — TypeScript rejects due to mutability mismatch. Fix: double-cast via `as unknown as Array<{...}>`.

### Gate result (Batch F)

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 59 test files, 858 tests, 0 failures (50 new tests added in Batch F)
`test/core/boundaries.test.ts`: 7/7 pass — boundary-clean

---

## Next batch

Batch G (tasks 7.1–7.6): tsup build wiring, CLI boundaries test, E2E (SQLite + gated MSSQL), final sweep.
