# Verification Report - connectivity-strategies

**Change**: connectivity-strategies (Batches A-F + REMEDIATION)
**Mode**: Strict TDD (RED to GREEN per task)
**Date**: 2026-06-18 (RE-VERIFICATION after PASS-WITH-WARNINGS remediation)
**Verdict**: PASS - ARCHIVABLE WITH ZERO CARRY-OVER.

## Re-Verification Executive Summary

The REMEDIATION batch resolves all three prior WARNINGs. All three gates independently re-run GREEN
(tsc clean, lint 0/0, 1491/1491 tests across 98 files, Docker integration correctly excluded). WARN-1
(FOR JSON subquery ORDER BY), WARN-2 (logger no-secret + verbosity), and WARN-3 (3-plus detection candidates)
are each fixed AND test-backed inside npm test. Read-only INVIOLABLE, zero-new-deps, child_process-only,
hexagonal boundaries, L-009 actual-qname assertions, and the codename word-boundary scan all hold.
0 CRITICAL, 0 WARNING, 2 SUGGESTION (both non-blocking, doc/test-claim hygiene). The ZERO carry-over bar
IS met. NOW ARCHIVABLE.

## Gates (independently executed this re-verification)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | PASS - exit 0, 0 errors |
| Lint | npm run lint | PASS - exit 0, 0 errors / 0 warnings |
| Unit tests | npm test | PASS - 1491 passed / 1491 (98 files), 0 failed, exit 0 |
| Integration (Docker) | (not run) | CORRECTLY EXCLUDED from npm test (vitest.config.ts line 12 excludes the integration glob); not run per instruction |

The two "Unknown command" lines in test output are expected CLI fixtures (dispatch tests), not failures.

## Prior Findings - Resolution Confirmed (adversarial: source + test)

### WARN-1 (the critical one) - FOR JSON subquery ORDER BY (Msg 1033) -> RESOLVED

- queries.ts: all 11 catalog constants are PLAIN tabular SELECTs ending with a TOP-LEVEL ORDER BY (verified
  line-by-line: 38, 70, 101, 136, 156, 193, 220, 238, 263, 290, 317). No inner subquery, no derived table.
- sqlcmd.strategy.ts catalogSql() (105-107): appends FOR JSON PATH, INCLUDE_NULL_VALUES at TOP LEVEL. The old
  SELECT * FROM (...) AS _rows FOR JSON PATH wrap is GONE. dump-emitter.ts wrapFamily() (111-119): same.
- reassembleSingleObjectOutput() added for the WITHOUT_ARRAY_WRAPPER fingerprint path.
- RED tests inside npm test: sqlcmd.test.ts:422-452 (no derived-table wrapper; FOR JSON PATH + INCLUDE_NULL_VALUES
  present); dump-emitter.test.ts:141-155 (no subquery wrap; exactly 11 top-level FOR JSON appends).
- GATED integration test queries-for-json.integration.test.ts: integration-suffix file (EXCLUDED from npm
  test); describe.skipIf(!mssqlIntegrationEnabled()) (DBGRAPH_INTEGRATION=1); iterates 11 families + fingerprint,
  runs each + FOR JSON via the mssql/tedious driver against the Testcontainer, asserts parseable JSON (Msg 1033
  would throw at pool.request().query). Structurally sound, correctly gated. Docker NOT run. It validates the
  SQL-SYNTAX class (exactly what WARN-1 was about); integrated-auth sqlcmd TRANSPORT stays a Phase-6 manual item.

### WARN-2 - Logger no-secret + verbosity -> RESOLVED (registry.test.ts, in npm test)

- (a) no secret/connection-string/password in any Logger line: 300-321 (SQL auth) and 323-341 (NTLM) serialize
  EVERY debug+info arg and assert password + user sentinels never appear. By construction selectStrategy logs
  only strategyId + reason strings (registry.ts 159/165/171/177); config is never passed to the logger.
- (b) verbosity: 343-361 assert debug called (skipped probe), info called exactly once (winner), warn/error never;
  363-380 use a real level-aware logger with debug as a NO-OP and assert info STILL reaches the caller (winner id).

### WARN-3 - 3-plus detection candidates -> RESOLVED

- sqlcmd (SqlcmdStrategy): FULL runCatalog strategy, in the selection pipeline.
- invoke-sqlcmd (InvokeSqlcmdStrategy): pwsh Get-Command Invoke-Sqlcmd + powershell fallback; argv-array,
  shell:false; DetectResult; detection-ONLY (canConnect false, runCatalog throws).
- odbc-driver (OdbcDriverStrategy): Windows registry reg query of the ODBC Drivers key + SQL-Server regex;
  argv-array, shell:false; detection-ONLY.
- registry.ts detectAllCandidates() (217-237) returns all three; they are NOT in buildMssqlStrategies runCatalog
  pipeline (native -> sqlcmd -> manual-dump -> consented-install). NO faked runCatalog.
