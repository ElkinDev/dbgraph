# Proposal: Phase 8a — PostgreSQL Schema Extraction Adapter

> **SCOPE SPLIT — PostgreSQL ONLY.** This change is the FIRST half of the original Phase-8 "Núcleo 5"
> engine work. MySQL/MariaDB is split out into a SEPARATE, pre-planned next change `phase-8b-mysql` and is
> explicitly OUT OF SCOPE here. Rationale: MySQL's independent complications (schema-vs-database conflation,
> CHECK constraints only on 8.0.16+, the MariaDB sequence fork, `VIEW_DEFINITION` truncation in
> `information_schema`) must NOT block clean PostgreSQL delivery. Two changes preserve ZERO carry-over — each
> ships green on its own. The shared tokenizer extracted HERE (`_shared/tokenizer-core.ts`) is the only
> artifact 8b consumes from 8a.

## Intent

Phase 3 delivered the SECOND concrete `SchemaAdapter` (SQL Server) and proved the port generalizes beyond
SQLite, established the per-engine permission-doc pattern (US-033), and shipped the first `confidence: parsed`
dependency edges. PostgreSQL is the next Core-5 engine (ADR-002) and the most widely deployed open-source
target. We need the THIRD concrete adapter — implementing the EXISTING `SchemaAdapter` port UNCHANGED — to:
(a) extend dbgraph to the dominant open-source RDBMS by mirroring the proven MSSQL adapter template,
(b) build a dialect-agnostic `RawCatalog` consumed by the SHARED, UNCHANGED
`normalizeCatalog → SqliteGraphStore → query` pipeline, and (c) factor the body-tokenizer primitives into a
reusable `_shared/` module that the upcoming `phase-8b-mysql` change will consume without duplication.

Success = Testcontainers E2E green against a `postgres:16` torture schema with 100% PostgreSQL
capability-matrix coverage, reads/writes classified from `pg_get_functiondef`/`pg_get_viewdef` bodies at
`confidence: parsed`, deterministic golden-pinned `RawCatalog`, the write-verb scanner over
`src/adapters/engines/**` staying green, NO new runtime deps beyond the PRE-APPROVED optional `pg`, and a
gated `pg-integration` CI job that never blocks the unit matrix.

## Scope

### In Scope
1. **`PgSchemaAdapter`** under `src/adapters/engines/pg/` implementing the EXISTING `SchemaAdapter` port:
   `capabilities.ts`, `queries.ts` (catalog SELECTs), `map.ts` (rows → `RawObject`/`RawCatalog`),
   `driver.ts` (LAZY dynamic `import('pg')` — ADR-006), `error-mapper.ts` (`pg` `SQLSTATE` → typed
   `ConnectionError`/`PermissionError`), `factory.ts` (`createPgSchemaAdapter`, the ONLY join point), and the
   adapter class. Extracts: schemas; tables/columns/types/defaults/identity & generated columns; PK/FK/
   unique/CHECK constraints; indexes (incl. partial/expression, included columns on PG11+); views;
   **materialized views** (see decision below); functions and procedures (PG11+ `CREATE PROCEDURE`); triggers
   (event + timing via `CREATE TRIGGER ... EXECUTE FUNCTION`); sequences; comments (`obj_description`/
   `col_description`) as comments. Sources: `pg_namespace`, `pg_class`, `pg_attribute`, `pg_attrdef`,
   `pg_constraint`, `pg_index`, `pg_proc`, `pg_trigger`, `pg_sequence`/`information_schema.sequences`,
   `pg_get_functiondef`, `pg_get_viewdef`, `pg_description`.
2. **Materialized views** → emitted as `kind: 'view'` with `extra.materialized: true`. NO core model change
   (no new `NodeKind`). Promoting matviews to a first-class kind is a DEFERRED follow-up (noted, not done).
