# Delta for Connectivity

> Builds on the canonical `connectivity` capability (archived `connectivity-strategies`, 2026-06-18).
> The `sqlcmd` strategy referenced below is the SHIPPED `src/adapters/engines/mssql/strategies/`
> chain (`native-tedious → sqlcmd → manual-dump → consented-install`). `map.ts`/`queries.ts` and the
> native-tedious/pg/mysql wire protocols are UNCHANGED. Determinism (ADR-008) is preserved: the profile
> affects TRANSPORT only, never catalog CONTENT — goldens stay byte-identical.

## ADDED Requirements

### Requirement: Variant/version profile registry encodes known quirks as data

There SHALL be a per-engine, per-tool-variant/version profile registry that encodes a tool's known
quirks as DATA — flags, output shape, and encoding — keyed by the detected tool variant and version
(US-040). The registry MUST cover the measured legacy `sqlcmd` 15.x quirks as registry entries, NOT
hard-coded patches: the flag mutual-exclusivities (F-3 — `-y 0` used alone, no `-h`/`-W` conflict), the
FOR JSON output shape (F-4/F-6 — 2033-char chunk lines, NO header/separator line), and the output
encoding (F-5 — codepage forced to UTF-8 for decoding). The profile MUST be SELECTED by the capability
probe's result, never assumed. Adding a NEW environment MUST be a new profile entry, not a code patch.
On a probe result matching NO known profile, the registry MUST yield a conservative default profile —
never crash.

#### Scenario: Legacy sqlcmd 15.x quirks resolve from a registry entry

- GIVEN a probe result identifying legacy `sqlcmd` 15.x
- WHEN the profile registry is consulted
- THEN it returns a profile whose flags use `-y 0` alone (no `-h`/`-W` conflict — F-3), whose output shape is chunked 2033-char lines with no header/separator (F-4/F-6), and whose encoding is UTF-8 (F-5)
- AND that profile is a registry entry, not a hard-coded code path

#### Scenario: A new environment is added as a profile entry, not a patch

- GIVEN a tool variant/version not yet in the registry
- WHEN support for it is added
- THEN it is added as a new profile entry (flags/outputShape/encoding) without changing transport code

#### Scenario: An unrecognized probe result yields a conservative default profile

- GIVEN a probe result matching no known profile entry
- WHEN the registry is consulted
- THEN it returns a conservative default profile
- AND it does NOT raise an exception

### Requirement: Profile-driven reassembly of chunked output is hardened and golden-pinned

The chunked / no-header / padded / encoded CLI output SHALL be reassembled by a tested component driven
by the resolved profile (US-042). The reassembler MUST concatenate chunk lines PRESERVING content
exactly — it MUST NOT `.trim()` at chunk boundaries (F-4/F-6) — MUST decode using the profile's encoding
(F-5), MUST defensively skip a leading non-JSON line and the `(N rows affected)` trailer and blank
lines, and MUST coerce `sql_variant` values into JSON (F-9). Malformed or partial output MUST produce a
typed, ACTIONABLE error (what was received, first N chars) — NOT a raw `JSON.parse` stack trace. The
component MUST be pinned by EXACT golden fixtures (full-set assertions, not existence-only — L-009),
byte-identical on re-run (ADR-008).

#### Scenario: Chunked FOR JSON output reassembles without trimming

- GIVEN a profile whose output shape is 2033-char chunk lines with no header/separator (F-4)
- WHEN the reassembler concatenates the chunk lines
- THEN the chunks are joined preserving content exactly (no `.trim()` at boundaries)
- AND the reassembled value parses as valid JSON

#### Scenario: Non-UTF-8 output is decoded per the profile encoding

- GIVEN output emitted in a console codepage containing non-ASCII characters (F-5)
- WHEN the reassembler decodes it using the profile's encoding
- THEN the non-ASCII content is preserved and the JSON parses correctly

#### Scenario: Malformed output yields a typed actionable error, not a stack trace

