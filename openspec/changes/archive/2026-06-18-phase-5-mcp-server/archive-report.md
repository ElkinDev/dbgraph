# Archive Report: phase-5-mcp-server

**Change**: phase-5-mcp-server
**Archived**: 2026-06-18
**Artifact store**: openspec
**Final verdict**: PASS — zero carry-over (0 CRITICAL / 0 WARNING / 0 SUGGESTION)
**Repo context**: All 5 CI jobs green on `main` (matrix ubuntu/windows × 22.x/24.x + `mssql-integration`).
Verify cycle: initial FAIL (C-1 + W-1 + W-2 + W-3 + S-1 + S-2 + S-3) → remediation (Batch F) + cross-platform
install fix (Batch G) → re-verify PASS, 15/15 spec compliance, 1259/1259 tests.

---

## Executive Summary

Phase 5 (MCP server) delivered the AI agent consumption layer for dbgraph: 8 MCP stdio tools via
`@modelcontextprotocol/sdk@1.29.0` (pinned exact), a compact token-budgeted output format authored FIRST
in `docs/format-spec.md`, pure golden-pinned formatters in `src/core/present/`, a zero-dependency
identifier-matching precheck engine in `src/core/precheck/` shared by MCP and CLI, `dbgraph affected`
and `dbgraph install` CLI commands, the `src/infra/` infrastructure layer (config modules + relocated
`openConnections`), and a full in-process `InMemoryTransport` SDK test harness. Token budgets were
measured empirically on the SQLite torture fixture; Phase-6 validation against a real enterprise database
will refine them. The change ran through five apply batches (A–E) plus a lint/config-decoupling fix
batch (B-fix), a verify-remediation batch (F), and a cross-platform install fix batch (G). The change
is now closed.

---

## What Shipped

### Core deliverables

