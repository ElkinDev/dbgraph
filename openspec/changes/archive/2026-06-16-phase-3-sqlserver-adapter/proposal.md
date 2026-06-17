# Proposal: Phase 3 — SQL Server Schema Extraction Adapter

## Intent

Phase 2 delivered the `SchemaAdapter` port and the SQLite adapter. SQL Server is the richest catalog of the
Core 5 (ADR-002) and the engine we validate against the real validation database later (Phase 6). We need the SECOND
concrete adapter — implementing the EXISTING port unchanged — to: (a) prove the contract generalizes beyond
SQLite, (b) deliver the FIRST `confidence: parsed` dependency edges the port spec explicitly deferred to US-027,
and (c) establish the per-engine permission-doc pattern (US-033). Success = Testcontainers E2E green on a torture
schema with 100% SQL Server capability-matrix coverage, reads/writes classified from module bodies, and a
minimal `VIEW DEFINITION`-only login documented.

## Scope

### In Scope
- `MssqlSchemaAdapter` under `src/adapters/engines/mssql/` implementing the existing `SchemaAdapter` port:
  tables/columns/types/defaults/computed columns, PK/FK/unique/check constraints, indexes
  (clustered/nonclustered, filtered, included columns), views, stored procedures, scalar + table-valued
  functions, triggers (event + timing), sequences, extended properties (`MS_Description`) as comments.
  Sources: `sys.tables/columns/indexes/index_columns/foreign_keys/foreign_key_columns/key_constraints/
  check_constraints/objects/triggers/sql_modules/sequences/computed_columns` + `sys.extended_properties`.
