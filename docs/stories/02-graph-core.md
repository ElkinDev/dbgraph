# E2 — Graph core

Goal: the hexagonal heart — model, normalization, queries. ALL of it under strict TDD.
Plan references: §4.2 (model), §4.4 (storage), Phase 1.

---

### US-006 — Catalog → graph normalization
**As** the core, **I want** to convert any `RawCatalog` into dialect-agnostic nodes and edges, **so that** queries work the same across the 5 engines.
**Phase:** 1 · **Depends on:** — (first implementable story) · **Status:** ☑ done (phase-1-graph-core)

**Acceptance criteria:**
- Given the `catalog-minimal.json` fixture (2 tables, 1 FK, 1 view, 1 trigger), when normalizing, then the graph contains the expected `table`/`column`/`view`/`trigger` nodes, 1 `references` edge, 1 `depends_on` and 1 `fires_on` (golden file).
- Given a composite FK (2 columns), then it produces one `references` edge per column pair and ONE aggregated table→table edge.
- Given a catalog with a reference to a missing object (view over a dropped table), then it does not fail: it creates a stub node `missing: true` and reports it in the normalization result.
- The normalizer imports NOTHING outside `src/core` (enforced by the boundary lint rule).

### US-007 — Read/write edges
**As** an AI agent, **I want** to know which procedures and triggers READ vs WRITE each table, **so that** I can assess the real risk of a change.
**Phase:** 1 (model) + 3 (real extraction) · **Depends on:** US-006 · **Status:** ☑ done (extraction half — phase-3-sqlserver-adapter Batch D remediation; model/storage/query done in phase-1-graph-core)

**Acceptance criteria:**
- Given a proc whose body does `INSERT INTO a` and `SELECT FROM b`, then `writes_to(proc→a)` and `reads_from(proc→b)` exist with `confidence: parsed`. ✓ (verified by sp_place_order in extract.integration.test.ts + endpoint qname assertions)
- Given an `AFTER UPDATE` trigger on `orders` that writes to `audit`, then `fires_on(trigger→orders, event=UPDATE)` exists AND `writes_to(trigger→audit_log, confidence:parsed)` exists. ✓ (BOTH verified empirically against live SQL Server 2022 container; fires_on dst = dbo.orders; writes_to(trg→audit_log) confirmed; endpoint assertions in e2e.integration.test.ts and extract.integration.test.ts)
- Given non-analyzable dynamic SQL, then the module is marked `has_dynamic_sql: true`. ✓ (sp_dynamic_search verified in extract.integration.test.ts)

_Note (mssql Batch D, 2026-06-16): The previously recorded "sys.sql_expression_dependencies limitation" (L-008) was a FALSE NEGATIVE — the dep view DOES track trigger DML targets on SQL Server 2022. Both fires_on and writes_to(trigger→audit_log) are now fully asserted. See corrected L-008 in docs/learnings.md._

### US-008 — Inferred relationships with confidence
**As** a user of a legacy database or NoSQL without declared FKs, **I want** relationships inferred from naming conventions and types, **so that** the graph is not empty of edges.
**Phase:** 9a (shared pure-core inference engine; consumed by 9b MongoDB) · **Depends on:** US-006 · **Status:** ◐ in-progress (phase-9a-inference-engine — pure-core scorer, opt-in gate, determinism; MongoDB sampling + turning inference ON deferred to phase-9b-mongodb)

**Acceptance criteria:**
- Given `orders.customer_id` (int) and `customers.id` (int, PK) WITHOUT a declared FK, then an `inferred_reference` exists with score ≥ 0.8 (convention + compatible type + PK target). Asserted with EXACT src+dst qnames + score (L-009 exact-set, never existence-only).
- Given `orders.status_id` with no existing `status*` table, then NO edge is invented (negative golden; thresholded).
- Type compatibility gates edges: int↔bigint compatible, `ObjectId`↔`_id` compatible, string↔string; an incompatible type family yields NO edge.
- Every inferred edge carries `confidence: inferred` and a numeric `score ∈ [0,1]`; emitted ONLY when score ≥ threshold; MCP tools ALWAYS render them distinguished from declared ones (`?` suffix).
- Covers conventions: `<entity>_id`, `<entity>Id`, `id_<entity>`, singular/plural — each asserted with exact src+dst qnames.
- Inference is OPT-IN via `ExtractionScope.inferRelationships` (default OFF): with the gate OFF (and no `collection`/`field` nodes) re-normalizing an existing SQL fixture yields an edge array BYTE-IDENTICAL to its golden (the four shipped engines untouched).
- Determinism: the same input `NodeMap` yields a byte-identical inferred-edge array across runs (ordered by `src`, `dst`, `score`, `srcColumn`, `id`); golden-pinned (ADR-008).
- The inference engine (`src/core/infer/`) imports nothing outside the core model types and reads only node names/types — never raw data values (ADR-004, dbgraph-security).

### US-009 — Snapshots and drift fingerprint
**As** a user, **I want** dbgraph to detect whether the real schema changed since the last sync, **so that** I never work with a stale graph unknowingly.
**Phase:** 1 (storage) + 3 (per-engine fingerprint) · **Depends on:** US-006 · **Status:** ☐ partial (storage schema/model done in phase-1-graph-core — putSnapshot/listSnapshots implemented; SQLite fingerprint done in phase-2-sqlite-extraction — `PRAGMA schema_version` sha256 verified stable on DML, moves on DDL; mssql fingerprint done in phase-3-sqlserver-adapter — sha256(MAX(modify_date)|COUNT(*)) verified stable on DML, changes on CREATE TABLE in fingerprint.integration.test.ts)

**Acceptance criteria:**
- Every sync persists a snapshot with timestamp, engine version, fingerprint and per-type counts.
- Given a schema modified after the last sync, when querying `dbgraph_status`/`dbgraph status`, then it reports `drift: true` with the index age.
- The fingerprint computation runs ONE cheap catalog query (it does not walk all objects).
- `dbgraph diff snapA snapB` lists objects added/removed/modified between two snapshots.
