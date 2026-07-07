# MCP HTTP Transport Specification

## Purpose

The OPT-IN Streamable HTTP serving mode for the dbgraph MCP server, so a single host — where the
graph index and target DB already live — can expose the read-only 8-tool surface to several remote
agents instead of each agent spawning a private STDIO process. It defines: the `node:http` listener
supplied by us and driven by the SDK's `StreamableHTTPServerTransport`; per-session transport
lifecycle keyed by the `mcp-session-id` header; the loopback-default security contract; content-free
diagnostics; and graceful shutdown. STDIO remains the DEFAULT and is unaffected (see `mcp-server`).

> **Honest v1 boundaries.** No authentication ships in v1 — SDK 1.29.0 provides no turnkey server
> auth. Non-loopback exposure is delegated to a reverse proxy / network controls, documented, never
> implied to be authenticated. The SDK's `enableDnsRebindingProtection` / `allowedHosts` /
> `allowedOrigins` are `@deprecated` in 1.29.0 (default OFF); loopback-default bind is the PRIMARY
> containment and the Origin/Host check is parameterized by design (deprecated flags vs in-house
> middleware). Per-agent HTTP client wiring in `dbgraph install` is DEFERRED — NOT claimed here. One
> endpoint serves ONE graph (its own `cwd`). NO new runtime dependency: `node:http` + `node:crypto`
> builtins + the pinned `@modelcontextprotocol/sdk` only.

## Requirements

### Requirement: HTTP serving is opt-in and additive; STDIO is untouched

The server SHALL expose a Streamable HTTP transport ONLY when explicitly requested. A launcher
(`startHttpMcpServer({ host, port })`) alongside the STDIO `startMcpServer()` MUST create a
`node:http` server whose request handler routes to per-session `StreamableHTTPServerTransport`
instances serving the SAME 8 tools. When HTTP is NOT requested, NO listener socket is opened and NO
new output is produced — the STDIO path stays byte-identical to today. The mode MUST add NO new
runtime dependency (`node:http` + `node:crypto` builtins + the pinned SDK only).

#### Scenario: --http serves the 8 tools over Streamable HTTP end to end

- GIVEN the server started in HTTP mode over a graph
- WHEN a client `initialize`s, lists tools, calls one tool, and terminates its session
- THEN exactly the 8 tools (`dbgraph_explore`…`dbgraph_status`) are listed and the tool call returns its result
- AND no write is issued to the target database at any point

#### Scenario: Without HTTP mode no socket is opened

- GIVEN the server started WITHOUT the HTTP mode requested
- WHEN it runs
- THEN no TCP listener is bound and STDIO is the sole transport, byte-identical to today

### Requirement: Loopback-default bind with explicit, warned non-loopback opt-in

The HTTP listener SHALL bind `127.0.0.1` by DEFAULT and a design-selected default port. `--host`
overrides the bind interface and `--port` overrides the port. Binding a NON-loopback interface (e.g.
`0.0.0.0`) MUST be an explicit opt-in AND MUST emit a startup WARNING whose content names (a) that the
endpoint is exposed on a non-loopback interface, (b) that there is NO authentication in v1, and (c)
the reverse-proxy / network-control remedy. The no-auth limitation MUST surface in the STARTUP message
(written to STDERR) whenever HTTP mode starts, regardless of bind.

#### Scenario: Default bind is loopback and states the no-auth posture

- GIVEN HTTP mode started with neither `--host` nor `--port`
- WHEN the listener binds
- THEN it binds `127.0.0.1` on the design-default port
- AND the startup message on STDERR states the loopback-only, no-authentication posture

#### Scenario: Non-loopback bind prints the pinned security warning

- GIVEN HTTP mode started with `--host 0.0.0.0`
- WHEN the listener binds
- THEN a startup WARNING is printed naming the non-loopback exposure, the absence of authentication in v1, and the reverse-proxy remedy
- AND the bind still proceeds (explicit opt-in honored)

### Requirement: Stateful sessions keyed by mcp-session-id

