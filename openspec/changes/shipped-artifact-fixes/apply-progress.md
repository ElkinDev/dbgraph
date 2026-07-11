# Apply Progress: shipped-artifact-fixes

**Mode**: Strict TDD (RED → GREEN documented per phase)
**Batch**: 1 of 2 (Docker-free REDs). Batch 2 (dist-level Docker test) is a separate follow-up.
**Gate**: `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` 3731 passed | 4 skipped (3735).

## TDD Cycle Evidence

| Task | RED | GREEN | Refactor |
|------|-----|-------|----------|
| 1.1/1.2 Scoped npx | Goldens updated first → 30/223 install tests FAIL (`args = ["-y", "dbgraph-mcp"]` vs expected scoped) | Source updated at all sites → 223/223 PASS | N/A |
| 1.3 README | — | Shell string `npx -y -p @elkindev/dbgraph dbgraph-mcp` | — |
| 1.4 npx resolution | — | Published `@elkindev/dbgraph@1.1.0` bin `dbgraph-mcp -> dist/mcp.js` confirmed; bare `dbgraph-mcp` E404 | — |
| 2.1 importModule seam | — | Deps seam routed into `loadOptionalDriver('mssql', …)` (mirrors pg) | — |
| 2.2/2.3 mssql interop | Inject `{ default: { ConnectionPool } }` → raw destructure `new undefined()` → 2 bundled-CJS scenarios FAIL | Interop-safe `mod['ConnectionPool'] ?? mod['default']?.['ConnectionPool']` → 4/4 PASS | N/A |
| 2.4 ESM shape + siblings | — | Top-level `{ ConnectionPool }` scenario GREEN; pg/mysql2/mongodb/sqlite untouched (full suite green) | — |

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

## Files Changed

| File | Action | What |
|------|--------|------|
| `src/cli/commands/install.ts` | Modified | Scoped npx args at `DEFAULT_MCP_ENTRY`, `CODEX_RENDER`, `MANUAL_SNIPPET` (JSON/VS Code/opencode/Codex) |
| `test/cli/commands/install.test.ts` | Modified | 52 arg goldens → scoped args (config-key `dbgraph-mcp` and stale `command = "old"` block untouched) |
| `README.md` | Modified | MCP section shell command string |
| `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` | Modified | `importModule` deps seam + interop-safe `ConnectionPool` resolution (namespace ?? `.default`) |
| `test/adapters/engines/mssql/native-tedious.strategy.test.ts` | Created | 4 unit tests: bundled-CJS ×2, ESM top-level, absent-driver |
| `openspec/changes/shipped-artifact-fixes/tasks.md` | Modified | Batch 1 tasks marked `[x]` |

## Deviations from Design
None — implementation matches design. The install fix touched the exact emission sites in the audit; the mssql fix resolves `ConnectionPool` interop-safely at the call site (not inside `loadOptionalDriver`), matching the pg/mysql2/mongodb sibling pattern (ADR-006). Line numbers in design drifted slightly after the seam insertion (noted in tasks.md) but every site was covered.

## Remaining (Batch 2 + Verify)
- [ ] 3.1–3.4 Gated dist-level live-connect test (`test/adapters/engines/mssql/dist-connect.integration.test.ts`): loads BUILT `dist/index.cjs` via real Node against `startMssqlContainer`; self-gates on `DBGRAPH_INTEGRATION=1` + built `dist/`. This is the ONLY tier that observes the real dist-level RED (`new undefined()` pre-fix); Batch 1's unit RED (2.2) is its Docker-free proxy.
- [ ] 4.1 Re-run gate floor (done for Batch 1; re-confirm after Batch 2).
- [ ] 4.2 Gated `npm run build` + `DBGRAPH_INTEGRATION=1 npm run test:integration` — `dist-connect` GREEN.
- Open question from design: dist-test mechanism (spawn Node child vs `createRequire`) — apply phase for Batch 2 to pick.
- Open question from design: `config.yaml` integration `available: false` is STALE — update or defer.

## Status
8/8 Batch-1 tasks complete. Ready for Batch 2 (dist-level test), then sdd-verify.