- Tests (in npm test): invoke-sqlcmd.test.ts (11), odbc-driver.test.ts (11), registry.test.ts:387-455 (5 cases:
  exactly 3 results, order, each detect outcome). Assertion-quality audit: real, varied, no tautologies.

## Regression Re-Confirmation (no new defects)

| Check | Status | Evidence |
|-------|--------|----------|
| Selection order + framework | PASS | registry.ts native(omit-integrated) to sqlcmd to manual-dump to consented-install; first-viable-wins; selection-e2e + registry green |
| integrated skips native | PASS | registry.ts 107-110; registry.test.ts 116-130; selection-e2e scenario 1 |
| StrategyExhaustionError | PASS | registry.ts 182; registry.test.ts 248-275; selection-e2e scenario 2 (sqlcmd + manual-dump attempts) |
| Read-only INVIOLABLE (scanner covers strategies/) | PASS | security-scan.test.ts walks engines recursively (covers strategies/); F6.1 guard 162-165; negative-control BITES 216-264; FOR JSON + winget/URL = no write verb; new detection strategies issue NO SQL |
| child_process-only / ZERO new deps | PASS | only node:child_process (sqlcmd/invoke-sqlcmd/odbc); package.json deps UNCHANGED (mcp-sdk + better-sqlite3; mssql optional; testcontainers dev); no node-sql-parser, no node-odbc, no odbc import |
| Boundaries | PASS | port imports ONLY RawCatalog + ExtractionScope; strategies under adapters/engines/mssql/strategies/; exhaustion.ts inlines DUMP_DIR/DUMP_FILE (no adapter import); boundaries.test.ts green |
| L-009 actual qnames | PASS | selection-e2e.test.ts 245-289: normalizeCatalog + real SqliteGraphStore.getNodesByKind(table) CONTAIN app.accounts AND app.sessions (actual qnames); manual-dump golden byte-identical |
| CODENAME word-boundary scan | PASS - ZERO | git grep -i -w over all tracked files = exit 1 (ZERO). Denylist term gitignored (.leakscan-denylist.local NOT tracked; .local not in TEXT_EXT). Leak-scanner ran WITH local denylist present in npm test and passed (supersedes prior SUGG-1 caveat) |
| SUGG-3 fingerprint fallback | DONE (impl) | factory.ts 83-86: fingerprint() THROWS instead of static hash; createHash/node:crypto removed. See SUGG-A. |

## Issues Found (this re-verification)

### CRITICAL: None.
### WARNING: None. All three prior WARNINGs resolved and test-backed.
### SUGGESTION (non-blocking):

SUGG-A - apply-progress overstates SUGG-3 test coverage. Its TDD-evidence table claims a factory.test.ts SUGG-3
test (fingerprint throws for a no-fingerprint strategy). No such test exists in test/ (grep finds nothing for the
StrategyBackedSchemaAdapter.fingerprint() throw path; the only fingerprint-throws test is the unrelated native
MssqlSchemaAdapter after close(), mssql-schema-adapter.test.ts:351). The SUGG-3 BEHAVIOR is correctly implemented
(factory.ts:83-86) and guards a branch dead today (every winning strategy implements fingerprint()). Impact: none
functionally; SUGG-3 was itself only a SUGGESTION. Fix: add the throw test OR correct the claim. NOT a blocker.

SUGG-B - stale docstring. factory.ts:64-68 still says fingerprint() falls back to a deterministic hash, but the
body throws; connectivity-strategy.ts:86-88 has the same stale falls-back-to-a-content-hash wording. Cosmetic.

## Verdict

PASS. Remediation complete and verified adversarially. WARN-1 (FOR JSON top-level fix + gated integration test),
WARN-2 (logger no-secret + verbosity), WARN-3 (three detection candidates) are RESOLVED and backed by tests that
run inside npm test. Gates independently re-run: npx tsc --noEmit clean, npm run lint 0/0, npm test 1491/1491 (98
files), Docker integration correctly excluded. Read-only, zero-new-deps, child_process-only, boundaries, L-009
actual-qname evidence, and the codename scan (ZERO) all hold. 0 CRITICAL, 0 WARNING, 2 non-blocking SUGGESTIONS.

NOW ARCHIVABLE WITH ZERO CARRY-OVER. Recommended next phase: sdd-archive.

---

# (Historical) Original Verification Report - PASS WITH WARNINGS (pre-remediation)

## Executive Summary

All three independently-run gates are GREEN (tsc clean, lint 0/0, 1457/1457 tests, Docker excluded).
Strategy framework, sqlcmd / manual-dump / consented-install strategies, integrated config, exhaustion
UX, hexagonal boundaries, read-only scanner, and codename leak-scanner all conform to spec.
0 CRITICAL, 3 WARNING, 3 SUGGESTION. Functionally complete and structurally sound; archivable, but the
ZERO carry-over bar is NOT met - 3 WARNINGs should be resolved or explicitly accepted (chiefly the FOR
JSON subquery ORDER BY wrap, likely to fail Msg 1033 against a real SQL Server, caught only by manual Phase 6).

