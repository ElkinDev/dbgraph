# Design: Public documentation set + `install --project` scope (phase-7-docs)

## Technical Approach

Two independent areas behind ONE proposal. **Area 1** EXTENDS `src/cli/commands/install.ts` in place: the shipped
`AGENT_TABLE` rows gain an OPTIONAL `projectPath` (relative segments from CWD) alongside the existing homeRoot
`resolvePath`; `runInstall` gains a `project` scope branch that re-roots resolution at the project dir and — for
project scope ONLY — CREATES absent config files (a deliberate departure from global skip-if-absent). Writers, the
`FsSeam`, `InstallOptions`/`InstallOutcome` outcome shape, and the global (no-flag) path stay byte-identical, so
`dispatch.ts` needs a two-line change and rollback = drop the flag branch. **Area 2** authors docs whose every
factual claim is transcribed from a canonical spec/test/script — never memory — with limitations stated inline.
No `openspec/specs/<name>/spec.md` is created for README/CONTRIBUTING/SECURITY/`.github` (they are project docs,
not capabilities); only `mcp-server` and `cli-config` receive deltas for `--project`.

## Verification honesty (per-agent matrix)

UPDATE 2026-07-06 — the verification gap is CLOSED. All six per-agent PROJECT paths below were re-confirmed against
LIVE official docs, superseding the earlier January-2026 training-knowledge caveat. All 6/6 agents support a
project-scoped MCP config, INCLUDING Codex (previously ASSUMED to have none — that assumption is REFUTED). Sources:
- Claude Code — https://code.claude.com/docs/en/mcp
- Cursor — https://cursor.com/docs/context/mcp
- VS Code — https://code.visualstudio.com/docs/copilot/chat/mcp-servers
- Gemini CLI — https://github.com/google-gemini/gemini-cli (docs/tools/mcp-server.md)
- opencode — https://opencode.ai/docs/mcp-servers
- Codex — https://developers.openai.com/codex/mcp + https://developers.openai.com/codex/config-basic + https://developers.openai.com/codex/config-advanced

Codex specifics: project-scoped `.codex/config.toml` uses TOML `[mcp_servers.<name>]` tables IDENTICAL to the global
`~/.codex/config.toml`; it is gated to TRUSTED projects only (trust set in the global config via
`[projects."<abs path>"] trust_level = "trusted"`); precedence is project-closest → project root → global; the
feature is recently added / version-gated. The exclusion path (ship user-global-only, never guess) REMAINS as
dormant machinery for any FUTURE agent whose project docs cannot be confirmed.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| 1 | Project path encoding | OPTIONAL `readonly projectPath?: readonly string[]` per row + shared `resolveProjectConfigPath(platform,cwd,segs)` | second `resolveProjectPath(cwd)` method per row; a `scope` field on every row | Static relative segments need no env/platform branching; absent ⇒ agent has no project scope (DORMANT — no shipped agent as of 2026-07-06; all 6 have `projectPath`); reuses `pathWin32/pathPosix.join` determinism (NO CI) |
| 2 | `--project` flag | BOOLEAN long flag; projectRoot = `process.cwd()` (injected `cwd` seam in tests) | `--project <dir>` value flag | Add `'project'` to `BOOLEAN_LONG_FLAGS`; matches proposal; no arg parsing churn (`--remove` still works via the trailing-boolean fallback) |
| 3 | Create-when-absent | Project scope: absent file → seed `raw=''` → `merge` yields minimal valid doc → `writeFile` (mkdir-recursive seam creates parent dirs) | pre-write an explicit skeleton per format | The shipped `merge*Text('')` already emits `{"mcpServers":{…}}` / `{"servers":{…}}` / `{"mcp":{…}}`; the minimal skeleton IS the merge-on-empty result — zero new code |
| 4 | Global unchanged | Global scope keeps `exists()==false ⇒ absent` (never create) | unify create semantics | Safety: global writes into user dotfiles; create-when-absent confined to opt-in `--project` |
| 5 | Codex under `--project` | INCLUDE: `projectPath=['.codex','config.toml']`; reuse `mergeCodexToml` against the project path (same writer/bytes as global); codex summary carries a trust-caveat suffix | EXCLUDE as `unsupported`; guess a path; silently skip | LIVE 2026-07-06 docs confirm project `.codex/config.toml` (`[mcp_servers.<name>]`, IDENTICAL to global), gated to TRUSTED projects — SUPERSEDES the Jan-2026 training caveat. `unsupported` action RETAINED as dormant machinery for future agents |
| 6 | `--remove --project` symmetry | Absent file → `absent` (NEVER create on remove); present → remove entry, leave VALID structure, NEVER delete the file (drops to `{}`/empty via existing key-drop) | delete files that emptied | Conservative: we can't know what the user added post-create; deleting risks data loss |
| 7 | Docs = no capability specs | Only `mcp-server` + `cli-config` deltas | new spec files for README/etc. | Project docs are not openspec capabilities (proposal); avoids fake spec surface |
| 8 | Feature matrix source | Per-CELL citation to the engine extraction spec (+ `schema-extraction`, inference specs) | prose descriptions from memory | HONESTY gate: every cell traceable; SQLite=no procs / MongoDB=no triggers pinned by `cli-config` spec |

