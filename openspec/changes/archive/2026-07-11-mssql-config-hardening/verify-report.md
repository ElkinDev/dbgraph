# Verify Report: mssql-config-hardening

**Verdict:** ARCHIVE-READY
**Date:** 2026-07-11
**Commit verified:** 5bd43fc
**Gate:** `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` 3739 passed | 4 skipped (baseline 3731 + 6 M1 + 2 M6).

## Findings summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| WARNING | 0 |
| SUGGESTION | 2 |

## What verify reproduced first-hand

- **M1 pre-fix RED (isolated worktree).** In an isolated worktree at the pre-fix state, a plaintext mssql `server`/`user`/`password` passed through `parseConfig` was ACCEPTED (no throw) — reproducing the read-path spec violation. Post-fix (`assertEnvRef` gating server/database/port + user/password/domain in `parseMssqlSource`), the same inputs raise `ConfigError` naming the field and `${env:`, while an all-`${env:VAR}` mssql config parses successfully. RED→GREEN reproduced; the pg/mysql/mongodb read guards and the mssql WRITE path (`buildConfig`) are unchanged.
- **M6 drift guard.** `test/bin/installer-default-version.test.ts` fails-closed when either installer default drifts from `package.json` `version`; both installers now default to the current version (default literal only — the fail-closed SHA256 path is byte-identical).
- **I1 SECURITY.md.** The false `"private": true` / "no published release" claims are removed; a GitHub Private Vulnerability Reporting disclosure path + accurate supported-versions line added; posture sections 1-63 verbatim.
- **Guardrail:** `no-secret-leak.test.ts` green; SECURITY.md uses generic language — no denylisted codename.

## SUGGESTION (2) — non-blocking

1. **pg / mysql read-path parity (deferred follow-up).** The mssql READ path now gates EVERY identity field, but the pg and mysql READ paths still gate only `password` (a pre-existing, cross-engine laxity, explicitly out of scope here per design D1). Recommend a follow-up change to bring pg/mysql read guards to full-field parity.
2. **Standalone apply-progress artifact.** This XS change ran as a single batch and recorded progress inline in `tasks.md` (all `[x]`) rather than a separate `apply-progress.md`. Cosmetic — a standalone artifact would match the sibling changes' shape.

## Spec-scenario coverage

The cli-config MODIFIED requirement "Plaintext credentials are rejected, env refs resolved at runtime" — including the new "mssql plaintext identity field is rejected at parse time" scenario — is satisfied by Phase 1. SECURITY.md (I1) is doc-only with NO capability spec, governed solely by the leak scanner (green). All DoD items checked.
