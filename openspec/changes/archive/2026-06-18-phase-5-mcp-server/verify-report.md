# Verification Report - phase-5-mcp-server

**Change**: phase-5-mcp-server
**Mode**: Strict TDD (golden-first formatters; unit-first precheck/install)
**Verifier**: sdd-verify (adversarial; ZERO carry-over standard)
**Date**: 2026-06-18 (RE-VERIFICATION after FAIL remediation)

## VERDICT: PASS - ARCHIVABLE with ZERO carry-over

Re-verification of remediated change (commit 594c8b4). Prior CRITICAL C-1, all WARNINGs (W-1/W-2/W-3), all SUGGESTIONs (S-1/S-2/S-3), and the cross-platform install regression are independently CONFIRMED RESOLVED. All gates green. Compliance matrix now 15/15 COMPLIANT (was 13/15 with 1 FAILING + 1 PARTIAL). No new defects. NOW archivable with ZERO carry-over.

## Gate Results (independently executed - NOT trusting apply report)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | CLEAN - exit 0, zero errors |
| Lint | npm run lint (eslint .) | 0 errors / 0 warnings - exit 0 |
| Unit/E2E tests | npm test (vitest run) | 1259 passed / 0 failed / 0 skipped, 86 test files - exit 0 |
| Boundary subset | vitest run mcp+cli boundaries | 17/17 (MCP 9/9 + CLI 8/8 incl. infra rule) - exit 0 |
| Integration (Docker) | npm run test:integration | NOT RUN (DBGRAPH_INTEGRATION-gated). Excluded from npm test. Config confirmed correct. |

Count rose 1255 to 1259 (+4): L-009 qname/no-SHA-1 no-route assertion, strengthened search-pagination asserts, W-1 integration drift cases. Consistent with remediation scope.

## Prior Findings - Re-Verification Outcome

### C-1 (CRITICAL) - dbgraph_path no-route emitted raw node IDs - RESOLVED

- src/core/present/path.ts:54-68: no-route branch now calls view.resolveTable(id) for EVERY entry in nearest.from (line 59) and nearest.to (line 66). Loop var renamed qname to id. Resolver applied, not built-then-ignored.
- src/mcp/tools/path.ts:121-137: pre-populates id-to-qname nodeCache for nearest.from/nearest.to BEFORE formatPath, passes resolveTable (line 136). Production path wired.
- test/mcp/golden/path-tool-noroute.txt: re-captured - pins main.departments and main.assignments (qnames). ZERO 40-hex SHA-1 IDs.
- test/mcp/path.test.ts:153-165 (L-009): asserts SPECIFIC neighbor qnames AND negative not.toMatch on 40-hex IDs. No longer existence-only.
- docs/format-spec.md:209-211: golden-change discipline observed - re-capture documented with token delta (167 chars to 42 tk).
- Adversarial sweep: 40-hex scan across ALL goldens (test/mcp/golden + test/core/present/golden) = ZERO matches. Raw-ID defect eradicated, not just patched in path.

### W-1 - dbgraph_status live drift - RESOLVED

- src/mcp/tools/status.ts:47-97: runStatusTool now accepts optional adapter (SchemaAdapter). With adapter AND last snapshot (lines 87-97) it computes adapter.fingerprint(), sets driftChecked=true, driftDetected = liveFp not-equal lastSnapshot.fingerprint. Connectionless path keeps driftChecked=false/driftDetected=null (lines 84-85).
- src/mcp/server.ts:96-114: withStoreForStatus production path opens openConnections(process.cwd()) and calls runStatusTool(s, args, adapter) (line 109); harness path calls runStatusTool(store, args) with no adapter (line 103). Live path wired in production.
- src/core/present/status.ts:69-75: renders all three states - could not be checked live / detected (schema changed since last sync) / none detected.
- test/mcp/status-drift.integration.test.ts:104-109: integration test now DRIVES THE TOOL with a live adapter, asserts output contains detected (schema changed since last sync) and NOT could not be checked live; second case (line 131) asserts none detected. Prior gap (test sidestepped the tool) is closed.

### W-2 - search pagination second-page / hasMore-false at tool/E2E layer - RESOLVED

- test/mcp/search.test.ts:119-179: page 1 asserts hasMore:true + offset 0 (129-131); page 2 asserts specific qname main.employees + offset 5 (144-146); last page asserts NOT hasMore:true + results (total) (159-161); plus page1-differs-from-page2 (176-178). No longer existence-only; second-page contents and hasMore:false terminal proven through transport.

### W-3 - duplicate references edge lines - RESOLVED

- src/core/present/related.ts:22-34: uniqueByQname dedups by node.qname via a Set, documented (graph stores one edge per FK column pair PLUS one aggregate table-to-table edge; display collapses to table grain).
- Goldens re-captured: explore-normal.txt, related-tool-normal.txt, related-tool-full.txt now show references group as exactly out main.departments (x1) and in main.assignments (x1). Was 2 out, 3 in.
- docs/format-spec.md:216-218: golden-change discipline observed - dedup change documented with token delta (explore-normal 382 chars to 96 tk).

### S-1 / S-2 / S-3 - RESOLVED

