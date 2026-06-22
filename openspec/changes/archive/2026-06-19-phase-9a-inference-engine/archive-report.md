# Archive Report — phase-9a-inference-engine

**Change**: phase-9a-inference-engine
**Branch**: phases-9-and-9-5
**Archived**: 2026-06-19
**Verdict at archive**: PASS WITH WARNINGS (0 CRITICAL)

---

## What Shipped

Pure-core inference engine under `src/core/infer/` realizing US-008 (scored `inferred_reference` edges for legacy/document databases without declared foreign keys). No adapter, no driver, no new npm dependency.

### New Files

| File | Description |
|------|-------------|
| `src/core/infer/type-compat.ts` | `typeFamily(dataType)` + `compatible(a, b)` — type-family table (int/bigint, ObjectId/_id, string, uuid); hard-reject before scoring |
| `src/core/infer/conventions.ts` | `extractEntity(colName)` — patterns `<e>_id`/`<e>Id`/`id_<e>` (conv scores 1.0/0.8); `candidateTargets(entity)` — hand-rolled zero-dep singular/plural set (D5) |
| `src/core/infer/infer-references.ts` | `inferReferences(nodes, existingEdges, options): GraphEdge[]` — full scorer: indexes targets by owning table/collection + PK-via-constraint-nodes (D2), COLUMN→COLUMN grain (D1), hard type-reject before scoring, score formula (W_CONVENTION=0.5, W_TYPE=0.3, W_PK_TARGET=0.2, THRESHOLD=0.5), existingEdges dedup, self-sort (D4) |
| `src/core/infer/index.ts` | Barrel re-exporting `inferReferences`, `InferOptions`, named constants, and helpers |
| `test/core/infer/fixtures.ts` | Reusable SQL + Mongo-like `ReadonlyMap<string, GraphNode>` fixtures |
| `test/core/infer/type-compat.test.ts` | Full-set boolean table for type-family compatibility |
| `test/core/infer/conventions.test.ts` | Exact-set per pattern + full candidateTargets set pinning |
| `test/core/infer/infer-references.test.ts` | Exact-set (L-009): high-confidence, camel, prefix, negative, type-incompat hard-reject, threshold boundary, existingEdges dedup, determinism, Mongo fixture |

### Modified Files

| File | Change |
|------|--------|
| `src/core/model/capability.ts` | Added OPTIONAL `readonly inferRelationships?: boolean` to `ExtractionScope` (default false; D3) |
| `src/core/normalize/normalize.ts` | Gated hook block (Step 4d) after the dependency loop (L87), before `sortEdges` (L101): fires when `scope.inferRelationships === true` OR `hasCollectionOrFieldNode(nodeMap)` |
| `docs/stories/02-graph-core.md` | US-008 refined: Phase 9a marker; ≥0.8 score example; opt-in + determinism criteria |

### Key Behavioral Properties

- **COLUMN→COLUMN grain (D1):** `src`/`dst` are the two column/field node ids; `attrs.srcColumn`/`attrs.dstColumn` carry local names.
- **PK-of-target via constraint nodes (D2):** `buildPkIndex` reads `constraint` nodes with `payload.type === 'PK'` and lowercased `payload.columns`. `ColumnPayload` has no `isPrimaryKey` flag (correctly avoided).
- **Gate semantics (D3):** `scope.inferRelationships === true` OR `hasCollectionOrFieldNode(nodeMap)` — both checks in the hook, not the engine. SQL stays OFF; Mongo auto-triggers.
- **Self-sort (D4):** Engine orders `(src ASC, dst ASC, score DESC, srcColumn ASC, id ASC)` before returning — does NOT rely on the score-blind `sortEdges`.
- **Hand-rolled pluralization (D5, ADR-007):** zero new npm deps; over-generation is safe because only real targets validate.
- **Security (D6):** reads only `name`/`qname`/`payload.dataType`/`payload.columns`/`payload.type` — no raw data values.
- **Score formula:** `W_CONVENTION*conv + W_TYPE*typeCompat + W_PK_TARGET*targetIsPk`. `conv` = 1.0 (`<e>_id`/`<e>Id`) or 0.8 (`id_<e>`). Type incompatibility is a HARD REJECT before scoring (not a penalty). `orders.customer_id` (int) → `customers.id` (int, PK) = 1.0.
- **opt-in gate default OFF:** every existing SQL `ExtractionScope` leaves `inferRelationships` unset and produces no `collection`/`field` nodes — the hook is never reached, goldens stay byte-identical.

---

## Validation

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0, 0 errors) |
| `npm run lint` (eslint) | PASS (exit 0, 0 errors / 0 warnings) |
| `npm test` (vitest) | PASS (145 files, 2350/2350 tests) |
| `git diff --exit-code test/golden/normalize/` | PASS EMPTY (exit 0) — the no-CI safety guarantee held |
| Spec compliance | 15/15 scenarios COMPLIANT (all backed by passing tests) |
| ADR-004 boundary | CLEAN — `src/core/infer/` imports only `../model/*` + `../normalize/id.js` |
| ADR-007 zero new deps | CLEAN — `package.json` unchanged |
| ADR-008 determinism | CLEAN — self-sort + two-run `stableStringify` equality asserted for SQL + Mongo fixtures |

**The four shipped SQL engines' normalize goldens are byte-identical (`git diff` empty). The no-CI safety guarantee held.**

### Spec Scenarios (15/15)

