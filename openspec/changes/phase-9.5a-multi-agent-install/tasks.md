# Tasks: Phase 9.5a — Multi-agent install

Standing header (every task): STRICT TDD (RED→GREEN→refactor; the failing test PRECEDES the code). EXTEND
`src/cli/commands/install.ts` IN PLACE — do NOT rewrite; KEEP `FsSeam`, `realFsSeam`, `MCP_ENTRY_NAME`,
`McpServerEntry`, `resolveConfigPath`, `mergeMcpConfig`, `removeMcpConfig`, `InstallOptions`,
`InstallOutcome` EXPORTED and unchanged in shape (the existing object-level `mergeMcpConfig`/`removeMcpConfig`
suites and the shipped `runInstall` suites are the load-bearing regression net — they MUST stay green at every
step). All units are FULLY FS-free via the existing `makeFakeFs` seam + INJECTED `platform`/`env` — NO real
filesystem, green on Windows, NO CI (correct BY CONSTRUCTION). Cross-platform paths use explicit
`pathWin32.join` on the `win32` branch and `pathPosix.join` on the posix branch with the CORRECT env var PER
row PER OS (`APPDATA` for Claude Code; `USERPROFILE` for the `~`-rooted agents on win32; `HOME` on posix) —
NEVER the host `join`/`basename` (the `doctor.ts` bug class). Missing env var ⇒ `resolvePath` returns
`undefined` ⇒ row SKIPPED, NEVER throws, NEVER creates a file. ZERO new runtime dependencies — the Codex TOML
writer is an in-house line-oriented micro-writer bounded to the fixed `[mcp_servers.dbgraph-mcp]` block
(ADR-007); imports stay node builtins ONLY (ADR-004: `src/cli` NEVER imports `src/mcp/**` or
`src/adapters/**`). Writers are PURE (no I/O). The row-level `merge(content,entry)`/`remove(content)` operate
on RAW TEXT (parse→apply→serialize internally) so the loop body is FORMAT-BLIND; JSON formats render with the
reused contract `JSON.stringify(obj, null, 2) + '\n'` and stay reference-stable at the OBJECT layer; the TEXT
layer detects a no-op by `next === content`. No secrets are ever written (entry is `command` + `args` only).
EXACT assertions from the start — each agent × {win32, posix} path is pinned to the EXACT string (L-009);
every merge/remove asserts the FULL entry value and that OTHER planted entries/blocks are preserved
EXACT-set; existence-only `.toBeDefined()` is NOT sufficient. `--agent <name>` is DEFERRED (do NOT touch
`dispatch.ts` arg-parsing). Conventional commits referencing US-038; ENGLISH only.

Per-batch GATE (ALL must pass before the next batch): `npx tsc --noEmit` clean (no `any`, typed) ·
`npm run lint` 0 errors / 0 warnings · `npm test` GREEN — and CRITICALLY the EXISTING Claude Code install
suites (`resolveConfigPath`, `mergeMcpConfig`, `removeMcpConfig`, `runInstall — no agent detected / install /
--remove` in `test/cli/commands/install.test.ts`) MUST stay green at every GATE (they guard the loop refactor
and the object-writer reuse). Plus the batch-specific proof noted in each section.

## Batch A: `AGENT_TABLE` types + `homeRoot` + multi-pass `runInstall` loop + Cursor & Gemini rows (reuse existing writers)

> Satisfies `mcp-server` "dbgraph install idempotently wires the agent MCP config" — the single typed
> `AGENT_TABLE` source of truth, the one-pass detect-and-configure loop, and the FIRST two reuse rows. Carries
> the loop refactor; the existing Claude Code suites are the regression guard for it. Scenarios touched:
> "mcpServers-JSON agents get the {command,args} entry", "Only agents with an existing config file are
> configured", "No detected agent prints the manual snippet and exits 0", "Config paths resolve correctly on
> win32 / posix" (Claude Code + Cursor rows). Claude Code = the EXISTING behavior, preserved.