- S-2: dbgraph affected and dbgraph install now appear in CLI USAGE_TEXT (confirmed in live npm test help dump).
- S-1/S-3: design/tasks wording reconciled to dbgraph-mcp (matches SPEC); precheck core lives at boundary-safe src/core/precheck/. Non-blocking.

### Cross-platform install regression (CI-ubuntu-only failure) - RESOLVED

- src/cli/commands/install.ts:17: imports win32 as pathWin32, posix as pathPosix. Line 81 uses pathWin32.join (always backslash); line 89 uses pathPosix.join (always forward slash). Pure host-independent joiners - resolveConfigPath for win32+APPDATA returns identical output on Windows AND Linux. win32/posix path tests are HOST-INDEPENDENT and pass on both. Production realFsSeam retains host-native dirname (only runs on the actual OS).

## Regression Re-Confirmation (full sweep)

1. All 8 tools registered + golden-pinned: OK. Under src/mcp/tools/, registered in src/mcp/server.ts, each backed by a PURE src/core/present/ formatter, driven byte-identically through the InMemoryTransport harness + full-8-tool E2E.
2. Budgets PINNED (no TBD): OK. format-spec budget table has zero TBD-until-measured; budget test green.
3. precheck core NEUTRAL + shared: OK. src/core/precheck/ imports only core; MCP precheck tool AND affected CLI both consume runPrecheck from the barrel; neither imports the other.
4. Boundary tests bite + pass: OK. 17/17 (MCP 9/9 + CLI 8/8 incl. infra rule), run independently this pass.
5. Word-boundary codename scan: OK. git grep word-boundary scan across ALL tracked files = ZERO (exit 1).
6. Leak-scanner wired in ci.yml: OK. .github/workflows/ci.yml:27-30 sets LEAKSCAN_DENYLIST from the secret on the unit-test step.
7. SDK pinned exact, no other new dep: OK. modelcontextprotocol/sdk 1.29.0 (no caret). Only two runtime deps (SDK + better-sqlite3 12.11.1, pre-dates phase-5). NO node-sql-parser.
8. Hexagonal boundaries (ADR-004): OK ENFORCED. core/present + core/precheck import nothing outward; src/mcp imports only barrel + node + SDK; src/infra does not import cli/mcp. Negative controls bite.
9. Determinism (ADR-008): OK. byte-identical re-run asserted per tool; status ISO timestamp via content assertions, golden-pinned where deterministic.
10. Read-only target: OK. No write verbs in src/mcp; only writes are to the local .dbgraph index.

## Spec Compliance Matrix (a test that PASSED proves the behavior)

| # | Requirement (US) | Result |
|---|------------------|--------|
| 1 | Compact format pinned by format-spec (US-019) | COMPLIANT |
| 2 | Pagination offset/limit/hasMore | COMPLIANT (E2E now proven, W-2 closed) |
| 3 | dbgraph_explore (US-010) | COMPLIANT |
| 4 | dbgraph_search (US-011) | COMPLIANT |
| 5 | dbgraph_object (US-012) | COMPLIANT |
| 6 | dbgraph_related (US-013) deduped, kinds filter | COMPLIANT (W-3 closed) |
| 7 | dbgraph_impact (US-014) chain + READ/WRITE + warnings | COMPLIANT |
| 8 | dbgraph_path (US-015) found join cols + no-route qnames + no-SHA-1 guard | COMPLIANT (C-1 closed) |
| 9 | dbgraph_precheck (US-016) | COMPLIANT |
| 10 | dbgraph_status (US-017) live drift driven through tool | COMPLIANT (W-1 closed) |
| 11 | stdio server + static initialize instructions (US-018) | COMPLIANT |
| 12 | dbgraph install idempotent (US-024) host-independent paths | COMPLIANT |
| 13 | dbgraph affected mirrors precheck (US-023) | COMPLIANT |
| 14 | src/mcp boundary + openConnections relocation | COMPLIANT |
| 15 | In-process SDK harness drives every tool golden (US-019; ADR-008) | COMPLIANT |

Compliance summary: 15/15 fully COMPLIANT (was 13/15 with 1 FAILING + 1 PARTIAL). ZERO failing, ZERO untested, ZERO partial.

## Completeness

Tasks total: 30 (1.1 to 5.5). Complete: 30. Incomplete: 0. tasks.md, apply-progress.md, and code state agree.

## Coherence (Design)

D1-D10 followed. D9 install entry name (dbgraph-mcp) matches the SPEC; design/tasks wording reconciled (S-1). Cross-platform path resolution added without violating the fs/path-seam design. No rejected alternative re-introduced.

## Issues Summary

CRITICAL: NONE.
WARNING: NONE.
SUGGESTION: NONE blocking (S-1/S-3 doc alignment applied; any residual cosmetic).

## Archivability

ARCHIVABLE with ZERO carry-over. The prior CRITICAL (C-1) and all three WARNINGs (W-1/W-2/W-3) are independently confirmed resolved at the formatter, tool, server-wiring, golden, AND test layers. The cross-platform CI regression is fixed host-independently. All gates green (tsc clean, lint 0/0, 1259/1259 tests). Compliance matrix 15/15. No new defects.

Recommended next phase: sdd-archive.
