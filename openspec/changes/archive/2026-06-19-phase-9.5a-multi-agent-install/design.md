# Design: Phase 9.5a — Multi-agent install

## Technical Approach

EXTEND `src/cli/commands/install.ts` in place (no rewrite). Introduce a typed `readonly AGENT_TABLE` as the single source of truth; each row owns its cross-platform `resolvePath`, its `format`, and a pure `merge`/`remove` pair. `runInstall` becomes a multi-pass loop over the table that preserves the shipped per-file read→apply→write logic as the loop body and keeps the `{ type: 'success' }` outcome and `InstallOptions` UNCHANGED, so `handleInstall`/`dispatch.ts` need no edits. Detection stays path-based (resolve → env present → file exists), reusing the exact predicate already used for Claude Code. Writers stay PURE (no I/O) and reference-stable (same-value → return input ref) so the existing "write only when `updated !== rawConfig`" guard drives idempotency unchanged. Codex TOML uses an in-house line-oriented micro-writer bounded to the fixed `[mcp_servers.dbgraph-mcp]` block (ADR-007) — ZERO new deps, node builtins only (ADR-004).

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| 1 | Config model | `readonly AGENT_TABLE: AgentDescriptor[]` | per-agent `if/switch` in `runInstall` | One row + one test adds an agent; loop stays format-agnostic |
| 2 | Writer reuse | Claude/Cursor/Gemini reuse existing `mergeMcpConfig`/`removeMcpConfig` | a writer per agent | Identical `mcpServers`+`{command,args}` shape; less surface, proven idempotency |
| 3 | New JSON writers | `mergeVsCodeConfig` (key `servers`, `{type:'stdio',…}`), `mergeOpenCodeConfig` (key `mcp`, `{type:'local',command:[]}`) | overload `mergeMcpConfig` with a key param | Different entry SHAPES, not just keys; explicit fns are type-safe and testable |
| 4 | Codex TOML | in-house micro-writer bounded to the fixed block | `@iarna/toml` / `toml` dep | ADR-007: ZERO new runtime deps; fixed shape is line-oriented |
| 5 | `runInstall` outcome | keep `Promise<InstallOutcome={type:'success'}>` + `InstallOptions` verbatim | richer return type | dispatch/`handleInstall` untouched → smaller blast radius, clean rollback |
| 6 | Cross-platform paths | explicit `pathWin32.join`/`pathPosix.join` + correct env var PER row | host `join`/`basename` | NO CI: correct by construction; the `doctor.ts` host-`basename` precedent |
| 7 | `--agent <name>` | DEFER (not implemented) | implement now | Proposal marks it NICE-TO-HAVE; loop-over-detected is the contract; avoids dispatch/parse churn |
| 8 | Empty-key cleanup | each remover deletes its key when its container empties (mirror `removeMcpConfig` `→ undefined`) | leave `{}` behind | `JSON.stringify` drops `undefined`; keeps removed files clean (security: clean `--remove`) |

## Interfaces / Contracts

```ts
export type AgentFormat = 'mcpServers' | 'vscode' | 'opencode' | 'codex-toml';

export interface AgentDescriptor {
  readonly id: string;                 // 'claude-code' | 'cursor' | 'gemini' | 'vscode' | 'opencode' | 'codex'
  readonly displayName: string;        // human label for the summary
  resolvePath(platform: string, env: Env): string | undefined; // undefined ⇒ skip (env var missing)
  readonly format: AgentFormat;
  merge(content: string, entry: McpServerEntry): string;  // rawText → rawText (ready to write, incl. trailing \n)
  remove(content: string): string;                        // rawText → rawText
}
type Env = Record<string, string | undefined>;
type AgentAction = 'installed' | 'already' | 'removed' | 'absent' | 'skipped';
interface AgentResult { readonly agent: string; readonly action: AgentAction; readonly path?: string; }
```

