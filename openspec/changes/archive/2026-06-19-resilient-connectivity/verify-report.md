# Re-Verification Report (R1) - resilient-connectivity (Phase 8.5)

**Change**: resilient-connectivity (engine-agnostic connectivity resilience)
**Branch**: resilient-connectivity (base 462c06d, HEAD e51103e)
**Remediation under test**: R1 commit e51103e ("content-free summaries, typed TransportError, drop dead exhaustion shim, basename in doctor")
**Mode**: Strict TDD
**Date**: 2026-06-22
**Verdict**: PASS WITH WARNINGS - all 4 targeted findings (C1, C2, W1, S1) are RESOLVED with file:line + planted-secret test evidence. Both CRITICALs are cleared. The unit gate is fully green (tsc 0, lint 0/0, 141 files / 2247 tests, 0 failed, 0 skipped). The only open items are the two pre-tracked follow-ups (W2 + S2), neither of which blocks archive. Integration could NOT be executed this session because the Docker daemon is not running (environmental, not a code defect - see Gate note).

## Resolution of Prior Findings

| Prior finding | Status | Evidence |
|---------------|--------|----------|
| C1 - content-free leak on pg/mysql connect-failure | RESOLVED | pg/factory.ts:182-187 + mysql/factory.ts:191-196: connect-failure builds a CANNED content-free summary and attaches the raw driver error as err.cause ONLY. present/connectivity.ts:40 renders outcome.summary and NEVER touches .cause. ALL outcome-building paths content-free: pg/mysql driver-absent (canned npm i strings), pg/mysql connect-failure (canned), mssql exhaustion (buildConnectivityOutcome, single source). New leak tests pg/factory.test.ts:366-417 + mysql/factory.test.ts:261-325 plant host/user/db/password into the raw driver error, drive the REAL connect-failure path, render via formatOutcome, assert not.toContain all four planted values + summary content-free; pg also asserts the raw cause IS preserved. |
| C2 - TransportError (E_TRANSPORT) unimplemented | RESOLVED | core/errors.ts:203-210: class TransportError extends DbgraphError (code E_TRANSPORT), raw cause as .cause only; exported core/index.ts:185. Thrown at all transport/format/parse failure points with REDACTED messages: json-rows.ts:130,139,166,175 (malformed/non-array reassembly) and sqlcmd.strategy.ts:266,323 (runCatalog + fingerprint spawn failures - raw stderr kept only in rawCause to .cause). New transport-error.test.ts (296 lines) plants a password+server secret and host in BOTH the malformed-JSON path AND the spawn-stderr path, asserting TransportError.message excludes them (lines 114, 172, 242-243, 293-294) + code === E_TRANSPORT + instanceof TransportError. exit-code.ts mapping consistent: TransportError falls through generic DbgraphError to return 2 (no existing mapping broken). |
| W1 - dead exhaustion shim with stale inline queries | RESOLVED | src/cli/format/exhaustion.ts + test/cli/format/exhaustion.test.ts DELETED (filesystem-confirmed; format dir holds only diff.ts/query.ts/status.ts). No src/ reference to formatExhaustionError remains (only archived prior-change docs + this change historical spec/design text). boundaries.test.ts:375-386 has a dedicated describe block pinning the file is GONE via readFileSync to ENOENT. The live exhaustion path renders via formatOutcome. |
| S1 - doctor rendered full CLI tool path (username leak) | RESOLVED | present/doctor.ts:99 renders basename(tool.path) (import at line 20); explicit comment re C:\Users\<user> username leakage. doctor-format.test.ts:279-331 (S1 describe block) plants a full Windows path embedding username ecardoso + a POSIX path and asserts the rendered output excludes the full path AND the username, while the basename DOES appear. |
| W2 - probe-selected profile not wired into runCatalog/sync | DEFERRED (tracked, does NOT block archive) | Unchanged by R1 and correct today: SqlcmdStrategy resolves the conservative default profile at construction; default flags equal shipped -y 0 -f o:65001, so byte-identical holds. The probe-to-profile round-trip into extraction remains a tracked follow-up. No regression. |
| S2 - test-filename drift vs tasks doc | DEFERRED (tracked, does NOT block archive) | Harmless naming drift (e.g. connectivity-format.test.ts, doctor-format.test.ts); all tests exist and pass. Reconcile tasks-doc paths during archive if an exact audit trail is wanted. |

## Gate Output (R1 re-run)

