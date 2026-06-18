# Apply Progress — phase-5-mcp-server (Batches A + B + Batch B-fix)

**Change**: phase-5-mcp-server
**Mode**: Strict TDD (RED→GREEN per task)
**Batches completed**: A (tasks 1.1–1.10), B (tasks 2.1–2.8), B-fix (lint + config decoupling)
**Date**: 2026-06-17

---

## Completed Tasks

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

---

## Test Summary

- **Tests before Batch B**: 1021 (69 test files)
- **New tests in Batch B**: 26 (3 new test files)
- **New tests in Batch B-fix**: 2 (infra boundary rule added to existing `test/core/boundaries.test.ts`)
- **Total tests passing**: 1049 (72 test files)
- **Layers used**: Unit (boundaries, instructions) + Integration/in-process (initialize via InMemoryTransport)

---

## Files Changed

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

---

## Remaining Tasks

- [ ] 3.1–3.6 (Batch C): five simple tools (explore/search/related/path/status) each golden-pinned through the harness; status live-drift integration test
- [ ] 4.1–4.5 (Batch D): `object` + `impact` orchestrators, precheck (PURE extractor unit → match → aggregate), `affected` CLI sibling
- [ ] 5.1–5.5 (Batch E): `install`, full in-process 8-tool E2E, budget measurement+pin, lint/typecheck closeout
- [ ] Note: 5.2 packaging (bin + tsup entry) is done; remaining 5.x tasks are install, E2E, budget, closeout

---

## Status

18/18 Batch A + B tasks complete + Batch B-fix (lint + config decoupling) complete. Ready for Batch C.

**Batch B-fix gate results:**
- `npx tsc --noEmit`: CLEAN (no errors)
- `npm run lint`: **0 errors, 0 warnings** (was 5 errors before this batch)
- `npm test`: **1049/1049 PASS** (72 test files; +2 from new infra boundary rule)
- Core boundary test (`test/core/boundaries.test.ts`): 9/9 PASS (incl. new infra rule)
- MCP boundary test (`test/mcp/boundaries.test.ts`): 9/9 PASS
- `grep "from.*cli/config" src/infra/**` returns ZERO import statements
- SDK pinned version: `@modelcontextprotocol/sdk@1.29.0` (exact, no caret)
