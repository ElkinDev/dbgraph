# Proposal: Phase 5 — MCP Server

## Intent

Phases 1-4 made the graph reachable as a library and a human CLI. Phase 5 exposes it to AI agents over MCP
so one tool call answers what today costs 5+ exploratory queries (the E3 DoD). The value lever is a
token-budgeted COMPACT format, designed and golden-pinned FIRST (US-019) — the "fewer tokens" promise must be
measurable and stable. Success = 8 tools green over the committed SQLite torture fixture via an in-process
SDK harness, deterministic golden output per tool × detail, `@modelcontextprotocol/sdk` the ONLY new runtime
dep, the read-only-against-target invariant untouched, and `src/mcp/**` never importing `src/adapters/**` or
`src/cli/**` (boundary test green).

## Scope

### In Scope
- `docs/format-spec.md` (US-019) authored BEFORE server code: line grammar (table/column/edge + annotations
  like `[3 idx, 1 trg!]`), pagination (`offset`/`limit`/`hasMore`), golden discipline, per-tool/per-`detail`
  token budgets set EMPIRICALLY (measured on the torture fixture; budgets marked **TBD until measured**).
- New PURE golden-pinned formatters in `src/core/present/` for search/object/related/impact/path/status/
  precheck — extending the existing `formatExplore` seed; compact MCP-specific (NOT the CLI human formatters).
- 8 MCP tools as a DRIVING adapter under `src/mcp/` (imports ONLY `src/index.ts` barrel + Node builtins +
  the SDK): `explore`, `search`, `object`, `related`, `impact`, `path`, `precheck`, `status`.
- `dbgraph_precheck` core (identifier-matching v1, ZERO new dep): DDL identifier extraction → graph match →
  `getImpact` aggregation; everything tagged `confidence: 'parsed'`. Backs the CLI `affected` too.
- `dbgraph install` (US-024) minimum viable: idempotent JSON merge into Claude Code's MCP config; `--remove`
  undoes; manual-snippet fallback when no agent detected.
- Thin `dbgraph affected` CLI wrapper (US-023) over the shared precheck core (`--json`).
- Static `initialize` instructions (US-018) as a golden-tested string in `src/mcp/instructions.ts`.
- Build: third tsup entry + `package.json` `bin: { dbgraph-mcp }`; boundary test extended for `src/mcp/**`.

### Out of Scope (scope CUTS, not carry-over)
- `node-sql-parser` (deferred): v1 precheck is regex identifier-matching, ~90% coverage; perfect parse later.
- Cursor-based pagination (offset/limit only for v1).
- Multi-agent table-driven install (US-038, Phase 9.5); inferred-path traversal inside tools.

## Capabilities

### New Capabilities
- `mcp-server`: the 8 tools + their tool→core-API map, the COMPACT format contract referencing
  `docs/format-spec.md`, the new `src/core/present/` formatters, `offset`/`limit`/`hasMore` pagination, the
  precheck identifier-matching engine + `confidence` tagging, static `initialize` instructions, `dbgraph
  install` + `dbgraph affected`, the `dbgraph-mcp` bin/build wiring, and the `src/mcp/**` boundary rule.

### Modified Capabilities
- None. All orchestration lives in `src/mcp/` over the existing public API; no core requirement changes.
  (`object`/`precheck` are NEW orchestrators that compose existing store reads — no `graph-query` delta.)

## Approach

Hexagonal MCP as a DRIVING adapter (ADR-004), mirroring the Phase-4 CLI. 6 tools map ~1:1 to the public API:
`explore`→`getNeighbors`+`formatExplore` (CLI `runExplore` precedent), `search`→`search` (FTS5+Levenshtein,
paginated), `related`→`getNeighbors`, `impact`→`getImpact`, `path`→`findJoinPath`, `status`→`listSnapshots`
+counts+`SnapshotRecord.fingerprint` (CLI `runStatus` precedent). 2 NEW orchestrators (no core change):
`object` assembles columns+indexes+constraints+triggers via `getNodeByQName`/`getNode`/`getEdgesFrom`;
`precheck` extracts qualified identifiers from DDL (regex, reusing the MSSQL `tokenizer.ts` pattern) →
matches via `search`/`getNodeByQName` → aggregates `getImpact`, tagging `confidence: 'parsed'`. Output via
PURE deterministic formatters, golden-pinned (ADR-008). Decided resolutions baked in: format-spec FIRST;
add `@modelcontextprotocol/sdk` PINNED (verify stdio server + `InMemoryTransport` client shape against the
pinned version); precheck = zero-dep identifier-matching v1; static instructions; offset/limit pagination.

