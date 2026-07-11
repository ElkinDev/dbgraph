# Apply Progress: shipped-artifact-fixes

**Mode**: Strict TDD (RED → GREEN documented per phase)
**Batches**: 1 (Docker-free REDs) + 2 (dist-level Docker test) — BOTH COMPLETE.
**Gate (both batches)**: `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` 3731 passed | 4 skipped (3735).
**Batch-2 gated run**: `npm run build` + `DBGRAPH_INTEGRATION=1 npm run test:integration` (dist-connect only) → GREEN (1 passed). Skip-clean when Docker/dist absent → 2 skipped.

## TDD Cycle Evidence

| Task | RED | GREEN | Refactor |
|------|-----|-------|----------|
| 1.1/1.2 Scoped npx | Goldens updated first → 30/223 install tests FAIL (`args = ["-y", "dbgraph-mcp"]` vs expected scoped) | Source updated at all sites → 223/223 PASS | N/A |
| 1.3 README | — | Shell string `npx -y -p @elkindev/dbgraph dbgraph-mcp` | — |
| 1.4 npx resolution | — | Published `@elkindev/dbgraph@1.1.0` bin `dbgraph-mcp -> dist/mcp.js` confirmed; bare `dbgraph-mcp` E404 | — |
| 2.1 importModule seam | — | Deps seam routed into `loadOptionalDriver('mssql', …)` (mirrors pg) | — |
| 2.2/2.3 mssql interop | Inject `{ default: { ConnectionPool } }` → raw destructure `new undefined()` → 2 bundled-CJS scenarios FAIL | Interop-safe `mod['ConnectionPool'] ?? mod['default']?.['ConnectionPool']` → 4/4 PASS | N/A |
| 2.4 ESM shape + siblings | — | Top-level `{ ConnectionPool }` scenario GREEN; pg/mysql2/mongodb/sqlite untouched (full suite green) | — |
| 3.1/3.2 Dist-level test | — | New `dist-connect.integration.test.ts`: spawns a fresh Node child that `require()`s BUILT `dist/index.cjs` and drives `createMssqlSchemaAdapter` (result → temp file). Double-gated on `DBGRAPH_INTEGRATION=1` AND `existsSync(dist/index.cjs)`; reuses `startMssqlContainer`; 240s hook. | N/A |
| 3.3 Dist-level RED (REAL, demonstrated) | Transiently reverted the interop fix in src → `npm run build` → ran the gated test against the PRE-FIX dist → child `{ ok:false, name:"ConnectivityUnavailableError", error:"All mssql connectivity strategies exhausted…" }` → test FAILED. Root cause: raw `const { ConnectionPool } = mssqlMod` → `undefined` under Node's real CJS→ESM interop → `new undefined()` swallowed by `canConnect()`. Restored via `git checkout` + rebuild. | Post-fix dist: 1 passed, engine=mssql, schemas⊇dbo, objectCount>0 | N/A |
| 3.4 Skip-clean + floor | — | Gate OFF (no `DBGRAPH_INTEGRATION`) → 2 skipped, never failing. `npm test` floor 3731 passed \| 4 skipped holds (file carries `.integration.test.ts` suffix → excluded from default run). | N/A |

## Dist-Level Test Mechanism (Batch 2 decision — closes design Open Question)

**Chosen**: SPAWN a fresh Node child (`process.execPath` + `node -e` that `require()`s `dist/index.cjs`), NOT in-process `createRequire`.
**Why**: The masking IS vitest's module runner lifting a CJS package's named exports onto the ESM namespace top level. `createRequire` still executes inside vitest's worker, where the dynamic `import('mssql')` fired from the natively-required CJS bundle COULD still be resolved through vitest's registry — the exact ambiguity we must eliminate. A separate `node` process has ZERO vitest on the connection path, so Node's real CJS→ESM interop is unambiguously exercised (design §"Dist-Level Test Mechanism", spawn option (a) — highest fidelity). Result is written to a temp FILE (not stdout) so no driver log line can corrupt the payload; a non-zero child exit is the RED signal but the payload is read from the file rather than trusting the exit code.

## config.yaml decision

`testing.layers.integration.available` was STALE at `false` with tool `"testcontainers (planned, not installed yet)"`. VERIFIED FALSE: `testcontainers@12.0.4` is in devDependencies AND 12 `*.integration.test.ts` suites exist and pass under Docker (several run this batch). Updated to `available: true` with an honest tool string naming the suites and the `DBGRAPH_INTEGRATION=1 npm run test:integration` gate.

## Completed Tasks

