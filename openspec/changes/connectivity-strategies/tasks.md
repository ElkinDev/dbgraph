# Tasks: Connectivity Strategies — Integrated-Security & External-Tool Connectivity

Standing header (every task): STRICT TDD (RED→GREEN). Pure/mocked units only — mock `node:child_process`
(`spawnSync`); NO real sqlcmd, NO Docker (the REAL integrated-auth sqlcmd run is validated MANUALLY in Phase 6,
not CI). Strategies live under `src/adapters/engines/mssql/strategies/`; the `ConnectivityStrategy` port carries
core types ONLY (ADR-004 — `src/core` imports nothing outward). Read-only is INVIOLABLE on EVERY path: only
catalog SELECTs. ZERO new npm deps (`node:child_process` only — no `node-sql-parser`, no `node-odbc`). Spawn with
ARGV arrays, `{ shell: false }` — NEVER interpolate config into a shell string. `${env:VAR}`-only secrets;
`integrated` carries none; resolved secrets NEVER logged (`Logger` port, never `console.log`). Strict TS, no `any`.
Determinism ADR-008. CODENAME RULE: the validation-database codename is NEVER written in any code, fixture, dump,
or doc. **`npm run lint` zero-warning is a MANDATORY per-batch gate (CI runs it before tests).** Conventional
commits with US IDs; English. Reuse existing `DbgraphError`/`Logger`/`buildMssqlRawCatalog`/`queries.ts` — do not
redefine them.

## Batch A: Port + config (US-001, US-027, US-031)

- [ ] A1.1 RED→GREEN `test/core/connectivity-strategy.test.ts` + `src/core/ports/connectivity-strategy.ts`: declare `ConnectivityStrategy` (`id`, `detect():Promise<DetectResult>`, `canConnect():Promise<boolean>`, `runCatalog(scope):Promise<RawCatalog>`, optional `close()`), `DetectResult { available; detail? }`, `StrategyAttempt { id; reason }`; import ONLY `RawCatalog`/`ExtractionScope` (+ type-only `Logger`). Spec connectivity "Port is driver-free and core-typed". Done: test asserts shape; `npx tsc --noEmit`.
- [ ] A1.2 GREEN re-export the port via `src/core/ports/index.ts` + `src/core/index.ts`. Spec connectivity same req. Done: `npx tsc --noEmit`; importable from `core`.
- [ ] A1.3 RED→GREEN `test/core/errors.test.ts` (extend) + `src/core/errors.ts`: add `StrategyExhaustionError extends DbgraphError`, `code='E_STRATEGY_EXHAUSTION'`, `readonly attempts: readonly StrategyAttempt[]`; message lists each `{id} — {reason}`. Re-export in `core/index.ts` barrel. Spec connectivity "Exhausting all strategies raises a typed StrategyExhaustionError". Done: test asserts code + attempt listing; `npx tsc --noEmit`.
- [ ] A1.4 RED→GREEN: add `{ type: 'integrated' }` (no creds) to `MssqlAdapterConfig.authentication` in `src/core/ports/schema-adapter.ts` (additive union member). Spec mssql-extraction "integrated auth mode". Done: existing sql/ntlm narrow unchanged; `npx tsc --noEmit`.
- [ ] A1.5 RED→GREEN `test/cli/config/parse-config.test.ts` + `src/infra/config/schema.ts` + `parse-config.ts`: `MssqlSource` gains optional `auth?:'sql'|'ntlm'|'integrated'`; `parseMssqlSource` integrated arm requires ONLY `server`/`database` (NO `requireString` on `user`/`password`/`domain`); default inference (`domain`→ntlm else sql) preserved. Spec cli-config "integrated requires no credentials" + "Existing credentialed modes unchanged". Done: integrated parses sans creds; sql/ntlm round-trip identical; `npm test parse-config`.
- [ ] A1.6 RED→GREEN `test/cli/config/resolve-secrets.test.ts` + `src/infra/config/resolve-secrets.ts`: `resolveMssqlSource` skips absent `user`/`password`/`domain` (guard each `!== undefined`); resolves present identity fields only; no secret logged. Spec cli-config "resolveSecrets skips absent credential fields". Done: integrated resolves; missing referenced var still fails with `ConfigError` for credentialed modes; `npm test resolve-secrets`.
- [ ] A1.7 Batch A lint+type gate. Done: `npm run lint` zero-warning; `npx tsc --noEmit` clean; existing suites green.

