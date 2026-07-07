> FINAL VERDICT (after Re-verify R1, 2026-07-06): PASS — 22 of 22 spec scenarios compliant.
> CRITICAL-1 FIXED and independently re-reproduced; WARNING-1 addressed; S-1/S-2/S-3 remain accepted
> suggestions. Ready for sdd-archive. The original FAIL record below is retained as audit history;
> the authoritative disposition is the "Re-verify (R1)" section at the END of this file.

---

# Verification Report -- http-transport

- Change: http-transport
- Branch: v1-prep (repo C:\Users\ecardoso\dev\dbgraph)
- Artifact store: openspec (files) -- engram not available
- Mode: Strict TDD (RED->GREEN; runner npm test = vitest)
- Verified: 2026-07-06 by sdd-verify (execution-based: static + live E2E + adversarial probes run by the verifier)

---

## Verdict: FAIL (1 CRITICAL)

Planning, seams, security posture, docs, and the no-new-dependency boundary are all sound; 21 of 22
spec scenarios are behaviorally compliant. ONE stated success criterion -- graceful shutdown drains
sessions and closes the listener with no dangling handles -- is EMPIRICALLY VIOLATED when a client
holds an open Streamable-HTTP GET SSE stream (the normative streaming channel of this transport):
close() hangs indefinitely. The committed drain test passes only because it exercises a non-streaming
session. This blocks archive.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 34 (Batches 0-4, incl. GATE + decision tasks) |
| Tasks complete [x] | 34 |
| Tasks incomplete [ ] | 0 |
| Definition-of-Done items checked | 9 of 9 |

All 34 task checkboxes are [x]. Both design Open Questions are resolved as explicit DEFER decisions
(idle-reaper 3.5; allowed-host/allowed-origin 3.6) and recorded in design.md. openspec mode has no
separate apply-progress.md; the tasks.md checkboxes are the progress record.

---

## Build and Tests Execution (measured by the verifier)

- Type check -- npx tsc --noEmit: PASS (exit 0, strict, no any)
- Lint -- npm run lint (eslint .): PASS (exit 0, 0 errors / 0 warnings)
- Tests -- npm test (vitest run): 3087 passed / 0 failed / 0 skipped -- 176 files, 32.8s (exit 0)
- Golden byte-identity -- git diff --exit-code test/mcp/golden/: EMPTY (ADR-008 drift-free)
- No new runtime dependency -- git diff bca8cd1..HEAD of package.json and package-lock.json: EMPTY
  (deps stay modelcontextprotocol/sdk@1.29.0 + better-sqlite3; node:http / node:crypto builtins only)
- Leak-scan -- local denylist (2 entries) over the whole change diff: CLEAN; generic secret grep: CLEAN
- Push state -- branch v1-prep has NO upstream: nothing pushed
- Coverage -- not run separately (no threshold configured); the tests are the behavioral proof

---

## Live E2E -- run independently by the verifier (throwaway probes, deleted; tree clean)

Drove the REAL startHttpMcpServer over a real node:http loopback listener with real fetch, and the
REAL runMcpBin flag-dispatch from source (Node v22.19.0; no dist rebuild -- dist is gitignored and
stale, so source was exercised directly via vitest, the authoritative runtime):

| Probe | Result |
|-------|--------|
| initialize (POST, no sid) | HTTP 200 + fresh mcp-session-id header |
| foreign Origin http://evil.example.com | HTTP 403, body -32000 Forbidden, BEFORE any server/tool created |
| unknown mcp-session-id | HTTP 404 Session not found |
| non-init POST, no sid | HTTP 400 (-32000) |
| DELETE known sid then reuse | 200, then reuse -> 404 |
| REAL runMcpBin([--http --port N --quiet]) | parsed to {host:127.0.0.1, port:N, quiet:true}, bound real listener, init -> 200 |
| --port 0 via the CLI flag | REJECTED with ConfigError (design D4 range 1-65535 enforced) |
| off-flag runMcpBin([]) | startMcpServer() called once with NO args; HTTP launcher never invoked |
| graceful drain with an OPEN GET SSE stream | HANG -- close() did not resolve within 4000ms (see CRITICAL-1) |

