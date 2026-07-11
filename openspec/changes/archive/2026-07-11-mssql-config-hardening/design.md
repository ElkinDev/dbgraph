# Design: mssql-config-hardening

Three isolated fixes for the `1.1.1` security-audit release. Hexagonal boundaries untouched (config
parsing is infra; ADR-004 unaffected). Determinism/ADR-008 unaffected. No new runtime dependency.

---

## D1 — M1: env-ref rejection in `parseMssqlSource` (the security fix)

### Root cause (exact, with file:line)

`src/infra/config/parse-config.ts` — `parseMssqlSource` (lines 91-145) resolves identity fields with
bare `requireString` and NEVER calls `isEnvRef`:

- `:95` `const server = requireString(raw, 'server', 'source (mssql)')`
- `:96` `const database = requireString(raw, 'database', 'source (mssql)')`
- `:124` `const user = requireString(raw, 'user', 'source (mssql)')`
- `:125` `const password = requireString(raw, 'password', 'source (mssql)')`

The sibling parsers already gate on `isEnvRef` — pg `:167`, mysql `:205`, mongodb `:240` — and the
mssql WRITE path `src/cli/config/build-config.ts:82-87` (`requireEnvRef` on server/database/user/
password, and port/domain when present). The helper is already present in this file:
`ENV_REF_RE` (`:148`) + `isEnvRef` (`:153`). Because `isEnvRef` is a hoisted function declaration, it
is callable from `parseMssqlSource` even though it is declared below it.

### Decision — enforce on ALL identity fields present (match the WRITE path), not just password

The siblings gate only the secret (pg/mysql: `password`; mongodb: `uri`). For mssql the authoritative
reference is the mssql WRITE path, which rejects a plaintext `server`/`database`/`user`/`password`
(and `port`/`domain` when present). A byte-round-trip config (ADR-008) means a config the writer
refuses to emit MUST NOT be one the reader accepts. Therefore `parseMssqlSource` gates EVERY identity
field it reads — closing the read/write asymmetry WITHIN mssql and satisfying the spec's "ANY
inline/plaintext value in a connection-identity field."

Tradeoff: this makes the mssql READ path stricter than the pg/mysql READ paths (which still gate only
`password`). That cross-engine laxity in pg/mysql is a SEPARATE, pre-existing gap and is OUT OF SCOPE
here (the audit finding is mssql-specific). Noted as a follow-up, not fixed in this change.

### Exact fix

Add a small local helper next to `isEnvRef` (DRY — mssql needs 5-6 checks; inlining like the siblings
would repeat the throw block six times):

```ts
function assertEnvRef(field: string, value: string, exampleVar: string): void {
  if (!isEnvRef(value)) {
    throw new ConfigError(
      `source (mssql): field "${field}" must be a \${env:VAR} reference, not a literal value. ` +
        `Use an environment variable reference such as \${env:${exampleVar}}.`,
    );
  }
}
```

In `parseMssqlSource`, gate the fields that apply to BOTH auth branches immediately after they are
resolved (after `:97`):

```ts
  const server = requireString(raw, 'server', 'source (mssql)');
  const database = requireString(raw, 'database', 'source (mssql)');
  const port = optionalString(raw, 'port', 'source (mssql)');

  // Reject plaintext identity fields — mirror the pg/mysql/mongodb read guard and the
  // mssql WRITE path (build-config.ts:82-87). Applies to integrated AND credentialed modes.
  assertEnvRef('server', server, 'DBGRAPH_DB_HOST');
  assertEnvRef('database', database, 'DBGRAPH_DB_NAME');
  if (port !== undefined) assertEnvRef('port', port, 'DBGRAPH_DB_PORT');
```

The `integrated` early-return (`:112-121`) is now correctly guarded for server/database/port and
carries no credentials — unchanged otherwise. In the credentialed branch, gate the credential fields
after they are resolved (after `:126`):

```ts
  const user = requireString(raw, 'user', 'source (mssql)');
  const password = requireString(raw, 'password', 'source (mssql)');
  const domain = optionalString(raw, 'domain', 'source (mssql)');

  assertEnvRef('user', user, 'DBGRAPH_DB_USER');
  assertEnvRef('password', password, 'DBGRAPH_DB_PASSWORD');
  if (domain !== undefined) assertEnvRef('domain', domain, 'DBGRAPH_DB_DOMAIN');
```

### Blast-radius check (done during planning)

- Every existing mssql config in `test/**` uses `${env:VAR}` for all identity fields — verified: no
  test passes a literal mssql `server` through `parseConfig`.
- `resolve-secrets.test.ts` and `factory.test.ts` build `DbgraphConfig` objects DIRECTLY (post-parse)
  — they never call `parseConfig`, so the new gate cannot touch them.
- Error message contains `${env:` and names the field — matches the assertion style the pg test uses
  (`caught.message.toLowerCase()).toContain('password')` and `.toContain('${env:')`).

---

## D2 — M6: installer default version — DECISION: bump + drift-guard, NOT latest-fetch

### Decision

Set `install.sh` `DEFAULT_VERSION` (`:21`) and `install.ps1` default `$Version` (`:23`) to the value
in `package.json` `version` (currently `1.1.0`), and add a UNIT test that fails-closed if either
installer default ever drifts from `package.json`.