3. **`reads_from`/`writes_to` classification** from function/procedure/view bodies via the SHARED tokenizer
   (`confidence: 'parsed'`, identical to today). `supportsDependencyHints: false` for PG in this phase →
   body tokenizer ONLY. PG's `hasDynamicSql` pattern = plpgsql `EXECUTE`. `pg_depend` OID-graph mapping is
   explicitly DEFERRED to a future phase.
4. **Shared tokenizer** — extract `canonicalizeQName` / `classifyAccess` / `extractWriteTargets` from the
   current `mssql/tokenizer.ts` into `src/adapters/engines/_shared/tokenizer-core.ts` (created HERE in 8a,
   consumed by 8b). The MSSQL tokenizer is REFACTORED to import from `_shared/` (no behavior change; its
   goldens stay byte-identical). PG supplies its own `hasDynamicSql` (`EXECUTE`) and dialect quoting.
5. **Config types** — add `PgAdapterConfig` to the `SchemaAdapterConfig` union (`src/core/ports/schema-adapter.ts`)
   and `PgSource` to the config schema. Standard connectivity: `host`/`port` (default 5432)/`database`/`user`/
   `password` + optional `ssl`. `password` is `${env:VAR}` ENV-ONLY. `schema?: string` OPTIONAL — default
   extracts ALL non-system schemas (`nspname NOT IN ('pg_catalog','information_schema')`); when provided,
   scopes extraction to that one schema. NO integrated-security / external-tool machinery — that was
   SQL-Server-specific.
6. **The 6 mechanical dispatch touch points** (verified against current code):
   - `src/core/ports/schema-adapter.ts` — add `PgAdapterConfig` to the `SchemaAdapterConfig` union.
   - `src/infra/config/schema.ts` — add `'pg'` to `SUPPORTED_DIALECTS` (currently `['sqlite', 'mssql']`).
   - `src/infra/config/parse-config.ts` — parse the `pg` dialect branch into a `PgSource`.
   - `src/infra/open-connections.ts` — wire `createPgSchemaAdapter` into the `AdapterAndStore` union + dispatch.
   - `src/index.ts` — add the `case 'pg'` to `capabilitiesFor()` + re-export `PG_CAPABILITIES` from the barrel.
   - `src/core/errors.ts` — update the pinned `UnsupportedDialectError` message (now lists `sqlite, mssql, pg`).
7. **`PG_CAPABILITIES`** — truthful `CapabilityMatrix` (see Capabilities section).
8. **Read-only enforcement** — match the MSSQL pattern: rely on a MINIMAL-PRIVILEGE PG login/role (NOT a
   driver flag), documented in a new `docs/permissions/pg.md`. Do NOT issue `SET SESSION ... READ ONLY` as a
   workaround. The write-verb scanner over `src/adapters/engines/**` MUST stay green (catalog SELECTs only).
9. **`fingerprint()`** — one cheap query (e.g. `MAX(...)` over a catalog change marker + object COUNT) that
   moves on DDL, stable across data-only changes (US-009).
10. **Gated Testcontainers integration** — `postgres:16` + a committed PG torture schema → golden
    `RawCatalog`; full E2E extract → `normalizeCatalog` → `SqliteGraphStore` → query. Plus a gated
    `pg-integration` CI job (`DBGRAPH_INTEGRATION=1`), never blocking the unit matrix.
11. **`pg` as `optionalDependency`** (ADR-002/006 — PRE-APPROVED on the closed driver list), lazy dynamic
    `import()`. `testcontainers` already a dev dep from Phase 3.

### Out of Scope (explicit — NOT carry-over)
- **MySQL / MariaDB** — the entire `phase-8b-mysql` change (its own complications, see banner above).
- **`pg_depend` dependency hints** — the OID-graph mapping; deferred to a future phase
  (`supportsDependencyHints: false` here, body tokenizer only).
- **Materialized-view NodeKind promotion** — matviews ship as `kind: 'view'` + `extra.materialized: true`;
  a first-class `materialized_view` kind is a deferred follow-up.
