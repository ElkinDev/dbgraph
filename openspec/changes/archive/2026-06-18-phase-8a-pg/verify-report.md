# Verification Report -- phase-8a-pg (PostgreSQL schema-extraction adapter)

**Change**: phase-8a-pg
**Mode**: Strict TDD (orchestrator-injected; authoritative)
**Date**: 2026-06-18 (RE-VERIFICATION after remediation R1, commit 8433352)
**Verdict**: PASS WITH WARNINGS -- CRITICAL-1, WARNING-1, SUGGESTION-1, SUGGESTION-2 all RESOLVED. WARNING-2 (restricted-role negative E2E) is the only open item, deliberately deferred and tracked. Cleared for archive. One NEW low-severity finding: the WARNING-1 static-edge-survives-dynamic behavior is correct by construction but has no dedicated regression test.

---

## Gate Execution (all four run; exact results)

| Gate | Command | Result | Exit |
|---|---|---|---|
| Type check | npx tsc --noEmit | PASS | 0 |
| Lint | npm run lint (eslint) | PASS, 0 errors / 0 warnings | 0 |
| Unit suite | npm test (vitest run) | PASS -- 1739 passed / 113 files / 0 failed | 0 |
| Integration | DBGRAPH_INTEGRATION=1 npm run test:integration vs real postgres:16 | PASS -- 140 passed / 8 files / 0 failed | 0 |

Deltas vs prior FAIL report: unit 1732 -> 1739 (+7), integration 128 -> 140 (+12). The added tests are the negative/exact-set regression guards R1 introduced. The gate is GREEN and now pins CORRECT output (the prior gate was green but pinned the phantom-edge defect).

---

## Prior-Finding Resolution Matrix

| Prior finding | Verdict | Evidence |
|---|---|---|
| CRITICAL-1 -- phantom reads_from to every object + self-references | RESOLVED | pg/tokenizer.ts:216 gates classifyAccess behind bodyContainsRef(staticBody, canonicalTarget); objects absent from the static body get NO edge (no default-to-read). Re-pinned golden-raw-catalog.json shows EXACT sets (below). golden-e2e.json edgeCount 68->47, stubCount 2->0. |
| Negative assertions (the root gap) | RESOLVED | map.test.ts:309-415, extract.integration.test.ts:319-391, e2e.integration.test.ts:296-376 assert EXACT dep sets via toEqual, exact counts via toBe(N), explicit no-self, explicit no-phantom (each absent object checked), and zero-read assertions. Existence-only toBeDefined is no longer the sole guard. |
| WARNING-1 -- suppress-all on hasDynamicSql drops reliable static edges | RESOLVED (code) -- see NEW-1 | pg/map.ts:578-583: hasDynSql and dependencies are now set INDEPENDENTLY; the suppress-all branch is gone. maskDynamicStrings (tokenizer.ts:116-121) excludes ONLY single-quoted dynamic-string contents, so a static write/read outside the EXECUTE string survives while hasDynamicSql:true is still flagged. hasDynamicSql is detected on the ORIGINAL body (tokenizer.ts:196), edges on the MASKED body. |
| SUGGESTION-1 -- ssl type richer than design | RESOLVED | 8433352 updates design.md:69 to ssl as boolean OR object-with-rejectUnauthorized, matching schema-adapter.ts. |
| SUGGESTION-2 -- fingerprint omits attribute component | RESOLVED | queries.ts:360-376 SQL_PG_FINGERPRINT now selects MAX(a.attnum) + COUNT(a.attnum) via LEFT JOIN pg_attribute (attnum>0, NOT attisdropped). pg-schema-adapter.ts:161 hashes all four components: sha256 over maxOid, maxAttnum, relCount, attrCount -- attnum genuinely feeds the digest (not cosmetic). extract.integration.test.ts:600 proves ALTER TABLE app.products ADD COLUMN moves the fp; :524 proves DML (INSERT) keeps it stable. |
| WARNING-2 -- restricted-role negative E2E missing | DEFERRED (only open item) | Tracked at docs/stories/06-security.md:35 -- a user without USAGE (pg) receiving the actionable error is PENDING. Positive path proven: error-mapper unit pins SQLSTATE 42501 -> PermissionError + docs/permissions/pg.md link; full extraction under superuser passes. Non-blocking. |

---

## Detailed Confirmation per Re-Verification Point

### 1. CRITICAL-1 cleared -- exact golden sets (golden-raw-catalog.json)

