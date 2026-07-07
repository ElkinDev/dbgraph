# Tasks: SQLite View & Trigger Dependency Extraction (sqlite-view-deps)

Standing header (every task): **STRICT TDD** — the failing `vitest` test PRECEDES the code (RED→GREEN→refactor);
**L-009 EXACT-set** assertions ALWAYS (`.toStrictEqual`/`.toBe`/`toContainEqual` the FULL src+dst qname edge, plus
explicit `not.toContainEqual` NEGATIVES) — existence-only `.toBeDefined()`/`find()` is FORBIDDEN (the lesson exists
because of phantom edges). HEXAGONAL (ADR-004): `sqlite/tokenizer.ts` reuses `engines/_shared/tokenizer-core.ts`
(`maskDynamicStrings` + `bodyContainsRef` + `classifyAccess`); `reference-resolver.ts` stays inside `src/core/normalize`.
NO new npm dependency (ADR-007 conservative tokenizer — no grammar parser). DETERMINISM (ADR-008): candidate list is
name-sorted, extract-twice is byte-identical. Bodies are ALREADY in `RawObject.body` at `DEFAULT_LEVELS` — NO new query,
NO re-extraction, NO schema/store/query CONTRACT change. Qnames use the `main.` schema prefix throughout. Target DB stays
strictly READ-ONLY. Strict TS (NO `any`, `exactOptionalPropertyTypes`); ENGLISH; conventional commits referencing
`sqlite-view-deps`, NO AI attribution, **NO push / PR / gh / tags** — local commits only. Leak-scan/denylist hooks active
(`npm run hooks:install`) — scan before EVERY commit; the substrate is the committed synthetic SQLite torture fixture
(`test/fixtures/sqlite/torture.sql`), neutral fixtures only.

**GOLDEN DISCIPLINE is the sharp edge of this change (D5).** The new edges (views → `depends_on`, triggers → `writes_to`)
and the phantom-stub removal DRIFT the SQLite goldens. Per D5 this is ONE deliberate re-bless commit (Batch B4) with a
per-golden INVENTORY in the message body — NEVER a per-file drip re-bless. The exact edge SETS are pinned by PROGRAMMATIC
L-009 tests (B2/B3) FIRST; the goldens are re-blessed to match SECOND. Between B2 and B4 the SQLite golden family
(`golden-raw-catalog.json`, `golden-e2e.json`, the enumerated `test/mcp/golden/*`) is KNOWINGLY drifted and HELD — it is
NOT re-blessed piecemeal (see the per-batch GATE + Dependency bottlenecks). A CROSS-ENGINE golden drift (pg/mssql/mysql)
is a HARD STOP — the blast radius is SQLite-only (D4). The `benchmark/questions.yaml` frozen question set is a HARD STOP if
ANY structural byte beyond the stale comment moves (spec open question c).

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions D1–D6, §Open Questions):
- **D1 (body sources):** reuse the EXISTING extraction — `extractViews`/`extractTriggers` already populate `body` from
  `sqlite_master.sql` (`SQL_VIEWS`/`SQL_TRIGGERS`, level-gated `'full'`). NO new dependency PRAGMA (SQLite exposes none —
  that is the whole point), NO column/query change. SQLite has NO dynamic SQL (no EXECUTE) → NO `hasDynamicSql` branch.
- **D2 (trigger header-strip = `extractTriggerActionBlock`):** MASK dynamic strings on a working copy, locate the FIRST
  `\bBEGIN\b` + LAST `\bEND\b` on the MASKED copy, slice the ORIGINAL at those offsets (real identifiers survive). The
  whole header (`CREATE TRIGGER … [INSTEAD OF|BEFORE|AFTER] … [UPDATE OF cols] ON <target> [WHEN …]`) is DISCARDED so the
  fires_on target never reaches the tokenizer. REJECTED: `split(/\bBEGIN\b/i)` on raw SQL (fragile in a WHEN literal);
  regex-blacklisting `ON <target>` (misses aliases). WHEN-clause subquery refs are conservatively dropped (ADR-007
  under-approximation — acceptable).
- **D3 (candidate object set):** `potentialDeps` = ALL tables + ALL views (name-sorted → deterministic), mirroring pg
  `buildPgRawCatalog`. NO explicit self-filter — the presence-gate never matches a body's own qname (pg-proven, phase-8a);
  `NEW.`/`OLD.` pseudo-refs are naturally excluded (not catalog objects). REJECTED: catalog-supplied dep hints (none exist).