**BLOCKING boundary fix (early batch):** `openConnections` lives in `src/cli/config/open-connections.ts`;
MCP cannot import it (cli↔mcp boundary). MOVE it to a NEUTRAL `src/infra/open-connections.ts`, re-export via
`src/index.ts`; both CLI and MCP import the barrel. Update the CLI import + `test/cli/boundaries.test.ts`.

**Recommended apply batch ordering** (LARGE phase → batched): A) format-spec + present formatters →
B) `openConnections` move + SDK dep + `src/mcp/server.ts` scaffold + instructions → C) simple tools
(explore/search/related/path/status) → D) complex tools (object/impact/precheck core) → E) install +
`affected` wrapper + bin/tsup/boundary wiring.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/mcp/` | New | `server.ts` stdio entry (`#!/usr/bin/env node`), 8 tools, `instructions.ts`, precheck engine |
| `src/core/present/` | Modified | New pure formatters: search/object/related/impact/path/status/precheck |
| `src/infra/open-connections.ts` | New (moved) | Relocated from `src/cli/config/`; re-exported via `src/index.ts` |
| `src/cli/` | Modified | `affected` command (thin wrapper), `install` command, updated `openConnections` import |
| `docs/format-spec.md` | New | Compact-format grammar + token budgets (US-019) |
| `package.json` | Modified | Add `@modelcontextprotocol/sdk` (pinned); `bin: { dbgraph-mcp }`; third tsup entry |
| `test/cli/boundaries.test.ts` | Modified | Also fail if `src/mcp/**` imports `src/adapters/**` or `src/cli/**` |
| `test/` | New | Per-formatter goldens; precheck unit tests; in-process SDK harness E2E (mirrors `test/cli/e2e.test.ts`) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `openConnections` cli↔mcp boundary blocker | High | Move to `src/infra/` + barrel re-export FIRST (Batch B); no ADR exception, no duplication |
| Token budgets guessed not measured | Med | Budgets **TBD**; pin AFTER a golden measurement on the torture fixture; format-spec records methodology |
| SDK API drift (stdio + `InMemoryTransport`) | Med | PIN exact version; verify server/test-client shape against it before building tools |
| Precheck regex misses identifiers (~90%) | Med | Tag `confidence: 'parsed'`; document the cut; `affected` reports non-parseable fallback; defer `node-sql-parser` |
| `src/mcp/` imports an adapter or the CLI | Low | Boundary test fails the build |
| Largest phase so far | High | Five batches A→E; each independently testable |

## Rollback Plan

Mostly additive: delete `src/mcp/`, `docs/format-spec.md`, the new `src/core/present/` formatters, the
`affected`/`install` commands; revert `package.json` (`@modelcontextprotocol/sdk`, `dbgraph-mcp` bin, tsup
entry) and the boundary-test addition. The only non-additive revert is `openConnections`: move it back to
`src/cli/config/open-connections.ts` and restore the CLI import (mechanical, single file). Core, query,
adapters, and the existing CLI remain green.

## Dependencies

- `@modelcontextprotocol/sdk` (PRE-APPROVED, pinned exact) — the ONLY new runtime dep. NO `node-sql-parser`.
- Consumes the existing public API (`getNeighbors`, `getImpact`, `findJoinPath`, `search`, `getNodeByQName`,
  `listSnapshots`, `formatExplore`) and reuses the MSSQL `tokenizer.ts` regex pattern for precheck.

## Stories

- Mapped: US-010..017 (the 8 tools), US-018 (instructions), US-019 (format-spec), US-023 (affected), US-024 (install).
- Deferred: US-038 (multi-agent install, Phase 9.5); `node-sql-parser`-grade precheck; cursor pagination.

## Success Criteria

- [ ] `docs/format-spec.md` exists with line grammar + per-tool/per-`detail` token budgets, measured on the torture fixture.
- [ ] 8 tools green over the committed SQLite torture fixture via an in-process `InMemoryTransport` SDK harness; golden file per tool × detail.
- [ ] Every tool's output is produced by a PURE golden-pinned `src/core/present/` formatter; changing a golden requires a spec + token-delta justification.
- [ ] `dbgraph_precheck` aggregates DDL across statements (deduped), tags `confidence`; `dbgraph affected` reuses the same engine with `--json`.
- [ ] `initialize` returns the static instructions; each tool description carries one example call; zero user-maintained instruction files.
- [ ] `dbgraph install` idempotently wires Claude Code's MCP config; `--remove` undoes; manual snippet printed when no agent detected.
- [ ] `@modelcontextprotocol/sdk` is the only new runtime dep; `dbgraph-mcp` bin + third tsup entry build; `src/mcp/**` never imports `src/adapters/**` or `src/cli/**` (boundary test green).
- [ ] Target database remains strictly read-only.
