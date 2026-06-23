# Verification Report -- phase-9.5a-multi-agent-install

**Change**: phase-9.5a-multi-agent-install
**Capability**: mcp-server -- "dbgraph install idempotently wires the agent MCP config" (US-024 -> US-038)
**Mode**: Strict TDD (RED->GREEN, EXACT-set assertions per L-009)
**Verifier**: sdd-verify
**Date**: 2026-06-23
**Verdict**: PASS -- 0 CRITICAL, 0 WARNING, 2 SUGGESTION

---

## Executive Summary

The implementation FULLY satisfies the modified mcp-server requirement and all 12 spec scenarios.
The full quality gate is green (tsc clean, lint 0/0, 2758/2758 tests pass; the install suite alone is
186/186). The two highest-risk areas both PASS scrutiny: (1) cross-platform path resolution is correct BY
CONSTRUCTION -- every AGENT_TABLE row uses explicit path.win32/path.posix with the correct env var per
agent per OS, and all 6 agents x {win32, posix} resolve to EXACT pinned strings; (2) the in-house Codex TOML
micro-writer is bounded to the fixed [mcp_servers.dbgraph-mcp] block, is idempotent, and --remove provably
preserves an adjacent [mcp_servers.other-server] block. ZERO new runtime dependencies and src/cli/dispatch.ts
are confirmed UNTOUCHED via git. Recommend sdd-archive.

---

## Completeness

| Metric | Value |
|--------|------|
| Tasks total (A-E, incl. gates) | 27 |
| Tasks complete [x] | 27 |
| Tasks incomplete [ ] | 0 |
| Definition-of-Done items | 8 / 8 [x] |

All Batch A-E tasks and every per-batch GATE are checked off and match the code state.

---

## Build and Tests Execution (real gate output)

**Type check** -- npx tsc --noEmit -> PASS EXIT 0 (no errors, no any).

**Lint** -- npm run lint (eslint .) -> PASS EXIT 0 (0 errors / 0 warnings).

**Tests** -- npm test (vitest run, unit) -> PASS EXIT 0
    Test Files  162 passed (162)
         Tests  2758 passed (2758)
      Duration  ~40s

**Install suite (focused)** -- npx vitest run test/cli/commands/install.test.ts -> PASS EXIT 0
    Test Files  1 passed (1)
         Tests  186 passed (186)

**Coverage**: Not run (no coverage threshold configured for this change; not required).

---

## PRIORITY Scrutiny Verdicts

### #1 -- Cross-platform path correctness (HIGHEST, no CI) -> PASS

Every AGENT_TABLE row resolves paths with EXPLICIT platform-pinned joins and the correct env var:

| Row | win32 join | win32 env | posix join | posix env | Verdict |
|----|-----------|-----------|------------|-----------|---------|
| claude-code | pathWin32.join(APPDATA,'Claude',...) (via resolveConfigPath) | APPDATA | pathPosix.join(HOME,'.config','Claude',...) | HOME | PASS |
| cursor | pathWin32.join(root,'.cursor','mcp.json') | USERPROFILE | pathPosix.join(root,'.cursor','mcp.json') | HOME | PASS |
| gemini | pathWin32.join(root,'.gemini','settings.json') | USERPROFILE | pathPosix.join(...) | HOME | PASS |
| vscode | pathWin32.join(root,'.vscode','mcp.json') | USERPROFILE | pathPosix.join(...) | HOME | PASS |
| opencode | pathWin32.join(root,'.config','opencode','opencode.json') | USERPROFILE | pathPosix.join(...) | HOME | PASS |
| codex | pathWin32.join(root,'.codex','config.toml') | USERPROFILE | pathPosix.join(...) | HOME | PASS |

- The HOST-default path import is NEVER used in any resolver -- only pathWin32 / pathPosix from node:path
  (install.ts line 21). This is the precise guardrail against the doctor.ts host-basename bug class. NO
  host-path default found anywhere -> the doctor.ts-class bug is ABSENT.
- homeRoot centralizes the USERPROFILE (win32) / HOME (posix) choice; Claude Code is the ONLY %APPDATA% row
  (correct), all others are %USERPROFILE%-rooted on win32 / HOME on posix (correct).
