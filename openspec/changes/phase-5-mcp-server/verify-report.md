# Verification Report - phase-5-mcp-server

**Change**: phase-5-mcp-server
**Spec version**: new (13 requirements)
**Mode**: Strict TDD (RED to GREEN; golden-first formatters/instructions, unit-first precheck/install)
**Verifier**: sdd-verify (adversarial; ZERO carry-over standard)
**Date**: 2026-06-18

---

## VERDICT: FAIL - not archivable with ZERO carry-over

One CRITICAL defect blocks archive: the dbgraph_path no-route branch emits raw SHA-1 node IDs instead
of qualified names, and the golden froze the bug while an existence-only test let it through (L-009
violation). Everything else is compliant; the fix is small and localized.

---

## Gate Results (independently executed - NOT trusting apply report)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | CLEAN - exit 0, zero errors |
| Lint | npm run lint (eslint .) | 0 errors / 0 warnings - exit 0 |
| Unit/E2E tests | npm test (vitest run) | 1255 passed / 0 failed / 0 skipped, 86 test files - exit 0 |
| Integration (Docker) | npm run test:integration | NOT RUN (Docker-gated). Config correct: vitest.integration.config.ts includes the integration glob; gated behind DBGRAPH_INTEGRATION=1; EXCLUDED from npm test via vitest.config.ts exclude of all integration tests. Confirmed correct. |

Test duration ~16s. The exact 1255 / 86-files matches the apply-progress claim.

---

## CRITICAL (must fix before archive)

### C-1 - dbgraph_path no-route output emits raw node IDs, not qnames (bug + L-009)

Spec violated: Requirement "dbgraph_path returns the shortest join path or suggests neighbors", scenario
"No route reports neighbors": it states no route exists and suggests the closest NEIGHBORS of each
endpoint. Neighbors must be identifiable (qnames). Opaque SHA-1 hashes are not actionable suggestions and
break the compact-format value proposition (agent-readable names).

Evidence:
- test/mcp/golden/path-tool-noroute.txt (committed golden) pins, under "Neighbors of main.employees:",
  two lines that are raw 40-hex-char node IDs (495398fc... and 96a3ebad...), not qnames.
- Root cause - src/core/present/path.ts:56-67: the no-route branch prints result.nearest.from /
  result.nearest.to DIRECTLY (loop var misleadingly named qname), never calling view.resolveTable.
- src/core/ports/graph-store.ts:96-99: PathResult.nearest.from/to are string[] populated from
  src/core/query/path.ts:108-119 using e.dst / e.src, which src/core/model/edge.ts:53-54 documents as
  node id. So they are node IDs by construction.
- src/mcp/tools/path.ts:121-129 pre-populates a nodeCache (id to qname) for nearest, and its own comment
  (line 131) claims formatPath passes nearest ids to resolveTable - but formatPath does NOT. The resolver
  is built then ignored for the no-route case. The hop/found path correctly uses resolveTable (91-92),
  proving the resolver works; only the no-route path drops it.
- L-009: test/mcp/path.test.ts:153-160 asserts only toContain Neighbors-of (existence). A qname assertion
  (e.g. toContain main.departments) would have caught the raw-ID bug. The golden pinned the IDs as
  expected, masking the defect.

Fix direction (do NOT apply here): in formatPath, resolve nearest.from/nearest.to through
view.resolveTable(id) before printing; re-capture path-tool-noroute.txt with the corrected output (golden
change REQUIRES a docs/format-spec.md note + token-delta per golden discipline); strengthen the no-route
test to assert specific neighbor qnames (L-009).

---

## WARNING (should fix)

### W-1 - dbgraph_status tool can NEVER report live drift; integration proof does not drive the tool

Spec: Requirement "dbgraph_status reports index trust and live drift": when a connection is available it
MUST run the live fingerprint to detect drift; scenario "Live fingerprint detects drift when connected":
it runs the live fingerprint and reports drift detected yes.

Evidence:
- src/mcp/tools/status.ts:78-87 hard-codes driftChecked false, driftDetected null. There is NO code path
  that accepts an adapter or runs a live fingerprint. The tool is connectionless-only.
- test/mcp/status-drift.integration.test.ts:92-118 does NOT call the tool with a live connection. It
  proves drift via a DIRECT adapter.fingerprint() not-equal snapshot.fingerprint comparison, then asserts
  the connectionless tool says could-not-be-checked-live. So the spec drift-detected-yes THROUGH THE TOOL
  is never exercised - the integration test sidesteps the tool for the positive case.
