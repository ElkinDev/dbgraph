# Delta for mcp-server

> Adds a `--project` scope to the existing `install` requirement. Purely additive: the default
> (no-flag) `install` behavior — user-level path resolution and skip-if-absent — is UNCHANGED and
> byte-identical to today, so this is an ADDED requirement, not a MODIFIED one. The per-agent
> project-path matrix is finalized by design; this spec pins the KNOWN-SAFE facts only. Story: US-038.

## ADDED Requirements

### Requirement: dbgraph install --project scopes agent config to the project directory

`dbgraph install --project` SHALL re-root every supported agent's config-path resolution from the user
home to the PROJECT directory (default: the current working directory) and write the SAME per-agent
`dbgraph-mcp` entry (`{ command: "npx", args: ["-y", "dbgraph-mcp"] }`) in that agent's native format
(mcpServers-JSON / servers-JSON / mcp-JSON / TOML per the existing `AGENT_TABLE` families). With
`--project` ABSENT, `dbgraph install` behavior — including user-home resolution and skip-if-absent —
MUST be byte-identical to today and UNCHANGED.

Unlike the default user scope (which SKIPS an agent whose config file is absent and NEVER creates it),
`--project` MUST CREATE an absent project file, because project config files usually do not pre-exist —
a scoped, opt-in departure confined to `--project`. All SIX supported agents have a project-scoped config location VERIFIED by a LIVE official-docs check on
2026-07-06 (Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`, Gemini CLI
`.gemini/settings.json`, opencode `opencode.json`, Codex `.codex/config.toml`), so `--project` now writes
6/6 agents. Codex's project file `<cwd>/.codex/config.toml` reuses the SAME TOML `[mcp_servers.<name>]`
merge-writer as its global `~/.codex/config.toml`; because Codex loads project MCP servers ONLY for
TRUSTED projects, the codex summary line MUST carry a trust-caveat suffix. The exclusion rule REMAINS as
dormant machinery for any FUTURE agent whose project-scoped location cannot be verified: such an agent
MUST be reported with an actionable message and MUST NOT be guessed. `dbgraph install
--project` MUST still exit 0 even when some agents are unsupported at project scope (US-024 spirit).
`dbgraph install --remove --project` MUST mirror install at project scope. Writes MUST remain
deterministic (byte-stable for identical inputs), MUST preserve unrelated keys verbatim — including any
`${env:VAR}` indirection in other entries (NEVER expanded to a cleartext secret) — and the written
`dbgraph-mcp` entry MUST carry only `command` + `args` (no credentials).

#### Scenario: --project creates an absent project file for a supported agent

- GIVEN no `<cwd>/.cursor/mcp.json` exists (Cursor, a design-verified project-scoped agent)
- WHEN `dbgraph install --project` runs with cwd as the project root
- THEN the file is CREATED containing exactly `mcpServers.dbgraph-mcp = { "command": "npx", "args": ["-y", "dbgraph-mcp"] }`, serialized as 2-space-indented JSON with a single trailing newline
- AND the default (no-`--project`) run would have reported Cursor `absent` and created nothing

#### Scenario: --project merges idempotently and preserves unrelated keys

- GIVEN `<cwd>/.cursor/mcp.json` already contains `mcpServers.other = {…}` and a top-level `"foo": 1`
- WHEN `dbgraph install --project` runs
- THEN `mcpServers.dbgraph-mcp` is added equal to `{ "command": "npx", "args": ["-y", "dbgraph-mcp"] }`
- AND `mcpServers.other` and `foo` are preserved unchanged
- AND re-running writes nothing (idempotent) and leaves the file byte-identical

#### Scenario: --project creates an absent Codex config with the exact TOML bytes and a trust-caveat suffix

- GIVEN no `<cwd>/.codex/config.toml` exists (Codex CLI, LIVE-verified 2026-07-06 to support project-scoped `.codex/config.toml` via `[mcp_servers.<name>]` tables, identical format to global `~/.codex/config.toml`)
- WHEN `dbgraph install --project` runs with cwd as the project root
- THEN the file is CREATED via the SAME `mergeCodexToml` writer as global scope, containing exactly the bytes `[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]\n` (single trailing newline — byte-identical to the global writer's output for the absent case)
- AND the codex summary line reads exactly `codex → written (requires trusted project: set trust_level in ~/.codex/config.toml)`
- AND the command exits with code 0

#### Scenario: A future unverified agent is excluded, never guessed (rule dormant today)

- GIVEN a FUTURE agent whose project-scoped config location is NOT verified (as of 2026-07-06 ALL SIX shipped agents — Claude Code, Cursor, VS Code, Gemini CLI, opencode, Codex — are live-verified, so this rule currently binds NO shipped agent and remains as dormant machinery for agents added later)
- WHEN `dbgraph install --project` runs
- THEN that agent is reported as unsupported at project scope via the actionable `→ not supported with --project` message
- AND no path is invented and no project file is written for it

#### Scenario: --remove --project deletes only the entry and leaves a valid file, never deleting it

- GIVEN `<cwd>/.cursor/mcp.json` contains ONLY `mcpServers.dbgraph-mcp`
- WHEN `dbgraph install --remove --project` runs
- THEN the file REMAINS on disk, left as valid JSON `{}` with a single trailing newline (the emptied `mcpServers` key is dropped)
- AND the file is NOT deleted even though the removed entry was the only one

#### Scenario: --remove --project on an absent file is a no-op

- GIVEN no `<cwd>/.cursor/mcp.json` exists
- WHEN `dbgraph install --remove --project` runs
- THEN no file is created and none is written (remove NEVER creates)
- AND the command exits with code 0

#### Scenario: --project preserves ${env:VAR} indirection verbatim

- GIVEN `<cwd>/.cursor/mcp.json` contains another server entry whose args include the string `"${env:DB_PASSWORD}"`
- WHEN `dbgraph install --project` runs
- THEN the `"${env:DB_PASSWORD}"` string is preserved byte-for-byte in the written file
- AND it is NEVER expanded to a cleartext secret
