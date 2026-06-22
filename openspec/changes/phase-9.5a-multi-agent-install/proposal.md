# Proposal: Phase 9.5a — Multi-agent install

## Intent

`dbgraph install` shipped in Phase 5 (US-024) wires the MCP server into ONE agent — Claude Code — via an
idempotent JSON merge. Adoption of every other popular MCP agent (Cursor, Gemini CLI, VS Code, opencode,
Codex CLI) still requires the user to edit a config file by hand, which is exactly the friction the command
exists to remove. US-038 closes that gap and is codegraph's stated distribution-parity lever: the installer
must DETECT and CONFIGURE the user's agent automatically, across ≥6 agents, in one pass.

Why now: Núcleo-5 is complete and the Phase-5 `install` command already exposes the RIGHT seams — an
injected `FsSeam`, injected `platform`/`env`, a pure `resolveConfigPath(platform, env)`, pure
`mergeMcpConfig`/`removeMcpConfig`, and a single-file `runInstall(options)` loop. Multi-agent is the natural,
low-risk generalization of code that is already shaped for it, and it is FULLY unit-testable on Windows with
no real filesystem and no CI — making it the most autonomous slice of Phase 9.5 (9.5b node:sqlite port, 9.5c
binaries+release, 9.5d v1.0.0 all carry external gates this slice does not).

Success = all 6 agents install AND remove idempotently across `win32` and `posix` in unit tests driven by the
existing fake `FsSeam` + injected `platform`/`env`; the no-agent-detected case still prints the manual
snippet and exits 0; ZERO new runtime dependencies (the Codex TOML writer is an in-house micro-writer, not a
`toml` library); `tsc`/`lint`/`test` all green. Adding a 7th agent must be one `AGENT_TABLE` row + one test.

## Scope

### In Scope

- **`AGENT_TABLE`** — a typed `readonly` array of agent descriptors, the single source of truth for detection
  and configuration. Each entry: `{ id, displayName, configPath(platform, env) => string | undefined,
  format, merge, remove }`. Detection is path-based (resolve path → env var present → file exists), reusing
  the exact predicate the shipped command already uses for Claude Code.
- **6 agents** with their real config paths and formats (researched in the explore):
  - **Claude Code** (existing): win `%APPDATA%\Claude\claude_desktop_config.json`,
    posix `~/.config/Claude/claude_desktop_config.json`; JSON key `mcpServers`; entry `{command,args}`.
  - **Cursor**: win `%USERPROFILE%\.cursor\mcp.json`, posix `~/.cursor/mcp.json`; JSON key `mcpServers`;
    entry `{command,args}` — SAME format as Claude Code (reuses `mergeMcpConfig`).
  - **Gemini CLI**: win `%USERPROFILE%\.gemini\settings.json`, posix `~/.gemini/settings.json`; JSON key
    `mcpServers`; entry `{command,args}` — SAME format (reuses `mergeMcpConfig`).
  - **VS Code**: win `%USERPROFILE%\.vscode\mcp.json`, posix `~/.vscode/mcp.json`; JSON key `servers`
    (NOT `mcpServers`); entry `{type:'stdio',command,args}` — DIFFERENT (new `mergeVsCodeConfig`).
  - **opencode**: win `%USERPROFILE%\.config\opencode\opencode.json`, posix
    `~/.config/opencode/opencode.json`; JSON key `mcp`; entry `{<name>:{type:'local',command:[...]}}` where
    `command` is an ARRAY — DIFFERENT (new `mergeOpenCodeConfig`).
  - **Codex CLI**: win `%USERPROFILE%\.codex\config.toml`, posix `~/.codex/config.toml`; TOML
    `[mcp_servers.dbgraph-mcp]` with `command = "…"`, `args = […]` — DIFFERENT format entirely (new in-house
    TOML micro-writer/merger).
- **Three writer families, all PURE (no I/O):**
  1. Reuse the existing `mergeMcpConfig`/`removeMcpConfig` for the 3 `mcpServers`-JSON agents (Claude Code,
     Cursor, Gemini CLI).
  2. New `mergeVsCodeConfig`/`removeVsCodeConfig` — operate on the `servers` key with the `{type:'stdio',…}`
     entry shape.
  3. New `mergeOpenCodeConfig`/`removeOpenCodeConfig` — operate on the `mcp` key with the
     `{type:'local',command:[…]}` array-command shape.
  4. New in-house TOML micro-writer + merger for Codex: idempotently detect an existing
     `[mcp_servers.dbgraph-mcp]` block and the `dbgraph-mcp` entry within it; insert when absent; do not
     duplicate; `--remove` deletes exactly that block. Hand-rolled per ADR-007 (TOML is line-oriented for our
     fixed shape) — NO `toml`/`@iarna/toml` dependency.