### Rationale (evidence) — why NOT latest-fetch

The mandate prefers latest-fetch "if it needs no new network calls." It DOES need new calls, and they
break existing contracts:

1. **New network dependency.** Today the installers hit ONLY the release download URL for the asset +
   `SHA256SUMS` (`install.sh` `fetch()` `:107-124`; `install.ps1` `:86-95`). Latest-fetch needs a NEW
   call to `api.github.com/releases/latest` (JSON) or a redirect-follow of `/releases/latest` (URL
   parse). The `binary-distribution` spec requires installers "use only shell builtins / OS-provided
   tools (no runtime dependency)" — JSON parsing in POSIX `sh` means fragile `grep`/`sed`, and the
   unauthenticated GitHub API is rate-limited.
2. **Breaks offline/deterministic testability.** `test/bin/install.smoke.test.ts` stubs the release via
   `DBGRAPH_DOWNLOAD_BASE` (local fixtures) and `--print-plan` with a FIXED `--version`. A default that
   reaches the live network cannot be exercised offline and undermines the pinned-plan test.
3. **Wrong tool for the failure mode.** The actual defect is DRIFT — a hardcoded default nobody bumped.
   A unit test that asserts `installer default == package.json version` guards that class of bug far
   more reliably than latest-fetch, with zero new runtime surface.

The fail-closed SHA256 contract (`install.sh:150-157`, `install.ps1:113-120`) is PRESERVED verbatim —
only the default literal changes.

### Version value & release-cut coupling

The installer default tracks `package.json`'s CURRENT value. This change does NOT bump `package.json`
to `1.1.1` (release-cut concern; `release-packaging`/smoke tests pin `--version` broadly — out of
scope). When the `1.1.1` cut bumps `package.json`, the drift guard goes RED until the installers are
bumped too — exactly the safety behavior intended. The guard turns "someone forgot to bump the
installer" into a build failure forever.

### Drift-guard test (plain unit test — MUST run in `npm test`)

Place at `test/bin/installer-default-version.test.ts` (a `.test.ts`, NOT `.smoke.test.ts` — the smoke
suite is excluded from `npm test` per `vitest.config.ts:16`; this test must count toward the gate). It
reads text only, spawns nothing:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgVersion = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
).version as string;

it('install.sh DEFAULT_VERSION matches package.json version', () => {
  const sh = readFileSync(join(repoRoot, 'install.sh'), 'utf-8');
  const m = sh.match(/DEFAULT_VERSION='([^']+)'/);
  expect(m?.[1]).toBe(pkgVersion);
});

it('install.ps1 default $Version matches package.json version', () => {
  const ps1 = readFileSync(join(repoRoot, 'install.ps1'), 'utf-8');
  // param(... [string]$Version = $(if ($env:DBGRAPH_VERSION) {...} else { '1.1.0' }) ...)
  const m = ps1.match(/\$Version\s*=\s*\$\(if \(\$env:DBGRAPH_VERSION\).*?else \{\s*'([^']+)'\s*\}/s);
  expect(m?.[1]).toBe(pkgVersion);
});
```

---

## D3 — I1: SECURITY.md "Reporting a vulnerability" rewrite (doc-only, no spec)

No `security`/`docs` capability spec exists — SECURITY.md content is untracked. Only the leak-scanner
(`test/security/no-secret-leak.test.ts` + pre-commit hook) governs it, and it must stay green. Edit
ONLY lines 64-76 (the "Reporting a vulnerability" section); the posture sections (1-63) are accurate
and stay verbatim.

### Rewrite outline

- **REMOVE** the false claims:
  - "This repository is currently **private** (`package.json` `"private": true`)" — package.json has
    NO `"private"` key; the repo is public.
  - "and has no published release" / "Because there is no published release yet, there is no
    supported-version matrix" — `@elkindev/dbgraph` is published on npm (1.1.x).
- **ADD** a real coordinated-disclosure path:
  - Report privately via GitHub Private Vulnerability Reporting (repo → Security → "Report a
    vulnerability") on the public repository; do NOT open a public issue for anything
    security-sensitive.
  - Include affected version/commit, impact, and reproduction steps; allow a reasonable window before
    public disclosure.
- **ADD** an accurate supported-versions line: the latest published `@elkindev/dbgraph` release line
  is supported; older versions are not.
- **KEEP** the trace-to-spec style and the accurate posture claims (read-only by construction, env-ref
  secrets, content-free diagnostics, local-only storage, no codenames).
- **GUARDRAIL:** generic language only — no company/product codename may appear (leak-scan enforces).

---

## Test strategy summary

| Fix | Test | Suite | RED-first |
|-----|------|-------|-----------|
| M1 | `test/cli/config/parse-config.test.ts` — L-009 mssql read-rejection cases | `npm test` (unit) | YES |
| M6 | `test/bin/installer-default-version.test.ts` — drift guard | `npm test` (unit) | YES |
| I1 | none new; `no-secret-leak.test.ts` stays green | `npm test` | n/a |

Gate: `npm test` (STRICT TDD, floor = current green baseline), `npm run lint`, `npx tsc --noEmit`.
