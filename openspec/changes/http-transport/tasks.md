# Tasks: HTTP Transport for the dbgraph MCP Server (http-transport)

Standing header (every task): STRICT TDD (RED→GREEN; the failing vitest test PRECEDES the code; pure units +
in-process loopback E2E — NO real network beyond loopback, deterministic). ADDITIVE + FLAG-GATED (proposal
§Rollback): with `--http` ABSENT every STDIO path — npm `dbgraph-mcp`, SEA `dbgraph mcp`, the 8 tools — stays
BYTE-IDENTICAL to today; `git diff --exit-code test/mcp/golden/` stays EMPTY. HEXAGONAL (ADR-004): `src/mcp/**`
imports ONLY the `src/index.ts` barrel + Node builtins (`node:http`/`node:crypto`) + `@modelcontextprotocol/sdk`;
NEVER `src/adapters/**` or `src/cli/**` (the phase-5 boundary scanner gates it). DETERMINISM (ADR-008): the shared
PURE `src/core/present/**` formatters render byte-identical across transports. READ-ONLY inviolable: per-request
`openConnections(process.cwd())` open/close, NO write path; `${env:VAR}`-only secrets never logged; diagnostics
content-free on STDERR. NO new runtime dependency: `node:http`/`node:crypto` builtins + the pinned
`@modelcontextprotocol/sdk@1.29.0` ONLY. Strict TS (NO `any`, `exactOptionalPropertyTypes`). English; conventional
commits referencing `http-transport`, NO AI attribution, NO push/PR/`gh`/tags. Leak-scan hooks active (neutral
fixtures only).

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions D1–D7):
- **D1 (one pure parser, mcp stays PRE-dispatch):** `parseMcpFlags(args) → {kind:'stdio'} | {kind:'http',host,port,quiet}`
  lives in `src/mcp/http.ts` and feeds BOTH seams (`sea-entry.planEntry` + the npm `dbgraph-mcp` bin guard). Do NOT
  promote `mcp` into `cli.ts` dispatch (breaks the `HandlerOutcome`/exit-site contract, bypasses the npm bin, and
  violates ADR-004).
- **D2 (node:http + SessionRegistry, per-REQUEST DB):** `http.createServer` → `transport.handleRequest(req,res)`; a
  `SessionRegistry` keyed by `mcp-session-id`; each session gets its OWN `createDbgraphServer()` + a
  `StreamableHTTPServerTransport(sessionIdGenerator:randomUUID)`; tool calls keep per-request `openConnections`
  (neither per-process nor per-session).
- **D3 (in-house Origin/Host validator, NOT the deprecated SDK flags):** a PURE `validateOriginHost` runs BEFORE
  `handleRequest`. Do NOT set `allowedHosts`/`allowedOrigins`/`enableDnsRebindingProtection` (all `@deprecated` in
  1.29.0). Origin absent→allow; loopback Origin→allow else 403; Host in `{127.0.0.1,localhost,[::1]}(:port)` on
  loopback bind else 403; `0.0.0.0` relaxes Host, KEEPS Origin rejection. Reject → HTTP 403 body
  `{jsonrpc,error:{code:-32000,message:'Forbidden'},id:null}`.
- **D4 (port/bind):** default `--port 7423` (IANA-verified FREE), default `--host 127.0.0.1`; `--port` int 1–65535
  else `ConfigError`→exit 2 via the existing seams' catch; `--host 0.0.0.0` prints the PINNED WARN naming (a)
  non-loopback exposure, (b) no auth in v1, (c) the reverse-proxy remedy.
- **D5 (no new dep):** own the `node:http` listener, call `transport.handleRequest`; the SDK's internal Hono is a
  TRANSITIVE dep of the already-pinned SDK — add NOTHING to `package.json`.
- **D6 (drain, idle reaper deferred):** `onsessionclosed` drops+closes; `startHttpMcpServer` returns `{port,close()}`;
  SIGINT/SIGTERM → `httpServer.close()` + drain every transport. The idle-session reaper is DEFERRED (see 3.5).
- **D7 (observability):** optional `Logger` port, STDERR only; pinned startup INFO line + the D4 WARN; content-free
  session DEBUG; `--quiet`/`-q` → level `warn` (suppresses startup + per-session, KEEPS warning + errors).

