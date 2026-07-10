# Tasks: DOG-4 — Dynamic-SQL honesty hardening

> Standing instructions (apply to EVERY task)
> - STRICT TDD: write the FAILING test FIRST (red → green → refactor) for every change under `src/**`. The task's `Done:` gate must pass before moving on.
> - L-009: assert EXACT strings and EXACT sets, with POSITIVE and NEGATIVE cases. Degraded-node sets are asserted as exact sets, NEVER existence-only.
> - Caveat exact bytes (r1): `[DYNAMIC SQL] impact analysis may be incomplete`. Marker constant (D2): `[DYNAMIC SQL]`.
> - Hexagonal (ADR-004): the marker/helper live in `src/core/present`, exported via `src/core/index.ts`; core imports nothing from adapters/mcp/cli. `exactOptionalPropertyTypes`-clean: degraded flag is present-only, OMITTED otherwise (r2). No new deps (ADR-007). Determinism (ADR-008): `degradedNodeIds` sorted ascending + deduped.
> - The marker is a NODE-attribute caveat: it MUST NEVER emit or fabricate an edge/target. English everywhere. Example names are NEUTRAL (`acme_*`).
> - Per-batch gate must be green BEFORE that batch's single conventional commit. Branch `post-v1` stays local — NO push, ever.

Two apply batches (S-size). Batch A = data mechanics (field + query + engine); Batch B = render surfaces + wiring + docs + freeze. This follows the orchestrator's suggested split (see "Interpretation" note at end — it differs from design §Batching by moving impact render + mcp wiring into Batch B).

### Spec scenario index (referenced by tag below)

- mcp-server: **A1** byte-identical caveat at normal · **A2** full yes / brief no · **A3** non-dynamic negative · **A4** sqlite+mongodb untouched · **B1** precheck exact per-node set · **B2** affected mirrors via shared engine · **B3** sqlite affected byte-identical · **C1** impact names routine + keeps warning · **C2** impact negative.
- graph-query: **Q1** impact names closure node · **Q2** closure negative · **Q3** absent engines unaffected + goldens byte-identical.

---

## Batch A — degraded-node mechanics (field + query + engine)

Parallelizable: A.1 independent; A.2→A.3 sequential; A.4→A.5 sequential. A.6 last.

## Phase 1: Shared marker + caveat helper

- [x] 1.1 RED+GREEN `src/core/present/payload.ts`: add `export const DYNAMIC_SQL_MARKER = '[DYNAMIC SQL]'` and `export function renderDynamicSqlCaveat(node): string[]` returning `['[DYNAMIC SQL] impact analysis may be incomplete']` when `node.payload?.hasDynamicSql === true`, else `[]` (r1 exact bytes; degrade-by-absence). Test `test/core/present/payload.test.ts`: positive → single line === `DYNAMIC_SQL_MARKER + ' impact analysis may be incomplete'`; negatives → `[]` for flag `false`, flag unset, and a non-routine table node. Satisfies A1/A3 helper contract. Done: `npm test -- payload`.

## Phase 2: Impact query names degraded nodes

- [x] 2.1 RED+GREEN `src/core/ports/graph-store.ts`: add `readonly degradedNodeIds: readonly string[]` to `ImpactResult` (KEEP `dynamicSqlWarning`). Update every `ImpactResult` literal in test fakes/fixtures to add `degradedNodeIds: []`. Done: `npx tsc --noEmit`.
- [x] 2.2 RED+GREEN `src/core/query/impact.ts`: replace the boolean loop (:198-209) — collect ids of closure nodes whose payload `hasDynamicSql === true` into `degradedNodeIds`, sorted ascending + deduped (ADR-008); derive `dynamicSqlWarning = degradedNodeIds.length > 0` (r3). Test `test/core/query/impact.test.ts`: positive asserts the EXACT `degradedNodeIds` set for a fake store whose closure includes `acme_run_report` (dynamic) among non-dynamic nodes; negative → `[]` and `dynamicSqlWarning === false`; assert closure EDGE COUNT unchanged (no fabricated edge/target); existing `dynamicSqlWarning` assertions stay green; re-run byte-identical. Satisfies Q1/Q2/Q3. Done: `npm test -- query/impact`.

## Phase 3: Precheck field + engine wiring