- **D4 (`buildFiresOnEdges` fix + blast radius):** add `resolveTriggerTarget` that probes `nodeMap` for an EXISTING real
  node across `['table','view']`; only if NONE exists falls back to `resolveOrStub('table', …)` (preserving missing-stub
  semantics). A TABLE-firing trigger's resolved node — and thus its `fires_on` edge id — is UNCHANGED (table-triggers stay
  byte-identical). REJECTED: carrying `kind` from `RawTrigger` (invasive); "try view first" (would mint a phantom VIEW stub
  for real tables). **Cross-engine blast radius is EMPTY** — only SQLite exercises a view-targeted trigger
  (`trg_active_dept_instead_insert`); pg/mssql/mysql goldens MUST stay byte-identical.
- **D5 (golden re-bless protocol):** ONE deliberate re-bless commit with a per-golden INVENTORY. Confirmed drift from the
  measured `golden-e2e`: `edgeCount 54→64` (+4 `depends_on` = 2 views ×2; +6 `writes_to` = 5 emp-triggers→`audit_log`,
  1 instead→`departments`), `nodeCount 54→53`, `stubCount 1→0` (phantom removed). REJECTED: per-file drip re-bless
  (obscures the justification). L-009 tests pin the EXACT sets FIRST.
- **D6 (capability honesty):** KEEP `supportsDependencyHints: false` (matches pg/mysql/mongodb — the flag denotes CHEAP
  catalog hints, which SQLite lacks; edges are body-derived). Correct the misleading comment in `capabilities.ts` and the
  stale blindness notes in `benchmark/generate.ts` (SUBSTRATE NOTE, inline, YAML string) + `benchmark/questions.yaml`.
  REJECTED: flipping the flag to `true` (dishonest — implies a catalog source that does not exist).

Design Open Questions RESOLVED DURING APPLY (audit, do not defer silently): **OQ1/(d)** enumerate the EXACT drifting
`test/mcp/golden/*` set (impact/precheck/related/object/explore/status/path over the torture graph) — B4.1; **OQ2** confirm
the present-layer goldens (`test/core/present/golden/*`) use SYNTHETIC `PresentView` inputs (NOT the torture graph) and do
NOT drift — B4.1; **OQ3** confirm NO benchmark test snapshots `generate.ts` output over the torture graph (the enumerator
now yields candidates — a comment-only change must not silently move a committed artifact) — B4.1/B4.4; **OQ4** view→view
`target.kind` unset (torture views depend only on base tables — no phantom today) is OUT OF SCOPE, note for a future change.

