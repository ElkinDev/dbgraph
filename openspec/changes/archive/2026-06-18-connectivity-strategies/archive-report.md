# Archive Report: connectivity-strategies

**Change**: connectivity-strategies
**Archived**: 2026-06-18
**Artifact store**: openspec
**Final verdict**: PASS — zero carry-over (0 CRITICAL / 0 WARNING / 2 non-blocking SUGGESTIONS)
**Repo context**: All 5 CI jobs green on `main` (matrix ubuntu/windows × 22.x/24.x + `mssql-integration`).
Verify cycle: initial PASS-WITH-WARNINGS (WARN-1 illegal-derived-table-ORDER-BY in FOR JSON, WARN-2
log-secret/verbosity tests, WARN-3 3-candidate detection shortfall) → REMEDIATION batch → re-verify PASS.
WARN-1 validated by the gated `queries-for-json.integration.test.ts` running FOR JSON SQL against a real
SQL Server container (no Msg 1033); `npm test` 1491/1491 (98 files).

---

## Executive Summary

The connectivity-strategies change delivered the engine-agnostic `ConnectivityStrategy` port plus the
complete SQL Server strategy stack, unblocking Phase 6 real-validation on integrated-security-only
machines. The change ran through six apply batches (A–F) plus a remediation batch, was verified twice,
and is now closed with zero carry-over. The `connectivity` capability spec is promoted as a NEW canonical
spec; the `mssql-extraction` and `cli-config` canonical specs are extended with the delta requirements.

---

## What Shipped

### Core architecture

| Deliverable | Description |
|-------------|-------------|
| `src/core/ports/connectivity-strategy.ts` | Driver-free `ConnectivityStrategy` port (ADR-004); imports ONLY `RawCatalog` + `ExtractionScope`; ZERO driver/tool/`child_process` imports. Exposes `id`, `detect()`, `canConnect()`, `runCatalog()`, optional `close()`, optional `fingerprint()`. |
| `src/core/errors.ts` | `StrategyExhaustionError` (`E_STRATEGY_EXHAUSTION`) added; extends `DbgraphError`; `readonly attempts: readonly StrategyAttempt[]`; message lists each strategy tried + reason. |
| `src/core/ports/schema-adapter.ts` | `MssqlAdapterConfig.authentication` gains additive `{ type: 'integrated' }` union member (no credentials). |

### SQL Server strategies (under `src/adapters/engines/mssql/strategies/`)

| File | Description |
|------|-------------|
| `registry.ts` | `buildMssqlStrategies(config, deps)` — ordered native (omitted for integrated) → sqlcmd → manual-dump → consented-install. `selectStrategy(strategies, logger)` — first detect+canConnect wins, logged via `Logger` port. `detectAllCandidates()` — probes all 3 SQL Server external-tool candidates. |
| `native-tedious.strategy.ts` | `NativeTediousStrategy` — wraps existing factory pool/connect/error-map; `detect()` returns `available: type !== 'integrated'`; back-compatible. |
| `sqlcmd.strategy.ts` | `SqlcmdStrategy` — `detect()` probes `where`/`which` + `-?` capability; `canConnect()` via `sqlcmd -E SELECT 1`; `runCatalog()` appends `FOR JSON PATH, INCLUDE_NULL_VALUES` at call site (top-level, not derived-table), reassembles multi-line stdout, validates via `json-rows.ts`, feeds UNCHANGED `buildMssqlRawCatalog`. ARGV arrays, `{ shell: false }`. |
| `json-rows.ts` | Shared `parseJsonRows()` — BIT `0/1`→bool (8 fields), numeric-string→number (5+ id/ordinal fields), absent nullable text→null, malformed→throw. |
| `manual-dump.strategy.ts` | `ManualDumpStrategy` — `detect()` checks file exists under `.dbgraph/dumps/`; `runCatalog()` reads one combined JSON (`MssqlRowInput`), validates via `json-rows.ts`, feeds `buildMssqlRawCatalog`. |
| `dump-emitter.ts` | `emitDumpScript()` — composes deterministic 11-family `.sql` from `queries.ts` constants; each wrapped `FOR JSON PATH, INCLUDE_NULL_VALUES`; aliased to `MssqlRowInput` key; read-only (no write verb). Exports `DUMP_DIR`, `DUMP_FILE`, `CATALOG_FAMILY_KEYS`. |
| `install-recipes.ts` | `getRecipes(tool, os)` — official Microsoft install recipes per OS (win32 winget `Microsoft.Sqlcmd`, darwin brew, linux url). |
| `consented-install.strategy.ts` | `ConsentedInstallStrategy` — `detect()` always available; `canConnect()` always false; `runCatalog()` prints consent notice + official instructions via `Logger.info` then throws `StrategyExhaustionError`; `// B2: automated execution goes here` seam marked. |
| `invoke-sqlcmd.strategy.ts` | `InvokeSqlcmdStrategy` — detection only; probes `pwsh Get-Command Invoke-Sqlcmd` + powershell fallback; `canConnect()` false; `runCatalog()` throws. |
| `odbc-driver.strategy.ts` | `OdbcDriverStrategy` — detection only; probes Windows registry ODBC Drivers key; `canConnect()` false; `runCatalog()` throws. |