| Gate | Command | Result |
|------|---------|--------|
| Type-check | npx tsc --noEmit | PASS (exit 0) |
| Lint | npm run lint | PASS (0 errors / 0 warnings, exit 0) |
| Unit tests | npm test | PASS - 141 files / 2247 tests, 0 failed, 0 skipped (was 2240; +7 net from new C1/C2/S1 leak tests minus deleted exhaustion.test assertions) |
| Targeted regression | vitest run parity + connectivity-outcome + pg/mysql factory + transport-error + doctor-format + boundaries | PASS - 7 files / 134 tests |
| Integration (gated) | DBGRAPH_INTEGRATION=1 npm run test:integration | NOT EXECUTED - Docker daemon not running (failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine). 204 tests correctly skipped; 2 non-container tests passed; the 9 "failed" files are container-startup failures in test harness beforeAll, NOT assertion failures. Environmental, not a code regression. |
| mssql goldens | git diff 462c06d HEAD -- test/fixtures/mssql/golden/ | EMPTY - byte-identical (R1 did not touch goldens) |
| R1 source scope | git diff --name-only 1f4b7c8 HEAD -- src/ | 8 files only (4 fix targets + errors.ts/index.ts + deleted exhaustion.ts); _shared/connectivity-outcome.ts UNTOUCHED |

## No-Regression Confirmation

- Engine-agnostic parity (highest prior scrutiny point): buildConnectivityOutcome single source UNTOUCHED by R1 (empty diff); parity suite green; pg/mysql/mssql still produce the identical 3-option shape [run-it-yourself, consented-install, manual-dump]; run-it-yourself queries write-verb-free (security-scan green within the 2247).
- mssql goldens byte-identical; full mssql unit suite (reassembly/runCatalog/fingerprint against recorded fixtures) green within the 2247.
- Opt-in sqlcmd-transport CI lane still NOT in the unit test job needs: (the test job has no needs key; lane is a separate root job gated by workflow_dispatch / vars.DBGRAPH_SQLCMD_LANE).
- ZERO new npm dependencies (R1 diff touched no package.json / lock).

## Remaining Open Items

Only W2 (probe-selected profile not wired into runCatalog/sync - default==legacy-15.x correct today) and S2 (test-filename drift). Both are pre-existing, tracked follow-ups. NEITHER blocks archive.

## NEW Findings (introduced by R1)

None. R1 introduced no new CRITICAL/WARNING/SUGGESTION. The only non-source caveat is the integration gate could not run locally (Docker daemon down) - to be re-confirmed in CI where the gated lanes run with a live runtime.

## Verdict

PASS WITH WARNINGS. All four targeted findings (C1, C2, W1, S1) are RESOLVED with file:line + planted-secret test evidence; both CRITICALs are cleared. The unit gate is fully green and the remediation is surgical (8 files, single-source builder untouched, goldens byte-identical). Recommend sdd-archive - the two remaining items (W2, S2) are tracked follow-ups that do NOT block archive. Re-run the gated integration in CI (live Docker) as a closeout confirmation.

---

# Verification Report - resilient-connectivity (Phase 8.5)

**Change**: resilient-connectivity (engine-agnostic connectivity resilience)
**Branch**: resilient-connectivity (base 462c06d)
**Mode**: Strict TDD
**Date**: 2026-06-19
**Verdict**: PASS WITH WARNINGS - the full gate is green; 2 CRITICAL items block a clean archive.

## Gate Output (full execution)

| Gate | Command | Result |
|------|---------|--------|
| Type-check | npx tsc --noEmit | PASS (exit 0) |
| Lint | npm run lint | PASS (0 errors / 0 warnings) |
| Unit tests | npm test | PASS - 141 files / 2240 tests, 0 failed, 0 skipped |
| Integration (Docker present) | DBGRAPH_INTEGRATION=1 npm run test:integration | PASS - 10 files / 206 tests |
| No new deps | git diff base -- package.json package-lock.json | EMPTY - ZERO new npm dependencies |

## Priority Scrutiny Verdicts

### 1. Engine-agnostic parity - PROVEN (not asserted). VERDICT: PASS
src/adapters/engines/_shared/connectivity-outcome.ts exports the SINGLE buildConnectivityOutcome builder. The pg factory, mysql factory, and the mssql selectStrategy exhaustion point ALL call it. test/adapters/engines/_shared/parity.test.ts drives the THREE real paths (pg createPgSchemaAdapter + importPg MODULE_NOT_FOUND; mysql createMysqlSchemaAdapter; mssql selectStrategy all-skipped) and asserts EXACT-set: each options.length toBe(3); each options.map(kind) toEqual [run-it-yourself, consented-install, manual-dump]; cross-engine identity pgKinds toEqual mysqlKinds toEqual mssqlKinds; run-it-yourself not.toMatch the write-verb regex (INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE) per engine. The run-it-yourself queries are the EXACT shipped catalog SELECTs from each engine queries.ts (pg=9, mysql=9, mssql=11). Parity is proven through real factory/registry execution, not inspection.

