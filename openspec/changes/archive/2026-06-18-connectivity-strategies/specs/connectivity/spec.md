# Connectivity Specification (new — connectivity-strategies)

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

This is a NEW capability. The port lives in core and imports ONLY core types (`RawCatalog`,
`ExtractionScope`) — ZERO driver, tool, or `node:child_process` imports. Concrete strategies live under
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

### Requirement: Exhausting all strategies raises a typed StrategyExhaustionError

When NO strategy in the engine registry is both available and able to connect, the framework SHALL
reject with a NEW typed `StrategyExhaustionError` (extending `DbgraphError` with a stable `code`,
alongside the existing typed errors, not redefining them). Its message MUST list EACH strategy that was
attempted and the REASON it was rejected (not detected, cannot connect, parse failure, etc.). It MUST
NOT degrade to a silent or partial catalog.

#### Scenario: All strategies exhausted lists each attempt and reason

- GIVEN an integrated-mode config on a machine with no external tool installed and no manual dump present
- WHEN the selection algorithm runs to exhaustion
- THEN it rejects with the typed `StrategyExhaustionError`
- AND the message lists each strategy attempted (native skipped, sqlcmd not detected, manual-dump absent, install not consented) with its reason
- AND no partial or silent catalog is returned

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
