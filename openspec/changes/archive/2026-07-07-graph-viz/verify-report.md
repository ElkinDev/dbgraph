# Verification Report — graph-viz

**Change**: graph-viz
**Branch**: post-v1 (HEAD a3c08a0)
**Mode**: Strict TDD (pure src/core/viz + storage seam) · Standard for the impure CLI assembly
**Artifact store**: openspec (files)
**Verifier**: sdd-verify (executor) — every gate + live-export figure measured in this run

---

## Verdict: PASS

All 20 spec scenarios COMPLIANT (a passing test AND a live-artifact re-proof for the load-bearing ones).
Gate green and reproduced. Zero existing-golden drift. The live export byte-matches every B1 golden. The four
documented deviations are each justified and, where deferred, closed at the artifact level in this run.
0 CRITICAL / 1 WARNING / 3 SUGGESTION.

---

## Gate (measured myself)

| Gate | Result | Evidence |
|------|--------|----------|
| npx tsc --noEmit | PASS (exit 0) | clean, strict, no any |
| npm run lint (eslint .) | PASS (exit 0) | 0 errors / 0 warnings |
| npm test (vitest run) | PASS (exit 0) | 3441 passed / 7 skipped (3448) — EXACTLY the contract 3441+7 |
| existing-golden drift vs 06a04b8 | ZERO | git diff --stat 06a04b8 HEAD -- test/golden/ empty; only 3 NEW files under test/core/viz/golden/ |
| working tree | CLEAN | git status --porcelain empty after every run/build (dist/ + build/ gitignored) |

The 7 skipped are pre-existing DBGRAPH_INTEGRATION-gated suites. No viz/storage scenario is skipped.
node:sqlite is AVAILABLE (Node v22.19.0) so the driver-agnostic bulk-read scenario (2.4) RAN.

Targeted re-runs (green): viz {community,graph-data,mermaid,detail-parity,collapse,neighbor-index},
bulk-read, cli {viz,offline-scan,query-count,assets-embedded}, cli, dispatch, boundaries, sea-entry,
mcp/boundaries, viz-not-registered, barrel, core/boundaries — 228 tests, all passed.

---

## Live export (the heart — every figure measured in this run)

Built dist (npm run build, exit 0 — stale/absent before; the artifact IS the criterion). Materialized the
SQLite torture graph from test/fixtures/sqlite/torture.sql, drove the SHIPPED binary
(node dist/cli.js init --dialect sqlite --file <torture-src>) which synced 53 nodes (26 column, 9 constraint,
4 index, 6 table, 6 trigger, 2 view), then node dist/cli.js viz.

