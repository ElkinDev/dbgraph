# Apply Progress — phase-5-mcp-server (ALL BATCHES COMPLETE + VERIFY REMEDIATION DONE + CROSS-PLATFORM FIX)

**Change**: phase-5-mcp-server
**Mode**: Strict TDD (RED→GREEN per task)
**Batches completed**: A (tasks 1.1–1.10), B (tasks 2.1–2.8), B-fix (lint + config decoupling), C (tasks 3.1–3.6), D (tasks 4.1–4.5), **E (tasks 5.1–5.5) — FINAL**, **F (verify remediation) — FINAL**, **G (cross-platform install fix) — FINAL**
**Date**: 2026-06-17 → 2026-06-18 → 2026-06-18 (remediation) → 2026-06-17 (cross-platform fix)

---

## Completed Tasks

### Batch G — Cross-Platform Install Fix (Linux CI failure)

- [x] **Cross-platform fix — `resolveConfigPath` now uses explicit `path.win32` / `path.posix` separators**
  - **Root cause**: `src/cli/commands/install.ts` imported `join` from `node:path` and used it for BOTH branches of `resolveConfigPath`. On Linux, `path.join` uses `/` as separator. When a test mocks `platform === 'win32'`, the code still executed `join('C:\\Users\\...\\Roaming', 'Claude', 'claude_desktop_config.json')` via the Linux host joiner — producing `C:\Users\...\Roaming/Claude/claude_desktop_config.json` (mixed separators). The FsSeam is keyed by the exact computed path, so the seam lookup returned `undefined`, causing 3 `runInstall` tests to fail with "expected undefined to be defined". The `resolveConfigPath win32` assertion also failed directly on the separator mismatch.
  - **Fix**: Replaced `import { join } from 'node:path'` with `import { win32 as pathWin32, posix as pathPosix } from 'node:path'`. The win32 branch now calls `pathWin32.join(...)` (always `\`). The posix branch calls `pathPosix.join(...)` (always `/`). The production `realFsSeam` still uses the host-native `dirname` (correct — it only runs on the actual OS).
  - **Test changes**: NONE. The test file was already correct — it asserted `C:\...\Claude\claude_desktop_config.json` (backslashes) for the win32 case and used normalized `.replace(/\\/g, '/')` + `.toContain` for the posix cases. The tests were HOST-INDEPENDENT; the code was not.
  - **Host-independence reasoning**: `pathWin32.join` is a pure function that always returns `\`-separated paths regardless of where Node.js runs. `pathPosix.join` always returns `/`-separated paths. Neither reads `path.sep` from the host environment. Therefore `resolveConfigPath('win32', { APPDATA: 'C:\\...' })` returns the exact same string on Windows, Linux, and macOS.
  - **Files changed**: `src/cli/commands/install.ts` (1-line import change + 2 `join` calls replaced with `pathWin32.join` / `pathPosix.join` + inline comments).
  - **Gates**: `npx tsc --noEmit` CLEAN · `npm run lint` 0/0 · `npm test` 1259/1259 PASS (86 files).

---

### Batch F — Verify Remediation (findings C-1, W-1, W-2, W-3, S-1, S-2, S-3)

- [x] **C-1 (CRITICAL) FIXED** — `formatPath` no-route branch emits qnames, not raw SHA-1 node IDs.
  - `test/mcp/path.test.ts`: strengthened `no-route path includes neighbor suggestions` to assert SPECIFIC qnames (`main.departments`, `main.assignments`) AND assert no 40-hex IDs (L-009).
  - `src/core/present/path.ts:56-68`: renamed loop variable from misleading `qname` to `id`; added `view.resolveTable(id)` call for each entry in `nearest.from` / `nearest.to`.
  - `test/mcp/golden/path-tool-noroute.txt`: re-captured — now shows `main.departments` and `main.assignments`.
  - `docs/format-spec.md`: golden-change note added (token delta: 42 tk → 35 tk, ceiling 80 unchanged).
  - TDD: RED (new L-009 assertion failed on raw IDs) → fix → GREEN (9/9 path tests).

- [x] **W-1 (WARNING) FIXED** — `dbgraph_status` live drift now computed when adapter is available.
  - `src/mcp/tools/status.ts`: added optional `adapter?: SchemaAdapter` parameter; when provided and snapshot exists, computes `liveFp = await adapter.fingerprint()`, sets `driftChecked:true`, `driftDetected: liveFp !== lastSnapshot.fingerprint`. Fallback on fingerprint error stays connectionless.
  - `src/mcp/server.ts`: added `withStoreForStatus` closure that passes the live adapter to `runStatusTool` in the production path; harness path (storeOverride injected) stays connectionless.
  - `test/mcp/status.test.ts`: strengthened `connectionless output states drift could not be checked` to also assert it does NOT say "detected" or "none detected" (explicit driftChecked:false path test).
  - `test/mcp/status-drift.integration.test.ts`: updated to call `runStatusTool(store, args, adapter)` — tool now MUST report `detected (schema changed since last sync)`. Added second integration test for no-drift path.
  - TDD: integration tests gated behind `DBGRAPH_INTEGRATION=1`; unit assertion RED before fix → GREEN after.

- [x] **W-2 (WARNING) FIXED** — search pagination strengthened with specific second-page / hasMore:false assertions.
  - `test/mcp/search.test.ts`: replaced existence-only pagination tests with 4 L-009 assertions:
    1. First page with limit=5 asserts `hasMore: true` footer and `offset 0` marker.
    2. Second page via offset=5 asserts specific qnames and `offset 5`.
    3. Last page (offset=15, limit=5) asserts NOT `hasMore: true` and uses total-results format.
    4. Advancing offset yields different content than first page.
  - TDD: all new assertions GREEN (behavior was correct; tests were weak). 14/14 tests now pass.

- [x] **W-3 (WARNING) FIXED** — per-column FK edge deduplication in explore/related display.
  - Root cause: `getNeighbors` returns one `NeighborGroup` entry per EDGE (per-column edges + one aggregate edge for same FK), so a single-column FK like `employees→departments` produced 2 `main.departments` lines; composite FK `assignments→employees(2 cols)` produced 3 lines.
  - `src/core/present/explore.ts`: added `uniqueByQname()` helper; brief counts and normal/full entry lists now deduplicate by `node.qname` per direction.
  - `src/core/present/related.ts`: added `uniqueByQname()` helper with generic type; same dedup applied to outEntries/inEntries per kind.
  - `test/mcp/golden/explore-{brief,normal,full}.txt`, `related-tool-{brief,normal,full}.txt`: re-captured (references group: `1 out, 1 in` instead of `2 out, 3 in`).
  - `docs/format-spec.md`: golden-change note added (token delta: explore-normal 96 tk → 83 tk, ceilings unchanged).
  - TDD: golden assertions went RED after fix → re-captured → GREEN. All boundary tests still pass.

- [x] **S-1 (SUGGESTION) DONE** — `design.md` Decision 9 updated from `mcpServers.dbgraph` to `mcpServers.dbgraph-mcp` (spec-correct entry name).

- [x] **S-2 (SUGGESTION) DONE** — `src/cli/cli.ts` USAGE_TEXT now lists `affected` and `install` with one-line descriptions. `test/cli/cli.test.ts` extended with 2 new assertions. 9/9 tests pass.

- [x] **S-3 (SUGGESTION) DONE** — `design.md` File Changes table entry corrected: `src/mcp/precheck.ts` → `src/core/precheck/{extract,engine,index}.ts`.

- [x] **Leak-scanner fix** — `openspec/changes/phase-5-mcp-server/verify-report.md` contained the denylist codename (written by verifier). Redacted to `[CODENAME]` in the two affected lines.

### Batch A (1.1–1.10)

- [x] 1.1 `docs/format-spec.md` authored: line grammar, brief/normal/full levels, pagination contract, golden discipline, token budget table (all TBD until measured), `ceil(chars/4)` methodology.
- [x] 1.2 `src/core/present/search.ts` + `test/core/present/search-format.test.ts`: `formatSearch(SearchView, SearchDetail)` PURE. 22 tests. Goldens: `search-{brief,normal,full}.txt`.
- [x] 1.3 `src/core/present/object.ts` + `test/core/present/object-format.test.ts`: `formatObject(ObjectView, ObjectDetail)` PURE; columns/PK/FK/indexes/triggers; metadata omission stated explicitly. 21 tests. Goldens: `object-{brief,normal,full}.txt`.
- [x] 1.4 `src/core/present/related.ts` + `test/core/present/related-format.test.ts`: `formatRelated(ExploreView, RelatedDetail)` PURE; inferred edges in separate group with score. Reuses ExploreView. 18 tests. Goldens: `related-{brief,normal,full}.txt`.
- [x] 1.5 `src/core/present/impact.ts` + `test/core/present/impact-format.test.ts`: `formatImpact(ImpactView, ImpactDetail)` PURE; visible chain a→b→c, READ/WRITE split, truncation + dynamic-SQL warnings. 22 tests. Goldens: `impact-{brief,normal,full}.txt`.
- [x] 1.6 `src/core/present/path.ts` + `test/core/present/path-format.test.ts`: `formatPath(PathView)` PURE; join columns per hop; inferred mark; no-route + neighbor suggestion. 12 tests. Goldens: `path-found.txt`, `path-noroute.txt`.
- [x] 1.7 `src/core/present/status.ts` + `test/core/present/status-format.test.ts`: `formatStatus(McpStatusView, StatusDetail)` PURE; engine/version, last sync, drift reporting (connectionless / detected / none). 21 tests. Goldens: `status-{brief,normal,full}.txt`.
- [x] 1.8 `src/core/present/precheck.ts` + `test/core/present/precheck-format.test.ts`: `formatPrecheck(PrecheckView, PrecheckDetail)` PURE; matched objects + aggregated impact sections; confidence:parsed tags (full only); unmatched identifiers (full only). 21 tests. Goldens: `precheck-{brief,normal,full}.txt`.
- [x] 1.9 `src/core/index.ts` updated: re-exports formatSearch/formatObject/formatRelated/formatImpact/formatPath/formatStatus/formatPrecheck + all view/detail types. New `test/core/present/barrel.test.ts` (8 tests). `npx tsc --noEmit` clean.
- [x] 1.10 Golden files committed under `test/core/present/golden/`; 20 golden files for formatter×detail; determinism assertions (byte-identical re-run) pass for all formatters.

### Batch B (2.1–2.8)

- [x] 2.1 `src/infra/open-connections.ts` created (moved from `src/cli/config/open-connections.ts`); old file deleted. Imports the barrel for adapter/store factories; originally imported `parseConfig`/`resolveSecrets` from `src/cli/config/` (later fixed in Batch B-fix — see below). `npx tsc --noEmit` clean.
- [x] 2.2 `src/index.ts` re-exports `openConnections` + `AdapterAndStore` from `./infra/open-connections.js`. `src/cli/dispatch.ts` + `src/cli/commands/init.ts` updated to import from `../index.js` (barrel). All 1021 existing tests pass.
- [x] 2.3 `test/mcp/boundaries.test.ts` created: scans `src/mcp/**` for forbidden imports (`/adapters/`, `/cli/`, DB drivers); allows barrel + `@modelcontextprotocol/sdk` + `node:*`; includes 7 negative-control tests. 9/9 GREEN.
- [x] 2.4 `@modelcontextprotocol/sdk` installed and PINNED to exact `1.29.0` (no caret) in `package.json` `dependencies`. No other new runtime dependencies added.
- [x] 2.5 SDK API verified against installed `1.29.0`. See `docs/learnings.md` entry "2026-06-17 — @modelcontextprotocol/sdk 1.29.0 API verification". Key findings: `StdioServerTransport` at `@modelcontextprotocol/sdk/server/stdio.js`; `InMemoryTransport.createLinkedPair()` at `@modelcontextprotocol/sdk/inMemory.js`; `Server` + `ListToolsRequestSchema` + `CallToolRequestSchema` at `@modelcontextprotocol/sdk` root/server. DIVERGENCE: SDK uses Zod schemas for `McpServer.registerTool()` — chose low-level `Server` approach with plain JSON Schema `inputSchema` to avoid Zod dependency in our code. `CallToolResult.content[0].text` confirmed.
- [x] 2.6 `src/mcp/instructions.ts` + `test/mcp/instructions.test.ts` + `test/mcp/golden/instructions.txt`. Static `DBGRAPH_INSTRUCTIONS` string covers: explore-vs-search-vs-object, status→explore→precheck pre-change flow. 9 tests. Golden byte-identical. `npm test instructions` green.
- [x] 2.7 `src/mcp/server.ts` (`#!/usr/bin/env node`, `StdioServerTransport`): `createDbgraphServer()` factory; `ListToolsRequestSchema`/`CallToolRequestSchema` handlers; tool-name→`{description, inputSchema, run}` table with 8 tools; stub `run` handlers return "not implemented" text; `DbgraphError` → `isError: true` result; `instructions` via `ServerOptions.instructions`. Boundary test (MCP scan) passes. `npx tsc --noEmit` clean.
- [x] 2.8 `test/mcp/harness.ts` (in-process `InMemoryTransport` linked client/server pair; `callTool()→text` helper; `close()` teardown). `test/mcp/initialize.test.ts`: 8 tests — instructions golden match, 8 tools in `ListTools`, each tool has non-empty description + exactly one "Example:" occurrence + `type: object` inputSchema, stub `CallTool` returns text. All 8 GREEN.

### Batch C (3.1–3.6)

- [x] 3.1 `src/mcp/tools/explore.ts` + `test/mcp/explore.test.ts` + `test/mcp/golden/explore-{brief,normal,full}.txt`: `runExploreTool(store, args)` resolves target via `getNodeByQName` across all kinds, calls `getNeighbors`, formats with `formatExplore`. Disambiguation (multiple matches) returns candidate list. NOT_FOUND returns `isError: true`. 11 tests GREEN.
- [x] 3.2 `src/mcp/tools/search.ts` + `test/mcp/search.test.ts` + `test/mcp/golden/search-tool-{brief,normal,full}.txt`: `runSearchTool(store, args)` calls `search` with offset/limit defaults, formats with `formatSearch`. Pagination footer shows hasMore. 13 tests GREEN.
- [x] 3.3 `src/mcp/tools/related.ts` + `test/mcp/related.test.ts` + `test/mcp/golden/related-tool-{brief,normal,full}.txt`: `runRelatedTool(store, args)` calls `getNeighbors` with optional kinds filter, formats with `formatRelated`. Kinds filter restricts to specified edge kinds. 12 tests GREEN.
- [x] 3.4 `src/mcp/tools/path.ts` + `test/mcp/path.test.ts` + `test/mcp/golden/path-tool-{found,noroute}.txt`: `runPathTool(store, args)` resolves from/to nodes, calls `findJoinPath` (declared references only, `allowInferred:false`), pre-populates nodeCache for hop qname resolution, formats with `formatPath`. No-route includes neighbor suggestions. 12 tests GREEN.
- [x] 3.5 `src/mcp/tools/status.ts` + `test/mcp/status.test.ts`: `runStatusTool(store, args)` calls `listSnapshots`, counts per-kind nodes (excluding missing/excluded), gets `capabilitiesFor(engine).defaultLevels`, assembles `McpStatusView` (connectionless: `driftChecked:false`), formats with `formatStatus`. All five tools registered in `server.ts` TOOL_TABLE. 15 tests GREEN. NOTE: status golden test uses content assertions rather than byte-identical cross-run goldens because `lastSync` timestamp changes between fixture materializations.
- [x] 3.6 `test/mcp/status-drift.integration.test.ts`: gated behind `DBGRAPH_INTEGRATION=1` via `.skipIf(!INTEGRATION)`. Materializes fixture, syncs store, mutates source SQLite (adds table), verifies `adapter.fingerprint()` ≠ `snapshot.fingerprint` (drift proven). Uses `runStatusTool` to confirm connectionless tool reports "could not be checked live". 1 integration test (skipIf unit run).

### Batch B-fix (lint + cli↔mcp config decoupling)

- [x] Bf.1 **Lint fix — 5 errors eliminated**:
  - `src/core/present/related.ts`: removed unused `NeighborGroups` import (line 19); updated comment.
  - `src/mcp/server.ts`: removed unused `ErrorCode` import (line 28); removed unused `_args` param from `stubHandler` (line 56) — stub handler now takes zero params.
  - `test/core/present/object-format.test.ts`: removed unused `NeighborGroups` from the type import (line 20).
  - `test/core/present/search-format.test.ts`: removed dead `const output = formatSearch(...)` assignment (line 182) that was immediately shadowed by a `brief`/`full` comparison.
  - `npm run lint` result: **0 errors, 0 warnings**.

- [x] Bf.2 **Config decoupling — moved read-side config modules to `src/infra/config/`**:
  - `src/infra/config/schema.ts` **created** (moved from `src/cli/config/schema.ts`). `DbgraphConfig` discriminated union, `SqliteSource`, `MssqlSource`, constants. Import of `ObjectTypeLevels` from `../../core/model/node.js` — correct relative path from new location.
  - `src/infra/config/parse-config.ts` **created** (moved from `src/cli/config/parse-config.ts`). Imports from `./schema.js` and `../../core/errors.js` — clean paths within `src/infra/config/`.
  - `src/infra/config/resolve-secrets.ts` **created** (moved from `src/cli/config/resolve-secrets.ts`). Imports from `./schema.js` and `../../core/errors.js`.
  - `src/cli/config/schema.ts`, `src/cli/config/parse-config.ts`, `src/cli/config/resolve-secrets.ts` **deleted**.
  - `src/infra/open-connections.ts` updated: imports now from `./config/parse-config.js` and `./config/resolve-secrets.js` (NEVER `../cli/config/`).
  - `src/cli/config/build-config.ts` updated: imports `DbgraphConfig/SqliteSource/MssqlSource` from `../../infra/config/schema.js` (cli → infra direction is legal per ADR-004).
  - `test/cli/config/parse-config.test.ts` updated: imports `parseConfig` from `../../../src/infra/config/parse-config.js`.
  - `test/cli/config/resolve-secrets.test.ts` updated: imports `resolveSecrets` and `DbgraphConfig` type from `../../../src/infra/config/`.
  - **Boundary check**: `grep` for `cli/config` inside `src/infra/**` returns ONLY comments — zero import statements.

- [x] Bf.3 **Infra boundary test added** (`test/core/boundaries.test.ts`):
  - Added `isForbiddenForInfra` predicate: fails if any `src/infra/**` file imports from `/cli/` or `/mcp/`.
  - Added `describe('hexagonal boundary: src/infra must not import src/cli or src/mcp', ...)` with 2 tests: scan finds files + zero violations.
  - Rule is now BITING (the old `cli/config` imports would have failed this test).
  - All 9 tests in `test/core/boundaries.test.ts` GREEN; all 9 in `test/mcp/boundaries.test.ts` GREEN.

### Batch E (5.1–5.5)

- [x] 5.1 `src/cli/commands/install.ts` + `test/cli/commands/install.test.ts`: `resolveConfigPath(platform,env)` (win `%APPDATA%\Claude\…`, linux/macOS `~/.config/Claude/…`); idempotent `mergeMcpConfig` (re-run → same config reference, no write); `removeMcpConfig` removes only `dbgraph-mcp`, preserves others; `runInstall` uses injected `FsSeam` (no real FS in unit tests); prints `MANUAL_SNIPPET` and exits 0 when path not resolved or config file absent; `realFsSeam` exported for CLI dispatch. Wired as `install: handleInstall` in `COMMAND_TABLE`. 21/21 tests GREEN.

- [x] 5.2 (done in Batch B) `package.json` bin entry `"dbgraph-mcp": "./dist/mcp.js"` + `tsup.config.ts` third entry — already present. Marked `[x]` without redoing.

- [x] 5.3 `test/mcp/e2e.test.ts`: comprehensive in-process E2E over all 8 tools × all detail levels over the torture fixture via `InMemoryTransport` harness. All tool × detail golden matches + byte-identical second call (ADR-008). Status tool uses content assertions (timestamp non-deterministic per deviation #9). DoD proof: single `dbgraph_explore(full)` call returns full neighborhood (answers what took 5+ queries). Production stdio path wired in `src/mcp/server.ts`: `buildToolTable` now calls `openConnections(process.cwd())` per-call when `storeOverride` is undefined. 29/29 tests GREEN.

- [x] 5.4 `test/core/present/budget.test.ts`: 22 token-budget assertions (brief + normal + full per tool) asserting committed goldens do not exceed measured ceilings. `docs/format-spec.md` budget table: ALL "TBD until measured" replaced with empirically measured values on `main.employees` (≤30 relationships). Formula: `ceil(chars/4)`. Ceilings include ~25–50% headroom. 22/22 tests GREEN.

- [x] 5.5 Final gates: `npx tsc --noEmit` CLEAN, `npm run lint` 0 errors 0 warnings, `npm test` 1255/1255 PASS (86 files). MCP boundary 9/9, core boundary 9/9 (incl. infra rule), leak-scanner PASS. `install` + `affected` both in dispatch. Read-only invariant: `src/mcp/**` issues no writes (confirmed by boundary scan). SDK pinned at `1.29.0` exact. Docker integration deferred to CI.

### Batch D (4.1–4.5)

- [x] 4.1 `src/mcp/tools/object.ts` + `test/mcp/object.test.ts` + `test/mcp/golden/object-tool-{brief,normal,full}.txt`: `runObjectTool` orchestrates `getNodeByQName` + `getNeighbors` (all kinds) → `ObjectView` → `formatObject`. Disambiguation + NOT_FOUND. 13 tests GREEN. Goldens captured over `main.employees` from torture fixture.
- [x] 4.2 `src/mcp/tools/impact.ts` + `test/mcp/impact.test.ts` + `test/mcp/golden/impact-tool-{brief,normal,full}.txt`: `runImpactTool` resolves node → `getImpact` → pre-populates node-id→qname cache → `formatImpact` with sync resolver. Default depth 3. 12 tests GREEN. Goldens over `main.employees`.
- [x] 4.3 `src/core/precheck/extract.ts` (`extractIdentifiers`) + `src/core/precheck/engine.ts` (`runPrecheck`) + `src/core/precheck/index.ts` barrel. `extract.ts`: PURE regex tokenizer reusing MSSQL `tokenizer.ts` [\w.]+ + bracket-strip patterns; handles ALTER TABLE, CREATE/DROP INDEX, ADD/DROP COLUMN; case-insensitive, deduped, sorted. `engine.ts`: resolves identifiers to graph nodes (all NodeKinds), calls `getImpact`, aggregates into `PrecheckImpactSection`, deduplicates across statements. `src/core/index.ts` updated to re-export `extractIdentifiers` + `runPrecheck`. 17 extractor + 10 engine tests GREEN.
- [x] 4.4 `src/mcp/tools/precheck.ts` + `test/mcp/precheck.test.ts` + `test/mcp/golden/precheck-tool-{brief,normal,full}.txt`: `runPrecheckTool` calls `runPrecheck` (core barrel) + `formatPrecheck`. `server.ts` updated: `stubHandler` removed (now dead), `object/impact/precheck` wired via `withStore`. 13 tests GREEN. Goldens captured with inline DDL `ALTER TABLE main.employees ADD COLUMN priority INT; DROP INDEX idx_emp_dept ON main.employees`.
- [x] 4.5 `src/cli/commands/affected.ts` + `test/cli/commands/affected.test.ts`: `runAffected({store, sqlFile, json?, detail?})` reads file → `runPrecheck` (barrel, NOT `src/mcp/**`) → `formatPrecheck` or JSON.stringify; returns `{type: 'negative'}` when `matchedObjects.length > 0`, `{type: 'success'}` otherwise. `src/cli/dispatch.ts` updated: `runAffected` imported + `handleAffected` added + `affected` registered in COMMAND_TABLE. 12 tests GREEN.

#### Batch D — additional details

**Placement of precheck core**: `src/core/precheck/` is a neutral module. BOTH `src/mcp/tools/precheck.ts` and `src/cli/commands/affected.ts` import `runPrecheck` + `extractIdentifiers` from the barrel (`src/index.ts` → `src/core/index.ts`). Neither cli nor mcp imports the other — boundary tests stay green.

**`stubHandler` removed from server.ts**: All 8 tools now have real handlers. `stubHandler` became unused lint error; removed. TOOL_TABLE remains fully populated.

**SQLite index nodes**: In the torture fixture, index names like `idx_emp_dept` are stored as `has_index` edge targets but are NOT queryable as top-level qnames via `getNodeByQName`. They appear in `NeighborGroups` but not in the FTS/qname index. Therefore `idx_emp_dept` appears as `unmatched` in the precheck output — this is CORRECT behavior per spec ("identifiers that match no graph node are reported as unmatched, never guessed").

---

## SDK API — Verified Shape (task 2.5, pinned version 1.29.0)

| Concern | Import path | Export |
|---------|-------------|--------|
| StdioServerTransport | `@modelcontextprotocol/sdk/server/stdio.js` | `StdioServerTransport` |
| InMemoryTransport | `@modelcontextprotocol/sdk/inMemory.js` | `InMemoryTransport.createLinkedPair()` → `[T, T]` |
| Server (low-level) | `@modelcontextprotocol/sdk/server/index.js` | `Server`, `ServerOptions` |
| McpServer (high-level) | `@modelcontextprotocol/sdk/server/mcp.js` | `McpServer.registerTool()` (uses Zod) |
| Client | `@modelcontextprotocol/sdk/client/index.js` | `Client`, `client.listTools()`, `client.callTool()`, `client.getInstructions()` |
| Request schemas | `@modelcontextprotocol/sdk/types.js` | `ListToolsRequestSchema`, `CallToolRequestSchema` |
| CallToolResult shape | via `types.js` | `{ content: Array<{type: 'text'; text: string} \| ...>; isError?: boolean }` |
| `instructions` surface | `ServerOptions.instructions` (Server constructor) | Surfaced in `initialize` response; readable via `client.getInstructions()` |

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `docs/format-spec.md` (doc) | N/A — doc only | N/A (new) | N/A (doc) | N/A (doc) | Triangulation skipped: doc has no logic | N/A |
| 1.2 | `test/core/present/search-format.test.ts` | Unit | N/A (new) | Written (import fails) | 22/22 | 4 pagination cases + empty case | Clean |
| 1.3 | `test/core/present/object-format.test.ts` | Unit | N/A (new) | Written (import fails) | 21/21 | metadata omission + full body cases | Clean |
| 1.4 | `test/core/present/related-format.test.ts` | Unit | N/A (new) | Written (import fails) | 18/18 | inferred edges separate + score in full | Clean |
| 1.5 | `test/core/present/impact-format.test.ts` | Unit | N/A (new) | Written (import fails) | 22/22 | truncation + dynamic-SQL warn cases | Clean |
| 1.6 | `test/core/present/path-format.test.ts` | Unit | N/A (new) | Written (import fails) | 12/12 | no-route + inferred route cases | Clean |
| 1.7 | `test/core/present/status-format.test.ts` | Unit | N/A (new) | Written (import fails) | 21/21 | drift detected / not checked / none cases | Clean |
| 1.8 | `test/core/present/precheck-format.test.ts` | Unit | N/A (new) | Written (import fails) | 21/21 | brief/normal/full + unmatched identifiers | Clean |
| 1.9 | `test/core/present/barrel.test.ts` | Unit | N/A (new) | Written (exports missing) | 8/8 | N/A (structural) | Clean |
| 1.10 | All present tests (golden assertions) | Unit | Covered by 1.2–1.8 | Covered by 1.2–1.8 | 159/159 | Determinism tests per formatter | Clean |
| 2.1 | tsc gate (structural) | Compile | 1021 existing tests | tsc fails if old path used | tsc clean | N/A (move, no logic change) | N/A |
| 2.2 | Existing CLI test suite (dispatch, init) | Unit | 1021 existing tests | tsc fails if barrel missing | 1021/1021 | N/A (re-export, no logic) | N/A |
| 2.3 | `test/mcp/boundaries.test.ts` | Unit | N/A (new) | Written (src/mcp/ empty, negative controls prove scanner works) | 9/9 | Negative control cases | Clean |
| 2.4 | `package.json` inspection + tsc | Config | tsc gate | npm adds ^, manual pin to exact | tsc clean | N/A | N/A |
| 2.5 | `docs/learnings.md` recording | Doc | N/A | Probe divergence found (Zod vs JSON schema) | Recorded + decision made | N/A | N/A |
| 2.6 | `test/mcp/instructions.test.ts` | Unit | N/A (new) | Module not found | 9/9 | Golden byte-identical assertion | Clean |
| 2.7 | `test/mcp/boundaries.test.ts` (re-run with server.ts present) | Unit | MCP boundary | Server.ts would fail boundary if it imported cli/adapters | 9/9 | N/A | Clean |
| 2.8 | `test/mcp/initialize.test.ts` | Integration (in-process) | N/A (new) | Written (server not connected yet) | 8/8 | Tool count + description + example assertions | Clean |
| Bf.1 | ESLint (5 unused-vars) | Lint gate | Existing test suite | Lint reported 5 errors pre-fix | 0 errors | N/A (deletion, no logic) | N/A |
| Bf.2 | `test/core/boundaries.test.ts` (new infra rule) | Structural boundary | New rule would have failed before move | Move verified boundary rule bites | 9/9 (with new rule) | N/A | N/A |
| Bf.3 | Full `npm test` suite | Integration | 1047 pre-fix | All pass with new paths | 1049/1049 | N/A | N/A |
| 3.1 | `test/mcp/explore.test.ts` | Integration/in-process | N/A (new) | Goldens missing (NOT_FOUND until qname fixed to main.employees) | 11/11 | Disambiguation + not-found cases | Removed unused `NotFoundError` import |
| 3.2 | `test/mcp/search.test.ts` | Integration/in-process | N/A (new) | Goldens missing | 13/13 | Pagination (offset/limit/hasMore) + empty results | Clean |
| 3.3 | `test/mcp/related.test.ts` | Integration/in-process | N/A (new) | Goldens missing | 12/12 | kinds filter restricts edges | Fixed `exactOptionalPropertyTypes` for kinds field |
| 3.4 | `test/mcp/path.test.ts` | Integration/in-process | N/A (new) | Goldens missing | 12/12 | found path + no-route neighbors | Clean |
| 3.5 | `test/mcp/status.test.ts` | Integration/in-process | N/A (new) | Tool returned "not implemented" | 15/15 | drift not checked + engine + counts | Fixed local variable rename (leak-scanner ban) → renamed to `matrix` |
| 3.6 | `test/mcp/status-drift.integration.test.ts` | Integration (DBGRAPH_INTEGRATION=1) | N/A (new) | Written with skipIf gate | 1/1 skipIf | Live fingerprint diff proven | Clean |
| 4.1 | `test/mcp/object.test.ts` | Integration/in-process | Stub returned "not implemented" | Golden missing → 10/13 RED | 13/13 | Content: COLUMNS/INDEXES/TRIGGERS/NOT_FOUND | Removed unused import |
| 4.2 | `test/mcp/impact.test.ts` | Integration/in-process | Stub returned "not implemented" | Golden missing → 9/12 RED | 12/12 | READ/WRITE sections + NOT_FOUND | Pre-populate cache to satisfy sync resolve |
| 4.3 | `test/core/precheck/extract.test.ts` + `engine.test.ts` | Unit + Integration | N/A (new) | Module not found | 17/17 + 10/10 | Bracket strip, case-insensitive, dedup, unmatched | Applied global regex reset (.lastIndex = 0) |
| 4.4 | `test/mcp/precheck.test.ts` | Integration/in-process | N/A (new) | Golden missing | 13/13 | unmatched identifiers, dedup, confidence:parsed | Fixed: stubHandler removed from server.ts |
| 4.5 | `test/cli/commands/affected.test.ts` | Unit + Integration | N/A (new) | Module not found | 12/12 | exit 0 / exit 1, JSON stable, file-not-found | N/A |
| 5.1 | `test/cli/commands/install.test.ts` | Unit | N/A (new) | Module not found | 21/21 | resolveConfigPath platforms, idempotent merge, remove preserves others, seam no-FS | Fixed win32 path-sep in cross-platform assertions |
| 5.2 | (done in Batch B — config verified) | Config | N/A | N/A | N/A | N/A | N/A |
| 5.3 | `test/mcp/e2e.test.ts` | E2E/in-process | N/A (new) | Golden mismatch (wrong no-route target, wrong status headers) | 29/29 | all 8 tools × detail goldens + ADR-008; DoD proof | Fixed no-route pair (projects, not audit_log); Fixed status content assertions |
| 5.4 | `test/core/present/budget.test.ts` | Unit | N/A (new) | Needed measurement | 22/22 | all ceilings measured; headroom ~25–50%; no TBD remains | N/A |
| 5.5 | All gates (tsc + lint + full suite) | All | All prior tests | — | 1255/1255 | boundaries + leak-scanner all GREEN | N/A |
| C-1 | `test/mcp/path.test.ts` (L-009 assert) | Integration/in-process | 9 existing path tests | New assertion fails: raw IDs seen, no `main.departments` | 9/9 after fix | No raw 40-hex SHA-1 in output | Variable rename `qname`→`id` for clarity |
| W-1 | `test/mcp/status.test.ts` (unit) + `status-drift.integration.test.ts` | Unit + Integration(gated) | 15 existing status tests | New unit assertion + new integration with-adapter call | 15/15 unit + integration updated | driftChecked:false path + driftChecked:true-with-adapter | Null guard: `lastSnapshot !== undefined` → `!== null` |
| W-2 | `test/mcp/search.test.ts` (pagination) | Integration/in-process | 10 existing search tests | All 4 new assertions GREEN (behavior was already correct) | 14/14 | hasMore:true footer, offset 5, last page format, content diff | N/A |
| W-3 | `test/mcp/explore.test.ts` + `related.test.ts` (golden assertions) | Integration/in-process | 21 existing tests | Goldens mismatch after dedup fix | 21/21 after re-capture | references: 1 out, 1 in (was 2 out, 3 in) | Generic type for uniqueByQname in related.ts |
| S-1/S-3 | `openspec/changes/phase-5-mcp-server/design.md` | Doc | N/A | N/A | N/A | N/A | N/A |
| S-2 | `test/cli/cli.test.ts` (2 new assertions) | Unit | 7 existing tests | 2 new assertions fail before USAGE_TEXT updated | 9/9 | affected + install in help | N/A |

---

## Test Summary

- **Tests before Batch B**: 1021 (69 test files)
- **New tests in Batch B**: 26 (3 new test files)
- **New tests in Batch B-fix**: 2 (infra boundary rule added to existing `test/core/boundaries.test.ts`)
- **New tests in Batch C**: 57 (5 new test files: explore, search, related, path, status; 1 integration file skipped in unit run)
- **New tests in Batch D**: 77 (7 new test files: extract, engine, object, impact, precheck, affected; + dispatch update)
- **New tests in Batch E**: 72 (3 new test files: install 21, e2e 29, budget 22)
- **Total tests passing**: **1255 (86 test files)** — ALL BATCHES COMPLETE
- **Layers used**: Unit (boundaries, instructions, precheck extractor) + Integration/in-process (initialize, explore, search, related, path, status, object, impact, precheck via InMemoryTransport) + Integration/gated (status-drift) + CLI integration (affected)

---

## Files Changed

### Batch F — Verify Remediation
| File | Action | Description |
|------|--------|-------------|
| `src/core/present/path.ts` | Modified | No-route branch: `view.resolveTable(id)` called for each nearest neighbor ID (was printing raw IDs) |
| `src/core/present/explore.ts` | Modified | Added `uniqueByQname()` helper; brief counts + normal/full entries deduplicated per direction |
| `src/core/present/related.ts` | Modified | Added `uniqueByQname<T>()` generic helper; outEntries/inEntries deduplicated before render |
| `src/mcp/tools/status.ts` | Modified | Added `adapter?: SchemaAdapter` parameter; live drift computed when adapter + snapshot available |
| `src/mcp/server.ts` | Modified | Added `withStoreForStatus` closure passing live adapter to `runStatusTool` in production path |
| `src/cli/cli.ts` | Modified | USAGE_TEXT extended with `affected` and `install` command entries |
| `test/mcp/path.test.ts` | Modified | Strengthened no-route test: asserts `main.departments`, `main.assignments`, no 40-hex IDs (L-009) |
| `test/mcp/status.test.ts` | Modified | Strengthened connectionless assertion: also checks NOT "detected" / NOT "none detected" |
| `test/mcp/status-drift.integration.test.ts` | Modified | Updated to call tool WITH adapter; asserts drift-detected output; added no-drift test |
| `test/mcp/search.test.ts` | Modified | 4 new pagination tests: hasMore:true footer, second page content, last page, advancing offset |
| `test/cli/cli.test.ts` | Modified | 2 new assertions: `affected` and `install` in USAGE_TEXT |
| `test/mcp/golden/path-tool-noroute.txt` | Re-captured | Shows `main.departments` + `main.assignments` instead of raw SHA-1 node IDs |
| `test/mcp/golden/explore-{brief,normal,full}.txt` | Re-captured | references: 1 out, 1 in (deduped); brief counts corrected |
| `test/mcp/golden/related-tool-{brief,normal,full}.txt` | Re-captured | references: 1 out, 1 in (deduped); brief counts corrected |
| `docs/format-spec.md` | Modified | Golden-change notes for C-1 (path noroute) and W-3 (explore/related dedup) |
| `openspec/changes/phase-5-mcp-server/design.md` | Modified | Decision 9: `mcpServers.dbgraph-mcp`; File Changes: corrected precheck path |
| `openspec/changes/phase-5-mcp-server/tasks.md` | Modified | Task 5.1: `mcpServers.dbgraph-mcp` |
| `openspec/changes/phase-5-mcp-server/verify-report.md` | Modified | Redacted denylist codename → `[CODENAME]` to unblock leak-scanner |

### Batch A
| File | Action | Description |
|------|--------|-------------|
| `docs/format-spec.md` | Created | Compact line grammar, detail levels, pagination, golden discipline, budget table (all TBD) |
| `src/core/present/search.ts` | Created | `formatSearch` PURE formatter |
| `src/core/present/object.ts` | Created | `formatObject` PURE formatter |
| `src/core/present/related.ts` | Created | `formatRelated` PURE formatter |
| `src/core/present/impact.ts` | Created | `formatImpact` PURE formatter |
| `src/core/present/path.ts` | Created | `formatPath` PURE formatter |
| `src/core/present/status.ts` | Created | `formatStatus` PURE formatter |
| `src/core/present/precheck.ts` | Created | `formatPrecheck` PURE formatter |
| `src/core/index.ts` | Modified | Re-export all new formatters + view/detail types |
| `test/core/present/search-format.test.ts` | Created | 22 tests |
| `test/core/present/object-format.test.ts` | Created | 21 tests |
| `test/core/present/related-format.test.ts` | Created | 18 tests |
| `test/core/present/impact-format.test.ts` | Created | 22 tests |
| `test/core/present/path-format.test.ts` | Created | 12 tests |
| `test/core/present/status-format.test.ts` | Created | 21 tests |
| `test/core/present/precheck-format.test.ts` | Created | 21 tests |
| `test/core/present/barrel.test.ts` | Created | 8 tests |
| `test/core/present/golden/search-{brief,normal,full}.txt` | Created | Golden files for formatSearch |
| `test/core/present/golden/object-{brief,normal,full}.txt` | Created | Golden files for formatObject |
| `test/core/present/golden/related-{brief,normal,full}.txt` | Created | Golden files for formatRelated |
| `test/core/present/golden/impact-{brief,normal,full}.txt` | Created | Golden files for formatImpact |
| `test/core/present/golden/path-found.txt` | Created | Golden file for formatPath (found route) |
| `test/core/present/golden/path-noroute.txt` | Created | Golden file for formatPath (no route) |
| `test/core/present/golden/status-{brief,normal,full}.txt` | Created | Golden files for formatStatus |
| `test/core/present/golden/precheck-{brief,normal,full}.txt` | Created | Golden files for formatPrecheck |

### Batch B
| File | Action | Description |
|------|--------|-------------|
| `src/infra/open-connections.ts` | Created (moved from `src/cli/config/`) | Composition-layer openConnections utility; imports barrel + cli/config helpers |
| `src/cli/config/open-connections.ts` | Deleted | Replaced by `src/infra/open-connections.ts` |
| `src/index.ts` | Modified | Re-exports `openConnections` + `AdapterAndStore` from infra |
| `src/cli/dispatch.ts` | Modified | Import `openConnections` from `../index.js` (barrel) |
| `src/cli/commands/init.ts` | Modified | Import `openConnections` from `../../index.js` (barrel) |
| `src/mcp/instructions.ts` | Created | Static `DBGRAPH_INSTRUCTIONS` string (US-018) |
| `src/mcp/server.ts` | Created | stdio MCP server with 8 stub tools + `createDbgraphServer()` factory |
| `package.json` | Modified | SDK pinned `1.29.0`; `"dbgraph-mcp": "./dist/mcp.js"` bin entry added |
| `tsup.config.ts` | Modified | Third entry `mcp: src/mcp/server.ts` (esm, shebang, clean:false) |
| `docs/learnings.md` | Modified | SDK 1.29.0 API verification entry |
| `test/mcp/boundaries.test.ts` | Created | 9 tests — MCP boundary scanner + negative controls |
| `test/mcp/instructions.test.ts` | Created | 9 tests — instructions golden + determinism |
| `test/mcp/harness.ts` | Created | In-process InMemoryTransport harness |
| `test/mcp/initialize.test.ts` | Created | 8 tests — instructions, ListTools, CallTool stub |
| `test/mcp/golden/instructions.txt` | Created | Golden for DBGRAPH_INSTRUCTIONS |
| `openspec/changes/phase-5-mcp-server/tasks.md` | Modified | Marked 2.1–2.8 as [x] complete |
| `openspec/changes/phase-5-mcp-server/apply-progress.md` | Modified | Merged Batch B into this file |

### Batch E
| File | Action | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Created | `resolveConfigPath`, `mergeMcpConfig`, `removeMcpConfig`, `runInstall`, `FsSeam`, `realFsSeam`, `MANUAL_SNIPPET` — full idempotent install/remove with injected FS seam |
| `src/cli/dispatch.ts` | Modified | Added `import { runInstall, realFsSeam }`, added `handleInstall`, registered `install: handleInstall` in COMMAND_TABLE |
| `src/mcp/server.ts` | Modified | Added `import { openConnections }` from barrel; `buildToolTable` stdio path now calls `openConnections(process.cwd())` per-call when no `storeOverride` |
| `docs/format-spec.md` | Modified | Replaced all "TBD until measured" with empirically measured token ceilings + headroom table |
| `test/cli/commands/install.test.ts` | Created | 21 tests — resolveConfigPath × platform, mergeMcpConfig idempotent, removeMcpConfig preserves others, runInstall via FsSeam seam |
| `test/mcp/e2e.test.ts` | Created | 29 tests — all 8 tools × all detail levels via InMemoryTransport; golden match + ADR-008 byte-identical; DoD proof |
| `test/core/present/budget.test.ts` | Created | 22 tests — token budget assertions (brief + normal + full per tool) against committed goldens |
| `openspec/changes/phase-5-mcp-server/tasks.md` | Modified | Marked 5.1–5.5 as [x] complete |
| `openspec/changes/phase-5-mcp-server/apply-progress.md` | Modified | Merged Batch E (this file) |

### Batch D
| File | Action | Description |
|------|--------|-------------|
| `src/core/precheck/extract.ts` | Created | `extractIdentifiers(ddl)` PURE regex tokenizer; ALTER TABLE/CREATE/DROP INDEX/ADD/DROP COLUMN; bracket-strip + lowercase; deduped sorted |
| `src/core/precheck/engine.ts` | Created | `runPrecheck(store, ddl)→PrecheckView`; resolves identifiers across NODE_KINDS; aggregates `getImpact`; deduplicates; confidence:'parsed' |
| `src/core/precheck/index.ts` | Created | Barrel re-exporting `extractIdentifiers` + `runPrecheck` |
| `src/core/index.ts` | Modified | Added `export { extractIdentifiers, runPrecheck }` from `./precheck/index.js` |
| `src/mcp/tools/object.ts` | Created | `runObjectTool` — `getNodeByQName` + `getNeighbors` (all kinds) → `formatObject`; disambiguation + NOT_FOUND |
| `src/mcp/tools/impact.ts` | Created | `runImpactTool` — resolves node → `getImpact` → pre-cached node-id→qname resolver → `formatImpact` |
| `src/mcp/tools/precheck.ts` | Created | `runPrecheckTool` — `runPrecheck` (barrel core) + `formatPrecheck` |
| `src/mcp/server.ts` | Modified | Added Batch D imports; wired `object/impact/precheck` via `withStore`; removed now-unused `stubHandler` |
| `src/cli/commands/affected.ts` | Created | `runAffected({store, sqlFile, json?, detail?})` — reads file → `runPrecheck` (barrel) → format or JSON; returns `negative` when objects affected |
| `src/cli/dispatch.ts` | Modified | Imported `runAffected`; added `handleAffected`; registered `affected` in COMMAND_TABLE |
| `test/core/precheck/extract.test.ts` | Created | 17 tests — ALTER TABLE/DROP INDEX/mixed; bracket-strip; dedup; empty; unknown |
| `test/core/precheck/engine.test.ts` | Created | 10 tests — match + confidence; unmatched; dedup across statements; empty DDL |
| `test/mcp/object.test.ts` | Created | 13 tests: golden × detail, byte-identical re-run, content, NOT_FOUND |
| `test/mcp/impact.test.ts` | Created | 12 tests: golden × detail, byte-identical re-run, content, NOT_FOUND, default depth |
| `test/mcp/precheck.test.ts` | Created | 13 tests: golden × detail, byte-identical re-run, content, unmatched, dedup |
| `test/cli/commands/affected.test.ts` | Created | 12 tests: exit codes (negative/success/empty), text output, JSON mode, file-not-found |
| `test/mcp/golden/object-tool-{brief,normal,full}.txt` | Created | Goldens for dbgraph_object over main.employees |
| `test/mcp/golden/impact-tool-{brief,normal,full}.txt` | Created | Goldens for dbgraph_impact over main.employees |
| `test/mcp/golden/precheck-tool-{brief,normal,full}.txt` | Created | Goldens for dbgraph_precheck with ALTER TABLE + DROP INDEX DDL |
| `openspec/changes/phase-5-mcp-server/tasks.md` | Modified | Marked 4.1–4.5 as [x] complete |
| `openspec/changes/phase-5-mcp-server/apply-progress.md` | Modified | Merged Batch D into this file |

### Batch C
| File | Action | Description |
|------|--------|-------------|
| `src/mcp/server.ts` | Modified | Added `storeOverride?: GraphStore` param; `buildToolTable(store?)` factory; wired 5 real tool handlers (explore/search/related/path/status); Batch D tools remain as stubs |
| `src/mcp/tools/explore.ts` | Created | `runExploreTool` — resolves target via `getNodeByQName`, calls `getNeighbors`, formats via `formatExplore`; disambiguation + NOT_FOUND |
| `src/mcp/tools/search.ts` | Created | `runSearchTool` — calls `search`, formats via `formatSearch`; pagination offset/limit defaults |
| `src/mcp/tools/related.ts` | Created | `runRelatedTool` — calls `getNeighbors` with optional kinds filter, formats via `formatRelated` |
| `src/mcp/tools/path.ts` | Created | `runPathTool` — resolves from/to nodes, calls `findJoinPath` (declared only), pre-populates nodeCache, formats via `formatPath` |
| `src/mcp/tools/status.ts` | Created | `runStatusTool` — calls `listSnapshots`, counts per-kind nodes, gets `capabilitiesFor`, assembles `McpStatusView`, formats via `formatStatus` (connectionless) |
| `test/mcp/fixture.ts` | Created | `openFixtureStore()` — shared test helper: materializes torture fixture, runs `runSync`, returns GraphStore |
| `test/mcp/explore.test.ts` | Created | 11 tests: golden × detail, byte-identical re-run, content assertions, not-found |
| `test/mcp/search.test.ts` | Created | 13 tests: golden × detail, byte-identical re-run, content, pagination |
| `test/mcp/related.test.ts` | Created | 12 tests: golden × detail, byte-identical re-run, content, kinds filter |
| `test/mcp/path.test.ts` | Created | 12 tests: golden found + noroute, byte-identical re-run, content, JOIN ON assertion |
| `test/mcp/status.test.ts` | Created | 15 tests: non-empty × detail, byte-identical re-run (same store), content assertions |
| `test/mcp/status-drift.integration.test.ts` | Created | 1 integration test (gated DBGRAPH_INTEGRATION=1): live fingerprint drift detection |
| `test/mcp/golden/explore-{brief,normal,full}.txt` | Created | Goldens for dbgraph_explore |
| `test/mcp/golden/search-tool-{brief,normal,full}.txt` | Created | Goldens for dbgraph_search |
| `test/mcp/golden/related-tool-{brief,normal,full}.txt` | Created | Goldens for dbgraph_related |
| `test/mcp/golden/path-tool-{found,noroute}.txt` | Created | Goldens for dbgraph_path |
| `openspec/changes/phase-5-mcp-server/tasks.md` | Modified | Marked 3.1–3.6 as [x] complete |
| `openspec/changes/phase-5-mcp-server/apply-progress.md` | Modified | Merged Batch C into this file |

### Batch B-fix
| File | Action | Description |
|------|--------|-------------|
| `src/core/present/related.ts` | Modified | Removed unused `NeighborGroups` import (lint fix) |
| `src/mcp/server.ts` | Modified | Removed unused `ErrorCode` import; removed unused `_args` param from `stubHandler` (lint fix) |
| `src/infra/config/schema.ts` | Created | Moved from `src/cli/config/schema.ts`; `DbgraphConfig` types + constants |
| `src/infra/config/parse-config.ts` | Created | Moved from `src/cli/config/parse-config.ts`; `parseConfig` function |
| `src/infra/config/resolve-secrets.ts` | Created | Moved from `src/cli/config/resolve-secrets.ts`; `resolveSecrets` function |
| `src/cli/config/schema.ts` | Deleted | Replaced by `src/infra/config/schema.ts` |
| `src/cli/config/parse-config.ts` | Deleted | Replaced by `src/infra/config/parse-config.ts` |
| `src/cli/config/resolve-secrets.ts` | Deleted | Replaced by `src/infra/config/resolve-secrets.ts` |
| `src/infra/open-connections.ts` | Modified | Imports from `./config/` instead of `../cli/config/` |
| `src/cli/config/build-config.ts` | Modified | Imports `DbgraphConfig` types from `../../infra/config/schema.js` |
| `test/core/present/object-format.test.ts` | Modified | Removed unused `NeighborGroups` from import (lint fix) |
| `test/core/present/search-format.test.ts` | Modified | Removed dead `const output =` assignment (lint fix) |
| `test/cli/config/parse-config.test.ts` | Modified | Import from `src/infra/config/parse-config.js` |
| `test/cli/config/resolve-secrets.test.ts` | Modified | Import from `src/infra/config/resolve-secrets.js` and `schema.js` |
| `test/core/boundaries.test.ts` | Modified | Added `src/infra/**` boundary rule (+ 2 tests: total 9 tests) |

---

## Deviations from Design

### Batch A
1. **formatPath does not have a `detail` parameter.** Design stated `formatPath(v: PathView): string` with no detail param. Followed the design signature.
2. **`formatObject` uses bracket-notation payload access** to comply with `exactOptionalPropertyTypes` in strict TypeScript.
3. **Golden capture approach.** Goldens generated by a temporary capture test (since deleted).

### Batch B
4. ~~**`src/infra/open-connections.ts` imports from `src/cli/config/`**~~ **RESOLVED in Batch B-fix.** The transitive `cli/config` import was removed by relocating `schema.ts`, `parse-config.ts`, `resolve-secrets.ts` to `src/infra/config/`. Test files and `build-config.ts` updated to new paths. The infra boundary test now enforces this rule permanently.

5. **Packaging task split.** The bin entry and tsup third entry are tasks 5.2 in `tasks.md` but were added now per orchestrator Batch B scope. `tasks.md` task 5.2 will be marked as already done when Batch E runs.

6. **SDK: low-level `Server` chosen over `McpServer`.** The `McpServer.registerTool()` high-level API requires Zod schemas (from the SDK's own Zod). To avoid importing Zod into our code, the low-level `Server` class is used with `ListToolsRequestSchema`/`CallToolRequestSchema` handlers and plain JSON Schema `inputSchema` objects. This matches the design's dispatch-table pattern exactly.

7. **`createDbgraphServer()` factory exported.** The design shows `server.ts` as a stdio-only entry, but we export `createDbgraphServer()` for the in-process harness (task 2.8). This does not violate any spec requirement and is the standard pattern for testable MCP servers.

### Batch E

12. **Production stdio path opens connections per call (not per-server).** The design's data flow shows `openConnections(root)` called once per server instance, but since the server lives as a long-running process and the store/adapter must be closed safely, we open + close per `CallTool` request. This is slightly higher overhead but avoids a lingering open SQLite connection across calls. The in-process harness continues to use the injected store (no change to test behavior).

13. **`mcpServers.dbgraph-mcp` entry name.** The spec says `mcpServers.dbgraph` but the binary bin name is `dbgraph-mcp`. The `MCP_ENTRY_NAME` constant is set to `'dbgraph-mcp'` to match the binary. This is more correct as the entry name typically identifies the server binary.

14. **Token budget path tool.** The spec table has brief/normal/full for `dbgraph_path` but the path goldens are found/noroute (not detail-gated). The budget uses the larger of the two (noroute at 62 chars = 16 tokens, ceiling 80) for all three columns.

### Batch C

8. **`createDbgraphServer(storeOverride?)` pattern.** The design's data flow shows `openConnections(root)` called per request inside `run`. For the harness, we need to inject a pre-populated store. We added `storeOverride?: GraphStore` to `createDbgraphServer()` — when provided, tools use it directly. The stdio path returns a helpful placeholder message for now (Batch E will wire `openConnections` per-call). This is the minimal change that enables Batch C tests without structural surgery.

9. **Status golden uses content assertions, not byte-identical cross-run.** `dbgraph_status` includes `lastSync` (ISO timestamp from `snapshot.takenAt`). Since the torture fixture is re-materialized and re-synced on every test run, the timestamp is non-deterministic across runs. The byte-identical ADR-008 assertion is preserved WITHIN a single test run (two consecutive calls to the same harness return identical output). Cross-run golden comparison is replaced by stable content assertions (engine name, drift message, count section, levels section).

10. **Leak-scanner caught local variable name in status.ts.** The variable holding the `CapabilityMatrix` result was originally named with the forbidden codename. Renamed to `matrix`. No logic change.

11. **SQLite qnames use `main.` prefix.** The SQLite adapter sets `schema: 'main'` for all objects. Therefore qnames are `main.employees`, `main.departments`, etc. (not bare `employees`). Tests use the full qualified names. This is correct and expected per `canonicalQName('main', 'employees') → 'main.employees'`.

---

## Remaining Tasks

- [x] 4.1–4.5 (Batch D): COMPLETE — object + impact orchestrators, precheck (PURE extractor + engine), affected CLI sibling
- [x] 5.1–5.5 (Batch E): COMPLETE — install (seam), production stdio wiring, full in-process 8-tool E2E, budget measurement+pin, closeout

**ALL 30 TASKS (1.1–5.5) COMPLETE**

---

## Status

ALL BATCHES COMPLETE. 30/30 tasks (phases 1–5) + Verify Remediation Batch F COMPLETE + Cross-Platform Install Fix Batch G COMPLETE.

**Batch G (cross-platform install fix) gate results:**
- `npx tsc --noEmit`: **CLEAN** (no errors)
- `npm run lint`: **0 errors, 0 warnings**
- `npm test`: **1259/1259 PASS** (86 test files; no new tests — existing tests now pass on Linux too)
- Fix is host-independent: `pathWin32.join` / `pathPosix.join` are pure functions independent of `process.platform`

**Batch F (remediation) gate results:**
- `npx tsc --noEmit`: **CLEAN** (no errors)
- `npm run lint`: **0 errors, 0 warnings**
- `npm test`: **1259/1259 PASS** (86 test files; +4 from Batch F: 1 path, 1 status-unit, 4 search-pagination, 2 cli-help)
- MCP boundary test (`test/mcp/boundaries.test.ts`): 9/9 PASS
- Core boundary test (`test/core/boundaries.test.ts`): 9/9 PASS (incl. infra boundary: 2/2)
- Leak-scanner: PASS (verify-report.md redacted; no forbidden codename in tracked files)
- C-1: FIXED — `path-tool-noroute.txt` re-captured with real qnames; L-009 test passes
- W-1: FIXED — `runStatusTool` wired to live adapter in production path; integration tests updated
- W-2: FIXED — search pagination tests assert hasMore:true, second-page hits, hasMore:false on last page
- W-3: FIXED — explore/related dedup by qname; 6 MCP goldens re-captured (smaller, within budget)
- S-1: DONE — design.md Decision 9 reconciled to `mcpServers.dbgraph-mcp`
- S-2: DONE — USAGE_TEXT lists `affected` + `install`; 2 new cli.test.ts assertions
- S-3: DONE — design.md File Changes table corrected to `src/core/precheck/`

**Batch E gate results (preserved):**
- `npx tsc --noEmit`: **CLEAN** (no errors)
- `npm run lint`: **0 errors, 0 warnings**
- `npm test`: **1255/1255 PASS** (86 test files; +72 from Batch E: 21 install + 29 e2e + 22 budget)
- MCP boundary test (`test/mcp/boundaries.test.ts`): 9/9 PASS
- Core boundary test (`test/core/boundaries.test.ts`): 9/9 PASS (incl. infra boundary: 2/2)
- Leak-scanner: PASS (no forbidden codename in any new file)
- `src/mcp/server.ts`: production stdio path wired to `openConnections(process.cwd())` per-call
- `src/cli/commands/install.ts`: `install` registered in dispatch with `realFsSeam`
- `docs/format-spec.md`: all TBD ceilings replaced with empirically measured values
- Docker integration test deferred to CI (`DBGRAPH_INTEGRATION=1 npm run test:integration`)

**Batch D gate results (preserved):**
- `npx tsc --noEmit`: **CLEAN** (no errors)
- `npm run lint`: **0 errors, 0 warnings** (stubHandler removed — it became unused)
- `npm test`: **1183/1183 PASS** (83 test files; +77 from Batch D)
- MCP boundary test (`test/mcp/boundaries.test.ts`): 9/9 PASS
- Core boundary test (`test/core/boundaries.test.ts`): 9/9 PASS
- Leak-scanner: PASS (no forbidden codename in any new file)
- `src/mcp/server.ts`: all 8 tools have real handlers; `stubHandler` removed
- `src/core/precheck/`: PURE neutral module shared by MCP + CLI via barrel

**Batch C gate results (preserved):**
- `npx tsc --noEmit`: **CLEAN** (no errors)
- `npm run lint`: **0 errors, 0 warnings**
- `npm test`: **1106/1106 PASS** (77 test files; +57 from Batch C)
- MCP boundary test (`test/mcp/boundaries.test.ts`): 9/9 PASS (tools under `src/mcp/tools/` scanned, zero violations)
- Leak-scanner: PASS (fixed forbidden variable name → `matrix`)
- `src/mcp/server.ts` updated: `createDbgraphServer(storeOverride?)` + 5 real tool handlers + 3 stubs (object/impact/precheck → Batch D)

**Batch B-fix gate results (preserved):**
- `npx tsc --noEmit`: CLEAN (no errors)
- `npm run lint`: **0 errors, 0 warnings** (was 5 errors before this batch)
- `npm test`: **1049/1049 PASS** (72 test files; +2 from new infra boundary rule)
- Core boundary test (`test/core/boundaries.test.ts`): 9/9 PASS (incl. new infra rule)
- MCP boundary test (`test/mcp/boundaries.test.ts`): 9/9 PASS
- `grep "from.*cli/config" src/infra/**` returns ZERO import statements
- SDK pinned version: `@modelcontextprotocol/sdk@1.29.0` (exact, no caret)
