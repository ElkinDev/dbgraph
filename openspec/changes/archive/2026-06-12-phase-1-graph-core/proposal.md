# Proposal: Phase 1 — Graph Core

## Intent

dbgraph needs its engine-agnostic heart before any database adapter, MCP server, or CLI can exist. Phase 0 left `src/` empty. This change builds the deterministic core (ADR-008): the domain model, SQLite storage behind the `GraphStore` port, the `RawCatalog → graph` normalizer, and the query engine that powers future MCP tools. It is the first implementable layer — every later phase depends on it (US-006 is the root story).

## Scope

### In Scope
- **Domain model** (`src/core/model`): node kinds (database…field), edge kinds + `confidence` (declared|parsed|inferred) + optional `score`, indexing levels (off|metadata|full), `CapabilityMatrix`, `ExtractionScope`, `RawCatalog`. `inferred_reference` TYPE only.
- **GraphStore port** (`src/core/ports`) + **SQLite adapter** (`src/adapters/storage/sqlite`): tables `nodes`/`edges`/`nodes_fts`(FTS5)/`snapshots`/`meta`, schema versioning + migrations, `body_hash` (ADR-005).
- **Normalizer** (`src/core/normalize`): reference resolution, aggregated table→table edges, stub nodes (`missing:true` / `excluded:true`), honors off/metadata/full levels.
- **Query engine** (`src/core/query`): neighbors (grouped by kind, explicit direction), depth-limited impact closure (read vs write separated), shortest join path, FTS search.
- **Unit tests + JSON fixtures** (`test/fixtures/catalog-*.json`), golden files.

### Out of Scope
- Real engine adapters, MCP server, CLI, config-file handling (Phase 4), inference engine US-008 (Phase 9), live fingerprint/diff (Phase 3).

## Capabilities

### New Capabilities
- `graph-model`: node/edge types, confidence, levels, CapabilityMatrix, RawCatalog.
- `graph-storage`: SQLite GraphStore adapter, schema + migrations + FTS5.
- `graph-normalization`: RawCatalog → nodes/edges, stubs, level honoring (US-006, US-003, US-007 model).
- `graph-query`: neighbors, impact, path, search (US-014/US-015 semantics).

### Modified Capabilities
- None (greenfield core).

## Approach

Hexagonal (ADR-004): `src/core` imports nothing from adapters/mcp/cli/drivers. `GraphStore` is a port in core; its `better-sqlite3` implementation lives in `src/adapters/storage/sqlite` and is loaded via a factory — core stays driver-free and swappable (node:sqlite later). Strict TDD: failing vitest test before each unit under `src/core`; deterministic outputs pinned by golden files. Public surface re-exported only through `src/index.ts`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/model` | New | Types, edges, levels, RawCatalog |
| `src/core/ports` | New | `GraphStore` port |
| `src/core/normalize` | New | Catalog → graph |
| `src/core/query` | New | Neighbors/impact/path/search |
| `src/adapters/storage/sqlite` | New | SQLite GraphStore impl |
| `src/index.ts` | Modified | Re-export public API |
| `test/fixtures` | New | `catalog-*.json` + golden files |
| `package.json` | Modified | Add `better-sqlite3` (closed list) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `better-sqlite3` native build fails on a CI OS | Med | Pin version, `npm ci`, validate on Win/Linux Node 20/22; port allows node:sqlite swap |
| Boundary leak (core importing the driver) | Med | Lint boundary rule (ADR-004); driver only inside adapter |
| Impact-closure cycles / unbounded walk | Med | Depth cap + visited set; tested on cyclic fixture |
| Golden-file churn from nondeterministic ordering | Low | Deterministic sort keys (ADR-008) |

## Rollback Plan

Change is purely additive (no prior code touched beyond re-exports). Revert = delete the new `src/core/*`, `src/adapters/storage/sqlite`, `test/fixtures`, restore `src/index.ts`, and drop `better-sqlite3` from `package.json` + lockfile. No data migrations, no external state.

## Dependencies

- `better-sqlite3` — already on the ADR-006/007 closed canonical list; NOT yet installed. This is the first phase that needs it (storage adapter). Justification: native SQLite+FTS5 driver mandated by ADR-005; added with pinned version, committed lockfile, `npm audit` gate.

## Success Criteria

- [ ] Given a fixture `RawCatalog` (tables/FKs/views/procs/triggers), the graph persists to SQLite and reloads.
- [ ] Neighbor, impact (read vs write), path, and FTS queries return expected results via golden files.
- [ ] Composite FK → one `references` edge per column pair + one aggregated table→table edge.
- [ ] Dangling reference → stub node `missing:true` reported in the normalization result.
- [ ] `src/core` imports nothing from adapters/drivers (boundary lint passes); `npm test`, `npm run lint`, `tsc --noEmit` green.