| Path | Description |
|------|-------------|
| `docs/format-spec.md` | Compact line grammar (`name(col TYPE [PK\|FK→ref][NN], …) [Nidx, Ntrg!]`), `brief\|normal\|full` levels, `offset`/`limit`/`hasMore` pagination, golden discipline, empirically measured per-tool/per-`detail` token budget table (US-019) |
| `src/core/present/search.ts` | PURE `formatSearch(SearchView, SearchDetail)` — ranked hits with type+qname, declared total, pagination footer |
| `src/core/present/object.ts` | PURE `formatObject(ObjectView, ObjectDetail)` — columns/PK/FK/indexes/triggers; metadata-level explicitly states body omitted |
| `src/core/present/related.ts` | PURE `formatRelated(ExploreView, RelatedDetail)` — neighbors grouped by edge kind + direction; inferred edges separated; deduplicated by qname to table grain |
| `src/core/present/impact.ts` | PURE `formatImpact(ImpactView, ImpactDetail)` — visible chain a→b→c, READ/WRITE split, truncation + dynamic-SQL warnings |
| `src/core/present/path.ts` | PURE `formatPath(PathView)` — join columns per hop; inferred mark; no-route reports neighbor qnames (zero raw SHA-1 IDs) |
| `src/core/present/status.ts` | PURE `formatStatus(McpStatusView, StatusDetail)` — engine/version, last sync, all three drift states |
| `src/core/present/precheck.ts` | PURE `formatPrecheck(PrecheckView, PrecheckDetail)` — matched objects + impact sections; confidence:parsed tags; unmatched identifiers |
| `src/core/precheck/extract.ts` | PURE `extractIdentifiers(ddl)` — regex tokenizer reusing MSSQL `tokenizer.ts` pattern; ALTER TABLE / CREATE\|DROP INDEX / ADD\|DROP COLUMN; case-insensitive, deduped |
| `src/core/precheck/engine.ts` | `runPrecheck(store, ddl) → PrecheckView` — resolves identifiers, aggregates `getImpact`, deduplicates, tags `confidence:'parsed'` |
| `src/core/precheck/index.ts` | Barrel re-exporting `extractIdentifiers` + `runPrecheck` |
| `src/infra/open-connections.ts` | Relocated from `src/cli/config/` (blocking boundary fix); re-exported via `src/index.ts`; consumed by both CLI and MCP from the barrel |
| `src/infra/config/schema.ts` | `DbgraphConfig` discriminated union + constants (moved from `src/cli/config/`) |
| `src/infra/config/parse-config.ts` | `parseConfig` function (moved from `src/cli/config/`) |
| `src/infra/config/resolve-secrets.ts` | `resolveSecrets` function (moved from `src/cli/config/`) |
| `src/mcp/server.ts` | stdio entry (`#!/usr/bin/env node`, `StdioServerTransport`); `createDbgraphServer(storeOverride?)` factory; 8-tool dispatch table; `DbgraphError`→MCP error map; `initialize` surfaces instructions; `withStoreForStatus` passes live adapter for drift detection |
| `src/mcp/instructions.ts` | Static `DBGRAPH_INSTRUCTIONS` string — explore-vs-search-vs-object + status→explore→precheck flow (US-018) |
| `src/mcp/tools/explore.ts` | `runExploreTool` — `getNodeByQName` + `getNeighbors` + `formatExplore`; disambiguation + NOT_FOUND |
| `src/mcp/tools/search.ts` | `runSearchTool` — `search` + `formatSearch`; pagination offset/limit defaults |
| `src/mcp/tools/related.ts` | `runRelatedTool` — `getNeighbors` with optional kinds filter + `formatRelated` |
| `src/mcp/tools/path.ts` | `runPathTool` — resolves from/to + `findJoinPath` + pre-populated nodeCache for hop qnames + `formatPath` |
| `src/mcp/tools/status.ts` | `runStatusTool(store, args, adapter?)` — connectionless or live-drift path; `listSnapshots` + per-kind counts + `capabilitiesFor` + `formatStatus` |
| `src/mcp/tools/object.ts` | `runObjectTool` — `getNodeByQName` + `getNeighbors` (all kinds) → `ObjectView` → `formatObject`; disambiguation + NOT_FOUND |
| `src/mcp/tools/impact.ts` | `runImpactTool` — resolves node → `getImpact` → pre-cached node-id→qname resolver → `formatImpact`; default depth 3 |
| `src/mcp/tools/precheck.ts` | `runPrecheckTool` — `runPrecheck` (core barrel) + `formatPrecheck` |
| `src/cli/commands/affected.ts` | `runAffected({store, sqlFile, json?, detail?})` — reads file → `runPrecheck` (barrel) → format or JSON; exit 1 when objects affected, 0 when none (US-023) |
| `src/cli/commands/install.ts` | `resolveConfigPath` (host-independent: `pathWin32.join` / `pathPosix.join`); idempotent `mergeMcpConfig` (`mcpServers.dbgraph-mcp`); `removeMcpConfig`; manual-snippet fallback; `FsSeam` injection (US-024) |
| `src/cli/dispatch.ts` | Extended with `affected: handleAffected` + `install: handleInstall` |
| `src/cli/cli.ts` | USAGE_TEXT extended with `affected` and `install` command entries |
| `src/core/index.ts` | Re-exports all new formatters + view/detail types + `extractIdentifiers` + `runPrecheck` |
| `src/index.ts` | Re-exports `openConnections` + `AdapterAndStore` from infra |
| `package.json` | `@modelcontextprotocol/sdk@1.29.0` (pinned exact, no caret); `"dbgraph-mcp": "./dist/mcp.js"` bin entry |
| `tsup.config.ts` | Third entry `mcp: src/mcp/server.ts` (esm, shebang banner, `clean:false`) |

### Test deliverables

86 test files, 1259 tests:

| Layer | Count | Key files |
|-------|-------|-----------|
| Unit — formatters (Batch A) | 159 | search-format, object-format, related-format, impact-format, path-format, status-format, precheck-format, barrel (8 files, 159 tests) |
| Unit — precheck engine (Batch D) | 27 | extract.test.ts (17), engine.test.ts (10) |
| Unit — install (Batch E) | 21 | install.test.ts |
| Unit — budget assertions (Batch E) | 22 | budget.test.ts |
| Structural — boundary (Batch B) | 9 | mcp/boundaries.test.ts (9) |
| Structural — infra boundary (Batch B-fix) | 2 | added to core/boundaries.test.ts |
| Integration/in-process — MCP tools (Batches B–D) | 96 | initialize, explore, search, related, path, status, object, impact, precheck (9 files) |
| E2E/in-process — full 8-tool harness (Batch E) | 29 | e2e.test.ts |
| Integration/gated — status live drift | 1 | status-drift.integration.test.ts (skipIf DBGRAPH_INTEGRATION) |
| CLI — affected (Batch D) | 12 | affected.test.ts |
| Golden files | — | test/mcp/golden/ (22 files) + test/core/present/golden/ (20 files) |
| Pre-existing suites (unchanged) | ~882 | All phases 1–4 tests continue green |
| Total | 1259 | 86 files |

### Gate results (final, re-verify pass)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npx tsc --noEmit` | CLEAN — exit 0, zero errors |
| Lint | `npm run lint` | 0 errors / 0 warnings — exit 0 |
| Unit/E2E tests | `npm test` | 1259/1259 PASS — 86 test files — exit 0 |
| MCP boundary | `vitest run mcp/boundaries` | 9/9 PASS |
| CLI boundary (incl. infra rule) | `vitest run core/boundaries` | 9/9 PASS |
| Integration (gated) | `DBGRAPH_INTEGRATION=1 npm run test:integration` | mssql-integration CI job (SQL Server 2022 container) — GREEN |
| CI matrix | All 5 jobs | GREEN: ubuntu-22.x, ubuntu-24.x, windows-22.x, windows-24.x, mssql-integration |

---

## Apply Batches

### Batch A — Tasks 1.1–1.10 (format spec + pure formatters)

`docs/format-spec.md` authored first (line grammar, detail levels, pagination contract, golden discipline,
all token budgets initially TBD). 7 PURE formatters in `src/core/present/` (search/object/related/impact/
path/status/precheck) plus barrel re-export and 20 golden files under `test/core/present/golden/`. RED→GREEN
TDD per formatter. 159 tests. No server, no SDK.

### Batch B — Tasks 2.1–2.8 (infra move + SDK + server scaffold)

`openConnections` relocated to `src/infra/open-connections.ts`; re-exported via barrel; CLI imports
updated. MCP boundary test (9 tests) created with proven-biting negative controls. SDK `@modelcontextprotocol/sdk`
pinned at `1.29.0` exact. SDK API verified against pinned version (divergence logged: low-level `Server`
chosen over `McpServer`/Zod; documented in `docs/learnings.md`). Static `instructions.ts` + `server.ts`
scaffold (8-tool dispatch table, stub handlers, `createDbgraphServer()` factory). In-process
`InMemoryTransport` harness + `initialize` test. 26 new tests.

### Batch B-fix — Lint + config decoupling

5 lint errors eliminated. Config modules (`schema.ts`, `parse-config.ts`, `resolve-secrets.ts`) moved from
`src/cli/config/` to `src/infra/config/` to cut the transitive `cli→infra` import. Infra boundary rule
added to `test/core/boundaries.test.ts` (2 new tests). 0 errors / 0 warnings post-fix.

### Batch C — Tasks 3.1–3.6 (simple tools)

5 tools wired: `explore`, `search`, `related`, `path`, `status` — each with golden files per detail level
via the in-process harness. Status live-drift integration test gated behind `DBGRAPH_INTEGRATION=1`. 57 new
tests.

### Batch D — Tasks 4.1–4.5 (complex tools + precheck core + affected CLI)

`object` and `impact` orchestrators. Pure `extractIdentifiers` + `runPrecheck` core in `src/core/precheck/`
(neutral module — shared by MCP and CLI without either importing the other). `precheck` tool wired;
`stubHandler` removed. `dbgraph affected` CLI command. 77 new tests.

### Batch E — Tasks 5.1–5.5 (install + packaging + E2E + budget pin)

