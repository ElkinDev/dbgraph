# Serving the dbgraph MCP tools over HTTP

By default `dbgraph mcp` (and the `dbgraph-mcp` npm bin) speaks **stdio** — each agent
spawns its own private server process. The optional `--http` flag instead serves the
same read-only 8-tool surface over **Streamable HTTP**, so a single host — where the
graph index and the target database already live — can expose the tools to several
remote agents at once.

```bash
dbgraph mcp --http                    # bind 127.0.0.1:7423 (loopback default)
dbgraph mcp --http --port 8080        # override the port
dbgraph mcp --http --host 0.0.0.0     # bind all interfaces (see the warning below)
dbgraph mcp --http --quiet            # suppress startup + per-session logs, keep warnings/errors
```

The endpoint is `http://<host>:<port>/mcp`; the default is
**`http://127.0.0.1:7423/mcp`**. Port `7423` is unassigned in the IANA registry and is
not a common dev-server default. `--port` must be an integer in `1–65535` and `--host`
requires an explicit value; an invalid value exits `2` (the standard `ConfigError`
contract).

Startup prints one line to **stderr** (stdout stays machine-clean):

```text
dbgraph mcp: Streamable HTTP on http://127.0.0.1:7423 (read-only, no auth)
```

## Security posture — read this before exposing anything

- **No authentication in v1.** The `@modelcontextprotocol/sdk` (1.29.0) ships no
  turnkey server auth, and dbgraph adds none. Anyone who can reach the `host:port` can
  call the read-only tools. This is stated plainly, never implied to be authenticated.
- **Loopback bind is the PRIMARY containment.** The default `127.0.0.1` bind means only
  processes on the same host can connect. This is the recommended posture for local
  multi-agent use.
- **Read-only by construction.** Every tool call opens a per-request catalog connection
  and issues only `SELECT`s — no DDL/DML ever reaches the target database. HTTP mode adds
  no write surface.
- **Content-free diagnostics.** Startup and per-session log lines carry no schema/object
  name, no connection string, and no resolved secret — only the bind address and opaque
  session UUIDs.
- **Defense-in-depth Origin/Host check.** A foreign `Origin` (or, on a loopback bind, a
  foreign `Host`) is rejected with HTTP `403` before any tool handler runs — this blocks
  the browser DNS-rebinding vector without breaking header-less agents. It is *not* a
  substitute for network controls.

### Exposing beyond loopback

Binding a non-loopback interface is an explicit opt-in and prints this pinned warning:

```text
WARNING: --host 0.0.0.0 exposes the dbgraph MCP endpoint on ALL interfaces with NO
authentication. Anyone who can reach this host:port can call the read-only tools. Front
it with a reverse proxy (TLS + auth) or restrict via network controls.
```

For any non-loopback deployment, **front the endpoint with a reverse proxy** (nginx,
Caddy, …) that terminates TLS and enforces authentication, and/or restrict access with
firewall/network rules. dbgraph deliberately delegates transport security and auth to
that layer rather than shipping a half-measure.

```nginx
# nginx sketch — TLS + auth in front of the loopback dbgraph endpoint
location /mcp {
    auth_basic           "dbgraph";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass           http://127.0.0.1:7423/mcp;
}
```

One endpoint serves exactly **one graph** — the graph rooted at the process's working
directory. Run one server per project.

## Per-agent HTTP client configuration (verified 6/6)

Streamable-HTTP client support was verified against each agent's official docs on
2026-07-06. dbgraph does **no** auto-wiring for HTTP in v1 (`dbgraph install` wires the
stdio entry only) — add the server to your agent by hand using the exact shape below.

> **Watch the nuances.** Two of these silently misconfigure if copied from another
> agent's shape: Gemini needs `httpUrl` (a plain `url` selects the deprecated SSE
> transport), and Cursor takes **no** `type` field (it is inferred from the `url`).

| Agent | Config file | Exact shape | Load-bearing nuance |
|-------|-------------|-------------|---------------------|
| Claude Code | `.mcp.json` | `{"mcpServers":{"dbgraph":{"type":"http","url":"http://localhost:7423/mcp"}}}` | `type` is `"http"` (alias `"streamable-http"` also accepted); SSE is deprecated. |
| Cursor | `.cursor/mcp.json` | `{"mcpServers":{"dbgraph":{"url":"http://localhost:7423/mcp"}}}` | **NO `type` field** — transport is inferred from the `url`; optional `headers` supported. |
| VS Code | `.vscode/mcp.json` | `{"servers":{"dbgraph":{"type":"http","url":"http://localhost:7423/mcp"}}}` | Top-level key is **`servers`** (not `mcpServers`); `type` is `"http"`. |
| Gemini CLI | `settings.json` | `{"mcpServers":{"dbgraph":{"httpUrl":"http://localhost:7423/mcp"}}}` | **Use `httpUrl`** = Streamable HTTP; a plain `url` = deprecated SSE (silent failure). |
| opencode | `opencode.json` | `{"mcp":{"dbgraph":{"type":"remote","url":"http://localhost:7423/mcp"}}}` | `type` is `"remote"`; opencode's docs do not name the wire protocol — treated as remote HTTP without over-claiming. |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.dbgraph]`<br>`url = "http://localhost:7423/mcp"` | Current Codex needs no feature flag; **older installs** may still require `[features]` `experimental_use_rmcp_client = true`. Optional `bearer_token_env_var` / `http_headers` for a fronting proxy. |

### Codex CLI (TOML)

```toml
[mcp_servers.dbgraph]
url = "http://localhost:7423/mcp"
# Older Codex installs only: uncomment if the HTTP client is missing.
# [features]
# experimental_use_rmcp_client = true
```

### Gemini CLI — `httpUrl`, not `url`

```jsonc
{
  "mcpServers": {
    "dbgraph": { "httpUrl": "http://localhost:7423/mcp" }
  }
}
```

Using `url` here does **not** error — it silently selects the legacy SSE transport
instead of Streamable HTTP. Always use `httpUrl` for dbgraph.
