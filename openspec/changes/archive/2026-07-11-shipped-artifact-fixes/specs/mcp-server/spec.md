# Delta for mcp-server

> Bug 1 fix. Both requirements are copied in FULL (per MODIFIED-block archive rule) with the
> written `dbgraph-mcp` entry changed from `args: ["-y", "dbgraph-mcp"]` (a non-existent registry
> package — 404 + squat vector) to the scoped `args: ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]`,
> which runs the `dbgraph-mcp` bin that lives INSIDE `@elkindev/dbgraph`. Only the command/args bytes
> change; every other rule and scenario is preserved verbatim.

## MODIFIED Requirements

### Requirement: dbgraph install idempotently wires the agent MCP config

`dbgraph install` SHALL detect EVERY supported MCP agent present on the machine and, in ONE pass, wire an
idempotent `dbgraph-mcp` server entry into each detected agent's user-level config, driven by a single typed
`AGENT_TABLE` source of truth. It MUST support >= 6 agents across three config-format families. The written
entry MUST invoke the `dbgraph-mcp` bin THROUGH its containing package via
`command: "npx", args: ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]` (opencode's array form:
`["npx", "-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]`).
(Previously: the entry used `args: ["-y", "dbgraph-mcp"]`, which targeted a registry package named
`dbgraph-mcp` that does NOT exist — broken for registry users and a squattable auto-executed name.)

| Agent | Config key & shape | Format family |
|-------|--------------------|---------------|
| Claude Code, Cursor, Gemini CLI | `mcpServers.dbgraph-mcp = { command, args }` | mcpServers-JSON |
| VS Code | `servers.dbgraph-mcp = { type:'stdio', command, args }` | servers-JSON |
| opencode | `mcp.dbgraph-mcp = { type:'local', command:[…] }` (command is an ARRAY) | mcp-JSON |
| Codex CLI | TOML block `[mcp_servers.dbgraph-mcp]` with `command = "…"`, `args = […]` | TOML |

An agent is configured ONLY if its config file already exists; a missing env var or a missing file MUST cause
that agent to be SKIPPED, never created. Each write MUST be idempotent: re-running detects the existing
`dbgraph-mcp` entry (incl. the TOML block) and writes nothing, never duplicating. `--remove` MUST delete
EXACTLY the `dbgraph-mcp` entry from each detected agent, leaving all other entries intact. The written entry
MUST be `command` + `args` only (no secrets). When ZERO agents are detected the command MUST print the
documented manual snippet and exit successfully. Config paths MUST be host-independent (`pathWin32.join` on
win32, `pathPosix.join` on posix) with the correct env var per agent per OS.

#### Scenario: mcpServers-JSON agents get the {command,args} entry

- GIVEN existing config files for Claude Code, Cursor and Gemini CLI
- WHEN `dbgraph install` runs
- THEN each file's `mcpServers.dbgraph-mcp` equals `{ "command": "npx", "args": ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"] }`
- AND any pre-existing `mcpServers` entries are preserved

#### Scenario: VS Code gets a servers entry with type stdio, not mcpServers

- GIVEN an existing VS Code `mcp.json`
- WHEN `dbgraph install` runs
- THEN `servers.dbgraph-mcp` equals `{ "type": "stdio", "command": "npx", "args": ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"] }`
- AND no `mcpServers` key is written

#### Scenario: opencode gets a local entry with an array command

- GIVEN an existing opencode `opencode.json`
- WHEN `dbgraph install` runs
- THEN `mcp.dbgraph-mcp` equals `{ "type": "local", "command": ["npx", "-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"] }`

#### Scenario: Codex CLI gets the TOML mcp_servers block

- GIVEN an existing Codex `config.toml`
- WHEN `dbgraph install` runs
- THEN it contains a `[mcp_servers.dbgraph-mcp]` block with `command = "npx"` and `args = ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]`
- AND any other existing TOML content is preserved

#### Scenario: Only agents with an existing config file are configured

