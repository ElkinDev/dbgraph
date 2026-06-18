# Apply Progress: connectivity-strategies — Batches A + B + C + D + E

**Change**: connectivity-strategies
**Mode**: Strict TDD (RED → GREEN per task)
**Batches**: A (A1.1–A1.7) + B (B2.1–B2.6) + C (C3.1–C3.6) + D (D4.1–D4.4) + E (E5.1–E5.4)
**Status**: Batches A, B, C, D, and E complete

## Completed Tasks

- [x] A1.1 `test/core/connectivity-strategy.test.ts` + `src/core/ports/connectivity-strategy.ts` — port declared, shape tested
- [x] A1.2 Re-exported via `src/core/ports/index.ts` + `src/core/index.ts`
- [x] A1.3 `StrategyExhaustionError` added to `src/core/errors.ts`; test extended; barrel updated
- [x] A1.4 `{ type: 'integrated' }` added additively to `MssqlAdapterConfig.authentication` in `src/core/ports/schema-adapter.ts`; factory narrowing fixed
- [x] A1.5 `MssqlSource.auth` optional discriminant + `parseMssqlSource` integrated arm; `parse-config.test.ts` extended
- [x] A1.6 `resolveMssqlSource` integrated arm (skip absent credentials); `resolve-secrets.test.ts` extended
- [x] A1.7 Lint+type gate: `npm run lint` 0 errors/0 warnings; `npx tsc --noEmit` clean; `npm test` 1297/1297 pass
- [x] B2.1 `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` (`NativeTediousStrategy`): wraps factory lazy import + pool/connect + mapMssqlError; detect()→available when not integrated; canConnect()→pool probe; runCatalog()→MssqlSchemaAdapter.extract UNCHANGED; close() idempotent
- [x] B2.2 RED→GREEN `test/adapters/engines/mssql/strategies/json-rows.test.ts` + `strategies/json-rows.ts`: 37 tests; all 8 BIT fields + numeric-string id/ordinal coercion + absent-nullable-text→null + malformed/missing→throw
- [x] B2.3 RED→GREEN `SqlcmdStrategy.detect()` in `sqlcmd.strategy.ts`: where/which exit 0 → available; non-zero → fallback -? probe; timeout/error → available:false; never throws; never opens DB
- [x] B2.4 RED→GREEN `SqlcmdStrategy.canConnect()`: -E -S -d -Q "SELECT 1" -h -1; argv array shell:false; exit 0 → true; non-zero/timeout → false
- [x] B2.5 RED→GREEN `SqlcmdStrategy.runCatalog()`: FOR JSON PATH wrapping; multi-line stdout reassembly (concat-then-parse); footer stripping; json-rows validation; buildMssqlRawCatalog UNCHANGED; multi-line golden test pinned
- [x] B2.6 Batch B lint+type gate: `npm run lint` 0 errors/0 warnings; `npx tsc --noEmit` clean; `npm test` 1355/1355 pass (89 files)
- [x] C3.1 RED→GREEN `test/adapters/engines/mssql/strategies/registry.test.ts` + `strategies/registry.ts`: `buildMssqlStrategies` (native+sqlcmd ordered, integrated omits native); `MssqlStrategyDeps` constructor injection seam; 7 assertions pass
- [x] C3.2 RED→GREEN `registry.ts` `selectStrategy(strategies, logger)`: detect+canConnect iteration; debug per-probe, info for winner; none pass → `StrategyExhaustionError`; 12 assertions pass (19 total for registry)
- [x] C3.3 RED→GREEN: rewrote `factory.ts` — `createMssqlSchemaAdapter(config, deps?)` → `buildMssqlStrategies` + `selectStrategy` → `StrategyBackedSchemaAdapter`; added `fingerprint?()` optional method to `ConnectivityStrategy` port + implemented in `NativeTediousStrategy` and `SqlcmdStrategy`
- [x] C3.4 GREEN: adjusted `factory.test.ts` (login-failed/kerberos now expect `StrategyExhaustionError`; SqlcmdUnavailable stub injected via deps.Sqlcmd) + `factory-missing-driver.test.ts` (missing-mssql `ConnectionError` preserved via re-throw in `NativeTediousStrategy.canConnect()`); 12 assertions pass
- [x] C3.5 `open-connections.ts` integrated arm already in place from A1.6; factory signature backward-compatible (optional deps); sql/ntlm/integrated branches all wired
- [x] C3.6 Batch C gate: `npm run lint` 0 errors/0 warnings; `npx tsc --noEmit` clean; `npm test` 1374/1374 pass (90 files)
- [x] D4.1 RED→GREEN `test/.../dump-emitter.test.ts` + `strategies/dump-emitter.ts`: `emitDumpScript()` composes 11-family deterministic .sql from queries.ts constants; each wrapped `FOR JSON PATH, INCLUDE_NULL_VALUES`; each labeled with MssqlRowInput key; header comment with sqlcmd -E instructions; NO write verb; exports `DUMP_DIR`, `DUMP_FILE`, `CATALOG_FAMILY_KEYS`; 10/10 assertions pass
- [x] D4.2 RED→GREEN `test/.../manual-dump.test.ts` + `strategies/manual-dump.strategy.ts`: `ManualDumpStrategy` (id:'manual-dump'); `detect()` uses `existsSync` — available if file present; `canConnect()` = file present + valid JSON; `runCatalog()` reads combined JSON → `parseJsonRows` → `buildMssqlRawCatalog` UNCHANGED; `close()` no-op; golden fixture `test/fixtures/mssql/dumps/mssql-dump-golden.json` (anonymized/synthetic: app.accounts + app.sessions schema); BIT 0/1 coercion validated; byte-identical on re-run (ADR-008); 19/19 assertions pass
- [x] D4.3 Registry append: `registry.ts` imports + instantiates `ManualDumpStrategy` AFTER sqlcmd; `MssqlStrategyDeps.ManualDump` injection seam added; `deps.ManualDump` override tested; order: native → sqlcmd → manual-dump; `.gitignore` explicit `.dbgraph/dumps/` entry added (covered by `.dbgraph/` glob)
- [x] D4.4 Batch D gate: `npm run lint` 0 errors/0 warnings; `npx tsc --noEmit` clean; `npm test` 1407/1407 pass (92 files); write-verb scan: PASS; boundary: PASS; leak-scanner: PASS
- [x] E5.1 RED→GREEN `test/adapters/engines/mssql/strategies/install-recipes.test.ts` + `strategies/install-recipes.ts`: `getRecipes(tool, os) → InstallRecipe[]`; sqlcmd → win32 winget `Microsoft.Sqlcmd`, darwin brew, linux url; all official microsoft.com URLs; 9 assertions pass
- [x] E5.2 RED→GREEN `test/.../consented-install.test.ts` + `strategies/consented-install.strategy.ts`: `ConsentedInstallStrategy` (id:'consented-install'); `detect()` always available; `canConnect()` always false; `runCatalog()` prints consent notice + official instructions via `Logger.info` then throws `StrategyExhaustionError`; B2 seam comment present; no spawn; 14 assertions pass
- [x] E5.3 RED→GREEN `test/cli/format/exhaustion.test.ts` + `src/cli/format/exhaustion.ts`: `formatExhaustionError(err)` → multi-line string with (a) manual-dump path + script location + `mssql-dump.json`, (b) guided install + microsoft.com URL, B2 deferred notice; attempt list; 10 assertions pass
- [x] E5.4 Batch E gate: `npm run lint` 0 errors/0 warnings; `npx tsc --noEmit` clean; `npm test` 1444/1444 pass (95 files); write-verb scan: PASS; boundary: PASS; leak-scanner: PASS