`merge`/`remove` operate on RAW TEXT (parse→apply→serialize internally) so the loop body is format-blind. JSON formats parse → call the pure object writer → `JSON.stringify(obj, null, 2) + '\n'` (reused contract). Codex parses/edits text directly. Reference-stability is preserved at the OBJECT layer; the text layer detects no-op by string equality (`next === content` ⇒ `already`/`absent`).

### AGENT_TABLE rows — EXACT paths + env var

| id | format | win32 (`path.win32.join`) | posix (`path.posix.join`) | env (win / posix) |
|----|--------|---------------------------|---------------------------|-------------------|
| claude-code | mcpServers | `APPDATA, 'Claude', 'claude_desktop_config.json'` | `HOME, '.config','Claude','claude_desktop_config.json'` | `APPDATA` / `HOME` |
| cursor | mcpServers | `USERPROFILE, '.cursor', 'mcp.json'` | `HOME, '.cursor', 'mcp.json'` | `USERPROFILE` / `HOME` |
| gemini | mcpServers | `USERPROFILE, '.gemini', 'settings.json'` | `HOME, '.gemini', 'settings.json'` | `USERPROFILE` / `HOME` |
| vscode | vscode | `USERPROFILE, '.vscode', 'mcp.json'` | `HOME, '.vscode', 'mcp.json'` | `USERPROFILE` / `HOME` |
| opencode | opencode | `USERPROFILE, '.config','opencode','opencode.json'` | `HOME, '.config','opencode','opencode.json'` | `USERPROFILE` / `HOME` |
| codex | codex-toml | `USERPROFILE, '.codex', 'config.toml'` | `HOME, '.codex', 'config.toml'` | `USERPROFILE` / `HOME` |

Missing env var ⇒ `resolvePath` returns `undefined` ⇒ row `skipped` (never throws). Claude Code is the ONLY `%APPDATA%` row; all others are `%USERPROFILE%`-rooted on win32, `HOME` on posix. A shared `homeRoot(platform, env)` helper centralizes the `USERPROFILE`/`HOME` choice; Claude keeps its own resolver.

### Entry shapes per format (idempotency = "this exact entry already present")

```jsonc
// mcpServers  → config.mcpServers["dbgraph-mcp"]
{ "command": "npx", "args": ["-y","dbgraph-mcp"] }
// vscode      → config.servers["dbgraph-mcp"]
{ "type": "stdio", "command": "npx", "args": ["-y","dbgraph-mcp"] }
// opencode    → config.mcp["dbgraph-mcp"]   (command is an ARRAY; no args)
{ "type": "local", "command": ["npx","-y","dbgraph-mcp"] }
```

```toml
# codex-toml → fixed block; deterministic render; file ends with one trailing \n
[mcp_servers.dbgraph-mcp]
command = "npx"
args = ["-y", "dbgraph-mcp"]
```

### Codex TOML micro-writer (bounded — NOT a parser)

- **Detect**: scan lines for the header `[mcp_servers.dbgraph-mcp]`; the block runs until the next line matching `/^\s*\[/` or EOF.
- **merge**: block absent ⇒ append `RENDER` (ensure exactly one blank line before if file non-empty, single trailing `\n`); block present & byte-equal to `RENDER` ⇒ return `content` unchanged (idempotent); present & differing ⇒ replace the block region with `RENDER`. Rest of file preserved verbatim.
- **remove**: block absent ⇒ return `content`; present ⇒ delete the header→block-end region, collapse a resulting double blank line, keep trailing `\n`. Other `[mcp_servers.*]` blocks untouched.
- **RENDER** = the fixed 3 lines above, args serialized as `["-y", "dbgraph-mcp"]` (single space after comma). Deterministic, stable ordering (`command` then `args`).

## Data Flow