- **Multi-pass `runInstall` loop** — for each agent in `AGENT_TABLE`: resolve `configPath(platform, env)` →
  if `undefined` (env var missing) SKIP → if file does not exist SKIP (agent not installed) → else read,
  apply the agent's `merge`/`remove`, write back only when changed → record a per-agent result
  (`installed | already-present | removed | not-present | skipped`). Emit a SUMMARY of every operation.
- **Manual fallback** — when ZERO agents are detected, print the existing manual snippet and exit 0 (the
  unchanged US-024 behavior). Never fail dry.
- **Idempotency + `--remove`** across all 6 agents: re-running detects the existing entry and writes nothing;
  `--remove` iterates the detected agents and removes exactly the `dbgraph-mcp` entry each one added, leaving
  every other entry intact.
- **Exhaustive cross-platform unit tests** — every agent × {win32, posix} path permutation asserted, plus
  merge/remove/idempotency per agent, plus the new-agent-not-installed skip, plus the all-absent manual
  fallback. All via the fake `FsSeam` + injected `platform`/`env`; runs green on Windows with no real FS.

### Out of Scope (scope CUTS, not carry-over)

- Self-contained binaries and the `node:sqlite`/`bun:sqlite` `GraphStore` port — **Phase 9.5b** (node:sqlite)
  and **Phase 9.5c** (binaries + release). The SEA-vs-`bun build --compile` ADR (US-037) is NOT decided here.
- v0.1/v1.0.0 publication, README/benchmark numbers, release workflow — **Phase 9.5c/9.5d** (gated on US-036,
  the benchmark US-035, and Phase 7).
- ANY new runtime dependency — explicitly including a TOML library. The Codex writer is in-house (ADR-007).
- `--agent <name>` targeted single-agent install is a documented NICE-TO-HAVE, not a requirement. Implement
  only if it falls out cheaply from the table; the loop-over-all-detected behavior is the contract.
- JetBrains as a distinct table row — VS Code's `mcp.json` covers the "VS Code/JetBrains via MCP" line in
  US-038 for v1; a dedicated JetBrains path can be a later one-row addition.
- Project-scoped (workspace) config files — this slice configures the USER-level (home/APPDATA) config per
  agent only, matching the shipped Claude Code behavior.

## Capabilities

### New Capabilities

- None. No new bounded context — this extends the existing `install` surface.

### Modified Capabilities

- **`mcp-server`** — the canonical requirement **"dbgraph install idempotently wires the agent MCP config"**
  (`openspec/specs/mcp-server/spec.md`, currently Claude-Code-only) is GENERALIZED to table-driven
  multi-agent install: ≥6 agents, three config formats (`mcpServers`-JSON, VS Code `servers`-JSON, opencode
  `mcp` array-command-JSON, Codex TOML), per-agent idempotent merge/remove, one-pass detect-and-configure
  with a summary, and the unchanged manual-snippet fallback when none is detected. The `src/mcp/**` import
  boundary and the read-only-against-target invariant are untouched. (Confirmed ownership: `cli-config`'s
  spec explicitly lists `install` as OUT OF SCOPE; `mcp-server` owns it.)

## Approach

EXTEND the shipped `src/cli/commands/install.ts` in place — do NOT rewrite. The command already proves the
hexagonal seam (ADR-004: `src/cli` imports node builtins only) and the FS-free test pattern; multi-agent is a
generalization of three existing pieces:

1. **Generalize path resolution per agent.** Today `resolveConfigPath(platform, env)` hard-codes Claude Code.
   Each `AGENT_TABLE` entry carries its OWN `configPath(platform, env)` built with the SAME discipline the
   shipped function already uses: explicit `pathWin32.join` on the win32 branch, `pathPosix.join` on the
   posix branch, and the correct env var per OS (`%APPDATA%` for Claude Code; `%USERPROFILE%` for the
   `~`-rooted agents on win32; `HOME` on posix). Missing env var → `undefined` → skip. This is the precise
   guardrail against the class of bug that bit `doctor.ts` (host `basename`): with NO CI, cross-platform path
   correctness is achieved BY CONSTRUCTION and locked by per-agent × per-OS unit assertions, not by a runner.