## Interfaces / Contracts

```ts
// AgentDescriptor gains ONE optional field; existing fields unchanged
export interface AgentDescriptor {
  // …id, displayName, resolvePath, format, merge, remove (unchanged)…
  readonly projectPath?: readonly string[]; // segments from projectRoot; absent ⇒ no project scope
}
export type AgentAction =
  'installed' | 'already' | 'removed' | 'absent' | 'skipped' | 'unsupported';
  // 'unsupported' RETAINED as DORMANT machinery for future unverifiable agents;
  // as of 2026-07-06 NO shipped agent uses it (all 6, incl. Codex, have projectPath)

export interface InstallOptions {
  // …remove, fs, platform, env, write (unchanged)…
  readonly project?: boolean;  // true ⇒ project scope rooted at cwd
  readonly cwd?: string;       // injected seam; defaults to process.cwd()
}
```

### Per-agent project matrix (verify before merge — see honesty note)

| id | projectPath (rel. to CWD) | format family | entry shape (reuses shipped writer) | confidence (verified LIVE 2026-07-06) |
|----|---------------------------|---------------|--------------------------------------|-----------|
| claude-code | `.mcp.json` | mcpServers-JSON | `mcpServers.dbgraph-mcp={command,args}` | HIGH |
| cursor | `.cursor/mcp.json` | mcpServers-JSON | same | HIGH |
| vscode | `.vscode/mcp.json` | servers-JSON | `servers.dbgraph-mcp={type:'stdio',…}` | HIGH |
| gemini | `.gemini/settings.json` | mcpServers-JSON | same as claude | HIGH |
| opencode | `opencode.json` | mcp-JSON | `mcp.dbgraph-mcp={type:'local',command:[…]}` | HIGH |
| codex | `.codex/config.toml` | codex-TOML | `[mcp_servers.dbgraph-mcp]` via `mergeCodexToml` — TRUST-GATED (project must be trusted in `~/.codex/config.toml`) | HIGH — INCLUDED, supersedes prior verified-absent |

Minimal valid skeleton per JSON family = the merge-on-empty output. Codex's project file reuses the global
`mergeCodexToml` writer: absent ⇒ the fixed `CODEX_RENDER` block + single trailing `\n` (byte-identical to global).

### `runInstall` project branch (per row)

```
scope=project:
  projectPath undefined → unsupported; actionable line; continue   // DORMANT: no shipped agent hits this
  path = resolveProjectConfigPath(platform, cwd, projectPath)       // codex → <cwd>/.codex/config.toml
  exists? no  → remove ? absent (never create) : raw=''      // create-when-absent
          yes → raw = readFile (catch → '{}' | '')
  next = remove ? row.remove(raw) : row.merge(raw, ENTRY)    // codex: merge=mergeCodexToml (entry ignored)
  next===raw → already|absent   else → writeFile → installed|removed
  codex written → summary suffix ` (requires trusted project: set trust_level in ~/.codex/config.toml)`
scope=global: UNCHANGED (absent ⇒ absent, never create)
```

## Data Flow

```
handleInstall → runInstall({remove, project, fs, cwd})
   for row in AGENT_TABLE:
     project? ──yes──▶ projectPath? ──no──▶ unsupported (DORMANT — no shipped agent, exit 0)
        │                    │yes
        no                   ▼
        │            resolve(cwd,segs) ─ absent&!remove ─▶ raw='' (CREATE)
        ▼                    │
   resolvePath(env) ─ absent ─▶ absent(global) / create(project)
        └──────────── merge|remove ── next≠raw ─▶ writeFile ─▶ installed|removed
```

## Doc content architecture (Area 2 — skeleton + evidence per claim slot)

