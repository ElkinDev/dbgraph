# Proposal: Phase 9a — Structural Inference Engine (shared, opt-in, pure-core)

> **PLANNING — Phase 9 SPLIT, part A of two (split LOCKED by the user).** Phase 9 (the final
> Núcleo-5 engine, MongoDB) is divided into **`phase-9a-inference-engine`** (THIS change — pure core,
> no driver, unit-testable WITHOUT Docker) and **`phase-9b-mongodb`** (the adapter that consumes 9a).
> 9a realizes US-008 as a SHARED inference engine; 9b adds sampling + the `mongodb` driver and turns
> inference ON. The Phase-1 stub already exists: `inferred_reference` is in `EDGE_KINDS`, `EdgeConfidence`
> includes `'inferred'`, and `GraphEdge.score: number | null` is present — **NO edge-model change is needed.**

## Intent

US-008 promises relationships for legacy databases and document stores that declare NO foreign keys,
so the graph is "not empty of edges". Today that promise is a TYPE-ONLY stub. We need the ALGORITHM:
a deterministic, name-convention + type-compatibility scorer that emits `inferred_reference` edges with
a calibrated `score`. Doing this FIRST, as engine-agnostic pure core fully covered by fixture-`NodeMap`
unit tests, **DE-RISKS the algorithm before MongoDB's sampling complexity lands** — when 9b plugs in
sampled `collection`/`field` nodes, the scoring is already proven and golden-pinned. Critically, this
must NOT perturb the four shipped SQL engines: activating inference globally would inject new edges into
pg/mysql/mssql/sqlite graphs and BREAK their goldens — undetectable until the end-of-project single-merge
CI. Hence inference is **OPT-IN, default OFF**.

## Scope

### In Scope
- **`src/core/infer/`** — a PURE core module (ADR-004: imports only core model types; no adapter/driver/
  cli/mcp; no `child_process`; no I/O). Primary unit: `infer-references.ts` with
  `inferReferences(nodes, options): GraphEdge[]` producing `inferred_reference` edges
  (`confidence: 'inferred'`, `score ∈ [0,1]`, `attrs.srcColumn`/`dstColumn` for the join grain).
- **Name-convention matching (US-008):** `<entity>_id`, `<entity>Id`, `id_<entity>`; singular/plural
  resolution (`customer_id` → `customers` OR `customer`); Mongo `_id` / `ObjectId` handled for 9b reuse.
- **Type compatibility:** int↔int/bigint compatible; `ObjectId`↔`_id`; string↔string; mismatched families
  rejected. A documented, calibrated **score formula** (convention strength + type-compat + target-is-PK)
  and a **threshold** below which NO edge is emitted (the `status_id`-with-no-`status*`-table case).
- **The normalizer hook — GATED, opt-in:** a single call site in `normalize.ts` AFTER step 4c
  (dependencies) and BEFORE step 6 (ordering), reached ONLY when the opt-in gate is set.
- **The opt-in gate (CHOSEN below):** an explicit `ExtractionScope.inferRelationships?: boolean`
  (default `false`), with a documented SECONDARY auto-trigger when `collection`/`field` nodes are present.
- **Determinism (ADR-008):** stable ordering of emitted edges (by `src`, `dst`, `score`) with deterministic
  tie-breaking; golden-pinned against fixture `NodeMap`s.
- **Exhaustive unit tests** (no Docker) + the **`graph-normalization` delta** and a **`graph-model`
  clarification** (lift the "deferred to Phase 9" wording now that scoring is real).
- **Refine US-008** in `docs/stories/02-graph-core.md` (mark Phase 9a; pin score ≥ 0.8 example; add the
  opt-in + determinism criteria).

### Out of Scope
- **The MongoDB adapter, sampling, the `mongodb` driver, and ANY dispatch/registry touch point** — that is
  **`phase-9b-mongodb`**. 9a ships ZERO engine wiring.
- **Turning inference ON for the SQL engines by default** — they stay OFF (goldens byte-identical); they MAY
  opt in later, but no SQL scope sets the flag in this change.
- **Field-frequency / union-type / optional-field modelling** from sampled documents — 9b's concern; 9a
  scores whatever `field`/`column` nodes it is handed.
- **No edge-model change** (the type already exists); **no new npm dependency** (pure core).

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None. Inference is a behavior of normalization, not a new capability surface.