### Config layer

| File | Change |
|------|--------|
| `src/infra/config/schema.ts` | `MssqlSource.user/password` now optional; `auth?: 'sql'|'ntlm'|'integrated'` discriminator added. |
| `src/infra/config/parse-config.ts` | `parseMssqlSource` integrated arm: requires ONLY `server`/`database`, no credential fields. |
| `src/infra/config/resolve-secrets.ts` | `resolveMssqlSource` skips absent credential fields for integrated; `missingCredential()` helper. |
| `src/infra/open-connections.ts` | Integrated arm added; optional `logger` parameter threaded to factory. |
| `src/adapters/engines/mssql/factory.ts` | Rewritten as registry selector (`StrategyBackedSchemaAdapter`); `fingerprint()` throws for strategies not implementing it (SUGG-3 fixed). |

### CLI UX

| File | Change |
|------|--------|
| `src/cli/format/exhaustion.ts` | `formatExhaustionError(err)` — option (a) manual-dump path + script/output location; option (b) guided install + official URL; B2 deferred notice; attempt list. |

### Tests

- 234 new tests across 12 new test files (Batches A–F + REMEDIATION): `json-rows.test.ts` (37), `sqlcmd.test.ts` (23+), `registry.test.ts` (36), `manual-dump.test.ts` (19), `dump-emitter.test.ts` (12+), `install-recipes.test.ts` (9), `consented-install.test.ts` (14), `exhaustion.test.ts` (10), `selection-e2e.test.ts` (8), `invoke-sqlcmd.test.ts` (11), `odbc-driver.test.ts` (11), `connectivity-strategy.test.ts` (10+).
- Gated integration test: `queries-for-json.integration.test.ts` (12 assertions; excluded from `npm test`; `DBGRAPH_INTEGRATION=1` + Testcontainers).
- Golden fixture: `test/fixtures/mssql/dumps/mssql-dump-golden.json` (anonymized/synthetic; BIT fields as 0/1; byte-identical on re-run — ADR-008).

### Other

| Path | Change |
|------|--------|
| `.gitignore` | Explicit `.dbgraph/dumps/` entry with R8 comment (sensitive schema/proc source). |
| `src/adapters/engines/mssql/queries.ts` | JSDoc updated to document two-path usage; SQL constants unchanged. |

---

## Verify Cycle Summary

