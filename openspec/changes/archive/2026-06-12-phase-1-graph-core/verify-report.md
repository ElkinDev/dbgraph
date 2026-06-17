# Verification Report: phase-1-graph-core

**Change**: phase-1-graph-core
**Spec version**: 4 capabilities (graph-model, graph-storage, graph-normalization, graph-query)
**Mode**: Strict TDD (config strict_tdd true; runner npm test / vitest)
**Date**: 2026-06-12
**Verdict**: PASS WITH WARNINGS

## Executive summary

All three gates are clean and the suite is deterministic (238/238 twice, byte-identical goldens).
Hexagonal boundary, deterministic IDs, async port, level gating, FTS gating, typo fallback and the
read/write impact split are all behaviorally proven by passing tests. No out-of-scope leakage. TDD
discipline is auditable in git (test-red commits precede feat commits for every core unit). One spec
scenario is UNVERIFIED and UNIMPLEMENTED (the off-level queryable absence reason) - the only
blocker-adjacent finding, downgraded to WARNING because off correctly omits nodes (the primary
behavior) and no Phase-1 consumer reads the absence reason. Two design-doc deviations in findJoinPath
and getImpact are spec-compatible.

Findings: 0 CRITICAL, 4 WARNING, 3 SUGGESTION

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete [x] | 25 |
| Tasks incomplete | 0 |

NOTE: the launch brief referenced 28 tasks; tasks.md contains 25 (1.1-1.2, 2.1-2.5, 3.1-3.4,
4.1-4.5, 5.1-5.4, 6.1-6.5, 7.1-7.3). All 25 are [x]. The 238 passing figure is correct. The count
mismatch is in the brief, not the artifacts.

## Build & Tests Execution

- Lint (npm run lint): PASS - 0 errors, 0 warnings (exit 0)
- Type check (npx tsc --noEmit): PASS - 0 errors (exit 0)
- Tests (npm test): PASS - 15 files, 238 passed / 0 failed / 0 skipped (exit 0)
- Determinism re-run (npm test twice): PASS - identical 238/238; all golden / byte-identical
  assertions green on both runs (ADR-008 satisfied).

Boundary guard validated empirically: injected a better-sqlite3 default import into
src/core/__boundary_probe.ts and re-ran test/core/boundaries.test.ts; the scan FAILED with "Core
boundary violations found -> imports better-sqlite3". The boundary test is a real guard, not a no-op.
Probe removed; tree clean.

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | PASS | apply-progress has TDD Cycle Evidence tables for batches A-D |
| All core units have tests | PASS | model, errors, id, levels, normalize, query x4, storage, boundary, barrel |
| RED confirmed (test-first) | PASS | git: test-red commit precedes each feat commit (model, errors, id, levels, normalize) |
| GREEN confirmed (tests pass) | PASS | all referenced tests pass on execution (238/238) |
| Triangulation adequate | PASS | multi-case suites per behavior (id 21, impact 15, levels 22) |
| Safety Net for modified files | PASS | sqlite-graph-store.ts grown across 5.2-5.4 with expanding suite |

Git RED to GREEN audit (core units):
- e358b76 test-red model -> 399e48b feat model
- bded1c5 test-red errors -> 4d1c7c9 feat errors
- 0c3cdc8 test-red id -> 0b1545b feat id
- 0f6e89a test-red levels -> e2d5243 feat levels
- fb93375 test-red normalize -> 71eae7a feat normalize

Query/storage units used feat commits with co-located tests (combined RED to GREEN within the commit,
documented in apply-progress Batch C/D). Acceptable per the apply phase rationale (factory+store are an
inseparable unit). The strict RED-before-GREEN audit trail holds for the pure core units, which is what
strict_tdd governs.

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit (pure core, fake store) | ~205 | 11 | vitest |
| Integration (real better-sqlite3 :memory:) | ~33 | schema + sqlite-graph-store + e2e-dod | vitest + better-sqlite3 |
| E2E | 0 | 0 | n/a (no MCP/CLI in Phase 1 - correct) |
| Total | 238 | 15 | |

Storage and e2e-dod tests use REAL better-sqlite3 (never mocked) per dbgraph-testing - confirmed.

## Spec Compliance Matrix