### Modified Capabilities
- `graph-normalization`: ADD a requirement that, WHEN inference is enabled via the opt-in gate, the
  normalizer emits `inferred_reference` edges (`confidence: inferred`, scored, thresholded, deterministic)
  from node names + types alone; and that WHEN the gate is OFF the output is UNCHANGED (existing SQL goldens
  byte-identical). The boundary/determinism requirement extends to `src/core/infer/`.
- `graph-model`: CLARIFY the `inferred_reference` requirement — scoring is NO LONGER "deferred to Phase 9";
  define `score ∈ [0,1]` and the rule that an inferred edge ALWAYS carries a numeric score (already true in
  the type). No structural type change.

## Approach

**Pure scorer + gated hook.** `inferReferences` receives the already-built nodes (the normalizer passes
`[...nodeMap.values()]`) plus typed `options` (threshold, optional convention toggles). It (1) indexes
candidate TARGET nodes by their owning table/collection name and PK columns, (2) for every `column`/`field`
node tests the convention patterns to extract a candidate entity name, (3) resolves that entity against the
target index (singular/plural), (4) checks type compatibility, (5) computes `score = w_conv·conv +
w_type·typeCompat + w_pk·targetIsPk`, and (6) emits an `inferred_reference` edge (reconstructing target IDs
via the existing deterministic `nodeId(kind, qname)`) ONLY when `score ≥ threshold`. No raw data values are
read — only node NAMES and TYPES already in the graph (dbgraph-security).

**The opt-in gate (DECISION):** add OPTIONAL `inferRelationships?: boolean` to `ExtractionScope` (default
`false`). The normalizer invokes the hook when `scope.inferRelationships === true` OR (secondary, documented)
when the graph contains `collection`/`field` nodes — so 9b's Mongo path is inference-ON by construction while
SQL stays OFF. Because every existing SQL `ExtractionScope` leaves the flag unset and produces no
`collection`/`field` nodes, **the hook is never reached for the shipped engines and their goldens stay
byte-identical** — the core no-CI safety guarantee.

