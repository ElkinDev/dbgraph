# Proposal: Resilient Connectivity — Capability Probing, Adaptive Profiles & Graceful Degradation

> **DEFERRED — PLANNING ONLY.** This change is scoped now and implemented in a LATER (final hardening)
> phase, NOT in the current cycle. It BUILDS ON the archived `connectivity-strategies` change
> (2026-06-18) and the canonical `connectivity` capability — it does NOT replace them.

## Intent

The connectivity-strategy system works, but exercising it against a REAL enterprise SQL Server (Phase-6
validation, integrated-security only) surfaced environment-specific breaks that the framework does not
yet absorb: `sqlcmd` variant/version flag mutual-exclusivities (F-2, F-3, L-011), measured FOR JSON
output shape — 2033-char chunking, NO header/separator, no padding (F-4, L-012), codepage-vs-UTF-8
encoding corrupting non-ASCII proc definitions (F-5), and chunk-boundary reassembly fragility (F-6).
Each currently manifests as an UNHANDLED exception (raw `JSON.parse`/spawn stack trace) that BLOCKS the
user mid-`sync`. CI never catches them: the gated integration test exercises SQL validity via `tedious`,
NOT the `sqlcmd` transport (F-7). **North star:** ANY connectivity/format/encoding/parse failure MUST
resolve to a clear, ACTIONABLE outcome — adapt, fall back, or guide — NEVER an unhandled exception. The
system must also let users CONTENT-FREE-report an unrecognized environment so new profiles accrue over time.

## Scope

### In Scope
1. **Capability probe (pre-run self-test)** — before a full run, detect `sqlcmd` variant (legacy ODBC vs
   go-sqlcmd, by CAPABILITY not hard-coded version — F-2) + version, then run a TINY `FOR JSON` round-trip
   to LEARN this environment's real output shape (chunk size, header/separator presence, padding — F-4)
   and encoding (F-5); pick the flag/format/encoding profile from the result. A `dbgraph doctor`-style
   command is the candidate surface (also satisfies US-04N below).
2. **Variant/version PROFILES** — a registry of `{ flags, outputShape, encoding }` profiles keyed by
   detected tool+version, EXTENSIBLE as new environments are reported. Seeded with the measured legacy
   15.x profile (`-y 0` alone, `SET NOCOUNT ON`, `-f o:65001`, no header/separator — L-011, L-012).
3. **Graceful degradation + actionable errors** — wrap EVERY external-tool failure (spawn, non-zero exit,
   flag conflict, parse, encoding) in a TYPED error stating what failed, the REDACTED command tried, and
   the next step. On exhaustion, present manual-dump + guided-install (already built) CLEANLY. No raw
   `JSON.parse`/spawn stack trace reaches the user (F-6).
4. **Output reassembly hardening** — robust handling of chunked / no-header / padded / encoded output
   across profiles: skip leading non-JSON defensively, strip ONLY trailing `\r` (NEVER `.trim()` — chunk
   boundaries carry content), drop blanks + `(N rows affected)`, decode per the profile encoding (L-012).
5. **Environment reporting (CONTENT-FREE)** — a structured way to capture + emit an unrecognized
   environment (variant, version, output-shape SAMPLE only — chunk size / header presence / padding /
   encoding) so a profile can be added. NEVER schema, object names, or proc source (security: content-free).
6. **Regression testing** — recorded ANONYMIZED real-output fixtures per environment (chunked legacy
   capture as golden) + an OPT-IN CI lane that INSTALLS `sqlcmd` to exercise the external-tool transport
   (flag combos, chunking, encoding) — closing the F-7 gap.

