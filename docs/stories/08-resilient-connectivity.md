# E8 — Resilient connectivity

Goal: every engine's connection path is transparent, graceful, and fully regression-tested.
When connection fails, the user receives actionable options — never a raw stack trace.
Environments are captured as anonymized profiles; the sqlcmd transport is regression-tested.
References: Phase 8.5 (hardening, after the four engines shipped, before v0.1 / US-036).
Rule common to ALL: ADR-004 (core driver-free), ADR-006/007 (zero new npm deps), ADR-008 (golden determinism).

---

### US-039 — Engine-agnostic capability probe

**As** a user on an unverified machine, **I want** dbgraph to detect which connection methods are
available (native driver, `sqlcmd`/`psql`/`mysql`, ODBC) BEFORE a full run, WITHOUT raising,
**so that** the actual `sync` uses a viable method and does not crash blindly.

**Phase:** 8.5 · **Depends on:** US-027, US-028, US-029 · **Status:** ☑ done (resilient-connectivity)

**Acceptance criteria:**

- A `CapabilityProbe` port (`src/core/ports/capability-probe.ts`) defines `probe(): Promise<ProbeResult>` — driver-free, imports ONLY core types (ADR-004). ✓
- Per-engine `probe.ts` for mssql/pg/mysql/sqlite checks driver presence via dynamic `import()` (no `.connect()`) and CLI availability via cross-platform PATH scan (`where`/`which`). ✓
- `probe()` MUST NOT throw on any input (timed-out / failed probe resolves `{ available: false }`). ✓
- `probe?()` is OPTIONAL on the `ConnectivityStrategy` port (back-compat with shipped strategies). ✓
- The per-engine probes pass the engines write-verb scanner (US-031). ✓

---

### US-040 — Variant/version profile registry (mssql)

**As** a maintainer, **I want** flag/format/encoding profiles keyed by detected sqlcmd tool+version,
**so that** a new environment is a profile entry (one data row), not a code patch.

**Phase:** 8.5 · **Depends on:** US-039 · **Status:** ☑ done (resilient-connectivity)

**Acceptance criteria:**

- `src/adapters/engines/mssql/strategies/profiles.ts` exports `SqlcmdProfile` + `SQLCMD_PROFILES: readonly SqlcmdProfile[]` and `resolveProfile(probe): SqlcmdProfile`. ✓
- The legacy sqlcmd 15.x entry is seeded: flags `['-y','0','-f','o:65001']` (no `-h`/`-W`), `outputShape: { chunkSize: 2033, hasHeader: false }`, `encoding: 'utf8'` (from F-3/F-4/F-5). ✓
- An unrecognized probe result yields the conservative default profile — never a crash. ✓
- Adding a new environment = one data row in `SQLCMD_PROFILES`, no code branch change. ✓
- `resolveProfile` assertions: exact-set per profile entry; default on miss confirmed. ✓

---

### US-041 — Graceful degradation with at least three actionable options

**As** a user, **I want** every connectivity failure to produce a typed, NON-blocking result
presenting at least three options (run-it-yourself with the exact queries; consented install;
manual-dump import) — for ANY engine — **so that** I am never blocked by a raw stack trace.

**Phase:** 8.5 · **Depends on:** US-039 · **Status:** ☑ done (resilient-connectivity)

**Acceptance criteria:**

- `ConnectivityOutcome` + `ConnectivityOption` discriminated union are core types in `src/core/errors.ts` (driver-free, ADR-004). ✓
- `ConnectivityUnavailableError extends DbgraphError` carries `readonly outcome: ConnectivityOutcome` with code `E_CONNECTIVITY_UNAVAILABLE`. ✓
- `formatOutcome(outcome)` in `src/core/present/connectivity.ts` renders the engine, summary, ALL attempts, and ALL options (run-it-yourself queries verbatim; consented-install with CONSENT notice; manual-dump path). ✓
- pg/mysql factories throw `ConnectivityUnavailableError(outcome)` on driver-absent/connect-fail (instead of bare `ConnectionError`). Happy-connect path UNCHANGED. ✓
- mssql `selectStrategy` exhaustion throws `ConnectivityUnavailableError(outcome)` (instead of bare `StrategyExhaustionError`). ✓
- `cli.ts` catch block renders `ConnectivityUnavailableError` via `formatOutcome` to stderr; no stack trace reaches the user. ✓
- Engine-agnostic PARITY suite proves pg-absent, mysql-absent, and mssql-exhausted all yield `options.map(o => o.kind)` EQUAL `['run-it-yourself','consented-install','manual-dump']`. ✓
- The run-it-yourself queries are the EXACT shipped read-only catalog SELECTs from each engine's `queries.ts`, asserted write-verb-free. ✓