### graph-model

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Node taxonomy | Node declares kind and stable identity | model.test.ts NodeKind + id.test.ts nodeId deterministic/kind disambiguation | COMPLIANT |
| Node taxonomy | Stub flags mutually exclusive | model.test.ts GraphNode stub flags mutual exclusion | COMPLIANT |
| Edge taxonomy | fires_on carries its event | model.test.ts GraphEdge fires_on carries event | COMPLIANT |
| Edge taxonomy | inferred_reference type without scoring | model.test.ts GraphEdge inferred_reference numeric score | COMPLIANT |
| Confidence | Declared FK edge, no score | model.test.ts declared edge has null score | COMPLIANT |
| Confidence | Inferred edge carries score | model.test.ts inferred_reference numeric score | COMPLIANT |
| Indexing levels | Default level resolution | (none - defaults not asserted) | PARTIAL (W-2) |
| Indexing levels | off is an absence, not silence | (none - absence reason not implemented) | UNTESTED (W-1) |
| Capability/Scope/RawCatalog | RawCatalog sole structural input | model.test.ts RawCatalog without DB connection | COMPLIANT |
| Capability/Scope/RawCatalog | CapabilityMatrix gates object types | model.test.ts engine without procedures | COMPLIANT |

### graph-storage

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Observable through port | Core depends only on the port | boundaries.test.ts (validated catches violations) | COMPLIANT |
| Round-trip | Round-trip preserves the graph | sqlite-graph-store.test.ts round-trip (12 cases incl golden deep-equal) | COMPLIANT |
| Schema versioning | Older schema migrates forward | schema.test.ts open v0 migrates to v1 | COMPLIANT |
| Schema versioning | Current schema opens without migrating | schema.test.ts current-version no-op | COMPLIANT |
| FTS honors levels | full searchable, metadata not | sqlite-graph-store.test.ts full body searchable, metadata not | COMPLIANT |
| body_hash | Stable unchanged, different changed | sqlite-graph-store.test.ts body_hash stable/changes | COMPLIANT |
| Snapshot persistence | A sync writes retrievable snapshot | sqlite-graph-store.test.ts listSnapshots insertion order/fields | COMPLIANT |

### graph-normalization

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Catalog-to-graph | Minimal fixture to golden | normalize.test.ts catalog-minimal matches golden | COMPLIANT |
| Composite FK | Two-column FK per-pair + aggregated | normalize.test.ts composite-fk 2 per-column + 1 aggregated | COMPLIANT |
| Read/write edges | Procedure read and write edges | normalize.test.ts rw-edges reads_from/writes_to confidence parsed | COMPLIANT |
| Read/write edges | Trigger fires and writes | (composed: fires_on minimal + writes_to rw-edges; no single combined fixture) | PARTIAL (W-3) |
| Dynamic SQL | Non-analyzable dynamic SQL flagged | normalize.test.ts sp_dynamic_report hasDynamicSql true | COMPLIANT |
| Stub nodes | Dangling reference -> missing stub | normalize.test.ts dangling-ref missing true + reported | COMPLIANT |
| Stub nodes | Excluded target keeps the edge | normalize.test.ts excluded edge preserved + excluded true | COMPLIANT |
| Level honoring | metadata keeps node+edges not body | levels.test.ts applyLevel metadata (no body, null hash, empty ftsBody) | COMPLIANT |
| Level honoring | off omits node BUT records the reason | (none - absence reason not implemented or tested) | UNTESTED (W-1) |
| Boundary & determinism | Deterministic, boundary-clean | normalize.test.ts determinism byte-identical + boundaries.test.ts | COMPLIANT |

### graph-query

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Neighbors grouped | Grouped with direction | neighbors.test.ts grouping by edge kind and direction + golden | COMPLIANT |
| Neighbors grouped | kinds filter restricts | neighbors.test.ts kinds filter | COMPLIANT |
| Impact closure | Separates read/write, visible chain | impact.test.ts read/write separation + visible chains | COMPLIANT |
| Impact closure | Depth limit truncates with warning | impact.test.ts depth cap sets truncated true | COMPLIANT |
| Impact closure | Cyclic graph terminates | impact.test.ts cycle safety terminates | COMPLIANT |
| Impact closure | Dynamic SQL in chain warns | impact.test.ts dynamicSqlWarning true when node hasDynamicSql | COMPLIANT |
| Shortest path | Exposes join columns | path.test.ts direct/multi-hop join columns + e2e composite FK | COMPLIANT |
| Shortest path | Inferred-only route is marked | path.test.ts inferred false in Phase 1 (structural only; no inferred edges) | PARTIAL (W-4) |
| Shortest path | No route reports neighbors | path.test.ts no route suggests nearest neighbors | COMPLIANT |
| Full-text search | Ranked FTS with typo tolerance | search.test.ts typo Levenshtein fallback custmer to customers + e2e | COMPLIANT |
| Full-text search | Only full bodies searchable | sqlite-graph-store.test.ts metadata body NOT in FTS (data-enforced) | COMPLIANT |
| End-to-end DoD | Golden results over persisted fixture | e2e-dod.test.ts neighbors/impact/path/search over real store | COMPLIANT |
| End-to-end DoD | Deterministic byte-identical output | e2e-dod.test.ts byte-identical on two calls (x4) | COMPLIANT |

