# Proposal: Public documentation set + `install --project` scope (phase-7-docs)

## Intent

The repo has shipped 5 engines, inferred relationships, resilient connectivity, a 9-command CLI, an
MCP server, multi-agent `install`, and standalone binaries (15 canonical specs, 2907 tests) — yet the
root `README.md` still reads **"pre-alpha, under active development (Phase 0). Do not use yet"** and
lists the engines as *planned*. That is now FALSE and actively misleading. There is also NO
`CONTRIBUTING.md`, NO `SECURITY.md`, and NO `.github/` issue/PR templates, so a reader (the repo is
PRIVATE today) has no honest map of what exists, how to run it, how to report a problem, or the
security posture. This phase writes the public-facing documentation set — grounded ONLY in the specs
and tests (the source of truth) with limitations stated plainly — and lands the ONE ratified code
change the docs depend on: an `install --project` flag for project-scoped agent config.

## Scope

### In Scope
- **`README.md` (REWRITE, not update)**: the current 32-line stub is contradicted by shipped reality;
  replace it. Content: what/why (codegraph-for-databases); honest per-engine feature matrix derived
  from the canonical specs (NOT marketing); quickstart FROM SOURCE (`npm ci` → `init`/`sync`/`query`);
  CLI reference summary (init, sync, query, explore, affected, diff, status, doctor, install; `--json`,
  `--quiet`); MCP integration via `install` for the 6 agents; a **TROUBLESHOOTING** section mined from
  `docs/findings/connectivity-environments.md` (F-1..F-7) and the connectivity / connectivity-diagnostics
  specs for REAL failure modes + fixes; a **Limitations** section (no published binaries/release until
  v1.0; MongoDB is STRUCTURAL inference via `$sample`, sampled values never persisted; inferred
  relationships are OPT-IN; SQL Server integrated-auth needs `sqlcmd`).
- **`CONTRIBUTING.md`**: clone/setup, strict per-batch gate (`tsc` strict, lint 0/0, `vitest`), strict
  TDD, openspec SDD cycle, conventional commits, `npm run hooks:install` (leak-scan git hooks), test
  tiers (unit / integration-Docker / `npm run smoke:binary` separate from `npm test`), branch convention.
- **`SECURITY.md`**: read-only-by-construction posture, `${env:VAR}` secret indirection (never cleartext),
  sampled values never persisted, content-free diagnostics, local-only storage; private-disclosure
  instructions (kept simple — repo is private today).
- **`.github/ISSUE_TEMPLATE/`**: `bug_report` (asks for `dbgraph doctor` output — content-free BY SPEC,
  safe to paste; that is the whole point) + `feature_request`; and `PULL_REQUEST_TEMPLATE.md` (gate +
  SDD checklist).
- **`install --project` flag (the ONE code change)**: project-scoped agent config (e.g. `.mcp.json`,
  `.cursor/mcp.json`, `.vscode/mcp.json`) instead of today's user-global-only. Design/spec decides the
  exact project path + support matrix per agent (see Approach); agents without a project location error
  actionably.

### Out of Scope
- Publishing a release, pushing any tag, or making the repo public; docs sites / generated API docs.
- Benchmarks or performance claims (separate block); HTTP/SSE MCP transport.
- Any runtime change to extraction, query, or the MCP server — this phase is DOCS + one CLI flag only.

## Capabilities

### New Capabilities
- None. README/CONTRIBUTING/SECURITY/`.github` are project documentation, NOT openspec capabilities;
  they do not get `openspec/specs/<name>/spec.md` files.

### Modified Capabilities
- `mcp-server`: the `install` requirement ("dbgraph install idempotently wires the agent MCP config",
  ≥6 agents / three format families) gains a `--project` scope flag and project-scoped path resolution,
  including create-when-absent at project scope (a deliberate departure from user-global skip-if-absent).
- `cli-config`: the install help/usage banner requirement must describe `--project` (banner-accuracy).

## Approach

Docs first, code second. Every claim is verified against `openspec/specs/` and existing tests before it
is written — no aspirational language, limitations stated inline. The engine matrix is transcribed from
the five extraction specs (sqlite/mssql/pg/mysql/mongodb), not from memory. TROUBLESHOOTING maps each
real break to its shipped remedy: integrated-security / no SQL login → `sqlcmd -E` strategy (F-1);
sqlcmd variant/version/flag/encoding breaks → `dbgraph doctor` environment profile (F-2..F-6); a missing
DB driver → the error already NAMES the `install` command (per each engine spec); a connection failure →
a typed non-blocking outcome with ≥3 actionable options, never a stack trace.