2. **Add the writer families as PURE functions** alongside the existing `mergeMcpConfig`/`removeMcpConfig`.
   The three `mcpServers`-JSON agents REUSE the shipped pair verbatim. `mergeVsCodeConfig` and
   `mergeOpenCodeConfig` mirror its idempotent shape (same-value → return the input reference unchanged) for
   their respective keys/entry shapes. The Codex TOML writer is a small, well-tested line-oriented function:
   parse just enough to locate `[mcp_servers.dbgraph-mcp]`, render the fixed entry deterministically, and
   detect-or-insert idempotently — it never parses arbitrary TOML, only our fixed block.

3. **Turn `runInstall` into a loop over `AGENT_TABLE`.** Keep `InstallOptions` (`remove`, `fs`, `platform`,
   `env`, `write`) and the `{type:'success'}` outcome unchanged so dispatch wiring (`handleInstall`) is
   untouched. For each agent: resolve → skip on missing env/file → read (start fresh on malformed) → apply →
   write only on change → push a per-agent result. After the loop, if no agent was detected at all, print the
   manual snippet; otherwise print the per-agent summary. The shipped per-file read/merge/write logic becomes
   the loop body almost verbatim.

Security posture (HARD constraints, already satisfied by the seam): read/write ONLY config files the user
already has; never create an agent's config from nothing (absent file ⇒ "not installed" ⇒ skip); no secrets
written (the entry is `command` + `args`, e.g. `npx -y dbgraph-mcp` — no credentials); `--remove` is clean
and exact; everything stays idempotent.

**Recommended apply batch ordering** (RED→GREEN, EXACT-set assertions per L-009, each batch independently
testable on Windows via the fake `FsSeam`):

- **A — Table + same-format agents.** Define the `AGENT_TABLE` type and rows; add Cursor + Gemini CLI reusing
  `mergeMcpConfig`/`removeMcpConfig`; refactor `runInstall` into the multi-pass loop with per-agent results +
  summary. Tests: Claude Code unchanged (regression), Cursor + Gemini path×OS resolution, install/remove/
  idempotent, manual fallback when all absent.
- **B — VS Code writer.** Add `mergeVsCodeConfig`/`removeVsCodeConfig` (`servers` key, `{type:'stdio',…}`);
  table row. Tests: the `servers`-vs-`mcpServers` distinction explicitly asserted; install/remove/idempotent
  × win32+posix.
- **C — opencode writer.** Add `mergeOpenCodeConfig`/`removeOpenCodeConfig` (`mcp` key, `{type:'local',
  command:[…]}` array command); table row. Tests: array-command shape, install/remove/idempotent ×
  win32+posix.
- **D — Codex TOML micro-writer.** In-house TOML render + detect-or-insert merger + remover; table row.
  Tests: insert into empty/absent block, idempotent re-run (no duplicate `[mcp_servers.dbgraph-mcp]`),
  `--remove` deletes exactly the block, win32+posix paths.
- **E — Summary polish + manual-snippet update + docs.** Multi-agent summary wording; extend `MANUAL_SNIPPET`
  to mention the supported agents; add the "adding an agent = one row + one test" note for CONTRIBUTING.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Modified | `AGENT_TABLE` + per-agent `configPath`; new `mergeVsCodeConfig`/`mergeOpenCodeConfig` + removers; in-house Codex TOML writer/merger/remover; `runInstall` becomes a multi-pass loop with per-agent results + summary |
