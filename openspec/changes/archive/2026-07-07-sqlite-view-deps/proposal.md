# Proposal: SQLite View & Trigger Dependency Extraction

## Intent

Double-evidenced follow-up. The SQLite adapter declares `supportsDependencyHints: false` (US-007 era)
and `map.ts` hardcodes `dependencies: []` for BOTH views (`extractViews`, line 343) and triggers
(`extractTriggers`, line 406) — so SQLite view/trigger nodes carry NO `depends_on`/`reads_from`/
`writes_to` edges. Two consequences were MEASURED, twice each:

1. **`dbgraph affected` is view-blind on SQLite.** `getImpact` traverses inbound
   `writes_to`/`reads_from`/`depends_on` (`impact.ts` `IMPACT_EDGE_KINDS`), but SQLite emits none for
   views/triggers — so `whatToTest` for dropping `departments.dept_id` misses the two views +
   the INSTEAD OF trigger that genuinely break. `docs/benchmarks.md` impact family: Runs 1 AND 2
   BOTH fail against that mechanical key (the key IS `affected`'s own view-blind output — the
   circularity note).
2. **The benchmark's `view-dependency` family yields ZERO candidates** on the SQLite substrate
   (N=5 instead of 6). `generate.ts:258` enumerates from `getEdgesFrom(view.id, ['depends_on',
   'reads_from'])` — actual EDGES, not the capability flag — and there are none.

The machinery to fix it EXISTS and is battle-tested: `engines/_shared/tokenizer-core.ts`
(`maskDynamicStrings` + `bodyContainsRef` presence-gate, promoted in phase-8b Batch 1, byte-identical
across pg+mysql) already powers `confidence:'parsed'` `reads_from`/`writes_to`/`depends_on` edges from
view/routine/trigger bodies in pg/mysql/mssql — and pg/mysql/mongodb ALL keep
`supportsDependencyHints: false` while doing it. SQLite view + trigger bodies are ALREADY extracted
into `RawObject.body` at `DEFAULT_LEVELS` (views `'full'`, triggers `'full'`); only the tokenizer
wiring and one normalize fix are missing.

Now is the moment: the harness is frozen and re-runnable, both consequences are measured, and the fix
is a bounded adapter + normalize change reusing proven code.

Success = SQLite view bodies emit `depends_on` edges and trigger bodies emit `reads_from`/`writes_to`;
`affected` `whatToTest` gains the view/trigger dependents; the phantom `[table]` stub minted for
INSTEAD-OF-view triggers is killed at the normalize source; and L-009 exact-edge tests (src+dst
qnames) written straight from the torture fixture pin the result, goldens re-blessed deliberately.

## Scope

### In Scope
- **SQLite view dependency extraction** (`sqlite/map.ts`, mirroring `pg/map.ts` `buildViews`): build a
  `potentialDeps` candidate list (all tables + views) in `buildRawCatalog`; pass each view `body` +
  candidates through a SQLite-wired tokenizer. Emitted `RawDependency`s become `depends_on` edges
  (the normalizer maps a VIEW's read dep → `depends_on`, `reference-resolver.ts:263`). All edges
  `confidence:'parsed'`.
- **SQLite trigger dependency extraction**: tokenize the trigger ACTION body only (the `BEGIN…END`
  block) → `writes_to` (INSERT/UPDATE/DELETE targets, e.g. `audit_log`, `departments`) + `reads_from`.
  STRIP the `CREATE TRIGGER … ON <tbl>` header BEFORE presence-gating so the fires_on target does NOT
  leak a spurious `reads_from` edge (L-009 exactness).
- **Keep `supportsDependencyHints: false`** (HONEST — SQLite has no cheap catalog dependency source;
  it parses bodies like pg/mysql). Verified the flag gates NO code path (only comments/docs). Correct
  the misleading comment in `capabilities.ts` and the stale blindness notes in `benchmark/generate.ts`
  + `questions.yaml`.
- **Normalize phantom-stub fix** (`reference-resolver.ts` `buildFiresOnEdges`): resolve the trigger's
  fires_on target to the ACTUAL node kind (view OR table), replacing the hardcoded
  `resolveOrStub('table', …)`. Kills the phantom `[table] active_departments` stub minted for
  `trg_active_dept_instead_insert` (INSTEAD OF INSERT ON the `active_departments` VIEW). Presentation
  prefer-`!missing` masking stays as defense-in-depth.
- **L-009 exact-edge tests** over the torture fixture (src+dst qnames, NEVER existence-only):
  `active_departments`→{`departments`,`employees`}, `employee_summary`→{`employees`,`departments`}
  (`depends_on`); `trg_emp_*`→`audit_log`, `trg_active_dept_instead_insert`→`departments`
  (`writes_to`); `trg_active_dept_instead_insert` fires_on the VIEW `active_departments` (no phantom
  table stub).
- **Deliberate golden re-bless**: `golden-raw-catalog.json` (views/triggers gain `dependencies`),
  SQLite e2e/normalize goldens (new edges + phantom stub removed), and any cross-engine normalize
  goldens the fires_on fix touches (audit pg/mssql/mysql fixtures for INSTEAD-OF-view triggers).

### Out of Scope (deferred, justified)
- **Column-level view lineage** (which columns a view projects/reads): needs SQL grammar parsing,
  which ADR-007 forbids (conservative tokenizer only). Separate change.
- **Transitive cross-view chains** beyond the tokenizer presence-gate: `getImpact` already does depth
  BFS over the emitted edges — no extra extraction needed.
- **Other engines' extraction**: pg/mysql/mssql already emit dependency edges; unchanged (they only
  benefit from the shared fires_on fix).
