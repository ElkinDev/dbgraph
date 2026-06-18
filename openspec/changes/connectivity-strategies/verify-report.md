# Verification Report - connectivity-strategies

**Change**: connectivity-strategies (Batches A-F)
**Mode**: Strict TDD (RED to GREEN per task)   **Date**: 2026-06-18
**Verdict**: PASS WITH WARNINGS - archivable, but NOT with zero carry-over.

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

## Conformance Checks (launch-prompt criteria)

1. Strategy framework - PASS. Port driver-free (imports only RawCatalog/ExtractionScope; child_process only in
   comments). buildMssqlStrategies orders native to sqlcmd to manual-dump to consented-install; native omitted
   for integrated. selectStrategy picks first detect+canConnect, logs via Logger, throws StrategyExhaustionError.
2. sqlcmd - PASS w/ caveat. child_process argv-array, shell:false, no interpolation (asserted). FOR JSON PATH wrap;
   multi-line reassembly with split-payload golden (5-char chunks); json-rows.ts to UNCHANGED map.ts. See WARN-1.
3. manual-dump - PASS. dump-emitter (11 families, FOR JSON, read-only); ingest ONE combined JSON from gitignored
   .dbgraph/dumps/; same map.ts; anonymized golden tracked + byte-identical proof.
4. consented-install (B1) - PASS. GUIDED ONLY: prints recipes via Logger.info, no installer; B2 seam + DEFERRED.
5. integrated config - PASS. parses/resolves with NO credentials; sql/ntlm unchanged; factory preserves
   missing-mssql-driver ConnectionError (npm i mssql) assertion (factory-missing-driver.test.ts, E_CONNECTION).
6. Constraints - PASS. child_process = separate process not native driver (100% JS intact); consent honors
   no-install; write-verb scanner covers strategies/ and BITES; ZERO new deps (deps = mcp-sdk + better-sqlite3;
   mssql optionalDependency unchanged).
7. L-009 - PASS. selection-e2e asserts ACTUAL qnames (app.accounts, app.sessions) via normalizeCatalog AND
   SqliteGraphStore.getNodesByKind; manual-dump golden asserts exact table/view/sequence/FK qnames (not counts).
8. Boundaries - PASS. port imports nothing outward; strategies under engines/mssql/strategies/; exhaustion.ts
   barrel-only (no /adapters/); core/mcp/cli/infra boundary tests pass.
9. CODENAME (legal) - PASS. leak-scanner word-boundary scan of ALL tracked text files; wired in ci.yml with
   LEAKSCAN_DENYLIST secret within npm test. Denylist correctly NOT committed. Fixtures synthetic. See SUGG-1.
10. Known caveat (Phase 6) - Assessed. Mocked-unit coverage sound; real sqlcmd -E is an ACKNOWLEDGED Phase-6
    manual item (design Open Questions), NOT a hidden gap. BUT see WARN-1: likely Msg 1033 at real runtime.

## Coherence (Design)

All design decisions followed. Documented deviations (Logger not imported in port; canConnect re-throws
missing-driver ConnectionError; readFile/spawnSync seams; consented-install canConnect=false; optional
fingerprint? on port) are sound. The ONLY problematic deviation is latent: the sqlcmd/dump-emitter FOR JSON
wrap keeps the inner ORDER BY inside a derived table (WARN-1), masked by mocked stdout.

## Issues Found

### CRITICAL (must fix before archive)
None.

### WARNING (should fix or explicitly accept)

WARN-1 - FOR JSON PATH subquery ORDER BY is likely invalid SQL (Msg 1033).
sqlcmd.strategy.ts (wrapForJson) and dump-emitter.ts (wrapFamily) wrap each query as
SELECT * FROM (<queries.ts query incl. top-level ORDER BY>) AS _rows FOR JSON PATH, INCLUDE_NULL_VALUES.
In SQL Server an ORDER BY inside a derived table is ILLEGAL without TOP/OFFSET/FOR XML (Msg 1033); the outer
FOR JSON does NOT legalize it. All 11 queries.ts constants end with a top-level ORDER BY (verified). Mocked
stdout means CI cannot catch this - it is the acknowledged Phase-6 manual item (not a hidden gap, not CRITICAL
per the deferral). Determinism (ADR-008) is anchored by app-level re-sorting in map.ts (12 sort sites) +
normalize (23 more), so the inner SQL ORDER BY is NOT load-bearing. Fix: strip the inner ORDER BY before
wrapping. Files: sqlcmd.strategy.ts:94-96, dump-emitter.ts:108-117. Phase 6 MUST verify a real sqlcmd -E run.

WARN-2 - Logger no-secret-in-line and verbosity/debug-suppression scenarios are not pinned by a test.
The connectivity spec requires no resolved secret in any log line and debug-suppressed-while-info-retained.
registry.test.ts asserts debug/info are CALLED and the winner-info mentions the id, but NOT that a secret never
reaches a log argument and NOT a debug-suppression case. The mocked Logger records everything, so a secret-log
regression would still pass. Behavior is correct by construction (only generic reasons + strategyId logged;
config never passed to logger; integrated has no secret), but apply-progress C3.2 claimed these cases pass and
they are absent. Add (a) no-secret-in-arg assertion and (b) a level-aware logger with debug as no-op.

WARN-3 - Detection probes only sqlcmd, not the 3 candidates the connectivity spec requires.
The spec mandates sqlcmd (legacy vs go by capability), PowerShell Invoke-Sqlcmd, AND an ODBC registry check.
sqlcmd.strategy.ts probes only sqlcmd (where/which + -? capability fallback). Invoke-Sqlcmd and ODBC-registry
are NOT implemented and untested, narrowing the integrated-auth fallback surface. The legacy-vs-go sub-point
is satisfied by the -? capability probe. Fix: implement the two extra candidates OR amend the spec to scope
detection to sqlcmd for this change.

### SUGGESTION (nice to have)

SUGG-1 - Codename leak-scan is a no-op locally (early-returns when LEAKSCAN_DENYLIST unset and no .local file).
The local 1457-green run does NOT prove codename absence - only CI (with the secret) does. Intended design;
fixtures are anonymized so risk is low. Keep a git-ignored .leakscan-denylist.local for local enforcement.

SUGG-2 - exhaustion.ts and dump-emitter.ts duplicate DUMP_DIR/DUMP_FILE (deliberate ADR-004 choice, boundary-
test pinned). Consider a shared CLI-layer constants module if more such values accrue.

SUGG-3 - StrategyBackedSchemaAdapter.fingerprint() returns a static id-based hash when a strategy lacks
fingerprint(). The path is dead today; a future strategy omitting it would defeat DDL-change detection (US-009).
Consider throwing instead. File: factory.ts:80-82.

## Verdict

PASS WITH WARNINGS. Implementation complete (30/30 tasks), all gates green (tsc clean, lint 0/0, 1457/1457
tests, Docker excluded), 27/30 spec scenarios test-backed COMPLIANT with strong behavioral evidence (real
SQLite persistence + actual-qname L-009 assertions; byte-identical equivalence proof; negative-control write-
verb scanner; barrel-only CLI boundary). Read-only, zero-new-deps, no-install-without-consent, codename hygiene hold.

Archivable: YES, but NOT with ZERO carry-over. WARN-1 (FOR JSON subquery ORDER BY, likely Msg 1033 - must be
caught/fixed in the acknowledged Phase 6), WARN-2 (two unpinned logging scenarios + a claimed-but-absent test),
and WARN-3 (3-candidate detection shortfall) must be fixed or explicitly accepted before archive.