| `test/cli/commands/install.test.ts` | Modified | Per-agent × {win32, posix} path assertions; merge/remove/idempotency per writer family; VS Code `servers`-vs-`mcpServers` and opencode array-command shape; Codex TOML idempotency; all-absent manual fallback — all via the fake `FsSeam` |
| `src/cli/dispatch.ts` | Unchanged | `handleInstall` already passes `{ remove, fs: realFsSeam }`; the `InstallOptions`/outcome contract is preserved, so no dispatch change is required |
| `docs/stories/07-quality-publication.md` | Modified | Refine US-038 status/notes (the 6 concrete agents + paths/formats, the three-writer split, the in-house-TOML decision, the one-row-per-agent contract) |
| `openspec/specs/mcp-server/spec.md` | Modified (via sdd-spec) | The `install` requirement generalized to multi-agent (authored in the spec phase, not here) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-platform path wrong with NO CI (the `doctor.ts` host-`basename` class of bug) | High | Per-agent `configPath` built with explicit `pathWin32.join`/`pathPosix.join` + correct env var per OS; locked by an EXACT per-agent × per-OS unit assertion (L-009). Correct by construction, not by a runner. |
| `%APPDATA%` vs `%USERPROFILE%` confusion on win32 | Med | Encode the correct var PER AGENT in its `configPath` (Claude Code = `%APPDATA%`; `~`-rooted agents = `%USERPROFILE%`); assert each in tests; missing var ⇒ `undefined` ⇒ skip (never throws). |
| VS Code `servers` vs `mcpServers` silent-fail (writing the wrong key looks successful but the agent ignores it) | Med | A dedicated `mergeVsCodeConfig` keyed on `servers` with the `{type:'stdio',…}` shape; a test asserts the entry lands under `servers` and NOT `mcpServers`. |
| Codex TOML idempotency — duplicating `[mcp_servers.dbgraph-mcp]` on re-run | Med | Detect-or-insert merger that locates the existing block before writing; idempotency test asserts exactly one block after a second run; `--remove` test asserts the block is gone. |
| opencode array-command shape mis-modeled (`command` is `string[]`, not a string + args) | Med | `mergeOpenCodeConfig` models `command` as an array (`['npx','-y','dbgraph-mcp']`); a shape-specific test pins it. |
| In-house TOML writer scope-creep into a general parser | Low | Hand-roll ONLY our fixed block per ADR-007; never parse arbitrary TOML; keep it line-oriented and small. |
| Multi-pass loop corrupts an unrelated agent's config | Low | Each writer is PURE and preserves unknown keys/entries (same contract `mergeMcpConfig` already proves); per-agent "preserves other entries" tests. |
| Scope sprawl into binaries/release | Low | Out-of-scope section pins 9.5b/c/d; this change touches only `install.ts` + its test (+ story/spec refinement). |

## Rollback Plan

Surgical and additive within one file. Revert `src/cli/commands/install.ts` to its shipped single-agent form
(restore the original `resolveConfigPath` + the single-file `runInstall`), drop the new writer functions and
the `AGENT_TABLE`, and revert `test/cli/commands/install.test.ts`. `dispatch.ts` was never changed. No new
dependency to remove. Core, adapters, MCP server, and the rest of the CLI are untouched and remain green;
Claude Code install reverts to exactly the US-024 behavior.

## Dependencies

- Depends on US-024 (shipped Phase 5) — extends `src/cli/commands/install.ts` and its `FsSeam`/`platform`/
  `env` seams.
- ZERO new runtime dependencies. The Codex TOML support is an in-house micro-writer (ADR-007), NOT a `toml`
  library. Imports remain node builtins only (ADR-004: `src/cli` boundary preserved).

## Stories

- Mapped: **US-038** (multi-agent install) — refined here with the 6 concrete agents, their real paths/
  formats, the three-writer split (incl. the in-house Codex TOML writer), and the one-row-per-agent contract.
- Builds on: US-024 (shipped Claude-Code-only install).
- Explicitly deferred to sibling slices: US-037 (binaries / SEA-vs-bun ADR) → 9.5c; node:sqlite port → 9.5b;
  US-036 publication / v1.0.0 → 9.5c/9.5d.

## Success Criteria

- [ ] `AGENT_TABLE` drives detection + configuration for ≥6 agents (Claude Code, Cursor, Gemini CLI, VS Code,
      opencode, Codex CLI); adding a 7th is one row + one test.
- [ ] Each agent installs AND removes idempotently across `win32` and `posix` in unit tests (re-run writes
      nothing; `--remove` deletes exactly the `dbgraph-mcp` entry it added; other entries untouched).
- [ ] Every agent × {win32, posix} config-path permutation is asserted EXACTLY (L-009) via the fake `FsSeam`
      + injected `platform`/`env` — no real filesystem, green on Windows, no CI required.
- [ ] The three formats are honored: `mcpServers`-JSON (Claude Code/Cursor/Gemini), VS Code `servers` with
      `{type:'stdio',…}`, opencode `mcp` with `{type:'local',command:[…]}` array command, and Codex
      `[mcp_servers.dbgraph-mcp]` TOML — VS Code's `servers`-vs-`mcpServers` distinction explicitly tested.
- [ ] When ZERO agents are detected, the manual snippet is printed and the command exits 0 (US-024 behavior
      preserved); a detected run prints a per-agent operation summary.
- [ ] ZERO new runtime dependencies (Codex TOML is in-house, ADR-007); `src/cli` imports node builtins only.
- [ ] `tsc` (no `any`, typed errors), `lint`, and `test` are all green.