- The formatter src/core/present/status.ts:71-72 DOES support driftDetected true (detected - schema
  changed since last sync), unit-tested in status-format.test.ts. So the rendering half is covered; the
  TOOL wiring half is not.

Assessment: The connectionless half (the golden scenario) is fully compliant. The live-drift half is a
genuine gap: the production stdio tool will always print could-not-be-checked-live even when a live
connection exists, because runStatusTool never compares the live fingerprint. Classified WARNING (not
CRITICAL) because it is the explicitly integration-gated scenario, apply deviation #9 documents the
connectionless decision, and the formatter supports it. But it is NOT fully spec-compliant and should be
closed before claiming US-017 done.

### W-2 - Search pagination second-page / hasMore-false not proven at the tool/E2E layer (L-009-weak)

Spec: Requirement "Pagination via offset, limit and hasMore", scenario "A second page is reachable via
offset and hasMore": first page returns limit items + hasMore true; advancing offset returns the next
page and eventually hasMore false.

Evidence:
- Formatter logic IS correct and unit-proven: src/core/present/search.ts:77-81 computes hasMore =
  (offset + hits.length) less-than total; test/core/present/search-format.test.ts:125,130,142 assert
  hasMore-true, NOT-on-last-page, and offset-4 advance. So COMPLIANT at the unit layer.
- BUT the tool-level tests are existence-only: test/mcp/search.test.ts:120-138 - offset=0-first-page and
  using-limit=1-returns-hasMore-true both assert only toContain SEARCH-RESULTS. The second test NAME
  claims hasMore-true but the BODY never asserts it, never asserts item count equals limit, and there is
  NO test that advances offset to the second page and asserts hasMore false end-to-end. Search goldens all
  use a query returning at-or-under the default limit, so the hasMore-true footer is never pinned through
  the transport.

Assessment: Behavior is implemented and unit-tested, so the requirement is COMPLIANT, but the E2E
scenario assertion is weak. Tighten test/mcp/search.test.ts to assert the hasMore-true footer on page 1
and the last-page footer after advancing offset.

### W-3 - Duplicate references edge lines in explore/related output (token noise)

Evidence: test/mcp/golden/explore-normal.txt and related-tool-normal/full.txt show the references group
with main.departments listed TWICE (out) and main.assignments THREE TIMES (in). These are per-column FK
edges not collapsed to table grain in the explore/related grouping, inflating tokens and reading like a
defect.

Assessment: Likely inherited getNeighbors behavior (Phase 3 surface), not introduced by phase-5
formatters, so possibly out-of-scope for this change. Flagged WARNING for visibility - confirm whether the
format-spec line grammar (section 1.4, one line per neighbor) intends table-grain dedup. Does not block
archive on its own but should be triaged.

---

## SUGGESTION (nice to have)

