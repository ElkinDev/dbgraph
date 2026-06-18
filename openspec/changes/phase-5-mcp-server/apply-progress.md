# Apply Progress — phase-5-mcp-server (Batch A)

**Change**: phase-5-mcp-server
**Mode**: Strict TDD (RED→GREEN per task)
**Batch**: A (tasks 1.1–1.10)
**Date**: 2026-06-17

---

## Completed Tasks

- [x] 1.1 `docs/format-spec.md` authored: line grammar, brief/normal/full levels, pagination contract, golden discipline, token budget table (all TBD until measured), `ceil(chars/4)` methodology.
- [x] 1.2 `src/core/present/search.ts` + `test/core/present/search-format.test.ts`: `formatSearch(SearchView, SearchDetail)` PURE. 22 tests. Goldens: `search-{brief,normal,full}.txt`.
- [x] 1.3 `src/core/present/object.ts` + `test/core/present/object-format.test.ts`: `formatObject(ObjectView, ObjectDetail)` PURE; columns/PK/FK/indexes/triggers; metadata omission stated explicitly. 21 tests. Goldens: `object-{brief,normal,full}.txt`.
- [x] 1.4 `src/core/present/related.ts` + `test/core/present/related-format.test.ts`: `formatRelated(ExploreView, RelatedDetail)` PURE; inferred edges in separate group with score. Reuses ExploreView. 18 tests. Goldens: `related-{brief,normal,full}.txt`.
- [x] 1.5 `src/core/present/impact.ts` + `test/core/present/impact-format.test.ts`: `formatImpact(ImpactView, ImpactDetail)` PURE; visible chain a→b→c, READ/WRITE split, truncation + dynamic-SQL warnings. 22 tests. Goldens: `impact-{brief,normal,full}.txt`.
- [x] 1.6 `src/core/present/path.ts` + `test/core/present/path-format.test.ts`: `formatPath(PathView)` PURE; join columns per hop; inferred mark; no-route + neighbor suggestion. 12 tests. Goldens: `path-found.txt`, `path-noroute.txt`.
- [x] 1.7 `src/core/present/status.ts` + `test/core/present/status-format.test.ts`: `formatStatus(McpStatusView, StatusDetail)` PURE; engine/version, last sync, drift reporting (connectionless / detected / none). 21 tests. Goldens: `status-{brief,normal,full}.txt`.
- [x] 1.8 `src/core/present/precheck.ts` + `test/core/present/precheck-format.test.ts`: `formatPrecheck(PrecheckView, PrecheckDetail)` PURE; matched objects + aggregated impact sections; confidence:parsed tags (full only); unmatched identifiers (full only). 21 tests. Goldens: `precheck-{brief,normal,full}.txt`.
- [x] 1.9 `src/core/index.ts` updated: re-exports formatSearch/formatObject/formatRelated/formatImpact/formatPath/formatStatus/formatPrecheck + all view/detail types. New `test/core/present/barrel.test.ts` (8 tests). `npx tsc --noEmit` clean.
- [x] 1.10 Golden files committed under `test/core/present/golden/`; 20 golden files for formatter×detail; determinism assertions (byte-identical re-run) pass for all formatters.

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `docs/format-spec.md` (doc) | N/A — doc only | N/A (new) | N/A (doc) | N/A (doc) | Triangulation skipped: doc has no logic | N/A |
| 1.2 | `test/core/present/search-format.test.ts` | Unit | N/A (new) | Written (import fails) | 22/22 | 4 pagination cases + empty case | Clean |
| 1.3 | `test/core/present/object-format.test.ts` | Unit | N/A (new) | Written (import fails) | 21/21 | metadata omission + full body cases | Clean |
| 1.4 | `test/core/present/related-format.test.ts` | Unit | N/A (new) | Written (import fails) | 18/18 | inferred edges separate + score in full | Clean |
| 1.5 | `test/core/present/impact-format.test.ts` | Unit | N/A (new) | Written (import fails) | 22/22 | truncation + dynamic-SQL warn cases | Clean |
| 1.6 | `test/core/present/path-format.test.ts` | Unit | N/A (new) | Written (import fails) | 12/12 | no-route + inferred route cases | Clean |
| 1.7 | `test/core/present/status-format.test.ts` | Unit | N/A (new) | Written (import fails) | 21/21 | drift detected / not checked / none cases | Clean |
| 1.8 | `test/core/present/precheck-format.test.ts` | Unit | N/A (new) | Written (import fails) | 21/21 | brief/normal/full + unmatched identifiers | Clean |
| 1.9 | `test/core/present/barrel.test.ts` | Unit | N/A (new) | Written (exports missing) | 8/8 | N/A (structural) | Clean |
| 1.10 | All present tests (golden assertions) | Unit | Covered by 1.2–1.8 | Covered by 1.2–1.8 | 159/159 | Determinism tests per formatter | Clean |