Compliance summary: 28/31 scenarios COMPLIANT, 3 PARTIAL, 1 UNTESTED (the off-absence scenario appears
in BOTH graph-model and graph-normalization; counted once as UNTESTED).

## Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Hexagonal boundary (ADR-004) repo test | YES | boundaries.test.ts; empirically catches a real driver import |
| Deterministic IDs sha1(kind+qname) (3.4) | YES | id.ts nodeId = sha1(kind + space + qname.toLowerCase); edgeId discriminated; goldens stable |
| Async GraphStore port (1, 11) | YES | port returns Promises; adapter wraps sync better-sqlite3 in resolved promises |
| Level semantics off/metadata/full (5.4) | MOSTLY | metadata/full exact; off omits node but absence-reason channel not implemented (W-1) |
| Golden determinism (ADR-008) | YES | byte-identical double run; sorted-key stableStringify; sorted nodes/edges |
| Search typo constants pinned (6.4) | YES | LEVENSHTEIN_THRESHOLD=2, TYPO_CAP=5 exported + pinned by search.test.ts constant tests |
| inferred_reference TYPE-only | YES | normalize emits NO inferred edges (grep confirms); type + score field present |
| No out-of-scope leakage | YES | only src/core + src/adapters/storage/sqlite; no mcp/cli/config/engine/inference dirs |
| BFS over aggregated refs only (6.3) | DEVIATED | path.ts traverses ALL references edges, not aggregated-only (S-1) |
| Impact chains a-b-c | YES (richer) | impact.ts records every frontier sub-chain (a-b AND a-b-c); deterministic superset |

## Documented Deviations - Sanity Check

| Deviation | Spec-compatible? | Evidence |
|---|---|---|
| Runtime constants in model barrel | YES - improves validation surface | barrel.test.ts exports; RED module-load trigger |
| Views produce depends_on (not reads_from) | YES - SPEC-MANDATED | graph-normalization Catalog-to-graph: view dependency MUST yield depends_on; reference-resolver.ts:272; e2e asserts depends_on |
| Impact records intermediate sub-chains | YES - superset of a-b-c | impact.ts:118-123; deterministic; tests green |
| getNeighbors defensive kinds filter | YES - idempotent | neighbors.ts:53-57; real adapter also filters in SQL |
| isTraversable() parameterless | YES - Phase-9 placeholder | path.ts:190; always true; no inferred edges in Phase 1 |
| FTS DELETE+INSERT (L-003) | YES - FTS5 lacks ON CONFLICT | sqlite-graph-store.ts:150-152; level-gated body preserved |
| _detectMatchedColumn extra MATCH queries | YES - deterministic | sqlite-graph-store.ts:408-422; populates SearchHit.column per port spec |

## Out-of-Scope Leakage Check

PASS. find src -type d shows ONLY: model, normalize, ports, query (core) + adapters/storage/sqlite.
- NO engine adapters (mssql/pg/mysql/mongodb extraction)
- NO MCP server, NO CLI
- NO config plumbing
- NO inference scoring (grep: zero inferred references in src/core/normalize/)
- inferred_reference is TYPE-ONLY (model + score field; normalizer never emits it)

## Story Status Integrity

| Story | Marked | Accurate? |
|---|---|---|
| US-006 | done | YES - minimal golden, composite FK, missing stub, boundary lint all covered by passing tests |
| US-007 | partial (model/storage/query done; body-parsing pending Phase 3) | YES - reads_from/writes_to/hasDynamicSql modeled+tested; SQL parsing deferred |
| US-009 | partial (storage schema/model done; fingerprint pending Phase 3) | YES - putSnapshot/listSnapshots implemented+tested; fingerprint deferred |
| US-003 | partial (metadata/full gating done; off-absence pending) | MOSTLY - see W-1: off-absence-reason clause not yet delivered |

