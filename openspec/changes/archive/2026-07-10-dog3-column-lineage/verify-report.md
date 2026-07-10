# Verify Report: DOG-3 — Column-Level Lineage (views first)

**Change**: dog3-column-lineage
**Verified**: 2026-07-10 (adversarial, independent reproduction)
**Repo / branch**: `dbgraph` @ `post-v1`, HEAD `287be4a`, clean tree
**Verdict**: **ARCHIVE-READY** — 0 CRITICAL, 2 WARNING, 3 SUGGESTION

## Executive Summary

DOG-3 ships honest column-grain view lineage under Model A (`attrs.dstColumns` on the existing
view→table `depends_on` edge; zero new edges, zero column-node targets). Where a catalog sources the
columns — mssql via a native `sys.dm_sql_referenced_entities` per-view TVF loop, pg via
`information_schema.view_column_usage` — the covered view→table `depends_on` edge FLIPS
`confidence: 'parsed'` → `'declared'` and gains the sorted-unique consumed-column set. Where no catalog
sources it (mysql, sqlite, mssql-via-sqlcmd/dump, pg materialized/owner-gap) the edge degrades by
ABSENCE — byte-identical to pre-DOG-3, no marker. Impact is column-precise via one shared
`filterReadersByColumn` helper (present-includes → affected, present-excludes → excluded,
absent → included). Render adds a FULL-only `consumes: <table>.<column>` section, byte-identical across
CLI and MCP. Independent reproduction matched EVERY claim in `apply-progress`/tasks. The change is
closed for archive.

## Reproduction (independent, this HEAD)

| Gate | Command | Claimed | Reproduced | Result |
|------|---------|---------|------------|--------|
| Type check | `npx tsc --noEmit` | 0 errors | 0 errors | MATCH |
| Lint | `npm run lint` | 0/0 | 0 errors, 0 warnings | MATCH |
| Unit + integration (default) | `npm test` | 230 files / 3595 tests green | 230 files / 3595 tests green | MATCH |
| Live mssql tier | `DBGRAPH_INTEGRATION=1` (mssql:2022) | 13/13 | 13/13 | MATCH |
| Live pg tier | `DBGRAPH_INTEGRATION=1` (postgres:16) | 84/84 (2 files) | 84/84 | MATCH |
| Cross-engine freeze | goldens byte-identical over `4e78689..287be4a` | non-target engines frozen | byte-identical (git range diff scoped to target engine per batch) | MATCH |
| Legal guardrail sweep | denylist scan over the 4 DOG-3 commits | clean | clean on all 4 commits | MATCH |
| Task ledger | 32 boxes (24 tasks A/B/C + 8 DoD) | all `[x]` | all legitimately checked | MATCH |

C.3 and C.5 carried "no RED preceded this box" rulings (precheck/affected reuse of the existing helper;
capability-flag-only additions that touch no edge byte). Both were re-examined independently and are
LEGITIMATE — the changes are additive assertions over an already-GREEN shared seam, not skipped TDD.

## 9-Delta Compliance (all MET)

| # | Delta spec | Core claim | Verdict |
|---|-----------|-----------|---------|
| 1 | graph-model | `EdgeAttrs.dstColumns` load-bearing on `depends_on`; declared where sourced; degrade-by-absence; never an output↔source map | MET |
| 2 | graph-normalization | `buildDependencyEdges` stamps `[...new Set()].sort()` code-point set; unset → `attrs {}` byte-identical (ADR-008) | MET |
| 3 | graph-query | three-arm column-pivot impact (present-includes → affected; present-excludes → excluded; absent → included); table-pivot unchanged | MET |
| 4 | schema-extraction | optional `RawDependency.columns` engine-agnostic source-set contract; unset engines byte-identical | MET |
| 5 | mssql-extraction | native `dm_sql_referenced_entities` TVF loop; covered deps flip parsed→declared; unbindable-view skip; sqlcmd/dump object-grain | MET (see WARNING-1 on spec narrative) |
| 6 | pg-extraction | `view_column_usage` source; covered pairs flip parsed→declared; materialized + owner-gap degrade | MET |
| 7 | mysql-extraction | degrade-by-absence; `supportsColumnLineage:false`; no body-parse; byte-identical | MET |
| 8 | sqlite-extraction | degrade-by-absence; `supportsColumnLineage:false`; no body-parse; byte-identical | MET |
| 9 | mcp-server | FULL-only `consumes: <table>.<column>` pinned shape, CLI/MCP byte-identical; precheck/affected column precision | MET |

