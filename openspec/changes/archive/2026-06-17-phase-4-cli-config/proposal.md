# Proposal: Phase 4 — CLI & Config

## Intent

Phases 1-3 delivered core, storage, query, and two extraction adapters — all reachable only as a library.
Phase 4 ships the human/script-facing CLI plus a committeable, secret-safe config so the full DoD flow
`init → sync → query` works against SQLite and local SQL Server WITHOUT writing code. Success = the six
commands green end-to-end on the committed SQLite torture fixture, MSSQL `init → sync → query` green under
`DBGRAPH_INTEGRATION=1`, zero new runtime deps, and the read-only-against-target invariant untouched.

## Scope

### In Scope
- Six commands as a DRIVING adapter under `src/cli/` (imports ONLY `src/index.ts` + Node builtins): `init`
  (+ `-i` wizard driven by the dialect `CapabilityMatrix`; rejects plaintext creds), `sync` (incremental by
  `body_hash` via `fingerprint()`; `--full`), `status` (counts + drift), `query <term>` (`--json`, exit 1 on
  zero), `explore <qname>` (`--detail brief|normal|full`), `diff <a> <b>` / `--last` (exit 1 on changes).
- Config layer: `dbgraph.config.json` parse/validate, `${env:VAR}` resolution, plaintext rejection.
- `snapshot_objects` manifest in the local index so per-object `diff` is possible.
- Build: `bin` + second tsup entry; boundary test fails if `src/cli/**` imports `src/adapters/**`.

### Out of Scope
- `watch` (US-025, deferred), `affected` (US-023, Phase 5), `install` (US-024, Phase 5).
- MCP server/tools and the MCP compact format (Phase 5).

## Capabilities

### New Capabilities
- `cli-config`: the six commands, command→core-API map, `dbgraph.config.json` schema + `${env:VAR}` rules +
  plaintext rejection, the deterministic golden-pinned `explore` formatter (seed for Phase 5 MCP), exit-code
  contract, and `bin`/build wiring.

### Modified Capabilities
- `graph-storage`: snapshot persistence gains a `snapshot_objects(snapshot_id, node_id, kind, qname,
  body_hash)` manifest written by `putSnapshot` and a local-index `CURRENT_SCHEMA_VERSION` 1→2 bump — lifting
  the per-object `diff snapA snapB` DEFERRAL. (Local index only; NOT the target DB.)

## Approach

Hexagonal CLI (ADR-004): hand-rolled subcommand parser + `node:readline` wizard — ZERO new runtime deps. Each
command maps to the public API: `init/sync`→adapter `extract`+`fingerprint`+`upsertGraph`/`deleteNodes`/
`putSnapshot`; `status`→`listSnapshots`+`fingerprint`+counts; `query`→`search`; `explore`→`getNeighbors`;
`diff`→`snapshot_objects` manifests. Output via PURE deterministic formatters (golden-pinned, ADR-008) — the
`explore` formatter is shared with Phase 5's MCP tool ("same source, same golden"). Add `ConfigError` +
`UnsupportedDialectError` to `src/core/errors.ts` (referenced in conventions, absent from the live file).

**Config-location decision (user may veto at gate):** commit `dbgraph.config.json` at PROJECT ROOT (no
secrets, `${env:VAR}` only); keep `.dbgraph/` ENTIRELY gitignored (index + local state). Resolves the §4.8
"committeable config" vs "`.dbgraph/` gitignored" contradiction; US-001's literal `.dbgraph/config.json` text
must be reworded to match.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/cli/` | New | Parser, six commands, wizard, pure formatters |
| `src/core/errors.ts` + barrels | Modified | Add `ConfigError`, `UnsupportedDialectError` |
| `src/adapters/storage/sqlite/` | Modified | `snapshot_objects` table, v1→v2 migration, `putSnapshot` writes manifest |
| `package.json` | Modified | `bin: { dbgraph }` + second tsup entry for `src/cli/cli.ts` |
| `test/cli/boundaries.test.ts` | New | Fail if `src/cli/**` imports `src/adapters/**` |
| `test/` unit + integration | New | Pure-first units; SQLite fixture E2E; gated MSSQL E2E |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Local index v1→v2 migration strategy unresolved | Med | DESIGN decides: auto-migrate vs require `sync --full` (index is a rebuildable cache) |
| `explore` format vs Phase-5 MCP coupling | Med | One PURE golden-pinned formatter shared by both; format designed deliberately now (§4.6) |
| Largest phase so far | High | Slice apply into batches (config → parser → each command → storage delta) |
| CLI imports an adapter directly | Low | Boundary test fails the build |
| Plaintext credential committed | Low | Config writer throws `ConfigError`; never log resolved URLs; `.dbgraph/` gitignored |

## Rollback Plan

Additive at the code layer: delete `src/cli/`, revert `package.json` `bin`/tsup, and remove the new errors.
The storage delta is the only non-trivial revert: drop `snapshot_objects` and restore
`CURRENT_SCHEMA_VERSION` to 1 (existing v1 indexes still open; the index is rebuildable via `sync --full`).
Core, query, and the adapters remain green.

## Dependencies

- ZERO new runtime deps (decided): subcommand parser hand-rolled, wizard via `node:readline`.
- Consumes the existing public API (`search`, `getNeighbors`, `GraphStore`, `SchemaAdapter`, `fingerprint`)
  and the existing `testcontainers` dev dep for the gated MSSQL E2E.

## Stories

- Mapped: US-001..005 (init/sync/levels/filters/incremental), US-020 (query), US-021 (explore), US-022 (diff).
- Deferred: US-023 (affected, P5), US-024 (install, P5), US-025 (watch, P4-optional).

## Success Criteria

- [ ] Six commands green E2E on the committed SQLite torture fixture; MSSQL `init → sync → query` green under `DBGRAPH_INTEGRATION=1`.
- [ ] `query --json` exits 1 on zero results; `diff` exits 1 on changes, 0 when none (CI-gate usable).
- [ ] `explore` output produced by a PURE golden-pinned formatter, reused by the future MCP tool.
- [ ] `dbgraph.config.json` at root with `${env:VAR}` only; the writer rejects plaintext creds; `.dbgraph/` gitignored.
- [ ] `init -i` and `init` with equivalent flags emit byte-identical config; wizard offers only `CapabilityMatrix`-declared object types.
- [ ] `snapshot_objects` persisted; local index migrates 1→2; no new runtime dependency; `src/cli/**` never imports `src/adapters/**` (boundary test green).
- [ ] Target database remains strictly read-only (catalog SELECTs only; repo write-verb scan still green).
