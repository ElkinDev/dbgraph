# Apply Progress — phase-4-cli-config (Batches A + B)

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

## Next batch

Batch C (tasks 3.1–3.3): `init` + `node:readline` wizard + `.gitignore` writer + byte-identity golden.
