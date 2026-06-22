# Design: Phase 9a — Structural Inference Engine

## Technical Approach

A PURE `src/core/infer/` module (ADR-004: imports only core model types) exposes `inferReferences(nodes, existingEdges, options): GraphEdge[]`. It indexes target nodes by owning table/collection + PK columns, extracts a candidate entity from each `column`/`field` name via convention patterns, resolves it (singular/plural) against REAL targets only, checks type compatibility, scores, and emits `inferred_reference` edges (`confidence:'inferred'`) above a threshold. The module SELF-SORTS its output before returning (the existing `sortEdges` ignores `score`). `normalize.ts` calls it from ONE gated site after step 4c (line 86) and before sort (line 88); the gate is OFF by default so the four shipped SQL engines stay byte-identical. Realizes US-008; satisfies the `graph-normalization` + `graph-model` deltas.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| D1 | Edge endpoint grain | `src`/`dst` = the two **column/field node ids** that join (e.g. `column dbo.orders.customer_id` → `column dbo.customers.id`); `attrs.srcColumn`/`dstColumn` carry local names | table→table + aggregate (FK style) | An inferred join is column-precise; column endpoints make traversal exact and need no aggregate. Endpoints are reconstructed via the deterministic `nodeId('column', targetQName)` — no node lookup needed beyond confirming the target exists. |
| D2 | PK signal source | A column is "PK-of-target" if its owning table has a `constraint` node with `payload.type==='PK'` whose `payload.columns` (lowercased) includes the column local name | `ColumnPayload.isPrimaryKey` flag | That flag DOES NOT EXIST (`ColumnPayload` = dataType/nullable/default/ordinal/comment). PK lives only on `constraint` child nodes. Pre-index PKs in one pass. |
| D3 | Gate semantics | Emit when `scope.inferRelationships === true` OR the node set contains any `collection`/`field` node | always-on; flag-only | Flag keeps SQL OFF (byte-identical goldens); the `collection`/`field` auto-trigger makes 9b inference-ON by construction. Both checks live in the hook, not the engine. |
| D4 | Self-sort | Engine sorts `(src, dst, score DESC, srcColumn, id)` before returning | rely on `sortEdges` | `sortEdges` (normalize.ts L506–519) has NO score key, so multi-candidate order would be input-dependent. Engine owns its determinism (ADR-008). |
| D5 | Pluralization | Hand-rolled, zero-dep: try name as-is, `+s`, `+es`, `-y→-ies`, and singular (strip trailing `s`/`es`, `-ies→-y`); accept the FIRST form that matches a REAL target | `inflection`/`pluralize` lib | ADR-007 (zero new deps); conservative rules avoid `addresses→addres` false matches because only real targets validate. |
| D6 | Candidate value source | Only node `name`/`qname`/`payload.dataType` (strings already in the graph) | sampling raw values | dbgraph-security: never read raw data values. |

