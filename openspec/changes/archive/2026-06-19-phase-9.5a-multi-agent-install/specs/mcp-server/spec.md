# Delta for MCP Server

## MODIFIED Requirements

### Requirement: dbgraph install idempotently wires the agent MCP config

`dbgraph install` SHALL detect EVERY supported MCP agent present on the machine and, in ONE pass, wire an
idempotent `dbgraph-mcp` server entry into each detected agent's user-level config, driven by a single typed
`AGENT_TABLE` source of truth. It MUST support ≥ 6 agents across three config-format families:
(Previously: it wired ONLY Claude Code via a single-file idempotent JSON merge.)

| Agent | Config key & shape | Format family |
|-------|--------------------|---------------|
| Claude Code, Cursor, Gemini CLI | `mcpServers.dbgraph-mcp = { command, args }` | mcpServers-JSON |
| VS Code | `servers.dbgraph-mcp = { type:'stdio', command, args }` | servers-JSON |
| opencode | `mcp.dbgraph-mcp = { type:'local', command:[…] }` (command is an ARRAY) | mcp-JSON |
| Codex CLI | TOML block `[mcp_servers.dbgraph-mcp]` with `command = "…"`, `args = […]` | TOML |

An agent is configured ONLY if its config file already exists (the agent is considered installed); a missing
env var or a missing file MUST cause that agent to be SKIPPED, never created. Each write MUST be idempotent:
re-running detects the existing `dbgraph-mcp` entry (incl. the TOML block) and writes nothing, never
duplicating. `--remove` MUST delete EXACTLY the `dbgraph-mcp` entry from each detected agent, leaving all
other entries intact. The written entry MUST be `command` + `args` only (no secrets). When ZERO agents are
detected the command MUST print the documented manual snippet and exit successfully. Config paths MUST be
host-independent (`pathWin32.join` on win32, `pathPosix.join` on posix) with the correct env var per agent
per OS, so the resolved path is identical regardless of where Node.js runs.

#### Scenario: mcpServers-JSON agents get the {command,args} entry

- GIVEN existing config files for Claude Code, Cursor and Gemini CLI
- WHEN `dbgraph install` runs
- THEN each file's `mcpServers.dbgraph-mcp` equals `{ "command": "npx", "args": ["-y", "dbgraph-mcp"] }`
- AND any pre-existing `mcpServers` entries are preserved

#### Scenario: VS Code gets a servers entry with type stdio, not mcpServers

- GIVEN an existing VS Code `mcp.json`
- WHEN `dbgraph install` runs
- THEN `servers.dbgraph-mcp` equals `{ "type": "stdio", "command": "npx", "args": ["-y", "dbgraph-mcp"] }`
- AND no `mcpServers` key is written

#### Scenario: opencode gets a local entry with an array command

- GIVEN an existing opencode `opencode.json`
- WHEN `dbgraph install` runs
- THEN `mcp.dbgraph-mcp` equals `{ "type": "local", "command": ["npx", "-y", "dbgraph-mcp"] }`

#### Scenario: Codex CLI gets the TOML mcp_servers block

- GIVEN an existing Codex `config.toml`
- WHEN `dbgraph install` runs
- THEN it contains a `[mcp_servers.dbgraph-mcp]` block with `command = "npx"` and `args = ["-y", "dbgraph-mcp"]`
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
- THEN it prints the documented manual configuration snippet
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
- THEN the entry contains only `command` and `args` (e.g. `npx -y dbgraph-mcp`) and no credentials or tokens
