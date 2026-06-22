# Connectivity Specification

## Purpose

The engine-agnostic connectivity-strategy framework that lets dbgraph extract a catalog through MORE
than one transport: the driver-free `ConnectivityStrategy` port (`src/core/ports/connectivity-strategy.ts`,
core types only — ADR-004), a per-engine ORDERED registry plus the selection algorithm, the
probe/`detect` contract over external tools, transparent-but-logged auto-selection via the `Logger`
port, the typed `StrategyExhaustionError`, and read-only-on-EVERY-path enforcement. It exists because a
corporate SQL Server may permit ONLY Windows Integrated Security (no SQL/explicit credential) — which
`tedious` cannot do (ADR-006) — so connectivity must fall back to already-installed external tools
(e.g. `sqlcmd -E`) WITHOUT new npm dependencies, WITHOUT installing anything unprompted, and WITHOUT
ever issuing a write.

This is a NEW capability introduced in the connectivity-strategies change (2026-06-18). The port lives
in core and imports ONLY core types (`RawCatalog`, `ExtractionScope`) — ZERO driver, tool, or
`node:child_process` imports. Concrete strategies live under
`src/adapters/engines/<engine>/strategies/` (ADR-004). The framework is engine-agnostic; SQL Server
concrete strategies are specified in `mssql-extraction`, their config/UX surface in `cli-config`.

> **Shelling out is NOT a native driver.** Running an external tool via `node:child_process` (a Node
> builtin, ZERO new deps) spawns a SEPARATE OS process — like invoking `git` — not a wire-protocol
> driver linked into the process. ADR-006 ("100% JS drivers") and ADR-007 (closed dependency list)
> stay intact. The only install path is consent-gated; every strategy is read-only.

## Requirements

### Requirement: ConnectivityStrategy port is driver-free and core-typed

The core SHALL define a `ConnectivityStrategy` port in `src/core/ports/connectivity-strategy.ts` that
imports ONLY core types (`RawCatalog`, `ExtractionScope`) and MUST NOT import any driver, external-tool,
or `node:child_process` symbol (ADR-004). A strategy MUST expose: a stable `id` for logging; an async
`detect()` returning `{ available: boolean; version?: string; path?: string }`; an async
`canConnect(config)` returning a boolean; an async `runCatalog(config, scope)` returning a `RawCatalog`;
and an OPTIONAL `close()`. The port MUST be implementable by any engine without changing core.

#### Scenario: Port exposes the strategy contract with only core types

- GIVEN the core port module `src/core/ports/connectivity-strategy.ts`
- WHEN its exports and imports are inspected
- THEN `ConnectivityStrategy` declares `id`, `detect()`, `canConnect(config)`, `runCatalog(config, scope)` and an optional `close()`
- AND it imports only `RawCatalog` and `ExtractionScope` from core (no driver, tool, or `child_process` import)

#### Scenario: detect reports availability and metadata

- GIVEN a concrete strategy whose backing tool is installed
- WHEN `detect()` is called
- THEN it resolves `{ available: true }` and MAY carry the discovered `version` and `path`
- AND when the tool is absent it resolves `{ available: false }`

### Requirement: Per-engine ordered registry selects the first viable strategy

There SHALL be a per-engine ORDERED strategy registry and a selection algorithm that tries strategies in
the fixed order native → detected-external-tool → manual-dump → consented-install. The FIRST strategy
whose `detect()` reports available AND whose `canConnect(config)` returns true MUST be selected and used
for `runCatalog`. For a configuration that carries NO explicit credentials (integrated mode), the native
driver strategy MUST be SKIPPED (it cannot satisfy `canConnect`). Selection MUST be deterministic for a
given config and machine state.

#### Scenario: First viable strategy in order wins

- GIVEN an engine registry ordered native → external-tool → manual-dump → install
- AND an explicit-credentials config where the native strategy can connect
- WHEN the selection algorithm runs
- THEN the native strategy is selected and used for `runCatalog`

#### Scenario: Integrated config skips the native strategy