For `install --project`: `AGENT_TABLE` today resolves every path under `homeRoot`. The flag re-roots
resolution at a project dir (default cwd) and writes the SAME per-agent format. Design must VERIFY each
agent's real project-config location (candidates: Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`,
VS Code `.vscode/mcp.json`, Gemini `.gemini/settings.json`, opencode `opencode.json`) and decide the
support set; **Codex** has no documented project-scoped MCP config → `--project` errors for it with an
actionable message (exit stays 0, US-024 spirit). The key semantic change: `runInstall` currently SKIPS
absent files (`absent`, never creates); project files usually don't exist, so `--project` must CREATE
them — a scoped, opt-in departure from the global behavior. `--remove --project` mirrors it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `README.md` | Modified (rewrite) | Replace the false "Phase 0 / do not use" stub with honest shipped reality + matrix + troubleshooting + limitations. |
| `CONTRIBUTING.md` | New | Setup, gate, TDD, SDD/openspec, `hooks:install`, test tiers, commit convention. |
| `SECURITY.md` | New | Security posture + private-disclosure instructions. |
| `.github/ISSUE_TEMPLATE/bug_report.*`, `feature_request.*` | New | Bug template requests content-free `dbgraph doctor` output. |
| `.github/PULL_REQUEST_TEMPLATE.md` | New | Gate + SDD checklist. |
| `src/cli/commands/install.ts` | Modified | `--project` scope: project-rooted paths, create-when-absent, per-agent support matrix, Codex unsupported. |
| `openspec/specs/mcp-server/spec.md` | Modified (delta) | `install` gains `--project` scope requirement/scenarios. |
| `openspec/specs/cli-config/spec.md` | Modified (delta) | install banner describes `--project`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Docs overclaim (marketing creep) — e.g. imply downloadable binaries or a release exist. | High | HONESTY gate: every capability line cites a spec; binaries phrased "from source today, standalone binaries at v1.0"; explicit Limitations section; verify pass before write. |
| Assumed project-config paths for the 6 agents are wrong (agents change locations). | Med | Design VERIFIES each path against current agent docs; unverified agents ship as user-global-only, not guessed. |
| `--project` create-when-absent diverges from the safe global skip-if-absent behavior. | Med | Confined to `--project`; global path unchanged; spec pins the create semantics + idempotent merge; unit tests via the `FsSeam`. |
| Codex has no project scope → silent surprise. | Low | `--project` errors actionably for Codex; documented in README + banner. |
| A project codename leaks into public-facing docs. | Med | Leak-scan hooks active; denylist scan before any commit; docs are synthetic/generic. |
| Troubleshooting cites the wrong finding IDs (task brief said F-1..F-9; the doc has F-1..F-7). | Low | Cite only the real F-1..F-7 that exist in the findings doc. |

## Rollback Plan

Docs are additive/replacement files — revert = restore the previous `README.md` and delete the new
docs/templates; nothing in `src/` runtime is touched by them. The `install --project` change is scoped
to `install.ts` behind a NEW flag: with the flag absent, behavior is byte-identical to today, so
reverting = removing the flag branch + its spec delta. No data, storage, or extraction path changes.

## Dependencies

- Specs + tests are the source of truth for every doc claim (read-only dependency, already present).
- `docs/findings/connectivity-environments.md` (F-1..F-7) for TROUBLESHOOTING remedies.
- `AGENT_TABLE` in `src/cli/commands/install.ts` for the `--project` path/format matrix.
- No CI, no network, no release dependency.

## Success Criteria

- [ ] `README.md` no longer claims "Phase 0 / do not use"; every feature-matrix cell traces to a canonical spec; binaries described as source-only until v1.0.
- [ ] README has TROUBLESHOOTING (real F-1..F-7 breaks + shipped remedies) and a Limitations section (MongoDB structural inference, opt-in inference, no published release).
- [ ] `CONTRIBUTING.md` documents the gate, strict TDD, SDD cycle, `hooks:install`, and the three test tiers.
- [ ] `SECURITY.md` states the read-only / env-indirection / content-free posture + private disclosure.
- [ ] `.github/` bug template requests content-free `dbgraph doctor` output; feature + PR templates present.
- [ ] `install --project` writes project-scoped config for the verified agents, creates absent project files, errors actionably for Codex; global (no-flag) behavior unchanged; `--remove --project` mirrors it.
- [ ] `mcp-server` + `cli-config` spec deltas cover `--project`; `tsc` strict + lint 0/0 + vitest clean; leak-scan clean.

## Recommended Apply Batch Ordering

1. `install --project` (`install.ts` + `mcp-server`/`cli-config` spec deltas + `FsSeam` unit tests) — so README can document the flag against real behavior.
2. `README.md` rewrite (matrix + quickstart + CLI ref + MCP install + TROUBLESHOOTING + Limitations).
3. `CONTRIBUTING.md` + `SECURITY.md`.
4. `.github/` issue/feature/PR templates; final leak-scan + strict-build gate.
