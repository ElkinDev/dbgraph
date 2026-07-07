# Design: DOG-1 — `calls` Edges (routine → routine invocation)

## Technical Approach

One architectural move: **preserve `RawDependency.target.kind` end-to-end and branch on it in
`buildDependencyEdges`** (epic invariant "extend, don't reinvent"). Everything else is per-engine
adapters feeding that seam.

- **Model** (`edge.ts`): add `calls` to the `EdgeKind` union + `EDGE_KINDS` tuple. No new confidence
  tier — `EdgeConfidence` and `RawDependency.confidence` ALREADY carry `'declared' | 'parsed'`
  (VERIFIED), and `RawDependency.target.kind?: NodeKind` already exists (becomes load-bearing).
- **Normalize** (`reference-resolver.ts`, engine-agnostic, written ONCE): new `resolveRoutineTarget`
  probes `nodeMap` for a REAL `procedure`/`function` node; `buildDependencyEdges` branches
  routine-target → `calls`, no real target routine → NO edge & NO stub (ADR-007).
- **mssql** = catalog-`declared`: `SQL_MSSQL_DEPENDENCIES` LEFT JOINs `sys.objects` for `ref.type`;
  plumbed through `DepRow`/`json-rows`/`map.ts`/`tokenizeModuleDeps` via the existing
  `moduleTypeToKind`, ROUTINE-gated.
- **pg/mysql** = tokenizer-`parsed`: `buildRoutines` extends its candidate list with routines (carrying
  `kind`); the shared presence-gate (`bodyContainsRef` over `maskDynamicStrings`) confirms the call.
- **sqlite / mongodb** = N/A (no routine objects exist — capability declared absent, not fabricated).

Bodies are already in `RawObject.body` at `DEFAULT_LEVELS`; the ONLY new query cost is the mssql
`sys.objects` self-join. Storage VERIFIED: `edges.kind`/`edges.confidence` are `TEXT NOT NULL` with NO
CHECK/enum (`storage/sqlite/schema.ts:45-53`) → **no migration**. Present is free — `getNeighbors` applies
no allowlist and formatters iterate `Object.keys(neighbors).sort()`.

## Architecture Decisions

### Decision 1 — Confidence & kind mechanics (no model addition)
**Choice**: REUSE existing types. `'declared'` already exists in `EdgeConfidence` /
`RawDependency.confidence`; `target.kind` already optional. Only `edge.ts` gains `calls`; `catalog.ts`
gets a doc comment stating the kind is now load-bearing and routine targets carry `'declared'` (mssql) or
`'parsed'` (pg/mysql). `buildDependencyEdges` passes `dep.confidence` through unchanged (already does).
**Rejected**: a new `'called'` confidence tier or a parallel `calls[]` field on `RawObject`.
**Rationale**: the confidence model was designed for exactly this split (declared=catalog identity+kind,
parsed=body-derived). No CHECK constraint blocks a new kind string — VERIFIED. Minimal surface.

### Decision 2 — mssql catalog JOIN + plumbing
**Choice**: extend `SQL_MSSQL_DEPENDENCIES` with `LEFT JOIN sys.objects ref ON ref.object_id =
dep.referenced_id` → `ref.type AS ref_object_type`. Add `ref_object_type: string | null` to `DepRow` and
to `coerceDepRow` (`json-rows.ts`, `optionalString`). `map.ts` maps it via the EXISTING
`moduleTypeToKind` and passes `{ ref_schema_name, ref_object_name, ref_object_type }` to
`tokenizeModuleDeps`, which sets `target.kind` + `confidence:'declared'` ONLY when the mapped kind is
`procedure`/`function` AND the referencing module is itself a routine; else unchanged (`parsed`, no kind).
**Rejected**: a second query; carrying `referenced_id` into normalize (id is engine-specific, breaks
ADR-004). **Rationale**: `LEFT JOIN` keeps NULL `referenced_id` rows (cross-db) which are already skipped
by the null-name guard. `ref.type` is `CHAR(2)` → a plain JSON string under top-level FOR JSON PATH — NOT
`sql_variant`, so NO coercion and the F-1..F-7 shape lessons are satisfied (scalar column, additive).
`moduleTypeToKind` already `.trim()`s the `CHAR(2)` padding.

