# Design: Resilient Connectivity — Engine-Agnostic Probe, Graceful Degradation, Adaptive Profiles

## Technical Approach

Lift resilience out of mssql-only machinery into an engine-agnostic seam, reusing the SHIPPED patterns: core stays driver-free (ADR-004), adapters own all `child_process`/driver/PATH logic, factories remain the sole join point, `present/` holds pure formatters. The successful-connect branch of every factory still returns `SchemaAdapter` UNCHANGED — the new path is reached only on driver-absence/connect-failure/strategy-exhaustion.

## Architecture Decisions

### Decision: ConnectivityOutcome seam — typed throw, not return-type change

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Factory returns `ConnectivityOutcome` union (`SchemaAdapter \| degraded`) | Forces EVERY caller (`openConnections`, sync/status/diff/query/explore/affected, MCP) + all happy-path tests to branch on the union — breaks the shipped `AdapterAndStore` contract | Rejected |
| Factory throws typed `ConnectivityUnavailableError(outcome)`; CLI boundary catches + renders | Happy path unchanged; reuses the EXISTING `cli.ts` `catch (DbgraphError)` boundary + `formatExhaustionError` precedent; outcome payload is core-typed (driver-free) | **Chosen** |

**Rationale**: mirrors the shipped flow — `StrategyExhaustionError` already bubbles to `cli.ts`. We keep the throw mechanism but attach a structured, engine-neutral `ConnectivityOutcome` (≥3 options) so rendering is pure presentation, not adapter concern. Core defines the TYPE; adapters BUILD the value; `present/` RENDERS it. ADR-004 holds: no driver/render coupling in core.

### Decision: ConnectivityOutcome + options live in `src/core/errors.ts` + a new core type file

`ConnectivityOutcome` and the three `ConnectivityOption` variants are **core types** (driver-free, no `child_process`). `ConnectivityUnavailableError extends DbgraphError` (code `E_CONNECTIVITY_UNAVAILABLE`) carries the outcome. Rendering moves to `src/core/present/connectivity.ts` (pure, like `present/status.ts`); the legacy `cli/format/exhaustion.ts` becomes a thin shim delegating to it. **Rationale**: options are data (engine, exact queries, install URL) — data belongs in core; the mssql-only `cli/format` presenter cannot serve pg/mysql.

### Decision: probe() is OPTIONAL on the strategy port; per-engine probe in adapters

Add `probe?(): Promise<ProbeResult>` to `ConnectivityStrategy` (optional — back-compat). New core port `src/core/ports/capability-probe.ts` defines `CapabilityProbe` + `ProbeResult` (`{ nativeDriver: boolean; cliTools: readonly CliToolInfo[]; odbc: boolean }`), driver-free. Per-engine `src/adapters/engines/*/probe.ts` does detection: dynamic `import('pg'/'mysql2'/'tedious')` for driver PRESENCE (no `.connect()`), and PATH scan (`where`/`which` cross-platform, mirroring `SqlcmdStrategy.detect()`) for `sqlcmd`/`psql`/`mysql`. **Rationale**: detection is environment I/O → adapters; the shape is core-typed → consumable by `doctor` and selection without leaking drivers.

### Decision: SqlcmdProfile registry is a data table in adapters, consumed by selectStrategy

`src/adapters/engines/mssql/strategies/profiles.ts` exports a keyed `SqlcmdProfile[]` (`{ variant, versionRange, flags, outputShape, encoding }`) + `resolveProfile(probe): SqlcmdProfile` (conservative default on miss). The shipped hard-coded flags (`-y 0 -f o:65001`, no `-h`/`-W` — F-3) and the 2033-char/no-header reassembly assumptions (F-4) become the seeded legacy-15.x entry. `selectStrategy` invokes `probe()` before selection and threads the resolved profile into `SqlcmdStrategy`. **Rationale**: "new environment = one data row, not a patch" (US-040); profiles stay engine-internal.

### Decision: reassembly extracted to profile-driven `json-rows.ts` component with goldens