- [x] 3.1 RED+GREEN `src/core/present/precheck.ts` (type only): add `readonly hasDynamicSql?: true` to `PrecheckItem` — present ONLY on degraded items, OMITTED otherwise (r2, `exactOptionalPropertyTypes`). No render yet. Done: `npx tsc --noEmit`.
- [x] 3.2 RED+GREEN `src/core/precheck/engine.ts`: set `hasDynamicSql: true` from `node.payload['hasDynamicSql']` at BOTH construction sites — `resolveIdentifiers` (:48, matched) and `buildImpactSection.resolveNode` (:103-106, impact section); OMIT the key when false/absent. Test `test/core/precheck/engine.test.ts`: matched item AND impact-section item for a dynamic routine BOTH carry `hasDynamicSql:true`; an ISOLATED dynamic routine (no inbound edges) is STILL flagged; non-dynamic item OMITS the key; assert the flagged set as an EXACT set (positives+negatives). Feeds `affected --json` (additive key, r2). Satisfies B1/B2 (engine feed). Done: `npm test -- precheck/engine`.

## Phase 4: Batch A gate + commit

- [ ] 4.1 Batch A gate + HARD STOP: `npx tsc --noEmit` clean; `npm run lint` 0 errors / 0 warnings; `npm test` all green, count >= 3595 (grows with new suites). HARD STOP — `git diff` shows ZERO change to any `test/mcp/golden/*.txt`, sqlite/mongodb goldens, extraction goldens (`test/fixtures/**/golden-raw-catalog.json`), `test/golden/normalize/*.json`; static edges reported alongside `hasDynamicSql` UNCHANGED (2.2 edge-count assertion green). Then ONE conventional commit (e.g. `feat(core): identify dynamic-SQL degraded nodes in impact query + precheck engine`). NO push.

---

## Batch B — render surfaces + wiring + docs + freeze

Parallelizable: B.1/B.2 (both consume the 1.1 helper) ∥ B.3 (needs 3.2 field) ∥ B.4/B.5 (need 2.1/2.2) ∥ B.6/B.7. B.8→B.10 last. Whole batch DEPENDS on Batch A.

## Phase 5: Shared caveat in explore + object

- [ ] 5.1 RED+GREEN `src/core/present/explore.ts`: `pushSection(renderDynamicSqlCaveat(view.node))` at normal+full; DELETE the full-only emoji block (:179-183) (D6/r1). Test `test/core/present/explore-format.test.ts`: positive dynamic routine → exact caveat line at normal AND full; brief → NO caveat; negative non-dynamic → none; static neighbors/edges unchanged. Satisfies A1/A2/A3. Done: `npm test -- explore-format`.
- [ ] 5.2 RED+GREEN `src/core/present/object.ts`: import `renderDynamicSqlCaveat`; emit caveat after the PARAMETERS block, before the `normal` early-return (:113→:115), gated normal+full. Test `test/core/present/object-format.test.ts`: positive/negative as in 5.1 AND assert the caveat line is BYTE-IDENTICAL to explore's (shared helper, no per-surface branch). Satisfies A1 (byte-identical)/A2/A3. Done: `npm test -- object-format`.

## Phase 6: Precheck marker render

- [ ] 6.1 RED+GREEN `src/core/present/precheck.ts` (render): append `  [DYNAMIC SQL]` (two-space separator) AFTER the `(confidence: …)` suffix for items carrying `hasDynamicSql`, gated `detail !== 'brief'` (r2 placement). Test `test/core/present/precheck-format.test.ts`: positive item gets the suffix at normal+full; brief matched-objects list byte-identical (NO suffix); negative item → no suffix; confidence stays `'parsed'`; no new edge. Satisfies B1. Done: `npm test -- precheck-format`.

## Phase 7: Impact named block + tool wiring

- [ ] 7.1 RED+GREEN `src/core/present/impact.ts`: keep the existing blanket warning line VERBATIM; below it add ONE line per degraded routine (resolved qname via `view.resolve` + ` [DYNAMIC SQL]`), sorted by qname, at normal+full (D5/r3). Test `test/core/present/impact-format.test.ts`: add `degradedNodeIds` to `DYNAMIC_SQL_RESULT`; assert exact named-node lines; existing `'incomplete'`/`'dynamic SQL'` assertions stay green; negative (empty `degradedNodeIds`) → no named block AND no warning. Satisfies C1/C2. Done: `npm test -- impact-format`.
- [ ] 7.2 RED+GREEN `src/mcp/tools/impact.ts`: add `result.degradedNodeIds` to the id set pre-cached before `resolveSync` (:96-100) so degraded ids resolve to qnames in the named block. Test the impact tool asserts degraded QNAMES (not raw ids) appear. Satisfies C1 wiring. Done: `npm test -- mcp` (impact tool).

## Phase 8: Barrel export + docs note

