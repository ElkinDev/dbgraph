# CLI & Config Specification (delta — connectivity-strategies)

## Purpose

This delta ADDS configuration and UX surface for integrated-security and external-tool connectivity. It
adds an `integrated` SQL Server auth mode that requires and resolves NO credentials, and a CLI/UX
fallback for when every connectivity strategy is exhausted: present the user (a) the manual-dump path
(the emitted script + where to place its output) and (b) a GUIDED install recipe (official source,
consent-gated). It honors the INVIOLABLE secret-safety rules of the main spec: identity fields stay
`${env:VAR}`-only, integrated mode carries no credential to resolve, and resolved values are never
logged. Stories: US-001, US-033; ADR-004.

## ADDED Requirements

### Requirement: integrated SQL Server auth mode requires no credentials

The config layer SHALL accept an `integrated` SQL Server authentication mode that carries NO `user`,
`password` or `domain`. `parseConfig` MUST NOT require any credential field for this mode (it MUST NOT
reject an integrated source for missing `user`/`password`), and `resolveSecrets` MUST skip the absent
credential fields (resolving only the fields that are present, e.g. `server`/`database`/`port`). The
existing SQL-auth and NTLM modes — which DO require `${env:VAR}` credentials — MUST parse and resolve
UNCHANGED. The plaintext-rejection rule still applies to whatever identity fields ARE present.

#### Scenario: Integrated config parses without credentials

- GIVEN an mssql config in `integrated` mode with `server`/`database` as `${env:VAR}` and no user/password/domain
- WHEN `parseConfig` validates it
- THEN it parses successfully without demanding any credential field

#### Scenario: resolveSecrets skips absent credential fields

- GIVEN a parsed integrated-mode config
- WHEN `resolveSecrets` runs
- THEN it resolves only the present identity fields and skips the absent user/password/domain
- AND no credential value is logged

#### Scenario: Existing credentialed modes are unchanged

- GIVEN an mssql config in SQL-auth or NTLM mode
- WHEN it is parsed and resolved
- THEN credential fields are still required as `${env:VAR}` references and resolved exactly as before
- AND a missing referenced variable still fails loudly with `ConfigError`

### Requirement: Exhausted strategies present manual-dump and guided-install options

When connectivity is exhausted (the typed `StrategyExhaustionError`, see `connectivity`), the CLI SHALL
present the user TWO actionable options rather than failing opaquely: (a) the MANUAL-DUMP path — print
the emitted dump script (or its location) and state exactly where to place the produced JSON for ingest;
and (b) a GUIDED install (B1) — print the OFFICIAL Microsoft/winget install instructions behind an
EXPLICIT consent notice. The CLI MUST NOT execute any installer automatically. It MUST state CLEARLY that
AUTOMATED installer execution (B2) is DEFERRED to a follow-up — phrased as an acknowledged limitation,
not a hidden gap.

#### Scenario: Exhaustion presents both options actionably

- GIVEN an integrated-mode run where every connectivity strategy is exhausted
- WHEN the CLI handles the `StrategyExhaustionError`
- THEN it presents the manual-dump path (the emitted script and the gitignored location for the output JSON)
- AND it presents a guided-install option printing official install instructions behind a consent notice

#### Scenario: Guided install prints instructions only, never auto-executes

- GIVEN the guided-install (B1) option is shown
- WHEN the user views it
- THEN only official install instructions (winget/official URL) are printed behind an explicit consent notice
- AND no installer is executed automatically

#### Scenario: Automated install is stated as a deferred limitation

- GIVEN the exhaustion UX
- WHEN the install option is presented
- THEN it states clearly that AUTOMATED installer execution (B2) is DEFERRED to a follow-up
- AND it is phrased as an acknowledged limitation, not a hidden gap
