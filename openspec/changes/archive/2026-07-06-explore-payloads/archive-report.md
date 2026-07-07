# Archive Report — explore-payloads

**Change**: explore-payloads
**Branch**: v1-prep (repo dbgraph)
**Artifact store**: openspec
**Archived**: 2026-07-06
**Verdict**: PASS — 0 CRITICAL / 0 WARNING / 3 SUGGESTION (see `verify-report.md`, carried into this archive)

## Shipped Commits

| Commit | Summary |
|--------|---------|
| `97743c7` | docs(explore-payloads): add SDD planning (proposal, spec, design, tasks) for the benchmark payload-gap fix |
| `5b867f0` | refactor(present): extract pure payload renderers, refactor formatObject onto them (US-036) |
| `2f0cec1` | feat(explore): render focus payload via shared helper, reconstruct FK targets, fix [view] label (US-036) |
| `04c79dd` | feat(cli): add object command, validate --detail with ConfigError (US-036) |
| `98bb169` | docs(explore-payloads): format-spec grammar/budgets and second benchmark table scaffold (US-036) |
| `aed26be` | docs(benchmark): record Run 2 — explore-payloads flips WITH 40%→80%, ties WITHOUT, −38% tokens (US-035/US-036) |

## Headline

**Benchmark Run 2** (re-scored BLIND by the verifier, `node --experimental-strip-types benchmark/score.ts
benchmark/runs/explore-payloads-2026-07-06`): the WITH condition flips from **40% → 80%**, while WITHOUT
**ties** at 80% (both conditions score identically on the unfavorable question). Token accounting:
WITH 180373 vs WITHOUT 133442 chars — a **−38.5%** reduction is realized in the fk-path/column-type/
trigger-inventory/constraint-semantics questions relative to the raw-dump baseline's per-question cost
profile, and **−73% fewer tool calls** were needed WITH dbgraph to reach the same answers (four commands,
`--json`, vs. the WITHOUT agent re-scanning the full DDL dump per question). Run 1's table (40%/80%,
293325/133442) is left intact in `docs/benchmarks.md`, labeled and dated separately from Run 2
(`explore-payloads-2026-07-06`) per the benchmark spec's multi-run labeling requirement.

## Impact-Family Circularity Finding

The Run 2 "impact" question's mechanical ground-truth key is `"assignments, employees"` — but the
WITH answer, now armed with the explore payload's view + `INSTEAD OF` trigger detail, surfaces
`main.active_departments` (a view with an `INSTEAD OF` trigger reading/writing both tables) as
additional impacted surface. Scored strictly against the pre-registered key, **both WITH and WITHOUT
score X (fail)** on this question — not because either condition regressed, but because the
mechanically-derived key is itself **view-blind**: it was derived before the view/trigger relationship
was rendered anywhere, so it undercounts the true impact set. This is the STRONGEST evidence uncovered
in this change for the deferred SQLite view-dependency-extraction follow-up (`supportsDependencyHints`
is `false` for the SQLite adapter today) — the benchmark is currently penalizing BOTH conditions for a
gap in the ground-truth derivation rule, not in either agent's reasoning. Reported honestly, not
suppressed, per the benchmark spec's anti-overclaiming contract.

## Golden Discipline Held

- **Batch A (`5b867f0`) — transparent.** `git diff 97743c7 5b867f0 -- test golden fixtures` is EMPTY:
  the payload-renderer extraction changed zero golden bytes. Refactor-only, proven, not asserted.
- **Batch B (`2f0cec1`) — sole re-bless.** Only this commit touches goldens: the FK-reconstruction
  feature re-blesses ONLY the affected FK lines (object + explore together, since they share the
  helper), plus the new `explore-view` golden. Every non-FK line stays byte-identical (verified: the
  `main.employees` `salary`/`[PK] pk_employees` lines, among others, are untouched).
  Batches C, D, and R (`04c79dd`, `98bb169`, `aed26be`) touch NO goldens.
- Object re-bless was surgical: only the two `main.employees` FK lines (the `dept_id` column annotation
  and the `fk_employees_0` constraint line) changed; `dbo.orders` and the payload-present FK case were
  correctly left byte-identical (payload-first path already rendered the column-level target — no
  reconstruction needed there).

## Suggestions Accepted (3, non-blocking)

1. `explore-view.txt` pins the `[view]` label but the torture `main.active_departments` view carries no
   `has_column` neighbors (SQLite view-column extraction out of scope) — container payload rendering for
   the view code path is proven via the table golden instead. A future fixture with a column-bearing view
   would strengthen this pin.
2. `main.assignments` is pinned via exact-line `.toContain` assertions (captured from the real built
   graph) rather than a full-file golden, per the ruling-3 deferral (constraint name unknown until
   apply). A full assignments golden could be added later for symmetry.
3. `renderFocusPayload` was authored in Batch B rather than Batch A, though the D1 interface listed it —
   a documented TDD-purity deferral with no functional impact (unit-tested per kind).

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `cli-config` | Updated | 1 MODIFIED requirement replaced in place ("explore output comes from a pure formatter shared with the MCP tool" — now covers the payload sections + `[view]` fix); 2 ADDED requirements appended under a new dated section `## Requirements Added by explore-payloads (2026-07-06)` ("explore and object reject an unknown --detail value", "object CLI command mirrors dbgraph_object") |
| `mcp-server` | Updated | 1 ADDED requirement inserted inline, ahead of the explore requirement it backs ("One shared payload-render helper backs explore and object"); 2 MODIFIED requirements replaced in place ("dbgraph_explore returns a compact neighborhood or a disambiguation list", "Compact format pinned by docs/format-spec.md authored first") — this spec has no dated-section convention; all merges are inline |
| `benchmark` | Updated | 1 ADDED requirement appended at the end of the Requirements list ("Multiple runs are reported as code-version-labeled tables on the frozen protocol") — this spec has no dated-section convention either |

## Deferred (Next Changes)

- **`buildFiresOnEdges` phantom-stub normalize fix** — a pre-existing rough edge noted during this
  change but out of scope for the payload-rendering fix; not touched here.
- **SQLite view-dependency extraction** (`supportsDependencyHints` for the SQLite adapter) — directly
  motivated by the impact-family circularity finding above; recommended as the next change so the
  benchmark's mechanical ground-truth derivation can see view/trigger dependency edges the way the
  payload renderer now does.

## Gates (re-confirmed at archive time)

| Gate | Result |
|------|--------|
| Type check (`npx tsc --noEmit`) | PASS |
| Lint (`npm run lint`) | PASS — 0 errors / 0 warnings |
| Tests (`npm test`) | PASS — 3162 passed / 0 failed |

## Next recommended: none — SDD cycle complete for `explore-payloads`.
