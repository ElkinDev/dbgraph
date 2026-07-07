# Archive Report — http-transport

**Project**: dbgraph
**Change**: `http-transport`
**Branch**: `v1-prep`
**Artifact store**: openspec (files)
**Archived**: 2026-07-06
**Verdict at archive**: PASS (post Re-verify R1) — 22/22 spec scenarios COMPLIANT, 0 CRITICAL, 0 WARNING open, 3 SUGGESTIONs accepted (non-blocking)
**Shipped commits**: `b0ba566`, `590508d`, `abb1bc7`, `507e3e4`, `91707ac`, `d31f6d3`, `207ebd8`

---

## Executive Summary

This change adds an OPT-IN Streamable HTTP serving mode to the dbgraph MCP server (`dbgraph mcp --http`)
so a single host can expose the read-only 8-tool surface to several remote agents instead of each
spawning a private STDIO process — closing the one real capability gap the July competitive analysis
found versus the reference implementation. STDIO remains the default and byte-identical through both
entry seams (SEA `planEntry` and the npm `dbgraph-mcp` bin). Sessions are keyed by `mcp-session-id`
(SDK `StreamableHTTPServerTransport`, one `Server` per session via the existing `createDbgraphServer()`
factory); security posture is loopback-default bind with an explicit, warned non-loopback opt-in and an
in-house Origin/Host validator (the SDK's equivalent flags are `@deprecated` in 1.29.0); no new runtime
dependency (`node:http` + `node:crypto` builtins + the pinned SDK only).

**Verdict trail**: the first `sdd-verify` pass found ONE CRITICAL — graceful shutdown deadlocked when a
client held an open Streamable-HTTP GET SSE stream, because `close()` awaited `httpServer.close()`
BEFORE draining the session registry, and the committed drain test only exercised a non-streaming
session, so it stayed green while the real defect was invisible. `sdd-apply` remediated it (commit
`207ebd8`): reorder the drain to `registry.close()` FIRST, then `httpServer.close()` +
`closeAllConnections()` to force-drop lingering keep-alive sockets, plus a new streaming-drain test that
opens and HOLDS the GET SSE stream before calling `close()`. The re-verifier did not trust the fix on
inspection alone — it independently wrote, ran, and deleted its own throwaway probe: **1.0 ms** to close
with a held stream on the fixed code, versus **6015 ms → TIMEOUT** when the exact same probe was run
against the restored pre-fix file (`git show 207ebd8^:src/mcp/http.ts`, reverted immediately after,
nothing committed). That gap is the empirical proof the fix is real, not merely a passing test. Final
verdict: **PASS**, 22/22 scenarios compliant (the former PARTIAL row is now proven under the normative
streaming channel), WARNING-1 addressed by the same streaming-drain test, and three non-blocking
SUGGESTIONs (S-1/S-2/S-3) carried forward as accepted, documented deviations. STDIO byte-identity held
throughout (golden diff empty at every gate), zero new dependencies, and the 6/6-agent HTTP client
matrix was verified live and documented with its honest per-agent nuances.

---

## What Shipped

| Commit | Summary |
|--------|---------|
| `b0ba566` | SDD planning: proposal, spec (`mcp-http-transport` new capability + deltas to `mcp-server`/`cli-config`), design (D1–D7 architecture decisions), and the Batch 0–4 task breakdown. Also recorded the live 6-agent HTTP client matrix verification (2026-07-06). |
| `590508d` | Batch 0 (spike/empirical): recorded SDK 1.29.0 `handleRequest` + session-lifecycle findings that grounded design decisions D2/D3/D4 before implementation began. |
| `abb1bc7` | Batch 1 (STRICT TDD): the single shared `parseMcpFlags` threaded through BOTH MCP entry seams (`sea-entry.planEntry` pre-dispatch and the npm `dbgraph-mcp` bin auto-run guard) — D1: `mcp` stays pre-dispatch, never promoted into `cli.ts`. |
| `507e3e4` | Batch 2: the `node:http` listener, `SessionRegistry` keyed by `mcp-session-id`, the in-house `validateOriginHost` (D3 — NOT the deprecated SDK flags), and the first graceful-shutdown implementation (D6). |
| `91707ac` | Batch 3: loopback E2E tests — session lifecycle, cross-transport parity (byte-identical tool output HTTP vs STDIO), 403 Origin/Host rejection, and a drain test; deferred the idle-session reaper (design Open Question 3.5) and re-tightened flag validation (S-1). |
| `d31f6d3` | Batch 4: docs — `mcp --http` usage banner line, the verified 6-agent HTTP client matrix write-up, and the no-auth/reverse-proxy honesty posture in `docs/`. |
| `207ebd8` | R1 remediation (post initial FAIL verdict): reordered `close()` to drain the `SessionRegistry` BEFORE awaiting `httpServer.close()`, added `closeAllConnections()`, and added the streaming-drain test that opens+holds a GET SSE stream before calling `close()`. Fixes CRITICAL-1 and WARNING-1. |

Task completeness: 35/35 task checkboxes `[x]` (34 original Batches 0–4 + 1 added for the R1
remediation). Both design Open Questions are resolved as explicit DEFER decisions (idle-reaper §3.5;
allowed-host/allowed-origin §3.6) and recorded in `design.md`. openspec mode has no separate
apply-progress file — `tasks.md` checkboxes are the progress record.

---

## Verdict Trail — FAIL → R1 remediation → PASS

| Stage | Verdict | Key finding |
|-------|---------|-------------|
| Initial `sdd-verify` | **FAIL** (1 CRITICAL) | CRITICAL-1: `close()` in `src/mcp/http.ts` awaited `httpServer.close()` BEFORE `registry.close()`; a client holding the standalone GET SSE stream (normative for Streamable HTTP) kept that connection open, so `httpServer.close()`'s callback never fired — empirically measured HANG at 4005 ms. WARNING-1: the committed drain test only exercised a POST-only (non-streaming) session, so it passed despite the defect. 21/22 scenarios COMPLIANT, 1 PARTIAL. |
| Remediation (`207ebd8`) | — | Reordered the drain: `registry.close()` FIRST (ends in-flight GET SSE streams by closing their transports), THEN `httpServer.close()` + `closeAllConnections()` (force-drops lingering keep-alive sockets). Added a streaming-drain test that opens+holds the GET SSE stream before `close()`. |
| Re-verify (R1) | **PASS** | Independently re-reproduced by the re-verifier with its own throwaway probe (written, run, deleted — tree left clean): **1.0 ms** to close with a held stream on the FIXED code vs **6015 ms → TIMEOUT** on the restored PRE-FIX file — proving both that the probe genuinely holds the stream and that the old ordering truly deadlocked. 22/22 scenarios COMPLIANT. Full gate re-run (not trusted from the author): tsc/lint/tests all green, golden diff empty, no new dependency, no regression. |

### Accepted, non-blocking

- **S-1** — `parseMcpFlags` eagerly validates `--port`/`--host` even when `--http` is absent, so
  `dbgraph mcp --port notaport` (no `--http`) now exits 2 instead of silently ignoring junk and starting
  STDIO. Bare-`mcp` byte-identity is preserved for the flagless case; no spec scenario covers this
  specific combo. Accepted as fail-fast behavior; optionally gate port/host parsing behind `--http` in a
  future change.
- **S-2** — The `port` parameter of `validateOriginHost` is accepted but not used (any port on an
  allowed loopback hostname passes, by design per D3's `(:port)` note). Accepted; either drop the dead
  parameter or comment it as retained for signature/forward-compat in a future cleanup.
- **S-3** — The docs' "6/6 agents verified live 2026-07-06" claim is author-asserted and point-in-time,
  not independently re-verifiable in a single verification pass. It is honestly scoped (opencode wire
  protocol not named; Codex old-install caveat; Gemini `httpUrl` and Cursor no-`type` nuances all
  carried) and affects docs only — no auto-wiring depends on it. Accepted per the project's honesty
  standard.

---

## Live Verification (measured, not merely trusted)

- **6/6 agent HTTP matrix** — verified live 2026-07-06 and documented with each agent's specific nuance
  (opencode wire protocol, Codex old-install caveat, Gemini `httpUrl`, Cursor no-`type`).
- **STDIO byte-identity** — held throughout every gate and every verification pass: `git diff --exit-code
  test/mcp/golden/` stayed EMPTY from the first commit through the R1 remediation; both MCP entry seams
  (SEA `planEntry` and the npm bin) route the flagless case to `startMcpServer()` with no new output.
- **Zero new runtime dependency** — `git diff` of `package.json`/`package-lock.json` across the WHOLE
  change (and again isolated to the R1 commit) is EMPTY; the transport uses `node:http` + `node:crypto`
  builtins plus the already-pinned `@modelcontextprotocol/sdk@1.29.0` only.
- **Drain fix, independently reproduced** — see Verdict Trail above: 1 ms (fixed) vs 6015 ms/TIMEOUT
  (pre-fix), measured by the re-verifier's own throwaway probe, not by trusting the author's gate.

---

## Full Gate (measured at re-verify, R1)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS — exit 0, strict, no `any` |
| `npm run lint` (`eslint .`) | PASS — exit 0, 0 errors / 0 warnings |
| `npm test` (`vitest run`) | PASS — 3088 passed / 0 failed / 0 skipped, 176 files (baseline 3004 → 3088, since the phase-benchmark archive; +1 test over the initial verify's 3087 from the R1 streaming-drain test) |
| `git diff --exit-code test/mcp/golden/` | EMPTY (ADR-008 drift-free, STDIO byte-identical) |
| Dependency diff (`package.json` + lock) | EMPTY — no new runtime dependency |
| Leak-scan (local denylist + generic secret grep) | CLEAN |
| Push state | branch `v1-prep` has no upstream — nothing pushed |

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|-----------------|
| `mcp-http-transport` | **New capability** — promoted as-is from the change's full spec (not a delta) | `openspec/specs/mcp-http-transport/spec.md` |
| `mcp-server` | MODIFIED — 1 requirement renamed/updated in place | `openspec/specs/mcp-server/spec.md` |
| `cli-config` | ADDED — 2 requirements appended in a new dated section | `openspec/specs/cli-config/spec.md` |

### Promotion detail — mcp-http-transport

`mcp-http-transport` had no prior canonical spec — this is a brand-new capability directory. Followed
the same promotion precedent as `benchmark` (`2026-07-06-phase-benchmark`) and `binary-distribution`
(`2026-07-06-phase-9.5c-binaries`): promote the change's full spec essentially as-is. Unlike those two
precedents, this delta spec's title (`# MCP HTTP Transport Specification`) carried NO change-suffix to
strip (it was authored without a `(new — http-transport)` marker), so the promotion is a byte-identical
copy — confirmed via `diff` against the change-folder source, zero lines differ. The "Honest v1
boundaries" provenance blockquote in the Purpose section was kept verbatim.

### Merge detail — mcp-server (MODIFIED)

This file's established convention (seen across the `phase-9.5a-multi-agent-install` and
`phase-7-docs` merges) is to merge MODIFIED requirements IN PLACE — replacing the old requirement block
wholesale with the new one, at its original position in the document, carrying an inline
`(Previously: ...)` note — rather than appending a dated "Requirements Modified by" section. Followed
that convention here: the requirement `### Requirement: stdio server with static initialize
instructions` (1 scenario) was replaced in place by `### Requirement: Transport-selectable server with
static initialize instructions` (3 scenarios — the original scenario plus two new ones: bare-`mcp`
byte-identity across both entry seams, and both transports serving the identical 8-tool surface from one
factory), with the delta's `(Previously: the server started ONLY as a stdio transport entry...)` note
preserved. The file's `## Purpose` section was left untouched, matching how prior merges to this file
did not retroactively rewrite Purpose prose for a requirement-level change.

### Merge detail — cli-config (ADDED)

This file's established convention (seen in the `connectivity-strategies` and `ux-observability`
sections already present) is to append NEW requirements from a later change as a dated
`## Requirements Added by {change-name} ({date})` section at the END of the file, with a blockquote
intro paragraph scoping what the section covers. Followed that convention: appended
`## Requirements Added by http-transport (2026-07-06)` with both delta requirements verbatim (`mcp verb
accepts the HTTP transport flags across both entry seams`; `CLI usage banner documents the mcp verb and
its --http surface`). Correction made during archiving: the intro blockquote in the delta's own dated
section does not carry a `docs/stories/` user-story reference (US-039..044 are already allocated to E8 —
Resilient connectivity, not to this change; `http-transport` is a competitive-gap-driven change with no
dedicated story), so the blockquote states that explicitly instead of citing a story ID.

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `design.md` | Present (D1–D7 architecture decisions; both Open Questions resolved as DEFER) |
| `tasks.md` | Present (35/35 task checkboxes `[x]`, including the R1 remediation task) |
| `specs/mcp-http-transport/spec.md` | Present (full spec, new capability; promoted to canonical, see above) |
| `specs/mcp-server/spec.md` | Present (delta; 1 MODIFIED requirement; merged in place, see above) |
| `specs/cli-config/spec.md` | Present (delta; 2 ADDED requirements; merged as a dated section, see above) |
| `verify-report.md` | Present (FAIL → R1 remediation → PASS trail preserved as audit history) |
| `archive-report.md` | This file |

**GOTCHA (same as prior archives)**: `verify-report.md` and `archive-report.md` are UNTRACKED in git. A
plain `git mv` only relocates TRACKED files — the two untracked `.md` files must be explicitly `git
add`-ed after the move (along with the whole destination folder) or they will not be picked up as
renames and will look like unrelated new files rather than travelling with the change.

---

## Closing Steps (executed)

```bash
cd "C:\Users\ecardoso\dev\dbgraph"

# 1. Move the change folder (git mv only relocates TRACKED files)
git mv openspec/changes/http-transport openspec/changes/archive/2026-07-06-http-transport

# 2. Pick up the untracked files (verify-report.md, archive-report.md) at their new path
git add openspec/changes/archive/2026-07-06-http-transport

# 3. Add the new canonical spec + the two merged main specs
git add openspec/specs/mcp-http-transport/spec.md openspec/specs/mcp-server/spec.md openspec/specs/cli-config/spec.md

# 4. Confirm nothing remains at the old path
git status

# 5. Re-confirm the local gate is green on v1-prep
npx tsc --noEmit
npm run lint
npm test

# 6. Single conventional commit (no PR, no push, no gh, no AI attribution)
git commit -m "chore(sdd): archive http-transport; promote mcp-http-transport canonical spec"
```

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (Batches 0–4, commits `590508d` + `abb1bc7` + `507e3e4` +
`91707ac` + `d31f6d3`, planning `b0ba566`) → VERIFY (FAIL, 1 CRITICAL) → APPLY remediation (`207ebd8`) →
RE-VERIFY (R1, PASS) → **ARCHIVE (complete)**.

Next recommended: no follow-up required to close this change. Non-blocking, out-of-scope items for a
future change: gate `--port`/`--host` parsing behind `--http` (S-1); drop or comment the unused `port`
parameter of `validateOriginHost` (S-2); per-agent HTTP client wiring in `dbgraph install` remains
explicitly DEFERRED (see proposal.md Out of Scope), as does the idle-session reaper (design §3.5) and
the allowed-host/allowed-origin configurability question (design §3.6).
