# Proposal: mssql config hardening + release-hygiene fixes

## Intent

A security audit of the shipped `1.1.0` package surfaced three defects to close for the `1.1.1`
release. The highest-value one is a **spec violation on the shipped code**: the mssql config READ
path accepts plaintext credentials, contradicting the canonical `cli-config` spec and SECURITY.md's
blanket claim. Two lower-severity, public-facing hygiene defects ride along in the same release.

- **M1 (MEDIUM — real gap):** `parseMssqlSource` (`src/infra/config/parse-config.ts:125`) uses bare
  `requireString` with NO `${env:VAR}` check, UNLIKE pg (`:167`), mysql (`:205`), mongodb (`:240`)
  and the mssql WRITE path (`src/cli/config/build-config.ts:82-87`). A plaintext server/user/password
  is silently accepted at read time — violating `openspec/specs/cli-config/spec.md:67-71` and leaving
  a read/write asymmetry within mssql. Read-rejection tests exist for pg/mysql/mongodb but NOT mssql.
- **M6 (MEDIUM):** installers default to a stale version — `install.sh:21` / `install.ps1:23` default
  `0.1.0` while the package is `1.1.0`; a `curl|sh` / `irm|iex` with no `--version` fetches a missing
  release. No guard prevents the drift.
- **I1 (LOW, public-facing):** `SECURITY.md:66-76` falsely claims the repo is `"private": true` with
  "no published release" (both false: public, on npm) and offers no coordinated-disclosure path.

## Scope

### In Scope
- M1: env-ref rejection in `parseMssqlSource` for server/database/user/password (+ port/domain when
  present), mirroring the sibling engines and the mssql write path; RED-first L-009 read-rejection test.
- M6: bump both installer default versions to track `package.json`, guarded by a new drift-guard UNIT
  test (runs in `npm test`).
- I1: rewrite SECURITY.md "Reporting a vulnerability" — remove the false private/no-release claims, add
  a GitHub private-vulnerability-reporting disclosure path, keep the accurate posture claims.
- One spec delta: `cli-config` MODIFIED (read-path rejection explicitly covers mssql).

### Out of Scope
- npx squat + mssql interop (sibling change `shipped-artifact-fixes`).
- mssql `[DYNAMIC SQL]` tokenizer granularity (separate change).
- TLS config fields (`trustServerCertificate`/`encrypt`) — backlog.
- Bumping `package.json` to `1.1.1` (release-cut concern; the drift guard forces installers to follow).
- Branch protection / secret scanning / npm token revocation (user GitHub actions).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cli-config`: the "Plaintext credentials are rejected" requirement is clarified to bind the mssql
  PARSE path explicitly (uniform across all dialects), closing the read/write asymmetry.

> I1 (SECURITY.md) has NO spec delta — no `security`/`docs` capability spec exists; it is untracked
> doc-only.

## Approach

Three surgical fixes across DIFFERENT files than the sibling change (config parse + installers + docs;
NOT `install.ts`/native-tedious/dist tests). M1 and M6 are STRICT TDD (RED first). I1 is a doc edit
verified only by the existing leak-scanner staying green. Full detail in `design.md` and `tasks.md`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/infra/config/parse-config.ts` | Modified | env-ref gate in `parseMssqlSource` |
| `test/cli/config/parse-config.test.ts` | Modified | L-009 mssql read-rejection cases |
| `install.sh` / `install.ps1` | Modified | default version tracks `package.json` |
| `test/bin/installer-default-version.test.ts` | New | drift guard (runs in `npm test`) |
| `SECURITY.md` | Modified | disclosure section rewrite |
| `specs/cli-config/spec.md` (delta) | New | mssql parse-path rejection |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| M1 gate breaks an existing plaintext-mssql fixture | Low | Verified: no test passes a literal mssql server through `parseConfig`; all use `${env:VAR}` |
| Installer bump drifts again at 1.1.1 cut | Low | Drift-guard unit test fails-closed until installers match `package.json` |
| SECURITY.md rewrite leaks a denylisted codename | Low | Generic language only; `no-secret-leak.test.ts` + pre-commit hook enforce |

## Rollback Plan

Each fix is an isolated diff. Revert per finding: M1 = revert `parseMssqlSource` guard + its tests;
M6 = restore `0.1.0` defaults + delete the guard test; I1 = restore the SECURITY.md section. No data,
schema, or API surface changes — nothing to migrate.

## Dependencies

- None external. May land concurrently with `shipped-artifact-fixes` Batch 2 (disjoint files).

## Success Criteria

- [ ] Plaintext mssql server/user/password at parse time raises `ConfigError` (env-ref accepted).
- [ ] `npm test` stays green at or above the current floor, plus the new tests.
- [ ] Both installers default to the current `package.json` version, guarded against future drift.
- [ ] SECURITY.md states only true claims and a real disclosure path; leak-scan stays green.