Session handling SHALL be stateful: an `initialize` request carrying NO `mcp-session-id` MUST create a
new session (`sessionIdGenerator` → `randomUUID`) and the response MUST carry the issued
`mcp-session-id` header; a subsequent request carrying that id MUST be routed to the same session's
transport; a `DELETE` carrying the id MUST terminate the session and release it. A non-initialize
request with NO session id and a request bearing an UNKNOWN or already-terminated id MUST be rejected
with the SDK's observable status (missing id → HTTP 400; unknown/terminated id → HTTP 404) and MUST
NOT reach a tool handler.

#### Scenario: initialize issues a session id that routes subsequent requests

- GIVEN an HTTP client with no `mcp-session-id`
- WHEN it POSTs `initialize`
- THEN the response carries a fresh `mcp-session-id` header
- AND a follow-up request bearing that id is routed to the same session

#### Scenario: DELETE terminates the session

- GIVEN an established session id
- WHEN the client sends `DELETE` with that id
- THEN the session is terminated and released
- AND a later request bearing the same id is rejected with HTTP 404

#### Scenario: Missing or unknown session id is rejected by observable status

- GIVEN a non-initialize request with no session id, and a separate request bearing an unknown id
- WHEN each reaches the listener
- THEN the missing-id request is rejected with HTTP 400 and the unknown-id request with HTTP 404
- AND neither reaches any tool handler

### Requirement: Per-session Server via the shared factory; output identical to STDIO

Each session SHALL get its OWN `Server` from the existing `createDbgraphServer()` factory connected to
its transport, reusing the 8-tool table, the static `initialize` instructions, and the PURE
`src/core/present/` formatters UNCHANGED. For the SAME graph and identical tool arguments, a tool's
result content MUST be byte-identical whether served over HTTP or STDIO (single shared formatter, no
transport-specific rendering).

#### Scenario: One tool's output is byte-identical across transports

- GIVEN the SQLite torture fixture served over BOTH STDIO and HTTP
- WHEN `dbgraph_explore({ target: "orders", detail: "brief" })` is called over each transport
- THEN the two tool results are byte-identical to each other
- AND both match the explore × brief golden file (ADR-008)

### Requirement: Read-only preservation, content-free diagnostics, graceful shutdown

HTTP mode SHALL add NO write path: per-request tool handlers keep the `openConnections(process.cwd())`
read-only open/close pattern, issuing no writes to the target database. All startup and diagnostic
output MUST be content-free — it MUST NOT emit any schema/object name, connection string, or resolved
secret (diagnostics go to STDERR). On `SIGINT` or `SIGTERM` the server MUST gracefully shut down: close
every open session's transport and close the `node:http` listener, leaving no dangling handles.

#### Scenario: HTTP mode adds no write surface

- GIVEN any tool invoked over HTTP
- WHEN it opens connections and runs
- THEN it issues only read (catalog SELECT) access and no DDL/DML to the target database

#### Scenario: Diagnostics leak no schema names or secrets

- GIVEN HTTP mode started against a configured graph
- WHEN startup and per-request diagnostics are captured
- THEN they contain NO object/schema name, NO connection-string value, and NO resolved secret

#### Scenario: SIGINT/SIGTERM drains sessions and closes the listener

- GIVEN HTTP mode with one or more open sessions
- WHEN the process receives `SIGINT` or `SIGTERM`
- THEN every open session's transport is closed and the listener stops accepting and closes
- AND the process exits with no dangling handles

### Requirement: Origin/Host validation rejects disallowed requests

The transport SHALL apply an Origin/Host validation check whose MECHANISM is design-selected (the
still-functional deprecated SDK flags OR an in-house middleware check), with loopback-default bind as
the primary containment. The OBSERVABLE contract is fixed: a request whose `Origin` (or `Host`) is not
in the allowed set MUST be rejected with HTTP 403 BEFORE reaching any tool handler; an allowed request
MUST proceed normally.

#### Scenario: Disallowed Origin is rejected before any tool runs

- GIVEN HTTP mode with an allowed-origin policy in effect
- WHEN a request arrives whose `Origin` is not in the allowed set
- THEN it is rejected with HTTP 403 and no tool handler is invoked

#### Scenario: Allowed Origin proceeds

- GIVEN the same policy
- WHEN a request arrives whose `Origin`/`Host` is allowed
- THEN it proceeds to session routing normally