## Gates (independently executed)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | PASS - exit 0, 0 errors |
| Lint | npm run lint | PASS - exit 0, 0 errors / 0 warnings |
| Unit tests | npm test | PASS - 1457 passed / 1457 (96 files), 0 failed, exit 0 |
| Integration (Docker) | npm run test:integration | NOT RUN - correctly EXCLUDED from npm test |

vitest.config.ts excludes the integration glob; the mssql-integration CI job is a separate needs-empty
job gated on DBGRAPH_INTEGRATION=1. The Unknown command lines in test output are expected CLI fixtures.

## Completeness

Tasks total 30 (A1.1-A1.7, B2.1-B2.6, C3.1-C3.6, D4.1-D4.4, E5.1-E5.4, F6.1-F6.3); complete 30; incomplete 0.
All tasks checked and match code state (verified file-by-file against the Files-Changed table).

## Spec Compliance Matrix (behavioral - test-backed)

### connectivity

| Scenario | Test | Result |
|----------|------|--------|
| Port exposes contract, only core types | boundaries.test.ts > port driver-free (F6.2) | COMPLIANT |
| detect reports availability + metadata | sqlcmd.test.ts > detect() + connectivity-strategy.test.ts | COMPLIANT |
| First viable strategy wins | registry.test.ts > first passing even if later pass | COMPLIANT |
| Integrated skips native | registry.test.ts > omits native for integrated + selection-e2e | COMPLIANT |
| Each probe + final choice logged | registry.test.ts > debug per probe / info winner / mentions id | PARTIAL (WARN-2) |
| Verbosity via logger levels | none found - debug-suppress not pinned | PARTIAL (WARN-2) |
| All exhausted lists each attempt+reason | registry.test.ts + errors.test.ts | COMPLIANT |
| Detection reports availability w/o connecting | sqlcmd.test.ts > does NOT open DB during detect() | COMPLIANT |
| At least 3 SQL Server candidates probed | only sqlcmd where/which + -?; Invoke-Sqlcmd + ODBC NOT done | PARTIAL (WARN-3) |
| Timed-out/failed probe to unavailable | sqlcmd.test.ts > available:false on timeout / never throws | COMPLIANT |
| Strategy source passes write-verb scanner | security-scan.test.ts > no write verbs + strategies/ (F6.1) | COMPLIANT |
| Shelling keeps 100% JS-drivers + no-install | consented-install.test.ts > no spawn + deps unchanged | COMPLIANT |

### mssql-extraction

| Scenario | Test | Result |
|----------|------|--------|
| Integrated drives sqlcmd | selection-e2e.test.ts > integrated, sqlcmd wins | COMPLIANT |
| Explicit-cred still uses native | factory.test.ts + registry.test.ts > native first sql/ntlm | COMPLIANT |
| Output reassembled + parsed to typed rows | sqlcmd.test.ts > multi-line split-JSON golden | COMPLIANT |
| Catalog identical to native path | selection-e2e qnames + manual-dump byte-identical snapshot | COMPLIANT |
| Malformed output rejected, not cast | sqlcmd.test.ts > throws on malformed + json-rows.test.ts (37) | COMPLIANT |
| Combined JSON to same RawCatalog | manual-dump.test.ts > golden byte-identical / L-009 qnames | COMPLIANT |
| Emitted script read-only + gitignored | dump-emitter.test.ts + git check-ignore .dbgraph/dumps/ OK | COMPLIANT |
| Strategy SQL passes write-verb scanner | security-scan.test.ts (8 strategy files clean) | COMPLIANT |
| No codename leaks into artifacts | no-secret-leak.test.ts + golden anonymized | COMPLIANT (SUGG-1) |

### cli-config

| Scenario | Test | Result |
|----------|------|--------|
| Integrated parses w/o credentials | parse-config.test.ts (integrated arm) | COMPLIANT |
| resolveSecrets skips absent fields | resolve-secrets.test.ts (integrated arm) | COMPLIANT |
| Existing credentialed modes unchanged | parse-config + resolve-secrets (sql/ntlm round-trip) | COMPLIANT |
| Both options presented actionably | exhaustion.test.ts + selection-e2e > both options | COMPLIANT |
| Guided install prints only, no auto-exec | consented-install.test.ts > no spawn / throws | COMPLIANT |
| Automated install stated as deferred | exhaustion.test.ts > B2 DEFERRED | COMPLIANT |

Compliance summary: 27/30 fully COMPLIANT; 3 PARTIAL (logging no-secret, verbosity levels, 3-candidate
detection). 0 FAILING, 0 UNTESTED.

## Verdict (historical)

PASS WITH WARNINGS. Implementation complete (30/30 tasks), all gates green (tsc clean, lint 0/0, 1457/1457
tests, Docker excluded). 3 WARNINGs required remediation before archive. All three were resolved in the
REMEDIATION batch. See re-verification verdict above.
