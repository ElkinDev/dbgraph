# Design: DOG-4 — Dynamic-SQL honesty hardening

## Technical Approach

Surface an already-flowing flag; compute nothing new. `payload.hasDynamicSql` (node.ts:114 `RoutinePayload`, :125 `TriggerPayload`) is detected, propagated, persisted. DOG-4 adds ONE marker constant `[DYNAMIC SQL]` and reads that flag at four render surfaces (explore, object, precheck, impact) via the seams each surface already has. Zero traversal, zero catalog query, zero deps. All changes additive and revertible.

Citations verified against current code: explore full-only emoji gate (explore.ts:173-183), object has zero `hasDynamicSql` (confirmed), `PrecheckItem` (precheck.ts:24-29), `ImpactResult.dynamicSqlWarning` boolean loop (impact.ts:198-209), shared render helpers (payload.ts, imported by both explore.ts and object.ts).

## Architecture Decisions

### D1 — Degraded-node mechanism (the central ruling)

**Choice**: A single **degradation predicate + marker constant** in `present/payload.ts` is the seam. Each consumer reaches the data through the access it ALREADY has:
- **Impact render** — `getImpact` surfaces `ImpactResult.degradedNodeIds: readonly string[]` (single site). FORCED, because `formatImpact` receives only `ImpactResult` + a qname resolver (impact.ts:32-36) — it has NO node/payload access. And `getImpact` ALREADY loads every chain node to flip `dynamicSqlWarning` (impact.ts:203-209); collecting the IDs instead is free (DOG-1's "pay for the seam once": `IMPACT_EDGE_KINDS` was later a one-liner).
- **Precheck items** — read `node.payload['hasDynamicSql']` DIRECTLY at the two construction sites, because precheck ALREADY holds the full node there: `resolveIdentifiers` (engine.ts:48, `getNodeByQName` → node) and `buildImpactSection.resolveNode` (engine.ts:103-106, `getNode` → node). Both discard `.payload` today.

**Alternatives considered**:
| Option | Why rejected |
|---|---|
| Route precheck through `ImpactResult.degradedNodeIds` too | Precheck's `matchedObjects` never pass through `getImpact`; an ISOLATED degraded routine (no inbound edges) is absent from `completedChains` → false negative. And `resolveNode` already holds the node, so the round-trip is pure overhead. |
| Payload-read at impact render (extend `ImpactView` with a `degraded(id)` resolver) | Forces the tool to RE-READ every chain node from the store — `getImpact` already read them and threw them away. Doubles reads. |

**Rationale**: The single seam that both consumers genuinely share is the **predicate** `payload.hasDynamicSql === true` and the **marker constant**, not a data field — because the two consumers have structurally different data access. `getImpact` pays the read once for the render-only consumer; precheck reads in place for its own. `dynamicSqlWarning` stays derived (`degradedNodeIds.length > 0`) for compatibility (orchestrator ruling #1).

### D2 — Marker string
**Choice**: exact constant `DYNAMIC_SQL_MARKER = '[DYNAMIC SQL]'`, UPPERCASE bracket family (DOG-2 `[OUT]`/`[INOUT]` precedent). **Rationale**: orthogonal to `confidence` (stays `declared|parsed`, no new tier). It is a NODE attribute caveat — never an edge, never a fabricated target (ADR-007). One exported constant → zero drift across the four surfaces.

### D3 — Shared caveat renderer
**Choice**: `renderDynamicSqlCaveat(node): string[]` in `payload.ts` (returns `[]` when the flag is absent/false). explore.ts and object.ts both `push` it → caveat line is BYTE-IDENTICAL across surfaces (proposal's "one shared payload-render discipline"). **Rationale**: payload.ts is verified shared post explore-payloads; a per-kind renderer that no-ops for tables/views is the existing pattern (`renderParameters`, `renderConsumedColumns`).

### D4 — Detail threshold
**Choice**: caveat at `normal` + `full`; `brief` FROZEN (counts/matched-list only). Precheck marker gated to `detail !== 'brief'` so the brief matched-objects list stays byte-identical. **Rationale**: orchestrator ruling #3.

### D5 — Impact render shape
**Choice**: KEEP the existing `dynamicSqlWarning` advisory line (preserves impact-format assertions on `'incomplete'`/`'dynamic SQL'`) AND add a NAMED degraded-node block (marker + resolved qname) at normal+full. **Rationale**: ruling #1 "degraded routine nodes NAMED" while minimizing golden churn; inline per-node marks inside `a → b → c` chains read poorly.

### D6 — Old explore emoji line
**Choice**: DELETE explore.ts:179-183 (full-only `⚠ hasDynamicSql …`), replaced by the shared normal+full caveat. **Rationale**: no test/golden asserts it (verified: explore-format.test.ts has zero dynamic assertion; explore-full.txt is SQLite → line never appears), so removal is clean; avoids a duplicate second warning.

## Data Flow

    adapter → normalize → payload.hasDynamicSql (persisted, UNCHANGED)
                                   │
          ┌────────────────┬──────┴───────┬─────────────────┐
     explore.ts        object.ts     precheck engine     getImpact
     (view.node)      (view.node)   (node in hand ×2)   (reads flag)
          │                │              │                  │
   renderDynamicSqlCaveat(node)      PrecheckItem        ImpactResult
     [normal+full]                  .hasDynamicSql      .degradedNodeIds
          │                │              │                  │
       formatExplore   formatObject   formatPrecheck     formatImpact
                         ── all emit `[DYNAMIC SQL]` (D2 constant) ──

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/present/payload.ts` | Modify | Add `DYNAMIC_SQL_MARKER` const + `renderDynamicSqlCaveat(node)` helper |
| `src/core/ports/graph-store.ts` | Modify | `ImpactResult.degradedNodeIds: readonly string[]` (keep `dynamicSqlWarning`) |
| `src/core/query/impact.ts` | Modify | Collect degraded ids (replace boolean loop :198-209); `dynamicSqlWarning = degradedNodeIds.length>0` |
| `src/core/present/impact.ts` | Modify | Named degraded-node block via `view.resolve` at normal+full; keep warning line |
| `src/mcp/tools/impact.ts` | Modify | Add `result.degradedNodeIds` to the pre-cache set before `resolveSync` (:96-100) |
| `src/core/present/precheck.ts` | Modify | `PrecheckItem.hasDynamicSql?: boolean`; append marker in item render (normal+full) |
| `src/core/precheck/engine.ts` | Modify | Set `hasDynamicSql` from node payload at both sites (:48 matched, :103-106 impact) |
| `src/core/present/explore.ts` | Modify | `pushSection(renderDynamicSqlCaveat(view.node))` at normal+full; delete emoji block :179-183 |
| `src/core/present/object.ts` | Modify | Import + emit caveat after PARAMETERS, before normal early-return (:113→:115) |
| `src/core/index.ts` (barrel) | Modify | Export `DYNAMIC_SQL_MARKER` (L-009 exact-string tests import it) |

CLI `explore`/`object`/`affected` inherit automatically (formatter-only change; they already pass the full `node`). `dbgraph_precheck` MCP tool is text-only (no wiring). No `dbgraph impact` CLI exists — `formatImpact` has ONE call site.

## Interfaces / Contracts

```ts
// ports/graph-store.ts
interface ImpactResult {
  readonly readImpact: readonly ImpactChain[];
  readonly writeImpact: readonly ImpactChain[];
  readonly truncated: boolean;
  readonly dynamicSqlWarning: boolean;        // KEPT — derived: degradedNodeIds.length > 0
  readonly degradedNodeIds: readonly string[];// NEW — sorted, deduped
}
// present/precheck.ts
interface PrecheckItem { readonly qname: string; readonly kind: string;
  readonly confidence: 'parsed'; readonly hasDynamicSql?: boolean; } // NEW optional
// present/payload.ts
export const DYNAMIC_SQL_MARKER = '[DYNAMIC SQL]';
export function renderDynamicSqlCaveat(node: GraphNode): string[]; // [] when flag falsey
```

## Golden Churn Inventory

**FROZEN — HARD STOP (byte-identical, must not change):**
- `test/mcp/golden/*.txt` — ALL (SQLite torture backing → no dynamic SQL). explore/object/precheck/impact tool goldens included.
- `docs/format-spec.md` + `test/core/present/budget.test.ts` ceilings — NO byte delta (caveat never appears in SQLite goldens).
- `test/fixtures/{mssql,pg,mysql,sqlite}/golden/golden-raw-catalog.json` — extraction untouched.
- `test/golden/normalize/*.json`; any sqlite/mongodb render/e2e.

**CHANGED / NEW (unit, synthetic `hasDynamicSql:true` fixtures — L-009 exact sets):**
- `explore-format.test.ts`, `object-format.test.ts`, `precheck-format.test.ts` — positive (marker present) + negative (routine w/o dynamic SQL → NO marker; static edges unchanged).
- `impact-format.test.ts` — add `degradedNodeIds` to `DYNAMIC_SQL_RESULT`; assert named nodes; existing `'incomplete'`/`'dynamic SQL'` stay green.
- `query/impact.test.ts` — assert `degradedNodeIds`; existing `dynamicSqlWarning` stays green.
- `precheck/engine.test.ts` — assert item `hasDynamicSql`; `payload.test.ts` — `renderDynamicSqlCaveat` unit.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (render) | marker at normal+full, absent at brief; negative = no marker | synthetic GraphNode, exact-string vs `DYNAMIC_SQL_MARKER` |
| Unit (query) | `getImpact` names exact degraded ids; boolean preserved; NEVER an extra edge | fake store, assert edge count unchanged |
| Unit (engine) | matched + impact-section items flagged; isolated degraded routine still flagged | fake store |
| Live (Docker) | end-to-end propagation on REAL `EXEC`/`EXECUTE`/`PREPARE` | mssql/pg/mysql `e2e.integration` ALREADY assert `hasDynamicSql` extraction (untouched, green). ADD one thin render assertion per engine (`[DYNAMIC SQL]` in explore/precheck output) ONLY if cheap — marginal signal LOW: extraction+propagation already covered; render fully covered by pure unit tests. |

Live tiers add signal ONLY for the adapter→render round-trip; the render CONTRACT lives in the deterministic unit tests.

## Batching (S — 2 batches)

- **Batch A — core seam + precheck**: `ImpactResult.degradedNodeIds` + `getImpact`; `payload.ts` const+helper; `precheck.ts` type+render; engine wiring; `impact.ts` render + mcp impact pre-cache. Tests: query/precheck/impact-format/payload.
- **Batch B — explore/object surface + verify + close**: explore.ts + object.ts caveat; explore/object format tests; CONFIRM mcp goldens frozen; optional live render assertions; `tsc`/lint/full test.

## Reconciliation flags for the spec

- **PIN exact bytes** (goldens depend on them): caveat line prose after `[DYNAMIC SQL]` in explore/object; precheck marker placement (append `  [DYNAMIC SQL]`, AFTER `(confidence: …)` at full); impact named-block header + rows.
- `PrecheckItem.hasDynamicSql` surfaces in `dbgraph affected --json` (full `PrecheckView` serialized) — spec MUST document the JSON field (additive, optional).
- `ImpactResult.degradedNodeIds` is a `graph-query` port delta — spec MUST record it (additive; `dynamicSqlWarning` preserved).
- Marker gated to `normal`+`full` on ALL surfaces; `brief` frozen.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `affected --json` gains a field (CLI consumers) | Med | Optional/additive; document in cli-config spec |
| `degradedNodeIds` port change ripples to graph-store impls/fakes | Low | Additive field; test fakes construct `ImpactResult` — update the few literals |
| impact tool `resolveSync` misses a degraded id | Low | Explicitly add ids to pre-cache set (D1 wiring) |
| Marker read as a fabricated edge | Low | Node caveat only; query tests assert zero new edges |
| format-spec.md budget breach | None | SQLite goldens frozen — caveat never enters measured output |

## Open Questions
- [ ] None blocking. Exact prose strings deferred to spec (flagged above) — design pins structure, positions, and the marker constant.

## Reconciliation (orchestrator rulings, 2026-07-10 — BINDING for tasks/apply/verify)

Spec (deltas mcp-server + graph-query) and this design were written in parallel; reconciled as follows:

- **(r1) Caveat line exact bytes**: `[DYNAMIC SQL] impact analysis may be incomplete` — one line, produced by the shared `renderDynamicSqlCaveat` helper (D3), byte-identical across explore and object, rendered at `normal` AND `full`, never at `brief`. The prose deliberately reuses the existing full-only warning's wording ("impact analysis may be incomplete") minus the emoji; the old `⚠  hasDynamicSql — …` full-only line at explore.ts:179-183 is DELETED (D6), replaced by this line at both thresholds.
- **(r2) Precheck/affected field + placement**: `PrecheckItem.hasDynamicSql?: true` — present ONLY on degraded items, OMITTED otherwise (degrade-by-absence family, `exactOptionalPropertyTypes`-clean). The `--json` key is `hasDynamicSql` (additive; absent on non-degraded items — consumers must treat absence as false). Text render appends `  [DYNAMIC SQL]` after the `(confidence: …)` suffix, exactly as flagged in this design.
- **(r3) Impact mechanism + render shape**: `ImpactResult.degradedNodeIds` (D1) is RATIFIED as the implementation of the graph-query delta's "IMPLEMENTATION choice" clause — sorted ascending + deduped for ADR-008 determinism. Render: blanket warning line PRESERVED verbatim; below it, one line per degraded routine (qname + `[DYNAMIC SQL]` marker), sorted by qname.
- **(r4) format-spec contradiction resolved**: the mcp-server delta requires a `docs/format-spec.md` §6 token-delta note; this design declared format-spec untouched. Ruling: add the ONE-LINE documentation note for the caveat line in §6 (it is the format contract doc) — budgets and measured goldens remain untouched (sqlite-backed, caveat never enters them), so both statements hold: doc note YES, budget/golden change NO.
- **(r5) Fixture reality confirmed**: mssql/pg/mysql live e2e suites already assert `hasDynamicSql` extraction (this design's live-tier note), so the torture fixtures DO contain dynamic-SQL routines — no fixture addition needed; apply re-blesses exact degraded-node sets from them (L-009).