### Out of Scope (deferred — NOT carry-over)
- New engines (Postgres/MySQL/Mongo/Oracle) — the probe/profile model is engine-agnostic, no engine code here.
- AUTOMATED installer execution (still B1 guided-only, per the archived change's B2 deferral).
- `Invoke-Sqlcmd` / `bcp` / `osql` concrete strategies beyond detection (still out of scope).
- A full T-SQL parser or any change to `map.ts`/`queries.ts` extraction logic (unchanged linchpin).
- Telemetry / network upload of environment reports — output is a LOCAL file the user shares manually.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None. (Resilience is a hardening of the EXISTING `connectivity` capability, not a new domain. A new
  `connectivity-diagnostics` capability is a candidate ONLY if `dbgraph doctor` grows a CLI surface large
  enough to warrant its own spec — the spec phase decides; default is a DELTA on `connectivity`.)

### Modified Capabilities
- `connectivity`: ADD the capability-probe contract (variant+version detection by capability, tiny FOR
  JSON round-trip learning output-shape + encoding); ADD the variant/version PROFILE registry (extensible,
  keyed by tool+version); REQUIRE that EVERY external-tool failure raises a TYPED, actionable, redacted
  error (no raw stack trace) and degrades to the next strategy; ADD the CONTENT-FREE environment-report
  contract; HARDEN the reassembly requirements (chunk/no-header/padding/encoding, no `.trim()`).
- `mssql-extraction`: APPLY the profile-driven sqlcmd flags/encoding/reassembly to the concrete sqlcmd
  strategy (the legacy 15.x profile becomes one registry entry, not hard-coded); the actionable-error and
  probe wiring land in `strategies/`. `map.ts`/`queries.ts` UNCHANGED.

## Approach

Insert a **probe → profile → adapt** stage AHEAD of `runCatalog` inside the existing strategy selection
(archived `selectStrategy`). The sqlcmd strategy gains a `probe()` that (a) classifies variant+version by
capability, (b) runs a minimal `SELECT … FOR JSON` and MEASURES the returned shape/encoding, (c) resolves
a `SqlcmdProfile` from a new `profiles.ts` registry (falling back to a conservative default + an
environment-report on miss). `runCatalog` then spawns with the PROFILE's flags/codepage and reassembles
with the PROFILE's shape rules — replacing today's hard-coded legacy-15.x assumptions (L-011/L-012) with
data-driven selection. A `TransportError` (typed, redacted command + next step) wraps every spawn/parse
failure and feeds the existing `StrategyExhaustionError` attempt list. `dbgraph doctor` runs the probe
stand-alone and prints a CONTENT-FREE report. Reassembly hardening is isolated in the existing
`json-rows.ts`/`extractJsonContent` seam. Determinism (ADR-008) preserved: the probe affects TRANSPORT,
not catalog content; goldens stay byte-identical.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/errors.ts` + barrel | Modified | Add typed `TransportError` (`E_TRANSPORT`); actionable, carries redacted command + remediation |
| `src/core/ports/connectivity-strategy.ts` | Modified | OPTIONAL `probe()` on the strategy contract (core types only — ADR-004) |
| `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts` | Modified | Variant/version detect by capability; probe round-trip; profile-driven flags/encoding |
| `src/adapters/engines/mssql/strategies/profiles.ts` | New | `SqlcmdProfile` registry (flags/outputShape/encoding) keyed by tool+version; legacy-15.x seed |
| `src/adapters/engines/mssql/strategies/json-rows.ts` | Modified | Reassembly hardened per profile (chunk/no-header/padding/encoding; never `.trim()`) |
| `src/adapters/engines/mssql/strategies/registry.ts` | Modified | `selectStrategy` invokes `probe()`; wraps failures as `TransportError` into attempt list |
| `src/adapters/engines/mssql/strategies/env-report.ts` | New | CONTENT-FREE environment capture (variant/version/shape sample only) |
| `dbgraph doctor` (CLI) | New | Stand-alone self-test surface; prints probe result + content-free report |
| `.github/workflows/` (opt-in lane) | New | Opt-in CI job installing `sqlcmd` to exercise the external-tool transport (F-7) |
| `test/.../strategies/` + fixtures | New | Recorded ANONYMIZED chunked-output golden; profile/reassembly/probe unit tests |
| `docs/stories/08-resilient-connectivity.md` | New | New epic E8 (US-039..04N) — drafted below |

## User Stories — NEW Epic (E8, drafted for spec phase to finalize/scenario)

> Add as `docs/stories/08-resilient-connectivity.md`; register E8 in `docs/stories/README.md`.
> Project format preserved. Spec phase writes acceptance criteria/scenarios; here is the epic frame.

**E8 — Resilient connectivity (graceful degradation & adaptive transport).** Goal: the external-tool
connectivity path NEVER crashes the user with a raw exception — it probes, adapts per environment,
degrades to fallbacks, and emits actionable guidance. References: F-1..F-7, L-011, L-012; builds on the
`connectivity` capability. Phase: **6.5 (final hardening, after Phase-6 validation, before v0.1 / US-036)**.

- **US-039 — Capability probe before a full run.**
  **As** a user on an unverified machine, **I want** dbgraph to detect my `sqlcmd` variant/version and learn
  its real output shape with a tiny round-trip BEFORE the full extraction, **so that** the actual `sync`
  uses the right flags/encoding and does not fail halfway. **Phase:** 6.5 · **Depends on:** US-027 · **Status:** ☐ pending
- **US-040 — Variant/version profile registry.**
  **As** a maintainer, **I want** flag/format/encoding profiles keyed by detected tool+version in an
  extensible registry, **so that** a new environment is supported by adding a profile, not patching code.
  **Phase:** 6.5 · **Depends on:** US-039 · **Status:** ☐ pending
- **US-041 — Graceful degradation with actionable, redacted errors.**
  **As** a user, **I want** every connectivity/format/encoding/parse failure to produce a clear message
  (what failed, the redacted command, the next step) and fall back to manual-dump or guided install,
  **so that** I am never blocked by a raw stack trace. **Phase:** 6.5 · **Depends on:** US-039 · **Status:** ☐ pending
- **US-042 — Output reassembly hardening.**
  **As** the project, **I want** chunked / no-header / padded / encoded output reassembled correctly across
  profiles (never `.trim()` at chunk boundaries; correct codepage decode), **so that** large/non-ASCII proc
  definitions parse reliably. **Phase:** 6.5 · **Depends on:** US-040 · **Status:** ☐ pending
- **US-043 — Content-free environment reporting (`dbgraph doctor`).**
  **As** a user with an unrecognized environment, **I want** a self-test that captures my variant/version/
  output-shape sample WITHOUT any schema, object name, or proc source, **so that** I can safely share it for
  a new profile. **Phase:** 6.5 · **Depends on:** US-039 · **Status:** ☐ pending
- **US-044 — External-tool regression testing (fixtures + opt-in CI lane).**
  **As** the project, **I want** recorded anonymized real-output fixtures and an opt-in CI lane that installs
  `sqlcmd`, **so that** flag combos, chunking and encoding are regression-tested (closing the F-7 gap).
  **Phase:** 6.5 · **Depends on:** US-034, US-040 · **Status:** ☐ pending

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Probe round-trip itself hits a NEW flag conflict on an unseen variant | Med | Probe uses the MINIMAL safe flag set (`SELECT 1`-class, no `-y`/`-h` combo); on failure → conservative default profile + env-report, never crash (F-3) |
| Profile registry misclassifies → wrong reassembly on real `sync` | Med | Profile is DERIVED from the measured round-trip, not assumed; mismatch → typed `TransportError` + fall back, not silent corruption (F-6) |
| Opt-in CI `sqlcmd` install is flaky / slow on runners | Med | Lane is OPT-IN (never blocks the unit matrix); pin tool version; treat install failure as skip-with-notice, not red (mirrors L-003 gated-job pattern) |
| Environment report accidentally leaks content | Low | Report schema is shape-ONLY (variant/version/chunk size/header flag/encoding); a test asserts NO schema/object/proc text; leak-scanner + codename rule enforced |
| `probe()` added to the port pressures ADR-004 | Low | `probe()` is OPTIONAL, returns core-typed shape only, imports no driver/tool/`child_process` — port stays driver-free |
| Adapting transport perturbs golden determinism | Low | Probe affects TRANSPORT only, never catalog CONTENT; goldens byte-identical (ADR-008) |
| `tedious`/native path regressed by changes | Low | All changes confined to `strategies/sqlcmd*` + profiles; native-tedious + manual-dump + SQLite untouched |

## Rollback Plan

Additive and back-compatible. Revert by deleting `profiles.ts` + `env-report.ts`, removing the optional
`probe()` from the port and `selectStrategy`, restoring the hard-coded legacy-15.x flag/reassembly path in
`sqlcmd.strategy.ts`/`json-rows.ts`, dropping `TransportError`, removing the `dbgraph doctor` command and
the opt-in CI lane. The archived `connectivity-strategies` behavior (current `main`) remains intact and
green; `map.ts`, `queries.ts`, native-tedious, manual-dump, guided-install, core, storage, query and the
SQLite adapter are untouched.

## Dependencies

- Builds on the ARCHIVED `connectivity-strategies` change (2026-06-18) and the canonical `connectivity`
  spec — REQUIRED predecessor (the port, registry, `selectStrategy`, sqlcmd strategy, `json-rows.ts`,
  manual-dump and guided-install already exist).
- ZERO new npm deps — probing/detection/execution stay on `node:child_process` (Node builtin; ADR-006/007).
- Consumes UNCHANGED: `buildMssqlRawCatalog` (`map.ts`), `queries.ts`, `RawCatalog`, `ExtractionScope`,
  the `Logger` port, `StrategyExhaustionError`, `createMssqlSchemaAdapter`.
- Phase-6 validation findings (`docs/findings/connectivity-environments.md`, F-1..F-7) + L-011, L-012.

## Recommended Apply Batch Ordering (for the future apply phase)

1. `TransportError` (core, typed/actionable/redacted) + optional `probe()` on the port + barrels.
2. `profiles.ts` registry + the measured legacy-15.x seed profile (flags/outputShape/encoding).
3. `sqlcmd.strategy.probe()` (capability-classify variant+version + tiny FOR JSON round-trip) → profile resolution.
4. Reassembly hardening in `json-rows.ts` driven by the resolved profile (chunk/no-header/padding/encoding).
5. `selectStrategy` wires probe + wraps every spawn/parse failure as `TransportError` into the attempt list; degradation UX.
6. `env-report.ts` (content-free) + the `dbgraph doctor` CLI surface.
7. Recorded ANONYMIZED fixtures + the OPT-IN `sqlcmd` CI lane (F-7); boundary/leak/read-only sweep; lint.

## Success Criteria

- [ ] On an unverified machine, a pre-run probe detects the `sqlcmd` variant+version and the real output
      shape/encoding via a tiny FOR JSON round-trip; the full `sync` then uses the resolved profile.
- [ ] Variant/version flag/format/encoding profiles live in an EXTENSIBLE registry; adding an environment =
      one profile entry (no code patch); the measured legacy-15.x profile is a registry entry, not hard-coded.
- [ ] NO raw exception/stack trace reaches the user: every spawn/flag/parse/encoding failure surfaces as a
      typed `TransportError` (what failed + redacted command + next step) and degrades to manual-dump / guided install.
- [ ] Chunked / no-header / padded / encoded output reassembles correctly across profiles (never `.trim()`
      at chunk boundaries; correct codepage decode for non-ASCII proc definitions — F-4, F-5, L-012).
- [ ] `dbgraph doctor` (or equivalent) emits a CONTENT-FREE environment report (variant/version/shape sample
      only); a test asserts NO schema, object name, or proc source appears in it.
- [ ] Recorded ANONYMIZED real-output fixtures exist per environment AND an OPT-IN CI lane installs `sqlcmd`
      and exercises the external-tool transport (flag combos, chunking, encoding) — F-7 gap closed.
- [ ] ZERO new npm dependencies; ADR-004/006/007/008 intact; native-tedious + manual-dump + SQLite remain green.
- [ ] New epic E8 (US-039..044) added to `docs/stories/`, registered in `README.md`, Status pending, Phase 6.5.
