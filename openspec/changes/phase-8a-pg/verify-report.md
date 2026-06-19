# Verification Report -- phase-8a-pg (PostgreSQL schema-extraction adapter)

**Change**: phase-8a-pg
**Mode**: Strict TDD (orchestrator-injected; authoritative)
**Date**: 2026-06-18
**Verdict**: FAIL -- 1 CRITICAL behavioral defect (phantom dependency edges) blocks archive. Gate is green but pins incorrect output.

---

## Gate Execution (all run; exact results)

- Type check: `npx tsc --noEmit` -> PASS (exit 0)
- Lint: `npm run lint` (eslint) -> PASS (exit 0, 0 errors / 0 warnings)
- Unit suite: `npm test` (vitest run) -> PASS, 1732 passed / 113 files / 0 failed (exit 0)
- Integration: `DBGRAPH_INTEGRATION=1 npm run test:integration` vs real postgres:16 -> PASS, 128 passed / 8 files / 0 failed (exit 0)

The gate is GREEN. CRITICAL-1 below is a correctness defect the tests do not detect because every edge assertion is existence-only (positive find().toBeDefined()), never absence -- which the spec L-009 principle warns is insufficient.

---

## Scrutiny Point 1 (highest priority) -- VERDICT: DIVERGENCE, escalated to a broader CRITICAL

Question: PG buildRoutines suppresses ALL dependency edges when hasDynamicSql is true. Does MSSQL keep static edges (divergence) or also suppress-all (consistent)?

Answer with file evidence:
- MSSQL buildModules (src/adapters/engines/mssql/map.ts:561-574) emits hasDynamicSql and dependencies INDEPENDENTLY -- it does NOT suppress edges when dynamic SQL is present.
- BUT MSSQL edge source is the catalog-curated sys.sql_expression_dependencies list (deps param). For a dynamic-SQL module SQL Server tracks NO dependencies (cannot see into the dynamic string), so deps is empty -> zero edges. MSSQL torture golden confirms: sp_dynamic_search -> hasDynamicSql:true with NO dependencies array (test/fixtures/mssql/golden/golden-raw-catalog.json).
- So MSSQL de-facto behavior on a pure-dynamic routine matches PG suppress-all OUTCOME, but for a structurally different reason (no catalog deps vs explicit suppression).

On the specific divergence asked (routine with BOTH reliable static reads/writes AND dynamic SQL): PG suppress-all WOULD drop reliable static edges. However the torture fixture only dynamic routine (app.fn_dynamic_search) has ALL its object references INSIDE the format(... app.orders ...) dynamic string and NO static reads/writes outside it -- so suppress-all loses nothing reliable in THIS fixture, and fn_dynamic_search correctly emits hasDynamicSql:true with no edges. The suppress-all policy is DEFENSIBLE in isolation (WARNING-level on its own).

BUT investigating point 1 surfaced a far more serious, golden-pinned defect in the NON-dynamic path -- see CRITICAL-1. The suppress-all branch is actually the ONLY thing preventing the phantom-edge pollution (CRITICAL-1) from also corrupting dynamic routines; it masks the real bug rather than being the bug.

---

## Issues Found

### CRITICAL

CRITICAL-1 -- PG fabricates a reads_from edge from every routine/view to EVERY table+view in the database (phantom edges + self-references).

Where:
- src/adapters/engines/pg/map.ts:691-694 (buildPgRawCatalog) and :567-570 (buildRoutines) build potentialDeps = ALL tables + ALL views, then pass that whole set to tokenizePgBody for every routine/view.
- src/adapters/engines/_shared/tokenizer-core.ts:118-138 (classifyAccess) returns write if the target is a write operand, else read UNCONDITIONALLY. It NEVER checks whether the target actually appears in the body. Not-a-write is treated as is-a-read.