The real entry seam (npm dbgraph-mcp bin -> runMcpBin(process.argv.slice(2))) and the SEA seam
(planEntry slice(2) -> parseMcpFlags) both route --http/--port/--host correctly and keep bare mcp on
the untouched startMcpServer() path.

---

## Spec Compliance Matrix (22 scenarios)

| # | Requirement | Scenario | Test(s) | Result |
|---|-------------|----------|---------|--------|
| 1 | http R1 opt-in/additive | --http serves 8 tools end to end | http.test 3.1 + 2.4 | COMPLIANT |
| 2 | http R1 | Without HTTP mode no socket is opened | http.test 1.4 + server.test | COMPLIANT |
| 3 | http R2 loopback-default | Default bind loopback + no-auth posture | http.test 2.3/2.4 | COMPLIANT |
| 4 | http R2 | Non-loopback bind prints pinned warning | http.test 2.3 (emitStartupDiagnostics 0.0.0.0) | COMPLIANT (*) |
| 5 | http R3 sessions | initialize issues a routing session id | http.test 2.4 + 3.1 | COMPLIANT |
| 6 | http R3 | DELETE terminates the session | http.test 2.4 + 3.1 | COMPLIANT |
| 7 | http R3 | Missing/unknown session id rejected (400/404) | http.test 2.4 + 3.1 | COMPLIANT |
| 8 | http R4 parity | One tool byte-identical across transports | http.test 3.3 | COMPLIANT (+) |
| 9 | http R5 read-only/drain | HTTP mode adds no write surface | http.test 3.4 (writes empty, reads>0) | COMPLIANT |
| 10 | http R5 | Diagnostics leak no schema names/secrets | http.test 2.3 + 3.4 | COMPLIANT |
| 11 | http R5 | SIGINT/SIGTERM drains, no dangling handles | http.test 3.4 (non-streaming session only) | PARTIAL -> CRITICAL-1 |
| 12 | http R6 origin/host | Disallowed Origin rejected before any tool | http.test 2.4/3.2 (serversCreated is 0) | COMPLIANT |
| 13 | http R6 | Allowed Origin proceeds | http.test 3.2 | COMPLIANT |
| 14 | server R | initialize returns static golden instructions | http.test 3.3 + initialize.test | COMPLIANT |
| 15 | server R | Bare mcp byte-identical STDIO across both seams | sea-entry.test + server.test + http.test 1.4 | COMPLIANT |
| 16 | server R | Both transports = identical 8-tool surface, one factory | http.test 3.3 | COMPLIANT |
| 17 | cli R | --http starts HTTP through both seams | sea-entry.test + server.test | COMPLIANT |
| 18 | cli R | Bare mcp byte-identical STDIO through both seams | sea-entry.test + server.test | COMPLIANT |
| 19 | cli R | Invalid --port exits 2, actionable message | http.test 1.1 + sea-entry.test + server.test + exit-code.ts | COMPLIANT |
| 20 | cli R | --host without a value exits 2 | http.test 1.1 | COMPLIANT |
| 21 | cli R banner | mcp banner line exact aligned text | cli.test 4.1 (Serve at index 12, contains --http) | COMPLIANT |
| 22 | cli R banner | Adding mcp line leaves other lines unchanged | cli.test 4.1 | COMPLIANT |

Compliance summary: 21 of 22 COMPLIANT, 1 PARTIAL (-> CRITICAL-1).

(*) #4: the warn path is verified via the emitStartupDiagnostics(0.0.0.0) unit plus the pinned
NON_LOOPBACK_WARNING string, not an actual 0.0.0.0 bind (correctly avoided in tests). The
decision-to-warn and the exact text are both pinned. Acceptable.

