# Tasks: Phase 1 — Graph Core

> Order honors design §9.2 red→green TDD: every core unit's failing test precedes its implementation.
> Strict TDD (config `strict_tdd: true`) governs `src/core`. Test runner: `npm test`. One conventional
> commit per task, English, referencing US IDs. `exactOptionalPropertyTypes`: use `field?: T`, never `T | undefined`.
> Standing rule: if a gotcha appears during apply, add a `docs/learnings.md` entry (create the file if absent) in the same commit.

## Phase 1: Infrastructure / Foundation

- [x] 1.1 Add `better-sqlite3` (pinned exact version) to `package.json` deps, run `npm ci` to refresh `package-lock.json`. Commit body MUST contain the ADR-007 written justification (native SQLite+FTS5 driver mandated by ADR-005; closed list). Done-check: `npm ls better-sqlite3` resolves; `npm audit` clean. (Dependency — proposal "Dependencies").
- [x] 1.2 Create `test/fixtures/` JSON inputs: `catalog-minimal`, `catalog-composite-fk`, `catalog-dangling-ref`, `catalog-excluded`, `catalog-cyclic`, `catalog-rw-edges`, `catalog-levels` (design §9.1). Done-check: each parses as JSON; shapes match `RawCatalog` once 2.x lands. (Feeds all normalize/query scenarios.)

## Phase 2: Domain Model + Errors (graph-model)

- [x] 2.1 RED: `test/core/model/model.test.ts` — type/guard asserts for NodeKind, EdgeKind, EdgeConfidence, IndexLevel, stub flag mutual exclusion. Done-check: `npm test` fails (no model). (graph-model: "Node taxonomy", "Edge taxonomy", "Confidence classification".)
- [x] 2.2 GREEN: `src/core/model/{node,edge,catalog,capability,graph}.ts` + barrel `index.ts` per design §4 (`exactOptionalPropertyTypes` discipline; `inferred_reference`/`score` TYPE only). Done-check: 2.1 green; `npx tsc --noEmit` clean. (graph-model: all requirements; US-006/US-007 model.)
- [x] 2.3 RED: `test/core/errors.test.ts` — each error carries its stable `code`, extends `DbgraphError`. Done-check: `npm test` fails. (design §7.1.)
- [x] 2.4 GREEN: `src/core/errors.ts` — `DbgraphError` base + `NormalizationError`, `StorageError`, `SchemaVersionError`, `QueryError`, `NotFoundError`. Done-check: 2.3 green. (design §7.1.)
- [x] 2.5 `src/core/ports/{graph-store,logger}.ts` + ports barrel: async `GraphStore` port (design §11) + `Logger` (§7.2) + a no-op default logger. Done-check: `npx tsc --noEmit` clean. (graph-storage "behavior through the port".)

## Phase 3: Determinism + Levels (graph-normalization primitives)

