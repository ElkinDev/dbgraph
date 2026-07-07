# Archive Report — sqlite-view-deps

**Change**: sqlite-view-deps
**Branch**: v1-prep (repo dbgraph)
**Artifact store**: openspec
**Archived**: 2026-07-07
**Verdict**: PASS — 0 CRITICAL / 0 WARNING / 2 SUGGESTION (see `verify-report.md`, carried into this archive)

## Shipped Commits

| Commit | Summary |
|--------|---------|
| `2c599be` | docs(sqlite-view-deps): add SDD planning (proposal, spec, design, tasks) for view/trigger dependency edges |
| `28c5e7b` | feat(sqlite): add tokenizer seams — extractTriggerActionBlock + tokenizeSqliteBody over shared core |
| `72fe26a` | feat(sqlite): emit view depends_on + trigger writes_to via shared presence-gate tokenizer |
| `cc9b3ef` | fix(normalize): resolve trigger fires_on target by node kind, kill phantom view stub (cross-engine) |
| `b884ab6` | test(sqlite): re-bless view/trigger dependency goldens + pin precheck whatToTest |
| `4f0f616` | docs(sqlite-view-deps): check off B4/B5 tasks + Definition of Done |

## Headline

SQLite now gains body-derived view `depends_on` and trigger `writes_to` edges via the shared
conservative presence-gate tokenizer, replacing the hardcoded `dependencies: []` that `sqlite/map.ts`
previously emitted for views and triggers (golden-e2e edgeCount 54→64, phantom view stub count 1→0).
A cross-engine fix in `reference-resolver.ts` (`buildFiresOnEdges`) resolves a trigger's `fires_on`
target by its ACTUAL node kind instead of a hardcoded `table` stub, killing the phantom `[table]` stub
previously minted for the SQLite `INSTEAD OF` trigger on the `active_departments` view — this fix is
shared across all five engines, proven byte-identical for pg/mssql/mysql table-triggers. The
`dbgraph_precheck` MCP tool and its `dbgraph affected` CLI sibling are no longer view-blind on SQLite —
their `whatToTest` output now includes the exact 5-set (both dependent views, the two FK-linked tables,
and the `INSTEAD OF` trigger), proven via `toStrictEqual` goldens. The benchmark's `view-dependency`
question family is now instantiable on SQLite (it previously yielded zero candidates); the actual
N-change (5→6) and a new labeled benchmark run against the newly-instantiable family are explicitly
DEFERRED to a future dedicated change, not done here. Cross-engine (pg/mssql/mysql) fixtures and
goldens are byte-identical/untouched throughout — blast radius is SQLite-only, as designed.

## Documented Deviations Accepted (4, all ACCEPT per verify-report.md)

1. **Explicit self-exclusion in `extractViews`** — the design assumed the presence-gate alone would
   suffice, but `sqlite_master.sql` view bodies include the `CREATE VIEW <name> AS` header, so the
   presence-gate would otherwise match the view's own name (unlike pg/mysql catalog bodies). The
   caller filters the self-reference out explicitly (`map.ts` L356-359); no-self-edge is tested.
2. **SQLite-local comment stripping in `tokenizeSqliteBody`** — necessary because `sqlite_master.sql`
   retains author comments verbatim; without `stripSqlComments`, a name inside a line/block comment
   would fabricate an edge. Tested with both comment styles.
3. **Precheck token-budget ceilings widened 65→85 / 110→140** — an honest re-measurement (not a
   design-table item): the `ceil(chars/4)` methodology is unchanged; only the two precheck ceilings
   moved, and only because the fixture output genuinely grew now that view dependents appear in
   READERS and WHAT TO TEST. Numbers independently re-verified by the verifier (73≤85, 120≤140).
4. **`explore.test.ts` negative narrowed** from a bare `[table]` check to the pivot-scoped
   `main.active_departments [table]` check — MORE precise, not weaker: the new view `depends_on`
   edges legitimately surface neighbor tables, so scoping the negative to the pivot qname preserves
   the exact phantom-stub guard while permitting real neighbors.

## Suggestions Accepted (2, non-blocking)

1. **S-1**: Add a CASE-END-in-trigger-body unit test to `tokenizer.test.ts` locking the LAST-END-wins
   slice behavior against an intermediate `END` token. The code is already correct; this only hardens
   the regression net. (Nested BEGIN-END is N/A — SQLite trigger grammar forbids it.)
2. **S-2**: The two `dbgraph_precheck` ceiling widenings (deviation 3 above) were an unforeseen
   second-order consequence. Consider adding a token-budget re-measurement step to the design
   blast-radius checklist for any future change that grows neighbor-bearing tool output, so it is
   anticipated rather than discovered during apply.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `sqlite-extraction` | Updated | 1 MODIFIED requirement replaced in place, at the same tail position in the Requirements list, WITH A TITLE CHANGE: `Honest minimal dependency hints for views and triggers` → `View and trigger dependency edges derived from bodies via the shared tokenizer` (retains a `(Previously: ...)` note documenting the supersede). All 5 new scenarios (view `depends_on` exact set, trigger `writes_to` exact set, header-leak negative, self/phantom-edge negative, determinism) replace the old 2 scenarios. |
| `graph-normalization` | Updated | 1 MODIFIED requirement replaced in place: `Catalog-to-graph node and edge production` (first requirement in the file, position unchanged) — paragraph extended to require `fires_on` target resolution by actual node kind (view vs table) instead of a hardcoded `table` stub, with a `(Previously: ...)` note; the existing "Minimal fixture" scenario is kept and 2 new scenarios appended to that requirement (trigger-fires-on-view cross-engine, SQLite INSTEAD OF exact). |
| `mcp-server` | Updated | 2 MODIFIED requirements, both replaced in place (this spec has no dated-section convention — confirmed against the current file and the explore-payloads precedent; all merges inline): (a) `dbgraph_precheck aggregates DDL impact with parsed-confidence tagging` — paragraph extended re: surfacing view/trigger dependents on every engine including SQLite, `(Previously: ...)` note added, 1 new scenario appended (`SQLite column-drop surfaces the exact view + trigger dependents`); (b) `dbgraph affected mirrors precheck via the CLI` — 1 new scenario appended (`affected on a SQLite departments column-drop includes view + trigger dependents`), no paragraph change needed for this one beyond the new scenario. |
| `benchmark` | Updated | 1 ADDED requirement appended at the end of the Requirements list (this spec has no dated-section convention either — confirmed against the current file and the explore-payloads precedent): `view-dependency family is instantiable; the N-change is deferred to its own run`, with its 3 scenarios (enumerator now yields candidates, N/question-set unchanged and prior runs stay frozen, stale blindness comments corrected). |

## Deferred (Next Changes)

- **Benchmark view-dependency N-change / new labeled run** — the `view-dependency` question family is
  now instantiable on SQLite, but bumping N (5→6), regenerating `benchmark/questions.yaml`, and
  running a new labeled benchmark run against the newly-available `affected`-derived mechanical key is
  explicitly out of scope for this change and is the natural next change (per the benchmark spec's
  frozen-methodology / labeled-run requirements).

## Gates (re-confirmed at archive time)

| Gate | Result |
|------|--------|
| Type check (`npx tsc --noEmit`) | PASS |
| Lint (`npm run lint`) | PASS — 0 errors / 0 warnings |
| Tests (`npm test`) | PASS — 3229 passed / 0 failed |

## Next recommended: none — SDD cycle complete for `sqlite-view-deps`, other than the deferred benchmark run noted above.