(+) #8: the committed golden explore-brief.txt was captured from main.employees, not the illustrative
"orders" named in the spec scenario (the security-neutralized torture fixture has NO orders table).
The parity contract proven is identical -- HTTP equals STDIO equals the golden, from ONE
createDbgraphServer() factory -- so the specific target is immaterial; the deviation is documented in
the test. ACCEPTABLE.

---

## Coherence (Design D1-D7)

| Decision | Followed | Notes |
|----------|----------|-------|
| D1 one pure parseMcpFlags, mcp pre-dispatch | Yes | single parser fed by planEntry + runMcpBin; mcp NOT promoted into cli dispatch |
| D2 node:http + SessionRegistry, per-REQUEST DB | Yes | routeHttpRequest + SessionRegistry; tools keep openConnections(cwd) open/close per request |
| D3 in-house validateOriginHost, NOT deprecated SDK flags | Yes | deprecated flags NOT set; pure validator before handleRequest; loopback Host allowlist + always-on Origin allowlist |
| D4 port 7423 / bind 127.0.0.1 / warned 0.0.0.0 | Yes | defaults pinned; --port 1-65535 else ConfigError -> exit 2; pinned WARN names (a)/(b)/(c) |
| D5 no new dep | Yes | package.json + lock unchanged; builtins + pinned SDK only |
| D6 drain, idle reaper deferred | DEVIATION | registry drain primitive correct BUT close() ORDERING deadlocks with an open GET SSE stream (CRITICAL-1). Idle reaper correctly deferred |
| D7 observability via Logger, STDERR, --quiet | Yes | level-gated STDERR logger; pinned INFO/WARN/DEBUG; --quiet -> warn |

---

## Issues Found

### CRITICAL (must fix before archive)

CRITICAL-1 -- Graceful drain deadlocks with an open Streamable-HTTP GET SSE stream.
In src/mcp/http.ts, close() (about L537-551) awaits httpServer.close() BEFORE registry.close():
httpServer.close(cb) fires its callback only after every open connection ends. An MCP client that
opens the standalone GET SSE notification stream (normative for Streamable HTTP; the SDK Client does
this) holds that connection open indefinitely. The transports that would end those streams are only
closed in registry.close() -- which runs AFTER the awaited httpServer.close(). Result: close() never
resolves.
- Empirical proof (verifier probe): with one session plus one open GET SSE stream, close() did NOT
  resolve within 4000 ms (PROBE_DRAIN outcome=HANG elapsedMs=4005). The POST/DELETE-only path drains
  fine -- that is all the committed test 3.4 exercises, which is why it is green.
- Impact: violates the proposal Success Criterion and the mcp-http-transport R5 scenario SIGINT/SIGTERM
  drains sessions and closes the listener with no dangling handles, whenever a real streaming agent is
  connected. Operationally, Ctrl-C on the server hangs and needs a second signal or SIGKILL.
- Suggested fix (small, localized): drain the registry FIRST (await registry.close(), closing the
  transports ends the in-flight GET responses), then await httpServer.close(); and/or call
  httpServer.closeAllConnections() after initiating close to force-drop lingering sockets. Add a drain
  test that opens a GET SSE stream before close() (extends test 3.4).

### WARNING (should fix)

WARNING-1 -- The drain test gives false confidence. The no-dangling-handles case in test 3.4 drives
close() on a session opened via POST only, never opening the GET SSE stream, so it cannot catch
CRITICAL-1. Driving close() instead of emitting a real signal is itself acceptable (a real signal
would race or kill the runner, and the test does verify exactly one SIGINT plus one SIGTERM listener
are installed and removed) -- but the SESSION SETUP must include an open stream to make the claim
honest.

### SUGGESTION (nice to have)

- S-1: parseMcpFlags eagerly validates --port/--host even when --http is ABSENT, so
  dbgraph mcp --port notaport (no --http) throws ConfigError -> exit 2 instead of the historical
  behavior of ignoring junk and starting STDIO. Real byte-identity (bare mcp) is preserved and
  fail-fast is defensible; no spec scenario covers this combo. Optionally gate port/host parsing
  behind --http.