`dbgraph install` with host-independent `resolveConfigPath` (initial version, win32 path separator issue
latent). Bin entry + tsup third entry (completed in Batch B, confirmed here). Full 8-tool E2E (29 tests)
via in-process harness: all tools × all detail levels + ADR-008 byte-identical second call. Token budgets
measured (ceil(chars/4) on torture fixture) and pinned in `docs/format-spec.md` — zero TBD remaining.
Final gates: tsc clean / lint 0-0 / 1255/1255 tests.

### Batch F — Verify remediation (C-1, W-1, W-2, W-3, S-1, S-2, S-3)

- **C-1 FIXED**: `formatPath` no-route branch now calls `view.resolveTable(id)` for each nearest neighbor entry; loop variable renamed `qname`→`id`; `path-tool-noroute.txt` re-captured with real qnames (`main.departments`, `main.assignments`); L-009 assertion asserts specific qnames AND no 40-hex SHA-1 IDs.
- **W-1 FIXED**: `runStatusTool` accepts optional `adapter?: SchemaAdapter`; production path via `withStoreForStatus` passes live adapter; integration test now drives the tool with adapter and asserts drift-detected output.
- **W-2 FIXED**: search pagination tests strengthened: `hasMore: true` footer, second-page specific qnames, `hasMore: false` terminal, advancing-offset content difference.
- **W-3 FIXED**: `uniqueByQname()` deduplication added to `explore.ts` and `related.ts`; 6 MCP goldens re-captured (smaller, within budget).
- **S-1/S-3**: design.md Decision 9 reconciled to `mcpServers.dbgraph-mcp`; precheck core path corrected to `src/core/precheck/`.
- **S-2**: USAGE_TEXT in `src/cli/cli.ts` extended with `affected` + `install` entries; 2 new `cli.test.ts` assertions.

### Batch G — Cross-platform install fix