### Decision 3 — Per-engine call detection (honest, dialect-specific)
**Choice**:
| Engine | Source of the call | Rule | Confidence |
|--------|-------------------|------|-----------|
| mssql | `sys.sql_expression_dependencies` (`EXEC`/`SELECT fn()` static refs) | catalog row + `ref.type ∈ {P,FN,IF,TF}` | `declared` |
| pg | body presence-gate | routine qname/name appears in masked static body (`PERFORM`/`SELECT fn(`/`CALL`) | `parsed` |
| mysql | body presence-gate | routine qname/name appears in masked static body (`CALL`/`fn(`) | `parsed` |
| sqlite | — | no routine objects exist → no candidate, no node, no edge | N/A |
| mongodb | — | no routines | N/A |

Candidate expansion is confined to `buildRoutines` (routine bodies) — NOT view bodies — so a view→fn
reference stays `depends_on`, keeping `calls` strictly routine→routine. `DepRef` in pg/mysql tokenizers
gains optional `kind` carried straight to `target.kind`.
**Honesty / false-positive register**: (a) mssql `sp_executesql`/variable-built `EXEC` (fixture
`sp_dynamic_search`) does NOT appear in `sys.sql_expression_dependencies` → correctly yields NO `calls`
edge; documented, not hidden. (b) `bodyContainsRef` gates on masked STRING literals only — `--`/`/* */`
comments are NOT masked (pre-existing limitation shared with `reads_from`), so a routine name in a comment
could over-approximate; mitigated by resolving against REAL routine nodes only. (c) presence-gate does not
prove call POSITION (a same-named variable over-matches) — accepted ADR-007 over-approximation.
**Rejected**: a T-SQL/plpgsql call-grammar (ADR-007 forbids); a builtin allow-list (`count()` resolves to
no routine node → already dropped).

### Decision 4 — Self-exclusion (honest correction to prior lesson)
**Choice**: EXPLICITLY self-exclude routine candidates in pg/mysql `buildRoutines`
(`schema===row.schema_name && name===row.routine_name`). **Rationale / correction**: the sqlite-view-deps
lesson "presence-gate guarantees self-exclusion" held for tables/views but is FALSE for pg —
`pg_get_functiondef` emits the full `CREATE FUNCTION app.fn_x(...)` header, so the body contains the
routine's OWN qname → without an explicit filter a routine would `calls` itself. mysql `ROUTINE_DEFINITION`
is body-only (self-ref unlikely) but the filter is applied uniformly for determinism. mssql self-calls do
not appear in the dependency catalog (a proc is not its own referenced entity).

### Decision 5 — Normalize routine-target resolution (no stub)
**Choice**: `resolveRoutineTarget(schema, name, nodeMap, referencedById)` probes `nodeMap` for a REAL
(non-missing, non-excluded) node across `['procedure','function']` (cross-kind, mirroring
`resolveTriggerTarget`); returns the node or `null`. In `buildDependencyEdges`: `if
isRoutineKind(dep.target.kind)` → resolve; `null` → **skip (no edge, no stub)**; else emit
`edgeId('calls', src, dst, '')` with `confidence: dep.confidence`, `attrs:{}`. The existing
read/write/depends_on branch is untouched for non-routine targets (`targetKind ?? 'table'` preserved).
**Rejected**: `resolveOrStub('procedure', …)` (would mint a phantom `missing` routine stub, reintroducing
the class of bug DOG-1 fixes). **Rationale**: a `calls` edge is only meaningful to a routine that exists;
an unresolved call is dynamic/builtin blindness, honestly dropped (ADR-007). NON-routine target.kind
(e.g. `view` from mssql `ref.type='V'`) is deliberately NOT attached in the adapter (Decision 2) so
proc→view keeps `reads_from`/`depends_on` with ZERO drift — proc→view kind-preservation is a latent item
left OUT OF SCOPE (see Open Questions).

### Decision 6 — Impact traversal + golden blast-radius
**Choice**: `IMPACT_EDGE_KINDS += 'calls'` as a READ-impact kind (it is NOT in `WRITE_KINDS`), so
`getImpact` and its consumer `runPrecheck.whatToTest` reach callers through call chains. Fixtures use
NEUTRAL names (leak-scan) — a new proc that `EXEC`s an existing proc per engine.
**Golden blast-radius (audited, HONESTY — re-bless DELIBERATELY, L-009 exact-set FIRST)**:
| Engine | raw-catalog | e2e/normalize | impact/affected | precheck/whatToTest | explore/object/related MCP |
|--------|-----------|---------------|-----------------|--------------------|----------------------------|
| mssql | proc gains `dependencies` w/ routine kind | +1 `calls`, **−1 phantom table stub** (regression golden) | caller chain via `calls` | caller in whatToTest | `calls` neighbor section |
| pg | routine gains routine dep | +1 `calls` | caller chain | caller | `calls` section |
| mysql | routine gains routine dep | +1 `calls` | caller chain | caller | `calls` section |
| sqlite | — none — | — none — | — none — | — none — | — none — |
| mongodb | — none — | — none — | — none — | — none — | — none — |
Also audit: any test snapshotting the `EDGE_KINDS` tuple, and present brief/summary edge-count goldens.
**Rejected**: making `calls` a write-impact kind. **Rationale**: a call is not a mutation; write-impact
must stay `writes_to`-only or `affected` write-sets over-report.

