# Connectivity Diagnostics Specification

## Purpose

The ENGINE-AGNOSTIC connectivity resilience layer: a transparent NON-throwing capability probe
reporting which connection methods are available per engine (US-039), a typed NON-blocking
`ConnectivityOutcome` that — when no method connects — presents the user at least THREE actionable
options instead of an unhandled exception (US-041), and a content-free `dbgraph doctor` self-test
surface (US-043). It exists because resilience now spans ALL FOUR shipped engines: mssql routes
through a strategy registry yet still throws raw exceptions on the F-1..F-9 `sqlcmd` breaks, while
pg/mysql factories throw a bare `ConnectionError` with NO fallback and NO options. This capability
lifts that resilience OUT of mssql-only machinery so it serves every engine identically (Oracle and
others slot in later WITHOUT redesign).

The probe contract is core-typed and driver-free (ADR-004): the core declares the engine-agnostic
shape; per-engine probe implementations live under `src/adapters/engines/<engine>/`. Shelling out via
`node:child_process` to detect a CLI tool is NOT a native driver and adds ZERO npm dependencies
(ADR-006/007). The `ConnectivityOutcome`'s options are engine-neutral: a missing pg/mysql driver and an
exhausted mssql strategy chain MUST yield the SAME three options. NO option performs a silent install —
consented-install requires EXPLICIT user consent.

Stories: US-039 (engine-agnostic capability probe, Phase 8.5), US-041 (graceful degradation with
≥3 actionable options, Phase 8.5), US-043 (content-free `dbgraph doctor`, Phase 8.5). Part of
epic E8 (Resilient Connectivity).

## Requirements

### Requirement: Engine-agnostic capability probe reports available methods without raising

The core SHALL define an engine-agnostic `CapabilityProbe` port that imports ONLY core types and MUST
NOT import any driver, external-tool, or `node:child_process` symbol (ADR-004). The probe SHALL report,
per engine, which connection methods are available — whether the engine's native driver is importable,
whether a CLI tool (`sqlcmd`/`mysql`/`psql`) is present on `PATH`, and whether an ODBC driver is present
where applicable. The probe MUST run BEFORE a full extraction and MUST be NON-throwing: any detection
failure, timeout, or absent prerequisite MUST be reported as a NEGATIVE result, NEVER raised. The probe
MUST NOT open a database connection to determine availability and MUST NOT issue any write.

#### Scenario: Probe reports a present native driver and a CLI on PATH

- GIVEN an engine whose native driver is importable and whose CLI tool is on `PATH`
- WHEN the engine's `CapabilityProbe` runs
- THEN it resolves a result marking the native-driver method available AND the CLI method available
- AND it does NOT open any database connection to determine availability

#### Scenario: Absent driver and absent CLI are reported, not raised

- GIVEN an engine whose native driver is NOT importable and whose CLI tool is absent from `PATH`
- WHEN the engine's `CapabilityProbe` runs
- THEN it resolves a result marking both methods unavailable
- AND it does NOT raise any exception

#### Scenario: A timed-out or failed detection is treated as unavailable

- GIVEN a CLI-tool detection probe that exceeds its short timeout or exits non-zero
- WHEN the probe evaluates the result
- THEN it reports that method as unavailable rather than hanging or throwing

#### Scenario: Probe port stays driver-free and core-typed

- GIVEN the core `CapabilityProbe` port module
- WHEN its imports are inspected
- THEN it imports only core types and imports NO driver, external-tool, or `node:child_process` symbol

### Requirement: Connection failure yields a typed non-blocking outcome presenting at least three options

When a connection CANNOT be established — because the engine's native driver is absent OR because every
strategy in the engine's chain is exhausted — the system SHALL yield a TYPED, NON-BLOCKING
`ConnectivityOutcome` rather than an unhandled exception. The outcome SHALL present the user at LEAST
THREE options: (a) run-it-yourself — emit the EXACT read-only catalog `SELECT` queries for the user to
run in their own client; (b) consented-install — offer to install the missing driver/tool ONLY with
explicit user consent; (c) manual-dump — import a combined JSON dump the user produced. The outcome MUST
be engine-agnostic: the SAME three options MUST be offered whether the failing engine is pg/mysql
(driver absent) or mssql (strategy chain exhausted). The system MUST NEVER let an unhandled exception
reach the user as the connectivity result.

#### Scenario: pg driver absent yields the three-option outcome, not a bare throw

- GIVEN a pg configuration on a machine where the `pg` driver is NOT installed
- WHEN connection is attempted
- THEN a typed `ConnectivityOutcome` is yielded presenting at least three options — run-it-yourself with the exact catalog SELECTs, consented-install of the driver, and manual-dump import
- AND NO unhandled exception reaches the user

#### Scenario: mssql strategy exhaustion yields the same three-option outcome

- GIVEN an mssql configuration where every strategy in the chain is exhausted (native skipped, CLI absent, dump absent, install not consented)
- WHEN connection is attempted
- THEN a typed `ConnectivityOutcome` is yielded presenting the SAME at-least-three options as the pg/mysql driver-absent case
- AND NO unhandled exception reaches the user

#### Scenario: run-it-yourself option carries exact read-only catalog queries

- GIVEN a `ConnectivityOutcome` produced for any engine
- WHEN the run-it-yourself option is read
- THEN it carries the EXACT read-only catalog `SELECT` queries the user can paste into their own client
- AND those queries contain no write verb (`INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL)

#### Scenario: consented-install never installs without explicit consent

- GIVEN a `ConnectivityOutcome` whose consented-install option is presented
- WHEN the outcome is yielded
- THEN no driver or tool has been installed
- AND installation proceeds only after the user EXPLICITLY consents

### Requirement: dbgraph doctor reports diagnostics content-free

There SHALL be a `dbgraph doctor` diagnostic command that runs the capability probe stand-alone and
reports the probe results (which methods are available per engine), the strategy that WOULD be chosen,
and the detected environment profile (tool variant/version, output shape, encoding). The report MUST be
CONTENT-FREE: it MUST NOT include any schema name, object identifier, query result, or secret, so it is
safe to paste into a public bug report. The command MUST be NON-throwing — an unrecognized environment
MUST produce a report, not an exception.

#### Scenario: doctor reports capability, chosen strategy and environment profile

- GIVEN a machine with at least one connection method available for an engine
- WHEN `dbgraph doctor` runs
- THEN it reports which methods are available, the strategy that would be chosen, and the detected environment profile (variant/version, output shape, encoding)

#### Scenario: doctor output is content-free and safe to share

- GIVEN a connected-capable environment with real schema objects and a configured secret
- WHEN `dbgraph doctor` produces its report
- THEN NO schema name, object identifier, query result, or secret value appears anywhere in the output
- AND the report is safe to paste into a public bug report

#### Scenario: doctor on an unrecognized environment reports rather than throws

- GIVEN an environment whose tool variant/version matches no known profile
- WHEN `dbgraph doctor` runs
- THEN it emits a content-free report noting the unrecognized environment (shape sample only)
- AND it does NOT raise an exception