Per-batch GATE (ALL pass before the next batch, then COMMIT): `npx tsc --noEmit` clean (strict, no `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) GREEN for the batch's NEW PROGRAMMATIC suites (baseline **3162** + those
suites) · cross-engine goldens (`pg`/`mssql`/`mysql`) byte-identical (HARD STOP on drift) · leak-scan/denylist clean. **B2
and B3 additionally HOLD the SQLite golden family for the single B4 re-bless** — their gate runs the new unit + L-009
integration suites green and RECORDS the pending golden set; the SQLite goldens are NOT re-blessed piecemeal (D5). **B4 is
the single re-bless** — its gate restores the FULL `npm test` GREEN (baseline 3162 + all new suites) with every re-blessed
golden byte-identical on re-run, and its commit body carries the per-golden inventory. Commit EACH batch (conventional,
references `sqlite-view-deps`, NO AI attribution, NO push/PR/gh/tag).

## Batch B1: Pure tokenizer seams — `sqlite/tokenizer.ts` (`sqliteCanonicalize` + `extractTriggerActionBlock` + `tokenizeSqliteBody`)

> Satisfies the SEAM level of `sqlite-extraction` "View and trigger dependency edges derived from bodies via the shared
> tokenizer" — the header-strip + presence-gate primitives, proven as PURE units before any `map.ts` wiring or graph
> build. ALL **(vitest)**, NO graph change, NO golden drift → this batch's gate is fully green. Realizes D1/D2/D3.

- [x] B1.1 **(vitest)** RED→GREEN `test/adapters/engines/sqlite/tokenizer.test.ts` (new) + `src/adapters/engines/sqlite/tokenizer.ts`
  (new): `sqliteCanonicalize(rawName: string): string` strips SQLite `[]` / `""` / backtick quoting to the bare identifier;
  `extractTriggerActionBlock(triggerSql: string): string` returns the `BEGIN…END` action body with the header REMOVED via
  mask-then-slice (D2). RED first on header-strip cases: an `INSTEAD OF INSERT ON active_departments … BEGIN … END` →
  output contains the body, NEVER `active_departments`; `BEFORE UPDATE OF salary ON employees WHEN … BEGIN … END` → the
  `UPDATE OF salary`, the WHEN clause and `employees` are ALL absent from the output; a `BEGIN`/`END` token inside a
  MASKED string literal in a WHEN clause does NOT mis-slice. Pure `string`→`string`, no I/O. Spec: `sqlite-extraction`
  "Trigger header never leaks a `reads_from`/`writes_to` edge" (seam half). Design D2. Done: `npm test tokenizer`.
- [x] B1.2 **(vitest)** RED→GREEN `tokenizer.test.ts` + `tokenizer.ts`: `tokenizeSqliteBody(body, deps): readonly RawDependency[]`
  runs `maskDynamicStrings` → `bodyContainsRef` presence-gate (word-boundary) → `classifyAccess`, matching ONLY the
  supplied catalog candidates, each emitted `{ target:{schema,name}, access:'read'|'write', confidence:'parsed' }`. RED
  first (LEAK NEGATIVES): a `'employees'` STRING LITERAL yields NO edge; a `NEW.`/`OLD.` pseudo-column yields NO edge; a
  name present only in a `-- comment` yields NO edge; a body naming its OWN qname yields NO self-edge; an INSERT target →
  `access:'write'`, a `FROM`/`JOIN` target → `access:'read'`; every emitted edge carries `confidence:'parsed'`. Reuses
  `engines/_shared/tokenizer-core.ts` (NO re-implementation). Spec: `sqlite-extraction` "No self-edges and no phantom
  edges" + "edges carry confidence: 'parsed'" (seam half). Design D1/D3. Done: `npm test tokenizer`.
- [x] B1.3 GATE (Batch B1): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN (baseline 3162 + tokenizer unit
  suite) — NO graph build, NO golden touched; cross-engine goldens untouched; leak-scan clean. Then COMMIT
  `feat(sqlite): add tokenizer seams — extractTriggerActionBlock + tokenizeSqliteBody over shared core`.

## Batch B2: Extraction wiring in `sqlite/map.ts` + L-009 exact-set integration + capability/benchmark comment corrections

> Satisfies `sqlite-extraction` "View and trigger dependency edges derived from bodies via the shared tokenizer" (view
> `depends_on`; trigger `writes_to`; header never leaks; no self/phantom; `supportsDependencyHints` stays false; edge set
> deterministic) + the comment halves of `benchmark` "view-dependency family is instantiable" (stale blindness comments
> corrected; N and committed set unchanged). L-009 exact-set integration asserts against the BUILT torture graph FIRST
> (D5). The SQLite golden family is HELD for B4 (this gate scopes to the new programmatic suites). Realizes D1/D3/D6.

- [x] B2.1 **(vitest)** RED→GREEN extend `test/adapters/engines/sqlite/extract.test.ts` + `src/adapters/engines/sqlite/map.ts`:
  `buildRawCatalog` assembles `potentialDeps` = all tables + all views (name-sorted, D3); `extractViews` passes each view
  `body` through `tokenizeSqliteBody(body, potentialDeps)`, dropping the hardcoded `dependencies: []`; emitted read deps
  become the view's `RawDependency[]`. RED first on the built catalog: `active_departments`/`employee_summary` carry the
  expected `dependencies` (verified programmatically, not via golden). Spec: `sqlite-extraction` view-body derivation.
  Design D1/D3. Done: `npm test extract`.
- [x] B2.2 **(vitest)** RED→GREEN `extract.test.ts` + `map.ts`: `extractTriggers` runs `extractTriggerActionBlock(body)`
  THEN `tokenizeSqliteBody(actionBlock, potentialDeps)` → `writes_to`/`reads_from` deps; hardcoded `dependencies: []`
  dropped. The `ON <object>` header is stripped BEFORE presence-gating so the fires_on object never leaks. RED first: the
  five `trg_emp_*` triggers carry a WRITE dep to `audit_log`; `trg_active_dept_instead_insert` carries a WRITE dep to
  `departments`; NONE carries a dep to its own fires_on object (`employees` / `active_departments`); NONE carries any read
  dep. Spec: `sqlite-extraction` trigger action-body derivation + header-never-leaks (seam→wiring). Design D1/D2/D3. Done:
  `npm test extract`.
- [x] B2.3 **(vitest)** RED→GREEN `test/adapters/engines/sqlite/dependency-edges.test.ts` (new) — L-009 EXACT-set
  integration over the normalized torture graph (built from `test/fixtures/sqlite/torture.sql`). POSITIVE (exact,
  `.toStrictEqual` the full set): `depends_on` = `main.active_departments → {main.departments, main.employees}` and
  `main.employee_summary → {main.employees, main.departments}` — no other, no fewer; `writes_to` = each of
  `main.trg_emp_before_insert`, `main.trg_emp_after_insert`, `main.trg_emp_before_update`, `main.trg_emp_after_delete`,
  `main.trg_emp_salary_update` `→ main.audit_log`, and `main.trg_active_dept_instead_insert → main.departments`; every edge
  `confidence:'parsed'`. NEGATIVE (`not.toContainEqual`): no `trg_emp_* → main.employees`, no
  `trg_active_dept_instead_insert → main.active_departments`, NO `reads_from` edge at all, no self-edge, no `NEW.`/`OLD.` or
  literal/comment edge. DETERMINISM: extract twice → byte-identical serialized edge set (ADR-008). **Confirm the `main.`
  qname prefix against `test/fixtures/sqlite/golden-raw-catalog.json`** (spec open question b) — assert what the graph
  ACTUALLY produces, do not hard-code an unverified prefix. Spec: `sqlite-extraction` "View bodies emit exact depends_on",
  "Trigger action bodies emit exact writes_to", "Trigger header never leaks" (negative), "No self-edges and no phantom
  edges" (negative), "Edge set is deterministic". Design D1/D2/D3/D5. Done: `npm test dependency-edges`.
- [x] B2.4 **(vitest)** RED→GREEN extend `test/adapters/engines/sqlite/capabilities.test.ts` +
  `src/adapters/engines/sqlite/capabilities.ts`: assert `supportsDependencyHints` is `false` (matching pg/mysql/mongodb)
  EVEN THOUGH body-derived edges are now emitted; correct the accompanying COMMENT to state edges are derived from bodies
  and the flag denotes cheap catalog hints SQLite lacks. RED first: the capability value is `false` and the comment text
  no longer asserts view/trigger dependency-blindness. Spec: `sqlite-extraction` "`supportsDependencyHints` stays false,
  comment corrected". Design D6. Done: `npm test capabilities`.
- [x] B2.5 **(vitest)** RED→GREEN a comment-correction guard test + edit `benchmark/generate.ts` (SUBSTRATE NOTE, inline,
  YAML string) and `benchmark/questions.yaml` — COMMENT-ONLY. The corrected text states SQLite dependency edges are
  body-derived and NO LONGER asserts SQLite views/triggers carry no dependency edges. **HARD STOP guard:** assert the
  `questions.yaml` DATA portions (N, every question id/prompt/ground-truth, the pre-registered set) are BYTE-STABLE — only
  the stale comment string changed (spec open question c). Spec: `benchmark` "Stale blindness comments corrected" + "N and
  the committed question set are unchanged; prior runs stay frozen". Design D6. Done: `npm test benchmark` (comment guard);
  `git diff` on `questions.yaml` shows ONLY the comment line.
- [x] B2.6 GATE (Batch B2): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN for the NEW suites (extract +
  dependency-edges + capabilities + benchmark comment guard; baseline 3162 + those suites); cross-engine goldens
  byte-identical (HARD STOP on drift). **HOLD the SQLite golden family** (`golden-raw-catalog.json`, `golden-e2e.json`, the
  `test/mcp/golden/*` set) for the B4 single re-bless — do NOT re-bless here (D5); RECORD the pending set. Leak-scan clean.
  Then COMMIT `feat(sqlite): emit view depends_on + trigger writes_to via shared presence-gate tokenizer`.

## Batch B3: Normalize fix — `resolveTriggerTarget` in `reference-resolver.ts` (kill the phantom view stub, cross-engine)

> Satisfies `graph-normalization` "Catalog-to-graph node and edge production" (fires_on resolved to the ACTUAL node kind;
> trigger firing on a view resolves to the view node; SQLite INSTEAD OF exact, no phantom stub; minimal fixture regression).
> Programmatic exact assertions FIRST; the SQLite golden family stays HELD for B4. Cross-engine goldens are a regression
> pin (blast radius EMPTY, D4). Realizes D4.

- [x] B3.1 **(vitest)** RED→GREEN `test/core/normalize/fires-on-target.test.ts` (new) +
  `src/core/normalize/reference-resolver.ts`: add `resolveTriggerTarget(schema, name, nodeMap, excludedQNames,
  referencedById)` that probes `nodeMap` for an EXISTING real node across `['table','view']`, else falls back to
  `resolveOrStub('table', …)`; wire `buildFiresOnEdges` to use it. RED first: (a) an INSTEAD-OF trigger on an existing VIEW
  resolves to the `view` node (kind `view`), NO `[table]` `missing:true` stub minted; (b) a TABLE-firing trigger resolves to
  the `table` node and its `fires_on` edge id `edgeId('fires_on', trig, dst, event)` is UNCHANGED (byte-identical,
  regression pin); (c) a trigger firing on a genuinely MISSING object still becomes a `missing:true` stub. Spec:
  `graph-normalization` "Trigger firing on a view resolves to the view node (cross-engine)". Design D4. Done:
  `npm test fires-on-target`.
- [x] B3.2 **(vitest)** RED→GREEN extend `test/core/normalize/normalize.test.ts` — exact SQLite + minimal-fixture pins:
  (a) over the SQLite torture graph, `fires_on` is EXACTLY `main.trg_active_dept_instead_insert → main.active_departments`
  with target node kind `view`, and NO `[table] active_departments` stub appears (`not.toContainEqual`; stub count for it
  is zero); (b) the `catalog-minimal.json` fixture still normalizes to its golden graph (2 tables, 1 FK, 1 view, 1 trigger
  → exactly one `references`, one `depends_on`, one `fires_on`) — regression. Spec: `graph-normalization` "SQLite INSTEAD OF
  trigger fires on the view, no phantom stub (exact)" + "Minimal fixture normalizes to the golden graph". Design D4. Done:
  `npm test normalize`.
- [x] B3.3 **(vitest)** CROSS-ENGINE NO-DRIFT proof (part of the gate): assert the pg / mssql / mysql normalize+e2e
  goldens are BYTE-IDENTICAL after the shared `buildFiresOnEdges` change — each engine's torture trigger fires on a TABLE
  (audited in design D4), so the resolved node and edge id are unchanged. RED intent: any cross-engine golden drift is a
  HARD STOP (investigate — the fix leaked beyond view-targets), NEVER a re-bless. Spec: `graph-normalization` cross-engine
  invariant. Design D4 (blast-radius audit). Done: `npm test` pg/mssql/mysql normalize+e2e suites; `git diff --exit-code`
  on their goldens EMPTY.
- [x] B3.4 GATE (Batch B3): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN for the NEW/regression suites
  (fires-on-target + normalize + cross-engine no-drift; baseline 3162 + those suites); cross-engine goldens byte-identical
  (HARD STOP on drift). **Continue to HOLD the SQLite golden family** for B4 (D5). Leak-scan clean. Then COMMIT
  `fix(normalize): resolve trigger fires_on target by node kind, kill phantom view stub (cross-engine)`.

## Batch B4: THE deliberate re-bless (single commit, per-golden inventory) + precheck/affected pinning + benchmark enumerator

> Satisfies `mcp-server` "dbgraph_precheck aggregates DDL impact" + "dbgraph affected mirrors precheck" (SQLite column-drop
> surfaces the exact view + trigger dependents; affected includes them and exits 1; ALTER+DROP INDEX golden; non-matchable
> unmatched; clean script exits 0) + `benchmark` "Enumerator now yields view-dependency candidates on SQLite". The ONE
> re-bless batch (D5): every drifted SQLite golden re-blessed together with a per-golden inventory in the commit body; the
> exact edge sets were pinned by B2/B3 FIRST. Realizes D5 + resolves OQ1/OQ2/OQ3 + spec open questions a/d.

- [x] B4.1 **(audit — resolves OQ1/OQ2/OQ3, spec open question d)** Enumerate the EXACT drifting golden set over the
  torture graph before regenerating: run the suites and diff to identify which `test/mcp/golden/*` files move
  (candidates: `impact-tool-*`, `precheck-tool-*`, `related-tool-*`, `object-tool-*`, `explore-normal/full`, `explore-view`,
  `status-tool-*`, `path-tool-*` — the view/trigger gain neighbors and the edge count 54→64). CONFIRM the present-layer
  goldens `test/core/present/golden/*` use SYNTHETIC `PresentView` inputs (NOT the torture graph) and do NOT drift (OQ2).
  CONFIRM no benchmark test snapshots `generate.ts` output over the torture graph (OQ3). Record the final drift inventory
  for the B4.5 commit body. Design §Open Questions. Done: exact drift set enumerated; present-layer + benchmark
  no-snapshot confirmed.
- [x] B4.2 **(golden — DELIBERATE re-bless, single commit)** Regenerate the drifted SQLite goldens to match the pinned
  graph: `test/fixtures/sqlite/golden-raw-catalog.json` (views/triggers gain `dependencies`), `test/fixtures/sqlite/golden-e2e.json`
  (`edgeCount 54→64`: +4 `depends_on`, +6 `writes_to`; `nodeCount 54→53`; `stubCount 1→0`), and EACH enumerated
  `test/mcp/golden/*` from B4.1 (view/trigger gain neighbors; `explore-view.txt` gains its dependents;
  `impact`/`precheck` whatToTest gains the view + trigger). EVERY byte change traces to a new edge or the phantom-stub
  removal. RE-RUN → byte-identical (deterministic). Spec: `sqlite-extraction` "Edge set is deterministic"; `mcp-server`
  golden pinning. Design D5. Done: `npm test` sqlite golden-freeze + e2e + mcp golden suites green, byte-identical on re-run.
- [x] B4.3 **(vitest)** RED→GREEN extend `test/mcp/precheck.test.ts` + `test/cli/commands/affected.test.ts` — L-009 exact
  `whatToTest` on a SQLite `departments.dept_id` drop. **VERIFY the pinned set against the ACTUAL precheck output FIRST**
  (spec open question a: a bare `dept_id` may be unresolved → the engine pivots on the `departments` TABLE; assert the set
  the graph REALLY yields, do not hard-code an unverified assumption). Target: `whatToTest` EXACTLY
  `{main.active_departments, main.assignments, main.employee_summary, main.employees, main.trg_active_dept_instead_insert}`;
  `main.active_departments`/`main.employee_summary` in READERS (inbound `depends_on`), `main.employees`/`main.assignments`
  in READERS (inbound FK `references`), `main.trg_active_dept_instead_insert` in TRIGGERS (inbound `writes_to`); every item
  `confidence:'parsed'`; `affected script.sql --json` exits 1. Keep the `dbo.orders` ALTER+DROP INDEX golden + the
  non-matchable-unmatched + clean-script-exits-0 scenarios GREEN (regression). Spec: `mcp-server` "SQLite column-drop
  surfaces the exact view + trigger dependents", "affected on a SQLite departments column-drop includes view + trigger
  dependents", "ALTER + DROP INDEX … golden", "Non-matchable identifiers … unmatched", "affected reports changes and exits
  1; clean script exits 0". Design §Data Flow. Done: `npm test precheck`; `npm test affected`.
- [x] B4.4 **(vitest)** RED→GREEN `test/benchmark/generate.test.ts` (new): build the SQLite substrate from
  `test/fixtures/sqlite/torture.sql`, run the `view-dependency` enumerator (`getEdgesFrom(view, ['depends_on','reads_from'])`)
  and assert it now yields AT LEAST ONE candidate (the 2 torture views) where it previously yielded ZERO — the family is
  INSTANTIABLE. Assert this WITHOUT bumping N, adding a run, or touching the frozen `benchmark/questions.yaml` set (the
  N-change is DEFERRED to its own labeled run). Spec: `benchmark` "Enumerator now yields view-dependency candidates on
  SQLite" + "N and the committed question set are unchanged; prior runs stay frozen". Design §Scope (out-of-scope N-change).
  Done: `npm test benchmark`.
- [x] B4.5 GATE (Batch B4 — the RE-BLESS commit): `npx tsc --noEmit` clean; `npm run lint` 0/0; **`npm test` FULL GREEN**
  (baseline 3162 + ALL new suites: tokenizer, dependency-edges, capabilities, fires-on-target, normalize, precheck,
  affected, benchmark) with EVERY re-blessed SQLite golden byte-identical on re-run; cross-engine goldens byte-identical
  (HARD STOP on drift); `questions.yaml` data portions byte-stable (only the comment moved); read-only + ADR-004 boundary
  green; leak-scan clean. Then COMMIT `test(sqlite): re-bless view/trigger dependency goldens + pin precheck whatToTest` —
  the commit body carries the B4.1 PER-GOLDEN INVENTORY (which file changed, which new edges / stub removal justify it).
  NEVER a silent regeneration.

## Batch B5: Final consolidated gate + Definition-of-Done trace

> The final verification pass before `sdd-verify`. No new source or golden change expected — the change is CODE-complete at
> the B4 re-bless commit. Confirms the whole suite, the cross-engine invariant, the read-only boundary, and traces every
> success criterion. If clean, no new commit; hand off to verify.

- [x] B5.1 GATE (Batch B5 — FINAL): `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; `npm test` FULL GREEN
  (baseline 3162 + all sqlite-view-deps suites) with EVERY golden byte-identical on re-run; cross-engine (pg/mssql/mysql)
  goldens byte-identical; `benchmark/questions.yaml` frozen data untouched (comment-only); target DB read-only + ADR-004
  core/adapter boundary tests green; leak-scan clean across all new files; confirm NOTHING pushed (NO push/PR/gh/tag).
  Trace the Definition of Done below. Done: full gate green; DoD traced; ready for `sdd-verify`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch B1** (B1.1–B1.3): PURE SEAMS — `src/adapters/engines/sqlite/tokenizer.ts` (`sqliteCanonicalize` +
  `extractTriggerActionBlock` header-strip + `tokenizeSqliteBody` over `_shared/tokenizer-core.ts`) + `tokenizer.test.ts`.
  ALL vitest, NO graph change, NO golden drift.
- **Batch B2** (B2.1–B2.6): EXTRACTION WIRING — `sqlite/map.ts` `buildRawCatalog` `potentialDeps` + `extractViews`/`extractTriggers`
  tokenize (drop `dependencies: []`) + L-009 exact-set integration on the torture graph + `capabilities.ts` comment +
  `benchmark/generate.ts`/`questions.yaml` comment-only corrections. SQLite golden family HELD for B4.
- **Batch B3** (B3.1–B3.4): NORMALIZE FIX — `reference-resolver.ts` `resolveTriggerTarget` (probe table→view) + `buildFiresOnEdges`
  wiring + exact SQLite/minimal pins + cross-engine no-drift regression. SQLite golden family still HELD.
- **Batch B4** (B4.1–B4.5): THE RE-BLESS — enumerate/audit the drift set (OQ1/OQ2/OQ3), regenerate `golden-raw-catalog`/`golden-e2e`/enumerated
  `test/mcp/golden/*` in ONE commit with inventory, pin precheck/affected `whatToTest` (verify vs actual first), prove the
  benchmark enumerator is instantiable. The ONLY re-bless batch; full suite green.
- **Batch B5** (B5.1): FINAL consolidated gate + DoD trace. No new code/golden; hand off to verify.

### Parallel vs sequential

- **Batches are STRICTLY SEQUENTIAL: B1 → B2 → B3 → B4 → B5.** They share the tokenizer seam, the torture graph, and a
  SINGLE golden re-bless chain, so they cannot overlap. B1's pure seams must land before B2 wires them; B2's extraction and
  B3's normalize BOTH drift `golden-e2e`, so the re-bless MUST wait until both are in (else drip re-bless, D5-rejected);
  B4's re-blessed goldens + pinned `whatToTest` are B5's verification oracle.
- **Within B2, the view path (B2.1) and trigger path (B2.2) are logically independent** but land in the single `map.ts` —
  one apply sub-agent per batch, not split across agents. B2.3's L-009 integration depends on BOTH.
- **Within B4, B4.2 (re-bless) depends on B4.1 (enumeration)**; B4.3 (precheck) and B4.4 (benchmark) depend on the
  re-blessed graph being green. All land in the single re-bless session/commit.

### Dependency bottlenecks

- **The single re-bless (B4) is the sharp edge for GOLDEN DISCIPLINE (D5).** `golden-e2e` drifts from BOTH B2 (new edges)
  and B3 (stub removal); re-blessing it before B3 would be a per-file drip re-bless, which D5 REJECTS. Therefore B2 and B3
  land CODE with PROGRAMMATIC L-009 tests (green) and HOLD the SQLite golden family — knowingly drifted, NOT re-blessed —
  until B4 regenerates everything ONCE with a per-golden inventory. Do NOT re-bless piecemeal to make an intermediate gate
  green; that is the exact anti-pattern this discipline forbids.
- **Cross-engine byte-identity is the phase-wide invariant (D4).** The shared `buildFiresOnEdges` fix touches every
  engine's normalize path, but only SQLite exercises a view-targeted trigger — pg/mssql/mysql goldens MUST stay
  byte-identical at EVERY gate. A cross-engine drift means the fix leaked beyond view-targets (or "try view first" crept in):
  HARD STOP, investigate, do NOT re-bless.
- **L-009 exactness is load-bearing because of the trigger ON-header leak risk.** The header-strip (`extractTriggerActionBlock`,
  D2) is the ONLY thing keeping the fires_on object out of `reads_from`/`writes_to`. The exact-set tests assert the FULL set
  AND the explicit negatives (`not.toContainEqual` the ON-target, no `reads_from` at all) — existence-only assertions would
  silently pass a leak.
- **`whatToTest` is not pinned until B4 (spec open question a).** The `departments.dept_id` DDL may leave a bare `dept_id`
  unresolved so the engine pivots on the `departments` table; B4.3 VERIFIES the exact set against the ACTUAL precheck output
  BEFORE pinning it — do NOT hard-code an unverified assumption in the tasks/spec.
- **`benchmark/questions.yaml` is a HARD STOP surface (spec open question c).** Only the stale comment may change; any
  structural byte moving in the frozen question set (N, ids, prompts, ground truth) is a protocol drift that MUST NOT ship in
  this change (the N=5→6 re-run is DEFERRED to its own labeled run). B2.5 guards byte-stability of the data portions.
- **No orchestrator/benchmark-run batch exists.** Unlike explore-payloads, this change makes the `view-dependency` family
  INSTANTIABLE only (B4.4 proves the enumerator yields candidates); bumping N, regenerating the committed set, and recording
  a Run 3 against the new `affected`-derived key are DEFERRED to a separate labeled run — OUT OF SCOPE here.

## Definition of Done (tied to the proposal's Success Criteria; 17 spec scenarios across 5 requirements traced)

- [x] `extractViews` emits `depends_on` edges EXACTLY `main.active_departments → {main.departments, main.employees}` and
  `main.employee_summary → {main.employees, main.departments}` (src+dst qnames, `confidence:'parsed'`). — Batch B2 (B2.1,
  B2.3) [scenarios: View bodies emit exact depends_on; Edge set is deterministic]
- [x] `extractTriggers` emits `writes_to` for the five `trg_emp_* → main.audit_log` + `trg_active_dept_instead_insert →
  main.departments`, with NO spurious `reads_from`/`writes_to` to the fires_on object and NO `reads_from` at all. — Batch B2
  (B2.2, B2.3) [scenarios: Trigger action bodies emit exact writes_to; Trigger header never leaks (negative); No self-edges
  and no phantom edges (negative)]
- [x] `trg_active_dept_instead_insert` `fires_on` the VIEW `main.active_departments` (kind `view`) and NO `[table]
  active_departments` phantom stub appears; table-triggers stay byte-identical; the minimal fixture still normalizes to its
  golden. — Batch B3 (B3.1, B3.2, B3.3) [scenarios: Trigger firing on a view resolves to the view node (cross-engine);
  SQLite INSTEAD OF trigger fires on the view, no phantom stub (exact); Minimal fixture normalizes to the golden graph]
- [x] `dbgraph_precheck` / `dbgraph affected` `whatToTest` for `departments.dept_id` is EXACTLY the five dependents (2
  views + 2 FK tables + the INSTEAD OF trigger), each `confidence:'parsed'`; `affected --json` exits 1; the `dbo.orders`
  golden + unmatched + clean-exit-0 regressions stay green. — Batch B4 (B4.3) [scenarios: SQLite column-drop surfaces the
  exact view + trigger dependents; affected includes view + trigger dependents; ALTER + DROP INDEX golden; Non-matchable
  reported as unmatched; affected reports changes and exits 1; clean script exits 0]
- [x] `supportsDependencyHints` remains `false` (matching pg/mysql/mongodb); the `capabilities.ts` comment and the
  `benchmark/generate.ts` + `questions.yaml` blindness notes are corrected to state edges are body-derived. — Batch B2
  (B2.4, B2.5) [scenarios: `supportsDependencyHints` stays false, comment corrected; Stale blindness comments corrected]
- [x] The `view-dependency` enumerator yields ≥1 candidate (the 2 torture views) on the SQLite substrate where it
  previously yielded ZERO — the family is INSTANTIABLE — WITHOUT bumping N or altering the frozen committed question set
  (N-change deferred). — Batch B4 (B4.4) [scenarios: Enumerator now yields view-dependency candidates on SQLite; N and the
  committed question set are unchanged; prior runs stay frozen]
- [x] Every re-blessed SQLite golden (`golden-raw-catalog.json`, `golden-e2e.json`, the enumerated `test/mcp/golden/*`) is
  committed as ONE DELIBERATE re-bless with a per-golden inventory and is byte-identical on re-run; cross-engine goldens are
  byte-identical; target DB stays strictly READ-ONLY (ADR-004 boundary green). — Batch B4 (B4.1, B4.2, B4.5), Batch B5
  (B5.1) [scenarios: Edge set is deterministic]
- [x] `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; `npm test` GREEN (baseline 3162 + all new suites)
  with every golden byte-identical on re-run; leak-scan clean — proven LOCALLY (no CI), nothing pushed. — every batch GATE
  (B1.3, B2.6, B3.4, B4.5, B5.1)