**Determinism:** emitted edges feed the existing `sortEdges`, but since that comparator ignores `score`, the
infer module sorts its own output by `(src, dst, score, srcColumn)` with a final `id` tie-break BEFORE
returning, and the spec/golden pin that order. Same input `NodeMap` → byte-identical edge array (ADR-008),
golden-pinnable.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/infer/infer-references.ts` | New | `inferReferences(nodes, options): GraphEdge[]` — the scorer (pure, ADR-004) |
| `src/core/infer/conventions.ts` | New | Convention patterns (`<e>_id`/`<e>Id`/`id_<e>`) + singular/plural resolution |
| `src/core/infer/type-compat.ts` | New | Type-family compatibility (int/bigint; `ObjectId`↔`_id`; string↔string) |
| `src/core/infer/index.ts` | New | Barrel for the infer module |
| `src/core/model/capability.ts` | Modified | OPTIONAL `inferRelationships?: boolean` on `ExtractionScope` (default false) |
| `src/core/normalize/normalize.ts` | Modified | Gated hook after step 4c / before step 6; pushes inferred edges |
| `src/core/model/edge.ts` | Unchanged | `inferred_reference` / `inferred` / `score` already exist — NO change |
| `openspec/specs/graph-normalization/spec.md` | Modified (delta) | New scored-inference + gate-off-is-byte-identical requirements |
| `openspec/specs/graph-model/spec.md` | Modified (delta) | Clarify `inferred_reference` scoring is no longer deferred |
| `test/core/infer/*.test.ts` + fixtures | New | Fixture-`NodeMap` unit tests; goldens; gate-off byte-identical assertion |
| `docs/stories/02-graph-core.md` | Modified | Refine US-008 (Phase 9a; score example; opt-in + determinism criteria) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Enabling inference injects edges into SQL graphs → breaks pg/mysql/mssql/sqlite goldens (undetectable until end-of-project CI) | High if global | **Opt-in, default OFF**: `inferRelationships` unset + no `collection`/`field` nodes → hook never runs; an explicit test re-normalizes an existing SQL fixture and asserts the edge array is byte-identical to its golden |
| Over-matching → false-positive edges (e.g. `status_id` with no `status` table) | Med | Resolve against ACTUAL target nodes only; require type compatibility; apply the score `threshold` (no target / weak match → no edge) — pinned by a negative golden |
| Non-deterministic edge ordering (same input, different array) | Med | Infer module sorts `(src, dst, score, srcColumn)` + `id` tie-break before returning; golden-pinned; re-run-equality test |
| Singular/plural over-eager (maps `addresses`→`addres`) | Low | Conservative, documented pluralization rules; both forms tried against real targets only; covered by exact-set tests |
| Score formula weights drift / become unauditable | Low | Weights + threshold are named, documented constants in one file; golden scores assert exact values (L-009 exact-set) |
| `ExtractionScope` change pressures consumers | Low | Field is OPTIONAL with a default; no existing call site must change; `tsc` proves total coverage |

## Rollback Plan

Purely additive and back-compatible. Revert by: deleting `src/core/infer/`; removing the gated hook block
from `normalize.ts`; removing the optional `inferRelationships` field from `ExtractionScope`; dropping the
infer tests/fixtures and the two spec deltas; reverting the US-008 wording. The edge model is UNTOUCHED, so
nothing downstream regresses. The four shipped SQL engines, storage, query, and connectivity stay intact and
green; their goldens were never altered (gate default OFF).

## Dependencies

- Builds on US-006 (normalization) and the Phase-1 `inferred_reference` stub — REQUIRED predecessors (both shipped).
- **`phase-9b-mongodb` DEPENDS ON this change** — 9b consumes `inferReferences` and turns the gate ON; 9a ships
  with NO MongoDB driver and NO dispatch.
- ZERO new npm dependencies (pure core; uses existing `node:crypto`-based `nodeId`/`edgeId`). ADR-004/007/008 intact.

## Recommended Apply Batch Ordering (for the future apply phase)

1. **Conventions + type-compat (pure, isolated):** `conventions.ts` + `type-compat.ts` with RED→GREEN exact-set
   unit tests (entity extraction, singular/plural, type-family compatibility) — no normalizer touch yet.
2. **The scorer:** `infer-references.ts` (`inferReferences`) + the documented score formula/threshold; fixture-
   `NodeMap` tests asserting EXACT inferred edges (src+dst qnames + score) AND the negative case (no edge); the
   self-sort determinism test (re-run byte-identical). Barrel.
3. **The opt-in gate + hook:** add `inferRelationships?: boolean` to `ExtractionScope`; wire the gated call in
   `normalize.ts` (after 4c, before 6). Test: gate ON → inferred edges appear in a Mongo-shaped fixture; gate OFF
   on an existing SQL fixture → edge array BYTE-IDENTICAL to its golden.
4. **Specs + story:** `graph-normalization` + `graph-model` deltas; refine US-008. Boundary lint sweep over
   `src/core/infer/`; `tsc`/lint/test clean.

## Success Criteria (acceptance)

- [ ] `inferReferences` emits `inferred_reference` edges with `confidence: inferred` and `score ∈ [0,1]`;
      `orders.customer_id`(int) → `customers.id`(int, PK) scores ≥ 0.8 on a fixture `NodeMap` (US-008 example).
- [ ] `orders.status_id` with NO `status*` target produces NO edge (negative golden); thresholded, no inventions.
- [ ] Conventions covered: `<entity>_id`, `<entity>Id`, `id_<entity>`, singular AND plural — each asserted with
      EXACT src+dst qnames + score (L-009 exact-set, never existence-only).
- [ ] Inference is OPT-IN: gate OFF (and no `collection`/`field` nodes) → re-normalizing an existing SQL fixture
      yields an edge array BYTE-IDENTICAL to its golden (the four shipped engines untouched).
- [ ] Same input `NodeMap` → byte-identical inferred-edge array across runs (ADR-008); golden-pinned.
- [ ] `src/core/infer/` imports nothing outside core model types (ADR-004 boundary lint clean); no `child_process`,
      no I/O, no raw data values read — only node names/types (dbgraph-security).
- [ ] ZERO new npm dependencies; the `inferred_reference` edge model is unchanged; `tsc`/lint/test all green.
- [ ] `graph-normalization` + `graph-model` deltas merged; US-008 refined (Phase 9a, opt-in, determinism) in
      `docs/stories/02-graph-core.md`.