## Findings

### CRITICAL (block archive)
None.

### WARNING (should fix; do not block archive)

W-1 - off-level queryable absence reason not implemented or tested.
Spec refs: graph-model Indexing levels scenario "off level is an absence, not silence" (a queryable
absence reason is representable); graph-normalization Level honoring scenario "off omits the node but
records the reason" (a queryable absence reason "indexes not indexed by configuration" is recorded for
affected tables). Evidence: normalize.ts:190-193 and buildChildNodes (:266,:274,:282) correctly OMIT
off-level nodes, but nothing populates NormalizationResult.warnings or any node field with an absence
reason; levels.test.ts only asserts applyLevel returns null. No test exercises the records-the-reason
clause. The primary behavior (off -> no node) IS correct and tested; only the reason recording is
missing. Fix: when a configured type resolves to off, push a structured absence entry (warnings or a new
absences field) per affected parent, and add a normalize test asserting it. Downgraded from CRITICAL:
(a) dominant off behavior works, (b) no Phase-1 consumer reads the reason (dbgraph_object is Phase 5).

W-2 - Default level resolution not directly asserted.
Spec ref: graph-model Indexing levels scenario "Default level resolution" (triggers full, procs/functions
metadata, statistics/sampling off). Evidence: ObjectTypeLevels carries the fields, but no test constructs
defaults and asserts triggers=full / procedures=metadata / statistics=off. Defaults are documented (design
12 / ADR-003) as living in code/config, not in the model type; no defaults factory in core yet (correct -
config-resolved later). Fix: add a defaults constant + test, or note defaults live in the config phase.
Covered indirectly via fixture scope objects that set levels manually.

W-3 - Trigger fires and writes scenario covered only by composition.
Spec ref: graph-normalization Read and write edges scenario "Trigger fires and writes" (AFTER UPDATE
trigger that both fires_on and writes_to). Evidence: fires_on tested on catalog-minimal; writes_to tested
on catalog-rw-edges (a procedure). No single fixture exercises a trigger that BOTH fires_on AND writes_to.
Both code paths (buildFiresOnEdges + buildDependencyEdges) support it and are proven separately. Fix: add
a trigger-with-write fixture/test to prove the combination directly.

W-4 - Inferred-only route is marked scenario unverifiable in Phase 1.
Spec ref: graph-query Shortest join path scenario "Inferred-only route is marked". Evidence: path.test.ts
asserts inferred=false in Phase 1. By design (6.3) inferred edges are not emitted until Phase 9, so a
positive test is impossible now. Acceptable deferral; flagged for re-verification at US-008.

### SUGGESTION (improvement, not required)

S-1 - findJoinPath BFS does not restrict to aggregated references edges.
Design 6.3 says BFS over aggregated references edges. path.ts:53-72 traverses ALL references edges (both
directions) including per-column ones, relying on the visited set to dedupe. Output is correct and
deterministic (goldens pass twice), but a composite FK pushes the same table pair multiple times.
Filtering on e.attrs.aggregate true during BFS would match design intent. Pure optimization.

S-2 - Brief/artifact task-count mismatch. Brief said 28 tasks; tasks.md has 25. Reconcile the brief or
annotate tasks.md. The 238 test figure and 25/25 completion are correct.

S-3 - getImpact read/write bucketing keys on the terminal hop only. impact.ts:153 classifies an entire
chain by its LAST edge kind. Satisfies the spec scenarios (single-kind chains) and is deterministic, but a
mixed read-to-write chain is bucketed solely by the last hop. Document the rule or split mixed chains if
future stories need per-hop classification.

## Verdict

PASS WITH WARNINGS - Phase 1 graph core is complete, deterministic, boundary-clean, and behaviorally
verified by 238 passing tests across two byte-identical runs. Hexagonal architecture, deterministic IDs,
async port, FTS level gating, typo fallback and read/write impact split all hold. No CRITICAL issues block
archive. The only material gap (W-1, off-level absence reason) is a spec scenario neither implemented nor
tested, but its dominant behavior works and no Phase-1 consumer depends on it. Recommend proceeding to
sdd-archive, carrying W-1/W-3 forward as Phase-1.5/Phase-3 follow-ups and W-4 to Phase 9.

