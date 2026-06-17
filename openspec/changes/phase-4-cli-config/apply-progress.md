# Apply Progress — phase-4-cli-config Batch A

## Batch

Batch A (tasks 1.1–1.6): core errors + barrel seams (`capabilitiesFor`) + config layer (pure, fully unit-tested).

## Tasks completed

- [x] 1.1 RED→GREEN `ConfigError` (`E_CONFIG`) and `UnsupportedDialectError` (`E_UNSUPPORTED_DIALECT`) added to `src/core/errors.ts`. Both extend `DbgraphError` with stable codes and actionable messages. `ConnectionError`/`PermissionError` unchanged.
- [x] 1.2 Both errors re-exported via `src/core/index.ts` (explicit named export in the errors block) and reachable through `src/index.ts` (via `export * from './core/index.js'`).
- [x] 1.3 `capabilitiesFor(dialect: string): CapabilityMatrix` added to `src/index.ts` (composition root). Maps `'sqlite'` → `SQLITE_CAPABILITIES`, `'mssql'` → `MSSQL_CAPABILITIES`. Unknown dialect → `UnsupportedDialectError`. CLI will consume this without importing adapters directly.
- [x] 1.4 RED→GREEN `src/cli/config/schema.ts` (`DbgraphConfig` discriminated union, `SqliteSource`, `MssqlSource`, `VALID_LEVELS`, `SUPPORTED_DIALECTS`) + `src/cli/config/parse-config.ts` (`parseConfig(raw: unknown): DbgraphConfig`). Validates shape; unknown dialect → `UnsupportedDialectError`; malformed level or missing field → `ConfigError` naming the field.
- [x] 1.5 RED→GREEN `src/cli/config/resolve-secrets.ts` (`resolveSecrets(cfg, envMap)`). Expands `${env:VAR}` from the injected env map; unset var → `ConfigError` naming the variable; non-token literals pass through unchanged; pure (no `process.env` read inside, env map injected for testability).
- [x] 1.6 RED→GREEN `src/cli/config/build-config.ts` (`buildConfig(input): DbgraphConfig`, `writeConfig(cfg): string`). `buildConfig` is the SINGLE builder for both flag form and wizard; connection-identity fields (server/database/user/domain/password) MUST be `${env:VAR}` references → `ConfigError` on literal values. `writeConfig` uses `JSON.stringify(ordered, null, 2) + '\n'` with FIXED key order for determinism (ADR-008).

## Files created

- `src/core/errors.ts` — modified (added `ConfigError`, `UnsupportedDialectError`)
- `src/core/index.ts` — modified (added `ConfigError`, `UnsupportedDialectError` to exports)
- `src/index.ts` — modified (added `capabilitiesFor` function + engine capability imports)
- `src/cli/config/schema.ts` — created (`DbgraphConfig`, `SqliteSource`, `MssqlSource`, constants)
- `src/cli/config/parse-config.ts` — created (`parseConfig`)
- `src/cli/config/resolve-secrets.ts` — created (`resolveSecrets`)
- `src/cli/config/build-config.ts` — created (`buildConfig`, `writeConfig`)

## Test files created/modified

- `test/core/errors.test.ts` — extended (added `ConfigError` + `UnsupportedDialectError` describe blocks; 40 tests total)
- `test/core/barrel.test.ts` — extended (added 4 tests for new error exports in core + root barrels)
- `test/core/capabilities-for.test.ts` — created (15 tests for `capabilitiesFor`)
- `test/cli/config/parse-config.test.ts` — created (21 tests)
- `test/cli/config/resolve-secrets.test.ts` — created (10 tests)
- `test/cli/config/build-config.test.ts` — created (18 tests)

## Gate result

`npx tsc --noEmit`: CLEAN (no output, exit 0)
`npm test`: PASS — 42 test files, 625 tests, 0 failures

## Next batch

Batch B (tasks 2.1–2.4): hand-rolled argument parser, dispatch table, exit-code mapper, and `cli.ts` skeleton.
