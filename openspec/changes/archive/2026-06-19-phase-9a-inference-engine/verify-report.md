# Verification Report — phase-9a-inference-engine

**Change**: phase-9a-inference-engine
**Mode**: Strict TDD (active)
**Branch**: phases-9-and-9-5 (all 3 batches committed; working tree clean)
**Verdict**: PASS WITH WARNINGS

---

## Executive Summary

The Phase-9a structural inference engine is correct, deterministic, boundary-clean, and the load-bearing byte-identical guarantee holds. The full local gate is green: tsc clean, lint 0/0, 2350/2350 tests pass, and `git diff --exit-code test/golden/normalize/` is EMPTY. Scrutiny 1 (byte-identical gate-OFF) and 2 (edge correctness: exact endpoints, hard type-reject, COLUMN->COLUMN grain, self-sort determinism) both PASS. 0 CRITICAL, 2 WARNING, 3 SUGGESTION. The warnings concern the multi-candidate fan-out (an edge is emitted to EVERY matching target, so when both a singular and plural table exist for one entity, two edges are produced) and the existingEdges dedup grain (keyed on src only). Neither produces a wrong edge on the shipped SQL engines (gate is OFF) nor breaks any golden, so neither blocks archive — both should be recorded as known behavior for Phase 9b.

---

## The Gate (real execution)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | PASS exit 0, no errors |
| Lint | npm run lint (eslint) | PASS exit 0, 0 errors / 0 warnings |
| Tests | npm test (vitest run) | PASS 145 files, 2350 tests passed, 0 failed, 0 skipped |
| Golden drift (load-bearing) | git diff --exit-code test/golden/normalize/ | PASS EMPTY (exit 0) |
| Working tree | git status --porcelain | PASS clean (no uncommitted golden re-seed) |

The CLI "Unknown command" banners in the test log are expected output from the CLI test suite exercising unknown-command/empty-command paths — not failures.

---

## Scrutiny 1 — Byte-identical gate-OFF (HIGHEST) — PASS

- The hook (normalize.ts L94-97) is wrapped in: if (scope.inferRelationships === true || hasCollectionOrFieldNode(nodeMap)). When the flag is unset/false AND there are no collection/field nodes, the block is SKIPPED ENTIRELY — inferReferences is never called, nothing is pushed to edges, and the array flows through the unchanged sortEdges(edges) at L101. Zero behavioral change on the default SQL path.
- hasCollectionOrFieldNode (L122-127) is a pure read-only scan of nodeMap for collection/field node kinds — no I/O, no mutation.
- test/core/normalize/normalize.test.ts (task 3.4) re-normalizes FIVE committed SQL fixtures (catalog-minimal, catalog-composite-fk, catalog-dangling-ref, catalog-excluded, catalog-rw-edges) with inferRelationships unset and asserts JSON.stringify(result, null, 2) toBe the committed golden bytes via assertMatchesGolden, plus not containing any inferred_reference edge.
- git diff --exit-code test/golden/normalize/ is EMPTY after the full run. The four shipped SQL engines goldens are untouched. The no-CI safety guarantee is intact.

## Scrutiny 2 — Edge correctness (L-009) — PASS

- Exact endpoints + score: tests assert the FULL emitted edge — exact src/dst node ids (nodeId('column', qname)), attrs.srcColumn, attrs.dstColumn, and score via toBe(1.0) / toBeCloseTo(...). Not existence-only. (infer-references.test.ts 2.2/2.3; normalize.test.ts gate-ON toHaveLength(1) with exact src/dst/score.)
- HARD type-reject (not a 0.7 leak): infer-references.ts L263 — if (!compatible(srcDataType, target.dataType)) continue; — rejects BEFORE scoring. sqlIncompatFixture (customer_id:string vs customers.id:int) asserts not.toContainEqual any edge from that column. A mismatch emits NO edge — confirmed.
- COLUMN->COLUMN grain (D1): src = srcNode.id, dst = target.colNode.id — both are column/field node ids; buildTargetIndex only indexes column/field nodes. Consistent.
- Determinism (ADR-008): engine selfSort (L191-205) orders (src ASC, dst ASC, score DESC, srcColumn ASC, id ASC) — it does NOT rely on the score-blind sortEdges. Two-run stableStringify equality asserted for both SQL and Mongo fixtures.
- PK-of-target via constraint nodes (D2): buildPkIndex (L88-110) reads only constraint nodes with payload.type === 'PK' and lowercased payload.columns. ColumnPayload has no isPrimaryKey (confirmed in node.ts L76-82) — correctly avoided.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 16 (1.1-1.4, 2.1-2.7, 3.1-3.5) + 8 DoD items |
| Tasks complete | all |
| Tasks incomplete | 0 |

