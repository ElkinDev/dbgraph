# Archive Report — dog1-calls-edges

**Change**: dog1-calls-edges (DOG-1 — calls edges, routine→routine invocation)
**Branch**: post-v1 (repo dbgraph)
**Artifact store**: openspec (files) — no engram writes
**Archived**: 2026-07-07
**Verdict**: PASS — 0 CRITICAL / 0 WARNING / 2 SUGGESTION (see `verify-report.md`, carried into this archive)

## Shipped Commits

| Commit | Summary |
|--------|---------|
| `a0f54a4` | docs(dog1-calls-edges, graph-viz): add SDD planning (specs, designs, tasks); reconcile dog1 delta inventory |
| `5fd1d48` | feat(mssql): catalog-declared calls edges via ref_object_type seam + regression-stub golden |
| `2a9a021` | feat(pg,mysql): body-parsed calls edges via self-excluded routine candidate list |
| `c2ed29b` | feat(query,mcp): traverse calls as read-impact and render calls neighbors |

## Headline

Routine→routine `calls` edges are now live across the SQL engines with HONEST per-engine provenance:
mssql resolves them from the CATALOG (`sys.sql_expression_dependencies` identity + `sys.objects.type`
kind, threaded on `RawDependency.target.kind`) so its `calls` edges are `declared`; pg and mysql derive
them from the shared body tokenizer (whose candidate list now includes routine names) so theirs are
`parsed`; SQLite emits NONE (no routine objects — pinned by an explicit negative). No `calls` edge is
ever `inferred`. The same normalizer branch that mints the `calls` edge FIXES a latent proc→proc bug:
`buildDependencyEdges` previously defaulted `targetKind = dep.target.kind ?? 'table'`, turning a routine
invoking a routine into a `reads_from` edge over a phantom `missing` `[table]` stub. Resolution is now
conservative (ADR-007) — a real routine node or NO edge, never a stub — with REAL regression protection:
two independent reverts each break a pinned L-009 exact-set test (wrong `reads_from` edge, or the phantom
`[table]` stub reappears), proven at both the synthetic and Docker container tiers (stubCount 0 across all
three SQL goldens). Impact/affected now traverse call chains: `IMPACT_EDGE_KINDS += 'calls'` as a
READ-impact kind (a caller depends on its callee like a read, not a write), so altering a called routine
surfaces its callers in `getImpact`, `dbgraph_precheck` and `dbgraph affected` — the whole downstream
reach cost ONE line of production change in batch C (the graph-query/mcp seam was already in place; it
paid off). `dbgraph_explore` and `dbgraph_related` render `calls` neighbors AUTOMATICALLY with direction
(zero production change — `getNeighbors` returns all kinds and the shared formatter iterates the sorted
neighbor kinds; CLI and MCP stay byte-identical). Test suite grew 3253→3347. Cross-engine + SQLite/mongodb
freeze held throughout: zero sqlite/mongodb src or golden drift, no re-blessed goldens beyond the
deliberate mssql/pg/mysql routine-calls re-bless.

## Documented Deviations Accepted (all evaluated SOUND per verify-report.md)

1. **`resolveRoutineTarget` drops the design's `referencedById` param** — SOUND: the routine branch never
   stubs, so no stub id is needed; the design interface was speculative.
2. **`refTypeToRoutineKind` co-located in `tokenizer.ts`** — SOUND: avoids a map/tokenizer import cycle;
   routine-only subset with correct T-SQL mapping (`P`→procedure, `FN`/`IF`/`TF`→function), trims the
   `CHAR(2)` padding.
3. **`access` read placeholder on the declared `calls` dep** — SOUND: the normalize routine branch ignores
   `dep.access` (it emits `calls`).
4. **Offline row fixtures hand-curated vs container goldens (mssql, and pg/mysql)** — both tiers green and
   byte-identical; the container e2e validates the rows against reality (see SUGGESTION S-1).
5. **Kind-agnostic ALTER TABLE identifier pivot to a procedure (batch C)** — SOUND: the qname is extracted
   and the graph resolves the kind; mirrors the SQLite `main.departments` table pivot.
6. **C.3 zero production change** — CONFIRMED: no `src/core/present` change; the shared formatter renders
   `calls` via `Object.keys(neighbors).sort()`.

## Suggestions Recorded as Future Items (2, non-blocking)

1. **S-1 — offline row fixtures vs `torture.sql` coupling.** The pg/mysql `test/fixtures/*/rows/routines.json`
   fixtures are hand-maintained and decoupled from `torture.sql`; only the `DBGRAPH_INTEGRATION`-gated
   container tier catches a drift between them (both green today). Consider a cheap default-CI consistency
   check so a future `torture.sql` edit not mirrored into the offline rows fails without the gate.
