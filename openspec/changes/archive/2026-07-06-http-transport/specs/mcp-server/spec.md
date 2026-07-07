# Delta for MCP Server

## MODIFIED Requirements

### Requirement: Transport-selectable server with static initialize instructions

The server SHALL start as an `@modelcontextprotocol/sdk` server (`src/mcp/server.ts`,
`#!/usr/bin/env node`) registering the 8 tools, with a SELECTABLE transport: STDIO is the DEFAULT
(`startMcpServer()` → `StdioServerTransport`) and Streamable HTTP is an OPT-IN alternative
(`startHttpMcpServer()`, see `mcp-http-transport`). The `createDbgraphServer()` factory, the 8-tool
table, and the static `initialize` instructions MUST be reused UNCHANGED across BOTH transports. Its
`initialize` response MUST surface usage guidance from a STATIC, golden-tested string in
`src/mcp/instructions.ts` (US-018): when to use explore vs search vs object, and the recommended
pre-change flow (status → explore → precheck). Each tool description MUST carry exactly ONE example
call. There MUST be zero user-maintained instruction files. With the HTTP mode ABSENT, the STDIO path
MUST stay BYTE-IDENTICAL to today through BOTH MCP entry seams — the SEA `dbgraph mcp` route
(`sea-entry.planEntry` dispatching `startMcpServer()`) AND the npm `dbgraph-mcp` bin auto-run guard —
producing no new output and taking no new branch off the flag.
(Previously: the server started ONLY as a stdio transport entry; there was no transport selection and no HTTP launcher.)

#### Scenario: initialize returns the static golden instructions

- GIVEN the in-process SDK client linked to the server
- WHEN it sends `initialize`
- THEN the response includes the static guidance string (explore-vs-search-vs-object + status→explore→precheck flow) matching its golden
- AND each registered tool description carries exactly one example call

#### Scenario: Bare mcp stays byte-identical STDIO across both entry seams

- GIVEN the HTTP mode is absent (bare `dbgraph mcp` / npm `dbgraph-mcp`)
- WHEN the server starts through the SEA `planEntry` route AND through the npm bin auto-run guard
- THEN each starts `startMcpServer()` over `StdioServerTransport` with no new output and no HTTP listener
- AND the STDIO behavior is byte-identical to before this change (regression-pinned)

#### Scenario: Both transports serve the identical 8-tool surface from one factory

- GIVEN the STDIO transport and the HTTP transport
- WHEN each is connected to a `Server` built by `createDbgraphServer()`
- THEN both expose the same 8 tools with the same descriptions and `initialize` instructions
- AND no transport-specific tool rendering exists (formatters are shared, ADR-008)
