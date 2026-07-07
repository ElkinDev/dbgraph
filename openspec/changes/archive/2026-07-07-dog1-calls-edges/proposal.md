# Proposal: DOG-1 — `calls` Edges (routine → routine invocation)

> First child of the **deep-object-graph** epic (`openspec/changes/deep-object-graph/proposal.md`).
> Size M, no deps, ordered FIRST. Lays the `target.kind`-preservation plumbing DOG-3 reuses.

## Intent

dbgraph models WHERE a routine reaches (`reads_from`/`writes_to`/`depends_on`) but not what it CALLS.
A proc invoking another proc is not merely unmodeled — it is **MIS-modeled**, and the fault is traced
end-to-end in code:

1. `SQL_MSSQL_DEPENDENCIES` (`mssql/queries.ts:304`) selects `referenced_id` but NOT the referenced
   object's TYPE.
2. `mssql/map.ts:564` `deps.map(d => ({ ref_schema_name, ref_object_name }))` — even the id is dropped;
   only schema+name survive.
3. `tokenizeModuleDeps` (`mssql/tokenizer.ts:100`) emits `RawDependency { target: { schema, name } }`
   with NO `kind` and a hardcoded `confidence: 'parsed'`.
4. `buildDependencyEdges` (`reference-resolver.ts:284`) defaults `targetKind = dep.target.kind ?? 'table'`
   → a proc→proc reference becomes a `reads_from` edge to a NON-EXISTENT table → a spurious `missing`
   table stub.

**Measured honestly:** the bug is currently DORMANT — NO torture fixture in ANY engine has a routine
calling another routine (mssql `sp_place_order`/`sp_dynamic_search`/`fn_*`, pg `fn_place_order`/
`proc_cancel_order`, mysql `proc_place_order`/`fn_audit_write` all touch TABLES only). So `calls`
coverage is ZERO and the latent stub bug has no fixture to surface it. DOG-1 both FIXES the plumbing and
ADDS the routine-calls-routine fixtures that prove it.

Now is the moment: the `RawDependency` contract, the shared tokenizer, and the `declared|parsed|inferred`
confidence model already exist — DOG-1 extends them, and every downstream DOG child reuses the
kind-preservation seam it introduces.

Success = a proc calling a proc yields exactly ONE `calls` edge with the engine's honest confidence
(mssql `declared`, pg/mysql/sqlite `parsed`) and ZERO table stub; `affected`/`impact` traverse call
chains; `explore`/`object` show `calls` in neighbor sections; L-009 exact-set goldens (src+dst+kind+
confidence, positives AND negatives) pin it and existing impact goldens are re-blessed DELIBERATELY.

## Scope

### In Scope
- **New edge kind `calls`** — routine→routine (`EXEC`/`CALL`/`SELECT fn()`) added to `EdgeKind` union +
  `EDGE_KINDS` tuple (`core/model/edge.ts`).
- **Kind-preservation plumbing (the shared architectural seam)**: carry `RawDependency.target.kind`
  end-to-end. mssql: extend `SQL_MSSQL_DEPENDENCIES` with `LEFT JOIN sys.objects ref ON ref.object_id =
  dep.referenced_id` → `ref.type AS ref_object_type`; add `ref_object_type` to `DepRow`; map via the
  existing `moduleTypeToKind`; stop dropping it in `map.ts` and `tokenizeModuleDeps`.
- **Normalize branch (written ONCE, engine-agnostic)**: in `buildDependencyEdges`, when
  `dep.target.kind` is a routine (`procedure`/`function`), emit `calls`; else keep read/write logic.
  Resolve against ACTUAL routine nodes only (like inference resolves targets) — no target routine → NO
  edge (ADR-007 conservative; kills tokenizer false positives).
- **Per-engine `calls` sourcing (all four SQL engines):** mssql from the catalog
  (`sys.sql_expression_dependencies` + `sys.objects.type`) → `confidence: 'declared'`; pg/mysql/sqlite
  via the shared tokenizer presence-gate over bodies, candidate list EXTENDED to include routines →
  `confidence: 'parsed'`. mongodb N/A (no routines). Confidence carried on `RawDependency.confidence`;
  `buildDependencyEdges` passes it through unchanged.
- **Impact traversal**: add `calls` to `IMPACT_EDGE_KINDS` (`query/impact.ts`) as a READ-impact kind (a
  call is not a write) → `affected`/`impact` reach callers through call chains.
- **New fixtures (mandatory — no coverage exists)**: add a routine-calls-routine case to each engine's
  `torture.sql` — mssql proc→proc (drives the catalog/declared path AND the regression-stub golden),
  pg/mysql/sqlite proc→proc or proc→fn (drives the parsed path).
- **L-009 exact-set tests**: assert `src+dst+kind+confidence` for each `calls` edge — positives AND
  negatives (a routine that touches only tables emits ZERO `calls`; the mssql proc→proc emits ONE
  `calls` and ZERO table stub — the regression golden for the latent bug).