## Batch B: native + sqlcmd strategies (US-007, US-027, US-031, US-033)

- [ ] B2.1 GREEN `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` (`NativeTediousStrategy`): MOVE existing `factory.ts` lazy `import('mssql')` + pool/connect + `mapMssqlError` logic here; `detect()`→`{available: authentication.type!=='integrated'}`; `canConnect()`→pool connect probe; `runCatalog(scope)` reuses `createMssqlReadonlyDriver`+`MssqlSchemaAdapter.extract` UNCHANGED; `close()` closes pool. Spec mssql-extraction "Explicit-credential config still uses the native driver". Done: `npx tsc --noEmit` (behavior preserved; wiring asserted in Batch C).
- [ ] B2.2 RED→GREEN `test/adapters/engines/mssql/strategies/json-rows.test.ts` + `strategies/json-rows.ts`: shared FOR-JSON validation/coercion → `MssqlRowInput`: `bit 0/1`→bool (`is_nullable`/`is_computed`/`is_unique`/`is_primary_key`/`is_unique_constraint`/`is_included_column`/`is_instead_of_trigger`/`is_cycling`), numeric-string→number (`object_id`/`column_id`/`*_ordinal`/`*_column_id`/`fk_id`), absent nullable text→null, malformed/missing-required→throw. Spec mssql-extraction "Malformed sqlcmd output is rejected, not cast". Done: `npm test json-rows`.
- [ ] B2.3 RED→GREEN `strategies/sqlcmd.strategy.ts` `detect()` (mock `spawnSync`): `where sqlcmd`/`which` exit 0 → available; absent → `{available:false}`; fallback capability probe `sqlcmd -?` exit 0 (capability not version). Spec connectivity "Detection reports availability without connecting" + "timed-out/failed probe → unavailable". Done: present/absent/timeout cases pass; `npm test sqlcmd`.
- [ ] B2.4 RED→GREEN `sqlcmd.strategy.ts` `canConnect()` (mock `spawnSync`): `sqlcmd -E -S <server> -d <db> -Q "SELECT 1" -h -1` argv array, `{shell:false}`, configurable timeout (~10s); exit 0→true; non-zero/timeout→false. Spec connectivity "First viable strategy wins" probe; mssql-extraction integrated. Done: exit-0/non-zero/timeout cases pass; `npm test sqlcmd`.
- [ ] B2.5 RED→GREEN `sqlcmd.strategy.ts` `runCatalog(scope)` (mock stdout): wrap each `queries.ts` constant in `FOR JSON PATH, INCLUDE_NULL_VALUES` (ORDER BY preserved INSIDE wrap, ADR-008); spawn `sqlcmd -E -S -d -Q -y 0 -h -1 -W` argv array; REASSEMBLY = split stdout lines, trim `\r`, drop `(N rows affected)` footer + blanks, CONCATENATE, `JSON.parse` (empty→`[]`); pass through `json-rows.ts`; call `buildMssqlRawCatalog` UNCHANGED. Fixture MUST include a MULTI-LINE split-JSON payload golden. Spec mssql-extraction "sqlcmd output reassembled and parsed to typed rows" + "yields catalog identical to native". Done: multi-line reassembly + footer-strip asserted; `npm test sqlcmd`.
- [ ] B2.6 Batch B lint+type gate. Done: `npm run lint` zero-warning; `npx tsc --noEmit` clean.

## Batch C: registry + selection + wiring (US-027, US-031, US-033, connectivity Logger reqs)