**README.md (REWRITE; DROP the false "Phase 0/do not use" line + "Planned engine support"; KEEP Vision bullets + MIT):**
| § | Claim slot | Evidence source |
|---|-----------|-----------------|
| Header / what-why | codegraph-for-databases, MCP-served, 100% local | `mcp-server` spec Purpose; surviving README Vision bullets |
| Feature matrix (engines × capabilities) | tables/cols, views, indexes, constraints/FKs, procs/functions, triggers, inferred rels, connectivity | PER CELL: `sqlite/mssql/pg/mysql/mongodb-extraction` spec + `schema-extraction`; inference cells → `graph-model`/`graph-normalization`; SQLite=no procs & MongoDB=no triggers → `cli-config` spec |
| Quickstart FROM SOURCE | `npm ci` → `init`/`sync`/`query` | `package.json` scripts; `cli-config` spec (init/sync/query reqs) |
| CLI reference (9 cmds; `--json`,`--quiet`) | init,sync,query,explore,affected,diff,status,doctor,install | `cli.ts USAGE_TEXT`; `dispatch.ts` COMMAND_TABLE; `cli-config` spec |
| MCP install (6 agents + `--project`) | agents, formats, project scope (6/6 incl. Codex), Codex trust caveat | `mcp-server` install requirement; `install.ts MANUAL_SNIPPET`; THIS phase |
| Troubleshooting | symptom → doctor field → fix (F-1..F-7 only) | `connectivity-environments.md` F-1..F-7; `connectivity` + `connectivity-diagnostics` specs; `doctor.ts` fields |
| Limitations | no published release (v0.0.0); MongoDB STRUCTURAL `$sample`, values never persisted; inference OPT-IN; SQL Server integrated needs `sqlcmd`; sqlcmd CI gap | `binary-distribution` spec (release.yml never fired, v0.0.0); `cli-config` spec L41-42 + `mongodb-extraction`; `graph-normalization`; `connectivity` spec; F-7 |

**Per-agent env-interpolation nuances (LIVE 2026-07-06 — DOC-content input for the README MCP config examples).**
The `dbgraph-mcp` entry itself uses NO interpolation (only `command`+`args`), but README examples MUST show each
agent's native env syntax, since a reader copying an example for a DIFFERENT server needs the right form:
| agent | project config file | key | env-var interpolation syntax |
|-------|--------------------|-----|------------------------------|
| claude-code | `.mcp.json` | `mcpServers` | `${VAR}` |
| cursor | `.cursor/mcp.json` | `mcpServers` | `${env:VAR}` |
| vscode | `.vscode/mcp.json` | `servers` (`type` optional; stdio/http) | `${env:VAR}` + `inputs` |
| gemini | `.gemini/settings.json` | `mcpServers` | `$VAR` / `${VAR}` |
| opencode | `opencode.json` | `mcp` (`type:local`, `command` ARRAY) | `{env:VAR}` |
| codex | `.codex/config.toml` | `[mcp_servers.<name>]` | TOML `env` tables — NO string interpolation |

**Troubleshooting mapping (symptom → diagnosis via a REAL doctor field → shipped fix):**
| Finding | Symptom | Doctor field (from `formatDoctor` `DoctorView`) | Fix |
|---------|---------|--------------------------------------------------|-----|
| F-1 | `sync` fails, integrated-only, tedious can't SSPI | `cliTools` (sqlcmd absent) / `chosenStrategy: unavailable` | install `sqlcmd`; dbgraph uses `sqlcmd -E` |
| F-2 | wrong sqlcmd flags/version | `resolvedProfile: variant@versionRange` | ensure a recognized variant; else report env |
| F-3 | truncated/failed FOR JSON on legacy | `resolvedProfile` (legacy) | dbgraph adapts flags per profile; report if unrecognized |
| F-4 | JSON parse fails at chunk boundary | `resolvedProfile` output-shape | recorded-fixtures path; report env |
| F-5 | non-ASCII corrupts JSON | `resolvedProfile` encoding | dbgraph forces UTF-8 codepage |
| F-6 | malformed/partial output | actionable error (what received, first N chars) — NOT stack trace | run `dbgraph doctor`, paste content-free report |
| F-7 | (project limitation, not user symptom) | — | routed to CONTRIBUTING test-tiers + Limitations (opt-in sqlcmd CI lane) |

**CONTRIBUTING.md:** setup (`npm ci`) · per-batch gate (`build`=tsc-strict, `lint` 0/0, `test`=vitest) · strict TDD (RED→GREEN test headers) · openspec SDD cycle (`openspec/` proposal→…→archive) · conventional commits · `npm run hooks:install` (leak-scan) · test tiers (`test` unit / `test:integration` Docker-testcontainers / `smoke:binary`) · branch convention. Evidence: `package.json` scripts; `openspec/` tree; `binary-distribution` spec (smoke); F-7 (sqlcmd lane).

**SECURITY.md:** read-only-by-construction (`cli-config` spec "Read-only INVIOLABLE"; `mcp-server` read-only) · `${env:VAR}` indirection, plaintext rejected (`cli-config` plaintext requirement) · sampled values never persisted (`cli-config` L41-42; `mongodb-extraction`) · content-free diagnostics (`connectivity-diagnostics` doctor req) · local-only storage (`graph-storage`) · private disclosure (simple; repo private per `package.json` `private:true`).