### 2. mssql byte-identical after Batch-4 reassembly extraction. VERDICT: PASS
git diff 462c06d HEAD -- test/fixtures/mssql/golden/ is EMPTY - golden-raw-catalog.json and golden-e2e.json are byte-identical. The only test/fixtures/mssql additions are the NEW connectivity/F-*.json. reassembleForJson/reassembleSingleForJson moved into json-rows.ts (profile-driven: decode via profile.encoding; strip only trailing CR; concatenate verbatim - never trim at chunk boundaries; drop the (N rows affected) trailer; typed actionable error with first-200-chars on malformed/non-array). parseJsonRows/coerceStringy (sql_variant to JSON, F-9) UNCHANGED. The full mssql unit suite + the gated mssql integration are GREEN. Determinism (ADR-008) preserved.

### 3. mssql probe round-trip deferred (Batch-4 deviation). VERDICT: ACCEPTABLE but WARNING (see W2)
Task 4.3 specified SqlcmdStrategy.probe() (delegating to MssqlCapabilityProbe + a tiny FOR JSON round-trip) and a probe-DRIVEN profile. The strategy has NO probe() method and resolves the profile at construction from an EMPTY probe (nativeDriver false, cliTools empty, odbc false) which ALWAYS yields the conservative default. The default flags equal the shipped flags, so byte-identical holds, BUT the live sync/runCatalog path NEVER consumes a measured profile. The US-040 rule (profile MUST be SELECTED by the capability probe result, never assumed) is met only inside doctor, not in extraction. The code comment (sqlcmd.strategy.ts:130-133) self-documents the deferral.

### 4. The seam + happy-path unchanged. VERDICT: PASS (with W1 on the shim)
pg/mysql factories throw ConnectivityUnavailableError(outcome) ONLY on driver-absent + connect-failure; the successful-connect branch (new PgSchemaAdapter/MysqlSchemaAdapter) is untouched and its tests stay green (part of the 2240). mssql registry.selectStrategy throws the outcome on exhaustion; StrategyExhaustionError retained/exported. cli.ts (lines 76-80) catches ConnectivityUnavailableError at the DbgraphError boundary and renders formatOutcome(err.outcome) to stderr - no stack trace. cli/format/exhaustion.ts is a shim - BUT see W1.

### 5. dbgraph doctor content-free (US-043). VERDICT: PASS
src/core/present/doctor.ts formatDoctor surfaces ONLY shape fields. test/core/present/doctor-format.test.ts plants a schema (dbo.super_secret_table), a secret literal, and a host (prod-sqlserver.company.internal) and asserts not.toContain each, plus Password= / User Id= / Server= / Database= / Error-colon / a four-space stack-frame marker - real negative assertions, not existence-only. runDoctor (dispatch wires it via the barrel; ADR-004 respected) is non-throwing (a probe error becomes UNAVAILABLE_PROBE).

### 6. Probe non-throwing + cross-platform (US-039). VERDICT: PASS
MssqlCapabilityProbe.probe() wraps every detection in try/catch returning a negative result, never rejects. PATH detection uses an injected platform seam (win32 uses where, else uses which), shell:false, 3s timeout. Driver presence via import(tedious) resolving (no .connect()). pg/mysql/sqlite probes mirror the pattern.

### 7. Profile registry (US-040). VERDICT: PASS
SQLCMD_PROFILES seeds legacy-15.x as a DATA row (flags -y 0 -f o:65001, chunkSize 2033, hasHeader false, encoding utf8 - F-3/F-4/F-5/F-6). resolveProfile returns DEFAULT_PROFILE on miss - never throws.

### 8. Opt-in sqlcmd CI lane (US-044). VERDICT: PASS
.github/workflows/ci.yml sqlcmd-transport job: gated by (event_name == workflow_dispatch) OR (vars.DBGRAPH_SQLCMD_LANE == 1); the unit test job has NO needs on it (independent); install failure emits a notice + exit 0 (skip-with-notice via set +e / INSTALL_EXIT guard); pinned mssql-tools18; runs only the transport subset. Other integration jobs unchanged. YAML well-formed.