The `extractJsonContent`/`reassembleJsonOutput` logic (currently private in `sqlcmd.strategy.ts`) moves into `json-rows.ts` as an exported `reassembleForJson(stdout, profile)` taking the profile's `outputShape`+`encoding` (chunk size, header presence, codepage). `parseJsonRows` stays UNCHANGED. **Rationale**: testable in isolation with anonymized fixtures; behavior must stay byte-identical for the seeded profile (ADR-008 — goldens prove no drift).

### Decision: `dbgraph doctor` is a new content-free CLI command

New `src/cli/commands/doctor.ts` + `handleDoctor` in `dispatch.ts` + `COMMAND_TABLE['doctor']` + USAGE entry. Runs `CapabilityProbe` stand-alone (no DB connection, no catalog), formats via a pure `src/core/present/doctor.ts` (`formatDoctor(view)`). Output: engine, native-driver bool, CLI tools + versions, ODBC bool, resolved profile NAME, chosen-strategy id — **shape only, zero schema/identifier/secret**. **Rationale**: reuses status's content-free formatter pattern; a unit test asserts the rendered string contains no object/secret text (leak-scanner + L-009 EXACT-set).

## Data Flow

    dbgraph sync ─→ dispatch.handleSync ─→ openConnections ─→ createXSchemaAdapter (factory)
                                                                   │
                                              ┌────────────────────┴───── happy path: SchemaAdapter (UNCHANGED)
                                              │
                                       probe() → resolveProfile → connect/select
                                              │ (driver absent / exhausted / format fail)
                                              ▼
                              throw ConnectivityUnavailableError(ConnectivityOutcome{≥3 options})
                                              │ bubbles (mirrors StrategyExhaustionError)
                                              ▼
                          cli.ts catch(DbgraphError) ─→ present/connectivity.formatOutcome ─→ stderr + exit

    dbgraph doctor ─→ handleDoctor ─→ CapabilityProbe.probe() ─→ present/doctor.formatDoctor ─→ stdout (content-free)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/ports/capability-probe.ts` | Create | `CapabilityProbe` port + `ProbeResult`, `CliToolInfo` (driver-free) |
| `src/core/ports/connectivity-strategy.ts` | Modify | OPTIONAL `probe?()` on the contract (core types only) |
| `src/core/errors.ts` | Modify | `ConnectivityUnavailableError` (`E_CONNECTIVITY_UNAVAILABLE`); `ConnectivityOutcome` + `ConnectivityOption` core types |
| `src/core/present/connectivity.ts` | Create | Pure `formatOutcome(outcome)` — renders ≥3 options |
| `src/core/present/doctor.ts` | Create | Pure `formatDoctor(view)` — content-free probe report |
| `src/core/index.ts` | Modify | Export new types, error, formatters, port |
| `src/adapters/engines/{mssql,pg,mysql,sqlite}/probe.ts` | Create | Per-engine `CapabilityProbe` (driver-present import-check + PATH scan) |
| `src/adapters/engines/{pg,mysql}/factory.ts` | Modify | Driver-absent/connect-fail → build `ConnectivityOutcome`, throw `ConnectivityUnavailableError` (replaces bare `ConnectionError`) |
| `src/adapters/engines/mssql/strategies/profiles.ts` | Create | `SqlcmdProfile` registry + `resolveProfile`; seeded legacy-15.x entry |
| `src/adapters/engines/mssql/strategies/sqlcmd.strategy.ts` | Modify | `probe()` (variant/version + tiny FOR JSON round-trip); profile-driven flags |
| `src/adapters/engines/mssql/strategies/json-rows.ts` | Modify | Exported `reassembleForJson(stdout, profile)`; `parseJsonRows` unchanged |
| `src/adapters/engines/mssql/strategies/registry.ts` | Modify | `selectStrategy` runs `probe()`, threads profile; emits `ConnectivityOutcome` on exhaustion |
| `src/cli/commands/doctor.ts` | Create | `runDoctor` — stand-alone probe surface |
| `src/cli/dispatch.ts` | Modify | `handleDoctor` + `COMMAND_TABLE['doctor']` |
| `src/cli/cli.ts` | Modify | USAGE entry; catch renders `ConnectivityUnavailableError` via `formatOutcome` |
| `src/cli/format/exhaustion.ts` | Modify | Shim → delegates to core `present/connectivity` |
| `.github/workflows/*` | Create | OPT-IN gated sqlcmd lane (mirrors gated-integration; never blocks unit matrix) |
| `test/**` + fixtures | Create | Anonymized F-1..F-9 fixtures; probe/profile/reassembly/outcome/doctor tests |
| `docs/stories/08-resilient-connectivity.md` + README | Create | Epic E8 (US-039..044), Phase 8.5 |

## Interfaces / Contracts

```ts
// src/core/ports/capability-probe.ts — driver-free
export interface CliToolInfo { readonly tool: string; readonly version: string | null; readonly path: string | null; }
export interface ProbeResult { readonly nativeDriver: boolean; readonly cliTools: readonly CliToolInfo[]; readonly odbc: boolean; }
export interface CapabilityProbe { readonly engine: string; probe(): Promise<ProbeResult>; } // MUST NOT throw

// src/core/errors.ts — core types, engine-neutral
export type ConnectivityOption =
  | { readonly kind: 'run-it-yourself'; readonly description: string; readonly queries: readonly string[] }
  | { readonly kind: 'consented-install'; readonly description: string; readonly tool: string; readonly docUrl: string }
  | { readonly kind: 'manual-dump'; readonly description: string; readonly outputPath: string };
export interface ConnectivityOutcome {
  readonly engine: string;
  readonly summary: string;            // content-free
  readonly attempts: readonly StrategyAttempt[];
  readonly options: readonly ConnectivityOption[]; // length >= 3
}
export class ConnectivityUnavailableError extends DbgraphError { constructor(readonly outcome: ConnectivityOutcome) { /* E_CONNECTIVITY_UNAVAILABLE */ } }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | probe (driver-present via injected import seam; PATH scan win32+posix); `resolveProfile`; `reassembleForJson` per profile (F-4/F-5/F-6 fixtures); `formatOutcome` (≥3 options); `formatDoctor` content-free | RED→GREEN; injected `spawnSync`/import seams (existing pattern); golden fixtures; EXACT-set (L-009) |
| Unit | pg/mysql factory: driver-absent → `ConnectivityUnavailableError` with ≥3 options (engine-agnostic); happy connect UNCHANGED | Inject `importPg`/`importMysql` MODULE_NOT_FOUND seam; assert outcome shape |
| Unit | leak assertion: rendered `doctor` + outcome contain NO schema/object/secret | String-contains negative assertions + leak-scanner |
| Integration | sqlcmd transport (flag combos, chunking, encoding) — F-7 | OPT-IN gated CI lane installs pinned sqlcmd; skip-with-notice on install fail; NEVER blocks unit matrix |
| Golden | mssql catalog byte-identical after refactor | Existing goldens stay stable (ADR-008) |