- S-2: The port parameter of validateOriginHost is accepted but never used (any port on a loopback
  hostname is allowed -- intentional per the (:port) note in D3). Either drop the dead parameter or
  comment that it is retained for signature and forward-compat.
- S-3: The docs claim 6/6 agents verified live 2026-07-06 is an author-asserted, point-in-time
  external claim not independently re-verifiable in this pass. It is honestly SCOPED (opencode wire
  protocol not named; Codex old-install caveat; Gemini httpUrl and Cursor no-type nuances all carried)
  and drives DOCS ONLY (no auto-wiring), so a stale entry cannot break code. Acceptable per HONESTY.

---

## Adversarial checks -- dispositions

- STDIO byte-identity: off-flag path returns {kind:stdio} -> startMcpServer() no args; no listener, no
  new output. Verified by code read + probe + empty test/mcp/golden/ diff; a test WOULD fail on drift. PASS
- SEA seam: planEntry slice(2) -> parseMcpFlags(args.slice(1)); sea-entry.test pins mcp --http -> http
  plan and invalid --port -> ConfigError. PASS
- validateOriginHost edges: Origin absent -> allow; literal Origin null -> 403 (URL parse fails, safe);
  IPv6 [::1] and [::1]:port bracket-stripped -> loopback ok; foreign or absent Host on loopback -> 403;
  0.0.0.0 relaxes Host but keeps Origin. Host port-mismatch allowed by design (hostname is the rebinding
  pivot). No hole found. PASS
- Docs honesty: matrix matches design 6/6 incl. all nuances; no-auth-v1 stated; reverse-proxy TLS plus
  nginx sketch present; NO secure or production-ready overclaim; banner byte-matches cli.ts and the
  pinned cli.test. PASS
- Graceful shutdown: close() does NOT truly drain under an open GET stream -> CRITICAL-1. The signal
  WIRING deviation (no real signal emitted) is acceptable; the insufficient session setup is WARNING-1.

---

## Next recommended

sdd-apply -- fix CRITICAL-1 (reorder drain / closeAllConnections) plus WARNING-1 (stream-open drain
test). Re-run the gate; then sdd-archive.

---

## Re-verify (R1) -- 2026-07-06 (post-remediation commit 207ebd8)