- **Deliberate golden re-bless**: impact/affected goldens shifted by the new edges, per-engine
  raw-catalog/e2e goldens gaining the `calls` edges, all re-blessed with the new-edge justification.

### Out of Scope (deferred, justified)
- **DOG-2/3/4** — parameters, column-level lineage, dynamic-SQL hardening: separate children.
- **Routine-body column lineage** through call chains — ADR-007 forbids grammar parsing; object-grain
  `calls` only.
- **Cross-database / unresolved calls** — mssql rows with NULL `referenced_id` are skipped (already);
  no speculative edge invented.
- **Structural inference of `calls`** — `calls` is `declared`/`parsed`, NEVER `inferred`; the US-008
  inference engine is untouched.
- **mongodb** — no routines; capability declared absent, not fabricated.
- **Present-layer redesign** — the shared formatter already iterates all edge kinds; `calls` renders
  with no formatter rewrite (see Approach).

## Capabilities

> Contract for sdd-spec. Names verbatim from `openspec/specs/`.

### New Capabilities
- None. `calls` extends the EXISTING `graph-model` edge taxonomy; no new capability directory.

### Modified Capabilities
- `graph-model`: add `calls` to `EdgeKind`/`EDGE_KINDS`; state the per-engine confidence rule
  (mssql `declared` vs pg/mysql/sqlite `parsed`).
- `graph-normalization`: preserve `RawDependency.target.kind`; branch routine-target → `calls` (not a
  mis-typed table stub); deterministic edge ordering (ADR-008).
- `graph-query`: `impact`/`affected` traverse `calls` (read-impact); deterministic output.
- `schema-extraction`: engine-agnostic contract for the referenced-object KIND on `RawDependency`.
- `mssql-extraction`: dependency query joins `sys.objects` for referenced type → routine-target
  `calls` at `confidence: 'declared'`; the latent-stub fix.
- `pg-extraction`, `mysql-extraction`, `sqlite-extraction`: tokenizer candidate list includes routines
  → body-parsed `calls` at `confidence: 'parsed'`.
- `benchmark`: new `call-graph` / `affected-through-calls` golden family.

## Approach

**Extend, don't reinvent** (epic invariant). One unifying architectural move: **preserve
`RawDependency.target.kind` end-to-end and branch on it in `buildDependencyEdges`.** Everything else is
engine adapters feeding that seam.

- **Provenance is per-engine and NEVER blurred (HONESTY / L-009).** mssql `calls` is genuinely
  catalog-declared: `sys.sql_expression_dependencies` resolves the referenced routine's IDENTITY and
  `sys.objects.type` its KIND — no body parse establishes the call, so `confidence: 'declared'`. This is
  a DELIBERATE per-engine split from mssql's existing `reads_from`/`writes_to` edges (which stay
  `'parsed'` because their read/write ACCESS is body-derived — a `calls` edge has no access dimension).
  pg/mysql/sqlite have no cheap call catalog → tokenizer presence-gate over bodies → `confidence:
  'parsed'`. Goldens pin the exact confidence per engine.
- **Present is nearly free.** `getNeighbors` applies NO edge-kind allowlist and the shared formatters
  (`present/explore.ts`, `related.ts`, `object.ts`) iterate `Object.keys(view.neighbors).sort()` — so
  `calls` appears in the grouped neighbor sections for CLI AND MCP automatically once the edges exist.
- **Conservative resolution.** `calls` resolves against REAL routine nodes only; a builtin
  (`SELECT count()`) or a table-named-like-a-function yields no routine node → no edge (ADR-007).

**Scope decision — all four SQL engines in ONE DOG-1 (recommended).** The normalize branch is shared and
written once; splitting engines would re-touch the same `reference-resolver.ts` code and re-bless
overlapping impact goldens twice. Each engine gets its own fixture + exact-set golden. **Fallback:** if
the golden churn proves unreviewable, split as DOG-1a (mssql catalog + shared seam + regression-stub
golden) → DOG-1b (pg/mysql/sqlite tokenizer). Recommend NOT splitting unless forced.