## WARNING (2)

### WARNING-1 — mssql D5-flip narrative is factually wrong in design/spec text
Design Decision **D5** and the `mssql-extraction` delta assert "the mssql view `depends_on` is ALREADY
`confidence: 'declared'`, so the set attaches with NO confidence flip." This is FALSE. The mssql view
`depends_on` deps are produced by the body tokenizer at `confidence: 'parsed'` — exactly like pg — and
the implementation FLIPS `parsed`→`declared` on COVERED view deps for BOTH mssql and pg. The observable
end state (`declared` + `dstColumns`) that every test pins is CORRECT and unaffected; only the narrative
describing HOW it gets there is wrong. **Resolution at archive**: reconciler note (d) added to
`design.md`; the merged canonical `mssql-extraction` spec states the flip, never "already declared".

### WARNING-2 — defensive kind-filter in `getImpact` masks a fake-store shortcut (test debt)
`getImpact`'s column first-hop applies a defensive edge-kind filter that compensates for the unit test
fake `getEdgesTo` NOT honoring its `kinds` argument (`test/core/query/impact.test.ts` fake). Production
`SqliteGraphStore.getEdgesTo` honors `kinds` correctly, so the filter is redundant against the real
store — it is dead-weight introduced to satisfy a fake that over-returns. Not a correctness defect
(behavior is correct on the real store and asserted live in C.7), but it is TEST DEBT: the fake lies
about the port contract and the production code carries a guard to tolerate the lie.

## SUGGESTION (3)

1. **Fix the fake, then drop the filter.** Make the `impact.test.ts` fake `getEdgesTo` honor its `kinds`
   argument (as the real `SqliteGraphStore` does), then remove the compensating defensive kind-filter in
   `getImpact`'s column first-hop. This retires WARNING-2's test debt and keeps the fake honest to the
   `GraphStore` port contract.
2. **Assert strategy-absence via live sqlcmd re-extraction.** A.7/C.7 prove the native-path truth sets
   live; add a live assertion that re-extracts the SAME mssql container through the sqlcmd/manual-dump
   strategy and pins OBJECT GRAIN (no `dstColumns`, no error) — closing the D8 strategy-coverage
   difference with a live proof rather than only the synthetic/unit pin.
3. **Comment the catalog distinction at the query site.** Add a code comment where
   `sys.dm_sql_referenced_entities` is issued distinguishing its per-object
   `referenced_minor_id > 0` column attribution from the REJECTED
   `sys.sql_expression_dependencies.referenced_minor_id` (which is `0`/whole-object for non-schemabound
   views — inert, the D8 live finding). This prevents a future maintainer from "simplifying" back to the
   dead catalog.

## Determinism & Honesty Checks

- ADR-008: `attrs.dstColumns` is `[...new Set()].sort()` code-point ascending, centralized in the
  normalizer; byte-identical on re-run asserted in column-pivot, impact-column and the live C.7 suites.
- ADR-006/007: no column is body-parsed or fabricated on any engine; degradation is stated by ABSENCE;
  computed `dbo.orders.total_amount` is consumed AS ITSELF (never expanded to `quantity`/`unit_price`).
- L-009 exact-set: positive sets AND `not.toContainEqual` negatives pinned per engine; no existence-only
  assertions; no per-column edge, no column-node target, no output↔source mapping.
- ADR-004: target DB strictly read-only; the new `SQL_MSSQL_VIEW_REFERENCED_COLUMNS` and
  `SQL_PG_VIEW_COLUMN_USAGE` are catalog `SELECT` only (write-verb scanner green).

## Verdict

**ARCHIVE-READY.** No CRITICAL. The two WARNINGs are documentation drift (resolved at archive via
reconciler note d) and non-blocking test debt (WARNING-2). The three SUGGESTIONs are follow-up polish,
not archive blockers. Proceed to merge the deltas into canonical specs and archive the change.
