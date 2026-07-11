# Tasks: shipped-artifact-fixes

Gate floor after EVERY phase: full suite >= 3731 (incl. 4 skipped), `npm run lint` clean, `npx tsc --noEmit`
clean. STRICT TDD (`strict_tdd: true`): failing test first, then make it pass.

## Batch 1 — Shipped fixes (Docker-free REDs)

### Phase 1: Bug 1 — scoped npx install command
- [x] 1.1 RED: in `test/cli/commands/install.test.ts`, update every arg golden — `['-y', 'dbgraph-mcp']` -> `['-y', '-p', '@elkindev/dbgraph', 'dbgraph-mcp']`, `['npx', '-y', 'dbgraph-mcp']` -> `['npx', '-y', '-p', '@elkindev/dbgraph', 'dbgraph-mcp']`, and Codex TOML `args = ["-y", "dbgraph-mcp"]` text (~41 sites). Run -> RED. (52 arg sites: 41 single-quote + 11 double-quote; 30 tests RED.)
- [x] 1.2 GREEN: `install.ts` — `DEFAULT_MCP_ENTRY` (905), `CODEX_RENDER` (522), `MANUAL_SNIPPET` blocks (819, 830, 840, 848) -> scoped args. Run -> GREEN (223/223).
- [x] 1.3 Update `README.md` MCP section (358): `npx -y dbgraph-mcp` -> `npx -y -p @elkindev/dbgraph dbgraph-mcp`.
- [x] 1.4 Verify `npx -y -p @elkindev/dbgraph dbgraph-mcp` resolves the bin against the PUBLISHED 1.1.0 (package.json bin `dbgraph-mcp -> dist/mcp.js`); record result. (Published bin map confirmed `dbgraph-mcp -> dist/mcp.js`; bare `dbgraph-mcp` registry name E404 — squat vector closed.)

### Phase 2: Bug 2 — mssql interop-safe resolution
- [x] 2.1 Add an injectable `importModule` deps seam to `NativeTediousStrategy`, routed into `loadOptionalDriver('mssql', …)`, mirroring pg/mysql/mongodb.
- [x] 2.2 RED: unit test injects `{ default: { ConnectionPool: FakePool } }`; assert a real pool is built. Current raw destructure -> `new undefined()` -> RED. (2 bundled-CJS scenarios RED; new `test/adapters/engines/mssql/native-tedious.strategy.test.ts`.)
- [x] 2.3 GREEN: resolve `mod['ConnectionPool'] ?? mod['default']?.['ConnectionPool']` at `native-tedious.strategy.ts`; keep the `npm i mssql` catch. Run -> GREEN (4/4).
- [x] 2.4 Add the ESM-shape scenario (top-level `ConnectionPool`) -> GREEN; confirm pg/mysql/mongodb/sqlite tests untouched. (Full suite 3731 passed | 4 skipped.)

## Batch 2 — Dist-level masking-class closer (Docker + build gated)

### Phase 3: Gated dist-level live-connect test
- [ ] 3.1 Create `test/adapters/engines/mssql/dist-connect.integration.test.ts`: self-gate on `mssqlIntegrationEnabled()` AND built `dist/index.cjs`; reuse `startMssqlContainer`; 240s hookTimeout.
- [ ] 3.2 Load `createMssqlSchemaAdapter` from the BUILT `dist/index.cjs` via real Node (spawned child or `createRequire`), NOT vitest src.
- [ ] 3.3 RED (against pre-fix built dist): SQL-auth connect + extract fails `new undefined()`. NOTE: this RED is ONLY observable via the dist artifact — that is the point; the unit RED (2.2) is its Docker-free proxy.
- [ ] 3.4 GREEN: rebuild post-fix; dist connects + extracts. Confirm skip-clean when dist/Docker absent; floor 3731 holds.

## Phase 4: Verification
- [ ] 4.1 `npm test` >= 3731 (incl. 4 skipped); `npm run lint`; `npx tsc --noEmit`.
- [ ] 4.2 Gated: `npm run build` then `DBGRAPH_INTEGRATION=1 npm run test:integration` — `dist-connect` GREEN.