| Live check | Result |
|------------|--------|
| viz --out out.html | exit 0; 40,704 B (size sane) |
| HTML determinism (two runs) | byte-identical — same sha256 9215ae82...51ae98 |
| #dbgraph-data block vs B1 golden | parsed deep-equals AND raw-unescaped block === JSON.stringify(golden) byte-for-byte; 8 nodes / 8 edges / 3 communities |
| Zero fetchable external refs (my own grep) | remote src/href, @import, url(http, fetch(, import(, XMLHttpRequest, Worker(, EventSource -> all 0 |
| All http(s):// in output | inert only — 8 URLs, all d3js.org / github.com/d3 attribution |
| Vendored d3 present + ISC header | Copyright 2010-2021 Mike Bostock present (9x); ISC block preserved |
| Sidebar / community / detail markup | sidebar, Communities heading, community-list, kind-list, schema-list, search, min-degree, detail, detail-body, dbgraph-data, forceSimulation — all PRESENT |
| main.employees detail vs dbgraph object main.employees --detail full | byte-for-byte identical (713 chars, exact ===) — strongest proof of same-source-same-truth |
| viz --mermaid --out and --mermaid (STDOUT) | both exit 0, both byte-identical to golden/mermaid-er.mmd |
| viz --full | exit 0; 55,147 B (> 40,704 collapsed) — columns expanded live, opt-in may-be-heavy confirmed |

### Flag matrix (all exercised live -> exit 2 + exact pinned Q5 message)
--mermaid + {--kinds,--full,--schema,--min-degree}, --min-degree abc, --min-degree=-3, --full + --columns,
--full + --kinds, --kinds boguskind, empty --schema — 10/10 exit 2, messages byte-match the Decision Q5 /
task 3.1 pins. Valid --full still exits 0.

### Query ceiling (Q3)
query-count.test.ts + bulk-read.test.ts counting-store decorator: HTML export = getAllNodes x1 +
getAllEdges x1, wholeGraphReads===2, totalReads<=3, getNode/getNodesByKind/getEdgesFrom/getEdgesTo===0;
--mermaid likewise exactly 2. The live CLI uses the SAME buildVizExport path (2 bulk reads).

### Secrets sentinel (my own live canary — stronger than the suite)
Ran the live export with DBGRAPH_TEST_SECRET, DBGRAPH_TEST_SAMPLE, AND a config-shaped DBGRAPH_DB_PASSWORD
set. Grep of the emitted HTML: all three absent (0), the source-db PATH absent (0), main.employees present
(1). Only schema identifiers embedded.

### Community determinism + naming
community.test.ts re-runs assignment twice -> identical count/membership/names, toStrictEqual
golden/community-torture.json (3 communities: active=6, counters=1, projects=1). Live re-export produced the
identical block (same sha256). Names honor the code-point tie-break: single-schema graph -> first
underscore-token; the 6-member community ties at count 1 and resolves to lexicographically-smallest active by
code-point compare (NOT localeCompare).

### SEA — deviation (c) closed at ARTIFACT level
Ran npm run bundle:sea (exit 0 -> build/sea/dbgraph.cjs, 1.29 MB). Grep of the ACTUAL bundle:
__DBGRAPH_DATA__, __DBGRAPH_VENDOR__, __DBGRAPH_VIEWER__, __DBGRAPH_CSS__, forceSimulation, dbgraph-data,
Copyright 2010-2021 Mike Bostock, assembleVizHtml — all present. The viz assets ship inside the SEA blob. The
deferral-to-release-smoke is empirically discharged here, not merely source-guarded. (Bundle removed after
scan; tree clean.)

---

## Traceability — 20/20 scenarios COMPLIANT

### graph-viz (10)
| Scenario | Test / pin | Live re-proof | Status |
|----------|-----------|---------------|--------|
| emitted HTML fetches nothing | offline-scan.test.ts 3.6a | my grep: 0 fetch constructs | COMPLIANT |
| renders offline over file:// | manual-smoke-viz.md 4.2 + structural | all inlined, 0 network refs | COMPLIANT (structural; pixels manual per ADR-008) |
| byte-identical data block | graph-data.test.ts 1.4 golden + 3.6b | out.html===out2.html; block===golden | COMPLIANT |
| community snapshot | community.test.ts 1.2 golden | 3 communities live, names match | COMPLIANT |
| sidebar communities + counts + toggles | manual-smoke 4.2 + viewer.js | markup present in live HTML | COMPLIANT (structural; interaction manual) |
| node click = object payload sections | detail-parity.test.ts 1.5 | main.employees detail === live object (byte) | COMPLIANT |
| secrets/samples never embedded | offline-scan.test.ts 3.6c | my live canary (secret+sample+pw+path) absent | COMPLIANT |
| default collapses / --full expands | collapse.test.ts 1.1 | live: default 8 nodes/40KB, --full 53/55KB | COMPLIANT |
| mermaid byte-golden | mermaid.test.ts 1.6 golden | live --out + STDOUT === golden | COMPLIANT |
| viz not an MCP tool | viz-not-registered.test.ts 3.7c | live registry inspected, no viz | COMPLIANT |

### graph-storage (4)
| Scenario | Test | Status |
|----------|------|--------|
| bounded queries (no N-storm) | bulk-read.test.ts 2.3 + query-count.test.ts 3.7a (exactly 2 exec) | COMPLIANT |
| deterministic ordering | bulk-read.test.ts 2.3 (ORDER BY qname,id / kind,src,dst,id) | COMPLIANT |
| strictly read-only | bulk-read.test.ts 2.3 + ADR-004 boundary | COMPLIANT |
| driver-agnostic | bulk-read.test.ts 2.4 (RAN — node:sqlite available) | COMPLIANT |

### cli-config (6)
| Scenario | Test | Live re-proof | Status |
|----------|------|---------------|--------|
| writes self-contained HTML, exit 0 | viz.test.ts 3.2 | live exit 0 + confirmation w/ path | COMPLIANT |
| --mermaid emits ER, exit 0 | viz.test.ts 3.3 | live exit 0, === golden | COMPLIANT |
| invalid flag/combo -> exit 2 | viz.test.ts 3.1 | 10 live combos, all exit 2 + exact msg | COMPLIANT |
| CLI import boundary | query-count.test.ts 3.7b + boundaries.test.ts | viz.ts imports only barrel/builtins | COMPLIANT |
| banner line exact @ index 12 | cli.test.ts 3.4 | live --help shows aligned viz line after object | COMPLIANT |
| adding viz leaves others byte-identical | cli.test.ts 3.4 | insertion-only pin | COMPLIANT |

---

## Deviations assessed

(a) Compile-time embedded assets (embedded.generated.ts + assets.ts) replacing the design readFileSync —
JUSTIFIED, superior. The design literal readFileSync(template/viewer/vendor) would FAIL in two ship modes:
(1) npm dist publishes only dist/ (package.json files array is [dist]) so the assets source files are never
shipped -> runtime ENOENT; (2) a no-filesystem SEA binary cannot readFileSync arbitrary asset paths.
Embedding the assets as string constants makes them ship inside BOTH dist and the SEA blob and keeps the
runtime FS-free. A drift-guard (assets-embedded.test.ts) pins each constant byte-identical to its reviewable
on-disk source, so the vendored/authored files stay the single source of truth. Satisfies the design INTENT
(self-contained, offline) better than the literal mechanism. Not a defect.

(b) ISC-not-MIT license fact-correction — CORRECT and HONEST. d3-force/quadtree/dispatch/timer are ISC
(Copyright 2010-2021 Mike Bostock), not MIT as design Q1 assumed. PROVENANCE.md records the correction with an
explicit HONESTY NOTE, per-file + tarball sha256, and vendored-not-npm-installed-no-CDN. The design companion
claim of zero transitive deps was ALSO wrong — d3-force needs quadtree+dispatch+timer; apply correctly
vendored all four in UMD load order. ISC headers preserved verbatim and reproduced in the emitted HTML
(verified 9x). Not a defect.

(c) SEA artifact scan deferred to release smoke — ACCEPTABLE and now CLOSED by me. In-suite it is a
source-level drift-guard; I discharged it at the artifact level by building the real SEA bundle and grepping
the viz markers (all present, see above). Not a defect.

(d) eslint scoping for vendored/browser files — CORRECT hygiene. ignores covers only genuinely non-authored
artifacts (assets/vendor, embedded.generated.ts, plus dist build coverage); viewer.js (hand-authored browser
code) is STILL linted, just with browser globals + sourceType script; the src/core host-independence
path-guard is untouched. No hand-authored TS is exempted. Lint 0/0 holds. Not a defect.

---

## Issues

### CRITICAL (block archive)
None.

### WARNING (should fix)
- W1 — Secrets sentinel exercises the env/config surface, not a payload-embed path. offline-scan.test.ts 3.6c
  plants sentinels in process.env and asserts absence in the HTML. The exporter never reads process.env, so
  the assertion cannot catch a leak arriving via a NODE PAYLOAD (the path that actually reaches the embedded
  detail text). The scenario wording (present in the environment/config during export) MATCHES the test, so it
  is spec-COMPLIANT — but the guard is an env-canary, not a payload-canary. Mitigated by architecture (dbgraph
  is catalog-only: no row sampling; secrets live only in dbgraph.config.json env-refs resolved in
  openConnections, never persisted to the graph) and by my stronger live canary (config-shaped password +
  source path also confirmed absent). Recommend a defense-in-depth test injecting a secret-shaped literal into
  a node payload and asserting it is absent from the emitted detail/data block.

### SUGGESTION (nice to have)
- S1 — embedded.generated.ts (38 KB) appears script/hand-generated; the generation procedure is enforced only
  by the drift-guard test. Add a committed generator (or package.json script) so regeneration is reproducible
  and documented, not just asserted.
- S2 — neighbor-index.ts orders neighbor groups with localeCompare (to match existing getNeighbors), whereas
  community/data-block ordering uses code-point compare for machine-independence. Parity is pinned to
  formatObject on a single fixture, so it is correct today; consider unifying on code-point compare if the
  detail text ever needs cross-locale byte-stability. Inherited from pre-existing code, not introduced here.
- S3 — The file:// render + interactive UI (force layout, pan/zoom, toggles, node-click) are covered ONLY by
  docs/manual-smoke-viz.md (correct per ADR-008: the animation is deliberately not goldened). Consider a
  lightweight jsdom smoke of viewer.js boot (data-block parse + sidebar DOM build) to catch client regressions
  without goldening pixels.

---

## Coherence (design)
| Decision | Followed? | Note |
|----------|-----------|------|
| Q1 vendor d3 as inlined client asset | Yes (evolved) | ISC not MIT (b); embedded as constants not readFileSync (a) |
| Q2 getAllNodes/getAllEdges arrays, ORDER BY | Yes | pinned in bulk-read.test.ts |
| Q3 <=3 store reads, exactly 2 whole-graph | Yes | counting-store + query-count |
| Q4 banner @ index 12 after object | Yes | cli.test.ts byte-pin |
| Q5 ConfigError matrix, exit 2 | Yes | 10 combos live |
| Q6 seeded LPA + code-point tie-break | Yes | golden + live active tie-break |
| Q7 no formal US | Yes | honest record |
| Arch: pure core vs impure CLI assembly | Yes | boundary tests green; viz.ts imports only barrel/builtins |

---

## Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 25 (+ DoD 10) |
| Tasks complete | 25/25 (DoD 10/10) — all checked, matched to code + live evidence |
| Tasks incomplete | 0 |

---

## Next
sdd-archive — no CRITICAL issues block closeout. W1 + S1-S3 are follow-ups, not blockers.
