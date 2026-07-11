# Design: shipped-artifact-fixes

## Technical Approach

Two isolated, low-abstraction fixes to the SHIPPED artifact, each matching an existing codebase pattern.
Bug 1 rewrites the MCP install command to the scoped npx form at every emission site. Bug 2 makes the mssql
driver resolution interop-safe (already the norm for the other four drivers) and adds a gated dist-level test
that runs the BUILT artifact against a live container — the missing test tier that let the defect ship.

## Architecture Decisions

### Decision: Scoped npx via `-p @elkindev/dbgraph`
**Choice**: `command: 'npx', args: ['-y', '-p', '@elkindev/dbgraph', 'dbgraph-mcp']`.
**Alternatives**: (a) publish a separate `dbgraph-mcp` registry package — more surface, defeats the scoped
bin, still squattable; (b) `npx -y @elkindev/dbgraph <sub>` — the bin is `dbgraph-mcp`, not a `dbgraph` subcommand.
**Rationale**: `npx --package <pkg> <bin>` is the documented way to run a bin that lives inside a
differently-named package. `package.json` maps `dbgraph-mcp -> ./dist/mcp.js` inside `@elkindev/dbgraph`
(verified). Closes both the 404 and the squat vector — npx no longer resolves a bare `dbgraph-mcp` from the registry.

### Decision: Fix interop at the mssql call site, not inside `loadOptionalDriver`
**Choice**: Resolve `ConnectionPool` via `mod['ConnectionPool'] ?? mod['default']?.['ConnectionPool']` in
`native-tedious.strategy.ts`; add an injectable `importModule` seam mirroring pg/mysql/mongodb.
**Alternatives**: normalize `.default` inside `loadOptionalDriver` — but it is contractually "byte-identical to
`await import(name)`" and every factory/strategy test + ADR-008 golden depends on that; changing it risks broad regressions.
**Rationale**: The sibling factories already resolve interop-safely at their call sites (ADR-006). Matching that
keeps the shared seam untouched and aligns mssql with the established pattern.

### Decision: Dist-level test in the integration tier, gated + self-skipping
**Choice**: New `*.integration.test.ts` that loads `dist/index.cjs` through real Node (spawned child or
`createRequire`, escaping vitest's module runner) against `startMssqlContainer`.
**Rationale**: The masking IS that vitest lifts CJS named exports; only the real Node loader on the BUILT
artifact reproduces `new undefined()`. Gating on `DBGRAPH_INTEGRATION=1` + built `dist/` keeps `npm test`
CI-independent (`dist/` is gitignored, not committed).

## Per-Driver Interop Audit (file:line + verdict)

| Driver | Load site | Resolution | Verdict |
|--------|-----------|-----------|---------|
| mssql | `native-tedious.strategy.ts:146` load -> `:160` destructure | `const { ConnectionPool } = mssqlMod` | **AFFECTED** — undefined in bundled CJS |
| pg | `pg/factory.ts:149-151` | `mod['Client'] ?? mod['default']?.['Client']` | Safe |
| mysql2 | `mysql/factory.ts:155-159` | `mod['createConnection'] ?? mod['default']?.['createConnection']` | Safe |
| mongodb | `mongodb/factory.ts:101-105` | `mod['MongoClient'] ?? mod['default']?.['MongoClient']` | Safe |
| better-sqlite3 (engine) | `sqlite/factory.ts:79-81` | `mod['default'] ?? mod` | Safe |
| better-sqlite3 (storage) | `storage/sqlite/schema.ts:146` | `const { default: Database } = …` | Safe — default IS the ctor |
| node:sqlite (engine) | `sqlite/factory.ts:118-119` | `mod['DatabaseSync']` | Safe — builtin, externalized |
| node:sqlite (storage) | `storage/sqlite/schema.ts:166-167` | `mod['DatabaseSync']` | Safe — builtin, externalized |

Only mssql regresses. `node:sqlite` lacks a `.default` fallback but is a Node builtin (externalized from the
bundle) whose ESM namespace carries `DatabaseSync` — no interop wrapping, no change needed.

## Exact Fix Sites

- `install.ts`: `DEFAULT_MCP_ENTRY` (903-906); `CODEX_RENDER` (521-522); `MANUAL_SNIPPET` blocks — mcpServers
  JSON (818-819), VS Code (829-830), opencode array (840), Codex TOML (847-848).
- `native-tedious.strategy.ts:144-161`: resolve `ConnectionPool` interop-safely; route `loadOptionalDriver('mssql', …)`
  through a new optional `importModule` deps seam; keep the `npm i mssql` catch.
- `README.md:358`: `npx -y dbgraph-mcp` -> `npx -y -p @elkindev/dbgraph dbgraph-mcp`.

## Dist-Level Test Mechanism

Reuse `test/fixtures/mssql/container.ts` (`startMssqlContainer`, `mssqlIntegrationEnabled`). The test loads
`createMssqlSchemaAdapter` from the BUILT `dist/index.cjs` (the barrel exports it) via a mechanism that
BYPASSES vitest's transform: either (a) spawn a Node child that `require()`s the dist and prints JSON — the
highest fidelity, matching the existing `*.smoke.test.ts` spawn pattern — or (b) `createRequire(import.meta.url)`
to load the CJS bundle through Node's native loader. Self-gates on `mssqlIntegrationEnabled()` AND
`existsSync(dist/index.cjs)`; 240s hookTimeout. Against a pre-fix dist it fails `new undefined()` (RED);
post-fix rebuild connects + extracts (GREEN).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Modify | Scoped npx at entry + Codex render + manual snippets |
| `README.md` | Modify | MCP section command string |
| `test/cli/commands/install.test.ts` | Modify | ~41 arg goldens -> scoped args |
| `native-tedious.strategy.ts` | Modify | Interop-safe `ConnectionPool` + `importModule` seam |
| `test/adapters/engines/mssql/native-tedious.strategy.test.ts` | Modify/Create | Unit RED: inject `{ default: { ConnectionPool } }` |
| `test/adapters/engines/mssql/dist-connect.integration.test.ts` | Create | Gated dist-level live-connect test |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Scoped args at every site | Update ~41 goldens RED -> source GREEN |
| Unit | mssql interop resolution | Inject CJS-shape module via new seam; RED (`new undefined()`) -> GREEN |
| Integration | Bundled dist connects live | Spawn/require `dist/index.cjs` vs container; gated + self-skip |

## Migration / Rollout

No data migration. The written config command changes; users re-run `dbgraph install` to rewrite entries
(idempotent). Release/version bump is out of scope.

## Open Questions

- [ ] Dist-test mechanism: spawn a Node child (highest fidelity, matches smoke pattern) vs in-process
  `createRequire` of the CJS bundle — apply phase to pick; both escape vitest's loader.
- [ ] `config.yaml` marks integration `available: false` (STALE — `testcontainers` is installed and
  integration suites exist); update during apply or defer to a docs change.
