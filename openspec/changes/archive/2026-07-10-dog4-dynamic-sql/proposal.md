# Proposal: DOG-4 — Dynamic-SQL honesty hardening

> Last open child of the `deep-object-graph` epic (DOG-1/2/3 SHIPPED). This is a PRESENTATION +
> QUERY honesty change, NOT an extraction change — the `hasDynamicSql` flag is already detected,
> propagated, and persisted. DOG-4 stops UNDER-surfacing it.

## Intent

Honesty over silence. A routine containing dynamic SQL (`EXEC`/`sp_executesql`, plpgsql `EXECUTE`,
MySQL `PREPARE`/`EXECUTE`) is a KNOWN blind spot: its static edges are real, but the dynamic-string
targets are unknowable. The flag exists (`RoutinePayload.hasDynamicSql`, `node.ts:114`) yet is
under-surfaced in two places: (1) `explore` shows the caveat ONLY at `full` detail
(`present/explore.ts:173-183`) and `object` shows it at NO detail (`present/object.ts` has zero
`hasDynamicSql` reference); (2) `affected`/`precheck` never marks WHICH node is the blind spot — it
emits a blanket, node-agnostic warning at best. A reader at `normal` detail sees a dynamic-SQL routine
as if it were fully analyzed. That is the dishonesty. NOTE: routines are NOT silently empty — static
edges SURVIVE alongside `hasDynamicSql:true` (`pg/map.ts:729-736`); the gap is surfacing, not loss.

## Scope

### In Scope
- Promote the dynamic-SQL caveat from `full`-only (explore) / ABSENT (object) to `normal` detail, via
  the ONE shared payload-render discipline (mcp-server spec:120-121,129-130) so explore/object stay
  byte-identical. UPPERCASE marker consistent with DOG-2 (`[OUT]`/`[INOUT]`), e.g. `[DYNAMIC SQL]`.
- Mark PER-NODE confidence degradation in `affected`/`precheck`: annotate the SPECIFIC surfaced items
  whose `payload.hasDynamicSql === true` as degraded — never a node-agnostic blanket. `affected` CLI
  inherits it through the shared precheck engine (mcp-server spec:564-569).
- Re-bless the affected goldens per engine (L-009 EXACT degraded-node sets, never existence-only).

### Out of Scope (non-goals)
- NO dynamic-SQL parsing, resolving, or guessing of dynamic targets (ADR-007 conservative).
- NO edge fabrication — we mark the known-blind node; we NEVER invent an edge for an unknowable target.
- NO new confidence tier and NO extraction change — detection/propagation already ship untouched.
- NO change to sqlite/mongodb (they have no dynamic SQL — see matrix).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `mcp-server` — explore/object caveat at `normal`; `precheck`/`affected` per-node degradation marker.
- `graph-query` — DESIGN-GATED: whether `getImpact`/`ImpactResult` surfaces WHICH nodes degrade (today
  only a whole-result `dynamicSqlWarning` boolean, `query/impact.ts:199-216`) vs keeping impact blanket
  and doing per-node ONLY in precheck. See open questions.
- `cli-config` — `dbgraph affected`/`explore`/`object` inherit the shared formatters (no new logic).

## Approach

Surface, don't compute. The flag already flows adapter→normalize→payload. (1) Move the explore warning
gate from `detail === 'full'` to include `normal`, and add the SAME line to `object` through the shared
render helper. (2) Give `PrecheckItem` (`present/precheck.ts:24-29`) a degradation marker fed from the
already-fetched node payload; render it at `normal`. Data source = the node we already read; zero new
traversal, zero new catalog query, zero npm deps.

### Per-engine reality (which engines HAVE the problem)

| Engine | Dynamic SQL? | Evidence |
|---|---|---|
| mssql | YES | `EXEC`/`sp_executesql` — `mssql/tokenizer.ts:55-57` |
| pg | YES | bare plpgsql `EXECUTE` — `pg/tokenizer.ts:6`, `pg/map.ts:735` |
| mysql | YES | `PREPARE`/`EXECUTE` — `mysql/tokenizer.ts:5`, `mysql/map.ts:566` |
| sqlite | NO | no dynamic-SQL statement form — `sqlite/tokenizer.ts:19-20` (honest absence, untouched) |
| mongodb | N/A | no routines |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/present/explore.ts` | Modified | caveat gate `full`→`normal` |
| `src/core/present/object.ts` | Modified | add caveat via shared helper (currently absent) |
| `src/core/present/precheck.ts` | Modified | `PrecheckItem` per-node degradation marker |
| `src/core/query/impact.ts` + `ports/graph-store.ts` | Modified (design-gated) | surface degraded node IDs |
| `openspec/specs/{mcp-server,graph-query,cli-config}/spec.md` | Modified (deltas) | per above |
| `test/**` explore/object/precheck/affected goldens (mssql/pg/mysql) | Re-blessed | L-009 exact sets |

Extraction specs (`mssql/pg/mysql/sqlite-extraction`, `schema-extraction`, `graph-model`) — UNTOUCHED.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Golden churn across explore/object/precheck at normal | High (expected) | Re-pin per engine, review each diff, L-009 exact sets |
| Marker mistaken for a fabricated edge | Low | It is a NODE attr caveat, never an edge; goldens assert zero new edges |
| Scope creep into impact per-node marking | Med | Gate behind an open question; default to precheck-only if design says so |

## Rollback Plan

Purely additive and revertible: restore the `detail === 'full'` gate in explore, drop the object caveat
line, drop the `PrecheckItem` marker (optional field, no consumer breaks), un-bless the goldens. No
extraction, storage, edge, or traversal change to revert.

## Dependencies

- Builds on shipped `hasDynamicSql` detection/propagation (US-007) and the shared render discipline.
- ZERO new npm deps, ZERO catalog queries, ZERO storage migration. Depends on nothing (DOG-1/2/3 done).

## Success Criteria

- [ ] Dynamic-SQL caveat visible at `normal` detail in BOTH `explore` and `object` (byte-identical).
- [ ] `affected`/`precheck` marks the EXACT degraded node(s), not a blanket warning; unknowable targets
      are NEVER fabricated into edges.
- [ ] mssql/pg/mysql goldens re-blessed as exact sets; sqlite goldens UNCHANGED (honest absence).
- [ ] `tsc`/lint/test green.

## Open Questions (for design)

1. Impact scope: extend `getImpact`/`ImpactResult` to name degraded nodes, or keep impact's blanket
   warning and do per-node marking ONLY in precheck/affected? (Affects whether `graph-query` gets a delta.)
2. Marker form: a boolean `hasDynamicSql` on `PrecheckItem` rendered as `[DYNAMIC SQL]`, vs a textual
   confidence-note. Keep `confidence` as `declared|parsed` (no new tier) — the caveat is orthogonal.
3. Detail threshold: caveat at `normal` AND `brief`, or `normal`+`full` only? (`brief` is counts-only today.)