- [x] 3.1 RED: `test/core/normalize/id.test.ts` — same qname→same id, kind disambiguation, stub-upgrade id equality (design §3.4). Done-check: `npm test` fails. (graph-model "stable identity"; ADR-008.)
- [x] 3.2 GREEN: `src/core/normalize/id.ts` — `sha1(kind+qname)` node IDs, edge IDs with discriminator, canonical qname + stable-stringify (sorted keys) helper. Done-check: 3.1 green. (design §3.4, §5.6.)
- [x] 3.3 RED: `test/core/normalize/levels.test.ts` — table-driven off/metadata/full effects on payload body, bodyHash, FTS body flag. Done-check: `npm test` fails. (graph-normalization "Level honoring"; US-003.)
- [x] 3.4 GREEN: `src/core/normalize/levels.ts` — applies levels + body whitespace normalization (§5.5). Done-check: 3.3 green. (graph-normalization "Level honoring"; US-003 AC #1/#2.)

## Phase 4: Normalizer (graph-normalization)

- [x] 4.1 RED+GREEN: minimal-catalog normalize + `test/golden/normalize/catalog-minimal.json`. Done-check: golden matches; nodes + 1 `references`/`depends_on`/`fires_on`. (graph-normalization "Catalog-to-graph"; US-006 AC #1.)
- [x] 4.2 RED+GREEN: composite-FK aggregation (per-pair edges + 1 aggregated table→table) + golden. Done-check: golden matches. (graph-normalization "Composite FK"; US-006 AC #2.)
- [x] 4.3 RED+GREEN: stubs — `missing:true` (dangling ref) and `excluded:true` (filtered target), reported in `result.stubs`; edge preserved. Done-check: goldens match. (graph-normalization "Stub nodes"; US-006 AC #3, US-004.)
- [x] 4.4 RED+GREEN: reads/writes + dynamic-SQL flag from `catalog-rw-edges` (`reads_from`/`writes_to` `confidence: parsed`; `has_dynamic_sql`) + golden. Done-check: goldens match. (graph-normalization "Read/write edges", "Dynamic SQL"; US-007.)
- [x] 4.5 RED+GREEN: determinism — normalize twice byte-identical; assemble `reference-resolver.ts` + `normalize.ts` + barrel. Done-check: byte-equal assertion green. (graph-normalization "Boundary and determinism"; ADR-008.)

## Phase 5: SQLite Adapter (graph-storage)

> Implements the async `GraphStore` port. Tests use REAL `better-sqlite3` (`:memory:` or tmp file), never mocked (dbgraph-testing). Adapter loads driver via dynamic `import()`; imports only core types/ports.

- [x] 5.1 RED+GREEN: `schema.ts` (DDL §3.1) + `migrations.ts` (forward-only §3.3) + `factory.ts` (dynamic import). Tests: open from v0 migrates to v1, current-version open is no-op, newer-than-known throws `SchemaVersionError`. Done-check: tests green. (graph-storage "Schema versioning"; US-009.)
- [x] 5.2 RED+GREEN: `sqlite-graph-store.ts` `upsertGraph` + reads (`getNode`/`getNodesByKind`/`getNodeByQName`/`getEdgesFrom`/`getEdgesTo`). Test: round-trip preserves id/kind/direction/confidence/event/score. Done-check: round-trip green. (graph-storage "Persist and reload round-trip".)
- [x] 5.3 RED+GREEN: FTS5 population (level-gated body) + `searchFts`. Test: `full` body matches token, `metadata` body does not; `body_hash` stable/changes. Done-check: tests green. (graph-storage "FTS5 honors levels", "body_hash"; US-003.)
- [x] 5.4 RED+GREEN: snapshots (`putSnapshot`/`listSnapshots` insertion order) + meta (`getMeta`/`setMeta`) + `deleteNodes` (cascades edges+fts) + adapter barrel. Done-check: tests green. (graph-storage "Snapshot persistence"; US-009.)

## Phase 6: Query Engine (graph-query)

> Pure orchestration over the `GraphStore` port; unit-tested against an in-memory fake store AND the real adapter. Each output golden-pinned.

- [x] 6.1 RED+GREEN: `neighbors.ts` — group by kind + direction, `kinds` filter, inferred group with score + golden. Done-check: golden matches. (graph-query "Neighbors grouped"; US-013.)
- [x] 6.2 RED+GREEN: `impact.ts` — BFS read/write split as chains, depth cap+truncation, cycle visited-set, dynamic-SQL warning + goldens (incl. `catalog-cyclic`). Done-check: goldens match. (graph-query "Depth-limited impact"; US-014.)
- [x] 6.3 RED+GREEN: `path.ts` — shortest `references` path with hop join columns, no-route→nearest, inferred flag (false in P1) + goldens. Done-check: goldens match. (graph-query "Shortest join path"; US-015.)
- [x] 6.4 RED+GREEN: `search.ts` — FTS via port, prefix-token typo tolerance + TS Levenshtein fallback, body only for `full`, pagination + goldens. Done-check: goldens match. (graph-query "Full-text search"; US-011.)
- [x] 6.5 RED+GREEN: end-to-end DoD — normalize→persist→query the DoD fixture; query barrel. Done-check: neighbors/impact/path/search goldens match + byte-identical on re-run. (graph-query "End-to-end DoD".)

## Phase 7: Public API + Boundary + Gates

- [x] 7.1 RED+GREEN: `src/core/index.ts` barrel + update `src/index.ts` to re-export core + `createSqliteGraphStore` (root wires adapter; core never imports it). Test: exports exist/stable. Done-check: `npx tsc --noEmit` clean; barrel test green. (design §2 "Public API surface".)
- [x] 7.2 RED+GREEN: `test/core/boundaries.test.ts` (design §8) — scans `src/core/**` imports, FAILS on any `src/adapters`/`src/mcp`/`src/cli`/DB-driver specifier; asserts adapter imports no mcp/cli. Done-check: boundary test green. (graph-storage "Core depends only on the port"; graph-normalization "Boundary"; ADR-004.)
- [x] 7.3 Final gates + status: run `npm test`, `npm run lint`, `npx tsc --noEmit` (all green); set US-006 done and partial markers for US-007/US-009/US-003 (and US-003 storage parts) in `docs/stories/` (create the file/dir if absent); ensure each task landed as a conventional commit referencing its US IDs. Done-check: three gates clean; story statuses updated. (proposal "Success Criteria".)
