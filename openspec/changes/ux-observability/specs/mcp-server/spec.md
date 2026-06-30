# Delta for MCP Server

Change: `ux-observability`. This domain is **verify-only** — no requirement changes are introduced here.

## Verify-only conclusions (no ADDED / MODIFIED / REMOVED)

1. **`install` help text is already multi-agent.** The `mcp-server` spec's `dbgraph install idempotently
   wires the agent MCP config` requirement already mandates ≥ 6 agents (Claude Code, Cursor, Gemini CLI,
   VS Code, opencode, Codex CLI) via the single `AGENT_TABLE`. The stale "Claude Desktop" wording is in the
   CLI's TOP-LEVEL `USAGE_TEXT` banner, which the `cli-config` spec owns. The banner fix therefore lands as
   a `cli-config` MODIFIED requirement, NOT here. No `mcp-server` text changes.

2. **Wiring a CLI logger MUST NOT alter the MCP path.** `openConnections` (relocated to
   `src/infra/open-connections.ts`) is shared composition consumed by BOTH the CLI and the MCP server, and
   it already accepts an OPTIONAL logger defaulting to no-op. This change only makes the CLI dispatch
   handlers pass a real console logger; the MCP server MUST keep its existing behavior (no-op or its own
   logger). The design phase MUST confirm the MCP path is unchanged.

## ADDED Requirements

(none)

## MODIFIED Requirements

(none)

## REMOVED Requirements

(none)