| Cycle | Date | Verdict | Issues |
|-------|------|---------|--------|
| Initial verify | 2026-06-18 | PASS WITH WARNINGS | WARN-1 (derived-table ORDER BY in FOR JSON, likely Msg 1033) + WARN-2 (logger no-secret/verbosity not pinned by test) + WARN-3 (only 1 candidate probed instead of ≥3) + SUGG-1/2/3 |
| REMEDIATION batch | 2026-06-18 | Applied | WARN-1 fixed (top-level FOR JSON); WARN-2 fixed (4 regression tests); WARN-3 fixed (InvokeSqlcmd + OdbcDriver strategies); SUGG-3 fixed (fingerprint throws); SUGG-1/2 addressed |
| Re-verify | 2026-06-18 | PASS — zero carry-over | 0 CRITICAL / 0 WARNING / 2 SUGGESTION (non-blocking); 1491/1491 tests; all 5 CI jobs green |

### WARN-1 resolution detail

The initial implementation used a derived-table subquery wrap (`SELECT * FROM (...) AS _rows FOR JSON PATH`) which is ILLEGAL in SQL Server when the inner query has an ORDER BY without TOP/OFFSET-FETCH (Msg 1033). Fix: `catalogSql()` in `sqlcmd.strategy.ts` and `wrapFamily()` in `dump-emitter.ts` now append `FOR JSON PATH, INCLUDE_NULL_VALUES` at the TOP LEVEL directly after the plain `queries.ts` SELECT. The two-path insight: `queries.ts` constants serve both tedious (tabular rows) and sqlcmd (FOR JSON), so FOR JSON MUST be appended at the call site only. Validated by the gated `queries-for-json.integration.test.ts` which ran 11 families + fingerprint against a real SQL Server container with no Msg 1033.

---

## Final Gates Checklist

- [x] `npx tsc --noEmit` — CLEAN (exit 0, 0 errors)
- [x] `npm run lint` — 0 errors / 0 warnings (exit 0)
- [x] `npm test` — 1491/1491 PASS (exit 0, 98 test files)
- [x] All 5 CI jobs green on `main`: ubuntu-22.x, ubuntu-24.x, windows-22.x, windows-24.x, mssql-integration
- [x] Zero CRITICAL findings
- [x] Zero WARNING findings (all 3 WARNINGs resolved in REMEDIATION batch)
- [x] Spec compliance: 30/30 COMPLIANT (after remediation; pre-remediation 27/30 with 3 PARTIAL)
- [x] Hexagonal boundaries: port imports ONLY `RawCatalog`/`ExtractionScope`; strategies under `src/adapters/engines/mssql/strategies/`; `exhaustion.ts` imports only the public barrel (no adapter imports)
- [x] Read-only: write-verb scanner covers `strategies/` via `engines/**` glob; F6.1 regression guard; all 8+ strategy files clean (catalog SELECTs + FOR JSON PATH; winget/URL strings not SQL-looking)
- [x] Security: no validation-database codename in any tracked file (leak-scanner ZERO); no inline credentials; dump dir gitignored
- [x] ZERO new npm dependencies (`node:child_process` only — Node builtin; ADR-006/ADR-007 intact)
- [x] ADR-008: manual-dump golden byte-identical on re-run; selection-e2e catalog byte-identical
- [x] L-009 actual qnames: `app.accounts` and `app.sessions` asserted via real `SqliteGraphStore.getNodesByKind`

---

## Backlog (deferred — not carry-over)

### SUGG-A (non-blocking): Stale fingerprint docstring

`factory.ts:64-68` still says `fingerprint()` falls back to a deterministic hash, but the body throws. Same stale wording in `connectivity-strategy.ts:86-88`. The BEHAVIOR is correct (throws — SUGG-3 fixed). Only the JSDoc/comment is out of date. Fix: update the two docstrings to say "throws if strategy does not implement `fingerprint()`". No functional impact.

### SUGG-B (non-blocking): Missing explicit test for fingerprint-throw path