- [ ] C3.1 RED→GREEN `test/adapters/engines/mssql/strategies/registry.test.ts` + `strategies/registry.ts`: `buildMssqlStrategies(config, deps)` returns fixed order native (ONLY when `type!=='integrated'`) → sqlcmd → manual-dump → consented-install. Spec connectivity "Per-engine ordered registry selects the first viable strategy". Done: integrated omits native; order asserted; `npm test registry`.
- [ ] C3.2 RED→GREEN `registry.ts` `selectStrategy(strategies, logger)` (mocked strategies): for each `await detect()`→ if available `await canConnect()`→ FIRST pass WINS; logs each probe + final pick via injected `Logger` (`debug` per-probe, `info` final; no secret in any line); none pass → throw `StrategyExhaustionError(attempts)`. Spec connectivity "First viable wins", "Integrated skips native", "Selection transparent yet logged", "Verbosity via logger levels", "All exhausted lists each attempt". Done: first-wins + native-skip + exhaustion-listing + no-secret-logged + debug-suppressed cases pass; `npm test registry`.
- [ ] C3.3 RED→GREEN: rewrite `src/adapters/engines/mssql/factory.ts` — `createMssqlSchemaAdapter(config, { logger })` calls `buildMssqlStrategies`+`selectStrategy`, wraps winner in a thin `StrategyBackedSchemaAdapter` (`extract`→`runCatalog`, `fingerprint`→native delegate, `close`→`strategy.close?.()`). Single factory, NO second public export; optional `{ logger }` dep. Spec mssql-extraction "integrated auth mode selects an external-tool strategy". Done: `npx tsc --noEmit`.
- [ ] C3.4 GREEN: adjust existing `test/adapters/engines/mssql/factory.test.ts` + `factory-missing-driver.test.ts` to the new registry seam — explicit-creds still select native (behavior preserved); missing-mssql message preserved. Spec mssql-extraction "Explicit-credential config still uses the native driver". Done: both suites pass; `npm test factory`.
- [ ] C3.5 RED→GREEN `src/infra/open-connections.ts` (mssql branch, lines 79-91): add `integrated` arm building `authentication:{ type:'integrated' }`; pass through to the factory. Spec mssql-extraction integrated + cli-config integrated. Done: integrated branch covered; sql/ntlm branches unchanged; `npx tsc --noEmit`; `npm test`.
- [ ] C3.6 Batch C lint+type gate. Done: `npm run lint` zero-warning; `npx tsc --noEmit` clean; full `npm test` green.

## Batch D: manual-dump (US-027, US-031)

- [ ] D4.1 RED→GREEN `test/adapters/engines/mssql/strategies/dump-emitter.test.ts` + `strategies/dump-emitter.ts`: compose a single runnable `.sql` from the 11 `queries.ts` constants, each wrapped `FOR JSON PATH` + aliased to its `MssqlRowInput` key. Spec mssql-extraction "Emitted dump script is read-only and output is gitignored". Done: test asserts every constant wrapped + aliased + NO write verb; `npm test dump-emitter`.
- [ ] D4.2 RED→GREEN `strategies/manual-dump.strategy.ts` (`detect()` = configured file exists/readable under gitignored `.dbgraph/dumps/`): `runCatalog` reads ONE combined JSON (`{tables,columns,...}` = `MssqlRowInput`), reuses `json-rows.ts` validation, calls `buildMssqlRawCatalog`; itself issues no write. Golden = a RECORDED ANONYMIZED JSON dump → byte-identical `RawCatalog` (ADR-008, codename rule). Spec mssql-extraction "manual-dump strategy ingests one combined JSON offline". Done: golden ingest byte-identical; `npm test manual-dump`.
- [ ] D4.3 GREEN `.gitignore`: add `.dbgraph/dumps/` (sensitive schema/proc source — R8). Spec mssql-extraction "output is gitignored". Done: path ignored; `git check-ignore .dbgraph/dumps/` matches.
- [ ] D4.4 Batch D lint+type gate. Done: `npm run lint` zero-warning; `npx tsc --noEmit` clean; `npm test`.

## Batch E: guided install (B1) + exhaustion UX (US-001, US-033)