Observed (golden-pinned in test/fixtures/pg/golden/golden-raw-catalog.json) -- every routine/view has exactly 6 deps (= the 6 tables+views in the catalog):
- reporting.v_order_summary (body reads only orders + order_items): phantom reads_from to audit_log, products, mv_product_stats, and ITSELF (v_order_summary).
- reporting.mv_product_stats (reads only products + order_items): phantom reads to audit_log, orders, v_order_summary, and ITSELF.
- app.proc_cancel_order (only UPDATE app.orders): correct write to orders + 5 phantom reads.
- app.audit_fn (only INSERT app.audit_log): correct write to audit_log + 5 phantom reads.
- app.fn_place_order (writes orders+order_items, reads products): correct on those 3 + 3 phantom reads (audit_log, mv_product_stats, v_order_summary).

Downstream blast radius: the E2E golden (golden-e2e.json) pins edgeCount:68 and stubCount:2 -- phantom edges inflate the persisted graph and create 2 spurious stub nodes that flow into impact/path query results.

Spec violation: pg-extraction Parsed reads_from and writes_to requires reads ONLY for objects the body actually reads (scenario: a reads_from edge from the view to b AND to c, its base tables, NOT every object). The classification MUST be conservative; fabricating a read to every object is the opposite of conservative. Also violates L-009 (correct endpoints) -- destinations are wrong en masse.

Why MSSQL is clean: MSSQL feeds tokenizeModuleDeps only catalog-confirmed deps (sys.sql_expression_dependencies), so the read-default is only ever applied to real dependencies. MSSQL golden shows v_order_summary -> exactly order_items + orders. PG, with supportsDependencyHints:false, has no such filter and misuses classifyAccess as a membership test it was never designed to be.

Why no test caught it: every PG edge assertion (unit map.test.ts:293-303, 327-335; integration extract.integration.test.ts:280-314) uses positive find(...).toBeDefined() for the edges it wants and asserts neither the dep COUNT nor the ABSENCE of phantom edges. The spec explicitly warns this is insufficient (L-009).

Concrete fix (choose one):
1. In tokenizePgBody/classifyAccess, only emit an edge for a target whose canonicalized qname (qualified OR simple name) actually appears in the canonicalized body as a read or write operand; targets absent from the body get NO edge (drop, do not default to read).
2. OR pre-filter potentialDeps in map.ts to the set of object names that textually occur in the body before calling the tokenizer.
Re-bless both PG goldens after the fix and add a negative assertion (exact dep set, or no self-reference, or dep length) so the regression is pinned.

### WARNING

WARNING-1 -- Suppress-all on hasDynamicSql is a behavioral divergence from MSSQL that will lose reliable static edges once CRITICAL-1 is fixed.
- Where: src/adapters/engines/pg/map.ts:572-577 -- when result.hasDynamicSql is true, dependencies is left undefined (all edges dropped).
- Once CRITICAL-1 is fixed so edges reflect only real body references, a routine with BOTH a reliable static INSERT INTO a AND a dynamic EXECUTE will STILL have its reliable writes_to a edge dropped by this branch. The spec scenario (NO speculative edge fabricated for the dynamic portion) implies the STATIC portion edges should survive. MSSQL keeps catalog-confirmed static edges alongside hasDynamicSql:true.
- Currently MASKED because the fixture only dynamic routine has no static edges to lose. Fix: after fixing CRITICAL-1, keep edges proven by static operands and only additionally flag hasDynamicSql:true, OR add a design note + spec scenario ratifying PG suppress-all as an intentional divergence.

WARNING-2 -- Restricted-role negative integration test is acknowledged-missing.
- Where: docs/stories/06-security.md:35 marks PENDING: a user WITHOUT USAGE receiving the actionable PermissionError is not yet exercised in integration. The error-mapper.ts unit test pins the 42501 -> PermissionError + docs/permissions/pg.md mapping, and full extraction under the superuser passes, so the positive scenario is met. The negative scenario is proven only at the unit level (synthetic SQLSTATE), not end-to-end.
- Fix: add a gated integration test connecting as a role lacking USAGE/catalog SELECT and assert the typed PermissionError. Non-blocking for archive but should be tracked.

### SUGGESTION

SUGGESTION-1 -- PgAdapterConfig.ssl is richer than the design. src/core/ports/schema-adapter.ts:82 types ssl as boolean OR an object with rejectUnauthorized; design specified boolean only. Benign enhancement; update the design table to match.