- [ ] 8.1 GREEN `src/core/index.ts`: export `DYNAMIC_SQL_MARKER` from the barrel (L-009 exact-string tests import it). Test `test/core/present/barrel.test.ts` asserts the symbol is exported. Done: `npm test -- barrel`.
- [ ] 8.2 `docs/format-spec.md` §6: add the ONE-LINE token-delta note for the caveat line (r4). NO change to budget ceilings or `test/core/present/budget.test.ts` (sqlite goldens never render the caveat). Done: `npm test -- budget` green and UNCHANGED.

## Phase 9: Freeze proofs + optional live + gate + commit

- [ ] 9.1 HARD-STOP freeze proofs (assert, do NOT re-bless): run the golden suites and confirm BYTE-IDENTICAL — ALL `test/mcp/golden/*.txt` (sqlite-backed), sqlite + mongodb render/e2e goldens, extraction goldens (`golden-raw-catalog.json`), `test/golden/normalize/*.json`, and the `brief` matched-objects output. Satisfies A4/B3/Q3. Done: those suites green with EMPTY `git diff --stat` for all golden paths.
- [ ] 9.2 OPTIONAL (NOT a gate): add ONE thin render assertion per engine to `test/adapters/engines/{mssql,pg,mysql}/e2e.integration.test.ts` — `[DYNAMIC SQL]` appears in explore/precheck output on the real `EXEC`/`EXECUTE`/`PREPARE` routine (r5). Low marginal signal; skip if Docker unavailable. MUST NOT block the batch gate.
- [ ] 9.3 Batch B gate: `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` all green, count >= 3595 (+ new suites). Then ONE conventional commit (e.g. `feat(present): surface [DYNAMIC SQL] caveat in explore/object/precheck/impact (DOG-4)`). NO push.

---

## Definition of Done

- [ ] All 12 spec scenarios covered (A1–A4, B1–B3, C1–C2, Q1–Q3), each with POSITIVE and NEGATIVE assertions (L-009).
- [ ] r1 — caveat exact bytes `[DYNAMIC SQL] impact analysis may be incomplete` via the shared helper; byte-identical explore ≡ object; normal+full only, never brief; old emoji line (explore.ts:179-183) DELETED.
- [ ] r2 — `PrecheckItem.hasDynamicSql?: true` present-only-on-degraded (omitted otherwise); `--json` key additive; text suffix `  [DYNAMIC SQL]` after `(confidence: …)`.
- [ ] r3 — `degradedNodeIds` sorted+deduped implements the graph-query delta; blanket warning PRESERVED verbatim; impact named block is one-line-per-routine sorted by qname.
- [ ] r4 — `docs/format-spec.md` §6 one-line note added; budgets + measured goldens UNCHANGED.
- [ ] r5 — torture fixtures reused (no fixture addition); degraded sets re-blessed as EXACT sets.
- [ ] HARD STOPs green: mcp goldens, sqlite/mongodb goldens, extraction goldens, normalize goldens, and brief output all BYTE-IDENTICAL; static edges unchanged; ZERO fabricated edges/targets.
- [ ] Per-batch gate (tsc clean / lint 0-0 / npm test >= 3595) passed before EACH of the TWO commits.
- [ ] Exactly TWO commits (one per batch), conventional; branch `post-v1` NOT pushed.
- [ ] Only files listed in design §File Changes touched; extraction specs and `openspec/` outside this change UNTOUCHED.

## Interpretation notes (ambiguities resolved)

1. Batch split follows the orchestrator's explicit suggestion (impact render `present/impact.ts` + `mcp/tools/impact.ts` + `core/index.ts` export in Batch B), which differs from design §Batching (those were in Batch A). Chosen the orchestrator directive as binding for this run. Dependency-safe: Batch A ships the `degradedNodeIds` data and `hasDynamicSql` field; Batch B only renders/wires them.
2. `PrecheckItem.hasDynamicSql` typed as `?: true` (r2, present-only) rather than design §Interfaces' `?: boolean` — r2 overrides the earlier interface snippet.
3. The impact blanket warning (spec wording "impact possibly incomplete") and the new caveat line (r1 "impact analysis may be incomplete") are DIFFERENT strings; 7.1 preserves the existing warning verbatim and does NOT reword it to match r1.
4. `affected --json` field coverage is validated under scenario B2 (mcp-server spec) since the `cli-config` delta was not in scope for this reading.
5. Test-count floor read literally as 3595 (a floor, never a ceiling): each batch keeps `npm test` green at >= 3595 and grows it with the new synthetic suites.