- [ ] E5.1 RED→GREEN `test/adapters/engines/mssql/strategies/install-recipes.test.ts` + `strategies/install-recipes.ts`: recipe registry `tool → { os; method:'winget'|'brew'|'url'; id?; url }[]` of OFFICIAL sources (e.g. sqlcmd → winget `Microsoft.Sqlcmd` / Microsoft Learn URL) per OS. Spec cli-config "Guided install prints instructions only". Done: per-OS recipe lookup asserted; only official sources; `npm test install-recipes`.
- [ ] E5.2 RED→GREEN `strategies/consented-install.strategy.ts` (`ConsentedInstallStrategy`): `detect()` always available; `runCatalog` does NOT install — PRINTS matching recipe via `Logger.info` behind a consent notice, then throws `StrategyExhaustionError` carrying the guidance; a marked `// B2: automated execution goes here` seam (no `spawn`). Spec cli-config "Automated install stated as deferred limitation". Done: no installer executed; B2 seam present; `npm test consented-install`.
- [ ] E5.3 RED→GREEN exhaustion-UX test + presenter: when `StrategyExhaustionError` surfaces, the CLI presents (a) manual-dump path (emitted script + gitignored output location) and (b) guided-install (official instructions behind consent), and states B2 is DEFERRED. Spec cli-config "Exhausted strategies present manual-dump and guided-install options". Done: both options + deferred-limitation phrasing asserted; `npm test`.
- [ ] E5.4 Batch E lint+type gate. Done: `npm run lint` zero-warning; `npx tsc --noEmit` clean.

## Batch F: close — boundaries, read-only scan, lint sweep (US-031, ADR-004)

- [ ] F6.1 GREEN confirm `test/adapters/engines/security-scan.test.ts` (already recurses `engines/**`) now lists a `strategies/` file and the scan PASSES (only SELECTs; `FOR JSON PATH` wrapper + winget/URL strings add no write verb; no codename). Spec connectivity + mssql-extraction "Strategy source passes the write-verb scanner". Done: scan enumerates `strategies/` + passes; `npm test security-scan`.
- [ ] F6.2 RED→GREEN `test/core/boundaries.test.ts`: assert `src/core/ports/connectivity-strategy.ts` imports no driver/tool/`node:child_process`; core/mcp/cli/infra unchanged and strategies live under `src/adapters/engines/mssql/strategies/`. Spec connectivity "Port is driver-free and core-typed". Done: `npm test boundaries`.
- [ ] F6.3 Final sweep: full `npm run lint` zero-warning; `npx tsc --noEmit` clean; full `npm test` green; confirm every task above is `[x]`; record any gotcha in `docs/learnings.md`. Done: all gates green; checklist complete.

## Apply Batch Grouping (one session each)

- **Batch A** (A1.1–A1.7): port + `StrategyExhaustionError` + `integrated` config (schema/parse/resolve) + barrels.
- **Batch B** (B2.1–B2.6): native-tedious (move factory logic) + sqlcmd (detect/canConnect/run) + `json-rows.ts`.
- **Batch C** (C3.1–C3.6): registry + `selectStrategy` + factory rewrite + factory-test adjust + `open-connections.ts`.
- **Batch D** (D4.1–D4.4): dump-emitter + manual-dump + `.gitignore` + anonymized golden.
- **Batch E** (E5.1–E5.4): install-recipes + consented-install (B1) + exhaustion UX.
- **Batch F** (F6.1–F6.3): write-verb scan over `strategies/` + boundary hygiene + lint sweep + closeout.

### Dependency bottlenecks

- A1.1 (port) + A1.3 (`StrategyExhaustionError`) + A1.4 (`integrated` union) gate ALL of B/C/D/E.
- B2.2 (`json-rows.ts`) gates B2.5 (sqlcmd run) AND D4.2 (manual-dump ingest) — shared validation seam.
- B2.1 (native strategy moves factory logic) MUST land before C3.3 (factory rewrite) and C3.4 (factory-test adjust).
- C3.1/C3.2 (registry + selection) gate C3.3 (factory wires them) and the E5.2/E5.3 exhaustion UX.
- D4.1 (emitter) precedes the E5.3 exhaustion UX (it surfaces the emitted script location).
- F6.1/F6.2 (scanner + boundary) run last — they assert the final shape of `strategies/`.
