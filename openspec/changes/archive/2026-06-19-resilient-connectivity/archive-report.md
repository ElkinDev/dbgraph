# Archive Report: resilient-connectivity (Phase 8.5)

**Change**: resilient-connectivity — Engine-Agnostic Probe, Graceful Degradation & Adaptive Profiles
**Epic**: E8 (US-039..US-044)
**Phase**: 8.5 (hardening, after four engines shipped, before v0.1 / US-036)
**Archive date**: 2026-06-19
**Branch merged**: resilient-connectivity → main (HEAD d012509)
**Verdict**: PASS — re-verify R1 cleared all CRITICALs; 0 CRITICAL, 2 deferred (W2, S2)

---

## What Shipped

Engine-agnostic connectivity resilience across all four shipped engines (mssql, pg, mysql, sqlite).

### New Capability: connectivity-diagnostics

- **US-039 — Engine-agnostic `CapabilityProbe`** (`src/core/ports/capability-probe.ts`): driver-free
  core port declaring `CapabilityProbe` / `ProbeResult` / `CliToolInfo`. Per-engine implementations
  (`src/adapters/engines/*/probe.ts`) detect native-driver presence via dynamic `import()` (no
  `.connect()`) and CLI tool availability via cross-platform `where`/`which` PATH scan. Non-throwing:
  any failure resolves a negative result, never rejects.

- **US-041 — Typed non-blocking `ConnectivityOutcome`** (`src/core/errors.ts`): `ConnectivityOption`
  discriminated union (run-it-yourself / consented-install / manual-dump), `ConnectivityOutcome`
  interface, and `ConnectivityUnavailableError` (`E_CONNECTIVITY_UNAVAILABLE`) carrying the outcome.
  Built by the single engine-agnostic `buildConnectivityOutcome`
  (`src/adapters/engines/_shared/connectivity-outcome.ts`) so pg, mysql, and mssql yield the identical
  ≥3-option shape [run-it-yourself, consented-install, manual-dump]. The run-it-yourself option carries
  the EXACT shipped read-only catalog SELECTs per engine. `src/core/present/connectivity.ts` renders
  the outcome at the `cli.ts` boundary (no stack trace ever reaches the user).

- **US-043 — Content-free `dbgraph doctor`** (`src/cli/commands/doctor.ts`,
  `src/core/present/doctor.ts`): stand-alone probe surface; reports capability / chosen-strategy /
  environment profile using `basename(tool.path)` (not the full filesystem path — S1 fix); a test
  asserts NO schema name, object identifier, or secret appears; non-throwing on unrecognized
  environments. Wired via `COMMAND_TABLE['doctor']` and `dispatch.handleDoctor`.

### connectivity Capability Deltas

- **US-040 — `SqlcmdProfile` registry** (`src/adapters/engines/mssql/strategies/profiles.ts`):
  `SQLCMD_PROFILES` keyed by variant/version; legacy-15.x seeded as a DATA row (flags `-y 0 -f
  o:65001`; `chunkSize: 2033`; `hasHeader: false`; `encoding: utf8`). `resolveProfile(probe)` returns
  the conservative default on miss — never throws. Adding a new environment = one profile entry, not a
  code patch.

- **US-042 — Profile-driven reassembly** (`src/adapters/engines/mssql/strategies/json-rows.ts`):
  `reassembleForJson(stdout, profile)` extracted from the private `sqlcmd.strategy.ts` logic; driven
  by the profile's `chunkSize`/`hasHeader`/`encoding`. Concatenates chunk lines verbatim (never
  `.trim()` at boundaries — F-4/F-6); decodes using `profile.encoding` (F-5); coerces `sql_variant`
  via unchanged `parseJsonRows` (F-9); malformed output → typed `TransportError` with first-200-chars,
  not a raw `JSON.parse` stack trace (C2 fix).

- **US-044 — Anonymized F-1..F-9 fixtures + opt-in CI lane**:
  `test/fixtures/mssql/connectivity/F-{1..9}.json` — content-free shape captures. CI lane
  `.github/workflows/ci.yml` `sqlcmd-transport` job: gated by `workflow_dispatch` OR
  `vars.DBGRAPH_SQLCMD_LANE == 1`; installs pinned mssql-tools18; skip-with-notice on install fail;
  unit matrix has NO dependency on this lane.

### Typed `TransportError` (E_TRANSPORT)

