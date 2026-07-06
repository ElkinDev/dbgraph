# Design: HTTP Transport for the dbgraph MCP Server (http-transport)

## Technical Approach

Additive, flag-gated second transport for the EXISTING `mcp` verb. `createDbgraphServer()` (the
8-tool factory) and `startMcpServer()` (STDIO) are reused UNTOUCHED. A new `src/mcp/http.ts` adds
`startHttpMcpServer({host,port})`: a `node:http` listener whose request handler routes to per-session
`StreamableHTTPServerTransport` instances (stateful — new session on `initialize`, keyed by
`mcp-session-id`, DELETE terminates). Each session gets its OWN `Server` via the factory, `connect`ed
to its transport; tool handlers keep the existing per-request `openConnections(process.cwd())`
open/close pattern (read-only by construction, ADR-008). A SINGLE pure `parseMcpFlags()` threads
`--http/--port/--host/--quiet` through BOTH MCP entry seams (SEA `planEntry`, npm `dbgraph-mcp` bin
guard) WITHOUT promoting `mcp` to a CLI dispatch command. Security: loopback bind by default, an
IN-HOUSE Origin/Host validator (the SDK's built-in flags are `@deprecated` in 1.29.0), and honest
"no auth in v1" docs. NO new runtime dependency — `node:http`/`node:crypto` builtins + the pinned SDK
only (ADR-004/006/007). Boundary: `src/mcp/**` still imports ONLY the barrel + Node builtins + SDK.

## Architecture Decisions

### Decision: D1 — Keep `mcp` PRE-dispatch; one shared pure flag parser feeds BOTH seams
**Choice**: `mcp` stays intercepted before `cli.ts` dispatch. A pure `parseMcpFlags(args) → {kind:'stdio'} | {kind:'http',host,port,quiet}` lives in `src/mcp/http.ts`. `sea-entry.planEntry` extends its `mcp` branch to `{ mode:'mcp', transport: parseMcpFlags(argsAfterMcp) }`; `runSeaEntry` dispatches `stdio → startMcpServer()` vs `http → startHttpMcpServer(opts)`. The npm `dbgraph-mcp` bin guard parses `process.argv.slice(2)` through the SAME function (no `mcp` token to strip — the bin *is* the server). | **Alternatives**: (a) promote `mcp` into `dispatch.ts` `COMMAND_TABLE`; (b) duplicate flag parsing in each seam. | **Rationale**: promoting `mcp` breaks THREE contracts — a `CommandHandler` returns `HandlerOutcome` and `cli.ts` is the ONLY `process.exit` site, but an MCP server is long-lived and never yields an exit code (STDIO stays alive on the transport, HTTP on the listener); the npm `dbgraph-mcp` bin bypasses `cli.ts` entirely so a dispatch entry would not help it; and ADR-004 forbids `src/cli/**` importing the `src/mcp` composition (the boundary scanner from phase-5 D10). A single shared PURE parser removes the "threaded through two seams inconsistently" risk and is unit-testable without spawning. Byte-identical STDIO is guaranteed: with no `--http`, both seams call `startMcpServer()` with no args — today's exact path.

### Decision: D2 — `node:http` listener + per-session transport; per-REQUEST DB connection
**Choice**: `http.createServer` → handler calls `transport.handleRequest(req,res)`. A `SessionRegistry` (`Map<sessionId,{transport,server}>`): POST w/o `mcp-session-id` + `isInitializeRequest` creates a transport (`sessionIdGenerator: randomUUID`, `onsessioninitialized: register`, `onsessionclosed: drop+close`) + a fresh `createDbgraphServer()`; requests carrying a known `mcp-session-id` reuse; unknown/absent-on-non-init → the SDK's own 404/400. Tool calls keep the existing `openConnections(process.cwd())` open/close **per request** (neither per-process nor per-session). | **Alternatives**: one shared process-wide connection; one connection per session (lifetime-coupled). | **Rationale**: the graph is a LOCAL SQLite index (better-sqlite3 / node:sqlite). better-sqlite3 is synchronous/single-threaded — a shared process handle would serialize every session onto one connection and risk interleaving; a per-session handle leaks a file handle whenever a session leaks. A short-lived per-request read connection keeps ZERO shared mutable state, makes each HTTP tool call byte-identical to the STDIO path (same factory, no store override), and exploits SQLite's native multi-reader concurrency (read-only, ADR-008). Open/close cost on a local file is negligible and matches the proven STDIO behavior.

### Decision: D3 — In-house Origin/Host validator, NOT the deprecated SDK flags
**Choice**: a PURE `validateOriginHost({headers, bindHost, port}) → {ok:true} | {ok:false,status:403,reason}` runs BEFORE `handleRequest`. Do NOT set the SDK's `enableDnsRebindingProtection`/`allowedHosts`/`allowedOrigins`. Pinned policy: **Origin** absent → allow (header-less agents); present → allow only loopback origins (`http://localhost|127.0.0.1|[::1][:port]`), else 403. **Host** on loopback bind → allow only `{127.0.0.1, localhost, [::1]}(:port)`, else 403. On `--host 0.0.0.0` the external hostname is unknowable → Host check RELAXED (any), Origin rejection STAYS on, warning printed. Reject → `403` + content-free JSON-RPC body `{jsonrpc,error:{code:-32000,message:'Forbidden'},id:null}` (mirrors the SDK's shape). | **Alternatives**: use the still-functional deprecated SDK flags; no validation (rely on loopback only). | **Rationale**: VERIFIED in `@modelcontextprotocol/sdk@1.29.0` `webStandardStreamableHttp.d.ts` — all three options carry `@deprecated Use external middleware …`; wiring protection through a deprecated API would sell removable behavior as a guarantee (HONESTY). Reasoned honestly: MCP agents send NO `Origin`; the DNS-rebinding vector is a BROWSER page (rebinds a name → 127.0.0.1, sends `Origin: evil` + `Host: evil`). Rejecting a foreign Host / foreign Origin blocks that vector without breaking header-less agents. This validator is DEFENSE-IN-DEPTH; the **loopback default is the PRIMARY containment** — it is not a substitute for network controls / a reverse proxy on non-loopback deployments.

