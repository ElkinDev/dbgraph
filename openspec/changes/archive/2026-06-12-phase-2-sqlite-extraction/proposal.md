# Proposal: Phase 2 — SQLite Schema Extraction Adapter

## Intent

Phase 1 delivered the engine-agnostic core (model, normalizer, `GraphStore`, query) but no SOURCE
database is read yet — `RawCatalog` is only ever hand-built in tests. We need the FIRST extraction
adapter to prove the full E2E pipeline (source db → extract → normalize → store → query) with ZERO
infrastructure (US-026, ADR-002 engine order). SQLite is the proving ground: cheapest to wire, no
containers, and it forces the read-only-by-construction guarantee (US-031) and the `SchemaAdapter`
port to exist for the first time. Success = E2E green in CI and 100% SQLite capability-matrix
coverage (master-plan Phase 2 DoD).

## Scope

### In Scope
- New `SchemaAdapter` port in `src/core/ports`: dialect id, `capabilities: CapabilityMatrix`,
  open/connect, `extract(scope): Promise<RawCatalog>`, `fingerprint(): Promise<string>`, close.
- SQLite extraction adapter under `src/adapters/engines/sqlite/` reading `sqlite_master` + PRAGMAs
  (`table_info`, `foreign_key_list`, `index_list`/`index_info`) for tables, columns, FKs, indexes,
  views, triggers. Bodies + minimal/honest dependency hints from `sqlite_master.sql`.
- Truthful SQLite `CapabilityMatrix`: NO procedures/functions/sequences/collections.
- `fingerprint()` via `PRAGMA schema_version` (US-009 sqlite part — cheap drift detection).
- Read-only by construction: driver opened with `{ readonly: true }`; plus US-031 repo test scanning
  SQL in `src/adapters/engines/**` for write verbs (`INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/
  MERGE/EXEC`). `src/adapters/storage/**` is EXEMPT by design (ADR-005, local index writes).
- Driver duality: factory with dynamic import joining `better-sqlite3` AND the `node:sqlite` builtin.
- Torture-schema fixture exercising every SQLite capability + golden-pinned E2E pipeline test.

### Out of Scope
- Other engines, MCP server, CLI, init/config plumbing, inference/scoring, statistics/sampling.
- Full SQL body parsing into `reads_from`/`writes_to` beyond what `sqlite_master.sql` trivially yields
  (hints minimal; otherwise marked `hasDynamicSql`/unparsed honestly).

## Capabilities

### New Capabilities
- `schema-extraction`: the `SchemaAdapter` port contract — dialect id, capabilities, lifecycle
  (open/extract/fingerprint/close), and what every source adapter MUST guarantee (read-only,
  produces a `RawCatalog`, honest capability reporting).
- `sqlite-extraction`: the SQLite adapter's concrete behavior — which catalog objects it extracts,
  its truthful capability matrix, fingerprint via `PRAGMA schema_version`, driver duality
  (`better-sqlite3` + `node:sqlite`), and the golden-pinned E2E pipeline.

### Modified Capabilities
- None. This is purely additive; it consumes existing `graph-model`, `graph-normalization`,
  `graph-storage`, `graph-query` contracts without changing their requirements.

## Approach

Port-first, mirroring Phase 1's hexagonal pattern (ADR-004). `SchemaAdapter` lives in core and
imports NO driver. A `createSqliteSchemaAdapter` factory (mirroring `createSqliteGraphStore`) is the
ONLY join point that dynamically imports a driver; a thin driver-handle abstraction lets the same
extraction logic run on `better-sqlite3` and `node:sqlite`, both opened read-only. Extraction maps
`sqlite_master` rows + PRAGMA output into `RawObject`s; trigger/view bodies come from
`sqlite_master.sql`, with dependency hints either minimally derived or `hasDynamicSql`-flagged
honestly. Both drivers MUST yield the SAME `RawCatalog` (asserted on Node >=22.5; `node:sqlite` tests
skip-with-reason on Node 20 per ADR-006/007). Design phase locks two open decisions: fixture form
(committed binary `.db` vs committed `.sql` materialized at setup) and driver-duality seam shape.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/ports/schema-adapter.ts` | New | `SchemaAdapter` port interface |
| `src/core/ports/index.ts` | Modified | Re-export the new port type |
| `src/core/errors.ts` | Modified | Add typed `ConnectionError` / `PermissionError` |
| `src/adapters/engines/sqlite/` | New | Adapter, factory, driver-duality handle, PRAGMA mappers |
| `src/index.ts` | Modified | Wire `createSqliteSchemaAdapter` at the composition root |
| `test/` fixtures + e2e | New | Torture schema fixture + golden-pinned E2E pipeline test |
| `test/` security scan | New | US-031 write-verb scanner over `src/adapters/engines/**` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `node:sqlite` absent on Node 20 (CI matrix) | High | Conditional skip-with-reason; assert parity only on Node >=22.5 |
| Driver behavioral drift between the two drivers | Med | Single shared extraction logic; cross-driver parity test on same fixture |
| Write-verb scanner false positives (verbs in comments/strings) | Med | Scope scanner to `engines/**`; exempt `storage/**`; tune token boundaries in design |
| Trigger/view dependency hints incomplete | Med | Phase-2-honest scope: mark `hasDynamicSql`/unparsed rather than guess (US-007) |
| Binary `.db` fixture churn / review opacity | Low | Frame `.sql`-materialized alternative; design recommends one (serves US-026 intent) |

## Rollback Plan

Fully additive — no Phase 1 contract changes. Revert by deleting `src/adapters/engines/`, the new
`schema-adapter.ts` port (and its `index.ts` re-export), the new error classes, the composition-root
wiring in `src/index.ts`, and the new fixtures/tests. Phase 1 core, storage, normalization and query
remain untouched and green.

## Dependencies

- No new packages (ADR-007): `better-sqlite3` already present; `node:sqlite` is a Node >=22.5 builtin.
- Consumes existing core contracts: `CapabilityMatrix`, `ExtractionScope`, `RawCatalog`,
  `normalizeCatalog`, `SqliteGraphStore`, query API (`neighbors`/`impact`/`path`/`search`).

## Success Criteria

- [ ] `SchemaAdapter` port exists in core, imports no driver (boundary lint clean).
- [ ] SQLite adapter extracts tables, columns, FKs (incl. composite), indexes (unique/partial/
      expression), views, triggers from the torture fixture.
- [ ] Source databases are opened read-only; US-031 write-verb scanner passes and fails on injected
      write verbs in `engines/**` (storage `**` exempt).
- [ ] SQLite `CapabilityMatrix` truthfully reports NO procedures/functions/sequences/collections —
      100% capability-matrix coverage.
- [ ] `fingerprint()` returns a `PRAGMA schema_version`-derived value that changes on DDL.
- [ ] Both drivers produce byte-identical `RawCatalog` (asserted on Node >=22.5; skipped-with-reason
      on Node 20).
- [ ] Golden-pinned E2E test green in CI: source db → extract → normalize → upsert → neighbors/impact/
      path/search.