### Phase 1: Bug 1 — scoped npx install command
- [x] 1.1 RED: install.test.ts arg goldens updated (52 sites: 41 single-quote `'-y', 'dbgraph-mcp'`, 11 double-quote `"-y", "dbgraph-mcp"`) → 30 tests RED.
- [x] 1.2 GREEN: install.ts `DEFAULT_MCP_ENTRY`, `CODEX_RENDER`, `MANUAL_SNIPPET` (4 blocks) → scoped args → 223/223.
- [x] 1.3 README.md MCP section → `npx -y -p @elkindev/dbgraph dbgraph-mcp`.
- [x] 1.4 Scoped npx resolution verified against published bin map; squat vector (bare `dbgraph-mcp` = 404) closed.

### Phase 2: Bug 2 — mssql interop-safe resolution
- [x] 2.1 `NativeTediousStrategyDeps.importModule` seam added + routed into `loadOptionalDriver`.
- [x] 2.2 RED unit: bundled-CJS `.default` shape → `new undefined()`.
- [x] 2.3 GREEN: interop-safe `ConnectionPool` resolution at the call site; `npm i mssql` catch preserved.
- [x] 2.4 ESM-shape scenario GREEN; sibling drivers untouched.

### Phase 3: Gated dist-level live-connect test (Batch 2)
- [x] 3.1 Created `test/adapters/engines/mssql/dist-connect.integration.test.ts` — double-gated on `mssqlIntegrationEnabled()` AND built `dist/index.cjs`; reuses `startMssqlContainer`; 240s hookTimeout.
- [x] 3.2 Loads `createMssqlSchemaAdapter` from BUILT `dist/index.cjs` via a SPAWNED Node child (real Node, no vitest), NOT `createRequire`.
- [x] 3.3 RED demonstrated for real: pre-fix dist → `ConnectivityUnavailableError` (`new undefined()` swallowed). Restored cleanly.
- [x] 3.4 GREEN: post-fix dist connects + extracts; skip-clean when Docker/dist absent; floor 3731 holds.

## Files Changed

| File | Action | What |
|------|--------|------|
| `src/cli/commands/install.ts` | Modified | Scoped npx args at `DEFAULT_MCP_ENTRY`, `CODEX_RENDER`, `MANUAL_SNIPPET` (JSON/VS Code/opencode/Codex) |
| `test/cli/commands/install.test.ts` | Modified | 52 arg goldens → scoped args (config-key `dbgraph-mcp` and stale `command = "old"` block untouched) |
| `README.md` | Modified | MCP section shell command string |
| `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` | Modified | `importModule` deps seam + interop-safe `ConnectionPool` resolution (namespace ?? `.default`) |
| `test/adapters/engines/mssql/native-tedious.strategy.test.ts` | Created | 4 unit tests: bundled-CJS ×2, ESM top-level, absent-driver |
| `test/adapters/engines/mssql/dist-connect.integration.test.ts` | Created (Batch 2) | Gated dist-level live-connect test: spawns Node child requiring BUILT `dist/index.cjs`, drives `createMssqlSchemaAdapter` vs `startMssqlContainer` |
| `openspec/config.yaml` | Modified (Batch 2) | `testing.layers.integration.available` false→true (stale); honest tool string |
| `openspec/changes/shipped-artifact-fixes/tasks.md` | Modified | Batch 1 + Batch 2 tasks marked `[x]` |

## Deviations from Design
None — implementation matches design. The install fix touched the exact emission sites in the audit; the mssql fix resolves `ConnectionPool` interop-safely at the call site (not inside `loadOptionalDriver`), matching the pg/mysql2/mongodb sibling pattern (ADR-006). The Batch-2 dist test picked the SPAWNED-child mechanism (design's option (a), highest fidelity) over `createRequire`, resolving the design's Open Question. Line numbers in design drifted slightly after the seam insertion (noted in tasks.md) but every site was covered.

## Remaining (Verify only)
- [ ] 4.1 Re-run gate floor — DONE this batch (`npm test` 3731 passed | 4 skipped, tsc clean, lint 0/0); verify re-confirms.
- [ ] 4.2 Full gated `DBGRAPH_INTEGRATION=1 npm run test:integration` across ALL 12 integration files (dist-connect proven GREEN in isolation; verify runs the whole suite end-to-end).

## Status
12/12 apply tasks complete (Batch 1: 8 + Batch 2: 4). Both design Open Questions resolved (dist mechanism = spawned child; config.yaml integration = true). Ready for sdd-verify (Phase 4).