## TDD Cycle Evidence

| Task | RED (test written first) | GREEN (impl passes) | Notes |
|------|--------------------------|---------------------|-------|
| A1.1 | `test/core/connectivity-strategy.test.ts` (10 assertions) | `src/core/ports/connectivity-strategy.ts` created | Import-only test — shape only |
| A1.2 | tsc gate (compilation = test) | barrels updated | No separate test file needed |
| A1.3 | `test/core/errors.test.ts` extended (11 new assertions) | `StrategyExhaustionError` + barrel | Message format `{id} — {reason}` pinned |
| A1.4 | tsc gate + existing factory compile | `schema-adapter.ts` + `factory.ts` narrowing fix | Additive union member |
| A1.5 | `test/cli/config/parse-config.test.ts` extended (12 new assertions) | `schema.ts` + `parse-config.ts` integrated arm | Default inference preserved |
| A1.6 | `test/cli/config/resolve-secrets.test.ts` extended (7 new assertions) | `resolve-secrets.ts` integrated arm + open-connections.ts | `missingCredential()` helper avoids dynamic require |
| A1.7 | Gate | `npm run lint` 0w; `npx tsc --noEmit` clean; 1297 tests pass | |
| B2.1 | tsc gate + existing tests (behavior preserved, no new test needed per task spec) | `native-tedious.strategy.ts` created | Pool/connect logic moved verbatim from factory |
| B2.2 | `test/adapters/engines/mssql/strategies/json-rows.test.ts` (37 assertions — RED first) | `strategies/json-rows.ts` created | 8 BIT fields, 6 numeric fields, 6 nullable fields, 9 rejection cases |
| B2.3 | `test/adapters/engines/mssql/strategies/sqlcmd.test.ts` detect suite (6 assertions — RED first) | `SqlcmdStrategy.detect()` in `sqlcmd.strategy.ts` | SpawnSyncFn injected constructor seam; never opens DB |
| B2.4 | `sqlcmd.test.ts` canConnect suite (6 assertions — RED first) | `SqlcmdStrategy.canConnect()` | argv array verified; shell:false verified |
| B2.5 | `sqlcmd.test.ts` runCatalog suite (9 assertions — RED first) | `SqlcmdStrategy.runCatalog()` | Multi-line split golden at 5-char chunks; footer stripping; malformed throws |
| B2.6 | Gate | `npm run lint` 0w; `npx tsc --noEmit` clean; 1355 tests pass | preserve-caught-error + unused-import fixes |
| C3.1 | `test/.../registry.test.ts` (7 assertions — RED first) | `strategies/registry.ts` `buildMssqlStrategies` | `MssqlStrategyDeps` injection seam; integrated omits native |
| C3.2 | `registry.test.ts` selectStrategy suite (12 assertions — RED first) | `selectStrategy` in registry.ts | debug per-probe, info winner, exhaustion listing |
| C3.3 | tsc gate | `factory.ts` rewritten; `ConnectivityStrategy` port + `fingerprint?()` added; `NativeTediousStrategy` + `SqlcmdStrategy` get `fingerprint()` | `StrategyBackedSchemaAdapter` wraps winner |
| C3.4 | factory.test.ts + factory-missing-driver.test.ts adjusted (12 assertions) | Seam confirmed green | login-failed/kerberos → `StrategyExhaustionError`; missing-driver `ConnectionError` preserved via re-throw |
| C3.5 | Gate | `open-connections.ts` already wired (A1.6); no change needed | factory optional deps back-compat |
| C3.6 | Gate | `npm run lint` 0w; `npx tsc --noEmit` clean; 1374 tests pass | |
| D4.1 | `test/.../dump-emitter.test.ts` (10 assertions — RED first) | `strategies/dump-emitter.ts` created | `emitDumpScript()` golden-deterministic; 11 FOR JSON PATH wrappers; no write verb |
| D4.2 | `test/.../manual-dump.test.ts` (19 assertions — RED first) | `strategies/manual-dump.strategy.ts` created | Golden fixture `mssql-dump-golden.json`; BIT 0/1 → boolean coercion via json-rows; byte-identical on re-run |
| D4.3 | `registry.test.ts` extended (+4 D4.x assertions) | `registry.ts` updated (import + push ManualDumpStrategy) | `deps.ManualDump` seam; `.gitignore` explicit `.dbgraph/dumps/` entry |
| D4.4 | Gate | `npm run lint` 0w; `npx tsc --noEmit` clean; 1407 tests pass | write-verb + boundary + leak-scanner all green |
| E5.1 | `test/.../install-recipes.test.ts` (9 assertions — RED first) | `strategies/install-recipes.ts` created | `getRecipes(tool, os)`; sqlcmd: win32 winget, darwin brew, linux url; official sources |
| E5.2 | `test/.../consented-install.test.ts` (14 assertions — RED first) | `strategies/consented-install.strategy.ts` created | id:'consented-install'; detect always true; canConnect always false; runCatalog prints guidance via Logger.info then throws; B2 seam marked |
| E5.3 | `test/cli/format/exhaustion.test.ts` (10 assertions — RED first) | `src/cli/format/exhaustion.ts` created | `formatExhaustionError(err)`: option (a) manual-dump path, option (b) guided install, B2 deferred notice, attempt list |
| E5.4 | Gate | `npm run lint` 0w; `npx tsc --noEmit` clean; 1444 tests pass | write-verb + boundary + leak-scanner all green |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/core/ports/connectivity-strategy.ts` | Created (Batch A) | `ConnectivityStrategy`, `DetectResult`, `StrategyAttempt` — core types only, zero outward imports |
| `src/core/ports/index.ts` | Modified (Batch A) | Re-export new port types |
| `src/core/index.ts` | Modified (Batch A) | Re-export port types + `StrategyExhaustionError` |
| `src/core/errors.ts` | Modified (Batch A) | Added `StrategyExhaustionError` (`E_STRATEGY_EXHAUSTION`, `readonly attempts`) |
| `src/core/ports/schema-adapter.ts` | Modified (Batch A) | Added `{ type: 'integrated' }` union member to `MssqlAdapterConfig.authentication` |
| `src/adapters/engines/mssql/factory.ts` | Modified (Batch A) | Fixed narrowing: `if ntlm` explicit; `integrated` comment for Batch C |
| `src/infra/config/schema.ts` | Modified (Batch A) | `MssqlSource.user/password` now optional; added `auth?: 'sql'|'ntlm'|'integrated'` |
| `src/infra/config/parse-config.ts` | Modified (Batch A) | `parseMssqlSource` integrated arm + `auth` inference logic |
| `src/infra/config/resolve-secrets.ts` | Modified (Batch A) | `resolveMssqlSource` integrated arm; credential guards; `missingCredential()` helper |
| `src/infra/open-connections.ts` | Modified (Batch A) | Added `integrated` arm building `authentication: { type: 'integrated' }` |
| `test/core/connectivity-strategy.test.ts` | Created (Batch A) | Port shape tests |
| `test/core/errors.test.ts` | Modified (Batch A) | Added `StrategyExhaustionError` test suite |
| `test/cli/config/parse-config.test.ts` | Modified (Batch A) | Added `integrated` auth parse tests (A1.5) |
| `test/cli/config/resolve-secrets.test.ts` | Modified (Batch A) | Added `integrated` resolve tests (A1.6) |
| `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` | Created (Batch B) | `NativeTediousStrategy` wrapping existing factory pool/connect/error-map logic |
| `src/adapters/engines/mssql/strategies/json-rows.ts` | Created (Batch B) | `parseJsonRows(RawJsonInput) → MssqlRowInput` — BIT coercion, numeric-string coercion, null normalization, rejection |
| `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts` | Created (Batch B) | `SqlcmdStrategy` — detect/canConnect/runCatalog with injected SpawnSyncFn seam; FOR JSON reassembly |
| `test/adapters/engines/mssql/strategies/json-rows.test.ts` | Created (Batch B) | 37 assertions covering all coercion + rejection cases |
| `test/adapters/engines/mssql/strategies/sqlcmd.test.ts` | Created (Batch B) | 21 assertions: detect (6), canConnect (6), runCatalog (9) including multi-line golden |
| `openspec/changes/connectivity-strategies/tasks.md` | Modified (Batch B) | Marked B2.1–B2.6 as `[x]` |
| `src/adapters/engines/mssql/strategies/registry.ts` | Created (Batch C) | `buildMssqlStrategies` + `selectStrategy` + `MssqlStrategyDeps`; extension point comment for D/E |
| `src/adapters/engines/mssql/factory.ts` | Rewritten (Batch C) | `createMssqlSchemaAdapter` → registry selector; `StrategyBackedSchemaAdapter`; `MssqlSchemaAdapterDeps` with logger+constructor injection |
| `src/core/ports/connectivity-strategy.ts` | Modified (Batch C) | Added optional `fingerprint?(): Promise<string>` method to `ConnectivityStrategy` port |
| `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` | Modified (Batch C) | Added `fingerprint()` delegating to `MssqlSchemaAdapter.fingerprint()`; `canConnect()` re-throws `ConnectionError` for missing-driver case |
| `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts` | Modified (Batch C) | Added `fingerprint()` using `SQL_MSSQL_FINGERPRINT` + sha256; imports `createHash` + `SQL_MSSQL_FINGERPRINT` |
| `test/adapters/engines/mssql/strategies/registry.test.ts` | Created (Batch C) | 19 assertions: buildMssqlStrategies (7) + selectStrategy (12) |
| `test/adapters/engines/mssql/factory.test.ts` | Adjusted (Batch C) | login-failed/kerberos now expect `StrategyExhaustionError`; `SqlcmdUnavailable` stub injected via deps |
| `test/adapters/engines/mssql/factory-missing-driver.test.ts` | Adjusted (Batch C) | Missing-driver `ConnectionError('npm i mssql')` preserved; `SqlcmdStub` injected via deps |
| `openspec/changes/connectivity-strategies/tasks.md` | Modified (Batch C) | Marked C3.1–C3.6 as `[x]` |
| `src/adapters/engines/mssql/strategies/dump-emitter.ts` | Created (Batch D) | `emitDumpScript()` + `DUMP_DIR` + `DUMP_FILE` + `CATALOG_FAMILY_KEYS`; deterministic 11-family SQL script |
| `src/adapters/engines/mssql/strategies/manual-dump.strategy.ts` | Created (Batch D) | `ManualDumpStrategy` (id:'manual-dump'); detect/canConnect/runCatalog/close; `ReadFileFn` seam |
| `src/adapters/engines/mssql/strategies/registry.ts` | Modified (Batch D) | Imported + pushed `ManualDumpStrategy`; `MssqlStrategyDeps.ManualDump` seam added |
| `test/adapters/engines/mssql/strategies/dump-emitter.test.ts` | Created (Batch D) | 10 assertions: determinism, write-verb, FOR JSON PATH count, key aliases, DUMP_DIR/DUMP_FILE/CATALOG_FAMILY_KEYS |
| `test/adapters/engines/mssql/strategies/manual-dump.test.ts` | Created (Batch D) | 19 assertions: id, detect, canConnect, runCatalog golden, error cases, close |
| `test/adapters/engines/mssql/strategies/registry.test.ts` | Modified (Batch D) | +4 D4.x assertions: third strategy = manual-dump, integrated second = manual-dump, order, deps override |
| `test/fixtures/mssql/dumps/mssql-dump-golden.json` | Created (Batch D) | Anonymized/synthetic combined JSON dump (app.accounts + app.sessions schema); BIT fields as 0/1 |
| `.gitignore` | Modified (Batch D) | Explicit `.dbgraph/dumps/` entry with comment (R8 — schema + proc source) |
| `openspec/changes/connectivity-strategies/tasks.md` | Modified (Batch D) | Marked D4.1–D4.4 as `[x]` |
| `src/adapters/engines/mssql/strategies/install-recipes.ts` | Created (Batch E) | `getRecipes(tool, os) → InstallRecipe[]`; sqlcmd win32/darwin/linux with official Microsoft sources |
| `src/adapters/engines/mssql/strategies/consented-install.strategy.ts` | Created (Batch E) | `ConsentedInstallStrategy`; detect always true; canConnect always false; runCatalog prints guidance via Logger.info then throws `StrategyExhaustionError`; B2 seam marked; `eslint-disable-next-line` for `_scope` |
| `src/adapters/engines/mssql/strategies/registry.ts` | Modified (Batch E) | Imported + pushed `ConsentedInstallStrategy`; `MssqlStrategyDeps.ConsentedInstall` seam; logger threaded through `buildMssqlStrategies`; `noopLogger` import added |
| `src/adapters/engines/mssql/factory.ts` | Modified (Batch E) | Added `ManualDump` + `ConsentedInstall` to `MssqlSchemaAdapterDeps`; passes all deps + logger to `buildMssqlStrategies` |
| `src/infra/open-connections.ts` | Modified (Batch E) | Added optional `logger: Logger = noopLogger` parameter to `openConnections`; passes logger to `createMssqlSchemaAdapter`; back-compat (default noopLogger) |
| `src/cli/format/exhaustion.ts` | Created (Batch E) | `formatExhaustionError(err)`: pure CLI formatter; option (a) manual-dump path + script/output location; option (b) guided install + winget/brew/url; B2 deferred notice; attempt list |
| `test/adapters/engines/mssql/strategies/install-recipes.test.ts` | Created (Batch E) | 9 assertions: per-OS lookup, winget id, official URLs, unknown tool, empty result |
| `test/adapters/engines/mssql/strategies/consented-install.test.ts` | Created (Batch E) | 14 assertions: id, detect/canConnect behavior, runCatalog throws, Logger.info calls, consent notice, microsoft.com, no spawn, B2 seam in source, close no-op |
| `test/adapters/engines/mssql/strategies/registry.test.ts` | Modified (Batch E) | +4 E5.x assertions: fourth strategy = consented-install, integrated third = consented-install, full order, deps override |
| `test/cli/format/exhaustion.test.ts` | Created (Batch E) | 10 assertions: both options, manual-dump path, dump file, install guidance, microsoft.com, B2 deferred, attempt list |
| `openspec/changes/connectivity-strategies/tasks.md` | Modified (Batch E) | Marked E5.1–E5.4 as `[x]` |

## Gate Results

### Batch A (A1.7)
- `npx tsc --noEmit`: CLEAN (0 errors)
- `npm run lint`: CLEAN (0 errors, 0 warnings)
- `npm test`: 1297/1297 passed (87 test files)

### Batch B (B2.6)
- `npx tsc --noEmit`: CLEAN (0 errors)
- `npm run lint`: CLEAN (0 errors, 0 warnings)
- `npm test`: 1355/1355 passed (89 test files)
- Security scan (write-verb scanner): PASS — `strategies/` covered by `engines/**` glob
- Leak scanner: PASS — no codename, no inline credentials
- Boundary test: PASS — `connectivity-strategy.ts` has no driver/tool/child_process imports

### Batch C (C3.6)
- `npx tsc --noEmit`: CLEAN (0 errors)
- `npm run lint`: CLEAN (0 errors, 0 warnings)
- `npm test`: 1374/1374 passed (90 test files)
- Back-compat: sql/ntlm configs still select NativeTediousStrategy (behavior preserved)
- Missing-driver: `ConnectionError('npm i mssql')` still thrown and asserted (test preserved)
- Registry test: 19/19 — ordered list, integrated omits native, selectStrategy exhaustion

### Batch D (D4.4)
- `npx tsc --noEmit`: CLEAN (0 errors)
- `npm run lint`: CLEAN (0 errors, 0 warnings)
- `npm test`: 1407/1407 passed (92 test files) — +33 new tests vs Batch C
- Security scan (write-verb scanner): PASS — `strategies/dump-emitter.ts` and `manual-dump.strategy.ts` covered by `engines/**` glob
- Leak scanner: PASS — no codename, no inline credentials in any new file
- Boundary test: PASS — `connectivity-strategy.ts` still imports no driver/tool/child_process
- Registry test: 23/23 — order: native → sqlcmd → manual-dump; integrated omits native; manual-dump seam override

### Batch E (E5.4)
- `npx tsc --noEmit`: CLEAN (0 errors)
- `npm run lint`: CLEAN (0 errors, 0 warnings)
- `npm test`: 1444/1444 passed (95 test files) — +37 new tests vs Batch D
- Security scan (write-verb scanner): PASS — `install-recipes.ts` + `consented-install.strategy.ts` covered by `engines/**` glob; winget/URL strings not SQL-looking, no write verb
- Leak scanner: PASS — no codename, no inline credentials in any new file
- CLI boundary: PASS — `src/cli/format/exhaustion.ts` imports only from `../../index.js` (no adapter imports)
- Core boundary: PASS — `connectivity-strategy.ts` still imports no driver/tool/child_process
- Registry test: 27/27 — full order: native → sqlcmd → manual-dump → consented-install; integrated omits native; ConsentedInstall seam override
- Back-compat: `openConnections(projectRoot)` still works without logger (default noopLogger)

## Deviations from Design

**Batch A deviations (unchanged):**
One minor deviation: the design showed `canConnect(config)` with a `config` parameter but the tasks file and the design's code block both show `canConnect()` without one (since each strategy instance is already constructed with its config). The implementation follows the tasks.md and design code block (no parameter on `canConnect`). This is consistent with the registry pattern where each strategy holds its config at construction time.

The design's `import type { Logger }` in the port was listed as an import but the tasks spec says "import ONLY `RawCatalog`/`ExtractionScope`". Logger is NOT imported in the port file to keep it maximally core-typed.

**Batch B deviations:**
None — implementation matches design. The `SpawnSyncFn` constructor injection seam matches the design's "inject the spawn function" guidance. The `FOR JSON PATH` wrapper uses `SELECT * FROM (...) AS _rows FOR JSON PATH, INCLUDE_NULL_VALUES` which preserves the inner `ORDER BY` for ADR-008 determinism. The `SQL_MSSQL_FINGERPRINT` query is not wrapped in FOR JSON (it returns a single aggregate row, not an array of catalog rows).

Note: `SQL_MSSQL_FINGERPRINT` is not called in `runCatalog()` — the fingerprint is a separate concern (owned by `MssqlSchemaAdapter.fingerprint()` in the native path, and will be addressed in Batch C when the StrategyBackedSchemaAdapter is created). B2.5 scope is catalog extraction only.

**Batch C deviations:**
- Added optional `fingerprint?(): Promise<string>` method to the `ConnectivityStrategy` port. The design did not specify this explicitly, but the design's `StrategyBackedSchemaAdapter.fingerprint()` requirement necessitates a delegation path. Adding an optional method to the port is additive and non-breaking; all existing strategy implementations continue to compile.
- `NativeTediousStrategy.canConnect()` now re-throws `ConnectionError` for the missing-driver case (message contains 'npm i mssql'). This is a behavior change from pure "return false on any error" but is necessary to preserve the existing missing-driver assertion. It is also correct semantically: a missing npm package is a setup error, not a transient probe failure.
- Factory tests for `login-failed` and `kerberos` now expect `StrategyExhaustionError` (not `ConnectionError`). This is the correct new behavior — when native strategy fails to connect and sqlcmd is also unavailable, all strategies are exhausted. The `SqlcmdUnavailable` stub is injected via `deps.Sqlcmd` to make tests deterministic regardless of sqlcmd presence on CI. The old `ConnectionError` assertions for these cases were removed because the factory is now a strategy selector, not a direct pool manager.

**Batch D deviations:**
- The `ManualDumpStrategy` constructor signature is `(config, dumpPath?, readFile?)` rather than `(config)` alone. The design implied the default dump path but did not specify a `readFile` seam. The extra constructor parameters are default-valued and backward-compatible; the `readFile` seam is necessary for testability (same pattern as the `SpawnSyncFn` seam in `SqlcmdStrategy`).
- The `detect()` method uses `existsSync` from `node:fs` directly (not injectable) since the test for `detect()` that checks file existence uses the REAL golden fixture on disk. Only `readFile` is injectable (needed for content-level tests like malformed JSON). This is consistent with the sqlcmd `detect()` design which uses `spawnSync` for availability detection via actual process lookup.
- The `.gitignore` already had `.dbgraph/` covering the dumps directory. Added an explicit `.dbgraph/dumps/` entry with a comment to make the intent visible per R8. Both entries are now present (redundant but intentional documentation).

**Batch E deviations:**
- `ConsentedInstallStrategy.canConnect()` returns `false` (not `true`). The design says `detect()` is always available but does not specify `canConnect()`. Returning `false` from `canConnect()` ensures the strategy is recorded in the `StrategyExhaustionError.attempts` list before `runCatalog()` is called, which makes the exhaustion message more complete. `runCatalog()` is also guarded (prints guidance + throws), creating a double-gate that prevents silent partial catalogs.
- `exhaustion.ts` inlines the two path constants (`DUMP_DIR = '.dbgraph/dumps'`, `DUMP_FILE = 'mssql-dump.json'`) rather than importing from `dump-emitter.ts`. This is required by ADR-004: CLI files (`src/cli/**`) must not import from `src/adapters/**`. The constants are stable, well-known values. A comment in the source file documents the coupling and the reason for duplication.
- `buildMssqlStrategies` now accepts `deps.logger` (optional, defaults to `noopLogger`) and passes it to `ConsentedInstallStrategy`. This is a minimal additive change to the existing deps pattern — all existing callers (tests included) continue to work without change since the field is optional.
- `openConnections` gains an optional second parameter `logger: Logger = noopLogger`. All existing callers (`dispatch.ts`, `cli.ts`, tests) continue to work without change. The logger is threaded through to `createMssqlSchemaAdapter` which already accepted it.

## Remaining Tasks

Batch F (F6.1–F6.3).

## Next Recommended

`sdd-verify` for Batches A+B+C+D+E — validate all completed implementation against spec/design/tasks.
OR: `sdd-apply` for Batch F (F6.1–F6.3): write-verb scan, boundary hygiene, lint sweep + closeout.