## Data Flow

    mssql:  sys.sql_expression_dependencies + LEFT JOIN sys.objects ref.type
                │  DepRow.ref_object_type ─► moduleTypeToKind (routine-gated)
    pg/mysql: routine body ─► buildRoutines candidate list (tables+views+ROUTINES, self-excluded)
                │  bodyContainsRef(maskDynamicStrings(body)) presence-gate
                ▼
        RawDependency { target:{schema,name,kind}, access, confidence: declared|parsed }
                ▼
        buildDependencyEdges ── isRoutineKind(target.kind)? ──► resolveRoutineTarget(['procedure','function'])
                │                                                    │ real node → calls edge (dep.confidence)
                │                                                    └ null      → NO edge, NO stub
                └ else ► reads_from / writes_to / depends_on (unchanged)
                ▼
        GraphStore ─► getImpact (IMPACT_EDGE_KINDS += calls) ─► affected / runPrecheck.whatToTest
                   └► getNeighbors ─► explore/object/related (calls section, CLI + MCP)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/model/edge.ts` | Modify | `calls` in `EdgeKind` union + `EDGE_KINDS` tuple |
| `src/core/model/catalog.ts` | Modify (doc) | Document `target.kind` load-bearing; routine targets carry `declared`(mssql)/`parsed`(pg,mysql) |
| `src/core/normalize/reference-resolver.ts` | Modify | `resolveRoutineTarget` (probe `[procedure,function]`, no stub); `buildDependencyEdges` routine branch → `calls`, skip if unresolved |
| `src/core/query/impact.ts` | Modify | `IMPACT_EDGE_KINDS += 'calls'` (read-impact) |
| `src/adapters/engines/mssql/queries.ts` | Modify | `SQL_MSSQL_DEPENDENCIES` LEFT JOIN `sys.objects ref` → `ref.type AS ref_object_type` |
| `src/adapters/engines/mssql/strategies/json-rows.ts` | Modify | `coerceDepRow` + `DepRow` gain `ref_object_type` (`optionalString`) |
| `src/adapters/engines/mssql/map.ts` | Modify | `DepRow.ref_object_type` → `moduleTypeToKind` (routine+routine-source gated) → pass to `tokenizeModuleDeps` |
| `src/adapters/engines/mssql/tokenizer.ts` | Modify | `DepRef` gains `ref_object_type`; set `target.kind` + `confidence:'declared'` for routine targets, `access:'read'` placeholder |
| `src/adapters/engines/pg/tokenizer.ts` | Modify | `DepRef` optional `kind`; carry to `target.kind` |
| `src/adapters/engines/pg/map.ts` | Modify | `buildRoutines` candidate list += routines (with `kind`), self-excluded |
| `src/adapters/engines/mysql/tokenizer.ts` + `map.ts` | Modify | Same as pg |
| `test/fixtures/{mssql,pg,mysql}/torture.sql` | Modify | Add neutral routine→routine fixture (mssql drives the regression-stub golden) |
| `test/fixtures/sqlite/*`, mongodb | Unchanged | N/A — no routines; capability absent |
| `test/**` per-engine raw-catalog/e2e/impact/affected/precheck + MCP explore/object/related | Re-bless | Per blast-radius table; L-009 exact `src+dst+kind+confidence` FIRST |
| `openspec/specs/{graph-model,graph-normalization,graph-query,mssql-extraction,pg-extraction,mysql-extraction,sqlite-extraction,mcp-server}` | Modify | Spec deltas (sdd-spec) — 8 files. `schema-extraction` & `benchmark` deliberately carry NO delta (see Spec Coherence) |

## Interfaces / Contracts

```ts
// src/core/normalize/reference-resolver.ts
function resolveRoutineTarget(                 // probes ['procedure','function'] for a REAL node
  targetSchema: string | null, targetName: string,
  nodeMap: NodeMap, referencedById: string,
): GraphNode | null;                            // null → caller emits NO edge, NO stub

// buildDependencyEdges (per dep): isRoutine(dep.target.kind) ?
//   (resolveRoutineTarget(...) ?? SKIP) → edgeId('calls', src, dst, '') @ dep.confidence
//   : existing reads_from/writes_to/depends_on branch (targetKind ?? 'table')

// mssql DepRow / DepRef additions
interface DepRow  { /* … */ ref_object_type: string | null; }   // ref.type CHAR(2) → trimmed
// pg/mysql tokenizer DepRef
interface DepRef  { schema: string; name: string; kind?: 'procedure' | 'function'; }
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (mssql) | `tokenizeModuleDeps` | routine ref → `target.kind` + `confidence:'declared'`; table/view ref → unchanged `parsed`, no kind; `sp_executesql` ref absent → no `calls` |
| Unit (pg/mysql) | `buildRoutines` candidates | routine candidate present; SELF excluded (pg header self-ref → no self-`calls`); string-literal/comment negatives |
| Unit (normalize) | `resolveRoutineTarget` + branch | real routine → 1 `calls` (dep.confidence); unresolved routine → 0 edges, 0 stubs; non-routine target → unchanged edge |
| Integration L-009 (exact-set) | per-engine torture graph | POSITIVE: proc→proc = exactly ONE `calls` (`src+dst+kind+confidence`); NEGATIVE: table-only routine = ZERO `calls`; mssql proc→proc = ZERO table stub (regression) |
| Integration | `getImpact`/`affected`/precheck | leaf-table `affected` reaches callers through `calls` chains; `whatToTest` gains callers |
| Integration | explore/object/related (CLI+MCP) | `calls` neighbor section renders both surfaces; brief edge-count updated |
| Determinism (ADR-008) | extract twice | byte-identical `dependencies` ordering (candidates name-sorted) |