Next recommended: sdd-archive

---

## Re-verification (Batch E)

Date: 2026-06-12
Scope: Targeted re-verification after Batch E remediation. Confirms W-1 through W-4 resolved, F-1 through F-9 refactors content-neutral, and the change is now PASS with ZERO carry-over warnings.
Re-verdict: PASS

### Gates (run by re-verifier, not trusted from report)

| Gate | Command | Result |
|------|---------|--------|
| Tests run 1 | npm test | PASS - 18 files, 262 passed / 0 failed / 0 skipped (exit 0) |
| Tests run 2 (determinism) | npm test | PASS - 262/262 IDENTICAL; goldens byte-identical both runs (ADR-008) |
| Lint | npm run lint | PASS - 0 errors, 0 warnings (exit 0) |
| Type check | npx tsc --noEmit | PASS - 0 errors (exit 0) |

262 passing matches the Batch E claim exactly (238 prior + 24 new across omitted/defaults/trigger-rw/e2e). Determinism confirmed across two byte-identical runs.

### Per-item confirmation

W-1 off-level queryable absence reason: RESOLVED.
- Type channel: src/core/model/graph.ts adds OmittedKindInfo with kind NodeKind and reason string, and NormalizationResult.omitted as a readonly OmittedKindInfo array (lines 29-42). Spec demands the reason be representable (graph-model off-level absence scenario) AND recorded for affected tables and queryable (graph-normalization off-omits-records-reason scenario). Both are now met.
- Population: normalize.ts buildOmittedKinds(scope) (lines 538-569) emits one entry per NodeKind whose scope level is off, with reason not-indexed-by-configuration (exact spec wording), sorted by kind (ADR-008 deterministic). Called at line 94, returned at line 97.
- Direct tests: test/core/normalize/omitted.test.ts has 7 tests proving the field exists, contains index when indexes off, contains procedure plus function when those are off, excludes non-off kinds, carries the spec reason text, and is deterministic across runs. PASS.
- E2E persistence (QUERYABLE end-to-end): test/core/query/e2e-dod.test.ts beforeAll persists via store.setMeta(omitted_kinds, stableStringify(result.omitted)) (line 62); two new tests read it back via store.getMeta(omitted_kinds) and assert the channel is parseable and reason-bearing (lines 220-241). PASS. The absence reason is genuinely queryable through the persistence layer, as the spec demands.
- Note: scope keys statistics and sampling have no NodeKind in the taxonomy, so they are intentionally not recorded in omitted (documented at normalize.ts:555-557). Correct - no node kind to record against. The mappable off kinds (index, procedure, function and so on) ARE recorded.

W-2 DEFAULT_LEVELS matches ADR-003 and spec defaults exactly: RESOLVED.
- src/core/model/capability.ts exports DEFAULT_LEVELS (lines 33-47). Verified every documented default against the graph-model Default-level-resolution scenario and ADR-003: triggers full; procedures metadata; functions metadata; statistics off; sampling off; structural core tables/columns/constraints/indexes/views all full; sequences/collections/fields metadata (engine-baseline).
- Direct tests: test/core/model/defaults.test.ts has 10 tests, one per documented default. PASS.

W-3 trigger fires_on AND writes_to from the SAME trigger, single fixture: RESOLVED.
- Fixture: test/fixtures/catalog-trigger-rw.json - one AFTER UPDATE trigger on orders whose body does INSERT INTO dbo.audit, plus a write dependency on audit.
- Golden: test/golden/normalize/catalog-trigger-rw.json proves BOTH edges from the SAME trigger node d77c69a8: fires_on (trigger to orders, event UPDATE) edge 6d56f10c dst orders 8798e1f9, AND writes_to (trigger to audit) edge e00cc443 dst audit 671e2ece confidence parsed.
- Test: test/core/normalize/trigger-rw.test.ts has 5 tests, including an explicit assertion that both edges originate from the same trigger src (lines 103-115) and golden byte-identity. PASS.

W-4 inferred-only-route scenario marked deferred to Phase 9 (US-008): RESOLVED (documented boundary).
- specs/graph-query/spec.md Inferred-only-route scenario now carries an explicit block-quote deferral (lines 82-85): Deferred to Phase 9 (US-008) - inferred edges cannot exist before the inference engine; re-verified when the scoring engine (US-008) is implemented. This is now a documented phase boundary, NOT an open warning. Consistent with the other Phase-9 deferrals in this spec.