### Decision: D4 — Default port 7423, default bind 127.0.0.1, `--host 0.0.0.0` opt-in + pinned warning
**Choice**: default `--port 7423`, default `--host 127.0.0.1`. `--port` parsed as int 1–65535; invalid → `ConfigError` (→ exit 2 via the existing seams' catch, consistent with exit-code.ts "any DbgraphError → 2"). `--host 0.0.0.0` prints a pinned WARN-level line. | **Alternatives**: a well-known/common dev port (8080/3000). | **Rationale**: 7423 is in the registered range (1024–49151), NOT a well-known port (0–1023), and not a common dev-server default (3000/5173/8000/8080/9000). IANA CROSS-CHECK RESOLVED (verified live 2026-07-06, method: grep of the live IANA Service Name and Transport Protocol Port Number Registry CSV): **7423 is FREE** — unassigned (7420 Reserved, 7421 mtportmon, 7422–7425 empty, 7426 pmdmgr); no notable common-usage collision. Loopback default is load-bearing for D3. Warning text (pinned): `WARNING: --host 0.0.0.0 exposes the dbgraph MCP endpoint on ALL interfaces with NO authentication. Anyone who can reach this host:port can call the read-only tools. Front it with a reverse proxy (TLS + auth) or restrict via network controls.`

### Decision: D5 — No new dependency; honest note on the SDK's internal Hono use
**Choice**: create our own `node:http` server and call `transport.handleRequest(req,res)`; add NOTHING to `package.json`. | **Rationale**: ADR-004/006/007 forbid an `express`/`fastify` runtime surface. HONEST finding: the Node `StreamableHTTPServerTransport` internally wraps `WebStandardStreamableHTTPServerTransport` via `@hono/node-server`'s `getRequestListener` — but that is a TRANSITIVE dependency of the already-pinned `@modelcontextprotocol/sdk@1.29.0`, not a new direct dep, and our code still owns the `node:http` listener. The ADR-004 boundary lint stays clean; no framework is added.

### Decision: D6 — Session cleanup, graceful drain; idle reaper deferred
**Choice**: `onsessionclosed` (DELETE) drops the registry entry AND closes its `Server`; `startHttpMcpServer` returns a `{ port, close() }` handle and installs SIGINT/SIGTERM → `close()` = stop accepting (`httpServer.close()`) + `await transport.close()` for every session (drain) + resolve. | **Alternatives**: no drain (hard exit); mandatory idle-timeout reaper in v1. | **Rationale**: draining prevents dangling handles (success criterion). An idle-session reaper is a SHOULD (small-team, single-graph scope per proposal) — deferred to Open Questions so v1 ships the deterministic DELETE/close path first.

### Decision: D7 — Observability via the Logger port, STDERR only, `--quiet` aware
**Choice**: `startHttpMcpServer` takes an optional `Logger` (port from the barrel; default = a tiny STDERR logger local to `src/mcp`, since ADR-004 blocks importing `src/cli/log`). INFO: one pinned startup line `dbgraph mcp: Streamable HTTP on http://{host}:{port} (read-only, no auth)`. WARN: the D4 non-loopback warning. DEBUG: `session initialized/closed {uuid}` (content-free). `--quiet`/`-q` → level `warn` (suppresses startup + per-session lines, KEEPS the warning + errors) — mirrors `dispatch.ts` `buildLogger`. | **Rationale**: reuses the ux-observability seam; STDERR keeps parity with STDIO's machine-clean stdout; session UUIDs are not secrets.

## Data Flow

```
dbgraph mcp --http --port 7423           dbgraph-mcp --http        (npm bin)
      │ sea-entry.planEntry                     │ server.ts isMain guard
      │  parseMcpFlags(argsAfter 'mcp')          │  parseMcpFlags(argv.slice(2))
      └──────────────┬───────────────────────────┘
                     ▼   {kind:'http',host,port}      {kind:'stdio'} ─▶ startMcpServer()  (BYTE-IDENTICAL, unchanged)
            startHttpMcpServer({host,port})
                     │ http.createServer
   request ─▶ validateOriginHost(headers) ──403──▶ Forbidden (JSON-RPC -32000)
                     │ ok
                     ├─ POST init (no sid) ─▶ new transport(randomUUID)+createDbgraphServer()+connect ─▶ register
                     ├─ *,  mcp-session-id ─▶ registry.get(sid).transport.handleRequest(req,res)
                     └─ DELETE / onsessionclosed ─▶ registry.drop(sid) + server.close()
   tool.run ─▶ openConnections(process.cwd())  [per request, read-only] ─▶ close in finally
   SIGINT/SIGTERM ─▶ close(): httpServer.close() + drain all transports
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/mcp/http.ts` | Create | `node:http` listener, `SessionRegistry`, per-session `StreamableHTTPServerTransport` router, `parseMcpFlags` (pure), `validateOriginHost` (pure), STDERR Logger default, `startHttpMcpServer({host,port,quiet,logger}) → {port,close()}`, graceful shutdown. |
| `src/mcp/server.ts` | Modify | npm `dbgraph-mcp` bin guard parses `process.argv.slice(2)` via `parseMcpFlags` → stdio (default, UNCHANGED) vs `startHttpMcpServer`. `createDbgraphServer`/`startMcpServer`/tool table untouched. |
| `src/bin/sea-entry.ts` | Modify | `EntryPlan` `mcp` variant carries `transport: parseMcpFlags(...)`; `runSeaEntry` dispatches stdio vs http. `NODE/SEA_ARGV_OFFSET` seam unchanged. |
| `src/cli/cli.ts` | Modify | `USAGE_TEXT` documents the `dbgraph mcp --http [--port N] [--host H]` surface (transport note, not a dispatch command). |
| `test/mcp/http.test.ts` | Create | Unit: `parseMcpFlags`, `validateOriginHost`, `SessionRegistry`, message goldens. In-process loopback E2E: init→list→call→DELETE→404, 403 rejection, graceful drain. STDIO-unchanged regression. |
| `test/bin/sea-entry.test.ts` | Modify | `planEntry` `mcp` → stdio (default) and http transport plans. |
| `docs/**` (agent HTTP config, no-auth-v1, reverse-proxy TLS) | Authored in tasks | Per-agent matrix VERIFIED (D-matrix below, 2026-07-06); docs MUST carry the Gemini `httpUrl`-vs-`url` and Cursor no-`type` nuances wherever example configs appear, else users silently get SSE/misconfig. |
| `src/cli/commands/install.ts` | Not in scope | No HTTP auto-wiring this change (proposal ruling). |

## Interfaces / Contracts

```ts
// src/mcp/http.ts
export type McpTransportPlan =
  | { readonly kind: 'stdio' }
  | { readonly kind: 'http'; readonly host: string; readonly port: number; readonly quiet: boolean };

/** PURE — throws ConfigError on invalid --port. args = flags AFTER the transport token. */
export function parseMcpFlags(args: readonly string[]): McpTransportPlan;

/** PURE — in-house DNS-rebinding defense (NOT the deprecated SDK flags). */
export function validateOriginHost(input: {
  headers: { host?: string; origin?: string };
  bindHost: string; port: number;
}): { ok: true } | { ok: false; status: 403; reason: string };

export function startHttpMcpServer(
  opts: { host: string; port: number; quiet?: boolean; logger?: Logger },
  deps?: { createServer?: (store?: GraphStore) => Server }, // defaults to createDbgraphServer
): Promise<{ readonly port: number; close(): Promise<void> }>;
```
```ts
// src/bin/sea-entry.ts — extended
export type EntryPlan =
  | { readonly mode: 'mcp'; readonly transport: McpTransportPlan }
  | { readonly mode: 'cli'; readonly args: readonly string[] };
```
SDK options USED: `sessionIdGenerator`, `onsessioninitialized`, `onsessionclosed`. SDK options
NOT used (all `@deprecated` in 1.29.0, VERIFIED in `.d.ts`): `allowedHosts`, `allowedOrigins`,
`enableDnsRebindingProtection`.

## Batch 0 — empirical findings (against installed `@modelcontextprotocol/sdk@1.29.0`)

Verified 2026-07-06 by inspecting the installed `dist/esm/server/streamableHttp.{d.ts,js}` +
`webStandardStreamableHttp.{d.ts,js}` AND by running two throwaway in-process `node:http` loopback
probes (created outside version control, run, then deleted — tree clean). This section RESOLVES the
design Open Question "SDK `handleRequest` body handling" and pins the recipe that Batch 2 (2.4)
hard-codes.

### 0.1 — `handleRequest` body recipe: DESIGN BRANCH TAKEN = PRE-PARSE (the documented fallback), not raw-only

**Import**: `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'`.
Signature (VERIFIED `.d.ts`): `handleRequest(req: IncomingMessage & { auth?: AuthInfo }, res: ServerResponse, parsedBody?: unknown): Promise<void>`.

**Observed (raw-req works)**: passing the RAW `req`/`res` with `parsedBody` OMITTED SUCCEEDS. The Node
wrapper feeds the raw `IncomingMessage` through `@hono/node-server`'s `getRequestListener` → Web
`Request` → `WebStandardStreamableHTTPServerTransport.handleRequest(webRequest, { parsedBody: undefined })`,
which at `webStandardStreamableHttp.js:392-398` does `if (options?.parsedBody !== undefined) rawMessage = options.parsedBody; else rawMessage = await req.json();`. Probe 1 confirmed: raw `initialize` POST → **200**,
`mcp-session-id` issued, `onsessioninitialized` fired, `tools/list` on the session → 200.

**Why raw-only is INSUFFICIENT for our router (the load-bearing empirical truth)**: routing an
UNKNOWN / already-terminated `mcp-session-id` through a FRESHLY minted (uninitialized) transport does
NOT yield the spec-mandated **404** — it yields **400 `Bad Request: Server not initialized`** (probe 1,
steps 4 & 6). The SDK's own **404 `Session not found` (-32001)** fires ONLY inside an ALREADY-initialized
transport's private `validateSession` when a *mismatched* id arrives — it is a per-transport check, NOT a
registry-level one. A raw-only router therefore CANNOT produce the spec's split (missing→400 /
unknown-or-terminated→404), and cannot gate new-session creation on `isInitializeRequest` (that needs the
body).