- GIVEN an integrated-mode config carrying no explicit credentials
- WHEN the selection algorithm runs
- THEN the native (tedious) strategy is SKIPPED
- AND the first available external-tool strategy whose `canConnect` passes is selected instead

### Requirement: Selection is transparent yet logged via the Logger port

The selection algorithm SHALL be transparent (no user prompt for the happy path) yet MUST log each
decision through the injected `Logger` port (`src/core/ports/logger.ts`) — never `console.log`. It MUST
log, at minimum, which strategies were probed, which `detect`/`canConnect` outcomes occurred, and which
strategy was finally selected (e.g. "native skipped (no creds) → sqlcmd detected → using sqlcmd"). Log
verbosity MUST be controllable via the logger's levels (`debug`/`info`/`warn`/`error`); resolved secrets
MUST NOT be logged.

#### Scenario: Each probe and the final choice are logged

- GIVEN an injected `Logger` and an integrated-mode config
- WHEN selection chooses the sqlcmd strategy after skipping native
- THEN the logger records the native skip, the sqlcmd detection, and the final selection
- AND no resolved secret value appears in any log line

#### Scenario: Verbosity is controlled through logger levels

- GIVEN a logger configured to suppress `debug`
- WHEN selection runs
- THEN per-probe detail emitted at `debug` is suppressed while the final selection at `info` is retained

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

### Requirement: Tool detection probes at least three candidates via child_process

Strategy `detect()` SHALL probe external-tool availability by spawning a candidate via
`node:child_process` with a SHORT timeout and MUST NOT shell-interpolate any untrusted input. The SQL
Server family MUST probe at least THREE candidates: `sqlcmd` (distinguishing the legacy ODBC build from
the go-sqlcmd variant by capability, not by hard-coded version), PowerShell `Invoke-Sqlcmd`, and an ODBC
driver presence check (registry). Detection MUST report availability WITHOUT opening a database
connection. A probe that times out or errors MUST be treated as `available: false`, never as a hang.

#### Scenario: Detection reports availability without connecting

- GIVEN a machine with `sqlcmd` installed
- WHEN the sqlcmd strategy `detect()` runs
- THEN it spawns the probe via `child_process` with a short timeout and reports `{ available: true }`
- AND it does NOT open any database connection to determine availability

#### Scenario: At least three SQL Server candidates are probed

- GIVEN the SQL Server detection set
- WHEN availability is probed
- THEN at least three candidates are checked — `sqlcmd` (legacy vs go variant by capability), `Invoke-Sqlcmd`, and an ODBC driver registry check
- AND each probe uses `child_process` with no shell interpolation of untrusted input

#### Scenario: A timed-out or failed probe is treated as unavailable

- GIVEN a probe that exceeds its short timeout or exits non-zero
- WHEN `detect()` evaluates the result
- THEN it resolves `{ available: false }` rather than hanging or throwing

### Requirement: Read-only and no-install hold on every strategy path

Every connectivity strategy (native, external-tool, manual-dump, consented-install) SHALL preserve the
INVIOLABLE read-only-against-target guarantee: a strategy that connects MUST issue ONLY catalog `SELECT`
statements and MUST NOT issue any `INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL. All strategy source under
`src/adapters/engines/**/strategies/` MUST fall within the existing write-verb scanner scope and pass
it. Shelling out via `child_process` MUST NOT introduce a native addon (the "100% JS drivers" guarantee
holds). NO tool may be installed without EXPLICIT user consent.

#### Scenario: Strategy source passes the write-verb scanner

- GIVEN the strategy source under `src/adapters/engines/**/strategies/`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write verb in any strategy's SQL
- AND the scan passes

#### Scenario: Shelling out keeps the 100% JS-drivers and no-install guarantees

- GIVEN a strategy that runs an external tool via `node:child_process`
- WHEN it executes
- THEN no native addon or wire-protocol driver is linked into the process (only a separate OS process is spawned)
- AND no tool is installed without explicit user consent

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