- [x] A.1 RED→GREEN `test/cli/commands/install.test.ts` (extend) + `src/cli/commands/install.ts`: add the
  exported types `AgentFormat = 'mcpServers' | 'vscode' | 'opencode' | 'codex-toml'`, `AgentDescriptor`
  (`{ readonly id; readonly displayName; resolvePath(platform, env): string | undefined; readonly format;
  merge(content: string, entry: McpServerEntry): string; remove(content: string): string }`), `Env`
  (`Record<string, string | undefined>`), `AgentAction =
  'installed'|'already'|'removed'|'absent'|'skipped'`, and `AgentResult`
  (`{ readonly agent: string; readonly action: AgentAction; readonly path?: string }`). RED: a typed
  construction of an `AgentDescriptor` literal compiles. Done: `npx tsc --noEmit`.
- [x] A.2 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts`: add the
  `homeRoot(platform: string, env: Env): string | undefined` helper centralizing the `USERPROFILE` (win32) /
  `HOME` (posix) choice (returns `undefined` when the var is missing/empty). Assert EXACTLY:
  `homeRoot('win32', { USERPROFILE: 'C:\\Users\\u' }) === 'C:\\Users\\u'`;
  `homeRoot('linux', { HOME: '/home/u' }) === '/home/u'`; `homeRoot('win32', {}) === undefined`;
  `homeRoot('linux', {}) === undefined`. Done: `npm test install`.
- [x] A.3 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts`: define the exported
  `readonly AGENT_TABLE: readonly AgentDescriptor[]` with the Claude Code row (`id:'claude-code'`,
  `format:'mcpServers'`, `resolvePath` = the existing `resolveConfigPath` logic — `APPDATA`-rooted on win32,
  `HOME, '.config','Claude'` on posix; `merge`/`remove` wrap the EXISTING object `mergeMcpConfig`/
  `removeMcpConfig` over RAW TEXT) and the Cursor + Gemini rows (`format:'mcpServers'`, `homeRoot`-rooted:
  Cursor `'.cursor','mcp.json'`, Gemini `'.gemini','settings.json'`; merge/remove ALSO wrap
  `mergeMcpConfig`/`removeMcpConfig`). Assert EXACT win32 + posix `resolvePath` strings for ALL THREE rows
  (e.g. Cursor win32 `C:\\Users\\u\\.cursor\\mcp.json`, posix `/home/u/.cursor/mcp.json`; Gemini win32
  `C:\\Users\\u\\.gemini\\settings.json`, posix `/home/u/.gemini/settings.json`) AND that each
  `resolvePath` returns `undefined` when its env var is absent. Spec: Config paths resolve correctly on
  win32 / posix (Claude Code + Cursor rows). Done: `npm test install`.
- [x] A.4 RED→GREEN add a RAW-TEXT-level suite for the `mcpServers` family rows in
  `test/cli/commands/install.test.ts`: calling `AGENT_TABLE[claude].merge('{}\n', DEFAULT_ENTRY)` (and the
  Cursor/Gemini rows) returns the EXACT serialized text `JSON.stringify({ mcpServers: { 'dbgraph-mcp':
  { command:'npx', args:['-y','dbgraph-mcp'] } } }, null, 2) + '\n'`; merging text that ALREADY contains the
  entry returns the input text UNCHANGED (`next === content`, idempotent); a planted `other-mcp` entry is
  preserved EXACT-set; `remove(text)` deletes ONLY `dbgraph-mcp` (planted `other-mcp` preserved) and yields
  `{ mcpServers: { 'other-mcp': … } }`; removing when the only entry was `dbgraph-mcp` drops the `mcpServers`
  key (mirrors the shipped `→ undefined`). Spec: mcpServers-JSON agents get the {command,args} entry; any
  pre-existing mcpServers entries are preserved. Done: `npm test install`.
- [x] A.5 RED→GREEN refactor `runInstall` in `src/cli/commands/install.ts` into the multi-pass loop over
  `AGENT_TABLE` (keep `InstallOptions` and the `{ type: 'success' }` `InstallOutcome` VERBATIM so
  `dispatch.ts`/`handleInstall` need NO edit): for each row → `resolvePath(platform, env)`
  (`undefined` ⇒ push `skipped`, continue) → `fsSeam.exists(path)`? (`false` ⇒ push `absent`, continue) →
  read raw (catch parse error → treat as empty per format, i.e. `'{}'` for JSON rows) → `next =
  remove ? row.remove(raw) : row.merge(raw, DEFAULT_MCP_ENTRY)` → if `next === raw` push `already`/`absent`
  (NO write) else `fsSeam.writeFile(path, next)` and push `installed`/`removed`. After the loop: if EVERY
  result ∈ `{skipped, absent}` → `write(MANUAL_SNIPPET)`; else → `write` the per-agent summary. Add a
  Cursor+Gemini integration assertion: given existing Cursor + Gemini config files on win32 AND posix, both
  files' written bytes carry `mcpServers.dbgraph-mcp = { command:'npx', args:['-y','dbgraph-mcp'] }`. Spec:
  Only agents with an existing config file are configured (absent ⇒ skipped, NO file created). Done:
  `npm test install`.