- S-1 design.md Decision 9 and tasks.md 5.1 say mcpServers.dbgraph; the implementation uses
  mcpServers.dbgraph-mcp. NOTE: the SPEC (spec.md:259,266,268,274) says dbgraph-mcp in ALL four places, so
  the implementation MATCHES THE SPEC and only deviates from the stale design/tasks wording. Reconcile
  design.md/tasks.md to dbgraph-mcp. (Apply deviation #13 is therefore acceptable - spec-correct.)
- S-2 src/cli/cli.ts USAGE_TEXT (28-34) does NOT list the new affected or install commands, though both
  ARE registered in dispatch.ts COMMAND_TABLE (267-268). Discoverability gap; not a spec requirement.
- S-3 design.md File Changes table lists src/mcp/precheck.ts; the precheck core correctly lives at
  src/core/precheck/ (boundary-safe neutral location per the design own Decision 5 + tasks note). Update
  the File Changes row.

---

## Spec Compliance Matrix (behavioral - a test that PASSED proves the behavior)

| # | Requirement (US) | Proof | Result |
|---|------------------|-------|--------|
| 1 | Compact format pinned by docs/format-spec.md (US-019) | format-spec grammar+levels+pagination, NO TBD remaining; present format tests byte-identical goldens; budget.test.ts 22/22 | COMPLIANT |
| 2 | Pagination offset/limit/hasMore | Formatter unit search-format.test.ts:125,130,142 (true/false/offset-advance) | COMPLIANT (E2E weak, W-2) |
| 3 | dbgraph_explore (US-010) | explore.test.ts 11/11; goldens pin exact neighbor qnames; disambiguation returns candidate qnames (explore.ts:93-103), never guesses | COMPLIANT |
| 4 | dbgraph_search (US-011) | search.test.ts 13/13; goldens pin type+qname per hit + total footer | COMPLIANT |
| 5 | dbgraph_object (US-012) | object.test.ts 13/13; object-tool-full.txt pins exact columns/constraints/indexes/triggers; metadata-omission + ambiguity tested | COMPLIANT |
| 6 | dbgraph_related (US-013) | related.test.ts 12/12; goldens pin grouped edges with exact qnames + direction; kinds filter tested | COMPLIANT |
| 7 | dbgraph_impact (US-014) | impact.test.ts 12/12 (E2E chain with exact qnames); impact-format.test.ts proves WRITE section, truncated, dynamic-SQL warnings via fixed structs | COMPLIANT |
| 8 | dbgraph_path (US-015) | Found: path-tool-found.txt pins JOIN ON main.employees.dept_id = main.departments.dept_id OK. No-route emits RAW IDs, existence-only test, C-1 | FAILING (no-route half) |
| 9 | dbgraph_precheck (US-016) | precheck.test.ts 13/13; extract+engine 17+10; precheck-tool-full.txt pins matched/readers/what-to-test + confidence parsed + unmatched (idx_emp_dept, priority) | COMPLIANT |
| 10 | dbgraph_status (US-017) | Connectionless: status.test.ts 15/15 content-asserted. Live drift through the tool never exercised, W-1 | PARTIAL |
| 11 | stdio server + static initialize instructions (US-018) | initialize.test.ts 8/8; instructions.txt golden covers explore-vs-search-vs-object + status-explore-precheck flow; each tool description has exactly one Example | COMPLIANT |
| 12 | dbgraph install idempotent (US-024) | install.test.ts 21/21; mergeMcpConfig idempotent; removeMcpConfig preserves other entries; FsSeam, no real FS | COMPLIANT |
| 13 | dbgraph affected mirrors precheck (US-023) | affected.test.ts 12/12; exit 1 when matched objects greater-than 0, else 0; --json; shares runPrecheck core via barrel | COMPLIANT |
| 14 | src/mcp boundary + openConnections relocation | boundaries.test.ts 9/9 (real scan of 9 files + negative controls); infra rule; SDK 1.29.0 exact sole new dep; read-only confirmed | COMPLIANT |
| 15 | In-process SDK harness drives every tool golden (US-019; ADR-008) | e2e.test.ts 29/29 drives all 8 tools + byte-identical 2nd call + explicit DoD proof | COMPLIANT |

Compliance summary: 13/15 fully COMPLIANT; 1 FAILING (path no-route, C-1); 1 PARTIAL (status, W-1).

---

## Targeted Conformance Checks (from the verify brief)

1. All 8 tools implemented + registered + pure formatter + golden-pinned + US mapping: OK. All 8 under
   src/mcp/tools/, registered in src/mcp/server.ts buildToolTable (96-305), each backed by a PURE
   src/core/present/ formatter, golden-pinned through test/mcp/harness.ts (InMemoryTransport). Full-8-tool
   E2E + DoD proof in e2e.test.ts. US-010 to US-017 mapped.
2. Compact format / budgets PINNED: OK. format-spec budget table has ZERO TBD; budget test enforces
   ceil(chars/4) ceilings (22/22).
3. precheck core NEUTRAL + shared: OK. src/core/precheck extract/engine/index import only core - no
   adapters/cli/mcp/drivers. BOTH src/mcp/tools/precheck.ts AND src/cli/commands/affected.ts import
   runPrecheck from the barrel; neither re-implements it; neither imports the other. extractIdentifiers
   PURE + unit-tested (17); confidence parsed; unmatched reported.
4. dbgraph install: OK. idempotent merge, --remove preserves others, manual-snippet fallback + exit 0,
   fs/path via FsSeam (no real FS). 21/21.
5. Determinism (ADR-008): OK. byte-identical re-run asserted per tool. The status lastSync ISO timestamp
   is handled CORRECTLY via content assertions; byte-identical preserved within a run (deviation #9). Not
   a defect.
6. L-009 discipline: MOSTLY OK - found/impact/related/object/explore/precheck goldens assert ACTUAL
   endpoints/qnames + join columns. VIOLATIONS: path no-route (C-1, raw IDs + existence-only test) and
   search pagination (W-2, existence-only).
7. Hexagonal boundaries (ADR-004): OK ENFORCED + PASSING. src/mcp imports only barrel + node + SDK;
   src/core/present and precheck import nothing outward; src/infra does not import cli or mcp (Batch-B-fix
   relocation of schema/parse-config/resolve-secrets to src/infra/config/ confirmed). boundary tests 9/9
   (mcp) + 9/9 (core incl. infra rule) with biting negative controls.
8. Security / CODENAME (legal): OK. git grep -i word-boundary [CODENAME] across ALL TRACKED files = ZERO. The
   only [CODENAME] occurrence is line 5 of the dot-leakscan-denylist-dot-local - the UNTRACKED, git-ignored
   denylist DEFINITION file (not scanned: extension outside the scanner TEXT_EXT). Leak-scanner reads
   LEAKSCAN_DENYLIST env AND the local denylist fallback + enforces the inline-URL-credential regex. Wired
   in ci.yml: LEAKSCAN_DENYLIST set as env ON the npm test step (27-30). env-VAR-only secrets
   (resolve-secrets.ts ENV_REF_RE); NO resolved-URL logging in src/mcp or src/infra; target DB read-only -
   no write verbs in src/mcp (only writes are to the LOCAL dot-dbgraph graph index, expected).
9. Dependencies: OK. modelcontextprotocol/sdk is the ONLY new runtime dep, PINNED EXACT 1.29.0 (no caret).
   better-sqlite3 12.11.1 pre-dates phase-5 (dependabot merge #4, commit eca84d3). NO node-sql-parser
   (only in comments documenting exclusion). No other new deps.
10. Deviations: dbgraph-mcp entry name (#13) ACCEPTABLE (matches SPEC; design/tasks stale, S-1); per-call
    open/close in stdio (#12) ACCEPTABLE (finally-closed, safe); path single budget (#14) ACCEPTABLE;
    createDbgraphServer factory/storeOverride (#7,#8) ACCEPTABLE; status content-assertion (#9) ACCEPTABLE.

---

## Completeness

Tasks total: 30 (1.1 to 5.5). Complete: 30. Incomplete: 0. tasks.md and code state agree.

## Coherence (Design)

D1 grammar Yes. D2 empirical budgets Yes (no TBD). D3 pure formatters in present Yes. D4 openConnections
to src/infra Yes (barrel re-export; CLI+MCP consume barrel). D5 precheck regex tokenizer, no
node-sql-parser Yes. D6 object orchestrator composes existing reads Yes. D7 low-level Server + dispatch
table Yes (SDK shape verified, Zod avoided, #6). D8 SDK pinned + tsup entry + bin Yes (1.29.0 exact). D9
install Deviated but SPEC-correct (entry name dbgraph-mcp, S-1). D10 boundary test bites Yes (9/9 +
negative controls).

---

## Issues Summary

CRITICAL (1): C-1 dbgraph_path no-route emits raw node IDs (bug + L-009); golden froze it.
WARNING (3): W-1 status tool never runs live fingerprint (US-017 live-drift half not wired); W-2 search
pagination second-page / hasMore-false not proven at tool/E2E layer; W-3 duplicate references edge lines
in explore/related (likely pre-existing).
SUGGESTION (3): S-1 reconcile design/tasks dbgraph to dbgraph-mcp; S-2 add affected/install to CLI help;
S-3 fix design File-Changes precheck path.

---

## Archivability

NOT archivable with ZERO carry-over. C-1 is a CRITICAL spec violation (dbgraph_path
No-route-reports-neighbors) and a genuine shipping bug (unusable opaque-ID output to the agent). Under the
project ZERO carry-over standard, W-1 (US-017 live-drift never wired through the tool) should also be
resolved before archive - it is a real, undelivered half of a spec requirement, deferred behind an
integration gate that does not actually drive the tool.

Recommended next phase: sdd-apply - fix C-1 (resolve nearest ids to qnames in formatPath, re-capture the
no-route golden with a format-spec token-delta note, strengthen the no-route test to assert specific
neighbor qnames) and address W-1/W-2; then re-run sdd-verify.