`apply-progress.md` TDD-evidence table claims a `factory.test.ts` SUGG-3 test for the `StrategyBackedSchemaAdapter.fingerprint()` throw path. No such test was found in `test/` (the only fingerprint-throws test is in `mssql-schema-adapter.test.ts:351`, unrelated). The BEHAVIOR is correctly implemented (`factory.ts:83-86`) and the branch is dead today (every winning strategy implements `fingerprint()`). Fix: add an explicit unit test asserting the throw, or correct the apply-progress claim. No functional impact.

### DEFERRED B2: Automated installer execution

The `// B2: automated execution goes here` seam in `consented-install.strategy.ts` is intentionally left for a future follow-up change. The current B1 delivery prints official install instructions behind a consent notice but does NOT spawn any installer. B2 (consented `spawn` of winget/brew/official URL installer) is a localized change at that seam and does not require touching core or the strategy port.

---

## Phase 6 Unblock Note

This change UNBLOCKS Phase 6 (real validation against a corporate SQL Server that permits ONLY Windows Integrated Security). The `sqlcmd -E` transparent path is now in place and wired: on a machine where `sqlcmd` is installed (e.g. via SSMS or the `Microsoft.Sqlcmd` winget package), `createMssqlSchemaAdapter` with `auth: integrated` will auto-detect sqlcmd, connect via `-E`, extract the catalog through the UNCHANGED `map.ts`, and return a `RawCatalog` identical to the native path.

The integrated-auth sqlcmd TRANSPORT has been validated for SQL syntax (FOR JSON PATH, Msg 1033 resolved) via the gated integration test, but the actual end-to-end run on the real corporate machine remains a Phase 6 manual item. Phase 6 should:
1. Set `auth: integrated` in the config (no credentials needed).
2. Run `dbgraph sync` on the integrated-security-only machine.
3. Verify the catalog is extracted correctly via the sqlcmd strategy.
4. Confirm `app.accounts`/`app.sessions` (or the real schema equivalent) are present.

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|----------------|
| `connectivity` | Created (new capability — full spec, no prior spec; promoted from change spec) | `openspec/specs/connectivity/spec.md` |
| `mssql-extraction` | Updated (delta requirements appended) | `openspec/specs/mssql-extraction/spec.md` |
| `cli-config` | Updated (delta requirements appended) | `openspec/specs/cli-config/spec.md` |

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/connectivity/spec.md` | Present (new capability — complete spec; promoted to canonical) |
| `specs/mssql-extraction/spec.md` | Present (delta — 4 ADDED requirements for integrated auth + sqlcmd + manual-dump + read-only reinforcement) |
| `specs/cli-config/spec.md` | Present (delta — 2 ADDED requirements for integrated config + exhaustion UX) |
| `design.md` | Present (7 architecture decisions; full data flow diagram; file changes table) |
| `tasks.md` | Present (30/30 tasks complete; all batches A–F marked [x]) |
| `apply-progress.md` | Present (Batches A, B, C, D, E, F + REMEDIATION — all complete; gate results per batch) |
| `verify-report.md` | Present (re-verify PASS, 0 CRITICAL / 0 WARNING / 2 SUGGESTION, 1491/1491 tests; historical initial PASS-WITH-WARNINGS preserved) |
| `archive-report.md` | This file |

---

## SDD Cycle Complete

connectivity-strategies has been fully planned, implemented, verified, and archived.
The `connectivity` capability spec is promoted as a new canonical spec at `openspec/specs/connectivity/spec.md`.
The `mssql-extraction` and `cli-config` specs are extended at their canonical paths.
The change folder is closed at `openspec/changes/archive/2026-06-18-connectivity-strategies/`.

Next recommended change: Phase 6 — real validation on integrated-security-only machines via the sqlcmd
transparent path. The integrated-auth transport is wired and SQL-syntax-validated; Phase 6 exercises it
against the actual target database. No carry-over from connectivity-strategies.