- **Inferred relationships** (`inferred_reference`) — Phase 9 (US-008/US-030 territory).
- **Connection-pool tuning** — a single short-lived connection per run is sufficient for extraction.
- **RLS policies / custom-type bodies as first-class nodes** — beyond the truthful matrix below; emitted as
  comments/`extra` only where they ride existing kinds, not promoted to new node types in 8a.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing capability names used verbatim. PG mirrors
> the MSSQL precedent (`mssql-extraction`).

### New Capabilities
- `pg-extraction`: the PostgreSQL adapter's concrete behavior — catalog objects extracted, truthful
  `CapabilityMatrix`, parsed reads/writes from bodies (`supportsDependencyHints: false`, plpgsql `EXECUTE` →
  `hasDynamicSql`), materialized-views-as-`view`+`extra.materialized`, `fingerprint()` query, host/port/
  user/password (+ssl) connectivity, the minimal-privilege role + `docs/permissions/pg.md` + actionable
  `PermissionError`, and the gated Testcontainers golden-pinned E2E pipeline + `pg-integration` CI job.

### Modified Capabilities
- `schema-extraction` (the engine-agnostic port spec): a SMALL DELTA only — record that the
  `SchemaAdapterConfig` union, `SUPPORTED_DIALECTS`, `capabilitiesFor`, and the `UnsupportedDialectError`
  message now include `pg`. The port SHAPE is UNCHANGED (the port file already cites `'pg'` as an example
  dialect). The body-tokenizer primitives move to `_shared/` with NO behavioral change to MSSQL.
- `graph-model`, `graph-normalization`, `graph-storage`, `graph-query`: UNCHANGED — consumed as-is.

## Approach

