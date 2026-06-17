# Archive Report: phase-1-graph-core

**Change**: phase-1-graph-core
**Archived**: 2026-06-12
**Artifact store**: openspec
**Final verdict**: PASS (zero carry-over warnings, zero CRITICAL)

## Executive Summary

Phase 1 (graph core) shipped the complete engine-agnostic domain layer for dbgraph: typed domain
model, hexagonal ports, deterministic normalizer, SQLite+FTS5 storage adapter, and a four-function
query engine (neighbors, impact, path, search). The change ran through five apply batches (A–E),
a first verification pass (PASS WITH WARNINGS), and a full Batch E remediation cycle that resolved
every warning and code-review finding before archiving. Final gate: 262/262 tests, lint clean, tsc
clean, deterministic across two byte-identical runs. The four delta specs are promoted to canonical
main specs. The change is closed.

## What Shipped

### Source deliverables

| Path | Description |
|------|-------------|
| `src/core/model/` | Node/edge/catalog/capability/graph types; `DEFAULT_LEVELS`; `OmittedKindInfo`; runtime constants `NODE_KINDS`, `EDGE_KINDS` |
| `src/core/errors.ts` | Domain error hierarchy (`GraphError`, `StorageError`, `NormalizationError`) |
| `src/core/ports/graph-store.ts` | Async `GraphStore` port (ADR-004 hexagonal boundary) |
| `src/core/ports/logger.ts` | `Logger` port |
| `src/core/normalize/id.ts` | Deterministic node/edge ID derivation (`sha1(kind + qname)`) |
| `src/core/normalize/levels.ts` | Level resolution (`off`/`metadata`/`full`) and body normalization |
| `src/core/normalize/normalize.ts` | `normalizeCatalog` — full catalog-to-graph conversion |
| `src/core/normalize/reference-resolver.ts` | FK, composite-FK aggregation, stub creation |
| `src/core/query/neighbors.ts` | `getNeighbors` — grouped by edge kind and direction |
| `src/core/query/impact.ts` | `getImpact` — BFS blast-radius with read/write split and cycle safety |
| `src/core/query/path.ts` | `findJoinPath` — shortest path over aggregated references edges |
| `src/core/query/search.ts` | `search` — FTS delegation + Levenshtein typo fallback |
| `src/core/index.ts` | Core barrel |
| `src/index.ts` | Root barrel (`DBGRAPH_VERSION`, `createSqliteGraphStore`) |
| `src/adapters/storage/sqlite/schema.ts` | DDL (nodes, edges, nodes_fts, snapshots, meta tables) |
| `src/adapters/storage/sqlite/migrations.ts` | Forward-only schema migrations |
| `src/adapters/storage/sqlite/factory.ts` | `createSqliteGraphStore` dynamic import (ADR-004 seam) |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | Full `GraphStore` implementation over better-sqlite3 |

### Test deliverables

262 tests across 18 files:

| Layer | Count | Key files |
|-------|-------|-----------|
| Unit (pure core, fake store) | ~238 | model, errors, id, levels, normalize, omitted, defaults, trigger-rw, neighbors, impact, path, search, barrel, boundaries |
| Integration (real better-sqlite3 :memory:) | ~24 | schema, sqlite-graph-store, e2e-dod |
| Total | 262 | 18 test files |

### Gate results (final, post-Batch E)

| Gate | Command | Result |
|------|---------|--------|
| Tests (run 1) | `npm test` | PASS — 18 files, 262/262 (exit 0) |
| Tests (run 2, determinism) | `npm test` | PASS — 262/262, goldens byte-identical (ADR-008) |
| Lint | `npm run lint` | PASS — 0 errors, 0 warnings (exit 0) |
| Type check | `npx tsc --noEmit` | PASS — 0 errors (exit 0) |

CI matrix: 4 jobs (Node 20/22 × Windows/Ubuntu) all green.

## Apply Batches

### Batch A — Tasks 1.1–2.5 (infrastructure + model)

Installed `better-sqlite3@12.10.0` (pinned exact), created 7 `RawCatalog` test fixtures, typed the
full domain model (node/edge/catalog/capability/graph), error classes, and ports. Strict TDD cycles
confirmed with "Cannot find module" RED commits `e358b76` (model) and `bded1c5` (errors). Gate at
end of batch: 33/33.