Root cause: `src/cli/commands/install.ts` used the host-native `path.join` for both branches of
`resolveConfigPath`. On Linux, `join('C:\\Users\\...\\Roaming', 'Claude', '...')` produced mixed
separators — FsSeam key mismatch caused 3 `runInstall` tests to fail. Fix: replaced `import { join }` with
`import { win32 as pathWin32, posix as pathPosix }`; win32 branch uses `pathWin32.join` (always `\`);
posix branch uses `pathPosix.join` (always `/`). These are pure functions independent of `process.platform`.
Zero test changes — tests were already host-independent; only the implementation was not. Gate: 1259/1259.

---

## Verify Cycle Summary

| Cycle | Date | Verdict | Issues |
|-------|------|---------|--------|
| Initial verify | 2026-06-18 | FAIL | C-1 (path raw IDs) + W-1 (status live drift gap) + W-2 (pagination weak assertions) + W-3 (duplicate references edges) + S-1/S-2/S-3 (doc alignment) + cross-platform install regression |
| Re-verify | 2026-06-18 | PASS — zero carry-over | 15/15 COMPLIANT. All prior findings independently confirmed resolved at formatter, tool, server-wiring, golden, and test layers. |

---

## Story Status at Archive

| Story | Status | Evidence |
|-------|--------|---------|
| US-010 dbgraph_explore | Done | `runExploreTool` + `formatExplore` + 3 golden files; disambiguation + NOT_FOUND; budget test green |
| US-011 dbgraph_search | Done | `runSearchTool` + `formatSearch` + goldens; pagination hasMore proven through harness |
| US-012 dbgraph_object | Done | `runObjectTool` + `formatObject` + goldens; metadata omission explicit; disambiguation |
| US-013 dbgraph_related | Done | `runRelatedTool` + `formatRelated` + goldens; kinds filter; qname deduplication (W-3) |
| US-014 dbgraph_impact | Done | `runImpactTool` + `formatImpact` + goldens; READ/WRITE split; truncation + dynamic-SQL warnings |
| US-015 dbgraph_path | Done | `runPathTool` + `formatPath` + goldens; join columns per hop; no-route reports qnames (C-1) |
| US-016 dbgraph_precheck | Done | `runPrecheckTool` + `runPrecheck` + `formatPrecheck` + goldens; confidence:parsed; unmatched reported |
| US-017 dbgraph_status | Done | `runStatusTool` + `formatStatus` + content assertions; live drift wired in production (W-1) |
| US-018 Instructions in initialize | Done | `src/mcp/instructions.ts` golden-tested; each tool has one example call; zero user-maintained files |
| US-019 Compact format with token budget | Done | `docs/format-spec.md` with grammar + measured ceilings; 22 budget assertions green; golden discipline enforced |
| US-023 dbgraph affected | Done | `runAffected` thin CLI wrapper over `src/core/precheck/`; `--json`; exit 0/1 contract |
| US-024 dbgraph install | Done | `resolveConfigPath` host-independent; idempotent merge; `--remove`; manual snippet fallback |

Stories deferred: US-038 (multi-agent install, Phase 9.5); cursor-based pagination; `node-sql-parser`-grade precheck.

---

## Token Budget Note

Budget ceilings in `docs/format-spec.md` were measured empirically using `ceil(chars/4)` on `main.employees`
from the SQLite torture fixture (`test/fixtures/sqlite/`) — an entity with ≤ 30 relationships. Headroom is
approximately 25–50% above observed output. Phase-6 validation against a real enterprise database will
measure output at scale and may prompt ceiling revisions; any revision must follow the golden-change
discipline (spec edit + token-delta justification in the PR).

---

## Final Gates Checklist

- [x] `npx tsc --noEmit` — CLEAN (exit 0)
- [x] `npm test` — 1259/1259 PASS (exit 0, 86 test files)
- [x] `npm run lint` — 0 errors, 0 warnings (exit 0)
- [x] All 5 CI jobs green on `main`: ubuntu-22.x, ubuntu-24.x, windows-22.x, windows-24.x, mssql-integration
- [x] Zero CRITICAL findings (C-1 resolved)
- [x] Zero WARNING findings (W-1 / W-2 / W-3 resolved)
- [x] Spec compliance: 15/15 COMPLIANT
- [x] Hexagonal boundaries: `src/mcp/**` never imports `src/adapters/**` or `src/cli/**`; `src/infra/**` never imports `src/cli/**` or `src/mcp/**` (boundary tests green + proven-biting)
- [x] Security: target DB read-only; no codename in tracked files (leak-scanner green); no plaintext credentials
- [x] Only new runtime dep: `@modelcontextprotocol/sdk@1.29.0` (exact pin, no caret); NO `node-sql-parser`
- [x] ADR-008: all tool outputs byte-identical on re-run; golden-change discipline enforced

---

## Specs Merged to Main

| Domain | Action | Path |
|--------|--------|------|
| mcp-server | Created (greenfield — new capability; full spec, no delta merge needed) | `openspec/specs/mcp-server/spec.md` |

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/mcp-server/spec.md` | Present (new capability — complete spec; promoted to canonical) |
| `design.md` | Present (S-1 + S-3 doc reconciliation applied in Batch F) |
| `tasks.md` | Present (30/30 tasks complete; all batches A–E marked [x]) |
| `apply-progress.md` | Present (Batches A, B, B-fix, C, D, E, F, G — all complete) |
| `verify-report.md` | Present (re-verify PASS, 0 CRITICAL / 0 WARNING / 0 SUGGESTION, 15/15 compliant) |
| `archive-report.md` | This file |

---

## SDD Cycle Complete

phase-5-mcp-server has been fully planned, implemented, verified, and archived.
The `mcp-server` capability spec is promoted as a new canonical spec at `openspec/specs/mcp-server/spec.md`.
The change folder is closed at `openspec/changes/archive/2026-06-18-phase-5-mcp-server/`.

Next recommended change: Phase 6 — validation against a real enterprise database (unblocked; CLI + MCP
both available). Token budget ceilings may be revised based on Phase-6 measurement findings.
Alternatively, Phase 8 (PostgreSQL/MySQL adapter) is also unblocked.
