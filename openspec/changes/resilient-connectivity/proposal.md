# Proposal: Resilient Connectivity — Engine-Agnostic Probe, Graceful Degradation & Adaptive Profiles

> **PLANNING — post-Phase-8 hardening.** Phase 8 SHIPPED four engines (sqlite, mssql, pg, mysql). This
> change BUILDS ON the archived `connectivity-strategies` (2026-06-18) + the canonical `connectivity`
> capability + the four shipped adapters — it does NOT replace them.

## Intent

dbgraph now supports FOUR engines, but resilience is uneven. **mssql** routes through the shipped strategy
registry (native-tedious → sqlcmd → manual-dump → consented-install) yet still throws RAW exceptions for
the real-world `sqlcmd` breaks found in Phase-6 validation (F-1..F-9: variant/version flag conflicts,
2033-char FOR JSON chunking with no header, codepage-vs-UTF-8, reassembly fragility, `sql_variant`→JSON).
**pg/mysql** factories explicitly carry "NO strategy registry" — a missing driver or failed connect throws
`ConnectionError('npm i pg')` with NO fallback and NO options. CI never exercises the `sqlcmd` transport (F-7).

**North star (user's vision):** validating whether a connection can be established — native driver, `sqlcmd`,
ODBC, or `psql`/`mysql` — must be TRANSPARENT; and when it CANNOT, the user is GIVEN OPTIONS (≥3): run the
queries themselves, let dbgraph install the module WITH consent, or import a manual dump. Engine-agnostic
(Oracle/others slot in later). The system MUST NEVER raise an exception that blocks the user.

## Scope

### In Scope
- **US-039 capability probe (engine-agnostic):** transparent pre-flight detecting available methods — native
  driver present? `sqlcmd`/`psql`/`mysql` on PATH? ODBC? — WITHOUT raising; feeds strategy selection. Serves
  pg/mysql (driver-absent) AND mssql (variant detect + tiny FOR JSON round-trip learning shape/encoding F-4/F-5).
- **US-040 variant/version profile registry (mssql):** `{flags, outputShape, encoding}` profiles keyed by
  tool+version; legacy 15.x quirks (F-3/F-4/F-5/F-6) handled by DATA, not patches. Extensible per environment.
- **US-041 graceful degradation + actionable result:** on exhaustion, a TYPED, NON-blocking `ConnectivityOutcome`
  presenting the ≥3 options (run-it-yourself with exact queries to paste; consented install; manual-dump import).
  Engine-agnostic: pg/mysql get the SAME options when their native driver is absent. NEVER an unhandled throw.
- **US-042 reassembly hardening (mssql):** profile-driven, tested FOR JSON / chunked-output reassembly (F-4/F-6;
  never `.trim()` at chunk boundaries; codepage decode).
- **US-043 content-free `dbgraph doctor`:** reports connectivity capability + chosen strategy + environment
  profile, leaking NO schema/identifiers/secrets — safe to paste in a bug report.
- **US-044 regression fixtures + opt-in `sqlcmd` CI lane:** anonymized F-1..F-9 fixtures + opt-in lane exercising
  the sqlcmd transport (closes F-7); never blocks the unit matrix.

### Out of Scope
- **NEW engines (Oracle, etc.):** the probe/options/degradation MUST stay engine-agnostic so Oracle slots in
  later, but Oracle itself is NOT implemented here.
- **SILENT installs:** consented-install stays B1 guided-only (B2 automated execution still deferred). No tool
  installs without EXPLICIT consent.
- `Invoke-Sqlcmd`/`bcp`/`osql` as full runCatalog strategies (detection-only remains). T-SQL parser, `map.ts`/
  `queries.ts` extraction logic, native pg/mysql/tedious wire protocols — UNCHANGED. No telemetry/network upload.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- `connectivity-diagnostics`: the ENGINE-AGNOSTIC resilience layer — the capability probe (US-039), the typed
  non-blocking `ConnectivityOutcome` presenting ≥3 options (US-041), and the content-free `dbgraph doctor`
  surface (US-043). New because resilience now spans ALL engines (pg/mysql have no strategy registry today),
  so it cannot live inside the mssql-only `connectivity`/`mssql-extraction` specs.

### Modified Capabilities
- `connectivity`: REQUIRE every transport/format/encoding/parse failure to surface as a typed, redacted,
  actionable error feeding the degradation outcome (no raw stack trace); ADD the mssql variant/version PROFILE
  registry contract (US-040); HARDEN reassembly (US-042; chunk/no-header/padding/encoding, no `.trim()`).
- `mssql-extraction`: apply profile-driven flags/encoding/reassembly to the sqlcmd strategy (legacy 15.x becomes
  ONE registry entry, not hard-coded); wire probe + actionable errors in `strategies/`. `map.ts`/`queries.ts` unchanged.
- `pg-extraction` / `mysql-extraction`: on driver-absent/connect-failure, route through the engine-agnostic
  `ConnectivityOutcome` (run-it-yourself queries + consented install + manual dump) instead of a bare throw.

## Approach

Lift the resilience model OUT of mssql-only machinery into an engine-agnostic seam. Add a `CapabilityProbe`
(core-typed, driver-free per ADR-004) whose per-engine implementations live in adapters and report available
methods WITHOUT raising. Introduce a typed `ConnectivityOutcome` (success | degraded-with-options) so EVERY
engine factory returns options instead of throwing: mssql feeds it from `StrategyExhaustionError`; pg/mysql
build it from a missing-driver / failed-connect probe (their factories gain the ≥3-options path they lack today).
For mssql, insert **probe → profile → adapt** ahead of `runCatalog`: the sqlcmd strategy gains `probe()`
(classify variant+version by capability, tiny `SELECT … FOR JSON` round-trip measuring shape/encoding) →
resolve a `SqlcmdProfile` from a new `profiles.ts` (conservative default + content-free env-report on miss);
`runCatalog` spawns with the profile's flags/codepage and reassembles per the profile (replacing the hard-coded
L-011/L-012 assumptions). `dbgraph doctor` runs the probe stand-alone, emitting a content-free report.
Determinism (ADR-008) preserved — the probe affects TRANSPORT, not catalog CONTENT; goldens stay byte-identical.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/ports/connectivity-strategy.ts` | Modified | OPTIONAL `probe()` on the contract (core types only — ADR-004) |
| `src/core/ports/capability-probe.ts` | New | Engine-agnostic `CapabilityProbe` port + `ProbeResult` (driver-free) |
| `src/core/errors.ts` + barrel | Modified | `TransportError` (`E_TRANSPORT`); typed `ConnectivityOutcome` carrying ≥3 options |
| `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts` | Modified | Variant/version detect; probe round-trip; profile-driven flags/encoding |
| `src/adapters/engines/mssql/strategies/profiles.ts` | New | `SqlcmdProfile` registry keyed by tool+version; legacy-15.x seed |
| `src/adapters/engines/mssql/strategies/json-rows.ts` | Modified | Reassembly hardened per profile (chunk/no-header/padding/encoding; never `.trim()`) |
| `src/adapters/engines/mssql/strategies/registry.ts` | Modified | `selectStrategy` invokes `probe()`; wraps failures as `TransportError`; emits `ConnectivityOutcome` on exhaustion |
| `src/adapters/engines/{pg,mysql}/factory.ts` | Modified | Driver-absent/connect-failure → `ConnectivityOutcome` (≥3 options) instead of bare throw |
| `src/adapters/engines/*/probe.ts` | New | Per-engine `CapabilityProbe` (native driver present? CLI on PATH? ODBC?) |
| `dbgraph doctor` (CLI) | New | Stand-alone probe surface; content-free report |
| `.github/workflows/` (opt-in lane) | New | Opt-in CI job installing `sqlcmd` to exercise the transport (F-7) |
| `test/.../` + fixtures | New | Anonymized F-1..F-9 fixtures; probe/profile/reassembly/outcome/`doctor` user-facing tests |
| `docs/stories/08-resilient-connectivity.md` + README | New | Epic E8 (US-039..044); register E8, Phase 8.5 |

## User Stories — NEW Epic (E8, drafted for spec phase to finalize/scenario)

> Add as `docs/stories/08-resilient-connectivity.md`; register E8 in `docs/stories/README.md`.
> Phase: **8.5 (hardening, after the four engines shipped, before v0.1 / US-036).**

- **US-039 — Engine-agnostic capability probe.** As a user on an unverified machine, I want dbgraph to detect
  which connection methods are available (native driver, `sqlcmd`/`psql`/`mysql`, ODBC) BEFORE a full run,
  WITHOUT raising, so the actual `sync` uses a viable method. Depends on: US-027, US-028, US-029. Status: ☐ pending
- **US-040 — Variant/version profile registry (mssql).** As a maintainer, I want flag/format/encoding profiles
  keyed by detected tool+version, so a new environment is a profile entry, not a patch. Depends on: US-039. ☐ pending
- **US-041 — Graceful degradation with ≥3 actionable options.** As a user, I want every connectivity failure to
  produce a typed, NON-blocking result presenting ≥3 options (run-it-yourself with the exact queries; consented
  install; manual-dump import) — for ANY engine — so I am never blocked by a raw stack trace. Depends on: US-039. ☐ pending
- **US-042 — Output reassembly hardening (mssql).** As the project, I want chunked / no-header / padded / encoded
  output reassembled correctly across profiles (never `.trim()` at chunk boundaries; correct codepage). Depends on: US-040. ☐ pending
- **US-043 — Content-free `dbgraph doctor`.** As a user with an unrecognized environment, I want a self-test
  reporting capability + chosen strategy + profile with NO schema/identifier/secret, so I can safely share it. Depends on: US-039. ☐ pending
- **US-044 — Regression fixtures + opt-in `sqlcmd` CI lane.** As the project, I want anonymized F-1..F-9 fixtures
  and an opt-in CI lane installing `sqlcmd` exercising flag combos/chunking/encoding (closing F-7). Depends on: US-034, US-040. ☐ pending

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Probe round-trip hits a NEW flag conflict on an unseen sqlcmd variant | Med | Probe uses the MINIMAL safe flag set (no `-y`/`-h` combo); on failure → conservative default profile + content-free env-report, never crash (F-3) |
| Profile misclassifies → wrong reassembly on real `sync` | Med | Profile DERIVED from the measured round-trip, not assumed; mismatch → typed `TransportError` + fall back, not silent corruption (F-6) |
| Engine-agnostic `ConnectivityOutcome` leaks the abstraction or over-fits mssql | Med | Outcome is core-typed and engine-neutral; pg/mysql options (run-it-yourself queries, consented install, manual dump) proven by a per-engine test, not mssql-only |
| Opt-in CI `sqlcmd` install flaky/slow | Med | OPT-IN lane (never blocks unit matrix); pin tool version; install failure = skip-with-notice, not red (mirrors L-003) |
| `dbgraph doctor` / env-report leaks content | Low | Shape-ONLY (variant/version/chunk size/header flag/encoding); a test asserts NO schema/object/proc text; leak-scanner + codename rule enforced |
| `probe()` on the port pressures ADR-004 | Low | `probe()` OPTIONAL, returns core-typed shape only, imports no driver/tool/`child_process` — port stays driver-free |
| Adapting transport perturbs golden determinism | Low | Probe affects TRANSPORT only, never catalog CONTENT; goldens byte-identical (ADR-008) |
| pg/mysql degradation path regresses the happy connect | Low | New path is reached ONLY on driver-absent/connect-failure; the successful-connect branch is unchanged + covered by existing tests |

## Rollback Plan

Additive and back-compatible. Revert by: removing the `CapabilityProbe` port + per-engine `probe.ts`; restoring
the bare `ConnectionError` throw in pg/mysql factories; deleting `profiles.ts` + the env-report; removing the
optional `probe()` from the port and `selectStrategy`; restoring the hard-coded legacy-15.x flag/reassembly path
in `sqlcmd.strategy.ts`/`json-rows.ts`; dropping `TransportError`/`ConnectivityOutcome`; removing `dbgraph doctor`
and the opt-in CI lane. Archived `connectivity-strategies` behavior (current `main`), `map.ts`, `queries.ts`,
native-tedious/pg/mysql wire protocols, manual-dump, guided-install, core, storage, query and SQLite stay intact and green.

## Dependencies

- Builds on the ARCHIVED `connectivity-strategies` (2026-06-18) + the canonical `connectivity` spec + the four
  SHIPPED adapters (mssql strategy registry; pg/mysql native-driver factories) — REQUIRED predecessors.
- ZERO new npm deps — probing/detection/execution stay on `node:child_process` (Node builtin; ADR-006/007).
- Consumes UNCHANGED: `buildMssqlRawCatalog` (`map.ts`), `queries.ts`, `RawCatalog`, `ExtractionScope`, the
  `Logger` port, `StrategyExhaustionError`, `ConnectionError`, `createMssqlSchemaAdapter`, `createPg/MysqlSchemaAdapter`.
- Phase-6 findings (`docs/findings/connectivity-environments.md`, F-1..F-9) + L-011, L-012.

## Recommended Apply Batch Ordering (for the future apply phase)

1. `CapabilityProbe` port (core, driver-free) + `ProbeResult`; `TransportError` + typed engine-agnostic `ConnectivityOutcome`; optional `probe()` on the strategy port + barrels.
2. Per-engine `CapabilityProbe` (`probe.ts`) for mssql/pg/mysql/sqlite (native driver present? CLI on PATH? ODBC?).
3. pg/mysql factories: driver-absent/connect-failure → `ConnectivityOutcome` (≥3 options) instead of bare throw; user-facing tests.
4. `profiles.ts` registry + measured legacy-15.x seed (flags/outputShape/encoding).
5. `sqlcmd.strategy.probe()` (variant+version classify + tiny FOR JSON round-trip) → profile resolution.
6. Reassembly hardening in `json-rows.ts` driven by the resolved profile (chunk/no-header/padding/encoding).
7. `selectStrategy` wires probe + wraps every spawn/parse failure as `TransportError`; emits `ConnectivityOutcome` on exhaustion.
8. Content-free env-report + the `dbgraph doctor` CLI surface (engine-agnostic).
9. Anonymized F-1..F-9 fixtures + the OPT-IN `sqlcmd` CI lane (F-7); boundary/leak/read-only sweep; lint.

## Success Criteria

- [ ] An engine-agnostic pre-run probe detects available methods (native driver, CLI on PATH, ODBC) WITHOUT raising; selection uses the result. For mssql it also detects the `sqlcmd` variant+version and the real output shape/encoding via a tiny FOR JSON round-trip.
- [ ] On ANY engine, when no method connects, a typed NON-blocking `ConnectivityOutcome` presents ≥3 options (run-it-yourself with the exact queries to paste; consented install; manual-dump import) — pg/mysql driver-absent scenarios included; NO raw exception reaches the user.
- [ ] mssql variant/version flag/format/encoding profiles live in an EXTENSIBLE registry; adding an environment = one profile entry (no code patch); the measured legacy-15.x profile is a registry entry, not hard-coded.
- [ ] Chunked / no-header / padded / encoded sqlcmd output reassembles correctly across profiles (never `.trim()` at chunk boundaries; correct codepage decode — F-4, F-5, L-012); `sql_variant`→JSON coerces (F-9).
- [ ] `dbgraph doctor` emits a CONTENT-FREE report (capability + chosen strategy + profile, shape sample only); a test asserts NO schema, object name, or proc source appears.
- [ ] Anonymized F-1..F-9 fixtures exist AND an OPT-IN CI lane installs `sqlcmd` exercising the transport (flag combos, chunking, encoding) — F-7 gap closed; the lane never blocks the unit matrix.
- [ ] ZERO new npm dependencies; ADR-004/006/007/008 intact; native-tedious + pg + mysql + manual-dump + SQLite remain green; goldens byte-identical.
- [ ] New epic E8 (US-039..044) added to `docs/stories/`, registered in `README.md`, Status pending, Phase 8.5.