### 9. ADR-004 boundaries + determinism. VERDICT: PASS
test/architecture/boundaries.test.ts green. Core port capability-probe.ts + present/connectivity.ts + present/doctor.ts import only core types (no driver/child_process). The CLI imports ONLY the barrel - a grep for src/cli importing adapters returns NO matches. resolveProfile + the probe classes are re-exported through src/index.ts (the legal public seam) and consumed by the CLI via ../index.js. All new goldens/fixtures byte-stable; deterministic formatters.

## Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Probe reports without raising (US-039) | present driver+CLI | mssql/pg/mysql probe.test | COMPLIANT |
| | absent both reported not raised | probe tests | COMPLIANT |
| | timed-out/failed becomes unavailable | probe tests | COMPLIANT |
| | port driver-free | boundaries.test + import-surface | COMPLIANT |
| Typed non-blocking 3-option outcome (US-041) | pg driver absent | parity.test (pg) | COMPLIANT |
| | mssql exhaustion same 3 options | parity.test (mssql) | COMPLIANT |
| | run-it-yourself exact read-only SELECTs | connectivity-outcome.test, parity.test | COMPLIANT |
| | consented-install never installs without consent | connectivity-format.test | COMPLIANT |
| dbgraph doctor content-free (US-043) | reports capability/strategy/profile | doctor-format.test | COMPLIANT |
| | content-free safe to share | doctor-format.test (planted leak) | COMPLIANT |
| | unrecognized env reports not throws | doctor.test, doctor-format.test | COMPLIANT |
| Variant/version profile registry (US-040) | legacy-15.x from registry entry | profiles.test | COMPLIANT |
| | new env = profile entry | profiles.test | COMPLIANT |
| | unrecognized becomes conservative default | profiles.test | COMPLIANT |
| Profile-driven reassembly hardened (US-042) | chunked reassembles no trim | json-rows-reassembly.test | COMPLIANT |
| | non-UTF-8 decoded per encoding | json-rows-reassembly.test (F-5) | COMPLIANT |
| | malformed becomes typed actionable error | json-rows-reassembly.test | COMPLIANT |
| | golden-pinned exact-set | reassembly test + byte-identical goldens | COMPLIANT |
| Fixtures + opt-in CI lane (US-044) | F-1..F-9 content-free | fixtures-content-free.test | COMPLIANT |
| | opt-in lane does not block unit matrix | ci.yml shape + CI test | COMPLIANT |
| | flaky install skips with notice | ci.yml skip-with-notice guard | COMPLIANT |
| Exhaustion typed redacted actionable (connectivity MODIFIED) | lists each attempt+reason | registry.test, parity.test | COMPLIANT |
| | 3 options not raw throw | cli.test, parity.test | COMPLIANT |
| | transport/format/parse failure wrapped as typed TransportError | none found | UNTESTED / UNIMPLEMENTED |

Compliance: 23/24 scenarios compliant. The one gap - TransportError (E_TRANSPORT) - has neither implementation nor test.

## Issues Found

### CRITICAL (must fix before archive)

C1 - ConnectivityOutcome.summary leaks raw driver detail on the pg/mysql connect-failure path (content-free contract violated).
src/adapters/engines/pg/factory.ts:181-184 and src/adapters/engines/mysql/factory.ts:188-191 set summary = cause.message from the raw driver connect error. That message routinely carries the host, port, database name, and user (for example an authentication-failed-for-user message, or a getaddrinfo ENOTFOUND internal-host message). formatOutcome (present/connectivity.ts:40) renders outcome.summary verbatim to stderr. The spec REQUIRES the summary content-free (MUST NOT contain schema/identifier/secret - connectivity-diagnostics + the ConnectivityOutcome.summary JSDoc), and errors-connectivity.test.ts:198-208 asserts that very contract on a hand-built outcome - the adapters break it on a live, UNTESTED path (parity only exercises the safe driver-ABSENT branch).
Fix: replace cause.message with a content-free canned summary (for example: could not connect to the engine server, verify host/credentials/network); keep the raw cause as error.cause for debug only (never surfaced). Add a leak test feeding a connect-fail outcome whose cause carries a planted host/user and assert not.toContain.

