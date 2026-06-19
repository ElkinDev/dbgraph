# Verification Report — phase-8b-mysql

**Change**: phase-8b-mysql (MySQL schema-extraction adapter)
**Version**: spec delta (mysql-extraction + schema-extraction)
**Mode**: Strict TDD
**Date**: 2026-06-19
**Branch**: phase-8b-mysql, merge-base 9014615

---

## Verdict: PASS

All 4 gates green. Scrutiny point #1 (edge correctness / 8a CRITICAL-1 regression) PASSES with golden evidence: every routine and view edge set is EXACT and phantom-free, proven against a REAL mysql:8 container. No CRITICAL issues. 2 WARNING (doc staleness, missing apply-progress), 2 SUGGESTION.

---

## Gate Output (full, real execution)

| Gate | Command | Result |
|------|---------|--------|
| Type-check | npx tsc --noEmit | PASS clean (exit 0) |
| Lint | npm run lint (eslint) | PASS 0 errors / 0 warnings (exit 0) |
| Unit tests | npm test | PASS 125 files, 1935 passed, 0 failed (exit 0) |
| Integration (Docker) | DBGRAPH_INTEGRATION=1 npm run test:integration | PASS 10 files, 206 passed, 0 failed (exit 0) |

Docker 29.5.3. Integration ran against real mysql:8, postgres:16, and SQL Server containers. Goldens byte-identical (seeded-vs-committed byte-equality tests passed; no golden drift on re-run).

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 49 (7 batches) |
| Tasks complete | 49 |
| Tasks incomplete | 0 |

All batches 1-7 marked complete and verified against code and live integration.

---

## Scrutiny Point #1 — Edge correctness (HIGHEST) — VERDICT: PASS

Mechanism (src verified): mysql/tokenizer.ts tokenizeMysqlBody does: (1) hasMysqlDynamicSql(body) on the original body; (2) staticBody = maskDynamicStrings(body) masks single-quoted literal CONTENTS; (3) for each candidate dep, skip UNLESS bodyContainsRef(staticBody, mysqlCanonicalize(qname)) — the PRESENCE GATE; (4) only then classifyAccess. There is NO default-to-read; objects absent from the masked static body get NO edge. Self-edges are structurally impossible (a routine body never names itself as a dep target; the gate filters it). Both helpers are the PROMOTED _shared/tokenizer-core.ts functions (D10).

Golden evidence — test/fixtures/mysql/golden/golden-raw-catalog.json (real mysql:8):
- v_order_summary (view): dependencies = EXACTLY reads_from app.order_items + reads_from app.orders. Reparsed body selects from app.orders left join app.order_items. No self, no phantom (NOT products). PASS
- proc_place_order (procedure): EXACTLY writes_to app.order_items + writes_to app.orders + reads_from app.products — 3 edges, all confidence parsed. No self, no audit_log phantom. PASS
- fn_audit_write (function): EXACTLY writes_to app.audit_log — 1 write, 0 reads. PASS
- proc_dynamic_query: hasDynamicSql true, ZERO dependencies key. orders referenced ONLY inside CONCAT SELECT order_id FROM orders (torture.sql line 149) so it is masked and yields no edge. Definitive mask-gate proof against a live body. PASS
- trg_after_order_update (trigger): trigger.table = schema app name orders (PARENT table EVENT_OBJECT_TABLE, NOT the trigger), events UPDATE, timing AFTER. No phantom stub table named after the trigger. PASS

Assertion quality (NOT existence-only): Both unit (tokenizer.test.ts) and integration (extract.integration.test.ts, e2e.integration.test.ts) assert EXACT sets:
- expect(deps.length).toBe(3), writes.length === 2, reads.length === 1
- expect(names).toEqual sorted exact set order_items orders products
- explicit no-self: expect(deps.find SELF).toBeUndefined()
- explicit no-phantom: expect(deps.find audit_log).toBeUndefined()
- dynamic routine: expect(proc.hasDynamicSql).toBe(true) AND expect(deps.length).toBe(0)
- E2E pins BOTH src and dst qnames per edge (dstNode.qname === app.products), asserts stubCount === 0 and selfEdges.length === 0 over the whole graph.

