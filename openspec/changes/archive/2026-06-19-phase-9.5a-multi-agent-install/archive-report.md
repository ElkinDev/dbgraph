# Archive Report: phase-9.5a-multi-agent-install

**Change**: phase-9.5a-multi-agent-install
**Story**: US-038
**Branch**: phases-9-and-9-5
**Archived**: 2026-06-19
**Verdict at archive**: PASS — 0 CRITICAL, 0 WARNING, 2 cosmetic SUGGESTION

---

## What Shipped

`dbgraph install` was extended from Claude-Code-only (US-024) to table-driven multi-agent (US-038).

**Scope**: 6 agents across 3 config-format families, all driven by a single typed `readonly AGENT_TABLE` source of truth. Adding a 7th agent is one table row and one test.

| Agent | Format family | Config path root |
|-------|---------------|-----------------|
| Claude Code | mcpServers-JSON | `%APPDATA%` (win32), `~/.config/Claude` (posix) |
| Cursor | mcpServers-JSON | `%USERPROFILE%` / `HOME` |
| Gemini CLI | mcpServers-JSON | `%USERPROFILE%` / `HOME` |
| VS Code | servers-JSON (`type:'stdio'`) | `%USERPROFILE%` / `HOME` |
| opencode | mcp-JSON (`type:'local'`, array command) | `%USERPROFILE%` / `HOME` |
| Codex CLI | TOML (`[mcp_servers.dbgraph-mcp]`) | `%USERPROFILE%` / `HOME` |

**Key technical decisions carried in:**
- **ADR-007**: In-house Codex TOML micro-writer (`mergeCodexToml`/`removeCodexToml`), zero deps, bounded to the fixed `[mcp_servers.dbgraph-mcp]` block; never a general TOML parser.
- **ADR-004 boundary preserved**: `src/cli/commands/install.ts` imports node builtins only; `src/cli/dispatch.ts` untouched.
- **Multi-pass format-blind `runInstall` loop**: per-agent resolve → exists → read → apply (pure writer) → write-on-change → push result. Loop body is identical for all formats.
- **Idempotency** across all 4 entry shapes including TOML: `next === raw` guard prevents any write on re-run.
- **`--remove`**: removes exactly the `dbgraph-mcp` entry/block per agent; all other entries/blocks are untouched (proven by remove-preserves-adjacent test).
- **Cross-platform path resolution**: explicit `pathWin32.join` / `pathPosix.join` with the correct env var per agent per OS; correct by construction, locked by EXACT per-agent × per-OS unit assertions. The `doctor.ts` host-`basename` bug class is absent.
- **Manual fallback** when zero agents detected: prints `MANUAL_SNIPPET` and exits 0 (US-024 behavior preserved, wording extended to name all 6 agents).

---

## Validation

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS — 0 errors, 0 `any` |
| `npm run lint` (eslint) | PASS — 0 errors / 0 warnings |
| `npm test` (vitest, all units) | PASS — 2758 / 2758 tests, 162 files |
| Install suite focused | PASS — 186 / 186 tests |
| ZERO new runtime deps | Confirmed — `package.json` / `package-lock.json` untouched |
| `src/cli/dispatch.ts` unchanged | Confirmed via git |
| Spec compliance (12/12 scenarios) | PASS — all 12 behavioral scenarios backed by passing tests |
| Verify verdict | PASS — 0 CRITICAL, 0 WARNING |

---

## Stories

- **US-038**: DONE. `dbgraph install` extended to 6-agent table-driven multi-agent install with three writer families (mcpServers-JSON reuse, new VS Code servers-JSON, new opencode mcp-JSON array-command, in-house Codex TOML micro-writer), full idempotency, `--remove`, and manual fallback.
- **US-024**: Extended (preserved); Claude Code install behavior unchanged; regression net stayed green at every batch gate.

---

## Deferred / Tracked

**SUGGESTION-1** (non-blocking): `src/cli/cli.ts` global help banner still reads "Wire dbgraph-mcp into the Claude Desktop config (--remove to undo)". Post-9.5a this is user-facing doc drift. Recommended one-line update: "Wire dbgraph-mcp into your detected MCP agent(s)". Fits the UX/observability spec; cosmetic; no functional impact. Carry into a future UX/observability pass or the 9.5d closeout.

**SUGGESTION-2** (non-blocking): No boundary scanner covers `src/cli/**`. The ADR-004 boundary for `install.ts` is enforced by import discipline + `tsc` + `lint` (all green) and verified by inspection. Noted so the record is accurate; the existing test suite and lint are sufficient guards for this change.

---

## Phase 9.5 Status

| Sub-phase | Status | Notes |
|-----------|--------|-------|
| 9.5a — multi-agent install | **DONE** | This change. US-038 closed. |
| 9.5b — GraphStore node:sqlite port | Next (autonomous) | No external gates; follows naturally. |
| 9.5c — binaries + release | GATED | Blocked on user's Node-SEA-vs-bun ADR (US-037) + CI; cannot start until ADR is decided. |
| 9.5d — v1.0.0 | Blocked | Blocked on benchmark (US-035), Phase 7 completion, and 9.5c. |

---

## Artifacts in This Change

- `openspec/changes/phase-9.5a-multi-agent-install/proposal.md` — intent, scope, risks, rollback
- `openspec/changes/phase-9.5a-multi-agent-install/specs/mcp-server/spec.md` — delta spec (MODIFIED requirement)
- `openspec/changes/phase-9.5a-multi-agent-install/design.md` — architecture decisions (ADR-007, ADR-004), interfaces, AGENT_TABLE contract, data flow
- `openspec/changes/phase-9.5a-multi-agent-install/tasks.md` — 27 tasks (27/27 [x]), batches A–E, Definition of Done (8/8 [x])
- `openspec/changes/phase-9.5a-multi-agent-install/verify-report.md` — PASS, 0 CRITICAL, 0 WARNING, 2 SUGGESTION

## Canonical Spec Updated

- `openspec/specs/mcp-server/spec.md` — "dbgraph install idempotently wires the agent MCP config" requirement replaced with the multi-agent version: table-driven 6-agent detection, 3 format families, 9 behavioral scenarios (up from 2), cross-platform path contract, no-secrets requirement, idempotency + `--remove` + manual fallback.

## Archive Location

`openspec/changes/archive/2026-06-19-phase-9.5a-multi-agent-install/`

---

## Next Change

**`phase-9.5b-graphstore-node-sqlite`** — port `GraphStore` from `better-sqlite3` to `node:sqlite` (the Node.js 22+ built-in). Autonomous; no external gates; no ADR pending.

---

## SDD Cycle Complete

Change fully planned → implemented → verified → archived. The `mcp-server` canonical spec now reflects US-038 multi-agent install behavior. Ready for `phase-9.5b-graphstore-node-sqlite`.
