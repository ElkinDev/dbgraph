# Delta for cli-config

> The `install` help/usage banner requirement must now document the `--project` scope flag. This is a
> MODIFIED requirement: the full existing block (from `ux-observability`) is copied and the `install`
> line contract is extended to require the `--project` mention. Story: US-038.

## MODIFIED Requirements

### Requirement: CLI top-level help/usage banner accurately describes every command

The CLI's top-level `--help`/usage banner (`USAGE_TEXT`) SHALL describe each command accurately and
consistently with that command's actual behavior. In particular, the `install` line MUST reflect the
MULTI-AGENT reality — `install` wires the `dbgraph-mcp` server into EVERY supported agent (Claude Code,
Cursor, Gemini CLI, VS Code, opencode, Codex CLI) per the single `AGENT_TABLE` source of truth — and MUST
NOT describe it as wiring only a single specific agent (it MUST NOT say "Claude Desktop"). The `install`
line MUST ALSO document the `--project` flag (project-scoped config) alongside `--remove`. The banner's
supported-agent wording MUST stay consistent with `install`'s `MANUAL_SNIPPET` supported-agents list. A
unit test MUST pin the banner text against the multi-agent reality AND against the `--project` mention.
(Previously: the `install` line documented only `--remove` — "Wire dbgraph-mcp into supported MCP agents (--remove to undo)" — with no mention of the `--project` scope flag.)

#### Scenario: install banner line describes the multi-agent reality

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `install` line is inspected
- THEN it describes wiring `dbgraph-mcp` for supported MCP agents (multi-agent), with `--remove` to undo
- AND it does NOT mention "Claude Desktop" or any single specific agent as the only target

#### Scenario: install banner line documents the --project flag with the exact text

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `install` line is inspected
- THEN it reads exactly `  install   Wire dbgraph-mcp into supported MCP agents (--project for project scope, --remove to undo)` (two leading spaces, `install`, three spaces — same column alignment as the other command lines)
- AND a unit test pins this line so dropping the `--project` mention fails the build

#### Scenario: Banner agent wording stays consistent with install's source of truth

- GIVEN the banner text and `install`'s `MANUAL_SNIPPET` supported-agents list
- WHEN both are compared
- THEN the banner's notion of supported agents is consistent with the `AGENT_TABLE`/`MANUAL_SNIPPET` six-agent set
- AND a unit test pins the banner text so a future single-agent regression fails the build