```
runInstall(options)
   │  for each row in AGENT_TABLE:
   ▼
 resolvePath(platform,env) ─ undefined ─▶ skipped
   │ path
   ▼
 fs.exists(path)? ── no ─▶ absent (agent not installed)
   │ yes
   ▼
 raw = fs.readFile(path)            (catch parse error → treat as empty per format)
   │
   ▼
 next = remove ? row.remove(raw) : row.merge(raw, DEFAULT_MCP_ENTRY)
   │
   ├─ next === raw ─▶ already (install) | absent (remove)   [no write]
   └─ changed ─────▶ fs.writeFile(path, next) ─▶ installed | removed
                                   │
   results[] ──────────────────────┘
   ▼
 if every result ∈ {skipped, absent}  → write(MANUAL_SNIPPET)   (US-024 fallback)
 else                                 → write per-agent summary
 return { type: 'success' }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Modify | Add `AgentDescriptor`/`AgentFormat`/`AgentResult` types, `AGENT_TABLE`, `homeRoot` helper, `mergeVsCodeConfig`/`removeVsCodeConfig`, `mergeOpenCodeConfig`/`removeOpenCodeConfig`, `mergeCodexToml`/`removeCodexToml`; rewrap `runInstall` body into the table loop + summary; extend `MANUAL_SNIPPET` to name supported agents. Keep `resolveConfigPath`, `mergeMcpConfig`, `removeMcpConfig`, `InstallOptions`, `InstallOutcome` exported and unchanged |
| `test/cli/commands/install.test.ts` | Modify | Add per-agent × {win32, posix} path assertions and per-writer merge/remove/idempotency suites via the existing `makeFakeFs` |
| `src/cli/dispatch.ts` | Unchanged | `handleInstall` contract preserved |
| `docs/stories/07-quality-publication.md` | Modify | Refine US-038 notes (6 agents, paths, three-writer split, in-house TOML, one-row contract) |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit (path) | Each row × {win32, posix} resolves to the EXACT pinned string; missing env var ⇒ `undefined` | Call `row.resolvePath` directly; EXACT-string assert (L-009); win uses `\\`, posix `/` |
| Unit (writers) | Per format: fresh-install adds the exact entry; idempotent re-run returns input ref/text (no dup); `--remove` deletes ONLY `dbgraph-mcp` (planted "other" entry/block preserved); VS Code lands under `servers` and NOT `mcpServers`; opencode `command` is an ARRAY; Codex exactly one `[mcp_servers.dbgraph-mcp]` after re-run | Pure-function calls; EXACT-set assertions |
| Integration (`runInstall`) | Per agent × {win32, posix}: existing config → write exact bytes; absent file → `absent` skip; idempotent re-run → no write; `--remove` → removes only dbgraph entry; ALL absent/skipped → `MANUAL_SNIPPET`; Claude Code regression (US-024 unchanged) | Existing `makeFakeFs` + injected `platform`/`env`; assert `written[path]` bytes and summary text; no real FS |

RED→GREEN per batch; every assertion EXACT-set (L-009); all FS-free, green on Windows, no CI.

## Migration / Rollout

No data migration. Additive within one file; rollback = revert `install.ts` + test to the shipped single-agent form (dispatch never changed, no dep to drop).

## Batch Ordering (apply)

1. **A** — `AgentDescriptor` types + `AGENT_TABLE` scaffold + `homeRoot`; Cursor + Gemini rows (reuse `mergeMcpConfig`/`removeMcpConfig`); refactor `runInstall` into the multi-pass loop + per-agent results + summary + manual fallback; Claude Code regression. (Largest batch — it carries the loop refactor; the existing Claude tests guard it.)
2. **B** — `mergeVsCodeConfig`/`removeVsCodeConfig` + VS Code row; `servers`-vs-`mcpServers` test.
3. **C** — `mergeOpenCodeConfig`/`removeOpenCodeConfig` + opencode row; array-command test.
4. **D** — `mergeCodexToml`/`removeCodexToml` micro-writer + codex row; insert/idempotent/remove/path tests.
5. **E** — `MANUAL_SNIPPET` wording + summary polish + US-038 story note (one-row-per-agent contract).

## Open Questions

- [ ] Summary line format/wording (per-agent `id → action`) — cosmetic, finalize in Batch E; does not block tasks.