**Test vehicle for the `calls`/impact-closure pins (RESOLVED — spec Q2: BOTH tiers).** The `calls`
behavioral pins run at TWO tiers, not one — this resolves the `mcp-server` delta's open "test vehicle
is a design decision" note. (1) **`npm test` synthetic tier** — build a `RawCatalog` IN-MEMORY with the
routine chain (`dbo.usp_refresh_totals` EXEC `dbo.usp_log_change` → normalize), then assert the `calls`
edges AND the impact closure `{dbo.usp_refresh_totals}` with NO containers; keeps the pin in the default
CI run. (2) **Integration tier** — the SAME assertions ADDED to the EXISTING mssql Testcontainers suite
(`DBGRAPH_INTEGRATION`-gated) over the real materialized fixture, proving the catalog path end-to-end.
The synthetic closure set and the mssql-gated `whatToTest` set are the SAME `{dbo.usp_refresh_totals}`,
byte-consistent with the `graph-query` and `mcp-server` deltas.

## Migration / Rollout

No data migration, no store/query/port contract change (`edges.kind`/`confidence` are unconstrained
`TEXT` — VERIFIED). Purely additive & reversible (ADR-004 read-only boundary intact): revert `edge.ts` /
`IMPACT_EDGE_KINDS` additions, restore `targetKind ?? 'table'` single branch, drop the `sys.objects` join +
`ref_object_type` plumbing + pg/mysql routine candidates, `git revert` the single golden re-bless commit,
remove the added fixtures. **Batches** (single deliberate re-bless per batch, explore-payloads discipline;
TDD: L-009 red → implement → deliberate green): **A** shared seam + mssql catalog + mssql fixture +
regression-stub golden (`declared`) → **B** pg + mysql tokenizer candidates + fixtures + `parsed` goldens
(pg/mysql files are independent → parallel-safe within B) → **C** `IMPACT_EDGE_KINDS += calls` +
impact/affected/precheck/explore re-bless (positives + negatives, all engines). Benchmark `call-graph`
family is now INSTANTIABLE; the actual N-change / labeled re-run is DEFERRED (matches prior discipline).

## Spec Coherence (sdd-spec reconciliation)

The EIGHT spec deltas under `specs/` are the authoritative WHAT for this change; the reconciliation
rulings that make the spec set and this design contradiction-free for `sdd-tasks`:

- **graph-query — DELTA WRITTEN.** `specs/graph-query/spec.md` MODIFIES the "Depth-limited impact
  closure separating read and write" requirement: `IMPACT_EDGE_KINDS += 'calls'` is a READ-impact kind,
  so the closure reaches callers through inbound `calls` chains (WRITE impact stays `writes_to`-only).
  This spec — not `mcp-server` — is the CANONICAL home of the `IMPACT_EDGE_KINDS` traversal semantics;
  `mcp-server` precheck/`whatToTest` CONSUMES it. The two deltas are pinned BYTE-CONSISTENT over the
  mssql chain `calls dbo.usp_refresh_totals → dbo.usp_log_change`: altering/dropping
  `dbo.usp_log_change` yields the EXACT set `{dbo.usp_refresh_totals}` in BOTH the graph-query READ
  closure and the mcp-server `whatToTest`.
- **schema-extraction — NO DELTA (recorded).** `RawDependency.target.kind` is ALREADY OPTIONAL in the
  `graph-model`/ports contract (VERIFIED; schema-extraction §"extract produces a RawCatalog the
  normalizer can consume" forbids the adapter changing the `RawCatalog` SHAPE). DOG-1 changes the USAGE
  of `target.kind` (makes it load-bearing), NOT its SHAPE — so no schema-extraction contract delta is
  warranted. The kind-preservation plumbing lives in the per-engine extraction deltas (mssql/pg/mysql)
  and `graph-normalization`.
- **cli-config — NO DELTA (confirmed).** The SQLite-only CLI goldens carry NO routines, so no CLI golden
  drifts from `calls`; the shared present formatter (iterating `Object.keys(neighbors).sort()`) renders
  the `calls` neighbor section with no config or rendering-contract change. The `mcp-server`
  explore/related delta OWNS the `calls`-rendering pin for both surfaces (CLI + MCP share the formatter).
- **sqlite-extraction — DELTA PINS ABSENCE.** Resolves Open Question 1: the delta DROPS the proposal's
  positive proc→proc fixture/capability claim and instead pins the honest ABSENCE (zero `calls`,
  `CapabilityMatrix` unchanged), mirroring the mongodb precedent.

**Final delta inventory (8):** `graph-model`, `graph-normalization`, `graph-query`, `mssql-extraction`,
`pg-extraction`, `mysql-extraction`, `sqlite-extraction`, `mcp-server`.

## Open Questions

- [x] **Proposal contradiction — SQLite. RESOLVED (sdd-spec).** Proposal In-Scope lists a sqlite
      `proc→proc` fixture, but SQLite has NO stored routines (`sqlite/map.ts` tokenizes only
      views+triggers). The `sqlite-extraction` delta DROPS the positive fixture/capability claim and
      pins ONLY the honest ABSENCE (zero `calls`, `CapabilityMatrix` unchanged), matching proposal
      Decision-3 "sqlite N/A" + the mongodb precedent. No sqlite fixture object is added.
- [x] **Benchmark `call-graph` family. RESOLVED-DEFERRED (sdd-spec).** A call-graph / affected-through-
      calls question family is a PROTOCOL change over the benchmark harness (the SQLite primary
      substrate is routine-free; the benchmark spec is methodology-only, touching NOTHING in `src/**`),
      so it becomes its OWN labeled run change LATER — NOT part of DOG-1 (precedent: the N-change
      deferral). DOG-1 makes the family INSTANTIABLE (the `calls` edges now exist) but ships NO
      `benchmark` spec delta and NO labeled re-run.
- [ ] **proc→view kind-preservation.** mssql `ref.type='V'` could carry `view` kind (resolving proc→view
      to the real view instead of a table stub) — a latent correctness gain but wider drift. Left OUT OF
      SCOPE (attach routine kinds only). Confirm no mssql torture proc references a view today (else
      unexpected drift when gating). Note for a future change.
- [ ] **`EDGE_KINDS` tuple placement + snapshots.** Confirm no test byte-pins the tuple order; choose an
      insertion slot that reads naturally (e.g. after `depends_on`).
- [ ] **Present brief edge-count goldens.** Confirm which present goldens use synthetic PresentView inputs
      (no drift) vs. torture-graph inputs (drift) — audit during apply, fold into the batch-C re-bless.
- [ ] **Fixture call form per dialect.** Pick the exact neutral call statement (mssql `EXEC`, pg `PERFORM`
      vs `SELECT fn()`, mysql `CALL`) that the presence-gate/ catalog resolves cleanly without tripping
      `hasDynamicSql`.
