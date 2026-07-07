# Proposal: HTTP Transport for the dbgraph MCP Server

## Intent

Today the dbgraph MCP server is STDIO-only: every developer runs a private, per-machine
`dbgraph-mcp` process that their agent spawns and talks to over stdin/stdout. The July competitive
analysis found this to be the ONE real capability gap versus the reference implementation: there is
no way to stand up ONE shared dbgraph MCP endpoint that several developers' agents point at. The
graph is LOCAL (SQLite index next to the DB it describes), so a natural TEAM deployment is a single
host — where the graph and DB already live — exposing the read-only tool surface over HTTP so remote
agents connect instead of each spawning a local process. `@modelcontextprotocol/sdk@1.29.0` (already
pinned) ships `StreamableHTTPServerTransport`, so this is additive plumbing, not a rewrite. Success =
`dbgraph mcp --http` serves the same 8 tools over Streamable HTTP with session management, while bare
`dbgraph mcp` stays byte-identical STDIO.

## Scope

### In Scope
- CLI surface: `dbgraph mcp --http [--port N] [--host H]` — opt-in flag on the EXISTING `mcp` verb.
  STDIO remains the default (bare `dbgraph mcp` and the npm `dbgraph-mcp` bin unchanged). Default
  bind `127.0.0.1`, default port TBD-in-design (e.g. 7423).
- Streamable HTTP transport via the SDK's `StreamableHTTPServerTransport`, hosted on a `node:http`
  server (builtin — ADR-004 clean). Stateful sessions (`sessionIdGenerator` → `randomUUID`,
  `mcp-session-id` header, DELETE terminates), one `Server` instance per session via the existing
  `createDbgraphServer()` factory, and graceful shutdown (drain sessions, close listener).
- Security posture (see below): loopback bind by default, explicit opt-in for non-loopback, honest
  "no auth in v1" documentation, DNS-rebinding / Origin-Host validation.
- Thread the `--http` flags through BOTH MCP entry seams (SEA `planEntry`, npm bin auto-run).

### Out of Scope
- TLS termination in-process — document a reverse-proxy (nginx/Caddy) fronting the loopback listener.
- Authentication / authorization beyond what the SDK ships turnkey (it ships none — see Security).
- Multi-graph routing (one endpoint = one graph in v1; the process serves its own `cwd` graph).
- Rewriting `dbgraph install` to auto-emit HTTP client config for all 6 agents (verification deferred
  to design — per-agent HTTP support is UNVERIFIED and must not be overclaimed).

## Capabilities

### New Capabilities
- `mcp-http-transport`: the Streamable HTTP serving mode — the `node:http` listener, per-session
  `StreamableHTTPServerTransport` lifecycle, session id handling, graceful shutdown, and the
  loopback-default security contract. STDIO behavior is unaffected and remains the default.

### Modified Capabilities
- `mcp-server`: the server gains a SECOND transport path. Requirement change: transport is now
  selectable (STDIO default, HTTP opt-in); the `createDbgraphServer()` factory and 8-tool surface are
  reused unchanged; the STDIO path MUST stay byte-identical off the `--http` flag.
- `cli-config`: the `mcp` entry gains `--http`, `--port`, `--host` flags across both entry seams.

## Approach

Reuse `createDbgraphServer()` (the 8-tool factory) as-is. Add an `startHttpMcpServer({ host, port })`
launcher alongside `startMcpServer()`: it creates a `node:http` server whose request handler routes to
per-session `StreamableHTTPServerTransport` instances (stateful pattern — new session on `initialize`
with no `mcp-session-id`; existing sessions keyed by header; DELETE removes). Each session gets its own
`Server` via the factory and is `connect`ed to its transport. `mcp` is NOT a `cli.ts` dispatch command
today — it is intercepted PRE-dispatch by `sea-entry.planEntry` (SEA) and by `server.ts` auto-run (npm
bin); so `--http` parsing lives in that pre-dispatch layer, and design locks the exact seam (extend
`planEntry` vs promote `mcp` into the dispatch table). Per-request tool handlers keep the existing
`openConnections(process.cwd())` open/close pattern (read-only by construction, ADR-008 determinism).