## Data Flow

    normalize.ts (after 4c, before sort)
      gate(scope.inferRelationships OR has collection/field nodes)?
        ── yes ──> inferReferences([...nodeMap.values()], edges, opts)
                     index targets (table/collection + PK cols)
                     for each column/field: extract entity → resolve → type-compat → score
                     score >= THRESHOLD ? push inferred_reference
                     self-sort (D4) ──> GraphEdge[]
        edges.push(...inferred)   // then existing sortEdges runs
        ── no  ──> (skipped: output byte-identical)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/infer/conventions.ts` | Create | `extractEntity(colName)` → patterns `<e>_id`/`<e>Id`/`id_<e>` (snake + camel, case-folded); `candidateTargets(entity)` → pluralization set (D5) |
| `src/core/infer/type-compat.ts` | Create | `typeFamily(dataType)` + `compatible(a,b)` table (D-T below) |
| `src/core/infer/infer-references.ts` | Create | `inferReferences(nodes, existingEdges, options)` engine + score + self-sort (D1/D2/D4) |
| `src/core/infer/index.ts` | Create | Barrel re-exporting `inferReferences`, `InferOptions`, constants |
| `src/core/model/capability.ts` | Modify | Add OPTIONAL `inferRelationships?: boolean` to `ExtractionScope` (default false; D3) |
| `src/core/normalize/normalize.ts` | Modify | Gated hook block between L86 and L88 (D3); append returned edges before `sortEdges` |
| `test/core/infer/*.test.ts` + fixtures | Create | Fixture-`NodeMap` unit tests; goldens; gate-off byte-identical |
| `openspec/specs/graph-normalization/spec.md` | Modify | Scored-inference + gate-off-byte-identical delta |
| `openspec/specs/graph-model/spec.md` | Modify | `inferred_reference` scoring no longer deferred |
| `docs/stories/02-graph-core.md` | Modify | Refine US-008 (Phase 9a; ≥0.8 example; opt-in + determinism) |

## Interfaces / Contracts

```ts
export interface InferOptions {
  readonly threshold?: number;          // default THRESHOLD
}
export function inferReferences(
  nodes: ReadonlyMap<string, GraphNode>, // the live NodeMap ([...values()] order irrelevant — engine indexes)
  existingEdges: readonly GraphEdge[],   // to skip columns already FK-linked (no dup with declared references)
  options?: InferOptions,
): GraphEdge[];                          // self-sorted (D4); each: kind:'inferred_reference', confidence:'inferred', score∈[0,1]
```

Type-compat table (D-T): `int|integer|bigint|smallint|serial|bigserial → "int"`; `objectid|_id → "oid"`; `uuid → "uuid"`; `varchar|text|char|nvarchar|string → "str"`. `compatible(a,b)` ⇔ same family (case-folded). Mismatched family ⇒ rejected (the `customer_id:int` vs `customers.id:uuid` guard).

Score formula (named constants, golden-pinned):
`score = W_CONVENTION*conv + W_TYPE*typeCompat + W_PK_TARGET*targetIsPk`, where `W_CONVENTION=0.5`, `W_TYPE=0.3`, `W_PK_TARGET=0.2`, `THRESHOLD=0.5`. `conv∈{1.0 exact `<e>_id`/`<e>Id`, 0.8 `id_<e>`}`, `typeCompat∈{1,0}`, `targetIsPk∈{1,0}`. `orders.customer_id(int) → customers.id(int,PK)` = `0.5+0.3+0.2 = 1.0` (≥0.8 ✓). Type mismatch ⇒ `typeCompat=0` ⇒ `0.5+0.2=0.7` still ≥ THRESHOLD, so type mismatch is a HARD reject in the matcher (no edge), NOT just a score penalty. `status_id` with no `status*` target ⇒ unresolved ⇒ no edge.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `conventions` entity extraction + pluralization | RED→GREEN; exact-set (L-009) per pattern, snake+camel |
| Unit | `type-compat` families pass/fail | exact boolean table incl. int↔int, ObjectId↔_id, int↔uuid reject |
| Unit | `inferReferences` engine | SQL fixture (customers/orders/products) + Mongo fixture (collections/fields): assert EXACT inferred edges (src+dst qname + score), negative `status_id` case, THRESHOLD boundary, multi-candidate self-sort order, re-run byte-identity |
| Unit | gate-off byte-identical | Mirror `golden-freeze.test.ts`: re-normalize an existing SQL fixture with flag unset; assert `stableStringify(edges)` equals its golden (engines untouched) |

All vitest, no Docker. Goldens: seed-or-verify like `normalize.test.ts`/`golden-freeze.test.ts`.

## Migration / Rollout

No migration. Purely additive, default OFF. Rollback = delete `src/core/infer/`, remove the hook block, remove the optional `ExtractionScope` field, drop tests + spec deltas.

## Batch Ordering (TDD)

1. `type-compat.ts` + `conventions.ts` — pure helpers, unit RED→GREEN (exact-set).
2. `infer-references.ts` engine + self-sort + barrel — fixture-`NodeMap` unit (exact-set + score + negative + determinism).
3. `ExtractionScope.inferRelationships` + gated `normalize.ts` hook — gate-ON Mongo fixture emits edges; gate-OFF SQL fixture proves goldens byte-identical.
4. Spec deltas (`graph-normalization`, `graph-model`) + US-008 refinement.

## Open Questions

- None blocking. `existingEdges` dedup (skip a column that already has a declared `references` edge) is included to prevent inferred/declared overlap; if a future spec wants inferred edges even alongside FKs, relax the skip — pinned by a fixture either way.
