# Archive Report: mssql-config-hardening

**Change:** mssql-config-hardening
**Archived:** 2026-07-11
**Archive destination:** `openspec/changes/archive/2026-07-11-mssql-config-hardening/`
**Artifact store:** openspec (files)
**Verify verdict:** ARCHIVE-READY (0 CRITICAL / 0 WARNING / 2 SUGGESTION)
**Commit:** 5bd43fc

## What shipped (1.1.1 security-audit release)

- **M1 — mssql plaintext-credential read rejection.** `parseMssqlSource` (`src/infra/config/parse-config.ts`) now rejects a plaintext `server`/`database`/`user`/`password` (and `port`/`domain` when present) via a new `assertEnvRef` helper, mirroring the pg/mysql/mongodb read guards and the mssql WRITE path — closing the read/write asymmetry.
- **M6 — installer drift-guard.** Both installers default to `package.json` `version`; new unit test `installer-default-version.test.ts` fails-closed on any future drift. The fail-closed SHA256 path is byte-identical.
- **I1 — SECURITY.md rewrite.** Removed false `"private"`/"no published release" claims; added a GitHub Private Vulnerability Reporting disclosure path + accurate supported-versions line; posture sections kept verbatim.

## Traceability (artifacts, openspec paths)

| Artifact | Path (in archive) |
|----------|-------------------|
| proposal | `2026-07-11-mssql-config-hardening/proposal.md` |
| spec delta — cli-config | `2026-07-11-mssql-config-hardening/specs/cli-config/spec.md` |
| design | `2026-07-11-mssql-config-hardening/design.md` |
| tasks | `2026-07-11-mssql-config-hardening/tasks.md` |
| verify-report | `2026-07-11-mssql-config-hardening/verify-report.md` |
| archive-report | `2026-07-11-mssql-config-hardening/archive-report.md` |

> No standalone `apply-progress.md` — progress was recorded inline in `tasks.md` (all `[x]`) for this XS single-batch change (noted as SUGGESTION in verify).

## Canonical spec merge applied

### `openspec/specs/cli-config/spec.md` — 1 MODIFIED

- **Requirement "Plaintext credentials are rejected, env refs resolved at runtime"** — gains a new paragraph mandating UNIFORM parse-time rejection across EVERY dialect's source parser (explicitly binding `parseMssqlSource` to reject plaintext `server`/`database`/`user`/`password` + `port`/`domain`, matching the sibling parsers and the mssql WRITE path; sqlite `file` remains the only literal-path identity), plus an args-fix "Previously" note; and a new scenario **"mssql plaintext identity field is rejected at parse time"**. All other scenarios (Inline plaintext rejected / Env refs resolve / Missing env var fails loudly) preserved verbatim.

**SECURITY.md (I1) has NO spec delta** — no `security`/`docs` capability spec governs its content; it is the live doc, verified only by the leak scanner.

## Notes

- SUGGESTIONs deferred: (1) pg/mysql read-path parity (still gate only `password`) — recommend a follow-up change; (2) standalone apply-progress artifact for shape consistency.
- `package.json` version NOT bumped (release-cut concern; the drift guard forces the installers to follow whenever it is bumped).

## SDD cycle

Planned → implemented (STRICT TDD) → verified (ARCHIVE-READY) → archived. Change complete.