- [x] A.6 RED→GREEN regression + manual-fallback assertions in `test/cli/commands/install.test.ts`: (a) the
  EXISTING Claude Code suites still pass UNCHANGED (idempotent re-install writes nothing; `--remove` removes
  only `dbgraph-mcp` and preserves `other-mcp`; malformed JSON starts fresh) now that Claude Code is a TABLE
  ROW; (b) when NO row resolves to an existing file (all env vars unset OR no files), output is EXACTLY
  `MANUAL_SNIPPET` (preserve the shipped exact-equality assertion); (c) one detected agent among several
  absent ones still configures the detected one and reports the rest skipped/absent (NO file created for the
  absent ones). Spec: No detected agent prints the manual snippet and exits 0; the US-024 manual-snippet
  fallback is preserved. Done: `npm test install`.
- [x] A.7 GATE — Batch A: `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green INCLUDING all
  pre-existing Claude Code install suites unchanged. Confirm `src/cli/dispatch.ts` is UNTOUCHED. Done: all
  gates green.

## Batch B: VS Code writer (`servers` key, `{type:'stdio',…}`) + VS Code row

> Satisfies `mcp-server` scenario "VS Code gets a servers entry with type stdio, not mcpServers". DIFFERENT
> entry SHAPE (not just a different key) ⇒ explicit new functions, NOT an overload of `mergeMcpConfig`.

- [ ] B.1 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts`: add PURE
  `mergeVsCodeConfig(config, entry)` / `removeVsCodeConfig(config)` operating on the `servers` key with the
  entry shape `{ type:'stdio', command, args }`. Mirror the shipped reference-stability contract (same-value
  ⇒ return the input ref; remover deletes the `servers` key when it empties). Assert: fresh add yields
  `servers['dbgraph-mcp'] === { type:'stdio', command:'npx', args:['-y','dbgraph-mcp'] }`; re-add returns the
  SAME ref (idempotent); a planted `servers['other']` is preserved EXACT-set; remove deletes ONLY
  `dbgraph-mcp`; and — CRITICAL — NO `mcpServers` key is ever produced. Spec: VS Code gets a servers entry
  with type stdio, not mcpServers (servers-vs-mcpServers explicitly asserted). Done: `npm test install`.
- [ ] B.2 RED→GREEN add the VS Code row to `AGENT_TABLE` (`id:'vscode'`, `format:'vscode'`, `homeRoot`-rooted
  `'.vscode','mcp.json'`; `merge`/`remove` wrap `mergeVsCodeConfig`/`removeVsCodeConfig` over RAW TEXT with
  the `JSON.stringify(...,null,2)+'\n'` render). Assert EXACT win32 path
  `C:\\Users\\u\\.vscode\\mcp.json` and posix `/home/u/.vscode/mcp.json`, and `undefined` when the env var is
  absent. Spec: Config paths resolve correctly on win32 / posix (VS Code row). Done: `npm test install`.
- [ ] B.3 RED→GREEN VS Code integration via `runInstall`: given an existing VS Code `mcp.json` on win32 AND
  posix, the written bytes contain `servers.dbgraph-mcp = { type:'stdio', command:'npx',
  args:['-y','dbgraph-mcp'] }` and NO `mcpServers` key; idempotent re-run writes nothing; `--remove` deletes
  only `dbgraph-mcp` (planted `servers.other` preserved). Spec: VS Code gets a servers entry with type
  stdio, not mcpServers; --remove deletes only the dbgraph-mcp entry per agent. Done: `npm test install`.
- [ ] B.4 GATE — Batch B: `tsc` clean; lint 0/0; `npm test` green incl. all Batch A + Claude Code suites.
  Done: all gates green.