- GIVEN truncated or malformed chunked output
- WHEN the reassembler attempts to parse it
- THEN it raises a typed, actionable error reporting what was received and the first N chars
- AND no raw `JSON.parse` stack trace reaches the user

#### Scenario: Reassembly is golden-pinned with exact-set assertions

- GIVEN the recorded F-4/F-6 output fixtures
- WHEN the reassembler runs against them
- THEN the output matches the EXACT golden (full-set assertion, not existence-only — L-009) and is byte-identical on re-run

### Requirement: Regression fixtures and an opt-in sqlcmd CI lane cover the transport

The repository SHALL provide anonymized regression fixtures capturing the F-1..F-9 environment shapes,
AND an OPT-IN CI lane that installs `sqlcmd` and exercises the transport — flag combinations, chunking,
and encoding — to close the F-7 coverage gap (US-044). The fixtures MUST be content-free (shape only — no
schema, object, or proc text). The opt-in lane MUST NEVER block the unit matrix: it MUST be opt-in (not
on the default unit path), and an install failure MUST skip-with-notice, NOT turn the matrix red.

#### Scenario: Anonymized F-1..F-9 fixtures exist and are content-free

- GIVEN the regression fixtures in the repository
- WHEN they are inspected
- THEN they capture the F-1..F-9 environment shapes (variant/version, flag combos, chunk size, header flag, encoding)
- AND no schema name, object identifier, or proc source text appears in them

#### Scenario: Opt-in sqlcmd lane exercises the transport without blocking the unit matrix

- GIVEN the CI configuration
- WHEN the default unit matrix runs
- THEN it does NOT depend on the opt-in `sqlcmd` lane
- AND WHEN the opt-in lane runs it installs `sqlcmd` and exercises flag combos, chunking and encoding

#### Scenario: A flaky sqlcmd install skips with notice rather than failing

- GIVEN the opt-in `sqlcmd` lane whose tool install fails or is unavailable
- WHEN the lane runs
- THEN it skips with an explicit notice
- AND it does NOT turn the unit matrix red

## MODIFIED Requirements

### Requirement: Exhausting all strategies surfaces a typed, redacted, actionable outcome — never a raw stack trace

When NO strategy in the engine registry is both available and able to connect, the framework SHALL NOT
let a raw exception or stack trace reach the user. Every transport/format/encoding/parse failure
encountered while attempting a strategy MUST be captured as a typed, REDACTED error (a `TransportError`
with a stable `code`, alongside the existing typed errors, not redefining them) carrying NO schema,
identifier, or secret. On exhaustion the framework SHALL surface a TYPED, NON-BLOCKING
`ConnectivityOutcome` (defined in `connectivity-diagnostics`) that lists EACH strategy attempted and its
REASON and presents the user at least THREE actionable options. It MUST NOT degrade to a silent or
partial catalog.
(Previously: exhaustion REJECTED with a typed `StrategyExhaustionError` listing each attempt and reason;
it did not present recovery options, and raw transport/format/parse failures could surface as stack traces.)

#### Scenario: All strategies exhausted lists each attempt and reason

- GIVEN an integrated-mode config on a machine with no external tool installed and no manual dump present
- WHEN the selection algorithm runs to exhaustion
- THEN the outcome lists each strategy attempted (native skipped, sqlcmd not detected, manual-dump absent, install not consented) with its reason
- AND no partial or silent catalog is returned

#### Scenario: Exhaustion presents at least three actionable options, not a raw throw

- GIVEN a strategy chain that exhausts on any engine
- WHEN the framework finishes selection
- THEN it surfaces a typed, non-blocking `ConnectivityOutcome` presenting at least three options (run-it-yourself, consented-install, manual-dump)
- AND no raw exception or stack trace reaches the user

#### Scenario: A transport/format/parse failure is redacted into a typed error

- GIVEN a strategy whose spawn, output format, encoding, or parse fails mid-attempt
- WHEN the failure is captured
- THEN it is wrapped as a typed `TransportError` carrying NO schema, identifier, or secret
- AND that redacted reason feeds the exhaustion outcome rather than surfacing as a stack trace