- GIVEN Claude Code's config file exists but Cursor's does not (and Cursor's env var is unset)
- WHEN `dbgraph install` runs
- THEN Claude Code is configured and Cursor is reported skipped/not-present
- AND no Cursor config file is created

#### Scenario: Re-running is idempotent for every format including TOML

- GIVEN every detected agent already contains the `dbgraph-mcp` entry from a prior install
- WHEN `dbgraph install` runs again
- THEN each JSON agent still has exactly one `dbgraph-mcp` entry and the Codex file has exactly one `[mcp_servers.dbgraph-mcp]` block
- AND no file is rewritten with a changed value

#### Scenario: --remove deletes only the dbgraph-mcp entry per agent

- GIVEN every detected agent contains the `dbgraph-mcp` entry alongside other entries
- WHEN `dbgraph install --remove` runs
- THEN the `dbgraph-mcp` entry (and the Codex `[mcp_servers.dbgraph-mcp]` block) is gone from each agent
- AND every other entry/block in those files is untouched

#### Scenario: No detected agent prints the manual snippet and exits 0

- GIVEN a machine where no supported agent config file exists
- WHEN `dbgraph install` runs
- THEN it prints the documented manual configuration snippet (whose examples show the scoped `npx -y -p @elkindev/dbgraph dbgraph-mcp` command)
- AND it exits successfully (never fails dry)

#### Scenario: Config paths resolve correctly on win32

- GIVEN `platform = win32`, `APPDATA = C:\Users\u\AppData\Roaming`, `USERPROFILE = C:\Users\u`
- WHEN each agent's `configPath` is resolved
- THEN Claude Code resolves to `C:\Users\u\AppData\Roaming\Claude\claude_desktop_config.json`
- AND Cursor (USERPROFILE-rooted) resolves to `C:\Users\u\.cursor\mcp.json`
- AND opencode (USERPROFILE `.config`-rooted) resolves to `C:\Users\u\.config\opencode\opencode.json`

#### Scenario: Config paths resolve correctly on posix

- GIVEN `platform = linux` and `HOME = /home/u`
- WHEN each agent's `configPath` is resolved
- THEN Claude Code resolves to `/home/u/.config/Claude/claude_desktop_config.json`
- AND Cursor resolves to `/home/u/.cursor/mcp.json`
- AND opencode resolves to `/home/u/.config/opencode/opencode.json`

#### Scenario: Written entries carry no secrets

- GIVEN any detected agent being configured
- WHEN its `dbgraph-mcp` entry is written
- THEN the entry contains only `command` and `args` (e.g. `npx -y -p @elkindev/dbgraph dbgraph-mcp`) and no credentials or tokens

### Requirement: dbgraph install --project scopes agent config to the project directory

`dbgraph install --project` SHALL re-root every supported agent's config-path resolution from the user
home to the PROJECT directory (default: the current working directory) and write the SAME per-agent
`dbgraph-mcp` entry (`{ command: "npx", args: ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"] }`) in that
agent's native format (mcpServers-JSON / servers-JSON / mcp-JSON / TOML per the existing `AGENT_TABLE`
families). With `--project` ABSENT, `dbgraph install` behavior — including user-home resolution and
skip-if-absent — MUST be byte-identical to today and UNCHANGED.
(Previously: the written entry used `args: ["-y", "dbgraph-mcp"]`, targeting a non-existent registry package.)

Unlike the default user scope (which SKIPS an agent whose config file is absent and NEVER creates it),
`--project` MUST CREATE an absent project file. All SIX supported agents have a project-scoped config location
VERIFIED by a LIVE official-docs check on 2026-07-06 (Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`,
VS Code `.vscode/mcp.json`, Gemini CLI `.gemini/settings.json`, opencode `opencode.json`, Codex
`.codex/config.toml`), so `--project` writes 6/6 agents. Codex's project file `<cwd>/.codex/config.toml`
reuses the SAME TOML `[mcp_servers.<name>]` merge-writer as its global config; because Codex loads project
MCP servers ONLY for TRUSTED projects, the codex summary line MUST carry a trust-caveat suffix. The exclusion
rule REMAINS as dormant machinery for any FUTURE unverified agent, which MUST be reported with an actionable
message and MUST NOT be guessed. `dbgraph install --project` MUST still exit 0 even when some agents are
unsupported at project scope. `dbgraph install --remove --project` MUST mirror install at project scope.
Writes MUST remain deterministic, MUST preserve unrelated keys verbatim — including any `${env:VAR}`
indirection (NEVER expanded to a cleartext secret) — and the written `dbgraph-mcp` entry MUST carry only
`command` + `args` (no credentials).

#### Scenario: --project creates an absent project file for a supported agent

- GIVEN no `<cwd>/.cursor/mcp.json` exists (Cursor, a design-verified project-scoped agent)
- WHEN `dbgraph install --project` runs with cwd as the project root
- THEN the file is CREATED containing exactly `mcpServers.dbgraph-mcp = { "command": "npx", "args": ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"] }`, serialized as 2-space-indented JSON with a single trailing newline
- AND the default (no-`--project`) run would have reported Cursor `absent` and created nothing

#### Scenario: --project merges idempotently and preserves unrelated keys

- GIVEN `<cwd>/.cursor/mcp.json` already contains `mcpServers.other = {…}` and a top-level `"foo": 1`
- WHEN `dbgraph install --project` runs
- THEN `mcpServers.dbgraph-mcp` is added equal to `{ "command": "npx", "args": ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"] }`
- AND `mcpServers.other` and `foo` are preserved unchanged
- AND re-running writes nothing (idempotent) and leaves the file byte-identical

#### Scenario: --project creates an absent Codex config with the exact TOML bytes and a trust-caveat suffix

- GIVEN no `<cwd>/.codex/config.toml` exists (Codex CLI, LIVE-verified 2026-07-06 to support project-scoped `.codex/config.toml` via `[mcp_servers.<name>]` tables)
- WHEN `dbgraph install --project` runs with cwd as the project root
- THEN the file is CREATED via the SAME `mergeCodexToml` writer as global scope, containing exactly the bytes `[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]\n` (single trailing newline — byte-identical to the global writer's output for the absent case)
- AND the codex summary line reads exactly `codex → written (requires trusted project: set trust_level in ~/.codex/config.toml)`
- AND the command exits with code 0

#### Scenario: A future unverified agent is excluded, never guessed (rule dormant today)

- GIVEN a FUTURE agent whose project-scoped config location is NOT verified (as of 2026-07-06 ALL SIX shipped agents are live-verified, so this rule currently binds NO shipped agent)
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
