# Apply Progress: connectivity-strategies — Batch A

**Change**: connectivity-strategies
**Mode**: Strict TDD (RED → GREEN per task)
**Batch**: A (A1.1–A1.7)
**Status**: Complete

## Completed Tasks

- [x] A1.1 `test/core/connectivity-strategy.test.ts` + `src/core/ports/connectivity-strategy.ts` — port declared, shape tested
- [x] A1.2 Re-exported via `src/core/ports/index.ts` + `src/core/index.ts`
- [x] A1.3 `StrategyExhaustionError` added to `src/core/errors.ts`; test extended; barrel updated
- [x] A1.4 `{ type: 'integrated' }` added additively to `MssqlAdapterConfig.authentication` in `src/core/ports/schema-adapter.ts`; factory narrowing fixed
- [x] A1.5 `MssqlSource.auth` optional discriminant + `parseMssqlSource` integrated arm; `parse-config.test.ts` extended
- [x] A1.6 `resolveMssqlSource` integrated arm (skip absent credentials); `resolve-secrets.test.ts` extended
- [x] A1.7 Lint+type gate: `npm run lint` 0 errors/0 warnings; `npx tsc --noEmit` clean; `npm test` 1297/1297 pass

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

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/core/ports/connectivity-strategy.ts` | Created | `ConnectivityStrategy`, `DetectResult`, `StrategyAttempt` — core types only, zero outward imports |
| `src/core/ports/index.ts` | Modified | Re-export new port types |
| `src/core/index.ts` | Modified | Re-export port types + `StrategyExhaustionError` |
| `src/core/errors.ts` | Modified | Added `StrategyExhaustionError` (`E_STRATEGY_EXHAUSTION`, `readonly attempts`) |
| `src/core/ports/schema-adapter.ts` | Modified | Added `{ type: 'integrated' }` union member to `MssqlAdapterConfig.authentication` |
| `src/adapters/engines/mssql/factory.ts` | Modified | Fixed narrowing: `if ntlm` explicit; `integrated` comment for Batch C |
| `src/infra/config/schema.ts` | Modified | `MssqlSource.user/password` now optional; added `auth?: 'sql'|'ntlm'|'integrated'` |
| `src/infra/config/parse-config.ts` | Modified | `parseMssqlSource` integrated arm + `auth` inference logic |
| `src/infra/config/resolve-secrets.ts` | Modified | `resolveMssqlSource` integrated arm; credential guards; `missingCredential()` helper |
| `src/infra/open-connections.ts` | Modified | Added `integrated` arm building `authentication: { type: 'integrated' }` |
| `test/core/connectivity-strategy.test.ts` | Created | Port shape tests |
| `test/core/errors.test.ts` | Modified | Added `StrategyExhaustionError` test suite |
| `test/cli/config/parse-config.test.ts` | Modified | Added `integrated` auth parse tests (A1.5) |
| `test/cli/config/resolve-secrets.test.ts` | Modified | Added `integrated` resolve tests (A1.6) |

## Gate Results (A1.7)

- `npx tsc --noEmit`: CLEAN (0 errors)
- `npm run lint`: CLEAN (0 errors, 0 warnings)
- `npm test`: 1297/1297 passed (87 test files)

## Deviations from Design

One minor deviation: the design showed `canConnect(config)` with a `config` parameter but the tasks file and the design's code block both show `canConnect()` without one (since each strategy instance is already constructed with its config). The implementation follows the tasks.md and design code block (no parameter on `canConnect`). This is consistent with the registry pattern where each strategy holds its config at construction time.

The design's `import type { Logger }` in the port was listed as an import but the tasks spec says "import ONLY `RawCatalog`/`ExtractionScope`". Logger is NOT imported in the port file to keep it maximally core-typed. Strategies will receive Logger through constructor injection (Batch B/C).

## Remaining Tasks

All of Batch B, C, D, E, F remain.

## Next Recommended

`sdd-apply` for Batch B (B2.1–B2.6): native-tedious strategy + sqlcmd strategy + json-rows validation.