`src/core/errors.ts`: `class TransportError extends DbgraphError` with `code: 'E_TRANSPORT'`; raw
cause stored as `error.cause` ONLY (never surfaced in the message). Thrown at all
transport/format/parse failure points in `json-rows.ts` (lines 130, 139, 166, 175) and
`sqlcmd.strategy.ts` (lines 266, 323). Test `transport-error.test.ts` plants password+server+host
across both paths and asserts `TransportError.message` excludes all planted values.

### CLI surface

`src/cli/cli.ts` catches `ConnectivityUnavailableError` at the existing `DbgraphError` boundary and
renders `formatOutcome(err.outcome)` to stderr. `src/cli/format/exhaustion.ts` DELETED (W1 fix —
the dead shim with stale inline queries is gone; `boundaries.test.ts` pins the file is absent via
ENOENT assertion).

---

## Validation

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run lint` | PASS (0 errors / 0 warnings) |
| Unit tests | PASS — 141 files / 2247 tests, 0 failed, 0 skipped |
| Integration (real postgres:16 / mysql:8 / mssql 2022) | PASS — 206 tests (original verify) |
| mssql goldens | BYTE-IDENTICAL throughout (git diff empty on `test/fixtures/mssql/golden/`) |
| pg + mssql goldens post `_shared` promotion | BYTE-IDENTICAL |
| Zero new npm deps | CONFIRMED (package.json / lock unchanged by R1) |
| Re-verify R1 | PASS — 0 CRITICAL; C1/C2/W1/S1 resolved; W2/S2 deferred |

**Post-merge cross-platform hotfix (PR #10, merged, HEAD d012509):** CI on ubuntu caught that
`present/doctor.ts` called node `path.basename` which is host-dependent on Windows (`\\`-separating
paths output `basename` correctly on Windows only). Fixed by `lastPathSegment` — a host-independent
helper that handles both `/` and `\` separators. This is a recurring pattern: the local Windows gate
is blind to cross-platform path bugs — only CI-ubuntu catches them.

---

## Stories Closed (Epic E8)

| Story | Title | Status |
|-------|-------|--------|
| US-039 | Engine-agnostic capability probe | DONE |
| US-040 | Variant/version profile registry (mssql) | DONE |
| US-041 | Graceful degradation with ≥3 actionable options | DONE |
| US-042 | Output reassembly hardening (mssql) | DONE |
| US-043 | Content-free `dbgraph doctor` | DONE |
| US-044 | Regression fixtures + opt-in `sqlcmd` CI lane | DONE |

---

## Deferred / Tracked Follow-ups

**W2 — Probe-selected profile not wired into `runCatalog`/`sync`**: `SqlcmdStrategy` resolves the
conservative default profile at construction; `probe()` is not implemented on the strategy. The
default flags equal the shipped flags (`-y 0 -f o:65001`), so byte-identical holds and the live sync
is correct TODAY. The probe-to-profile round-trip into extraction remains a tracked follow-up for a
future change. No regression.

**S2 — Test-filename drift vs tasks doc**: Harmless naming differences (e.g.
`connectivity-format.test.ts`, `doctor-format.test.ts`); all tests exist and pass. Reconcile the
tasks-doc paths in the next phase's tasks if an exact audit trail is wanted.

**Recurring lesson — host-independent path handling**: `path.basename` is host-dependent. Use a
host-independent helper that handles both `/` and `\` whenever emitting filesystem paths in
content-free output. The local Windows gate does NOT catch this; only CI-ubuntu does.

---

## Specs Updated (Source of Truth)

| Spec | Action | Details |
|------|--------|---------|
| `openspec/specs/connectivity-diagnostics/spec.md` | CREATED | New canonical capability: probe (US-039), typed outcome (US-041), doctor (US-043) |
| `openspec/specs/connectivity/spec.md` | UPDATED | Exhaustion requirement modified to `ConnectivityOutcome` + `TransportError`; US-040 (profile registry), US-042 (reassembly hardening), US-044 (fixtures + opt-in CI lane) added |

---

## Next Change Recommendation

**Phase 9 — MongoDB + inference engine** (next planned epic per the roadmap), OR an earlier
**AI-benchmark** change — orchestrator/user decides. Both are post-Phase-8.5 and unblocked by this
archive.

---

## SDD Cycle Complete

resilient-connectivity was fully planned (proposal → specs → design → tasks), implemented (6 batches,
Strict TDD), verified (re-verify PASS after R1 remediation), and is now archived. The canonical specs
reflect the shipped behavior. The change folder moves to
`openspec/changes/archive/2026-06-19-resilient-connectivity/`.