SUGGESTION-2 -- fingerprint marker is MAX(pg_class.oid)+COUNT(*) only. queries.ts:351-361 (SQL_PG_FINGERPRINT) omits the pg_attribute.attnum component the design (line 127) suggested. Integration proves it moves on CREATE TABLE and is stable across DML, but ALTER TABLE ADD COLUMN that adds no new relation oid may not move MAX(oid)/COUNT(*). The spec scenario fingerprint changes on DDL change (adding a column or object) is currently proven only for adding an object, not adding a column. Consider an attribute-level component.

---

## Spec Compliance Matrix (behavioral -- test-backed)

| Requirement | Test (passed) | Result |
|---|---|---|
| Extract schemas (default + scoped) | extract.integration.test.ts schema/scope assertions | COMPLIANT |
| Tables/columns (type/nullability/default) | map.test.ts + integration | COMPLIANT |
| Identity column | map.test.ts + integration audit_log IDENTITY | COMPLIANT |
| Generated column | map.test.ts + integration order_items GENERATED | COMPLIANT |
| PK/FK/unique/CHECK (single+composite+predicate) | map.test.ts constraint suite + integration | COMPLIANT |
| Indexes (partial/expression/included) | map.test.ts index suite + integration | COMPLIANT |
| Views + matviews (kind:view + extra.materialized) | map.test.ts + integration mv assertion | COMPLIANT |
| Functions/procedures (distinguishable, level-gated) | map.test.ts + integration | COMPLIANT |
| Triggers (event + timing via tgtype) | map.test.ts tgtype decode + integration | COMPLIANT |
| Trigger fires_on parent table (no phantom stub) | map.test.ts + integration trigger.table + no-phantom-stub | COMPLIANT |
| Sequences | map.test.ts + integration | COMPLIANT |
| Comments (obj_/col_description) | map.test.ts + integration COMMENT ON | COMPLIANT |
| CapabilityMatrix | capabilities.test.ts | COMPLIANT |
| Parsed reads_from/writes_to (reads ONLY base tables) | map.test.ts/integration edge asserts | FAILING (CRITICAL-1): writes + intended reads correct, but every routine/view ALSO emits phantom reads to every object incl self; tests existence-only so they pass while behavior is wrong |
| Trigger fires_on + body effects (audit_fn writes A) | golden | PARTIAL: audit_fn correctly writes audit_log but also has 5 phantom reads (CRITICAL-1) |
| Dynamic SQL flagged; EXECUTE FUNCTION not dynamic | tokenizer.test.ts both directions + integration | COMPLIANT |
| fingerprint one cheap query (DDL changes / DML stable) | extract.integration.test.ts fingerprint suite | COMPLIANT (see SUGGESTION-2 re add-column) |
| Read-only (catalog SELECTs only; no SET SESSION) | security-scan.test.ts engines + grep | COMPLIANT |
| Minimal read-only role doc | docs/permissions/pg.md present | COMPLIANT (positive); negative restricted-user E2E pending (WARNING-2) |
| PermissionError actionable (names privilege + doc link) | error-mapper.test.ts | COMPLIANT (unit); E2E pending (WARNING-2) |
| Connectivity host/port/ssl, env-only password | parse-config.test.ts + error-mapper.test.ts | COMPLIANT |
| Missing pg driver names npm i pg | factory.test.ts | COMPLIANT |
| Torture fixture via Testcontainers (reviewable .sql; gated) | torture.sql + container.ts; skipIf | COMPLIANT |
| Golden RawCatalog + E2E pipeline (byte-identical; gated CI) | extract/e2e integration goldens | COMPLIANT mechanically -- but golden pins the CRITICAL-1 phantom edges as expected |
| SchemaAdapterConfig union + pg variant (structural, host-discriminated) | unit suite | COMPLIANT |
| Supported dialects + UnsupportedDialectError + exit 4 | errors.ts:108 + exit-code regression test | COMPLIANT |
| Shared tokenizer-core; MSSQL byte-identical | Batch-1 gate; MSSQL goldens + integration green | COMPLIANT |