| Object | Expected | Golden (verified) | Self/Phantom |
|---|---|---|---|
| reporting.v_order_summary | orders read + order_items read | order_items read + orders read | none |
| reporting.mv_product_stats | products read + order_items read | order_items read + products read | none |
| app.proc_cancel_order | orders write | orders write ONLY | none |
| app.audit_fn | audit_log write | audit_log write ONLY | none |
| app.fn_place_order | orders write + order_items write + products read | order_items write + orders write + products read | none |
| app.fn_dynamic_search | empty + hasDynamicSql:true | NO dependencies key + hasDynamicSql:true | refs only inside format(...), masked |
| app.trg_audit_order_update | no deps, NOT dynamic | no deps, no hasDynamicSql | EXECUTE FUNCTION correctly not flagged |

golden-e2e.json: edgeCount:47, stubCount:0 (pinned byte-identical by e2e.integration.test.ts:391). The 21 phantom edges and 2 spurious stub nodes from the prior FAIL are eliminated.

### 2. Negative assertions exist and are STRONG
- map.test.ts:314 asserts the exact 2-name array via toEqual; :316 no-self; :318-320 no-phantom.
- map.test.ts:380 deps.length toBe(2); :390-398 audit_fn exactly 1 write + 0 reads; :411-415 dynamic_query exactly 0 deps.
- extract.integration.test.ts:319-391 same exact-set/no-self/no-phantom against the REAL postgres:16 catalog.
- e2e.integration.test.ts:296-376 exact edge counts at the normalized-graph layer + no-self.

### 3. WARNING-1 cleared (suppress-all branch gone)
pg/map.ts:578-583 no longer leaves dependencies undefined when dynamic. A routine with a static write + a dynamic EXECUTE WOULD keep the static writes_to edge: maskDynamicStrings masks only the single-quoted dynamic string, so static operands outside it survive classifyAccess, while hasPgDynamicSql (run on the unmasked body) still flags hasDynamicSql:true. Now consistent with MSSQL. See NEW-1 re: coverage of the COMBINED case.

### 4. View depends_on vs reads_from -- PRE-EXISTING design, NOT a regression
src/core/normalize/reference-resolver.ts:261-267: write -> writes_to; view-kind read -> depends_on; other read (proc/trigger) -> reads_from. Last modified by 7cf2629 chore: initial commit; NOT touched by R1 (8433352 touches no core/ file). The MSSQL e2e golden also contains depends_on edges -- cross-engine-consistent. e2e tests assert views emit depends_on (e2e.integration.test.ts:307,327) while procs/functions emit writes_to/reads_from (:344,361). Confirmed: existing normalizer behavior.

---

### 5. SUGGESTION-2 cleared -- attnum component proven
SQL + hash + integration all confirmed. The ADD COLUMN test asserts the fingerprint changes; the DML test asserts it stays stable. One-query contract intact (extract.integration.test.ts:585).

### 6. No regressions
- _shared/tokenizer-core.ts NOT touched by R1 (git show --stat empty; git diff 8433352~1 8433352 empty). The CRITICAL-1 fix lives entirely in the PG layer (bodyContainsRef gate), correctly NOT mutating the shared classifyAccess (which still defaults non-write to read -- safe because MSSQL only feeds it catalog-confirmed deps and PG now pre-gates by presence).
- MSSQL goldens NOT touched by R1 -> byte-identical guaranteed; MSSQL unit + integration green within the 1739/140 totals.
- Write-verb scanner GREEN. The String.fromCharCode(34) trick in pg/tokenizer.ts:50 is sound: it builds the double-quote-stripping regex without embedding a literal double-quote that the naive scanner extractor would misread (ADR-007). No SET SESSION / write verbs introduced.
- 24/26 previously-compliant requirement groups still pass; the 2 formerly FAILING/PARTIAL groups are now COMPLIANT.

### 7. WARNING-2 is the ONLY deferred item
Confirmed: docs/stories/06-security.md:35 PENDING. No other open finding. WARNING-2 alone does NOT block archive (tracked enhancement, positive path proven at unit + superuser-integration level).

---

## New Findings (this re-verification)

### CRITICAL
None.

### WARNING
NEW-1 (WARNING) -- the WARNING-1 static-edge-survives-dynamic behavior is correct by construction but UNTESTED for the combined case.
- Where: the only dynamic routine in the fixture, app.fn_dynamic_search (test/fixtures/pg/torture.sql:171-181), has ALL refs inside a format(...) string and NO static write/read outside the EXECUTE string. No test exercises a routine with BOTH a reliable static INSERT/UPDATE AND a dynamic EXECUTE keeping the static edge while flagging hasDynamicSql:true.
- Evidence of the gap: tokenizer.test.ts:148-160 (bare EXECUTE with empty deps -> 0 deps) proves dynamic-string exclusion but NOT static-edge survival; map.test.ts:368-415 only covers the all-dynamic routine. The code path is correct, but the regression WARNING-1 warned about (a future refactor re-introducing suppress-all) would NOT be caught by any test.
- Severity: behavior is correct today; this is a missing regression guard, not a defect. Suggested fix: add one tokenizePgBody unit test with a static INSERT plus a dynamic EXECUTE, asserting hasDynamicSql true AND dependencies containing the static write but NOT the dynamic-string ref.