VERDICT: PASS. The single CRITICAL that blocked archive is fixed and INDEPENDENTLY re-reproduced by the
re-verifier (not merely trusted from the author's gate). No regression introduced. All findings from the
original pass are now dispositioned.

### What was re-verified

Scope: focused confirmation of the remediation + absence of regression (the full 22-scenario audit already
ran in the original pass above). Commit under test: 207ebd8 `fix(mcp): drain sessions before closing HTTP
listener` on branch v1-prep. Files it touched: `src/mcp/http.ts`, `test/mcp/http.test.ts`,
`openspec/changes/http-transport/tasks.md` (no others).

### The fix (read + confirmed in source)

`src/mcp/http.ts` `startHttpMcpServer().close()` (L537-559) REORDERED the drain:
1. remove SIGINT/SIGTERM listeners,
2. `await registry.close()` FIRST -- closing each session's transport ends any in-flight standalone GET SSE
   notification stream, so those connections finish BEFORE the listener close is awaited,
3. THEN `await new Promise(... httpServer.close(cb); httpServer.closeAllConnections())` -- the added
   `closeAllConnections()` force-drops lingering keep-alive sockets so the close callback fires deterministically.

Pre-fix the order was inverted (`httpServer.close()` awaited FIRST, `registry.close()` last), which deadlocked
against a held GET stream because that connection only ends when its transport closes -- which happened AFTER.

### Independent reproduction (re-verifier's own throwaway probe -- written, run, DELETED; tree clean)

A standalone vitest probe (NOT the committed test) drove the REAL `startHttpMcpServer` over a loopback
listener (Node v22.19.0): POST `initialize` -> obtain session id -> OPEN and HOLD the standalone GET SSE
stream (real `fetch`, held reader that never completes) -> then call `close()` under a 6000ms ceiling that
EXCEEDS the original >4000ms hang observation, measuring elapsed with `performance.now()`.

| Probe | Elapsed | Outcome |
|-------|---------|---------|
| MAIN -- close() with a HELD GET SSE stream (FIXED code, HEAD) | 1.0 ms | closed (well under the 2000ms bar) |
| CONTROL -- close() with NO held stream (FIXED code) | 1.2 ms | closed |
| REGRESSION -- same MAIN probe vs PRE-FIX code (`git show 207ebd8^:src/mcp/http.ts`, restored, run, reverted via `git checkout`) | 6015 ms | TIMEOUT -> hang (assertion `expected 'timeout' to be 'closed'` FAILED) |

The regression row proves the probe genuinely opens and HOLDS the GET stream before `close()` and that the
old ordering truly deadlocks (>6s), while the fixed ordering resolves in ~1ms. The pre-fix file was restored
to the committed fixed version immediately after; nothing committed. The committed streaming-drain test in
`test/mcp/http.test.ts` (task 3.4 block) was also read and confirmed to OPEN + HOLD the GET SSE stream
(via `fetch` GET `text/event-stream`, `reader.read()` pending) BEFORE `h.close()` -- structurally identical
to the re-verifier's own probe.

### Full gate -- re-run by the re-verifier (measured, not trusted)

- `npx tsc --noEmit`: PASS (exit 0, strict, no `any`)
- `npm run lint` (eslint .): PASS (exit 0, 0 errors / 0 warnings)
- `npm test` (vitest run): 3088 passed / 0 failed / 0 skipped -- 176 files (baseline 3087 + 1 new streaming-drain test), exit 0
- `git diff --exit-code test/mcp/golden/`: EMPTY (STDIO byte-identity preserved, ADR-008)
- No new dependency: `git diff` package.json + package-lock.json across the whole change: EMPTY; R1 commit touched none
- Pinned message strings unchanged: R1 diff contains NO message string literal (only comments + control flow +
  `closeAllConnections()`); `httpStartupLine`, `NON_LOOPBACK_WARNING`, `sessionInitializedLine`,
  `sessionClosedLine`, and the 403/404/400 bodies are byte-identical to spec
- Tree clean: only `verify-report.md` untracked (nothing pushed; no dist rebuild -- source exercised directly via vitest)

### No collateral / regression

- POST-only drain test ("close() drains and stops accepting") KEPT and green -- both drain paths (POST-only +
  streaming) now covered.
- Session lifecycle codes (200 init / 200 DELETE / 400 missing-id / 404 unknown-id / 403 foreign Origin) all
  still covered by passing tests.
- STDIO byte-identity intact (golden diff empty).
- Coherence D6 upgraded from DEVIATION to FOLLOWED: the drain ordering is now correct and empirically drains a
  held streaming session.

### Findings disposition (change as a whole)

| Finding | Original | Re-verify (R1) status |
|---------|----------|-----------------------|
| CRITICAL-1 drain deadlock w/ open GET SSE stream | FAIL | FIXED -- reorder + closeAllConnections; independently reproduced (1ms fixed vs 6015ms pre-fix) |
| WARNING-1 drain test false confidence (POST-only) | open | ADDRESSED -- streaming-drain test opens+HOLDS GET stream before close(); RED vs old order, GREEN after; POST-only test kept |
| S-1 eager --port/--host validation off --http | accepted | ACCEPTED (suggestion, non-blocking) -- unchanged |
| S-2 unused port param in validateOriginHost | accepted | ACCEPTED (suggestion, non-blocking) -- unchanged |
| S-3 6/6 agent matrix point-in-time claim | accepted | ACCEPTED (suggestion, non-blocking, docs-only) -- unchanged |

Spec compliance: 22 of 22 scenarios COMPLIANT (the former PARTIAL row #11 SIGINT/SIGTERM drain is now
behaviorally proven under the normative GET SSE streaming channel).

### Next recommended

sdd-archive -- no CRITICAL remains; WARNING-1 addressed; only accepted non-blocking suggestions carry forward.