### Batch B — Tasks 3.1–4.5 (ID derivation + normalizer)

Implemented deterministic ID computation (`sha1(kind+qname)`, ADR-008), level resolution
(`off`/`metadata`/`full`), and the full `normalizeCatalog` pipeline with golden fixtures for
minimal, composite-FK, stubs, read/write edges, and determinism. RED commits `0c3cdc8` (id) and
`0f6e89a` (levels); combined RED `fb93375` for normalize. Gate at end of batch: 110/110.

### Batch C — Tasks 5.1–5.4 (SQLite storage adapter)

Built schema DDL, forward migrations, `SqliteGraphStore` with round-trip, FTS5 level-gated body
indexing, `body_hash` stability, snapshot persistence, and `deleteNodes` cascade. Notable learning:
FTS5 virtual tables require DELETE+INSERT (no ON CONFLICT); TS6 JSON imports use `with` not
`assert`. Gate at end of batch: 147/147.

### Batch D — Tasks 6.1–7.3 (query engine + barrels + boundary guard)

Implemented all four query functions (neighbors, impact, path, search), end-to-end DoD test over
real `SqliteGraphStore`, root and core barrels, and the hexagonal boundary scan
(`boundaries.test.ts` — empirically catches a live driver import). Notable: `fileURLToPath` needed
for Windows-safe ESM path resolution (L-006). Gate at end of batch: 238/238.

### Batch E — Verify-report remediation (W-1..W-4, F-1..F-9, S-2)

Re-verification after initial PASS WITH WARNINGS found 4 warnings and 9 code-review findings:

**Warning resolutions:**

| Finding | Resolution |
|---------|------------|
| W-1 off-level queryable absence reason | `OmittedKindInfo` type + `NormalizationResult.omitted` field; `buildOmittedKinds()` populates one entry per off-kind with exact spec reason text; queryable end-to-end via `store.getMeta('omitted_kinds')` (E2E DoD test). 7 direct unit tests. |
| W-2 Default level resolution not asserted | `DEFAULT_LEVELS` constant exported from `capability.ts`; 10 direct unit tests, one per documented ADR-003 default (triggers `full`, procedures `metadata`, statistics `off`, etc.). |
| W-3 Trigger fires+writes single fixture | New fixture `catalog-trigger-rw.json` + golden + `trigger-rw.test.ts` (5 tests); explicit assertion that both `fires_on` and `writes_to` originate from the same trigger `src`. |
| W-4 Inferred-only route unverifiable | Converted to documented phase boundary: `specs/graph-query/spec.md` carries explicit deferral block-quote for Phase 9 (US-008). Not an open warning. |

**Code-review finding resolutions (F-1..F-9):**

| Finding | Resolution |
|---------|------------|
| F-1 BFS traverses only aggregated edges | `isTraversable(edge)` checks `edge.attrs.aggregate === true`; parameterless S-1 deviation resolved |
| F-2 Hardcoded kind list in search | `levenshteinFallback` uses `NODE_KINDS` from model |
| F-3 Duplicate `buildChildNode` code | Extracted helper; content-neutral (no golden churn in F-3 commit `96d4711`) |
| F-4 Dead `buildPayload` branch | Removed dead `else if` block; uses `LevelResult` type |
| F-5 `FKEdgesResult` rename + manual pre-lookup | Renamed to `EdgeBuildResult`; removed manual pre-lookup in `buildFKEdges` |
| F-6 Dead `expanded` variable + redundant `.includes` | Removed from `getImpact` |
| F-7 FTS statements prepared in constructor | Prepared once in constructor; `_detectMatchedColumn` → `detectMatchedColumn` |
| F-8 Useless casts in `getNeighbors` | Removed `(group as NeighborGroup)` casts |
| F-9 Read ops not wrapped in `StorageError` | All read operations (8 methods) wrapped consistently |

All F-1..F-9 refactors confirmed content-neutral under the golden+test safety net (no golden churn
in any F commit). Goldens were regenerated in a single commit `26f7adf` alongside the W-1 type
change; the ONLY diff in each golden is the appended `omitted: []` field. Working tree clean after
Batch E.