### SUGGESTION
NEW-2 (SUGGESTION) -- bodyContainsRef uses simple-name word-boundary matching (tokenizer.ts:139-153), which could in principle match a column/alias sharing a table name. Not observed in any fixture (all green, exact sets correct). Consider, long-term, restricting reads to FROM/JOIN operands (symmetric with the write-verb operand extraction) for defense-in-depth. Non-blocking.

---

## Spec Compliance Matrix (behavioral -- test-backed, re-verified)

| Requirement | Test (passed) | Result |
|---|---|---|
| Tables/columns, identity, generated, PK/FK/unique/CHECK, indexes | map.test.ts + integration | COMPLIANT |
| Views + matviews (kind:view + extra.materialized) | map.test.ts + integration | COMPLIANT |
| Functions/procedures (level-gated), triggers (tgtype) | map.test.ts + integration | COMPLIANT |
| Trigger fires_on parent (no phantom stub) | e2e.integration.test.ts:227 | COMPLIANT |
| Sequences / Comments | map.test.ts + integration | COMPLIANT |
| Parsed reads_from/writes_to (reads ONLY referenced objects, no self, no phantom) | map.test.ts:309-415 + extract.integration:319-391 + e2e.integration:296-376 | COMPLIANT (was FAILING) |
| Trigger body effects (audit_fn writes audit_log, zero phantom reads) | map.test.ts:390 + e2e.integration:361 | COMPLIANT (was PARTIAL) |
| Dynamic SQL flagged; EXECUTE FUNCTION not dynamic | tokenizer.test.ts both directions + integration | COMPLIANT |
| fingerprint one query (DDL incl ADD COLUMN / DML stable) | extract.integration.test.ts:524,555,600 | COMPLIANT (SUGGESTION-2 resolved) |
| Read-only (catalog SELECTs only; no SET SESSION) | security-scan.test.ts + grep | COMPLIANT |
| Minimal read-only role doc | docs/permissions/pg.md | COMPLIANT (positive); restricted-user E2E deferred (WARNING-2) |
| PermissionError actionable | error-mapper.test.ts | COMPLIANT (unit); E2E deferred (WARNING-2) |
| Connectivity host/port/ssl, env-only password; missing pg driver | parse-config.test.ts + factory.test.ts | COMPLIANT |
| Torture fixture via Testcontainers (gated); Golden RawCatalog + E2E (byte-identical) | extract/e2e integration goldens (now CORRECT) | COMPLIANT |
| SchemaAdapterConfig union + pg variant; dialects + UnsupportedDialectError + exit 4 | unit + exit-code regression | COMPLIANT |
| Shared tokenizer-core; MSSQL byte-identical | tokenizer-core untouched; MSSQL green | COMPLIANT |

Compliance summary: 26/26 requirement-groups fully COMPLIANT (was 24/26). The 2 formerly FAILING/PARTIAL groups are now backed by passing exact-set negative tests.

---

## Coherence (Design)
- Thin class + direct PgReadonlyDriver seam; host-keyed structural union; no SET SESSION READ ONLY: Yes.
- Matview = kind:view + extra.materialized; EXECUTE statement vs EXECUTE FUNCTION boundary: Yes.
- Body tokenizer is SOLE edge source, now CORRECTLY scoped via the bodyContainsRef presence gate. Determinism met AND edge semantics now correct.
- View read -> depends_on; proc/trigger read -> reads_from: pre-existing normalizer, consistent with MSSQL.
- ssl: boolean OR object -- design updated (SUGGESTION-1). fingerprint: MAX(oid)+MAX(attnum)+COUNT(DISTINCT oid)+COUNT(attnum) (SUGGESTION-2).

---

## Completeness
All 47 numbered tasks checked done; 0 incomplete. Working tree clean on branch phase-8a-pg, HEAD = 8433352. Checkmarks now accurate at the BEHAVIORAL level (tasks 4.4 / 7.3 / 7.6 backed by exact-set negative tests, not just golden-seeded + byte-stable).

---

## Final Verdict
PASS WITH WARNINGS. All four gates GREEN (tsc 0, lint 0, unit 1739/0, integration 140/0). CRITICAL-1, WARNING-1, SUGGESTION-1, SUGGESTION-2 from the prior FAIL are all RESOLVED with file-level and test-level evidence; the re-pinned goldens encode correct output (edgeCount 47, stubCount 0). 26/26 requirement-groups compliant. Remaining open items are non-blocking: WARNING-2 (deferred by design), NEW-1 (WARNING -- missing regression test; correct by construction), NEW-2 (SUGGESTION). None block archive.

Recommendation: proceed to sdd-archive. Track WARNING-2 and NEW-1 as follow-ups.