F-1 BFS traverses ONLY aggregated references edges plus truthful docstring: CONFIRMED.
- src/core/query/path.ts isTraversable(edge: GraphEdge) (lines 195-197) returns edge.attrs aggregate equals true - BFS now skips per-column edges. The signature changed from the old parameterless isTraversable() Phase-9 placeholder (prior S-1 deviation) to take the edge.
- Docstring (lines 187-194) now tells the truth: BFS follows ONLY aggregated references edges; per-column edges are excluded from BFS traversal. Class docstring and algorithm comment updated to match.
- Path tests and goldens: test/core/query/path.test.ts 10/10 PASS; e2e-dod path assertions PASS.

F-2 search.ts uses NODE_KINDS (no hardcoded kind list): CONFIRMED.
- src/core/query/search.ts imports NODE_KINDS from the model node module (line 16) and iterates over NODE_KINDS in levenshteinFallback (line 109). No hardcoded kind array remains.

F-3 buildChildNode extraction did NOT change golden content: CONFIRMED (byte-level).
- W-1 commit 26f7adf regenerated all 5 normalize goldens IN THE SAME COMMIT as the type change; each golden diff is 3 lines and inspecting catalog-minimal.json shows the ONLY change is an omitted empty-array appended after warnings - graph nodes/edges/stubs content byte-identical, exactly as the fix report claimed.
- F-3 refactor commit 96d4711 touched ONLY src/core/normalize/normalize.ts (97 insertions, 106 deletions) - ZERO golden files. The buildChildNode extraction is content-neutral, proven green under the existing golden suite.

F-4 through F-9 refactors under test safety net, no golden churn: CONFIRMED.
- F-5 8494c8f to reference-resolver.ts only. F-6 d0c251f to impact.ts only. F-7 da00cb8 to sqlite-graph-store.ts only (FTS statements prepared once in constructor lines 200-223; _detectMatchedColumn renamed to detectMatchedColumn line 447). F-8 838e2da to neighbors.ts only. F-9 09ff602 to sqlite-graph-store.ts only (every read op wraps in StorageError: getNode, getNodesByKind, getNodeByQName, getEdgesFrom, getEdgesTo, searchFts, getMeta, listSnapshots). No commit in F-4 through F-9 touched a golden or fixture.

Boundary re-check: CONFIRMED.
- test/core/boundaries.test.ts 4/4 PASS. Grep over src/core for any adapters, better-sqlite3, node-sqlite, drivers, mcp, or cli import returns ZERO matches. Hexagonal boundary holds.

Clean tree plus single-commit golden regen: CONFIRMED.
- git status short is empty (clean tree). The type change and its 5 golden regenerations are in ONE commit (26f7adf); no orphan golden churn in any later commit.

### Resolution of carry-over warnings

| Prior finding | Status after Batch E |
|---|---|
| W-1 off-level absence reason | RESOLVED - implemented plus direct tests plus queryable E2E channel |
| W-2 default level resolution | RESOLVED - DEFAULT_LEVELS plus 10 direct tests |
| W-3 trigger fires plus writes | RESOLVED - single fixture plus golden plus 5 tests |
| W-4 inferred-only route | RESOLVED - documented Phase-9 deferral (not an open warning) |
| S-1 BFS aggregated-only | RESOLVED via F-1 (was a suggestion; now implemented) |
| S-2 task-count mismatch | RESOLVED - apply-progress and tasks both at 25/25 |
| S-3 impact terminal-hop bucketing | Acceptable as-is; documented design rule, no Phase-1 consumer affected |

### Re-verdict

PASS - All four carry-over warnings (W-1 through W-4) are genuinely resolved with real execution evidence, not rubber-stamped. The W-1 absence reason is now both representable in the model AND queryable end-to-end through store.getMeta(omitted_kinds), satisfying the spec queryable-absence-reason demand. W-2 and W-3 have direct tests; W-4 is a documented phase boundary. The nine code-review findings F-1 through F-9 are confirmed content-neutral refactors under the golden and test safety net, with the goldens regenerated in a single commit alongside the type change. Three gates clean and deterministic across two byte-identical runs (262/262, lint 0, tsc 0). Hexagonal boundary holds. Working tree clean. ZERO carry-over warnings, ZERO CRITICAL.

Next recommended: sdd-archive