Gate after Batch E: 262/262, lint 0, tsc 0, deterministic across two byte-identical runs.

## Story Status at Archive

| Story | Status | Evidence |
|-------|--------|---------|
| US-006 Graph model and core normalization | **Done** | Minimal golden, composite FK, missing/excluded stubs, boundary lint — all covered by passing tests |
| US-003 Indexing levels (off/metadata/full) | **Partial** — metadata/full gating done; off-absence reason now implemented and queryable (W-1 resolved); full `off` consumer (`dbgraph_object` MCP tool) deferred to Phase 5 | `levels.test.ts`, `omitted.test.ts`, E2E DoD getMeta channel |
| US-007 Dynamic SQL blindness + module edges | **Partial** — `has_dynamic_sql` flag modeled and tested; `reads_from`/`writes_to` typed and normalized from pre-parsed references; live SQL body parsing deferred to Phase 3 | `normalize.test.ts`, `trigger-rw.test.ts` |
| US-009 Storage schema and snapshots | **Partial** — schema, round-trip, FTS, `body_hash`, snapshots implemented; per-engine fingerprint computation and `diff snapA snapB` deferred to Phase 3/5 | `schema.test.ts`, `sqlite-graph-store.test.ts` |

## Phase Boundaries Documented

| Deferral | Target phase | Spec reference |
|----------|-------------|----------------|
| Inference scoring for `inferred_reference` edges | Phase 9 (US-008) | `graph-query` spec: "Inferred-only route" scenario; `graph-model` spec: edge taxonomy |
| Per-engine fingerprint computation and `diff snapA snapB` | Phase 3 / Phase 5 | `graph-storage` spec: snapshot requirement |
| Live SQL body parsing for `reads_from`/`writes_to` edges | Phase 3 | `graph-normalization` spec: read/write edges |
| MCP compact output format (US-019) | Phase 5 | `graph-query` spec purpose |
| `dbgraph_object` MCP tool (US-005) as `off`-level consumer | Phase 5 | US-003 story |

## Next Change Pointer

**Phase 2: SQLite EXTRACTION adapter** — implement `SchemaAdapter` port to extract a `RawCatalog`
from a live SQLite database file. This is the extraction side of the pipeline (US-026). Not to be
confused with the SQLite *storage* adapter (`SqliteGraphStore`) already built in this phase.

Relevant artifacts for Phase 2:
- `src/core/ports/graph-store.ts` — existing port; `SchemaAdapter` port to be defined alongside it
- `src/core/model/catalog.ts` — `RawCatalog` contract the new adapter must produce
- `docs/stories/` — US-026 and related extraction stories
- `docs/adr/ADR-004.md` — hexagonal boundary rules; extraction adapter lives in `src/adapters/extraction/sqlite/`

## Specs Merged to Main

| Domain | Action | Path |
|--------|--------|------|
| graph-model | Created (greenfield) | `openspec/specs/graph-model/spec.md` |
| graph-storage | Created (greenfield) | `openspec/specs/graph-storage/spec.md` |
| graph-normalization | Created (greenfield) | `openspec/specs/graph-normalization/spec.md` |
| graph-query | Created (greenfield, W-4 deferral preserved) | `openspec/specs/graph-query/spec.md` |

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/graph-model/spec.md` | Present |
| `specs/graph-storage/spec.md` | Present |
| `specs/graph-normalization/spec.md` | Present |
| `specs/graph-query/spec.md` | Present (W-4 deferral annotation preserved) |
| `design.md` | Present |
| `tasks.md` | Present (25/25 complete) |
| `apply-progress.md` | Present (Batches A–E) |
| `verify-report.md` | Present (initial PASS WITH WARNINGS + Re-verification PASS appended) |
| `state.yaml` | Present (archive: done, change_closed: true) |
| `archive-report.md` | This file |

## SDD Cycle Complete

phase-1-graph-core has been fully planned, implemented, verified, and archived.
All four capability delta specs are promoted to `openspec/specs/` as canonical source of truth.
The change folder is closed at `openspec/changes/archive/2026-06-12-phase-1-graph-core/`.