- **Benchmark PROTOCOL change (N 5→6, re-run, regenerated committed question set, new run label)**:
  DEFERRED to a separate labeled run. This change makes the family INSTANTIABLE (edges now exist);
  actually bumping N and re-running is a protocol change that MUST land as its own run so prior runs
  (Run 1/2, N=5) stay frozen and labeled with their N, and a Run 3 uses the NEW mechanical key
  (`affected` now sees views). **Recommend deferring** — tradeoff: doing it here couples a code change
  with a protocol/measurement change in one PR and re-freezes the question set mid-flight; deferring
  keeps concerns clean and prior runs intact.
- **Presentation prefer-`!missing` masking**: stays as defense — the real fix is at the normalize
  source, not the presenter.

## Capabilities

### New Capabilities
- None. Extends existing extraction + fixes the shared normalizer; no new user-facing capability.

### Modified Capabilities
- `sqlite-extraction`: view bodies → `depends_on`, trigger action bodies → `reads_from`/`writes_to`
  via the shared tokenizer; `supportsDependencyHints` stays `false` (comment corrected to "edges
  derived from bodies like pg/mysql; flag denotes CHEAP catalog hints, which SQLite lacks").
- `graph-normalization`: `buildFiresOnEdges` resolves view-targeted triggers to the view node — a
  cross-engine phantom-stub correctness fix.
- `benchmark`: `view-dependency` family becomes instantiable on the SQLite substrate (edges now
  exist); stale `supportsDependencyHints`-blindness comments in `generate.ts`/`questions.yaml`
  corrected. The N-change / re-run itself is deferred (Out of Scope).

## Approach

Hexagonal (ADR-004), determinism golden-pinned (ADR-008). TWO seams, both reusing proven code:

1. **Adapter** (`sqlite/map.ts`, mirroring `pg/map.ts`): assemble a `potentialDeps` candidate list
   (tables+views) in `buildRawCatalog`; run each view `body` and each trigger ACTION body through a
   SQLite-wired tokenizer. The default `canonicalizeQName` already strips SQLite bracket/double-quote
   and bare identifiers; `NEW.`/`OLD.` pseudo-refs are naturally excluded because presence-gating
   matches only real catalog objects. For triggers, tokenize ONLY the `BEGIN…END` block so
   `writes_to`/`reads_from` reflect true body access and the `ON`-clause table stays purely fires_on.
2. **Normalize** (`reference-resolver.ts` `buildFiresOnEdges`): resolve the target by node kind (try
   `view` then `table`, or a kind-agnostic lookup) instead of the hardcoded `resolveOrStub('table',…)`
   — shared across engines, a net correctness gain everywhere.

Golden discipline is the safety rail: every byte change (raw-catalog, e2e, cross-engine normalize) is
a DELIBERATE re-bless justified by the new edges; L-009 tests assert EXACT src+dst qnames — never
existence-only (the lesson exists because of phantom edges). Leak-scan neutral fixtures preserved.

Recommended apply batches: **A)** SQLite view `depends_on` extraction + L-009 view-edge tests +
raw-catalog/e2e re-bless → **B)** SQLite trigger `reads_from`/`writes_to` (header-stripped body) +
L-009 trigger-edge tests → **C)** `buildFiresOnEdges` view-target fix + cross-engine golden re-bless +
capability/benchmark comment corrections.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/sqlite/map.ts` | Modified | Wire tokenizer over view + trigger bodies; candidate list; header-strip for triggers; drop hardcoded `dependencies: []` |
| `src/adapters/engines/sqlite/capabilities.ts` | Modified | Keep `supportsDependencyHints: false`; correct the comment |
| `src/core/normalize/reference-resolver.ts` | Modified | `buildFiresOnEdges` resolves view-targeted triggers to the view node (cross-engine) |
| `test/fixtures/sqlite/golden-raw-catalog.json` | Modified | Views/triggers gain `dependencies` — deliberate re-bless |
| `test/adapters/engines/sqlite/e2e.test.ts` + edge/normalize goldens | Modified | New `depends_on`/`reads_from`/`writes_to` edges; phantom stub removed |
| `test/adapters/engines/sqlite/*` (new L-009 assertions) | New | Exact src+dst qname edge assertions from the torture fixture |
| `test/` pg/mssql/mysql normalize goldens | Modified (if applicable) | Re-bless only where the fires_on fix alters INSTEAD-OF-view trigger output |
| `benchmark/generate.ts`, `benchmark/questions.yaml` | Modified | Correct stale `supportsDependencyHints`-blindness notes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Trigger `ON`-clause header leaks a spurious `reads_from` to the fires_on target | Med | Strip the `CREATE TRIGGER … BEGIN` header; tokenize only the action block; L-009 exact-edge test catches any leak |
| fires_on fix alters pg/mssql/mysql goldens (their fixtures may have INSTEAD-OF-view triggers) | Med | Audit each engine's torture fixture in design; deliberate, justified re-bless per engine |
| Over-broad `depends_on` from a name appearing inside a body comment | Low-Med | `bodyContainsRef` is word-boundary + `maskDynamicStrings`; conservative ADR-007 posture; L-009 tests pin the EXACT set |
| Perceived capability dishonesty | Low | Keep `false` (matches pg/mysql/mongodb); the flag means CHEAP catalog hints, which SQLite lacks — correct the comment, don't flip |
| View self-reference / candidate name collision | Low | Presence-gate never matches a view's own qname as a target (pg-proven) |
| Benchmark N-change scope creep into this change | Low | Explicitly deferred to a separate labeled run; this change only makes the family instantiable |

## Rollback Plan

Bounded and reversible. Revert by: restoring `sqlite/map.ts` `extractViews`/`extractTriggers` to
`dependencies: []` (removing the tokenizer wiring + candidate list); restoring `buildFiresOnEdges` to
the hardcoded `resolveOrStub('table', …)`; `git revert` of the golden commit to restore the byte-pins
(`golden-raw-catalog.json`, e2e/normalize goldens, any cross-engine goldens); reverting the
capability/benchmark comment edits. No schema/store/query CONTRACT changes are touched; other engines
stay green except the shared fires_on fix, which reverts atomically with the same commit. The
benchmark harness and its frozen runs are untouched.

## Dependencies

- Reuses existing `_shared/tokenizer-core.ts` (`classifyAccess`, `maskDynamicStrings`,
  `bodyContainsRef`) and `reference-resolver.ts` (`buildDependencyEdges`, `buildFiresOnEdges`) — no
  new packages (ADR-007).
- View + trigger bodies are already present in `RawObject.body` at `DEFAULT_LEVELS`
  (views/triggers `'full'`) — no re-extraction, no new query.

## Stories

- Primary: `docs/benchmarks.md` impact-family circularity note (Runs 1+2, both ✗ against the view-blind
  key) and the `view-dependency` family N-exclusion — the two measured consequences.
- Deferred: benchmark N=6 re-run on a NEW labeled run with a regenerated, committed question set (the
  frozen Run 1/2 keys stay frozen; a Run 3 uses the new mechanical key now that `affected` sees views).

## Success Criteria

- [ ] `extractViews` emits `depends_on` edges: `active_departments`→{`departments`,`employees`},
      `employee_summary`→{`employees`,`departments`} — exact src+dst qnames asserted (L-009).
- [ ] `extractTriggers` emits `writes_to` for body targets (`audit_log`, `departments`) with NO
      spurious `reads_from` to the fires_on table — exact qnames asserted (L-009).
- [ ] `trg_active_dept_instead_insert` fires_on the VIEW `active_departments` (a real view node), and
      NO `[table] active_departments` phantom stub appears in the normalized graph.
- [ ] `dbgraph affected` `whatToTest` for `departments`/`departments.dept_id` now includes the
      dependent views + trigger (verified via `getImpact` over the new edges).
- [ ] `supportsDependencyHints` remains `false`; the capability + benchmark comments are corrected to
      reflect body-derived edges.
- [ ] `benchmark/generate.ts` `view-dependency` enumerator now yields candidates on the SQLite
      substrate (edges exist) — proving N could go 5→6 in a future labeled run (N-change deferred).
- [ ] All re-blessed goldens (SQLite raw-catalog/e2e + any cross-engine normalize) are committed as
      DELIBERATE re-bless with the new-edge justification; target DB stays strictly read-only
      (ADR-004 boundary test green).