**.github:** `bug_report` asks for `dbgraph doctor` output — content-free GUARANTEED by `connectivity-diagnostics` doctor requirement (safe to paste) + version/OS/engine/repro. `feature_request` = problem/proposal/alternatives. `PULL_REQUEST_TEMPLATE.md` = gate checklist (tsc/lint/vitest) + SDD checklist + leak-scan + conventional-commit.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Modify | Add `projectPath?` to rows (6 supported incl. Codex `.codex/config.toml`); `resolveProjectConfigPath`; RETAIN `unsupported` action (dormant, future agents); `project`/`cwd` in `InstallOptions`; project branch (create-when-absent, remove-symmetry, Codex reuses `mergeCodexToml` + trust-caveat summary suffix) in `runInstall`; extend `MANUAL_SNIPPET`/summary for `--project` |
| `src/cli/parse/args.ts` | Modify | Add `'project'` to `BOOLEAN_LONG_FLAGS` |
| `src/cli/dispatch.ts` | Modify | `handleInstall` reads `flags['project']`, passes `project` to `runInstall` |
| `src/cli/cli.ts` | Modify | `USAGE_TEXT` install line mentions `--project` (banner-accuracy) |
| `test/cli/commands/install.test.ts` | Modify | `AgentAction` union now 6; project create/merge/remove suites (see matrix) |
| `openspec/specs/mcp-server/spec.md` | Modify (delta) | install requirement + scenarios: `--project` paths, create-when-absent, Codex unsupported, `--remove --project` |
| `openspec/specs/cli-config/spec.md` | Modify (delta) | banner describes `--project` |
| `README.md` | Rewrite | Skeleton above |
| `CONTRIBUTING.md`, `SECURITY.md` | Create | Skeletons above |
| `.github/ISSUE_TEMPLATE/bug_report.*`, `feature_request.*`, `.github/PULL_REQUEST_TEMPLATE.md` | Create | Templates above |

## Testing Strategy

| Layer | What to test | Approach |
|-------|-------------|----------|
| Unit (paths) | All 6 rows × {win32,posix}: `resolveProjectConfigPath(cwd,segs)` = exact pinned string, incl. Codex `<cwd>/.codex/config.toml`; dormant no-`projectPath` path covered by a synthetic row | EXACT-string assert via existing `makeFakeFs`/injected platform |
| Unit (create/merge/remove) | Project × supported agents: absent → file CREATED with exact minimal doc; present → entry merged idempotently; `--remove --project` deletes only dbgraph, leaves valid structure, never deletes file; absent+remove → no file created | Inject `cwd`+`project:true`; assert `written[path]` bytes |
| Unit (codex + trust) | `--project` → Codex `<cwd>/.codex/config.toml` CREATED with exact `CODEX_RENDER` bytes + single trailing `\n`, summary carries the trust-caveat suffix, exit 0; dormant `unsupported` path via a synthetic no-`projectPath` row | Assert `written[path]` bytes + summary text + no throw |
| Unit (global regression) | No `--project` → byte-identical to shipped (absent stays absent) | Existing suites unchanged |
| Unit (banner) | `USAGE_TEXT` install line mentions `--project`, stays multi-agent | Pin per `cli-config` banner requirement |
| Docs verify | (a) every matrix cell / capability claim has a spec citation; (b) copy-paste CLI examples RUN — auto-smoke the content-free subset (`--help`,`--version`,`doctor`), MANUAL checklist for `init`/`sync`/`query` against the SQLite torture fixture; (c) no-overclaim grep (`download`,`release`,`stable`,`Phase 0`) absent/qualified; (d) leak-scan clean; (e) troubleshooting cites ONLY F-1..F-7 | verify phase |

## Migration / Rollout

No data migration. Additive within `install.ts` behind a new flag; flag absent ⇒ byte-identical to today. Docs are
additive/replacement files touching no `src/` runtime. Rollback = remove the flag branch + spec deltas; restore old
README + delete new docs.

## Open Questions

- [x] **Re-verified all 6 project paths against LIVE official docs 2026-07-06** (was 5 verified + Codex-excluded; Codex now INCLUDED via project `.codex/config.toml`, trust-gated). Verification gap CLOSED — see Verification honesty for the 8 source URLs.
- [ ] `--project` creates config for ALL 6 supported agents (proposal ratifies create-all; may drop 6 files in a repo). `--agent <name>` filtering DEFERRED (as in 9.5a). Confirm acceptable or scope a follow-up.
- [ ] Add `'remove'` to `BOOLEAN_LONG_FLAGS` too? Works today via trailing-boolean fallback; explicit add is more robust — cosmetic, tasks may decide.
- [ ] `--remove --project` leaves an empty `{}`/`{"servers":{}}`-free file (key dropped) rather than deleting — confirm the "never delete" conservative rule over "delete if we created it".
