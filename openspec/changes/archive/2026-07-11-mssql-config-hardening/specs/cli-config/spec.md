# cli-config — delta (mssql-config-hardening)

> Change: `mssql-config-hardening`. This delta MODIFIES one existing requirement to make the
> plaintext-credential rejection bind the mssql PARSE path explicitly, closing the read/write
> asymmetry the security audit exposed (M1). No requirement is added or removed. SECURITY.md (I1)
> is doc-only — no capability spec governs its content, so it carries NO delta.

## MODIFIED Requirements

### Requirement: Plaintext credentials are rejected, env refs resolved at runtime

The config layer SHALL reject ANY inline/plaintext value in a connection-identity field: a literal
password, a literal host/port/user/domain, or a connection URL embedding credentials MUST raise
`ConfigError` rather than be accepted. At runtime, `${env:VAR}` references MUST be resolved from
`process.env`; a referenced variable that is unset MUST raise `ConfigError` naming the missing variable
(it MUST NOT silently resolve to empty). A resolved connection URL MUST NEVER be logged.

This rejection SHALL apply UNIFORMLY at PARSE time across EVERY dialect's source parser — no engine is
exempt. In particular, the mssql parser (`parseMssqlSource`) MUST reject a plaintext
`server`/`database`/`user`/`password` (and `port`/`domain` when present) EXACTLY as the pg, mysql and
mongodb parsers already do, and EXACTLY as the mssql WRITE path (`buildConfig`) already does — so a
config the writer refuses to emit can NEVER be accepted by the reader. The sqlite `file` field remains
the only identity value permitted to be a literal path.
(Previously: `parseMssqlSource` validated required fields with a bare non-empty-string check and did
NOT enforce the `${env:VAR}` reference, so a plaintext mssql credential was silently accepted at read
time — a read/write asymmetry and a violation of this requirement.)

#### Scenario: Inline plaintext credential is rejected

- GIVEN a config where a password, host, or a credential-bearing URL is written as a literal value (not `${env:VAR}`)
- WHEN the config is parsed or written
- THEN it rejects with `ConfigError` instructing the user to use a `${env:VAR}` reference

#### Scenario: mssql plaintext identity field is rejected at parse time

- GIVEN an mssql config whose `server`, `user`, or `password` is written as a literal value (not `${env:VAR}`)
- WHEN `parseConfig` validates it
- THEN it rejects with `ConfigError` naming the offending field and instructing the user to use a `${env:VAR}` reference
- AND an mssql config whose every identity field is a `${env:VAR}` reference parses successfully

#### Scenario: Env references resolve from process.env at runtime

- GIVEN a valid config with `${env:DBGRAPH_DB_HOST}` and the variable set in `process.env`
- WHEN the connection identity is resolved for a command
- THEN each reference is replaced by its `process.env` value
- AND the resolved connection URL is never written to any log or stdout

#### Scenario: Missing environment variable fails loudly

- GIVEN a valid config referencing `${env:DBGRAPH_DB_PASSWORD}` that is unset in `process.env`
- WHEN the connection identity is resolved
- THEN it rejects with `ConfigError` naming the missing variable
- AND it does NOT resolve to an empty or partial credential