## Security

Network exposure is NEW surface even though the tool set is read-only. Load-bearing decisions:
- Bind `127.0.0.1` by DEFAULT. Non-loopback (`--host 0.0.0.0`) is an EXPLICIT opt-in with a printed
  warning; the deployment model is "run on the host where the graph lives; remote agents connect".
- NO authentication in v1 — stated plainly in docs. SDK 1.29.0 ships no turnkey server auth (only
  OAuth provider EXAMPLES + an `AuthInfo` middleware hook); wiring auth is out of scope. Security for
  non-loopback deployments is delegated to a reverse proxy / network controls, documented explicitly.
- DNS-rebinding / Origin-Host validation. HONEST SDK finding: `enableDnsRebindingProtection`,
  `allowedHosts`, `allowedOrigins` EXIST but are `@deprecated` in 1.29.0 (default OFF; guidance =
  external middleware). Design decides between using the still-functional deprecated flags and an
  in-house Origin/Host check; either way loopback-default is the primary containment.
- Read-only posture and `${env:VAR}`-only secrets are unchanged — HTTP adds no new write path.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/mcp/server.ts` | Modified | Add `startHttpMcpServer()`; `startMcpServer()`/factory untouched |
| `src/mcp/http.ts` (new) | New | `node:http` listener + per-session transport router + shutdown |
| `src/bin/sea-entry.ts` | Modified | `planEntry` parses `--http/--port/--host` after the `mcp` verb |
| `src/mcp/server.ts` bin guard | Modified | npm `dbgraph-mcp` auto-run honors `--http` flags |
| `src/cli/cli.ts` USAGE | Modified | Document the `mcp --http` surface |
| `src/cli/commands/install.ts` | Deferred | HTTP client config per agent — verify in design, not here |
| `test/mcp/**` | New | HTTP transport session lifecycle + STDIO-unchanged regression |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SDK DNS-rebinding options deprecated → false sense of protection | High | Loopback default is primary containment; design picks middleware vs in-house check honestly |
| `--http` flag threaded through TWO entry seams inconsistently | Med | Single shared flag parser; regression test asserts bare `mcp` stays byte-identical STDIO |
| Not all 6 agents support `type: http` client config | Med | Do NOT auto-wire; design verifies per agent, docs list only confirmed ones |
| Session/in-memory state leak under many clients | Med | `onsessionclosed` cleanup + graceful drain; document single-graph, small-team scope |
| Adding `express`/HTTP framework surface (ADR-006/007) | Low | Use `node:http` builtin + SDK only; add NO new runtime dependency |

## Rollback Plan

Fully additive and flag-gated. Revert by deleting `src/mcp/http.ts`, removing `startHttpMcpServer` and
the `--http` branch from `sea-entry.planEntry` and the npm bin guard, and reverting the USAGE text.
With `--http` absent, every STDIO path — npm `dbgraph-mcp` bin, SEA `dbgraph mcp`, the 8 tools, all 6
installed agents — is byte-identical to today. No spec-level STDIO requirement changes.

## Dependencies

- No new packages (ADR-007): `StreamableHTTPServerTransport` ships in the pinned
  `@modelcontextprotocol/sdk@1.29.0`; `node:http` / `node:crypto` are builtins.
- Reuses `createDbgraphServer()`, the 8-tool table, and `openConnections(process.cwd())` unchanged.

## Success Criteria

- [ ] `dbgraph mcp --http` serves all 8 tools over Streamable HTTP; a client can `initialize`, list
      tools, call a tool, and terminate its session.
- [ ] Bare `dbgraph mcp` (SEA + npm bin) is byte-identical STDIO — regression test proves no drift.
- [ ] Default bind is `127.0.0.1`; `--host`/`--port` override; non-loopback prints a security warning.
- [ ] Sessions are created/keyed/terminated correctly; graceful shutdown drains sessions and closes
      the listener with no dangling handles.
- [ ] Docs state "no auth in v1", the reverse-proxy TLS model, and the loopback-default posture.
- [ ] No new runtime dependency added; `node:http` + SDK only; ADR-004 boundary lint clean.