## Batch C: opencode writer (`mcp` key, `{type:'local',command:[…]}` ARRAY command) + opencode row

> Satisfies `mcp-server` scenario "opencode gets a local entry with an array command". DIFFERENT shape again:
> `command` is an ARRAY, no `args` — pin the shape so it is never modeled as a string + args.

- [ ] C.1 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts`: add PURE
  `mergeOpenCodeConfig(config, entry)` / `removeOpenCodeConfig(config)` operating on the `mcp` key with the
  entry shape `{ type:'local', command:['npx','-y','dbgraph-mcp'] }` (command DERIVED from `[entry.command,
  ...entry.args]`; NO `args` field on the written entry). Same reference-stability + empty-key-cleanup
  contract. Assert: fresh add yields `mcp['dbgraph-mcp'] === { type:'local', command:['npx','-y',
  'dbgraph-mcp'] }` and that `command` is an ARRAY (`Array.isArray` true) and there is NO `args` key on the
  entry; re-add returns the SAME ref; planted `mcp.other` preserved EXACT-set; remove deletes ONLY
  `dbgraph-mcp`. Spec: opencode gets a local entry with an array command. Done: `npm test install`.
- [ ] C.2 RED→GREEN add the opencode row to `AGENT_TABLE` (`id:'opencode'`, `format:'opencode'`,
  `homeRoot`-rooted `'.config','opencode','opencode.json'`; `merge`/`remove` wrap the new functions over RAW
  TEXT). Assert EXACT win32 path `C:\\Users\\u\\.config\\opencode\\opencode.json` and posix
  `/home/u/.config/opencode/opencode.json`, and `undefined` when the env var is absent. Spec: Config paths
  resolve correctly on win32 / posix (opencode `.config`-rooted row). Done: `npm test install`.
- [ ] C.3 RED→GREEN opencode integration via `runInstall`: given an existing `opencode.json` on win32 AND
  posix, the written bytes contain `mcp.dbgraph-mcp = { type:'local', command:['npx','-y','dbgraph-mcp'] }`
  (array command); idempotent re-run writes nothing; `--remove` deletes only `dbgraph-mcp` (planted
  `mcp.other` preserved). Spec: opencode gets a local entry with an array command; --remove deletes only the
  dbgraph-mcp entry per agent. Done: `npm test install`.
- [ ] C.4 GATE — Batch C: `tsc` clean; lint 0/0; `npm test` green incl. all prior batches + Claude Code
  suites. Done: all gates green.

## Batch D: in-house Codex TOML micro-writer (merge/remove, block-boundary, idempotent, byte-deterministic) + codex row

> Satisfies `mcp-server` scenarios "Codex CLI gets the TOML mcp_servers block" and "Re-running is idempotent
> for every format including TOML". In-house, ADR-007 — bounded to the FIXED `[mcp_servers.dbgraph-mcp]`
> block; NEVER a general TOML parser; ZERO new deps. Detect via header scan; block runs until the next line
> matching `/^\s*\[/` or EOF.

- [ ] D.1 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts`: add the deterministic
  `CODEX_RENDER` constant = the fixed 3 lines `[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y",
  "dbgraph-mcp"]` (args serialized with a SINGLE space after the comma; stable order `command` then `args`).
  Assert the exact rendered string byte-for-byte. Done: `npm test install`.
- [ ] D.2 RED→GREEN `mergeCodexToml(content)` in `src/cli/commands/install.ts` (PURE, line-oriented): block
  ABSENT ⇒ append `CODEX_RENDER` (ensure exactly ONE blank line before it when the file is non-empty; single
  trailing `\n`); block PRESENT and byte-equal to `CODEX_RENDER` ⇒ return `content` UNCHANGED (idempotent);
  block PRESENT and differing ⇒ replace ONLY the block region (header → terminator `/^\s*\[/` or EOF) with
  `CODEX_RENDER`, preserving the rest verbatim. Assert all three transitions on EXACT text, including: a file
  with an unrelated `[other]` block keeps it intact and lands the dbgraph block; re-running on the merged
  output returns it UNCHANGED (exactly one `[mcp_servers.dbgraph-mcp]` header — count via regex). Spec: Codex
  CLI gets the TOML mcp_servers block (other TOML content preserved); Re-running is idempotent for every
  format including TOML (exactly one block). Done: `npm test install`.
- [ ] D.3 RED→GREEN `removeCodexToml(content)` in `src/cli/commands/install.ts` (PURE): block ABSENT ⇒ return
  `content` unchanged; block PRESENT ⇒ delete the header→block-end region, collapse a resulting DOUBLE blank
  line, keep a single trailing `\n`. Other `[mcp_servers.*]` and `[other]` blocks UNTOUCHED. Assert on EXACT
  text: removing from a file with `[mcp_servers.dbgraph-mcp]` + `[other]` yields the file with ONLY `[other]`
  remaining and no orphan blank lines; removing when the block is absent returns the input unchanged. Spec:
  --remove deletes only the dbgraph-mcp entry per agent (the Codex block is gone; other blocks untouched).
  Done: `npm test install`.
- [ ] D.4 RED→GREEN add the codex row to `AGENT_TABLE` (`id:'codex'`, `format:'codex-toml'`, `homeRoot`-rooted
  `'.codex','config.toml'`; `merge` = `(text) => mergeCodexToml(text)` ignoring the JSON entry — the render
  is fixed; `remove` = `removeCodexToml`). Assert EXACT win32 path `C:\\Users\\u\\.codex\\config.toml` and
  posix `/home/u/.codex/config.toml`, and `undefined` when the env var is absent. Spec: Config paths resolve
  per OS (codex row). Done: `npm test install`.
- [ ] D.5 RED→GREEN codex integration via `runInstall`: given an existing `config.toml` on win32 AND posix,
  the written bytes contain a `[mcp_servers.dbgraph-mcp]` block with `command = "npx"` and `args = ["-y",
  "dbgraph-mcp"]` and any pre-existing `[other]` block is preserved; idempotent re-run writes nothing
  (`next === raw`); `--remove` deletes exactly the block. NOTE: for `format:'codex-toml'` the loop's
  parse-error fallback is the EMPTY STRING `''` (NOT `'{}'`) — assert an empty/absent-content codex file
  still produces a valid single-block render. Spec: Codex CLI gets the TOML mcp_servers block; Re-running is
  idempotent for every format including TOML; --remove deletes only the dbgraph-mcp entry per agent. Done:
  `npm test install`.
- [ ] D.6 GATE — Batch D: `tsc` clean; lint 0/0; `npm test` green incl. all prior batches + Claude Code
  suites. Done: all gates green.

## Batch E: full 6-agent matrix reconcile + manual-snippet wording + summary polish + US-038 docs

> Satisfies the remaining `mcp-server` scenarios "Written entries carry no secrets", the FULL cross-platform
> matrix, and the no-secrets/clean-`--remove` security posture; finalizes the per-agent summary wording (the
> design's one OPEN QUESTION) and reconciles US-038. No NEW writer logic — this is the closing
> matrix + polish + docs batch.

- [ ] E.1 RED→GREEN the FULL cross-platform path matrix in `test/cli/commands/install.test.ts`: a single
  data-driven suite asserting ALL 6 rows × {win32, posix} resolve to their EXACT pinned strings (Claude Code
  `%APPDATA%`-rooted; the other five `homeRoot`-rooted), AND that EACH row's `resolvePath` returns
  `undefined` when its env var is missing/empty. Pin Claude Code win32
  `C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json` and posix
  `/home/u/.config/Claude/claude_desktop_config.json`. Spec: Config paths resolve correctly on win32; Config
  paths resolve correctly on posix (all rows). Done: `npm test install`.
- [ ] E.2 RED→GREEN the FULL multi-agent integration matrix via `runInstall`: given existing config files for
  ALL 6 agents simultaneously on win32 (then again on posix), ONE pass writes each file's format-correct
  entry (mcpServers ×3, servers ×1, mcp-array ×1, codex-toml ×1); a SECOND pass writes NOTHING to ANY file
  (idempotent across every format including TOML); `--remove` over all 6 deletes EXACTLY the `dbgraph-mcp`
  entry/block from each and leaves a planted "other" entry/block in each file intact. Spec: Re-running is
  idempotent for every format including TOML; --remove deletes only the dbgraph-mcp entry per agent. Done:
  `npm test install`.
- [ ] E.3 RED→GREEN no-secrets assertion: for every configured agent, the written entry contains ONLY
  `command` + `args` (mcpServers/vscode rows), `type` + `command` array (opencode), or `command`/`args` TOML
  keys (codex) — and NO credential/token field anywhere in the written bytes (assert the serialized output
  matches the exact expected entry shape and contains no extra keys). Spec: Written entries carry no secrets.
  Done: `npm test install`.
- [ ] E.4 RED→GREEN `MANUAL_SNIPPET` + summary wording in `src/cli/commands/install.ts`: extend
  `MANUAL_SNIPPET` to NAME the supported agents (Claude Code, Cursor, Gemini CLI, VS Code, opencode, Codex
  CLI) while KEEPING the existing structure (the shipped exact-equality test in `runInstall — no agent
  detected` must be updated in the SAME commit to match — they are one contract). Finalize the per-agent
  summary line format (`{displayName} → {action} ({path})` per row when ≥1 agent detected). Assert the
  summary lists each acted-on agent and its action, and that the zero-agent path still prints the (updated)
  `MANUAL_SNIPPET` exactly. Spec: No detected agent prints the manual snippet and exits 0; a detected run
  prints a per-agent operation summary. Done: `npm test install`.
- [ ] E.5 GREEN docs: refine `docs/stories/07-quality-publication.md` US-038 notes to the LOCKED decisions —
  the 6 concrete agents + their exact paths/formats, the three-writer split (`mcpServers` reuse, VS Code
  `servers`/`{type:stdio}`, opencode `mcp`/array-command, in-house Codex TOML per ADR-007), and the
  "adding a 7th agent = one `AGENT_TABLE` row + one test" contract. Spec: US-038 refined with the locked
  decisions encoded. Done: story updated and reviewable.
- [ ] E.6 Final GATE + closeout: `npx tsc --noEmit` clean (no `any`); `npm run lint` 0 errors / 0 warnings;
  `npm test` green INCLUDING every pre-existing Claude Code install suite (unchanged) and the full 6-agent ×
  2-OS matrix; confirm ZERO new dependency was added to `package.json` and `src/cli/dispatch.ts` is
  UNTOUCHED. Done: all gates green.

## Apply Batch Grouping (one sub-agent session each)

- **Batch A** (A.1–A.7): `AgentFormat`/`AgentDescriptor`/`AgentResult` types, `homeRoot`, `AGENT_TABLE` with
  Claude Code (reuse) + Cursor + Gemini rows, the multi-pass `runInstall` loop refactor + per-agent results +
  summary + manual fallback, Claude Code regression. Largest batch (carries the loop refactor).
- **Batch B** (B.1–B.4): `mergeVsCodeConfig`/`removeVsCodeConfig` (`servers` key, `{type:stdio}`) + VS Code
  row; the `servers`-vs-`mcpServers` distinction explicitly asserted.
- **Batch C** (C.1–C.4): `mergeOpenCodeConfig`/`removeOpenCodeConfig` (`mcp` key, `{type:local,command:[…]}`
  array command) + opencode row; the array-command shape pinned.
- **Batch D** (D.1–D.6): in-house `CODEX_RENDER` + `mergeCodexToml`/`removeCodexToml` micro-writer
  (block-boundary, idempotent, byte-deterministic) + codex row.
- **Batch E** (E.1–E.6): full 6-agent × 2-OS path + integration matrix, no-secrets assertion,
  `MANUAL_SNIPPET`/summary wording, US-038 story reconcile, final closeout.

### Dependency bottlenecks

- **Batch A gates EVERYTHING.** The `AgentDescriptor` type + `AGENT_TABLE` scaffold + the multi-pass
  `runInstall` loop (A.1/A.3/A.5) must land before any later batch can add a row — every B/C/D/E row plugs
  into the SAME table and the SAME format-blind loop body. A.5 is the single highest-risk task: it rewraps
  the shipped `runInstall` body, so the EXISTING Claude Code suites (A.6) are the load-bearing guard — if any
  shipped install test goes red, the refactor leaked and is a HARD STOP. Resolve A before B/C/D in strict
  order.
- **A.4's RAW-TEXT wrapping contract gates B.1/C.1/D.2** — those writers must follow the SAME
  parse→object-fn→`JSON.stringify(...,null,2)+'\n'` (JSON) or line-oriented (TOML) text contract A
  establishes, so the loop body stays format-blind. Diverging here breaks the loop's `next === content`
  no-op detection (and thus idempotency).
- **B, C, D are mutually INDEPENDENT** once A lands (three disjoint writer families on disjoint keys/shapes).
  They MAY be applied in any order or parallelized across sessions — but each still ends on its own GATE that
  re-proves the Claude Code + prior-batch suites stay green. Sequential B→C→D is the safe default; parallel
  is permitted only if each session re-runs the FULL `npm test`.
- **Batch E depends on A+B+C+D ALL landing** — its matrix asserts all 6 rows simultaneously and its
  `MANUAL_SNIPPET` wording change is coupled to the shipped exact-equality test (E.4 must edit snippet + test
  in ONE commit, or the regression assertion goes red).
- **Codex parse-error fallback is `''`, JSON rows fall back to `'{}'`** — the loop body's
  "treat as empty per format" branch (A.5) must be format-aware; D.5 re-proves the codex empty-content path.
  Mis-defaulting codex to `'{}'` would corrupt the TOML render.
- **NO CI safety net**: every path assertion is EXACT per agent × per OS (L-009); cross-platform correctness
  is locked by these unit assertions, NOT by a runner. The `doctor.ts` host-`basename` bug is the precedent
  this guards against.
- NOTE: the `engines/**` write-verb `security-scan.test.ts` does NOT cover `src/cli/**`, so it does NOT guard
  `install.ts`; the GATE's protection for this change is `tsc` + `lint` + the full `npm test` (which includes
  the shipped install regression suites). Do NOT claim the scanner covers this file.

## Definition of Done (tied to the proposal's Success Criteria)

- [ ] `AGENT_TABLE` drives detection + configuration for the 6 agents (Claude Code, Cursor, Gemini CLI, VS
  Code, opencode, Codex CLI) via the multi-pass `runInstall` loop; adding a 7th is one `AGENT_TABLE` row +
  one test. — Batches A–E
- [ ] Each agent installs AND removes idempotently across `win32` and `posix` in unit tests (re-run writes
  nothing — incl. TOML; `--remove` deletes EXACTLY the `dbgraph-mcp` entry/block it added; other
  entries/blocks untouched). — Batches A–E (matrix in E.2)
- [ ] Every agent × {win32, posix} config-path permutation is asserted EXACTLY (L-009) via the existing fake
  `FsSeam` + injected `platform`/`env` — NO real filesystem, green on Windows, NO CI. — Batches A–D
  (consolidated in E.1)
- [ ] The four entry SHAPES are honored: `mcpServers`-JSON `{command,args}` (Claude Code/Cursor/Gemini), VS
  Code `servers` with `{type:'stdio',…}` (and NO `mcpServers` key), opencode `mcp` with
  `{type:'local',command:[…]}` ARRAY command, Codex `[mcp_servers.dbgraph-mcp]` TOML — the VS Code
  `servers`-vs-`mcpServers` distinction explicitly tested. — Batches A (mcpServers), B (vscode), C (opencode),
  D (codex)
- [ ] When ZERO agents are detected the (updated) manual snippet is printed and the command exits 0 (US-024
  behavior preserved); a detected run prints a per-agent operation summary. — Batches A.6, E.4
- [ ] Written entries carry NO secrets (only `command`/`args` or `type`+array `command`); `--remove` is clean
  and exact; absent file ⇒ skipped, never created. — Batches A.5/A.6, E.3
- [ ] ZERO new runtime dependencies — the Codex TOML writer is an in-house micro-writer (ADR-007); `src/cli`
  imports node builtins ONLY (ADR-004); `src/cli/dispatch.ts` and the `InstallOptions`/`InstallOutcome`
  contract are UNCHANGED. — Batches D, E.6
- [ ] `npx tsc --noEmit` (no `any`, typed errors), `npm run lint` (0/0), and `npm test` are ALL green,
  INCLUDING every pre-existing Claude Code install suite unchanged. — every batch GATE; final in E.6
- [ ] US-038 reconciled in `docs/stories/07-quality-publication.md` with the 6 agents, their paths/formats,
  the three-writer split (incl. in-house Codex TOML), and the one-row-per-agent contract. — Batch E.5