Mirror the Phase-3 hexagonal template (ADR-004) one-for-one: the adapter lives under
`src/adapters/engines/pg/`, imports core types + its OWN `pg` driver via LAZY dynamic `import()` (ADR-006),
and `createPgSchemaAdapter` is the ONLY join point. Catalog `pg_catalog`/`information_schema` SELECTs map to
`RawObject`s in a DETERMINISTIC, sorted `RawCatalog` (ADR-008), golden-pinned in CI. Bodies come from
`pg_get_functiondef`/`pg_get_viewdef`; the SHARED `_shared/tokenizer-core.ts` classifies each body reference
as read/write at `confidence: 'parsed'`; plpgsql `EXECUTE` sets `hasDynamicSql: true` (declared blindness —
never guessed). Because `supportsDependencyHints: false`, there is NO catalog-supplied edge list to refine —
the tokenizer is the sole edge source, exactly as MSSQL behaves when hints are absent. Materialized views are
extracted as `kind: 'view'` carrying `extra.materialized: true`, so the core model and downstream pipeline
need no change. Read-only posture = a minimal-privilege role documented in `docs/permissions/pg.md` plus the
existing write-verb engines scanner (no app-level read-only flag, matching MSSQL). Integration-first per
`dbgraph-testing` (NEVER mock `pg`): pure mappers/tokenizer unit-tested with fixtures; live behavior tested
against `postgres:16` Testcontainers behind `DBGRAPH_INTEGRATION=1`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/pg/` | New | `capabilities.ts`, `queries.ts`, `map.ts`, `driver.ts` (lazy `import('pg')`), `error-mapper.ts`, `factory.ts`, adapter class |
| `src/adapters/engines/_shared/tokenizer-core.ts` | New | `canonicalizeQName` / `classifyAccess` / `extractWriteTargets` extracted from `mssql/tokenizer.ts` (consumed by 8b) |
| `src/adapters/engines/mssql/tokenizer.ts` | Modified | Refactor to import the primitives from `_shared/`; NO behavior change (goldens byte-identical) |
| `src/core/ports/schema-adapter.ts` | Modified | Add `PgAdapterConfig` to the `SchemaAdapterConfig` union (core types only — ADR-004) |
| `src/infra/config/schema.ts` | Modified | Add `'pg'` to `SUPPORTED_DIALECTS`; add the `PgSource` shape |
| `src/infra/config/parse-config.ts` | Modified | Parse the `pg` dialect branch into `PgSource` (host/port/database/user/password + optional `ssl`, `schema?`) |
| `src/infra/open-connections.ts` | Modified | Wire `createPgSchemaAdapter` into `AdapterAndStore` + the dispatch switch |
| `src/index.ts` | Modified | `case 'pg'` in `capabilitiesFor()`; re-export `PG_CAPABILITIES` from the barrel |
| `src/core/errors.ts` | Modified | Update the pinned `UnsupportedDialectError` message to list `sqlite, mssql, pg` |
| `docs/permissions/pg.md` | New | Minimal read-only role script (CONNECT + USAGE + SELECT on catalogs only); referenced by `PermissionError` |
| `test/fixtures/pg/torture.sql` | New | Committed PG torture schema (matview/partial index/plpgsql function/trigger/sequence/generated column/comment) |
| `test/` integration + e2e | New | Testcontainers extract → golden `RawCatalog`; full E2E to the query layer (gated `DBGRAPH_INTEGRATION=1`) |
| `package.json` | Modified | `pg` as `optionalDependency` (ADR-002/006, pre-approved); `testcontainers` already present |
| `.github/workflows/` | Modified | Gated `pg-integration` job (service/Testcontainers; never blocks the unit matrix) |
| `docs/stories/05-adapters.md` | Modified | Refine US-028 (split note, matview & `pg_depend` deferrals) + add US-028a/b sub-stories below |

## User Stories — refine E5 / US-028 (for the spec phase to finalize scenarios)

> US-028 (PostgreSQL adapter, Phase 8) ALREADY EXISTS in `docs/stories/05-adapters.md` (status `☐ pending`).
> It currently bundles `pg_depend` dependencies and lists materialized views without a kind decision. This
> change REFINES US-028 to PostgreSQL-only and encodes the LOCKED scope decisions, plus proposes two thin
> sub-stories so 8a's "shared tokenizer" and "matview-as-view" decisions are individually testable. Project
> story format preserved; the spec phase writes the acceptance scenarios.

- **US-028 (refined) — PostgreSQL adapter (Phase 8a).** Scope narrowed to PostgreSQL ONLY (MySQL → US-029 /
  `phase-8b-mysql`). Encode: materialized views extracted as `kind: 'view'` + `extra.materialized: true`;
  dependencies via the BODY tokenizer (`confidence: parsed`, `supportsDependencyHints: false`) — `pg_depend`
  deferred; `docs/permissions/pg.md` minimal read-only role; `host/port/database/user/password` (+ssl)
  connectivity. **Depends on:** US-027. **Status:** ☐ pending.
- **US-028a (new) — Shared body-tokenizer module.** **As** the project, **I want** the read/write
  body-tokenizer primitives (`canonicalizeQName`/`classifyAccess`/`extractWriteTargets`) factored into
  `engines/_shared/tokenizer-core.ts` with PG and MSSQL each supplying their own dialect quoting and
  `hasDynamicSql` pattern, **so that** `phase-8b-mysql` reuses them with no duplication and MSSQL goldens stay
  byte-identical. **Phase:** 8a · **Depends on:** US-027 · **Status:** ☐ pending.
- **US-028b (new) — Materialized views without a model change.** **As** a PostgreSQL user, **I want**
  materialized views indexed as views flagged `extra.materialized: true`, **so that** they appear in the graph
  WITHOUT a new `NodeKind` (first-class promotion deferred). **Phase:** 8a · **Depends on:** US-006 ·
  **Status:** ☐ pending.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Matview gap — emitting matviews as `view`+`extra.materialized` loses a real distinction | Med | DECISION locked: no core-model churn now; `extra.materialized` is queryable; first-class kind tracked as a deferred follow-up so the signal is not lost |
| `pg_depend` complexity tempts scope creep into OID-graph edges | Med | DECISION locked: `supportsDependencyHints: false`, body tokenizer only (same `confidence: parsed` as today); `pg_depend` explicitly deferred — keeps 8a bounded |
| Read-only model leaks (someone adds a `SET SESSION READ ONLY` workaround) | Med | DECISION locked: minimal-privilege ROLE per `docs/permissions/pg.md` (no driver/session flag); write-verb engines scanner stays green; catalog SELECTs only |
| The PINNED `UnsupportedDialectError` test breaks when the message changes | High | Treat the message as a contract: update the message AND its golden/assertion in the SAME batch; verify exit-code mapping (`exit-code.ts` maps it to code 4) unchanged |
| plpgsql `EXECUTE` mis-classified vs `EXECUTE FUNCTION` in `CREATE TRIGGER` | Med | Tokenizer `hasDynamicSql` matches plpgsql dynamic `EXECUTE` (statement form), NOT the trigger DDL `EXECUTE FUNCTION` clause; torture fixture covers both so the golden pins the distinction |
| Testcontainers needs Docker (some contributors lack it) | Med | Gate behind `DBGRAPH_INTEGRATION=1`; skip-with-reason locally; the `pg-integration` CI job never blocks the unit matrix (mirrors the Phase-3 gated pattern) |
| `_shared/` refactor accidentally perturbs MSSQL behavior | Low | Pure move of pure functions; MSSQL goldens re-run unchanged in the same batch as the extraction; behavior parity asserted before PG consumes `_shared/` |
| `pg` driver SSL/auth surface differs from `mssql` | Low | `pg`'s connectivity is simple (host/port/db/user/password + `ssl`); no external-tool machinery; `error-mapper.ts` maps `SQLSTATE` (`28P01` auth, `42501` privilege) to typed errors |

## Rollback Plan

Fully additive — no Phase 1/2/3 contract changes. Revert by deleting `src/adapters/engines/pg/`, reverting
the `mssql/tokenizer.ts` refactor and removing `engines/_shared/tokenizer-core.ts`, removing the `pg` entries
from the 6 dispatch touch points (`SchemaAdapterConfig` union, `SUPPORTED_DIALECTS`, `parse-config.ts` branch,
`open-connections.ts` wiring, `capabilitiesFor`/barrel, `UnsupportedDialectError` message), deleting
`docs/permissions/pg.md`, the PG fixtures/tests and the `pg-integration` CI job, and dropping the `pg`
`optionalDependency`. Existing core, storage, normalization, query, the SQLite adapter and the MSSQL adapter
(with its tokenizer behavior restored) remain untouched and green.

## Dependencies

- `pg` — `optionalDependency`, lazy dynamic `import()` (ADR-006); PRE-APPROVED on the ADR-002/006 closed
  driver list; installing it is part of this change. NO other new runtime deps.
- `testcontainers` — `devDependency`, already present from Phase 3.
- Builds on the ARCHIVED `phase-3-sqlserver-adapter` (2026-06-16) template: the `SchemaAdapter` port,
  `MssqlSchemaAdapter` structure, the body tokenizer (now factored to `_shared/`), the per-engine
  permission-doc pattern, and the gated-integration CI pattern.
- Consumes UNCHANGED: `CapabilityMatrix`, `ExtractionScope`, `RawCatalog`, `RawObject`, `RawDependency`,
  `normalizeCatalog`, `SqliteGraphStore`, the query API, the `Logger` port, and the existing
  `ConnectionError`/`PermissionError` typed errors.
- The shared tokenizer created here is the SOLE artifact the pre-planned `phase-8b-mysql` change consumes.

## Recommended Apply Batch Ordering (for the future apply phase)

1. Extract `engines/_shared/tokenizer-core.ts` from `mssql/tokenizer.ts`; refactor MSSQL to import it; re-run
   MSSQL goldens to prove byte-identical behavior (no PG code yet).
2. `PG_CAPABILITIES` (`capabilities.ts`) + `PgAdapterConfig` on the union + `PgSource` config shape +
   `parse-config.ts` `pg` branch (config plumbing, no live connection).
3. `driver.ts` (lazy `import('pg')`) + `error-mapper.ts` (`SQLSTATE` → typed errors) + `factory.ts`
   (`createPgSchemaAdapter`).
4. `queries.ts` (catalog SELECTs) + `map.ts` (rows → `RawObject`/`RawCatalog`, matview → `view`+
   `extra.materialized`, deterministic/sorted) + body tokenization via `_shared/` (PG `EXECUTE` dynamic-SQL).
5. The remaining dispatch touch points: `open-connections.ts` wiring, `capabilitiesFor`/barrel re-export, and
   the `UnsupportedDialectError` message + its pinned assertion (same batch).
6. `docs/permissions/pg.md` (minimal read-only role) + `PermissionError` doc-link wiring.
7. `test/fixtures/pg/torture.sql` + Testcontainers `postgres:16` extract → golden `RawCatalog` → normalize →
   upsert → query E2E; the gated `pg-integration` CI job; write-verb scanner + boundary/read-only sweep; lint.

## Success Criteria

- [ ] `PgSchemaAdapter` implements the EXISTING `SchemaAdapter` port (no port SHAPE change) and is wired via
      `createPgSchemaAdapter` through the composition root.
- [ ] Extracts a PostgreSQL torture schema into a coherent `RawCatalog`: schemas, tables/columns/types/
      defaults/identity & generated columns, PK/FK/unique/CHECK, indexes (incl. partial/expression), views,
      materialized views (`kind: 'view'` + `extra.materialized: true`), functions, procedures, triggers
      (event+timing via `EXECUTE FUNCTION`), sequences, comments.
- [ ] `reads_from`/`writes_to` classified from `pg_get_functiondef`/`pg_get_viewdef` bodies at
      `confidence: 'parsed'`; plpgsql dynamic `EXECUTE` marks `hasDynamicSql: true`;
      `supportsDependencyHints: false` (body tokenizer only; `pg_depend` deferred).
- [ ] `PG_CAPABILITIES` is truthful: supports schema/table/column/constraint/index/view/procedure/function/
      trigger/sequence; `supportsBodies: true`; `supportsDependencyHints: false` — 100% matrix coverage.
- [ ] Shared `engines/_shared/tokenizer-core.ts` created and consumed by both MSSQL and PG; MSSQL goldens
      byte-identical after the refactor.
- [ ] Connectivity via host/port/database/user/password (+ optional ssl); `password` is `${env:VAR}` env-only;
      `schema?` optional (default = all non-system schemas; when set, scopes to that schema).
- [ ] `docs/permissions/pg.md` ships the minimal read-only role; a missing privilege raises an actionable
      `PermissionError` naming the privilege + doc (US-033 for pg); no `SET SESSION READ ONLY` workaround.
- [ ] `fingerprint()` returns a cheap (one-query) value that moves on DDL and is stable across data-only changes.
- [ ] Determinism (ADR-008): the `RawCatalog` is deterministic and golden-pinned in CI.
- [ ] The write-verb scanner over `src/adapters/engines/**` stays green (catalog SELECTs only).
- [ ] NO new runtime deps beyond the optional `pg`; `tsc`/lint/test clean; CI green including the gated
      `pg-integration` job (`DBGRAPH_INTEGRATION=1`), which never blocks the unit matrix.
- [ ] The pinned `UnsupportedDialectError` message updated to list `sqlite, mssql, pg` with its assertion and
      the exit-code mapping (code 4) verified unchanged.
- [ ] US-028 refined to PostgreSQL-only with US-028a/US-028b added to `docs/stories/05-adapters.md`;
      `phase-8b-mysql` recorded as the pre-planned next change (zero carry-over).