- Missing env var => resolvePath returns undefined => row skipped, never throws, never creates a file.
- Tests assert EXACT resolved strings for ALL 6 agents x {win32, posix} AND the undefined-on-missing-env
  case: the data-driven E.1 suite (test lines 1415-1532) plus per-row suites A.3 / B.2 / C.2 / D.4. This
  matches spec scenarios "Config paths resolve correctly on win32" and "...on posix" EXACTLY, including the
  opencode %USERPROFILE%\.config\opencode\... win32 path the spec pins.

### #2 -- In-house Codex TOML micro-writer (highest-risk code) -> PASS

mergeCodexToml / removeCodexToml (install.ts lines 520-621):

- Bounded to the fixed block: detection scans for the exact header [mcp_servers.dbgraph-mcp]
  (findCodexHeaderLine, exact === match); block end = next line matching /^\s*\[/ or EOF
  (findCodexBlockEnd). It is NOT a general TOML parser -- it only locates and renders the one fixed block.
- Idempotent: when the present block is byte-equal to CODEX_RENDER, mergeCodexToml returns content UNCHANGED
  (line 553-556) -> the loop's next === raw guard performs NO write. Verified by D.2 double-run test
  (line 1203) and the E.2 win32 second-pass test (line 1627, writeSpy not called, written empty).
- --remove preserves ADJACENT blocks: removeCodexToml deletes ONLY the header->block-end region, collapses
  the resulting double blank line, keeps a single trailing newline. PROVEN by the dedicated test
  "preserves an adjacent [mcp_servers.other-server] block" (line 1242) and reinforced by the E.2 6-agent
  --remove matrix (lines 1657, 1678-1679): a planted [mcp_servers.other-server] block survives while
  [mcp_servers.dbgraph-mcp] is removed. It CANNOT corrupt neighbor blocks.
- Byte-deterministic: CODEX_RENDER is a fixed 3-line constant with stable key order (command then args) and
  a single space after the comma in args; byte-asserted in D.1 (line 1131).
- ZERO new deps: hand-rolled, node builtins only (ADR-007). Confirmed by git (package.json untouched).
- Codex empty-content fallback is '' not '{}': the loop's parse-error branch is format-aware
  (row.format === 'codex-toml' ? '' : '{}', install.ts line 887); D.5 (line 1375) proves an unparseable
  codex file still yields exactly one valid block.

---

## Spec Compliance Matrix (behavioral -- every scenario backed by a passing test)

| # | Scenario | Covering test(s) | Result |
|---|----------|------------------|--------|
| 1 | mcpServers-JSON agents get {command,args}; pre-existing entries preserved | A.4 (merge preserves planted other-mcp), E.2 win32/posix one-pass | COMPLIANT |
| 2 | VS Code gets servers {type:'stdio'}, NOT mcpServers | B.1 (fresh add does NOT produce mcpServers), B.3 (asserts mcpServers undefined) | COMPLIANT |
| 3 | opencode gets mcp local entry with ARRAY command | C.1 (Array.isArray true, no args), C.3 | COMPLIANT |
| 4 | Codex CLI gets the [mcp_servers.dbgraph-mcp] TOML block; other content preserved | D.2, D.5 ([other] preserved) | COMPLIANT |
| 5 | Only agents with an existing config file are configured (absent => skipped, no file created) | A.5/A.6 (absent...no file created, one detected among absent) | COMPLIANT |
| 6 | Re-running idempotent for EVERY format incl. TOML (exactly one block) | A.6 (idempotent re-install), B.3/C.3 (re-run writes nothing), D.2 (one header), E.2 (second pass writes nothing) | COMPLIANT |
| 7 | --remove deletes only dbgraph-mcp per agent; others intact | A.6, B.3, C.3, D.3, E.2 --remove over all 6 | COMPLIANT |
| 8 | No detected agent prints manual snippet and exits 0 | "no agent detected" suite, A.6, E.4 (output === MANUAL_SNIPPET, result.type==='success') | COMPLIANT |
| 9 | Config paths resolve correctly on win32 (Claude %APPDATA%, Cursor/opencode %USERPROFILE%) | E.1 win32 exact-pin (all 6), A.3/C.2 | COMPLIANT |
| 10 | Config paths resolve correctly on posix | E.1 posix exact-pin (all 6), A.3 | COMPLIANT |
| 11 | Written entries carry no secrets (only command/args / type+array) | E.3 (exact key sets; credential-pattern scan over ALL rows) | COMPLIANT |
| 12 | (implicit) >=6 agents from a single typed AGENT_TABLE; idempotent install+remove x both OS | E.1 + E.2 full matrix | COMPLIANT |

**Compliance summary**: 12 / 12 scenarios COMPLIANT (each proven by >=1 passing test).

---

## Correctness (static -- structural evidence)

| Requirement element | Status | Notes |
|---------------------|--------|------|
| Single typed AGENT_TABLE source of truth, 6 rows | Implemented | install.ts lines 633-742; readonly AgentDescriptor[] |
| Three writer families + reuse | Implemented | mcpServers reuse (mergeMcpConfig/removeMcpConfig); new VS Code, opencode, Codex writers |
| One-pass multi-agent runInstall loop + per-agent summary | Implemented | lines 855-920; resolve->exists->read->apply->write-on-change; summary {displayName} -> {action} ({path}) |
| Manual fallback when zero detected (US-024 preserved) | Implemented | allSkippedOrAbsent => write(MANUAL_SNIPPET); exact-equality test green |
| command+args only (no secrets) | Implemented | DEFAULT_MCP_ENTRY; E.3 proves no extra keys |
| ZERO new runtime deps (in-house TOML, ADR-007) | Verified | git: package.json/package-lock.json untouched since planning commit |
| ADR-004 boundary (src/cli -> node builtins only) | Verified | install.ts imports only node:path + node:fs; no src/mcp/** or src/adapters/** |

---

## Coherence (design adherence)

| Design Decision | Followed? | Notes |
|-----------------|----------|------|
| 1 -- readonly AGENT_TABLE over per-agent if/switch | Yes | |
| 2 -- Claude/Cursor/Gemini reuse existing writers | Yes | rows wrap mergeMcpText/removeMcpText |
| 3 -- Dedicated mergeVsCodeConfig/mergeOpenCodeConfig (not an overload) | Yes | distinct shapes, type-safe |
| 4 -- In-house Codex TOML (no @iarna/toml) | Yes | ADR-007 honored |
| 5 -- runInstall keeps {type:'success'} + InstallOptions verbatim | Yes | dispatch.ts untouched (git-verified) |
| 6 -- Explicit pathWin32/pathPosix + per-row env var | Yes | scrutiny #1 |
| 7 -- --agent <name> DEFERRED | Yes | dispatch arg-parsing untouched |
| 8 -- Removers drop their container key when it empties | Yes | all four removers -> undefined on empty |
| File Changes table (exactly 3 files) | Yes | git diff: only install.ts, install.test.ts, US-038 story |

No design deviations found.

---

## Issues Found

**CRITICAL** (block archive): None.

**WARNING** (should fix): None.

**SUGGESTION** (non-blocking, not required for archive):
1. Stale CLI help text for install -- the global usage banner in src/cli/cli.ts still reads
   "install   Wire dbgraph-mcp into the Claude Desktop config (--remove to undo)" (visible in test stdout).
   Post-9.5a this is now multi-agent. cli.ts is OUTSIDE this change's declared file scope, so it is NOT a
   regression of this change, but the wording is now user-facing doc drift introduced by this phase's intent.
   Consider a one-line follow-up: "Wire dbgraph-mcp into your detected MCP agent(s)".
2. Orchestrator-referenced guard files do not exist -- the launch prompt referenced boundaries.test.ts.
   No such file (nor a security-scan.test.ts covering src/cli) exists; tasks.md line 276-278 already states
   the scanner does NOT cover src/cli/**. The ADR-004 boundary for install.ts is instead enforced by import
   discipline + tsc + lint (all green) and verified here by inspection (node builtins only). No action needed
   on the code; noted so the archive record is accurate.

---

## Verdict

PASS -- Implementation is complete, correct, and behaviorally compliant. All 12 spec scenarios are backed by
passing tests; the full gate is green (tsc 0, lint 0/0, 2758/2758 tests); the two highest-risk areas
(cross-platform paths, Codex TOML remove-preserves-adjacent) both pass scrutiny; ZERO new runtime
dependencies and an untouched dispatch.ts are git-verified. No CRITICAL or WARNING issues block archive.

**Next recommended phase**: sdd-archive.