---

### US-042 — Output reassembly hardening (mssql)

**As** the project, **I want** chunked / no-header / padded / encoded sqlcmd output reassembled
correctly across profiles, **so that** F-4/F-5/F-6 breaks are permanently regression-tested.

**Phase:** 8.5 · **Depends on:** US-040 · **Status:** ☑ done (resilient-connectivity)

**Acceptance criteria:**

- `reassembleForJson(stdout: Buffer, profile: SqlcmdProfile)` + `reassembleSingleForJson` extracted to `src/adapters/engines/mssql/strategies/json-rows.ts` (previously private in `sqlcmd.strategy.ts`). ✓
- Reassembly driven by `profile.outputShape.chunkSize`, `profile.outputShape.hasHeader`, and `profile.encoding` (no hard-coded assumptions). ✓
- Chunk boundaries are concatenated VERBATIM — never `.trim()` at a boundary (F-4/F-6). ✓
- Output is decoded using `profile.encoding` (F-5). ✓
- `(N rows affected)` trailer dropped; blank lines dropped; leading non-JSON lines skipped defensively. ✓
- Malformed/partial output raises a typed actionable error (first N chars included) — NOT a raw `JSON.parse` stack trace. ✓
- `parseJsonRows` / `coerceStringy` (sql_variant coercion — F-9) are UNCHANGED. ✓
- mssql goldens (`test/fixtures/mssql/golden/golden-raw-catalog.json` + `golden-e2e.json`) BYTE-IDENTICAL after the extraction (ADR-008). ✓
- The `sqlcmd.strategy.ts` threads the resolved `SqlcmdProfile` (from `resolveProfile(probe)`) into reassembly; flags come from `profile.flags`. ✓

---

### US-043 — Content-free `dbgraph doctor`

**As** a user with an unrecognized environment, **I want** a self-test reporting capability, chosen
strategy, and environment profile with NO schema/identifier/secret, **so that** I can safely paste
the output in a bug report.

**Phase:** 8.5 · **Depends on:** US-039 · **Status:** ☑ done (resilient-connectivity)

**Acceptance criteria:**

- `dbgraph doctor` is a new CLI command registered in `COMMAND_TABLE` + `USAGE_TEXT`. ✓
- `runDoctor(deps)` in `src/cli/commands/doctor.ts` runs the per-engine `CapabilityProbe` stand-alone (no DB connection, no catalog SELECT). ✓
- `formatDoctor(view: DoctorView)` in `src/core/present/doctor.ts` renders: engine, native-driver bool, CLI tools + versions, ODBC bool, resolved profile name, chosen-strategy id — SHAPE ONLY. ✓
- A test asserts the rendered string `not.toContain` any planted schema name, object identifier, or secret value (leak assertion). ✓
- An unrecognized environment (no profile match) produces a report noting the unrecognized environment — `runDoctor` resolves, does NOT reject. ✓

---

### US-044 — Regression fixtures + opt-in sqlcmd CI lane

**As** the project, **I want** anonymized F-1..F-9 fixtures and an opt-in CI lane installing `sqlcmd`
exercising flag combos/chunking/encoding, **so that** the F-7 coverage gap is closed without blocking
the normal unit matrix.

**Phase:** 8.5 · **Depends on:** US-034, US-040 · **Status:** ☑ done (resilient-connectivity)

**Acceptance criteria:**

- `test/fixtures/mssql/connectivity/F-1.json` .. `F-9.json` exist as anonymized shape-only JSON descriptors. ✓
- Each fixture contains `_fixture`, `_description`, `probeResult`, and `conclusion` fields; none contains a real schema name, object identifier, proc source text, or credential. ✓
- A content-free assertion test (`fixtures-content-free.test.ts`) asserts each fixture passes the deny-list check. ✓
- The F-4/F-5/F-6/F-9 fixture shapes are repointed from the `json-rows-reassembly.test.ts` formal fixture-driven tests (byte-identical). ✓
- `.github/workflows/ci.yml` has an `sqlcmd-transport` job gated by `workflow_dispatch` or `DBGRAPH_SQLCMD_LANE=1`. ✓
- The `sqlcmd-transport` job is NOT listed in `needs:` by the unit matrix `test` job — it never blocks PR/push. ✓
- On sqlcmd install failure the step emits a notice and exits 0 (skip-with-notice). ✓
- The opt-in lane exercises: json-rows-reassembly, profiles, probe, and connectivity fixture tests. ✓