## Migration / Rollout

Additive, back-compatible. `probe?()` optional; happy paths unchanged; goldens byte-identical. Rollback per proposal §Rollback Plan (remove port + probes, restore bare `ConnectionError`, drop profiles/outcome/doctor/CI lane).

## Apply Batch Ordering (TDD-structured)

1. Core types: `CapabilityProbe`+`ProbeResult`, `ConnectivityOutcome`+`ConnectivityOption`, `ConnectivityUnavailableError`, optional `probe?()`, barrel exports.
2. Per-engine `probe.ts` (mssql/pg/mysql/sqlite) — RED→GREEN with injected seams.
3. ConnectivityOutcome wiring: pg/mysql factories (driver-absent → outcome) + mssql `selectStrategy` exhaustion → outcome; `present/connectivity.ts`; `cli.ts` render. Prove happy paths unchanged.
4. `profiles.ts` + seeded legacy-15.x; `sqlcmd.strategy.probe()`; extract `reassembleForJson` to `json-rows.ts` — prove mssql behavior unchanged, goldens stable.
5. `dbgraph doctor` command + `present/doctor.ts` (content-free, leak test).
6. Anonymized F-1..F-9 fixtures + OPT-IN sqlcmd CI lane; boundary/leak/read-only sweep; lint; E8 docs.

## Open Questions

- [ ] None blocking. Profile `versionRange` matching strategy (exact vs semver-range) is an implementation detail for `resolveProfile`; conservative-default-on-miss covers correctness either way.