All three batches tasks and all Definition-of-Done items are checked done and match the committed code state.

---

## Spec Compliance Matrix (behavioral — test-proven)

### graph-normalization

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Opt-in structural inference | High-confidence match emits scored edge | infer-references.test.ts high-confidence; normalize.test.ts gate ON emits exactly one | COMPLIANT |
| Opt-in structural inference | Weak match below threshold emits no edge | infer-references.test.ts (b) custom threshold 0.95 blocks lines.id_product | COMPLIANT (documented THRESHOLD + custom-threshold proof) |
| Name-convention matching | entity_id snake to plural target | infer-references.test.ts high-confidence; conventions.test.ts | COMPLIANT |
| Name-convention matching | entityId camel to singular target | infer-references.test.ts invoices.customerId to dbo.customer.id | COMPLIANT |
| Name-convention matching | id_entity prefix to real target | infer-references.test.ts lines.id_product to dbo.products.id | COMPLIANT |
| Name-convention matching | No matching target invents no edge | infer-references.test.ts orders.status_id emits NO edge | COMPLIANT |
| Type compatibility gates | Compatible int/bigint emitted | type-compat.test.ts; engine high-confidence int-int | COMPLIANT |
| Type compatibility gates | Incompatible types yield no edge | infer-references.test.ts (a) type-incompatible emits NO edge | COMPLIANT |
| Inference opt-in / OFF by default | Gate OFF on SQL fixture byte-identical to golden | normalize.test.ts gate OFF BYTE-IDENTICAL (x5 fixtures) | COMPLIANT |
| Inference opt-in / OFF by default | Gate ON surfaces inferred edges | normalize.test.ts gate ON produces an edge ABSENT with gate OFF | COMPLIANT |
| Deterministic ordering | Multiple candidates order deterministically | infer-references.test.ts self-sort + two-run stableStringify | COMPLIANT |
| Boundary and determinism (MODIFIED) | Inference engine boundary-clean + deterministic | import-list grep (only ../model/* + ../normalize/id.js); determinism tests | COMPLIANT |

### graph-model

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Edge taxonomy (MODIFIED) | inferred_reference carries a score in [0,1] | infer-references.test.ts all emitted scores are in [0,1] | COMPLIANT |
| ExtractionScope contract (MODIFIED) | inferRelationships optional, defaults off | capability.test.ts (4 cases) | COMPLIANT |
| Secondary auto-trigger | Mongo collection/field nodes fire inference without flag | normalize.test.ts auto-trigger fires even though inferRelationships is absent | COMPLIANT |

Compliance summary: 15/15 spec scenarios COMPLIANT (all backed by a passing test).

---

## Coherence (design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 column->column endpoints | Yes | src/dst are column/field node ids; attrs carry locals |
| D2 PK via constraint nodes | Yes | buildPkIndex reads constraint payload.type PK + columns; no isPrimaryKey flag |
| D3 gate semantics | Yes | scope.inferRelationships true OR hasCollectionOrFieldNode — both checks in the hook, not the engine |
| D4 self-sort | Yes | engine sorts (src, dst, score DESC, srcColumn, id) before returning |
| D5 hand-rolled pluralization | Yes | zero-dep candidateTargets; only real targets validate |
| D6 candidate value source | Yes | reads only name/qname/payload.dataType/columns/type — no raw values |
| Score formula + constants | Yes | W_CONVENTION=0.5, W_TYPE=0.3, W_PK_TARGET=0.2, THRESHOLD=0.5; hard-reject before scoring |
| ADR-004 boundary | Yes | infer imports only ../model/* + ../normalize/id.js; normalize->../infer/index.js is intra-core |
| ADR-007 zero new deps | Yes | package.json unchanged; no inflection/pluralize lib |

Deviation (benign): the normalize.ts hook comment labels the block Step 4d; the design wording says after step 4c, before step 6. Cosmetic numbering only — placement (after the dependency loop closes at L87, before sortEdges at L101) is exactly as specified.

---

## Issues Found

### CRITICAL (must fix before archive)
None.

### WARNING (should fix / record as known behavior)

W-1 — Multi-candidate fan-out: an edge is emitted to EVERY matching target (scrutiny 7).
infer-references.ts L257-293: the match loop iterates ALL candidateTargets(entity) and, for each, ALL columns of every real target table, emitting an edge for each compatible match — there is no first-match-wins or score-based disambiguation. Empirically confirmed (probe on sqlFixture): orders.customer_id emits 2 edges — to BOTH dbo.customer.id AND dbo.customers.id (score 1.0 each); invoices.customerId likewise emits 2. Total inferred edges on that fixture = 5, not 3.

Assessment per scrutiny 7: defensible noise, not a wrong edge on a realistic schema -> WARNING, not CRITICAL. Rationale: on a realistic schema an entity is modeled as EITHER customer OR customers, not both, so only one candidate resolves and exactly one edge is produced (the shipped gate fixture catalog-infer-gate.json, with no singular twin, correctly yields toHaveLength(1)). The fan-out only manifests in the synthetic unit fixture that deliberately includes both forms. It cannot break a shipped SQL golden (gate OFF) and does not violate determinism (both edges emit in stable sorted order). candidateTargets over-generates by design (D5) and relies on "only real targets validate" — true, but it does not pick BETWEEN two valid real targets.

Concrete fix (Phase 9b hardening, optional now): when an entity resolves to more than one real target, either (a) keep only the highest-scoring candidate, breaking ties by candidateTargets order (prefer the closest/as-is form), or (b) keep all but down-weight secondary matches. Either way add an EXACT-count assertion (expect(edges).toHaveLength(N)) on a both-forms fixture so the policy is pinned. Note: infer-references.test.ts L62-78 already documents the ambiguity in comments but asserts only the plural edge existence and pins no total — the fan-out passes today undetected by count.

W-2 — existingEdges dedup is keyed on src only (column-wide, not per-target-pair).
buildDedupSet (L176-184) adds edge.src for every declared references edge, and the match loop skips a source column entirely if its id is in that set (L242). Consequence: if orders.customer_id has a declared FK to table A, an inferred edge to a different table B is ALSO suppressed. This matches the design stated intent (skip a column that already has a declared references edge) and prevents inferred/declared overlap, so it is correct against the current spec — but the grain is coarser than a per-(src,dst) skip and should be recorded so Phase 9b does not mistake it for a bug. Fix only if a future spec wants inferred edges to other targets alongside an existing FK; pin with a fixture either way.

### SUGGESTION (nice to have)

S-1 — Threshold is structurally unreachable by the production formula. With the current weights, the lowest score for any type-compatible match is id_entity + compatible + non-PK = 0.5*0.8 + 0.3 + 0 = 0.7 >= 0.5. So THRESHOLD=0.5 never rejects a real match in production — only type-incompat (hard-rejected) or a custom options.threshold (the 0.95 test) can drop an edge. The weak-match-below-threshold scenario is therefore proven only via a custom threshold, not the default. Consider documenting that the threshold is a Phase-9b safety lever (inert under the shipped weights), or rebalancing weights so the default threshold is load-bearing.

S-2 — candidateTargets over-generation could match an unintended real table. Forms like customeres (+es) or statu (singular-strip of status) are emitted; harmless only because no such table usually exists. A schema that happens to contain e.g. a statu table would receive a spurious edge. Low likelihood; consider tightening the +es rule (only when the stem ends in s/x/z/ch/sh) in a future pass (updates conventions.test.ts pinned sets).

S-3 — Cosmetic: align the normalize.ts hook comment (Step 4d) with the design wording (after step 4c, before step 6). No behavioral impact.

---

## Verdict

PASS WITH WARNINGS. All gates green (tsc/lint/2350 tests), the load-bearing git diff over test/golden/normalize/ is empty, both highest-priority scrutiny points (byte-identical gate-OFF; exact edge correctness with hard type-reject and self-sort determinism) pass, and 15/15 spec scenarios are test-proven. The two warnings (multi-candidate fan-out; src-only dedup grain) are defensible, golden-safe, deterministic behaviors that do not block archive but should travel forward as known behavior into Phase 9b. Recommended next phase: sdd-archive.