Per-batch GATE (ALL pass before the next batch, then COMMIT): `npx tsc --noEmit` clean (NO `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) GREEN (baseline 3004 + this batch's new suites; NO network beyond
loopback; deterministic) · `git diff --exit-code test/mcp/golden/` EMPTY (STDIO byte-identity, ADR-008) · ADR-004
`src/mcp/**` boundary scan green · NO new `package.json` dependency · leak-scan/denylist clean (neutral fixtures
only). Then COMMIT (conventional, references `http-transport`, NO AI attribution, NO push/PR/gh/tag).

## Batch 0: Empirical SDK contract — pin `handleRequest` body handling before wiring the router (spikes, record into design.md)

> Design flags ONE unresolved SDK contract (design.md §Open Questions): on `@modelcontextprotocol/sdk@1.29.0`, does
> `StreamableHTTPServerTransport.handleRequest(req,res)` read the POST body itself (`req.json()` when `parsedBody`
> omitted) or must our `node:http` router PRE-PARSE and pass a parsed body? The whole B2 router (2.4) hard-codes the
> answer. These are INVESTIGATION spikes, NOT vitest RED→GREEN — the gate is "finding recorded + both outcomes
> designed," not `npm test`. NO `src/` change in this batch.

- [x] 0.1 **(spike)** Against the INSTALLED `@modelcontextprotocol/sdk@1.29.0`, confirm `StreamableHTTPServerTransport.handleRequest`
  body handling: inspect `dist/**/*.d.ts` + the impl, and run a THROWAWAY in-process `node:http` init POST to observe
  whether the transport consumes the raw `req` stream itself or requires a pre-parsed `parsedBody` arg. Record BOTH the
  observed recipe AND the fallback (pre-parse in the router) into a new **"Batch 0 — empirical findings"** section in
  `design.md`. Resolves the design Open Question "SDK `handleRequest` body handling". Design D2/D5. Done: recipe recorded;
  2.4 consumes it.
- [x] 0.2 **(spike)** Confirm the SDK session-lifecycle surface used by D2/D6 EXISTS on 1.29.0: the constructor options
  `sessionIdGenerator`, `onsessioninitialized`, `onsessionclosed`; the `isInitializeRequest` guard + its import path; and
  `transport.close()`. Record exact import paths + signatures alongside 0.1's finding. Confirm (VERIFIED in design) that
  `allowedHosts`/`allowedOrigins`/`enableDnsRebindingProtection` are `@deprecated` — do NOT use them (D3). Design D2/D3/D6.
  Done: signatures recorded in `design.md`.
- [x] 0.3 GATE (Batch 0): 0.1 + 0.2 findings recorded into `design.md` §"Batch 0 — empirical findings"; the
  `handleRequest` body recipe is FINAL. NO `src/` changed. Then COMMIT
  `docs(http-transport): record SDK 1.29.0 handleRequest + session-lifecycle empirical findings`.

## Batch 1: Pure seams — `parseMcpFlags` threaded through BOTH MCP entry seams (ALL vitest, STDIO byte-identical)

> Satisfies `cli-config` R8 (flags across both seams) + `mcp-server` R7 (bare mcp byte-identical STDIO) at the CODE-SEAM
> level — every seam is pure TypeScript, RED→GREEN in `npm test`, NO listener bound. The off-flag branch is
> BYTE-IDENTICAL to today, so `git diff --exit-code test/mcp/golden/` stays EMPTY. Realizes D1.

- [x] 1.1 **(vitest)** RED→GREEN `test/mcp/http.test.ts` (new) + `src/mcp/http.ts` `parseMcpFlags(args)`: PURE
  `{kind:'stdio'} | {kind:'http',host,port,quiet}`. RED first: `[]`→stdio; `['--http']`→http with default host
  `127.0.0.1`, port `7423`, quiet `false`; `['--http','--port','8000']`→port 8000; `['--http','--host','0.0.0.0']`→host
  set; `['--http','--quiet']`/`-q`→quiet; `['--http','--port','notaport']`→throws `ConfigError` naming the value;
  `['--http','--host']` (no value)→throws `ConfigError`. Exit-2 mapping is the EXISTING seam catch (`DbgraphError`→2), NOT
  re-implemented here. Spec: cli-config S "--http starts HTTP mode…" / "Invalid --port exits 2" / "--host without a value
  exits 2". Design D1/D4. Done: `npx tsc --noEmit`; `npm test http`.
- [x] 1.2 **(vitest)** RED→GREEN `test/bin/sea-entry.test.ts` (extend) + `src/bin/sea-entry.ts`: `EntryPlan` `mcp` variant
  carries `transport: parseMcpFlags(argsAfterMcp)`; `runSeaEntry` dispatches `stdio → startMcpServer()` vs `http →
  startHttpMcpServer(opts)`. RED first: `planEntry(['mcp'])`→`{mode:'mcp',transport:{kind:'stdio'}}`;
  `planEntry(['mcp','--http','--port','7423'])`→http transport plan; NON-mcp argv unchanged; `NODE/SEA_ARGV_OFFSET` seam
  untouched. Spec: cli-config S "--http starts HTTP mode through both seams" / "Bare mcp stays byte-identical STDIO"; mcp-server
  S "Bare mcp stays byte-identical STDIO across both entry seams". Design D1. Done: `npx tsc --noEmit`; `npm test sea-entry`.
- [x] 1.3 **(vitest)** RED→GREEN `test/mcp/server.test.ts` (extend) + `src/mcp/server.ts` bin guard: the npm `dbgraph-mcp`
  auto-run guard parses `process.argv.slice(2)` via the SAME `parseMcpFlags` → `stdio` (default, byte-identical) vs
  `startHttpMcpServer`. `createDbgraphServer`/`startMcpServer`/the 8-tool table UNTOUCHED. RED first: argv `[]`→stdio path
  fires unchanged (no new output, no branch); `['--http']`→http path selected. Spec: cli-config S "--http starts HTTP mode
  through both seams" / "Bare mcp stays byte-identical STDIO"; mcp-server S "Bare mcp stays byte-identical STDIO". Design D1.
  Done: `npx tsc --noEmit`; `npm test server`.
- [x] 1.4 **(vitest)** RED→GREEN STDIO byte-identity regression (extend 1.2/1.3 + the phase-5 harness): assert BOTH seams
  with no `--http` reach `startMcpServer()` with no args (today's exact path), NO listener socket is bound, and the phase-5
  in-process `InMemoryTransport` 8-tool goldens still pin the surface (factory untouched) → `git diff --exit-code
  test/mcp/golden/` EMPTY. Spec: mcp-http-transport S "Without HTTP mode no socket is opened"; mcp-server S "Bare mcp stays
  byte-identical STDIO across both entry seams"; cli-config S "Bare mcp stays byte-identical STDIO through both seams".
  Design D1. Done: `npm test`; goldens empty.
- [x] 1.5 GATE (Batch 1): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN (baseline 3004 + parser/seam
  suites); `git diff --exit-code test/mcp/golden/` EMPTY; confirm NO listener is opened off-flag and the `dbgraph`/`dbgraph-mcp`
  bins are unchanged. Then COMMIT `feat(http-transport): shared parseMcpFlags threaded through both MCP entry seams`.

## Batch 2: HTTP server core — `validateOriginHost`, `SessionRegistry`, `startHttpMcpServer`, pinned messages, drain (vitest)

> Satisfies `mcp-http-transport` R2 (loopback default + warning), R3 (stateful sessions), R5 (read-only/content-free/drain),
> R6 (Origin/Host 403) at the UNIT level — pure validators + registry + the listener wired with an INJECTED
> `createServer`. Consumes the Batch-0 `handleRequest` recipe. Realizes D2/D3/D4/D6/D7. NO new dependency.

- [x] 2.1 **(vitest)** RED→GREEN (in `test/mcp/http.test.ts`) + `src/mcp/http.ts` `validateOriginHost({headers,bindHost,port})`:
  PURE `{ok:true} | {ok:false,status:403,reason}`. RED first: no `Origin`→ok; loopback Origin
  (`http://localhost|127.0.0.1|[::1]` ±`:port`)→ok; foreign Origin→403; Host in `{127.0.0.1,localhost,[::1]}(:port)` on
  loopback bind→ok; foreign Host→403; `bindHost:'0.0.0.0'` RELAXES Host (any) but KEEPS Origin rejection. Reject body =
  `{jsonrpc,error:{code:-32000,message:'Forbidden'},id:null}`. Spec: mcp-http-transport S "Disallowed Origin is rejected
  before any tool runs" / "Allowed Origin proceeds". Design D3. Done: `npx tsc --noEmit`; `npm test http`.
- [x] 2.2 **(vitest)** RED→GREEN (in `test/mcp/http.test.ts`) + `src/mcp/http.ts` `SessionRegistry`: `Map<sessionId,{transport,server}>`
  with add/get/drop/size. RED first: add→get returns the entry; drop removes it (size decrements); `close()` awaits
  `transport.close()` AND `server.close()` for EVERY entry (spy both) then empties the map — the drain primitive for D6.
  Spec: mcp-http-transport S "SIGINT/SIGTERM drains sessions and closes the listener" (registry half). Design D2/D6. Done:
  `npm test http`.
- [x] 2.3 **(vitest)** RED→GREEN (in `test/mcp/http.test.ts`) + `src/mcp/http.ts` STDERR `Logger` default + message goldens:
  pin the startup INFO line `dbgraph mcp: Streamable HTTP on http://{host}:{port} (read-only, no auth)`; pin the D4 WARN
  line naming (a) non-loopback exposure, (b) no auth in v1, (c) the reverse-proxy remedy; content-free session DEBUG
  `session initialized/closed {uuid}`; `--quiet`/`-q`→level `warn` suppresses startup + session lines, KEEPS the WARN +
  errors. Assert NO object/schema name, connection string, or resolved secret appears in any line. Spec: mcp-http-transport
  S "Default bind is loopback and states the no-auth posture" / "Non-loopback bind prints the pinned security warning" /
  "Diagnostics leak no schema names or secrets". Design D4/D7. Done: `npm test http`.
- [x] 2.4 **(vitest)** RED→GREEN (in `test/mcp/http.test.ts`, injected `createServer` fixture) + `src/mcp/http.ts`
  `startHttpMcpServer(opts, deps?) → {port, close()}`: `http.createServer` → `validateOriginHost` (403 BEFORE
  `handleRequest`) → POST init w/o `mcp-session-id` + `isInitializeRequest` → new `StreamableHTTPServerTransport`
  (`sessionIdGenerator:randomUUID`, `onsessioninitialized:register`, `onsessionclosed:drop+close`) + `createDbgraphServer()`
  + `connect` → register; known `mcp-session-id`→reuse; missing-id non-init→SDK 400; unknown/terminated id→SDK 404; per-request
  `openConnections(process.cwd())` closed in `finally`; SIGINT/SIGTERM→`close()` = `httpServer.close()` + drain (2.2). Uses
  the Batch-0 body recipe; `deps.createServer` defaults to `createDbgraphServer`. Spec: mcp-http-transport S "--http serves
  the 8 tools…" (wiring half) / "initialize issues a session id…" / "DELETE terminates the session" / "Missing or unknown
  session id is rejected…" / "HTTP mode adds no write surface". Design D2/D6/D7. Done: `npx tsc --noEmit`; `npm test http`.
- [x] 2.5 GATE (Batch 2): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN (new validator/registry/listener
  units); `git diff --exit-code test/mcp/golden/` EMPTY; ADR-004 `src/mcp/**` boundary scan green (only barrel + `node:*` +
  SDK); NO new `package.json` dependency. Then COMMIT `feat(http-transport): node:http listener, SessionRegistry, in-house
  Origin/Host validator, graceful shutdown`.

## Batch 3: Loopback E2E + cross-transport parity + Open-Question decisions (in-process, in `npm test`)

> Satisfies `mcp-http-transport` R1/R3/R5/R6 and `mcp-server` R7 END TO END over an in-process `node:http` loopback
> listener with an INJECTED fixture store (like phase-5's E2E — NO Docker, NO network beyond loopback, deterministic). Also
> resolves the two remaining design Open Questions as explicit DEFER decisions recorded into `design.md`.

- [x] 3.1 **(E2E)** RED→GREEN `test/mcp/http.test.ts` session-lifecycle E2E: `startHttpMcpServer({host:'127.0.0.1',port:0})`
  + injected fixture `createServer` over the SQLite torture fixture; raw `node:http`/`fetch`: POST `initialize`→response
  carries a fresh `mcp-session-id`→`tools/list` returns EXACTLY the 8 tools→`tools/call` returns its result→`DELETE`→a later
  request with that id→HTTP 404; a non-init request with NO id→HTTP 400; neither reaches a tool handler. Spec:
  mcp-http-transport S "--http serves the 8 tools over Streamable HTTP end to end" / "initialize issues a session id that
  routes subsequent requests" / "DELETE terminates the session" / "Missing or unknown session id is rejected by observable
  status". Done: `npm test http`.
- [x] 3.2 **(E2E)** RED→GREEN 403 rejection E2E: a request with `Host: evil` (or foreign `Origin`) → HTTP 403 with the
  JSON-RPC `-32000` Forbidden body BEFORE any tool handler; an allowed loopback `Host`/`Origin` → proceeds to session
  routing normally. Spec: mcp-http-transport S "Disallowed Origin is rejected before any tool runs" / "Allowed Origin
  proceeds". Design D3. Done: `npm test http`.
- [x] 3.3 **(E2E)** RED→GREEN cross-transport byte-identity: `dbgraph_explore({target:'orders',detail:'brief'})` served over
  HTTP == served over STDIO == the `explore × brief` golden (ADR-008); the static `initialize` instructions string is
  IDENTICAL across transports; BOTH transports expose the same 8-tool surface from the ONE `createDbgraphServer()` factory
  (no transport-specific rendering). Spec: mcp-http-transport S "One tool's output is byte-identical across transports";
  mcp-server S "initialize returns the static golden instructions" / "Both transports serve the identical 8-tool surface
  from one factory". Done: `npm test http`; goldens byte-identical.
- [x] 3.4 **(E2E)** RED→GREEN read-only + content-free diagnostics + graceful drain: any tool over HTTP issues ONLY catalog
  SELECT reads (no DDL/DML to the target DB); captured startup + per-request diagnostics contain NO object/schema name, NO
  connection-string value, NO resolved secret; SIGINT/SIGTERM with ≥1 open session → every transport closed + listener
  stops accepting and closes, leaving NO dangling handles (assert via open-handle inspection). Spec: mcp-http-transport S
  "HTTP mode adds no write surface" / "Diagnostics leak no schema names or secrets" / "SIGINT/SIGTERM drains sessions and
  closes the listener". Design D2/D6/D7. Done: `npm test http`.
- [x] 3.5 **(decision)** RESOLVE design Open Question "Idle-session reaper": DECISION = **DEFER** — v1 ships the
  deterministic DELETE/`onsessionclosed`+drain path ONLY; no `--idle-timeout` sweeper (small-team, single-graph scope per
  proposal). Check the box in `design.md` §Open Questions with this rationale; add NO reaper code this change. Design D6.
  Done: `design.md` updated.
- [x] 3.6 **(decision)** RESOLVE design Open Question "`--allowed-host`/`--allowed-origin` re-tighten flags under
  `--host 0.0.0.0`": DECISION = **DEFER** — not v1; D3 already keeps Origin rejection + relaxes Host on `0.0.0.0`, and the
  loopback default + reverse-proxy/network controls remain the primary containment. Check the box in `design.md` §Open
  Questions with this rationale; add NO flag this change (a future change may build on it). Design D3. Done: `design.md`
  updated.
- [x] 3.7 GATE (Batch 3): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN (E2E loopback in-suite, NO network
  beyond loopback, deterministic); `git diff --exit-code test/mcp/golden/` EMPTY; BOTH open questions recorded as DEFER
  decisions in `design.md`. Then COMMIT `feat(http-transport): loopback E2E (session lifecycle, cross-transport parity,
  403, drain); defer idle-reaper + re-tighten flags`.

## Batch 4: Docs — USAGE banner, per-agent HTTP matrix, no-auth/reverse-proxy posture + FINAL gate

> Satisfies `cli-config` R9 (banner) and the proposal/design DOCS-honesty requirement: the VERIFIED 6/6 agent matrix with
> its load-bearing nuances, the no-auth-v1 + reverse-proxy-TLS + loopback-default posture. No auto-wiring (proposal ruling);
> the matrix feeds DOCS only.

- [ ] 4.1 **(vitest)** RED→GREEN `test/cli/cli.test.ts` (extend) + `src/cli/cli.ts` `USAGE_TEXT`: add EXACTLY
  `  mcp       Serve the MCP tools over stdio (default) or Streamable HTTP (--http)` (two leading spaces, `mcp`, seven
  spaces — description aligned at character index 12, matching `init`/`affected`/`doctor`/`install`). RED first: pin this
  exact line so dropping the `--http` mention fails the build; assert EVERY existing command line (`init`…`doctor`,
  including the pinned `install` line) is byte-identical and ONLY the `mcp` line is added. Spec: cli-config S "mcp banner
  line is present with the exact aligned text" / "Adding the mcp line leaves the other command lines unchanged". Done:
  `npm test cli`.
- [ ] 4.2 **(doc)** Author the `docs/**` MCP-over-HTTP section: `dbgraph mcp --http [--port N] [--host H]`, the
  loopback-default + **no auth in v1** posture, the **reverse-proxy (nginx/Caddy) TLS** model for non-loopback, the pinned
  `--host 0.0.0.0` warning; and the VERIFIED **6/6 per-agent HTTP config matrix** (Claude Code / Cursor / VS Code / Gemini
  CLI / opencode / Codex CLI) with EXACT shapes. Carry the LOAD-BEARING nuances wherever example configs appear: Gemini
  `httpUrl` (NOT `url` → silent SSE), Cursor NO `type` field (inferred from `url`), VS Code top-level `servers` key,
  opencode `type:"remote"` (no over-claim of wire protocol), Codex `experimental_use_rmcp_client` caveat for old installs.
  Spec: mcp-http-transport §Honest v1 boundaries; design §Per-Agent HTTP Config Matrix + DOCS HONESTY. Done: section exists;
  every documented Gemini example uses `httpUrl`; leak-scan clean.
- [ ] 4.3 **(doc)** README touch: add a short "Serve over HTTP" note (`dbgraph mcp --http`, the 8-tool endpoint at
  `http://127.0.0.1:7423/mcp`, loopback default + no-auth-v1) linking to the 4.2 docs section; ensure any example config in
  the README carries the Gemini `httpUrl` / Cursor no-`type` nuances (else users silently get SSE/misconfig). Spec:
  design §DOCS HONESTY. Done: README updated; nuances present.
- [ ] 4.4 GATE (Batch 4 — FINAL): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN (baseline 3004 + the http
  unit/E2E suites + the banner test); `git diff --exit-code test/mcp/golden/` EMPTY; ADR-004 `src/mcp/**` boundary scan
  green; confirm NO new `package.json` runtime dependency (`node:http`/`node:crypto` + pinned SDK only); confirm bare STDIO
  byte-identical on BOTH seams and NO listener off-flag; FINAL leak-scan/denylist clean across ALL new files; confirm
  nothing pushed (NO push/PR/`gh`/tag). Then COMMIT `docs(http-transport): mcp --http usage banner, verified agent HTTP
  matrix, no-auth/reverse-proxy posture`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 0** (0.1–0.3): empirical SDK spikes on the installed 1.29.0 — `handleRequest` body handling + session-lifecycle
  option surface; record into `design.md`. NO `src/` change. GATE = findings recorded (not a vitest gate).
- **Batch 1** (1.1–1.5): pure seams — `parseMcpFlags` unit, `sea-entry.planEntry`/`runSeaEntry` extension, npm bin guard,
  STDIO byte-identity regression. ALL **(vitest)**, off-flag byte-identical, NO listener.
- **Batch 2** (2.1–2.5): `validateOriginHost` + `SessionRegistry` + STDERR Logger/message goldens + `startHttpMcpServer`
  listener/router with an INJECTED `createServer`. ALL **(vitest)**.
- **Batch 3** (3.1–3.7): in-process loopback E2E (session lifecycle, 403, cross-transport parity, read-only/content-free,
  drain) + the two DEFER decisions. **(E2E)** in `npm test`, loopback only.
- **Batch 4** (4.1–4.4): USAGE banner **(vitest)** + the HTTP docs section + README touch + the FINAL gate. Closes the change.

### Dependency bottlenecks & parallelism

- **STRICTLY SEQUENTIAL across batches: 0 → 1 → 2 → 3 → 4.** Batch 0's `handleRequest` recipe is hard-coded by the 2.4
  router; a wrong recipe silently breaks every POST in the B3 E2E. Batch 0 is the single most load-bearing gate.
- **Within Batch 1, the seams PARALLELIZE** (1.2 `planEntry` and 1.3 npm bin guard are independent) EXCEPT both consume
  1.1's `parseMcpFlags`; 1.4 (regression) depends on 1.2 + 1.3 both landing. A wrong exit-2 mapping surfaces only at the
  seam catch — 1.1 asserts the `ConfigError` throw, the seams own the exit code.
- **Within Batch 2, 2.4 depends on 2.1 + 2.2 + 2.3** (the listener composes the validator, the registry, and the logger);
  2.1/2.2/2.3 are independent pure units that PARALLELIZE.
- **Batch 3 hard-depends on ALL of Batch 2** (the E2E drives the real `startHttpMcpServer`) AND on the phase-5 fixture +
  goldens (3.3 asserts byte-identity against the existing `explore × brief` golden — the factory must stay untouched).
- **Batch 4 is largely INDEPENDENT of 2/3** (4.1 banner touches only `cli.ts` USAGE; 4.2/4.3 are docs consuming the
  design matrix) and can proceed as soon as the surface is stable — but the FINAL gate (4.4) verifies the whole change.
- **STDIO byte-identity is the phase-wide invariant:** `git diff --exit-code test/mcp/golden/` EMPTY is checked at EVERY
  gate — any drift means a seam leaked behavior off the `--http` flag (HARD STOP; investigate, do NOT re-bless).

## Definition of Done (tied to the proposal's Success Criteria)

- [ ] `dbgraph mcp --http` serves all 8 tools over Streamable HTTP; a client can `initialize`, list tools, call a tool, and
  terminate its session. — Batch 2 (2.4), Batch 3 (3.1, 3.3)
- [ ] Bare `dbgraph mcp` (SEA + npm bin) is byte-identical STDIO — regression proves no drift. — Batch 1 (1.2, 1.3, 1.4)
- [ ] Default bind is `127.0.0.1`; `--host`/`--port` override; non-loopback prints the pinned security warning. — Batch 1
  (1.1), Batch 2 (2.3, 2.4), Batch 3 (3.2)
- [ ] Sessions are created/keyed/terminated correctly; graceful shutdown drains sessions and closes the listener with no
  dangling handles. — Batch 2 (2.2, 2.4), Batch 3 (3.1, 3.4)
- [ ] Origin/Host validation rejects disallowed requests with HTTP 403 before any tool handler; allowed requests proceed. —
  Batch 2 (2.1), Batch 3 (3.2)
- [ ] HTTP adds no write path (read-only preserved) and diagnostics are content-free (no schema name / connection string /
  secret). — Batch 2 (2.3), Batch 3 (3.4)
- [ ] Docs state "no auth in v1", the reverse-proxy TLS model, the loopback-default posture, and the VERIFIED 6/6 agent
  matrix with its Gemini `httpUrl` / Cursor no-`type` / opencode / Codex nuances; the USAGE banner documents `mcp --http`. —
  Batch 4 (4.1, 4.2, 4.3)
- [ ] No new runtime dependency added; `node:http` + `node:crypto` builtins + pinned SDK only; ADR-004 `src/mcp/**` boundary
  lint clean. — Batch 2 (2.5), Batch 4 (4.4)
- [ ] The unresolved SDK `handleRequest` body contract is confirmed against the installed 1.29.0 and recorded in `design.md`
  before any router wiring. — Batch 0 (0.1)
- [ ] `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; `npm test` GREEN (baseline 3004 + http suites, no
  network beyond loopback, deterministic); `git diff test/mcp/golden/` EMPTY — all proven LOCALLY, nothing pushed past
  `closeout`. — Batch 1 (1.5), Batch 2 (2.5), Batch 3 (3.7), Batch 4 (4.4)