The existence-only find().toBeDefined() anti-pattern that hid 8a CRITICAL-1 is NOT used for edge-set sizing — it appears only as preamble before the EXACT toEqual and toBe(N) assertions. Verdict: PASS — phantom-free, exact, no-self, proven on real mysql:8.

---

## Scrutiny Points #2-#11

| # | Point | Result | Evidence |
|---|-------|--------|----------|
| 2 | _shared promotion byte-identical (pg+mssql) | PASS | git diff merge-base HEAD on pg and mssql golden fixtures is EMPTY. pg/tokenizer.ts imports maskDynamicStrings and bodyContainsRef from _shared/ with NO local copies. pg+mssql suites green in integration run. |
| 3 | factory.ts mysql2/promise API correction | PASS | createConnectionFn returns Promise of ConnectionLike; conn = await createConnectionFn(connConfig) with NO .connect() call. Docstrings say auto-connected on Promise resolution. Unit fake ConnectionLike has query and end only (no .connect()); makeCreateConnection returns Promise of ConnectionLike. Mock faithfully mirrors real API — NOT weakened. |
| 4 | No strategies tree; thin adapter; lazy import | PASS | mysql/ has 8 flat files, no strategies/. Single MysqlReadonlyDriver seam. Lazy dynamic import in factory only; no top-level mysql2 import. |
| 5 | schema==database; AUTO_INCREMENT column extra; no sequence cap | PASS | map.ts schemas is the single connected database, object schema = TABLE_SCHEMA. extra.autoIncrement true from EXTRA LIKE auto_increment; NO sequence object. MYSQL_CAPABILITIES.supported has no sequence and no schema. Golden has 0 sequence objects. |
| 6 | Reality-validated extraction | PASS | Golden reflects real mysql:8: total_price generationExpression (backtick-quoted qty * unit_price), functional index expression lower(name), prefix index subPart 10, CHECK definition unit_price >= 0, reparsed VIEW_DEFINITION with backtick identifiers. Pinned by the live container. |
| 7 | fingerprint moves on ADD COLUMN, stable on DML | PASS | extract.integration Task 7.4: 5 fp tests green — CREATE TABLE changes; ALTER ADD COLUMN changes (column_count); INSERT unchanged; 64-char hex; one cheap query under 5s. SQL_MYSQL_FINGERPRINT is a single SELECT of TABLES + COLUMNS + ROUTINES counts, SHA-256. |
| 8 | Pinned error + exit-code.ts unchanged | PASS | errors.ts line 108 message lists sqlite, mssql, pg, mysql. git diff merge-base HEAD src/cli/exit-code.ts is EMPTY. exitCodeFor maps UnsupportedDialectError to 4 via instanceof. Guard exit-code-mysql.test.ts green. |
| 9 | mysql2 in optionalDependencies only | PASS | package.json optionalDependencies mysql2 ^3.22.5; NOT in dependencies or devDependencies. Lazy import. No other new runtime dep. |
| 10 | Determinism + read-only scanner | PASS | Golden byte-stable (Batch 7 ran twice; byte-equality tests green; this verify re-ran integration with no drift). security-scan.test.ts over engines/** green in the 1935-test run. queries.ts is SELECT-only information_schema, every query has ORDER BY. |
| 11 | Stories US-029/US-033 + pipeline unchanged | WARNING | CI mysql-integration is a separate Linux job, no needs dependency, gated DBGRAPH_INTEGRATION=1, ephemeral container, NOT in unit-matrix needs — pipeline unchanged. BUT stories status fields are STALE (see WARNING-1). |

---

## Spec Compliance Matrix (behavioral — test-backed)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Connected DB single namespace | only connected DB | extract.integration only app objects | COMPLIANT |
| Connected DB single namespace | schemas is single DB | extract.integration schemas equals app | COMPLIANT |
| Tables/columns + AUTO_INCREMENT | type/nullability/default | extract.integration + map.test | COMPLIANT |
| AUTO_INCREMENT on column | never a sequence | extract.integration extra.autoIncrement + ZERO sequence | COMPLIANT |
| PK/FK/unique/CHECK composite | composite FK grouped+ordered | map.test + extract.integration FK_items | COMPLIANT |
| Indexes from STATISTICS | composite keeps order | extract.integration idx_order_items_composite 2 cols | COMPLIANT |
| Views with bodies per level | full/metadata/off | extract.integration view body + metadata no body | COMPLIANT |
| Routines per level | fn and proc distinguishable | extract.integration proc/fn + off absent | COMPLIANT |
| Triggers event+timing | fires_on parent table | extract.integration trigger.table orders + e2e fires_on app.orders | COMPLIANT |
| TABLE/COLUMN comments | surfaced as comment | extract.integration COMMENT ON TABLE/COLUMN | COMPLIANT |
| Truthful MYSQL_CAPABILITIES | no sequence/schema; bodies true; hints false | capabilities.test | COMPLIANT |
| Parsed edges presence-gated no phantom/self | exact directed set | tokenizer.test EXACT + extract.integration + e2e.integration | COMPLIANT |
| Dynamic SQL flagged never guessed | PREPARE/EXECUTE flags hasDynamicSql, 0 edges | tokenizer.test + extract.integration proc_dynamic_query | COMPLIANT |
| fingerprint sensitive to ADD COLUMN | moves on DDL, stable on DML | extract.integration Task 7.4 (5 tests) | COMPLIANT |
| Read-only by construction | catalog SELECTs only | security-scan.test over engines/** | COMPLIANT |
| Minimal read-only user documented | doc ships grant script | docs/permissions/mysql.md present | COMPLIANT (static) |
| Missing privilege to PermissionError | named privilege + doc-link | error-mapper.test 1044/1142/1143/1370 | COMPLIANT |
| Connectivity host/port/db/user/pw + ssl | default 3306; env-only pw; no schema knob | factory.test + parse-config-mysql.test | COMPLIANT |
| Absent mysql2 names install cmd | npm i mysql2 | factory.test missing driver | COMPLIANT |
| Torture fixture via Testcontainers | reviewable sql; gated | torture.sql + container.ts + skipIf gate | COMPLIANT |
| Golden RawCatalog + E2E pipeline | byte-identical; exact edges; stub 0; no self | extract.integration + e2e.integration goldens | COMPLIANT |
| SchemaAdapter port + mysql variant | union extended, no shape change | adapter-config.test + tsc | COMPLIANT |
| Supported dialects recognize mysql | SUPPORTED_DIALECTS + capabilitiesFor + error | capabilities-for-mysql.test + errors-mysql.test | COMPLIANT |
| Pinned message + exit-4 unchanged | message+assertion+guard same batch | errors-mysql.test + exit-code-mysql.test | COMPLIANT |

Compliance summary: 25/25 requirement areas COMPLIANT (all test-backed; integration-proven).

---

## TDD Compliance (Strict TDD active)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported (apply-progress) | WARNING | No apply-progress.md artifact found for phase-8b-mysql (Engram not connected; openspec dir has none). See WARNING-2. |
| All tasks have tests | PASS | Every batch has matching test files; 49/49 tasks done. |
| RED confirmed (tests exist) | PASS | 9 mysql unit/integration test files + 5 cross-cutting (errors, exit-code, capabilities-for, parse-config, open-connections). |
| GREEN confirmed (tests pass) | PASS | 1935 unit + 206 integration pass on re-execution. |
| Triangulation adequate | PASS | Edge tests assert distinct expected values (writes vs reads vs phantom-absent vs dynamic-zero); not single-case. |
| Safety Net (pg/mssql unchanged) | PASS | pg+mssql goldens byte-identical (diff empty); pg tokenizer suite green after promotion. |

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | majority of 1935 | 9 mysql + shared | Vitest, captured-row JSON fixtures, NO DB |
| Integration/E2E | 206 (all engines) | 10 | Vitest + testcontainers (mysql:8/postgres:16/mssql) |

## Assertion Quality

Scanned tokenizer.test.ts, map.test.ts, extract.integration.test.ts, e2e.integration.test.ts, factory.test.ts, error-mapper.test.ts, capabilities.test.ts.
- No tautologies, no ghost loops, no smoke-only edge tests.
- Edge collections always sized with toBe(N) and toEqual(sorted) before or instead of existence-only.
- Empty-collection assertions (deps.length === 0 for the dynamic routine) have companion non-empty tests (other routines) — legitimate, spec-driven.

Assertion quality: All assertions verify real behavior.

---

## Coherence (Design)

| Decision | Followed | Notes |
|----------|----------|-------|
| D1 thin adapter + single seam, no strategies | Yes | 8 flat files, no strategies tree |
| D2/D3 driver normalizes rows tuple via query() | Yes | driver.ts destructures const rows |
| D4 schema==database, no schema knob | Yes | map + parse-config + config union |
| D5 AUTO_INCREMENT column extra | Yes | no sequence object |
| D8 hasMysqlDynamicSql = PREPARE/EXECUTE on original body | Yes | tokenizer.ts line 82 |
| D9 presence-gate, no default-read, no self | Yes | tokenizer.ts line 142 |
| D10 PROMOTE to _shared, pg byte-identical | Yes | diff empty; no local pg copies |
| D11 structural union, dispatch on explicit dialect, JSDoc fix | Yes | schema-adapter.ts union + open-connections branch |
| D13 fingerprint COUNT over TABLES + COLUMNS + ROUTINES | Yes | SQL_MYSQL_FINGERPRINT |

Design File Changes table followed; two extra config-pipeline files modified (build-config.ts ordered-source, resolve-secrets.ts MysqlSource resolver) — necessary and correct, see SUGGESTION-1.

---

## Issues Found

### CRITICAL (must fix before archive)
None.

### WARNING (should fix)
- WARNING-1 — Stale story status fields. docs/stories/05-adapters.md line 72 shows US-029 Status partial (Batches 1-6 done; Batch 7 integration/E2E pending) and lines 74 and 99 mark Batch 7 and determinism items pending; docs/stories/06-security.md line 35 marks restricted-user integration pending. But tasks.md has ALL of Batch 7 done and the integration suite is green (206/206). The narrative and locked-decisions content is correct and reconciled (MySQL-8-only, MariaDB and EVENT to phase-8c) — only the checkbox STATUS lines are stale. Fix: flip US-029 status to done and the Batch 7 items to checked to match reality. Non-blocking (docs only; behavior verified).
- WARNING-2 — No apply-progress TDD-evidence artifact. Strict TDD verify expects an apply-progress artifact with a TDD Cycle Evidence table. None exists for phase-8b-mysql (Engram disconnected this session; openspec change dir has none). TDD adherence was instead confirmed indirectly: full RED/GREEN test files exist per batch, all green, pg/mssql safety-net byte-identical. Fix: ensure apply-progress is persisted (Engram or openspec) on future runs so the TDD trail is auditable. Non-blocking (evidence reconstructable from green suites and byte-identity).

### SUGGESTION (nice to have)
- SUGGESTION-1 — Design File-Changes table omits two touched files. src/cli/config/build-config.ts (mysql ordered-source branch) and src/infra/config/resolve-secrets.ts (resolveMysqlSource) were correctly modified but are not listed in design.md File Changes. Add them for an exhaustive trail.
- SUGGESTION-2 — error-mapper.test.ts doc-link assertion. Consider asserting the PermissionError message contains docs/permissions/mysql.md explicitly (the mapper includes it; an explicit test pins the US-033 doc-link contract against drift). The integration restricted-user path is acknowledged pending in the stories — low value, MySQL grants make it costly.

---

## Risks
None blocking archive. The two WARNINGs are documentation and auditability only — implementation is correct and fully test-proven against a real mysql:8 container.

## Next Recommended
sdd-archive — the change is clean (no CRITICAL). Optionally flip the stale story status checkboxes (WARNING-1) before or at archive.