**DECISION (recipe Batch 2 consumes — FINAL)**: the router PRE-PARSES the POST body ONCE (read the
`req` stream → `JSON.parse`), and:
1. `mcp-session-id` present AND in `SessionRegistry` → route to that transport, `await transport.handleRequest(req, res, body)` (pass `parsedBody`).
2. `mcp-session-id` ABSENT AND `isInitializeRequest(body)` → mint transport + `createServer()` + `connect`, then `handleRequest(req, res, body)`; `onsessioninitialized` registers it.
3. `mcp-session-id` present but NOT in the registry (unknown/terminated) → router emits **404** `{jsonrpc:'2.0',error:{code:-32001,message:'Session not found'},id:null}` (byte-mirrors the SDK's `createJsonErrorResponse(404,-32001,'Session not found')`). NO body read needed for this branch.
4. else (absent id + non-init) → router emits **400** `{jsonrpc:'2.0',error:{code:-32000,message:'Bad Request: No valid session ID provided'},id:null}`.
5. `DELETE` with a known id → route raw to the session transport (SDK `handleDeleteRequest` → `onsessionclosed` → `close()` → **200**); unknown id → router **404**.

Probe 2 drove this exact recipe end-to-end over loopback and observed: init→**200**+sid; list(known)→**200**;
non-init/no-sid→**400** `No valid session ID provided`; unknown-sid→**404** `Session not found`;
DELETE→**200** (`onsessionclosed` fired); terminated-sid→**404**; registry drained to size 0. This is the
canonical multi-session pattern and is byte-deterministic. `parsedBody` is passed ONLY for POST; DELETE/GET
carry no body. `handleRequest` returns a `Promise<void>` and writes the response itself (default
`content-type: text/event-stream` — the SDK's SSE default; `enableJsonResponse` left at its `false`
default, so `initialize`/tool results arrive as a single SSE `data:` frame — B3's raw-`fetch` assertions
parse that frame; SDK `Client` handles it transparently).

### 0.2 — session-lifecycle surface (VERIFIED present on 1.29.0)

Constructor options (on `WebStandardStreamableHTTPServerTransportOptions`, aliased as
`StreamableHTTPServerTransportOptions`):
- `sessionIdGenerator?: () => string` — pass `() => randomUUID()` from `node:crypto`.
- `onsessioninitialized?: (sessionId: string) => void | Promise<void>` — fires AFTER a successful `initialize`; our `register` hook.
- `onsessionclosed?: (sessionId: string) => void | Promise<void>` — fires on a valid `DELETE`; our `drop + server.close()` hook.

`transport.close(): Promise<void>` — VERIFIED (used by the drain path). `isInitializeRequest` —
`import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'`, signature
`(value: unknown) => value is InitializeRequest` (VERIFIED). DELETE handler (`webStandardStreamableHttp.js:567`):
`validateSession` → `onsessionclosed?()` → `this.close()` → `new Response(null, { status: 200 })`.

Deprecated flags CONFIRMED `@deprecated` (do NOT set — D3): `allowedHosts` (`.d.ts:82`),
`allowedOrigins` (`.d.ts:88`), `enableDnsRebindingProtection` (`.d.ts:94`).

Exact SDK status/message strings observed (so our router mirrors them): non-init without session id on a
fresh transport → `400` `-32000` `Bad Request: Server not initialized`; missing id (validateSession) →
`400` `-32000` `Bad Request: Mcp-Session-Id header is required`; unknown/mismatched id → `404` `-32001`
`Session not found`. Our router adopts `404 / -32001 / Session not found` verbatim for the registry-miss
branch and `400 / -32000 / Bad Request: No valid session ID provided` (canonical SDK-example wording) for
the absent-id non-init branch.

## Per-Agent HTTP Config Matrix — VERIFIED LIVE 2026-07-06

Streamable-HTTP CLIENT support confirmed for **6/6** target agents against official docs (verified
2026-07-06). This SUPERSEDES the earlier "UNVERIFIED — excluded" ruling. This change still does NO
auto-wiring: the matrix is consumed by DOCS only (README / mcp docs section), letting users hand-add
the server to their agent of choice. A future `install --http` could build on this matrix to
auto-write these files, but that is out of scope here (proposal ruling: no HTTP auto-wiring in v1).

| Agent | Config file | Exact shape | Load-bearing nuance | Source |
|-------|-------------|-------------|---------------------|--------|
| Claude Code | `.mcp.json` | `{"mcpServers":{"dbgraph":{"type":"http","url":"http://localhost:7423/mcp"}}}` | `type` is `"http"`; alias `"streamable-http"` also accepted; SSE is deprecated. | code.claude.com/docs/en/mcp |
| Cursor | `.cursor/mcp.json` | `{"mcpServers":{"dbgraph":{"url":"http://localhost:7423/mcp"}}}` | NO `type` field — transport is INFERRED from the url; optional `headers` supported. | cursor.com/docs/context/mcp |
| VS Code | `.vscode/mcp.json` | `{"servers":{"dbgraph":{"type":"http","url":"http://localhost:7423/mcp"}}}` | Top-level key is `servers` (not `mcpServers`); `type` is `"http"`. | code.visualstudio.com/docs/copilot/chat/mcp-servers |
| Gemini CLI | `settings.json` | `{"mcpServers":{"dbgraph":{"httpUrl":"http://localhost:7423/mcp"}}}` | LOAD-BEARING: `httpUrl` = Streamable HTTP; plain `url` = SSE legacy. Use `httpUrl`. | gemini-cli docs/tools/mcp-server.md |
| opencode | `opencode.json` | `{"mcp":{"dbgraph":{"type":"remote","url":"http://localhost:7423/mcp"}}}` | `type` is `"remote"`; docs do NOT name the wire protocol explicitly — noted honestly, treat as remote HTTP. | opencode.ai/docs/mcp-servers |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.dbgraph]` <br> `url = "http://localhost:7423/mcp"` (+ `bearer_token_env_var` / `http_headers`) | The old `[features] experimental_use_rmcp_client` gate is ABSENT from current docs (graduated). Caveat: OLD installed Codex versions may still need that flag. | developers.openai.com/codex/mcp + /config-reference |

DOCS HONESTY (MUST carry into README / mcp docs wherever example configs appear):
- **Gemini CLI**: `httpUrl` vs `url` is silent-failure territory — a plain `url` selects the deprecated
  SSE transport, not Streamable HTTP. Every documented Gemini example MUST use `httpUrl`.
- **Cursor**: NO `type` field — transport is inferred from the `url`. Adding a `type` key (copied from
  the Claude Code / VS Code shape) risks misconfiguration; document the type-less shape explicitly.
- **opencode**: wire protocol not named in docs; document as `type:"remote"` without over-claiming
  Streamable-HTTP compliance.
- **Codex CLI**: note the `experimental_use_rmcp_client` caveat for users on older installs.

## Testing Strategy

| Layer | What to Test | Approach (strict TDD, RED-first) |
|-------|-------------|----------------------------------|
| Unit | `parseMcpFlags` | stdio default; `--http`/`--port N`/`--host H`/`--quiet`; invalid port → `ConfigError`. Pure, no I/O. |
| Unit | `validateOriginHost` | no Origin→ok; loopback Origin→ok; foreign Origin→403; good Host→ok; foreign Host→403; `0.0.0.0` relaxes Host, keeps Origin. Pure. |
| Unit | `SessionRegistry` + `close()` drain | add/get/drop/size; shutdown closes all (spy transports/servers). |
| Unit | log/message goldens | pinned startup line + non-loopback warning strings. |
| Integration (loopback, in `npm test`) | session lifecycle | `startHttpMcpServer({host:'127.0.0.1',port:0})` + injected fixture `createServer`; raw `node:http`/`fetch`: init→`mcp-session-id`→tools/list (8)→tools/call→DELETE→404; `Host: evil`→403; graceful `close()` leaves no dangling handles. Deterministic, loopback only. |
| Regression | STDIO byte-identity | `planEntry` + `parseMcpFlags([])`→stdio on BOTH seams → `startMcpServer()` unchanged; the phase-5 InMemoryTransport goldens still pin the 8-tool surface (factory untouched). |
| Smoke-only | real bind, drain timing, idle reaper | needs a live listener — not a pure unit. |

Integration here needs NO testcontainers (config.yaml `integration.available:false` refers to DB
containers): it is in-process node:http over loopback with an injected store, like phase-5's E2E.

## Migration / Rollout

Fully additive and flag-gated. No STDIO spec requirement changes. Rollback = delete `src/mcp/http.ts`
+ tests, remove the `--http` branch from `sea-entry.planEntry`/`runSeaEntry` and the npm bin guard,
revert USAGE. With `--http` absent every STDIO path (npm `dbgraph-mcp`, SEA `dbgraph mcp`, 8 tools, all
installed agents) is byte-identical to today. No data migration.

## Open Questions

- [ ] **Idle-session reaper** — ship a `--idle-timeout` sweeper in v1, or defer (DELETE/close only)? Design defers; small-team scope.
- [x] ~~**IANA cross-check of 7423**~~ — RESOLVED 2026-07-06: 7423 FREE in the live IANA registry CSV (method: grep; 7422–7425 empty). See D4.
- [x] ~~**Per-agent HTTP matrix**~~ — RESOLVED 2026-07-06: all 6 agents CONFIRMED for Streamable-HTTP client config; exact shapes + nuances captured in the Per-Agent HTTP Config Matrix above. Feeds DOCS only (no auto-wiring).
- [ ] **`--allowed-host`/`--allowed-origin`** opt-in flags to re-tighten validation under `--host 0.0.0.0` — v1 or later?
- [x] ~~**SDK `handleRequest` body handling**~~ — RESOLVED 2026-07-06 (Batch 0, empirical): raw `req` DOES work (transport reads `req.json()` when `parsedBody` omitted), BUT the router MUST pre-parse anyway — a raw-only router cannot gate new sessions on `isInitializeRequest` and cannot produce the spec's split (unknown/terminated id must be **404**, but a fresh transport returns **400 `Server not initialized`**). DESIGN BRANCH TAKEN = pre-parse the POST body once + router-emitted 400/404 + pass `parsedBody`. See §"Batch 0 — empirical findings" 0.1.