**Apply batches:** **A)** `edge.ts` `calls` kind + `buildDependencyEdges` routine branch + mssql
query/map/tokenizer kind-preservation + mssql proc→proc fixture + regression-stub golden (declared) →
**B)** pg/mysql/sqlite tokenizer routine candidates + fixtures + parsed L-009 goldens → **C)**
`IMPACT_EDGE_KINDS` += `calls` + deliberate impact/affected golden re-bless (positives + negatives).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/model/edge.ts` | Modified | Add `calls` to `EdgeKind` union + `EDGE_KINDS` tuple |
| `src/core/model/catalog.ts` | Modified | `RawDependency.target.kind` already optional — becomes load-bearing (documented) |
| `src/core/normalize/reference-resolver.ts` | Modified | `buildDependencyEdges` branches routine-target → `calls`; resolve real routine nodes only |
| `src/core/query/impact.ts` | Modified | `IMPACT_EDGE_KINDS` += `calls` (read-impact) |
| `src/adapters/engines/mssql/queries.ts` | Modified | `SQL_MSSQL_DEPENDENCIES` joins `sys.objects` for `ref_object_type` |
| `src/adapters/engines/mssql/map.ts` + `tokenizer.ts` | Modified | Plumb `ref_object_type`→`NodeKind`; stop dropping kind; `declared` for routine targets |
| `src/adapters/engines/{pg,mysql,sqlite}/map.ts` (+ tokenizer wiring) | Modified | Candidate list includes routines → parsed `calls` |
| `src/core/present/*` | Verify | Edge-kind-agnostic formatter already renders `calls`; confirm brief-count + ordering |
| `test/fixtures/{mssql,pg,mysql,sqlite}/torture.sql` | New/Modified | Add routine-calls-routine cases (none exist today) |
| `test/` per-engine raw-catalog/e2e/normalize + impact/affected goldens | Modified | Deliberate re-bless; new L-009 exact-set assertions |
| `openspec/specs/{graph-model,graph-normalization,graph-query,schema-extraction,mssql-extraction,pg-extraction,mysql-extraction,sqlite-extraction,benchmark}/` | Modified | Deltas per Capabilities |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Latent stub bug: mssql proc→proc → `reads_from`→non-existent table = spurious `missing` stub | High (by design, once fixture added) | Kind-preservation + routine branch; regression golden asserts exactly ONE `calls` edge and ZERO table stub |
| `calls` in `IMPACT_EDGE_KINDS` shifts existing impact/affected goldens | Med (contained — only where NEW fixture routines reach existing nodes) | Expected & intentional; re-pin every affected golden; L-009 exact sets, review each diff |
| Confidence blurring: mssql `declared` vs pg/mysql/sqlite `parsed` treated alike | Low | Each edge carries its tier; goldens assert exact `confidence` per engine (HONESTY) |
| Tokenizer false positives (`SELECT count()`, table named like a fn) | Med | Resolve against REAL routine nodes only; builtin allowlist; ADR-007 — no target routine → no edge |
| Extending pg/mysql/sqlite candidate list re-classifies existing table deps | Low-Med | Presence-gate is word-boundary + `maskDynamicStrings`; routines only ADD candidates, never reclassify tables; L-009 negatives pin non-`calls` edges |
| 4-engine golden churn in one PR becomes unreviewable | Med | Per-engine apply batches + per-engine goldens; documented fallback split (DOG-1a/1b) |
| Storage rejects the new edge kind (enum/CHECK) | Low | Epic says no migration; VERIFY in design that no store enum constrains `EdgeKind` |

## Rollback Plan

Purely additive and revertible. Revert by: removing `calls` from `EdgeKind`/`EDGE_KINDS` and
`IMPACT_EDGE_KINDS`; restoring `targetKind = dep.target.kind ?? 'table'` and the single read/write
branch in `buildDependencyEdges`; reverting `SQL_MSSQL_DEPENDENCIES` to drop the `sys.objects` join and
`map.ts`/`tokenizer.ts` to drop kind-preservation; removing the pg/mysql/sqlite routine candidates;
`git revert` of the golden commit to restore byte-pins; removing the added fixture cases. No FK/
reference/inference path, storage schema, or query-port surface is touched beyond the listed additions —
reverting DOG-1 leaves DOG-2/3/4 and all shipped engines green. The referenced-object stays strictly
read-only (ADR-004 boundary test).

## Dependencies

- Reuses `_shared/tokenizer-core.ts` (`classifyAccess`/`maskDynamicStrings`/`bodyContainsRef`),
  `RawDependency`/confidence model, and `buildDependencyEdges` — ZERO new npm packages (ADR-004/007/008
  intact).
- Routine bodies already extracted into `RawObject.body` at `DEFAULT_LEVELS`; no new query beyond the
  mssql `sys.objects` referenced-type join.
- No storage migration expected (VERIFY in design). Blocks **DOG-3** (kind/column-preservation seam).

## Success Criteria

- [ ] A proc calling a proc yields exactly ONE `calls` edge with the engine's correct confidence
      (mssql `declared`; pg/mysql/sqlite `parsed`) — exact `src+dst+kind+confidence` asserted (L-009).
- [ ] The mssql proc→proc fixture produces NO spurious `missing` table stub (regression golden).
- [ ] A routine touching only tables emits ZERO `calls` edges — negative assertion (L-009).
- [ ] `impact`/`affected` traverse `calls`: `affected` of a leaf table reaches procs that reach it
      through call chains — verified via `getImpact` over the new edges.
- [ ] `explore`/`object` show `calls` in the grouped neighbor sections for BOTH CLI and MCP.
- [ ] Every new edge declares provenance; per-engine capability differences stated plainly (HONESTY);
      all assertions exact-set (L-009), never existence-only; all re-blessed goldens committed as
      DELIBERATE with the new-edge justification; `tsc`/lint/test green; ADR-004 read-only boundary green.
