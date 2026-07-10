# Design: DOG-3 — Column-Level Lineage (views first)

## Technical Approach

One seam: an OPTIONAL source-column SET rides on `RawDependency`; `buildDependencyEdges`
stamps it (sorted-unique) as `attrs.dstColumns` on the EXISTING view→table `depends_on`
edge. Every engine is an adapter feeding that set; absent set → `attrs {}`, byte-identical
object grain. Attrs persist verbatim (`sqlite-graph-store.ts:337/:97`) — ZERO storage
migration. Impact filters readers by column membership; render lists consumed columns from
`edge.attrs` (NeighborGroups already carries `edge: GraphEdge` — no port change). Honesty:
column set is a DECLARED SOURCE SET, never an output↔source map (ADR-007).

## Architecture Decisions

### Decision: Model A (set-attr on the table edge) — THE call, settled with math

**Choice**: Carry the consumed-column SET as `attrs.dstColumns: readonly string[]` on the one
existing view→`depends_on`→table edge. NO per-column edges, NO column-node targets.

**Edge-count math (corporate: 67 views, 14k columns, ~20 consumed cols/view — proposal's own figure):**

| Model | New edges | Golden blast | Impact cost |
|---|---|---|---|
| **A set-attr** (chosen) | **0** (constant; the ~200–350 view→table edges gain an array) | bounded: only view→table `depends_on` re-bless | one shared column-pivot helper |
| B column-node target | ~67×20 ≈ **1,340** today; 3,350 at wide views; unbounded toward 14k if generalized | broad: inbound-render churn across ~1,340 COLUMN nodes | "free" traversal but still needs column-pivot resolution + inflates every column render |

**Rationale**: A is edge-count-CONSTANT and scale-safe at 14k columns; B explodes and churns
thousands of column-node goldens. A reuses the aggregate edge (same `edgeId`, discriminator `''`)
→ minimal blast. Mirrors FK precedent's "attrs carry the columns" without B's node fan-out.

### Decision: New plural `dstColumns` field, not the reserved singular `dstColumn`

**Choice**: ADD `EdgeAttrs.dstColumns?: readonly string[]`; leave `srcColumn/dstColumn`
references-scoped. Overturns the proposal's "make singular fields load-bearing" wording.

**Rationale**: A SET needs a plural field; reusing singulars would force per-column edges (model B).
Topologically consistent with `references.dstColumn` (columns on the DST table). Separate field →
FK/`references` goldens stay byte-identical (zero drift).

### Decision: Determinism centralized in the normalizer

**Choice**: `buildDependencyEdges` does `[...new Set(cols)].sort()` before stamping.
**Rationale**: `stableStringify` preserves array order → sort is mandatory (ADR-008). One place,
all engines consistent regardless of adapter row order.

### Decision: Degrade = ABSENCE of `dstColumns` (no per-edge marker)

**Choice**: mysql/sqlite/SELECT*/uncovered-pg emit NO `dstColumns` → object grain. Per-engine
capability (`supportsColumnLineage`) documents WHY; render surfaces it. NO `attrs.degraded` stamp.
**Rationale**: A marker would churn EVERY mysql/sqlite golden for zero function (absence already
drives the conservative-include rule). mysql/sqlite edges stay byte-identical — de-risks the change.

### Decision: Confidence — mssql declared as-is; pg upgrades covered pairs

> **⚠ ERRATA (reconciler d, archive 2026-07-10):** this decision's premise is FACTUALLY WRONG. The mssql
> view `depends_on` deps are emitted by the body tokenizer at `confidence: 'parsed'` (exactly like pg),
> NOT "already declared". The shipped implementation FLIPS `parsed`→`declared` on COVERED view deps in
> BOTH mssql and pg. The observable end state (declared + `dstColumns`) is correct; only this "no flip"
> narrative is wrong. See "## Reconciliation notes (archive-time)" below. Canonical specs state the flip.

**Choice**: mssql view `depends_on` is ALREADY `declared` → attach the native-TVF-loop set (D8), no flip. pg: `view_column_usage`
is a CATALOG dependency signal — covered (view,table) pairs flip `parsed`→`declared` + gain `dstColumns`;
uncovered (owner-visibility gap / SELECT* / non-owned source) keep the tokenizer's `parsed` object grain.
**Rationale**: honors "confidence: declared" (Success Criteria) honestly — a catalog-confirmed pair IS
declared. Deliberate pg re-bless, Batch B only.

### Decision: mssql column source — native `dm_sql_referenced_entities` TVF loop (hybrid), NOT `referenced_minor_id` — D8 (SUPERSEDES the originally-named source; live finding 2026-07-07)

**Live finding (proven against `mssql:2022` over `torture.sql`)**: `sys.sql_expression_dependencies.referenced_minor_id`
= 0 (whole-object, `ref_column_name = NULL`) for NON-schemabound views — the common case in the wild. Only schemabound
views populate a non-zero `minor_id`. The originally-named source is therefore INERT for real-world view column lineage.
The observable pins HELD, but only via a DIFFERENT catalog: `sys.dm_sql_referenced_entities('<view>','OBJECT')` — a
PER-OBJECT table-valued function — returned EXACTLY orders→[customer_id,order_id,status,total_amount] (the COMPUTED
`total_amount` consumed AS ITSELF, never expanded to quantity/unit_price) and order_items→[order_id,product_id].

**Choice (hybrid)**:
- **Native driver path** (`NativeTediousStrategy` → `MssqlReadonlyDriver`, in `extract()`): a JS-side per-view LOOP calls
  `sys.dm_sql_referenced_entities(@view,'OBJECT')` (one lightweight metadata query per view; ~67 corporate views = acceptable).
  EACH call is individually `try/catch`-wrapped — an UNBINDABLE view (broken/renamed/dropped source) is SKIPPED and its
  `depends_on` edge KEEPS object grain (degrade-by-absence, D4; the model built for exactly this). DETERMINISTIC: views
  iterated in stable qname order; per-view rows sorted by the normalizer stamp anyway (D3).
- **sqlcmd + manual-dump paths**: the fixed single-SELECT-per-family dump contract (DOG-2) stays UNTOUCHED — NO view-columns
  family is added (a per-object TVF loop is incompatible with one-SELECT-per-family). mssql-via-sqlcmd/dump therefore yields
  OBJECT GRAIN for view lineage. This is the project's FIRST strategy-dependent coverage difference — surfaced LOUDLY in the
  capability note, `docs/`, and an explicit spec scenario (edges byte-identical to pre-DOG-3, no `dstColumns`, no error).
- **Schemabound views NOT special-cased**: even if `minor_id` were non-zero via the set query, ONE source (the TVF loop), ONE
  behavior — uniformity beats a rare-path optimization.

**Alternatives considered (rejected)**:
- `sys.sql_expression_dependencies.referenced_minor_id` (originally named) — INERT: `minor_id = 0` for non-schemabound views →
  zero columns, the feature would be dead in the wild.
- Set-based `CROSS APPLY sys.dm_sql_referenced_entities` (FOR-JSON/dump-compatible, single SELECT) — one unbindable view ABORTS
  the entire family: a read-only ROBUSTNESS regression vs today's set-based `sys.sql_expression_dependencies`.
- Schemabound-only special case via the set query — forks behavior for a rare view class with zero coverage on the common case.

**Rationale**: correct source (proven live) × per-call resilience (unbindable → skip, never abort) × dump-model compatibility
(no new family) — the loop-per-view is the ONLY option satisfying all three. `SQL_MSSQL_DEPENDENCIES` stays object-grain-only;
the `referenced_minor_id`/`sys.columns` mechanism is DROPPED.

## Data Flow

    adapter catalog ─(RawDependency.columns?)─► buildDependencyEdges ─► depends_on
      mssql(native): dm_sql_referenced_entities per-view loop, per-call catch (group)   sorted-unique   attrs.dstColumns
      mssql(sqlcmd/dump): NO view-cols family → unset → object grain (strategy diff)          │                │
      pg:    view_column_usage (merge, upgrade)                                               ▼                ▼
      my/sqlite: unset → degrade                                    impact: column pivot → owning table → filter
                                                                    render: explore/object "consumes: t.col" (full)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `core/model/edge.ts` | Modify | add `EdgeAttrs.dstColumns?: readonly string[]` (load-bearing for `depends_on`) |
| `core/model/catalog.ts` | Modify | add `RawDependency.columns?: readonly string[]` (source set, optional) |
| `core/model/capability.ts` | Modify | add `supportsColumnLineage?: boolean` to CapabilityMatrix |
| `core/normalize/reference-resolver.ts` | Modify | `buildDependencyEdges` stamps sorted-unique set → `attrs.dstColumns`; absent → `{}` |
| `adapters/engines/mssql/queries.ts` | Modify | ADD const `SQL_MSSQL_VIEW_REFERENCED_COLUMNS` — parameterized `sys.dm_sql_referenced_entities(@view,'OBJECT')`, NATIVE-only (NOT in the dump family); `SQL_MSSQL_DEPENDENCIES` UNCHANGED (object grain) |
| `adapters/engines/mssql/mssql-schema-adapter.ts` | Modify | `extract()` adds a per-view TVF loop (native driver only), each call `try/catch` → unbindable view SKIPPED; feeds `map.ts` |
| `adapters/engines/mssql/map.ts` | Modify | group TVF `(referenced obj, referenced column)` rows per view dependency → `RawDependency.columns`; unresolved/whole-object → none |
| `adapters/engines/mssql/capabilities.ts` | Modify | note: view column lineage is NATIVE-driver only; sqlcmd/dump → object grain (FIRST strategy-dependent coverage difference) |
| `adapters/engines/mssql/strategies/{registry,dump-emitter}.ts` | Verify | dump family stays the fixed catalog SELECTs (NO view-columns family) — the sqlcmd/dump degrade is BY DESIGN |
| `adapters/engines/pg/queries.ts` | Create const | `SQL_PG_VIEW_COLUMN_USAGE` over `information_schema.view_column_usage` |
| `adapters/engines/pg/map.ts` | Modify | merge column sets into tokenizer deps; covered → declared + `dstColumns` |
| `adapters/engines/pg/capabilities.ts` | Modify | `supportsColumnLineage: true` (owner caveat) |
| `adapters/engines/{mysql,sqlite}/capabilities.ts` | Modify | `supportsColumnLineage: false` |
| `core/query/column-pivot.ts` | Create | pure `filterReadersByColumn(edges, pivotCol)` — absent=include, present=membership |
| `core/query/impact.ts` | Modify | column-pivot first hop: column → owning table → apply helper |
| `core/present/{explore,object}.ts` | Modify | render "consumes: t.col" from `edge.attrs.dstColumns`, FULL detail only |
| precheck/affected assembly | Modify | reuse `filterReadersByColumn` for `DROP COLUMN` pivots |
| `test/fixtures/**` + goldens | New/Modify | per-engine column-lineage fixtures; L-009 exact-set; deliberate impact/pg re-bless |

## Interfaces / Contracts

```ts
// core/model/edge.ts
readonly dstColumns?: readonly string[]; // sorted-unique SOURCE-table columns a view consumes
                                         // (declared SET, NOT an output↔source map — ADR-007)
// core/model/catalog.ts
readonly columns?: readonly string[];    // RawDependency: source-column set (optional; unset = object grain)
// core/query/column-pivot.ts — PINNED conservative rule
// dstColumns present + includes pivot → affected; present + excludes → EXCLUDE (precision);
// dstColumns ABSENT → INCLUDE (degrade = no false negative).
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `buildDependencyEdges` set-stamp + sort; mssql/pg map grouping; `filterReadersByColumn`; explore/object render | pure fns + JSON fixtures; golden strings |
| Unit | `getImpact` drop-column precision (positive + NEGATIVE: unread col → no reader) | fixture store; L-009 exact-set |
| Integration | real mssql `dm_sql_referenced_entities` TVF loop (verify `dbo.orders.total_amount` computed-column truth + UNBINDABLE-view SKIP via a scratch broken view → edge stays object grain, extraction completes + sqlcmd/dump object-grain absence); pg `view_column_usage` coverage + materialized-view exclusion | testcontainers tiers ARE available (mssql/pg/mysql images cached, ran green in DOG-1/DOG-2), `DBGRAPH_INTEGRATION`-gated; DOG-3's live verifications MUST run here at apply |

## Migration / Rollout

No storage migration (attrs persist). Additive, revertible per batch (proposal Rollback).
Batches: **A** model+seam+mssql · **B** pg (declared, owner degrade) · **C** impact+render+mysql/sqlite degrade · (deferred) benchmark family instantiable.

## Open Questions

- [ ] Render wording for mssql SELECT* (capable-but-columnless) vs sqlite (incapable) — capability text only, or a lightweight per-dep hint? (Batch C render; leaning capability-only.)
- [ ] `object.ts` full-detail budget ceiling for very wide views (cap the consumed-column list at N?) — tasks to pin against format-spec.
- [ ] Confirm `impact` command (US-014) needs column pivots, or is column precision precheck/affected-only? (leaning: helper shared, `getImpact` first-hop opt-in.)

## Reconciliation notes (archive-time)

These notes reconcile drift between the planning artifacts and the shipped implementation, recorded at
archive so the canonical specs merge correctly. They join the earlier reconciler rulings (a) capability
flag is an impl detail, never a per-edge coverage oracle; (b) proposal's "make the singular
`srcColumn/dstColumn` load-bearing" is superseded by D2's new plural `dstColumns`; (c) the mssql column
source is `sys.dm_sql_referenced_entities` (D8), not the inert `sys.sql_expression_dependencies.referenced_minor_id`
named in the proposal — all recorded in `tasks.md`.

- **(d) The D5 "mssql already declared → no flip" premise was factually wrong.** The tokenizer emits
  `confidence: 'parsed'` for mssql view `depends_on` deps (exactly as it does for pg); the shipped
  implementation FLIPS `parsed`→`declared` on COVERED view deps in BOTH mssql and pg (the covered edge
  gains `attrs.dstColumns` at the same moment it flips). Uncovered / unbindable / sqlcmd-or-dump mssql
  deps and uncovered / materialized / owner-gap pg deps STAY `parsed` object grain (degrade-by-absence).
  The observable end state every test pins (`declared` + sorted-unique `dstColumns` on covered edges) is
  CORRECT and unchanged; only D5's and the `mssql-extraction` delta's narrative of HOW confidence
  reaches `declared` was wrong. **The canonical specs MUST state the flip, NEVER "already declared".**
  (Surfaced independently as verify WARNING-1; recorded 2026-07-10.)