---

## Test Summary

- **Total tests written (Batch A new)**: 167 (159 present suite + 8 barrel)
- **Total tests passing**: 1021 (full suite, `npm test`)
- **Layers used**: Unit (167)
- **Approval tests** (refactoring): None — no refactoring tasks
- **Pure functions created**: 7 (formatSearch, formatObject, formatRelated, formatImpact, formatPath, formatStatus, formatPrecheck)

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `docs/format-spec.md` | Created | Compact line grammar, detail levels, pagination, golden discipline, budget table (all TBD) |
| `src/core/present/search.ts` | Created | `formatSearch` PURE formatter: ranked hits + pagination footer |
| `src/core/present/object.ts` | Created | `formatObject` PURE formatter: columns/constraints/indexes/triggers/body |
| `src/core/present/related.ts` | Created | `formatRelated` PURE formatter: declared + inferred edges grouped by kind |
| `src/core/present/impact.ts` | Created | `formatImpact` PURE formatter: READ/WRITE chain split + warnings |
| `src/core/present/path.ts` | Created | `formatPath` PURE formatter: hop route with join columns or no-route neighbors |
| `src/core/present/status.ts` | Created | `formatStatus` PURE formatter: engine/sync/drift/counts/levels/excluded |
| `src/core/present/precheck.ts` | Created | `formatPrecheck` PURE formatter: matched objects + impact sections + confidence tags |
| `src/core/index.ts` | Modified | Re-export all new formatters + view/detail types |
| `test/core/present/search-format.test.ts` | Created | 22 tests for formatSearch |
| `test/core/present/object-format.test.ts` | Created | 21 tests for formatObject |
| `test/core/present/related-format.test.ts` | Created | 18 tests for formatRelated |
| `test/core/present/impact-format.test.ts` | Created | 22 tests for formatImpact |
| `test/core/present/path-format.test.ts` | Created | 12 tests for formatPath |
| `test/core/present/status-format.test.ts` | Created | 21 tests for formatStatus |
| `test/core/present/precheck-format.test.ts` | Created | 21 tests for formatPrecheck |
| `test/core/present/barrel.test.ts` | Created | 8 tests verifying barrel re-exports |
| `test/core/present/golden/search-{brief,normal,full}.txt` | Created | Golden files for formatSearch |
| `test/core/present/golden/object-{brief,normal,full}.txt` | Created | Golden files for formatObject |
| `test/core/present/golden/related-{brief,normal,full}.txt` | Created | Golden files for formatRelated |
| `test/core/present/golden/impact-{brief,normal,full}.txt` | Created | Golden files for formatImpact |
| `test/core/present/golden/path-found.txt` | Created | Golden file for formatPath (found route) |
| `test/core/present/golden/path-noroute.txt` | Created | Golden file for formatPath (no route) |
| `test/core/present/golden/status-{brief,normal,full}.txt` | Created | Golden files for formatStatus |
| `test/core/present/golden/precheck-{brief,normal,full}.txt` | Created | Golden files for formatPrecheck |
| `openspec/changes/phase-5-mcp-server/tasks.md` | Modified | Marked tasks 1.1–1.10 as [x] complete |
| `openspec/changes/phase-5-mcp-server/apply-progress.md` | Created | This file |

---

## Deviations from Design

1. **formatPath does not have a `detail` parameter.** Design stated `formatPath(v: PathView): string` with no detail param. The spec for `dbgraph_path` has brief/normal/full detail levels per the budget table, but the design signature has no `detail` arg. I followed the design signature (no detail param) since the spec's per-tool/per-detail table references are for budget measurement only, and the design explicitly shows a single signature. This should be revisited in Batch E when budgets are measured — if brief vs full output differs materially, the signature can be extended then.

2. **`formatObject` uses bracket-notation payload access** (not typed casts) to comply with `exactOptionalPropertyTypes` in strict TypeScript. The payload type `NodePayload` is `Readonly<Record<string, unknown>>` — direct casts to `ColumnPayload` etc. fail tsc strict. Pattern is consistent with how `explore.ts` already accesses `payload['hasDynamicSql']`.

3. **Golden capture approach.** Goldens were generated by a temporary capture test (`golden-capture.test.ts`, since deleted). This is acceptable because golden tests enforce "approved output" — the formatter defines the content and the golden pins it. The determinism tests (byte-identical re-run) independently validate stability.

---

## Remaining Tasks

- [ ] 2.1–2.8 (Batch B): openConnections move, SDK + server scaffold
- [ ] 3.1–3.6 (Batch C): Simple tools (explore/search/related/path/status)
- [ ] 4.1–4.5 (Batch D): Object/impact orchestrators, precheck extractor, affected CLI
- [ ] 5.1–5.5 (Batch E): Install, packaging, E2E, budget measurement, closeout

---

## Status

10/10 Batch A tasks complete. Ready for Batch B.