Compliance summary: 24/26 requirement-groups fully COMPLIANT. 2 groups (Parsed reads_from/writes_to; Trigger body effects) FAILING/PARTIAL due to CRITICAL-1.

---

## Correctness (structural) -- scrutiny points 2-10

| # | Check | Status | Evidence |
|---|---|---|---|
| 2 | No pg/strategies/ tree | PASS | ls src/adapters/engines/pg/ -- no strategies dir; thin factory + class |
| 3 | SchemaAdapterConfig union structural, host-discriminated, members unchanged | PASS | schema-adapter.ts:76-92 |
| 4 | UnsupportedDialectError lists sqlite, mssql, pg; exit-code.ts instanceof maps to 4 untouched; guarded | PASS | errors.ts:108; exit-code.ts:55 (phase-4 header intact); exit-code test green |
| 5 | Matview to kind:view+extra.materialized (no new NodeKind); supportsDependencyHints:false; EXECUTE vs EXECUTE FUNCTION | PASS | node.ts has no materialized_view; capabilities.ts:38; tokenizer.ts:69-77 + both-direction tests |
| 6 | No SET SESSION READ ONLY; docs/permissions/pg.md matches error-mapper path; scanner green over pg/queries.ts | PASS | grep empty; error-mapper.ts:66 to doc path; security-scan green |
| 7 | Determinism (ADR-008): golden OID-free + byte-stable | PASS | golden-raw-catalog.json has no oids; second-extract byte-identical test passes |
| 8 | pg in optionalDependencies (not dependencies); lazy import; no other new runtime dep | PASS | package.json:44-47 (pg ^8.21.0 under optionalDependencies); no top-level pg import; dynamic import in factory |
| 9 | US-028 refined PG-only, US-028a + US-028b present/satisfied; no postgres.md literal | PASS | docs/stories/05-adapters.md:42-67; grep postgres.md empty |
| 10 | Pipeline unchanged; MSSQL goldens byte-identical post-_shared refactor | PASS | E2E uses normalizeCatalog/SqliteGraphStore/query as-is; MSSQL unit + integration green |

---

## Coherence (Design)

- Thin class + direct PgReadonlyDriver seam (no strategy registry): Yes (#2).
- host-keyed structural union: Yes (schema-adapter.ts:92).
- Minimal-privilege role, no SET SESSION READ ONLY: Yes (doc + grep, #6).
- Matview = kind:view + extra.materialized: Yes (#5).
- Dynamic-SQL boundary EXECUTE statement vs EXECUTE FUNCTION clause: Yes (tokenizer.ts + both-direction tests).
- Body tokenizer is SOLE edge source (supportsDependencyHints:false): Yes but MISUSED -- design did not anticipate that, without a catalog dep filter, the read-default fabricates edges to every object (CRITICAL-1). Determinism met; edge SEMANTICS are not.
- ssl: boolean -> deviated (benign), now boolean OR object (SUGGESTION-1).
- fingerprint marker -> partial, MAX(oid)+COUNT(*) only; attnum omitted (SUGGESTION-2).

---

## Completeness

All 42 numbered tasks (Batches 1-7) + 13 Definition-of-Done items are checked [x]; 0 incomplete. Code state matches (7 commits, one per batch, clean working tree on branch phase-8a-pg). Checkmarks are accurate at the structural level; tasks 4.4 / 7.3 / 7.6 claim parsed edges correct while the golden they pinned encodes the CRITICAL-1 phantom edges -- the checkmark reflects golden seeded and byte-stable, not edges semantically correct.

---

## Final Verdict

FAIL -- All four gates are green and 24/26 requirement-groups are fully compliant, but CRITICAL-1 (every routine/view fabricates a reads_from edge to every table+view in the database, including self-references) is a real, golden-pinned correctness defect that directly violates the Parsed reads_from/writes_to requirement and L-009, and pollutes the persisted graph (E2E edgeCount:68, stubCount:2). It must be fixed (and the goldens re-blessed with a negative/exact-set assertion) before archive. Scrutiny 1 suppress-all is a defensible-but-divergent WARNING that currently masks, rather than causes, the defect.
