# Tasks: mssql-config-hardening

**Mode:** STRICT TDD (RED → GREEN → REFACTOR). Test runner: `npm test` (vitest).
**Batch:** ONE batch — XS/S change, three disjoint fixes.
**Files:** config parse + installers + docs. Disjoint from sibling `shipped-artifact-fixes` (does NOT
touch `install.ts` / native-tedious / dist tests).

## Gate floor (READ FIRST at apply start)

Before writing anything, run `npm test` and RECORD the baseline pass/skip count. Expected ≈ **3731
passed / 4 skipped** at HEAD `d99136f`, HIGHER if `shipped-artifact-fixes` Batch 2 has landed. The
final gate MUST be `baseline + new tests` and MUST NEVER drop below the recorded baseline.

---

## Phase 1 — M1: mssql plaintext-credential rejection (security, RED-first)

- [x] 1.1 **RED** — In `test/cli/config/parse-config.test.ts`, add an L-009 read-rejection suite for
  mssql mirroring the pg suite (`test/infra/config/parse-config-pg.test.ts:91-141`):
  - plaintext `server` (e.g. `'localhost'`) with env-ref database/user/password → `toThrow(ConfigError)`
  - plaintext `user` → `toThrow(ConfigError)`
  - plaintext `password` (e.g. `'s3cr3t_literal'`) → `toThrow(ConfigError)`
  - plaintext `database` → `toThrow(ConfigError)`
  - `ConfigError` message contains the field name AND `${env:`
  - the all-env-ref `validMssql` config → `not.toThrow()` (regression guard)
  Run `npm test` → the plaintext cases FAIL (parse currently accepts them). CONFIRM RED.
  DONE: 5 plaintext/message cases failed RED ("expected function to throw ... but it didn't"); regression guard passed.
- [x] 1.2 **GREEN** — In `src/infra/config/parse-config.ts`, add the `assertEnvRef(field, value,
  exampleVar)` helper next to `isEnvRef` (`:148-155`) and call it in `parseMssqlSource` per design D1:
  server/database/port (both branches, after `:97`); user/password/domain (credentialed branch, after
  `:126`). Run `npm test` → GREEN. No other engine's parser is touched.
  DONE: helper added after isEnvRef; gates server/database/port + user/password/domain; all 6 M1 tests green.
- [x] 1.3 **REFACTOR** — Confirm no duplication remains and the integrated-mode path still parses with
  no credentials (existing A1.5 suite `:118-237` stays green). Re-run `npm test`.
  DONE: assertEnvRef dedupes the 6 checks; A1.5 integrated suite stays green.

## Phase 2 — M6: installer default version + drift guard (RED-first)

- [x] 2.1 **RED** — Add `test/bin/installer-default-version.test.ts` (a plain `.test.ts`, NOT
  `.smoke.test.ts`, so it runs under `npm test` per `vitest.config.ts:16`) asserting `install.sh`
  `DEFAULT_VERSION` and `install.ps1` default `$Version` each equal `package.json` `version` (design
  D2). Run `npm test` → FAILS (`0.1.0` ≠ `1.1.0`). CONFIRM RED.
  DONE: both assertions failed RED ("expected '0.1.0' to be '1.1.0'").
- [x] 2.2 **GREEN** — Set `install.sh:21` `DEFAULT_VERSION='<package.json version>'` and `install.ps1:23`
  default `else { '<package.json version>' }` to the CURRENT `package.json` version. Change ONLY the
  default literal — the fail-closed SHA256 path (`install.sh:150-157`, `install.ps1:113-120`) stays
  byte-for-byte. Run `npm test` → GREEN. Also confirm `npm run smoke:binary` still passes locally if
  available (the smoke suite is unaffected).
  DONE: both defaults set to 1.1.0 (default literals only); SHA256 path untouched; both drift-guard tests green.

## Phase 3 — I1: SECURITY.md disclosure rewrite (doc-only)

- [x] 3.1 Rewrite ONLY `SECURITY.md` lines 64-76 ("Reporting a vulnerability") per design D3: remove
  the false `"private": true` / "no published release" / "no supported-version matrix" claims; add the
  GitHub Private Vulnerability Reporting path + an accurate supported-versions line; keep the posture
  sections (1-63) verbatim. Generic language only — NO codename (legal guardrail).
  DONE: false claims removed; GitHub PVR path (Security → Report a vulnerability) + Supported versions subsection added; posture sections 1-63 verbatim; generic language.
- [x] 3.2 Run `npm test` — `test/security/no-secret-leak.test.ts` MUST stay green (no leaked
  identifier). No new test for I1.
  DONE: full suite green (leak-scan green within it).

## Phase 4 — Spec alignment + full gate

- [x] 4.1 Verify the code matches the `cli-config` delta
  (`openspec/changes/mssql-config-hardening/specs/cli-config/spec.md`) — the "mssql plaintext identity
  field is rejected at parse time" scenario is satisfied by Phase 1.
  DONE: parseMssqlSource rejects plaintext server/database/user/password (+ port/domain) via assertEnvRef; all-env-ref parses.
- [x] 4.2 **Full gate:** `npm test` (all green; count = recorded baseline + Phase 1 + Phase 2 tests),
  `npm run lint`, `npx tsc --noEmit`. Record final counts in apply-progress.
  DONE: baseline 3731 passed/4 skipped → final 3739 passed/4 skipped (+8: 6 M1 + 2 M6); tsc clean; lint 0/0.

---

## Definition of done

- [x] Plaintext mssql server/user/password/database at parse → `ConfigError`; all-env-ref → OK.
- [x] Both installers default to `package.json` version; drift guard green and enforcing.
- [x] SECURITY.md states only true claims + a real disclosure path; leak-scan green.
- [x] `npm test` ≥ baseline + new tests; lint + typecheck clean.
- [x] Only files under scope touched; `package.json` version NOT bumped; no commit/push.