2. **S-2 — symmetric latent phantom-stub for non-routine sources (out of DOG-1 scope).** `calls` gates on
   `sourceIsRoutine`, so a TRIGGER or VIEW that invokes a stored routine would still default `target.kind`
   → `table` and could mint a phantom `[table]` stub — the mirror of the deferred proc→view
   kind-preservation item. Verified DORMANT: no current mssql torture trigger/view invokes a routine and
   stubCount 0 holds across all three SQL goldens. Worth a one-line note for a future change.

## Specs Synced (8 delta specs → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| `graph-model` | Updated | 1 MODIFIED + 1 ADDED. MOD `Edge taxonomy with event and dynamic-SQL flag` replaced IN PLACE — `calls` added to the edge-kind list, a `calls`-edge definition paragraph added, a new `(Previously: ...)` note (supersedes the prior inference-scoring note), plus the new scenario `calls edge connects two routine nodes`; the existing `fires_on`/`inferred_reference` scenarios preserved. ADD `calls edge provenance is engine-determined, never inferred` inserted immediately after the MOD requirement (coherent grouping) with its 2 scenarios. |
| `graph-normalization` | Updated | 1 ADDED. `Routine-target dependencies become calls edges resolved to real routines` inserted after `Read and write edges from module bodies` (edge-production grouping), with its `(Previously: ...)` note and 4 scenarios (proc→proc byte-pin regression, unresolved-target negative, table-only negative, real-recursion self-call). Inline — no dated-section convention in this file. |
| `graph-query` | Updated | 1 MODIFIED. `Depth-limited impact closure separating read and write` replaced IN PLACE — paragraph extended with `IMPACT_EDGE_KINDS += 'calls'` as READ-impact semantics, a `(Previously: ...)` note added, the 4 existing scenarios preserved and 1 appended (`Impact of a called routine reaches its callers through the inbound calls chain`). This spec is the canonical home of the traversal semantics. |
| `mssql-extraction` | Updated | 2 ADDED via a DATED sub-section `## Requirements Added by dog1-calls-edges (2026-07-07)` (matching this file's connectivity-strategies precedent — `---` + header + summary blockquote): `Catalog-declared calls edges for routine invocations` (3 scenarios) and `mssql torture fixture exercises routine-calls-routine` (1 scenario). |
| `pg-extraction` | Updated | 2 ADDED, appended inline at the tail of the Requirements list (this file has no dated-section precedent — flat inline structure): `Body-parsed calls edges for routine invocations` (3 scenarios) and `pg torture fixture exercises routine-calls-routine` (1 scenario). |
| `mysql-extraction` | Updated | 2 ADDED, appended inline at the tail (flat inline structure, no dated-section precedent): `Body-parsed calls edges for routine invocations, presence-gated with no phantom or self edges` (3 scenarios) and `mysql torture fixture exercises routine-calls-routine` (1 scenario). |
| `sqlite-extraction` | Updated | 1 ADDED, appended inline at the tail of the `## ADDED Requirements` section (matching this file's sqlite-view-deps precedent): `SQLite emits no calls edges (capability honestly absent)` — an HONEST negative pinning the absence, with 2 scenarios (torture graph zero calls / CapabilityMatrix unchanged; function-like trigger token invents nothing). No fixture object added; `CapabilityMatrix` unchanged. |
| `mcp-server` | Updated | 1 MODIFIED + 1 ADDED, both inline (no dated-section convention — confirmed against the current file and the explore-payloads precedent). MOD `dbgraph_precheck aggregates DDL impact with parsed-confidence tagging` replaced IN PLACE — traversal list gains `calls`, routine-caller dependents surfaced as READ-impact, new `(Previously: ...)` note, the 3 existing scenarios preserved and 1 appended (`Altering a called routine surfaces its callers through the calls chain`). ADD `explore and related surface calls neighbors automatically` inserted after `dbgraph_related` with its 2 scenarios. |

## Deferred (Epic Backlog — deep-object-graph)

- **DOG-2, DOG-3, DOG-4** remain in the deep-object-graph epic backlog; they are out of scope for DOG-1
  and are not touched by this archive. The `deep-object-graph` epic proposal and the `graph-viz` change
  stay ACTIVE under `openspec/changes/`.

## Gates (re-confirmed at archive time)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npx tsc --noEmit` | PASS |
| Lint | `npx eslint .` | PASS — 0 errors / 0 warnings |
| Tests | `npm test` | PASS — 3340 passed / 7 skipped (3347) / 0 failed |

## Next recommended: none — SDD cycle complete for `dog1-calls-edges`. The deep-object-graph epic (DOG-2/3/4) and graph-viz remain the natural next changes.
