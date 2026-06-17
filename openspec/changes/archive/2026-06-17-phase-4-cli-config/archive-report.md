# Archive Report: phase-4-cli-config

**Change**: phase-4-cli-config
**Archived**: 2026-06-17
**Artifact store**: openspec
**Final verdict**: PASS — zero carry-over (0 CRITICAL / 0 WARNING / 5 informational SUGGESTIONS)
**Repo context**: fresh single-history repository (legal scrub of prior codename); phase-4
implemented across commits d1ec48a (Batch A errors+config) through f83c81a (Batch G), with final
docs/learnings commit e948889. All 5 CI jobs green on `main` (matrix ubuntu/windows × 22.x/24.x +
`mssql-integration`).

---

## Executive Summary

Phase 4 (CLI & config) delivered the complete human/script-facing command surface for dbgraph: six
commands (`init`, `sync`, `status`, `query`, `explore`, `diff`), a committeable secret-safe config
layer, incremental sync by fingerprint+body_hash, and a per-object snapshot manifest enabling `diff
snapA snapB` without re-querying the source database. The local-index schema advanced from v1 to v2
(auto-migrate on open; no data loss). A PURE golden-pinned `explore` formatter lands in
`src/core/present/explore.ts` — the Phase-5 MCP tool will reuse the SAME source ("same source, same
golden"). The CLI boundary is enforced by a dedicated test that fails the build on any direct adapter
import. Zero new runtime dependencies. The change ran through seven apply batches (A–G) and one verify
pass (PASS, zero carry-over). The delta specs are promoted to canonical `openspec/specs/`. The change
is closed.

---

## What Shipped

### Source deliverables

| Path | Description |
|------|-------------|
| `src/core/errors.ts` | Added `ConfigError` (`E_CONFIG`), `UnsupportedDialectError` (`E_UNSUPPORTED_DIALECT`) — both extend `DbgraphError`, exported via barrels |
| `src/core/index.ts` | Re-exports `ConfigError`, `UnsupportedDialectError`, `formatExplore`/`ExploreView`/`ExploreDetail`, `SnapshotObjectRow` |
| `src/index.ts` | Added `capabilitiesFor(dialect)` + re-exports `SQLITE_CAPABILITIES`, `MSSQL_CAPABILITIES`, `formatExplore` |
| `src/core/present/explore.ts` | PURE `formatExplore(view, detail)` — no process/Date/adapter imports; shared with Phase-5 MCP tool (ADR-008 golden-pinned) |
| `src/core/ports/graph-store.ts` | Added `SnapshotObjectRow` type + `getSnapshotObjects(snapshotId)` to `GraphStore` interface |
| `src/cli/cli.ts` | Shebang entry; `runCli(argv): Promise<number>`; sole `process.exit` site (centralized, keeps handlers pure) |
| `src/cli/parse/args.ts` | Pure `parseArgv` tokenizer (flags, `=`-form, booleans, `-i`) |
| `src/cli/dispatch.ts` | command→handler table; unknown command → `{ type: 'unknown' }`, never throws |
| `src/cli/exit-code.ts` | Pure `exitCodeFor` mapper: 0/1/2/3/4 per Design Decision 9 |
| `src/cli/config/schema.ts` | `DbgraphConfig` discriminated union (`SqliteSource`, `MssqlSource`), `VALID_LEVELS`, `SUPPORTED_DIALECTS` |
| `src/cli/config/parse-config.ts` | `parseConfig(raw): DbgraphConfig`; rejects unknown dialects + bad levels |
| `src/cli/config/resolve-secrets.ts` | `resolveSecrets(cfg, envMap)`; unset var → `ConfigError` naming the variable; never logs resolved URL |
| `src/cli/config/build-config.ts` | `buildConfig(inputs)` (single builder for both flag form + wizard); `writeConfig` with FIXED key order (ADR-008) |
| `src/cli/config/open-connections.ts` | Single source for config → adapter + store wiring (extracted in Batch G) |
| `src/cli/init/wizard.ts` | `node:readline` wizard; async-iterator pattern (L-010); capability-matrix-driven object types; literal-credential re-prompt |
| `src/cli/commands/init.ts` | `runInit`: writes `dbgraph.config.json` at root, idempotent `.gitignore` append, real `syncAfterInit` seam |
| `src/cli/commands/sync.ts` | `runSync`: fingerprint short-circuit, `computeDelta` body_hash comparison, `putSnapshot` with per-kind counts |
| `src/cli/sync/incremental.ts` | Pure `computeDelta(existing, fresh)`: exact `toDelete`/`toUpsert` id sets |
| `src/cli/commands/status.ts` | `runStatus`: per-kind counts, last snapshot, live DRIFT detection |
| `src/cli/format/status.ts` | Pure `formatStatus(view)`: sorted counts, snapshot section, DRIFT section |
| `src/cli/commands/query.ts` | `runQuery`: `search(store,{term})` → text or JSON; zero-hit → `type:'negative'` (exit 1) |
| `src/cli/format/query.ts` | Pure `formatQueryText` + `formatQueryJson` (stable key order, ADR-008) |
| `src/cli/commands/explore.ts` | `runExplore`: qname → `getNeighbors` → `ExploreView` → `formatExplore(view, detail)` |
| `src/cli/diff/engine.ts` | Pure `diffManifests(a, b): DiffResult` (by nodeId: added/removed/changed) |
| `src/cli/commands/diff.ts` | `runDiff`: `<snapA> <snapB>` or `--last`; pre-v2 degradation; exit 0 no-changes / exit 1 changes |
| `src/cli/format/diff.ts` | Pure `formatDiff`, `formatDiffNoManifest` |
| `src/adapters/storage/sqlite/schema.ts` | Added `SNAPSHOT_OBJECTS_DDL` (table + index) |
| `src/adapters/storage/sqlite/migrations.ts` | Appended `{ version: 2, up }`; bumped `CURRENT_SCHEMA_VERSION = 2` |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | `putSnapshot` populates `snapshot_objects` in same transaction; added `getSnapshotObjects` |
| `package.json` | `"bin": { "dbgraph": "./dist/cli.js" }`; `"build": "tsup"` |
| `tsup.config.ts` | Two-entry build: `index` (esm+cjs+dts, cleans) + `cli` (ESM-only, shebang banner, no clean) |

### Test deliverables

61 test files, 882 tests:

| Layer | Count | Key files |
|-------|-------|-----------|
| Unit — config layer | 59 | errors, barrel, capabilities-for, parse-config, resolve-secrets, build-config |
| Unit — parser+dispatch+exit | 65 | args, dispatch, exit-code, cli |
| Unit — init+wizard | 30 | wizard, init (incl. byte-identity) |
| Unit — sync+status | 36 | incremental, sync, format/status, commands/status |
| Unit — explore+query | 51 | explore-format, commands/explore, commands/query, format/query |
| Unit — storage v2+diff | 50 | schema, sqlite-graph-store, diff/engine, format/diff, commands/diff |
| Unit — build+boundary | 8 | cli/boundaries |
| Integration — SQLite E2E | 15 | e2e (init→sync→query/status/diff, incremental no-op, cross-sync diff) |
| Integration — MSSQL E2E (gated) | 5 | mssql.e2e.integration (`DBGRAPH_INTEGRATION=1`, Testcontainers) |
| Pre-existing suites (unchanged) | ~563 | All phases 1-3 tests continue green |
| Total | 882 | 61 files |

### Gate results (final)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npx tsc --noEmit` | CLEAN — exit 0 |
| Unit tests | `npm test` | PASS — 61 files, 882/882 (exit 0) |
| Lint | `npm run lint` | CLEAN — 0 errors, 0 warnings (exit 0) |
| Integration (MSSQL) | `DBGRAPH_INTEGRATION=1 npm run test:integration` | PASS — 5/5 green in CI (`mssql-integration` job, SQL Server 2022 container) |
| CI matrix | All 5 jobs | GREEN: ubuntu-22.x, ubuntu-24.x, windows-22.x, windows-24.x, mssql-integration |

---

## Apply Batches

### Batch A — Tasks 1.1–1.6 (core errors + barrel seams + config layer)

`ConfigError`/`UnsupportedDialectError` added to `src/core/errors.ts` (gated all downstream work).
`capabilitiesFor(dialect)` at composition root. Full config layer: `DbgraphConfig` discriminated union,
`parseConfig`, `resolveSecrets` (env-map injection for testability), `buildConfig`/`writeConfig`
(plaintext-rejecting, fixed-key-order writer). 88 new tests (errors, barrel, capabilities-for, 3 config
units). Gate: 625/625.

### Batch B — Tasks 2.1–2.4 (hand-rolled parser + dispatch + exit-code mapper + cli skeleton)

Pure `parseArgv` (all flag forms, `=`-assignment, booleans, `-i`). `dispatch` command→handler table
(unknown → `{type:'unknown'}`, never throws). `exitCodeFor` pure mapper (0–4, all typed-error branches).
`cli.ts` shebang entry with `runCli`. 65 new tests. Gate: 690/690.

### Batch C — Tasks 3.1–3.3 (init + readline wizard + byte-identity golden)

`node:readline` wizard with async-iterator pattern (L-010: avoids `question()` + Readable.from
incompatibility), capability-matrix-driven object types, literal-credential re-prompt. `runInit`:
one `buildConfig` → `writeConfig` pipeline for both paths. Idempotent `.gitignore` appender.
Byte-identity golden proven. 30 new tests. Gate: 720/720.

### Batch D — Tasks 4.1–4.3 (sync + status)

`computeDelta`: pure body_hash-based selector, exact `toDelete`/`toUpsert` id sets. `runSync`:
fingerprint short-circuit; delta application; `putSnapshot` with per-kind counts. `syncAfterInit`
seam filled; `_syncFn` injection for test isolation (L-011). `formatStatus` pure formatter with
sorted counts, last-snapshot, DRIFT. 36 new tests. Gate: 756/756.

### Batch E — Tasks 5.1–5.3 (explore formatter + query + explore commands)

`src/core/present/explore.ts` — PURE `formatExplore` with `brief`/`normal`/`full` detail levels;
imports only `../model/node.js` + `../ports/graph-store.js`; boundary-clean from day 1.
`runExplore` assembles `ExploreView` → `formatExplore`. `runQuery` with `--json` stable serialization;
zero-hit → `type:'negative'` (exit 1). 52 new tests. Gate: 808/808.

### Batch F — Tasks 6.1–6.5 (storage v1→v2 + diff engine + diff command)

`SNAPSHOT_OBJECTS_DDL` + v2 forward migration (auto-migrate on open; v1 no-data-loss proven by temp
file-DB test). `putSnapshot` populates manifest inside same `db.transaction()` — no port signature
change. `getSnapshotObjects` additive to port. Pure `diffManifests` engine (nodeId identity,
`oldBodyHash`→`newBodyHash` for changed). `runDiff` with `--last` and pre-v2 degradation. 50 new
tests. Gate: 858/858.

### Batch G — Tasks 7.1–7.6 (build wiring + boundary + E2E + zero-warning sweep)

`tsup.config.ts` two-entry build (L-018: library `clean:true` first, CLI `clean:false` second).
`test/cli/boundaries.test.ts`: 8 tests; proven-biting negative-control for `/adapters/` + driver
imports. SQLite E2E (15 tests): init→sync→query/status/diff, incremental no-op, cross-sync diff,
exit codes. Gated MSSQL E2E (5 tests, Testcontainers, deferred to CI). Extracted
`open-connections.ts`. Fixed 12 lint issues. Gate: 882/882.

---

## Story Status at Archive

| Story | Status | Evidence |
|-------|--------|---------|
| US-001 Non-interactive init | **Done** | `runInit` flag form + exit-code contract; E2E init→sync proven |
| US-002 Interactive init (wizard) | **Done** | `runWizard` capability-driven; literal-credential re-prompt; byte-identity golden |
| US-003 off/metadata/full levels per object type | **Done** | Config `levels` field parsed/validated; `resolveSecrets` + `buildConfig` enforce env-refs; level semantics (Phase-1 normalizer) now hooked up via CLI |
| US-004 Include/exclude filters | **Done** | `include`/`exclude` parsed in `DbgraphConfig`; `status` reports excluded count |
| US-005 Incremental sync | **Done** | Fingerprint short-circuit + `computeDelta` body_hash delta; snapshot written per sync; `sync --full` bypass |
| US-020 dbgraph query | **Done** | `runQuery` → `search`; text + `--json` stable; exit 1 on zero results |
| US-021 dbgraph explore (CLI) | **Done** | `runExplore` → `formatExplore`; brief/normal/full detail; deterministic golden-pinned |
| US-022 dbgraph diff | **Done** | `runDiff` → `diffManifests`; added/removed/modified grouped by type; `--last`; exit 0/1 CI-gate |

---

## Final Gates Checklist

- [x] `npx tsc --noEmit` — CLEAN (exit 0)
- [x] `npm test` — 882/882 PASS (exit 0)
- [x] `npm run lint` — 0 errors, 0 warnings (exit 0)
- [x] All 5 CI jobs green on `main`: ubuntu-22.x, ubuntu-24.x, windows-22.x, windows-24.x, mssql-integration
- [x] Zero CRITICAL findings
- [x] Zero WARNING findings
- [x] Hexagonal boundary: `src/cli/**` never imports `src/adapters/**` (boundary test green + proven-biting)
- [x] Security: target DB read-only; no plaintext credentials; leak-scanner green
- [x] Zero new runtime dependencies

---

## Specs Merged to Main

| Domain | Action | Path |
|--------|--------|------|
| cli-config | Created (greenfield — new capability) | `openspec/specs/cli-config/spec.md` |
| graph-storage | Updated (delta merged: ADDED `snapshot_objects` manifest; MODIFIED schema version 1→2 + migration scenario; MODIFIED snapshot persistence lifts Phase-3 deferral) | `openspec/specs/graph-storage/spec.md` |

---

## Backlog (5 non-blocking SUGGESTIONS from verify — NOT carry-over)

These were classified informational by the verify agent and do not block any future phase.
They are recorded here for reference when Phase 5 or later phases touch related areas:

1. **Byte-exact explore golden for the Phase-5 MCP F5 contract**: explore/diff/query golden tests
   currently assert structural fragments via regex + determinism (`run1 === run2`) rather than a
   stored byte-exact file. Pinning a stored golden would be marginally stricter under ADR-008.
   Revisit when Phase-5 wires the MCP tool to `formatExplore` (the "same source, same golden"
   contract becomes load-bearing at that point).

2. **E2E cross-sync diff assertion uses OR-regex**: `toMatch(/ADDED|e2e_mutated_view/i)` in
   `e2e.test.ts`. Endpoint identity is fully proven at unit level (formatter asserts exact qname;
   engine asserts exact nodeId arrays). Tightening the E2E regex to require the exact qname would
   be marginally stronger. Low priority.

3. **Bare command exit-2 nicety**: `dbgraph` (no args) exits 2 with "Unknown command" + usage.
   `dbgraph --help` correctly exits 0. Optional improvement: route bare invocation to help/exit 0.
   Not a spec violation — Design Decision 9 maps unknown-command to exit 2.

4. **Hardcoded dialect list in `UnsupportedDialectError`**: message currently hardcodes
   `"Available dialects: sqlite, mssql."` rather than deriving from a registry. Fine for two
   dialects; revisit when a third adapter (PostgreSQL/MySQL, Phase 8) is added.

5. **Stale design.md Decision 2 path**: Decision 2 in design.md still names
   `src/cli/format/explore.ts` as the formatter location; the implementation correctly uses
   `src/core/present/explore.ts` (orchestrator override, sanctioned deviation). Not a behavioral
   gap — the spec and code are consistent; only the design doc has a stale path reference.

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/cli-config/spec.md` | Present (new capability — complete spec) |
| `specs/graph-storage/spec.md` | Present (delta as originally written; canonical merged into `openspec/specs/graph-storage/spec.md`) |
| `design.md` | Present (Decision 2 path stale — see Backlog item 5; not a behavioral gap) |
| `tasks.md` | Present (30/30 tasks complete) |
| `apply-progress.md` | Present (Batches A–G, learnings L-010..L-018) |
| `verify-report.md` | Present (PASS, zero carry-over, 5 informational SUGGESTIONS) |
| `state.yaml` | Present (archive: done, change_closed: true) |
| `archive-report.md` | This file |

---

## SDD Cycle Complete

phase-4-cli-config has been fully planned, implemented, verified, and archived.
The `cli-config` capability spec is promoted as a new canonical spec at `openspec/specs/cli-config/spec.md`.
The `graph-storage` canonical spec at `openspec/specs/graph-storage/spec.md` is updated with the
`snapshot_objects` manifest (ADDED), schema-version 1→2 (MODIFIED), and snapshot-persistence deferral
lifted (MODIFIED).
The change folder is closed at `openspec/changes/archive/2026-06-17-phase-4-cli-config/`.

Next recommended change: per the master plan, Phase 5 (MCP server) or Phase 8 (PostgreSQL/MySQL
adapter). Phase 5 MCP can now reuse `formatExplore` from `src/core/present/explore.ts` directly.
Validation against a real enterprise database (Phase 6) is also unblocked — the CLI is now available.