- `reads_from`/`writes_to` classification (completes US-007's extraction half): `sys.sql_expression_dependencies`
  for object→object edges; classify read vs write via a conservative tokenizer over `sql_modules.definition`
  (INSERT/UPDATE/DELETE/MERGE target vs read) → `confidence: 'parsed'`; unanalyzable bodies (dynamic SQL via
  EXEC/sp_executesql) → `has_dynamic_sql: true`. Trigger `fires_on` (event + timing).
- Connectivity via `mssql` (tedious/TDS): SQL auth AND NTLM; DOCUMENT Kerberos SSO unsupported (ADR-006).
  Read-only posture = minimal-permission login + the US-031 engines scanner (no app-level readonly flag exists).
- Minimal-permission login: `docs/permissions/mssql.md` (CREATE LOGIN/USER granting only `VIEW DEFINITION` +
  `CONNECT`); actionable `PermissionError` naming the permission + doc link (satisfies US-033 for mssql).
- `fingerprint()`: one cheap query — `MAX(modify_date)` + object COUNT over `sys.objects` (US-009).
- Testcontainers integration (dev dep, NEW): `mcr.microsoft.com/mssql/server` + a committed T-SQL torture
  schema → golden `RawCatalog`; full E2E extract → `normalizeCatalog` → `SqliteGraphStore` → query.

### Out of Scope
- Other engines, MCP, CLI, init/config plumbing, inference, statistics/sampling data reads.
- A full T-SQL grammar parser (ADR-007 — conservative tokenizer only; ambiguous → `has_dynamic_sql`).
- The actual validation against the enterprise database (Phase 6, manual, dedicated readonly login).

## Capabilities

### New Capabilities
- `mssql-extraction`: the SQL Server adapter's concrete behavior — catalog objects extracted, truthful
  `CapabilityMatrix` (procs/functions/sequences supported), parsed reads/writes + dynamic-SQL honesty,
  `fingerprint()` query, SQL-auth/NTLM connectivity + Kerberos limitation, minimal-permission login +
  `PermissionError`, and the Testcontainers golden-pinned E2E pipeline + gated CI job.

### Modified Capabilities
- None. Purely additive: implements the EXISTING `schema-extraction` port and consumes existing `graph-model`,
  `graph-normalization`, `graph-storage`, `graph-query` contracts unchanged.

## Approach

Mirror the Phase-2 hexagonal pattern (ADR-004): adapter lives under `src/adapters/engines/mssql/`, core gains
at most shared types. A `createMssqlSchemaAdapter` factory is the ONLY join point and dynamically imports
`mssql`. Catalog `sys.*` SELECTs map to `RawObject`s (deterministic, sorted — ADR-008). A conservative
tokenizer over `sql_modules.definition` resolves `sys.sql_expression_dependencies` edges into read/write with
`confidence: parsed`; anything ambiguous is flagged `has_dynamic_sql: true`. Integration-first per dbgraph-testing
(NEVER mock tedious): pure mappers unit-tested with fixtures; live behavior tested against Testcontainers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/mssql/` | New | Adapter, factory, `sys.*` mappers, body tokenizer, capability matrix |
| `src/index.ts` | Modified | Wire `createMssqlSchemaAdapter` at the composition root |
| `src/core/errors.ts` | Modified (maybe) | Reuse existing `ConnectionError`/`PermissionError`; add only if a gap |
| `docs/permissions/mssql.md` | New | Minimal `VIEW DEFINITION`-only login script (US-033) |
| `test/fixtures/mssql/torture.sql` | New | Committed T-SQL torture schema (proc/trigger/TVF/filtered index/computed) |
| `test/` integration + e2e | New | Testcontainers extract → golden; full E2E to query layer |
| `package.json` | Modified | `mssql` (optionalDependency, ADR-006) + `testcontainers` (devDependency) |
| `.github/workflows` | Modified | Gated mssql integration job (service container, never blocks unit matrix, never touches the validation database) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tokenizer mis-classifies read vs write | Med | Conservative bias; ambiguous → `has_dynamic_sql`; golden fixtures cover proc/trigger cases |
| Dynamic SQL (EXEC/sp_executesql) hides intent | High | Detect and mark `has_dynamic_sql: true` — declare blindness, never guess (US-007) |
| Testcontainers needs Docker (some contributors lack it) | Med | Gate the job; skip-with-reason locally; unit matrix never depends on Docker |
| New deps (`mssql`, `testcontainers`) supply-chain | Med | ADR-007: `mssql` on closed list; both justified in writing; `npm ci` + audit gates |
| Accidental write through adapter | Low | Catalog SELECTs only + US-031 engines scanner + minimal-permission login |
| CI mssql job touches the validation database | Low | Job uses ephemeral container only; that validation is manual Phase 6 |

## Rollback Plan

Fully additive — no Phase 1/2 contract changes. Revert by deleting `src/adapters/engines/mssql/`, the
composition-root wiring in `src/index.ts`, `docs/permissions/mssql.md`, the mssql fixtures/tests, the CI job, and
the `mssql`/`testcontainers` entries in `package.json`/lockfile. Existing core, storage, normalization, query and
the SQLite adapter remain untouched and green.

## Dependencies

- `mssql` (tedious/TDS) — `optionalDependency`, lazy dynamic `import()` (ADR-006); on the ADR-007 closed list,
  NOT yet installed — installing it is part of this change (justified in writing).
- `testcontainers` — `devDependency`, NEW (justified): Docker verified on the dev machine.
- Consumes existing contracts: `CapabilityMatrix`, `ExtractionScope`, `RawCatalog`, `normalizeCatalog`,
  `SqliteGraphStore`, query API; reuses existing `ConnectionError`/`PermissionError`.

## Success Criteria

- [ ] `MssqlSchemaAdapter` implements the EXISTING port (no port changes) and is wired via factory in `src/index.ts`.
- [ ] Extracts tables/columns/types/defaults/computed, PK/FK/unique/check, indexes (clustered/filtered/included),
      views, procs, scalar + table-valued functions, triggers (event+timing), sequences, extended properties.
- [ ] `reads_from`/`writes_to` classified from module bodies with `confidence: parsed`; dynamic-SQL bodies marked
      `has_dynamic_sql: true`; trigger `fires_on` captured.
- [ ] SQL auth AND NTLM supported; Kerberos SSO documented as unsupported (ADR-006).
- [ ] `docs/permissions/mssql.md` ships the `VIEW DEFINITION`-only login; missing permission raises an actionable
      `PermissionError` naming the permission + doc (US-033).
- [ ] `fingerprint()` returns a `MAX(modify_date)`+COUNT value (one cheap query) that moves on DDL.
- [ ] Truthful SQL Server `CapabilityMatrix` (procs/functions/sequences supported) — 100% matrix coverage.
- [ ] Testcontainers E2E green: torture `.sql` → extract → golden `RawCatalog` → normalize → upsert → query;
      the mssql CI job is gated, never blocks the unit matrix, never touches the validation database.