| Domain | Scenario | Result |
|--------|----------|--------|
| graph-normalization | High-confidence match emits scored edge | COMPLIANT |
| graph-normalization | Weak match below threshold emits no edge | COMPLIANT |
| graph-normalization | `<entity>_id` snake to plural target | COMPLIANT |
| graph-normalization | `<entity>Id` camel to singular target | COMPLIANT |
| graph-normalization | `id_<entity>` prefix to real target | COMPLIANT |
| graph-normalization | No matching target invents no edge | COMPLIANT |
| graph-normalization | Compatible int/bigint emitted | COMPLIANT |
| graph-normalization | Incompatible types yield no edge | COMPLIANT |
| graph-normalization | Gate OFF on SQL fixture byte-identical to golden | COMPLIANT |
| graph-normalization | Gate ON surfaces inferred edges | COMPLIANT |
| graph-normalization | Multiple candidates order deterministically | COMPLIANT |
| graph-normalization | Boundary and determinism (normalizer) | COMPLIANT |
| graph-model | inferred_reference carries a score in [0,1] | COMPLIANT |
| graph-model | ExtractionScope.inferRelationships optional, defaults off | COMPLIANT |
| graph-model | Secondary auto-trigger (collection/field nodes) | COMPLIANT |

---

## Tasks

All 16 tasks (1.1–1.4, 2.1–2.7, 3.1–3.5) checked done. All 8 Definition-of-Done items checked done.

---

## Stories

- **US-008** — ADVANCED (inference engine done; the engine is proven, gate-OFF is byte-identical, 15/15 scenarios compliant). **Consumed-by-Mongo is PENDING — closes in `phase-9b-mongodb`** (the MongoDB adapter turns `inferRelationships` ON via the `collection`/`field` auto-trigger).

---

## Specs Synced (delta → canonical)

| Delta Spec | Canonical Spec | Action | Requirements |
|------------|---------------|--------|--------------|
| `openspec/changes/phase-9a-inference-engine/specs/graph-normalization/spec.md` | `openspec/specs/graph-normalization/spec.md` | MODIFIED (Purpose) + ADDED (5 requirements) + MODIFIED (Boundary and determinism) | Purpose sentence updated; "Opt-in structural inference", "Name-convention matching", "Type compatibility gates", "Inference is opt-in and OFF by default", "Deterministic ordering of inferred edges" added; "Boundary and determinism" extended to cover `src/core/infer/` |
| `openspec/changes/phase-9a-inference-engine/specs/graph-model/spec.md` | `openspec/specs/graph-model/spec.md` | MODIFIED (2 requirements) | "Edge taxonomy" — lifted deferred wording; scenario updated to assert score in [0,1]; "CapabilityMatrix/ExtractionScope/RawCatalog" — added `inferRelationships?: boolean` documentation + scenario |

---

## Deferred / Carry-forward into `phase-9b-mongodb`

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| W-1 | WARNING | Multi-candidate fan-out: when BOTH a singular and plural form of an entity exist as real tables, an edge is emitted to EVERY valid target (not first-match-wins). On a realistic schema this is harmless (one form exists, not both), but a synthetic fixture with both forms yields duplicate edges. Decide disambiguation policy (keep-highest-score or keep-all-with-downweight) when Mongo uses inference for real; pin an exact-count assertion. | Record as known behavior; address in 9b |
| W-2 | WARNING | `existingEdges` dedup is keyed on `src` only (column-wide, not per-(src,dst) pair). If a column has a declared FK to table A, an inferred edge to a different table B is also suppressed. Correct per current spec intent; grain should be documented so 9b does not mistake it for a bug. | Record as known behavior; relax grain only if a future spec requires it |
| S-1 | SUGGESTION | THRESHOLD=0.5 is vestigial under production weights — the minimum real score is `id_<e>` + compatible + non-PK = 0.7. The threshold is only effective via a custom `options.threshold`. Document as a Phase-9b safety lever or rebalance weights so the default is load-bearing. | Cosmetic/doc; address in 9b if needed |
| S-2 | SUGGESTION | `candidateTargets` over-generation could match an unintended real table (e.g. `statu` from `status` strip). Low likelihood. Tighten `+es` rule (only when stem ends in s/x/z/ch/sh) in a future pass. | Low risk; address in 9b if needed |
| S-3 | SUGGESTION | `normalize.ts` hook comment labels the block "Step 4d"; design says "after step 4c". Cosmetic. | Cosmetic; fix with next normalize.ts touch |

---

## Next Change

**`phase-9b-mongodb`** — the MongoDB adapter: sampling + schema inference consumer; turns the `inferRelationships` gate ON via the `collection`/`field` auto-trigger; completes US-008 end-to-end.

---

## Artifact References

| Artifact | Path |
|----------|------|
| Proposal | `openspec/changes/archive/2026-06-19-phase-9a-inference-engine/proposal.md` |
| Design | `openspec/changes/archive/2026-06-19-phase-9a-inference-engine/design.md` |
| Tasks | `openspec/changes/archive/2026-06-19-phase-9a-inference-engine/tasks.md` |
| Verify report | `openspec/changes/archive/2026-06-19-phase-9a-inference-engine/verify-report.md` |
| Delta: graph-normalization | `openspec/changes/archive/2026-06-19-phase-9a-inference-engine/specs/graph-normalization/spec.md` |
| Delta: graph-model | `openspec/changes/archive/2026-06-19-phase-9a-inference-engine/specs/graph-model/spec.md` |
| Canonical: graph-normalization | `openspec/specs/graph-normalization/spec.md` |
| Canonical: graph-model | `openspec/specs/graph-model/spec.md` |

---

## SDD Cycle Complete

phase-9a-inference-engine has been fully planned, implemented, verified, and archived. The inference engine is proven and golden-safe. Ready for `phase-9b-mongodb`.