C2 - TransportError (E_TRANSPORT) is specified but NOT implemented.
The connectivity MODIFIED requirement mandates that every transport/format/encoding/parse failure MUST be captured as a typed, REDACTED error (a TransportError with a stable code) and has a dedicated scenario (a transport/format/parse failure is redacted into a typed error). The proposal and design Affected-Areas tables both list TransportError (E_TRANSPORT). Zero matches in src/. Today the sqlcmd strategy throws a plain Error (json-rows.ts:130, sqlcmd.strategy.ts:261/316) carrying truncated stderr - not a typed redacted TransportError, and stderr is sliced but not guaranteed identifier-free.
Fix: add TransportError extends DbgraphError (E_TRANSPORT), wrap the spawn/parse failures in json-rows.ts + sqlcmd.strategy.ts, ensure the captured reason is redacted, and add the scenario test. Alternatively, if the team decides the typed-redacted reason is adequately carried by the existing flow, the spec must be amended - but as written, this is a gap.

### WARNING (should fix)

W1 - cli/format/exhaustion.ts shim does NOT use buildConnectivityOutcome and inline-duplicates STALE mssql queries (DRY/drift hazard).
exhaustion.ts:37-44 hand-codes only 3 mssql catalog SELECT strings and exhaustion.ts:66-90 hand-rolls the 3 options inline, then calls formatOutcome. The live registry path surfaces ALL 11 queries via the single builder. So the mssql run-it-yourself option has TWO divergent shapes (11 live vs 3 stale). Mitigant: formatExhaustionError is grep-confirmed UNREACHABLE from any live path (the registry throws ConnectivityUnavailableError, never StrategyExhaustionError, so the shim is never invoked) - it survives only via its own test. The risk is therefore latent (a drift trap on a dead path), not user-visible today.
Fix: either delete the shim entirely (no live caller), or rewrite it to delegate to buildConnectivityOutcome so it cannot drift. Do NOT leave 3 hand-copied query strings that silently rot when queries.ts changes.

W2 - Probe-to-profile selection is not wired into the live mssql extraction path (Task 4.3 partially delivered).
SqlcmdStrategy always uses the conservative default profile (the constructor resolves from an empty probe); it has no probe() and never measures the real sqlcmd variant/shape/encoding before runCatalog. The registry/profile/probe machinery is real and tested, and doctor resolves a live profile, but the actual sync cannot adapt to a non-15.x environment - it relies on the default flags matching. The proposal idea of a tiny FOR JSON round-trip learning shape/encoding is not exercised by extraction.
Fix: implement SqlcmdStrategy.probe() and thread the probe-resolved profile into the strategy before runCatalog, OR explicitly de-scope the round-trip in the spec/tasks and mark 4.3 as partial. tasks.md marks 4.3 done but it is partial.

### SUGGESTION (nice to have)

S1 - formatDoctor renders the CLI tool filesystem path (doctor.ts:96, for example a Windows user-profile path to a sqlcmd binary). A binary path is not schema/secret, so it satisfies the content-free definition, but a path can embed a username. Consider rendering presence-only (or basename) to keep the report maximally paste-safe.

S2 - Test-file names drift from the tasks doc (present/doctor.test.ts becomes doctor-format.test.ts, present/connectivity.test.ts becomes connectivity-format.test.ts, etc.). Harmless; the tests exist and pass. Reconcile the tasks doc paths during archive if you want the audit trail exact.

## Completeness

| Metric | Value |
|--------|-------|
| Batches (1-6) | 6/6 committed |
| Task items checked | All batch sub-items checked; per-batch GATE boxes (1.6, 4.4-inner) + the two DoD checklists left unchecked (tracking-only) |
| Task 4.3 | marked done but PARTIAL (see W2) |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Typed throw, not return-type change | YES | ConnectivityUnavailableError(outcome) caught at cli.ts boundary; happy path unchanged |
| Outcome/options live in core | YES | errors.ts core types; driver-free |
| probe optional on port; per-engine probe in adapters | YES | optional probe; MssqlCapabilityProbe etc. |
| SqlcmdProfile registry as data table | YES | SQLCMD_PROFILES + resolveProfile |
| reassembly extracted to json-rows.ts, byte-identical | YES | goldens byte-identical; integration green |
| doctor content-free CLI command | YES | formatDoctor shape-only + leak test |
| exhaustion.ts a thin shim delegating to formatOutcome | DEVIATED | hand-rolls options + stale inline queries (W1) |
| TransportError (E_TRANSPORT) | NOT DONE | C2 |

## Verdict

PASS WITH WARNINGS. The full gate is green (tsc 0, lint 0/0, 2240 unit + 206 integration tests pass, zero new deps), parity is genuinely PROVEN, and the mssql goldens are byte-identical. Two CRITICAL items block a clean archive: the content-free summary leak on the pg/mysql connect-failure path (C1) and the unimplemented spec-mandated TransportError (C2). Recommend a short sdd-apply pass to land C1 + C2 (and ideally W1/W2), then re-verify before archive.
