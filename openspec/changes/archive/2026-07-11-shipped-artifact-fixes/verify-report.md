# Verify Report: shipped-artifact-fixes

**Verdict:** ARCHIVE-READY
**Date:** 2026-07-11
**Commits verified:** f04916d, d99136f, b89147f
**Gate:** `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` 3731 passed | 4 skipped (3735) · gated `DBGRAPH_INTEGRATION=1 npm run test:integration` dist-connect GREEN.

## Findings summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| WARNING | 1 (environmental — resolved) |
| SUGGESTION | 2 |

## What verify reproduced first-hand

- **Bug 2 interop RED/GREEN (dist tier).** Transiently reverted the interop fix in `native-tedious.strategy.ts`, rebuilt, and ran the gated dist-level test against the PRE-FIX `dist/index.cjs`: child reported `{ ok:false, name:"ConnectivityUnavailableError" }` (raw `const { ConnectionPool } = mssqlMod` → `undefined` under Node's real CJS→ESM interop → `new undefined()` swallowed by `canConnect()` → strategies exhausted). Restored via `git checkout` + rebuild; post-fix dist connects + extracts (engine=mssql, schemas⊇dbo, objectCount>0). GREEN reproduced.
- **Bug 1 squat / 404.** Confirmed against the live registry that the bare `dbgraph-mcp` name resolves E404, and that the published `@elkindev/dbgraph@1.1.0` bin map is `dbgraph-mcp → dist/mcp.js`. The scoped `npx -y -p @elkindev/dbgraph dbgraph-mcp` invocation resolves the in-package bin — squat vector closed.
- **Unit tier.** mssql interop unit RED (inject `{ default: { ConnectionPool } }` → `new undefined()`) → GREEN (`mod['ConnectionPool'] ?? mod['default']?.['ConnectionPool']`), 4/4. Install goldens: 52 arg sites re-blessed to the scoped form; 223/223 install tests green.
- **Guardrail:** `no-secret-leak.test.ts` green; no validation-database codename in any touched artifact.

## WARNING (1) — environmental, resolved

- **Concurrent-sibling tree contamination.** A transient full-suite run surfaced failures traceable to a CONCURRENT sibling change's uncommitted tree state (not this change's edits). Re-running against this change's isolated commits (f04916d/d99136f/b89147f) was clean at the recorded floor. NOT a defect in `shipped-artifact-fixes`; resolved once the sibling tree settled. No code action required.

## SUGGESTION (2) — non-blocking

1. **Assert the skip-count explicitly.** The dist-level test self-skips cleanly (2 skipped) when Docker/dist is absent; a direct assertion on the skip count would pin that behavior against future regressions.
2. **Refresh the "12 vs 13 integration suites" wording.** A cosmetic count reference in progress notes drifted after the new `dist-connect.integration.test.ts` landed; update the human-readable suite count. Purely descriptive.

## Spec-scenario coverage

Every scenario in both delta specs (mcp-server 2 MODIFIED install requirements; mssql-extraction 2 ADDED interop + dist-tier requirements) is satisfied by the shipped code and tests. 12/12 apply tasks complete.
