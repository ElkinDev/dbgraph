# Tasks: Public documentation set + `install --project` scope (phase-7-docs)

Standing header (every task): TWO natures. **Batch 1 is CODE — STRICT TDD** (RED→GREEN→refactor; the failing
`vitest` test PRECEDES the code). EXTEND `src/cli/commands/install.ts` IN PLACE — KEEP `FsSeam`/`makeFakeFs`,
`AGENT_TABLE` rows, `resolveConfigPath`, `mergeMcpConfig`/`removeMcpConfig`, `mergeVsCodeConfig`/`mergeOpenCodeConfig`,
`CODEX_RENDER`/`mergeCodexToml`/`removeCodexToml`, and the `InstallOptions`/`InstallOutcome` SHAPE unchanged; the
GLOBAL (no-flag) path MUST stay byte-identical to today (the shipped install suites are the regression net and MUST
stay green at every step). All units are FS-free via `makeFakeFs` + INJECTED `platform` + INJECTED `cwd` seam — NO
real filesystem, green on Windows, NO CI. EXACT / golden-pinned assertions (`.toBe`/`.toStrictEqual`); existence-only
`.toBeDefined()` is FORBIDDEN. **Batches 2–4 are DOCS — NOT vitest-TDD.** HONESTY gate: every factual claim is
TRANSCRIBED from a canonical spec/test/script — NEVER memory; each doc task NAMES its evidence source; no aspirational
language; limitations stated inline. `unsupported` `AgentAction` is RETAINED as DORMANT machinery (no shipped agent
uses it as of 2026-07-06 — all 6, incl. Codex, have `projectPath`). Strict TS, NO `any`. Conventional commits (NO AI
attribution) referencing US-038; ENGLISH only. NO push / PR / gh / tags. Leak-scan hooks active
(`npm run hooks:install`) — denylist scan before EVERY commit; docs are synthetic/generic.

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions / Verification honesty):
- **All 6 agents SUPPORT project scope** (LIVE-verified 2026-07-06): Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`,
  VS Code `.vscode/mcp.json`, Gemini `.gemini/settings.json`, opencode `opencode.json`, Codex `.codex/config.toml`.
  Codex is INCLUDED (supersedes the proposal's earlier "Codex excluded / errors actionably" assumption — REFUTED).
- **Path encoding** (D1): OPTIONAL `readonly projectPath?: readonly string[]` per row + shared
  `resolveProjectConfigPath(platform, cwd, segs)` reusing `pathWin32.join`/`pathPosix.join`. Absent ⇒ no project scope
  (DORMANT — no shipped agent).
- **Flag** (D2): BOOLEAN long flag; `projectRoot = process.cwd()` via injected `cwd` seam. Add `'project'` to
  `BOOLEAN_LONG_FLAGS`.
- **Create-when-absent** (D3): project scope only — absent file → seed `raw=''` → the shipped `merge*Text('')` emits the
  minimal valid doc → `writeFile`. ZERO new writer code. GLOBAL stays `absent ⇒ never create` (D4).
- **Codex** (D5): `projectPath=['.codex','config.toml']`; reuse `mergeCodexToml` (same bytes as global); the codex
  summary line carries a trust-caveat suffix VERBATIM.
- **`--remove --project`** (D6): absent → `absent` (NEVER create on remove); present → drop only the `dbgraph-mcp`
  entry/block, leave VALID structure, NEVER delete the file.

Per-batch GATE (ALL must pass before the next batch): `npx tsc --noEmit` clean (strict, no `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) GREEN (baseline 2907, no binary/smoke needed) · leak-scan clean.
Batch 1 adds RED→GREEN proof + the shipped install suites UNCHANGED-green. Batches 2–4 additionally run the DOCS-VERIFY
checklist (design §Testing Strategy "Docs verify"): (a) every matrix cell / capability claim carries a spec citation;
(b) content-free CLI examples RUN (`--help`, `--version`, `doctor`); (c) no-overclaim grep (`download`, `release`,
`stable`, `Phase 0`) absent or qualified; (d) leak-scan clean; (e) troubleshooting cites ONLY F-1..F-7. Commit EACH
batch with a conventional-commit message (local only — nothing pushed past `closeout`).

## Batch 1: `install --project` scope (args flag + `projectPath` rows + `resolveProjectConfigPath` + `runInstall` project branch + banner)

> Satisfies `mcp-server` ADDED "dbgraph install --project scopes agent config to the project directory" (ALL 7
> scenarios) and `cli-config` MODIFIED banner (all 3 scenarios). CODE + strict TDD. Global (no-flag) path stays
> byte-identical (D4); `--project` is a scoped, opt-in departure (create-when-absent, D3). Lands the ONE code change
> the docs depend on, FIRST — so README/CONTRIBUTING/SECURITY document real behavior, not intent.

- [x] 1.1 RED→GREEN `test/cli/parse/args.test.ts` (extend) + `src/cli/parse/args.ts`: add `'project'` to
  `BOOLEAN_LONG_FLAGS`. RED first: assert `parseArgv(['install','--project','--remove']).flags['project'] === true`
  AND `flags['remove'] === true` (proves `--project` does NOT greedily consume the next token; `--remove` still works).
  Design Decision #2. Done: `npm test args`.
- [x] 1.2 RED→GREEN `test/cli/commands/install.test.ts` (extend) + `src/cli/commands/install.ts`: add
  `resolveProjectConfigPath(platform: string, cwd: string, segs: readonly string[]): string` — `pathWin32.join` on
  win32, `pathPosix.join` on posix (NEVER the host `join`). Assert ALL 6 rows × {win32, posix} to EXACT pinned strings
  from `cwd`: claude `<cwd>/.mcp.json`, cursor `<cwd>/.cursor/mcp.json`, vscode `<cwd>/.vscode/mcp.json`, gemini
  `<cwd>/.gemini/settings.json`, opencode `<cwd>/opencode.json`, codex `<cwd>/.codex/config.toml` (+ win32 backslash
  variants). Design §Testing Strategy "Unit (paths)"; Decision #1. Done: `npm test install`.
- [x] 1.3 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts`: add
  `readonly projectPath?: readonly string[]` to `AgentDescriptor` and populate ALL 6 rows per the per-agent matrix
  (claude `['.mcp.json']`, cursor `['.cursor','mcp.json']`, vscode `['.vscode','mcp.json']`, gemini
  `['.gemini','settings.json']`, opencode `['opencode.json']`, codex `['.codex','config.toml']`); add
  `readonly project?: boolean` + `readonly cwd?: string` to `InstallOptions`; RETAIN `'unsupported'` in the
  `AgentAction` union (dormant). Assert the typed row literals compile and each row's `projectPath` equals its pinned
  segments. Design §Interfaces + per-agent matrix. Done: `npx tsc --noEmit`; `npm test install`.
- [x] 1.4 RED→GREEN `test/cli/commands/install.test.ts` + `src/cli/commands/install.ts` `runInstall` project branch —
  CREATE-WHEN-ABSENT (supported JSON agent): inject `cwd` + `project:true`; GIVEN no `<cwd>/.cursor/mcp.json`, THEN the
  file is CREATED containing EXACTLY `mcpServers.dbgraph-mcp = { "command":"npx", "args":["-y","dbgraph-mcp"] }`
  serialized as 2-space JSON with a single trailing `\n` (assert `written[path]` bytes). `mcp-server` scenario
  "--project creates an absent project file for a supported agent"; Decision #3. Done: `npm test install`.
- [x] 1.5 RED→GREEN `test/cli/commands/install.test.ts`: idempotent merge + preserve unrelated keys. GIVEN
  `<cwd>/.cursor/mcp.json` already has `mcpServers.other` + top-level `"foo":1`, WHEN `--project` runs, THEN
  `mcpServers.dbgraph-mcp` is added, `mcpServers.other` and `foo` are preserved, and RE-RUNNING writes nothing
  (`next === raw`, byte-identical). `mcp-server` scenario "--project merges idempotently and preserves unrelated keys".
  Done: `npm test install`.
- [x] 1.6 RED→GREEN `test/cli/commands/install.test.ts`: Codex project branch + trust caveat. GIVEN no
  `<cwd>/.codex/config.toml`, WHEN `--project` runs, THEN it is CREATED via the SAME `mergeCodexToml` writer with EXACT
  bytes `[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]\n` (single trailing `\n`), the codex
  summary line reads VERBATIM `codex → written (requires trusted project: set trust_level in ~/.codex/config.toml)`, and
  the command exits 0. `mcp-server` scenario "--project creates an absent Codex config with the exact TOML bytes and a
  trust-caveat suffix"; Decision #5. Done: `npm test install`.
- [x] 1.7 RED→GREEN `test/cli/commands/install.test.ts`: `--remove --project` symmetry (NEVER delete). (a) GIVEN
  `<cwd>/.cursor/mcp.json` contains ONLY `mcpServers.dbgraph-mcp`, WHEN `--remove --project` runs, THEN the file REMAINS
  on disk as valid JSON `{}` + single trailing `\n` (emptied key dropped) and is NOT deleted. (b) GIVEN no such file,
  `--remove --project` creates nothing, writes nothing, exits 0. `mcp-server` scenarios "--remove --project deletes only
  the entry and leaves a valid file, never deleting it" + "--remove --project on an absent file is a no-op"; Decision #6.
  Done: `npm test install`.
- [x] 1.8 RED→GREEN `test/cli/commands/install.test.ts`: env-indirection preservation + DORMANT `unsupported`. (a) GIVEN
  `<cwd>/.cursor/mcp.json` has another entry whose args include `"${env:DB_PASSWORD}"`, WHEN `--project` runs, THEN that
  string is preserved byte-for-byte and NEVER expanded (`mcp-server` scenario "--project preserves ${env:VAR}
  indirection verbatim"). (b) via a SYNTHETIC row with NO `projectPath`, WHEN `--project` runs, THEN it is reported
  `→ not supported with --project`, no path is invented, no file is written, exit 0 (`mcp-server` scenario "A future
  unverified agent is excluded, never guessed"). Done: `npm test install`.
- [x] 1.9 RED→GREEN `test/cli/commands/install.test.ts`: GLOBAL regression — WHEN `--project` is ABSENT, behavior is
  byte-identical to shipped (absent stays `absent`, NEVER create); the existing Claude Code / 6-agent install suites
  pass UNCHANGED. Design §Testing Strategy "Unit (global regression)"; Decision #4. Done: `npm test install`.
- [x] 1.10 RED→GREEN `test/cli/dispatch.test.ts` + `src/cli/dispatch.ts` AND `test/cli/cli.test.ts` + `src/cli/cli.ts`:
  (a) `handleInstall` reads `flags['project']` and passes `project` (+ default `cwd`) to `runInstall`; extend
  `MANUAL_SNIPPET`/summary for `--project`. (b) Pin `USAGE_TEXT` install line to EXACTLY
  `  install   Wire dbgraph-mcp into supported MCP agents (--project for project scope, --remove to undo)` (two leading
  spaces, `install`, three spaces); assert it stays multi-agent (NO "Claude Desktop", consistent with `MANUAL_SNIPPET`)
  so dropping the `--project` mention FAILS the build. `cli-config` scenarios "install banner line describes the
  multi-agent reality", "install banner line documents the --project flag with the exact text", "Banner agent wording
  stays consistent with install's source of truth". Done: `npm test dispatch cli`.
- [x] 1.11 GATE (Batch 1): `npx tsc --noEmit` clean (no `any`); `npm run lint` 0/0; `npm test` green (baseline 2907 +
  new project suites) INCLUDING the shipped install suites UNCHANGED (global path byte-identical); leak-scan clean.
  Commit `feat(install): add --project scope for project-rooted agent config (US-038)`.

## Batch 2: `README.md` REWRITE (what/why + feature matrix + quickstart + CLI ref + MCP install + troubleshooting + limitations)

> Satisfies the proposal's README success criteria. DOCS (not TDD). DROP the false "Phase 0 / do not use" line and
> "Planned engine support"; KEEP the Vision bullets + MIT. EVERY claim slot below names its evidence source (design
> §Doc content architecture); HONESTY gate — no marketing, limitations inline.

- [x] 2.1 Rewrite `README.md` header + what/why (codegraph-for-databases, MCP-served, 100% local); KEEP surviving Vision
  bullets + MIT; DELETE "pre-alpha/Phase 0/do not use" + "Planned engine support". Evidence: `mcp-server` spec Purpose;
  surviving README Vision bullets. Design skeleton row 1.
- [x] 2.2 Add the FEATURE MATRIX (engines × capabilities: tables/cols, views, indexes, constraints/FKs, procs/functions,
  triggers, inferred rels, connectivity) with a PER-CELL spec citation. Evidence PER CELL:
  `sqlite/mssql/pg/mysql/mongodb-extraction` + `schema-extraction`; inference cells → `graph-model`/`graph-normalization`;
  SQLite=no procs and MongoDB=no triggers → `cli-config` spec. Design skeleton row 2 + Decision #8. NO cell without a
  citation.
- [x] 2.3 Add QUICKSTART FROM SOURCE (`npm ci` → `init` → `sync` → `query`); phrase binaries as "from source today,
  standalone binaries at v1.0". Evidence: `package.json` scripts; `cli-config` spec (init/sync/query requirements).
  Design skeleton row 3.
- [x] 2.4 Add the CLI REFERENCE summary (9 commands: init, sync, query, explore, affected, diff, status, doctor,
  install; `--json`, `--quiet`). Evidence: `cli.ts` `USAGE_TEXT`; `dispatch.ts` COMMAND_TABLE; `cli-config` spec.
  Design skeleton row 4.
- [x] 2.5 Add the MCP INSTALL section (6 agents + `--project` scope incl. Codex + the Codex trust caveat) AND the
  per-agent env-interpolation nuances table (claude `${VAR}`; cursor `${env:VAR}`; vscode `${env:VAR}`+`inputs`; gemini
  `$VAR`/`${VAR}`; opencode `{env:VAR}`; codex TOML env tables — no interpolation). Evidence: `mcp-server` install
  requirement; `install.ts` `MANUAL_SNIPPET`; THIS phase (Batch 1); design env-interpolation table. Design skeleton row 5.
- [x] 2.6 Add TROUBLESHOOTING (symptom → REAL doctor field → shipped fix), citing ONLY F-1..F-7: F-1 `cliTools`/
  `chosenStrategy` → install `sqlcmd`; F-2 `resolvedProfile` variant; F-3 legacy profile; F-4 output-shape; F-5 encoding
  (UTF-8 codepage); F-6 actionable error (not stack trace); F-7 routed to CONTRIBUTING/Limitations. Evidence:
  `connectivity-environments.md` F-1..F-7; `connectivity` + `connectivity-diagnostics` specs; `doctor.ts` `DoctorView`
  fields. Design skeleton row 6 + troubleshooting mapping table.
- [x] 2.7 Add LIMITATIONS (no published release, v0.0.0; MongoDB STRUCTURAL `$sample`, sampled values never persisted;
  inferred relationships OPT-IN; SQL Server integrated-auth needs `sqlcmd`; sqlcmd CI gap). Evidence: `binary-distribution`
  spec (release.yml never fired, v0.0.0); `cli-config` spec L41-42 + `mongodb-extraction`; `graph-normalization`;
  `connectivity` spec; F-7. Design skeleton row 7.
- [x] 2.8 GATE (Batch 2 — docs verify): claims↔citations audit (every matrix cell + capability line cites a spec);
  no-overclaim grep (`download`, `release`, `stable`, `Phase 0`) absent or qualified; troubleshooting cites ONLY
  F-1..F-7; content-free CLI examples (`--help`, `--version`, `doctor`) run copy-paste; leak-scan clean; `tsc`/`lint`/
  `test` still green. Commit `docs(readme): rewrite for shipped reality (matrix, quickstart, MCP, troubleshooting, limitations)`.

## Batch 3: `CONTRIBUTING.md` + `SECURITY.md`

> Satisfies the proposal's CONTRIBUTING + SECURITY success criteria. DOCS. Each claim cites its evidence source (design
> §Doc content architecture).

- [ ] 3.1 Create `CONTRIBUTING.md`: setup (`npm ci`); per-batch GATE (`build`=tsc-strict, `lint` 0/0, `test`=vitest);
  strict TDD (RED→GREEN test headers); openspec SDD cycle (`openspec/` proposal→spec→design→tasks→apply→verify→archive);
  conventional commits; `npm run hooks:install` (leak-scan); TEST TIERS (`test` unit / `test:integration`
  Docker-testcontainers / `smoke:binary` — SEPARATE from `npm test`); branch convention. Evidence: `package.json`
  scripts; `openspec/` tree; `binary-distribution` spec (smoke); F-7 (opt-in sqlcmd CI lane). Design CONTRIBUTING skeleton.
- [ ] 3.2 Create `SECURITY.md`: read-only-by-construction (`cli-config` "Read-only INVIOLABLE"; `mcp-server` read-only);
  `${env:VAR}` indirection, plaintext rejected (`cli-config` plaintext requirement); sampled values never persisted
  (`cli-config` L41-42; `mongodb-extraction`); content-free diagnostics (`connectivity-diagnostics` doctor requirement);
  local-only storage (`graph-storage`); private disclosure (simple — `package.json` `private:true`). Design SECURITY
  skeleton.
- [ ] 3.3 GATE (Batch 3 — docs verify): each CONTRIBUTING/SECURITY claim cites its spec; no-overclaim grep clean;
  leak-scan clean; `tsc`/`lint`/`test` green. Commit `docs: add CONTRIBUTING and SECURITY`.

## Batch 4: `.github/` issue + PR templates + FINAL doc-claims verification gate

> Satisfies the proposal's `.github` success criteria and the phase-wide honesty gate. DOCS. Bug template's `dbgraph
> doctor` request is content-free BY SPEC (safe to paste) — that is the whole point. Final batch runs the FULL
> doc-claims verification checklist (design §Testing Strategy "Docs verify").

- [ ] 4.1 Create `.github/ISSUE_TEMPLATE/bug_report.md` (or `.yml`): asks for `dbgraph doctor` output (content-free
  GUARANTEED by the `connectivity-diagnostics` doctor requirement — safe to paste) + version/OS/engine/repro. Design
  `.github` skeleton.
- [ ] 4.2 Create `.github/ISSUE_TEMPLATE/feature_request.md` (or `.yml`): problem / proposal / alternatives. Design
  `.github` skeleton.
- [ ] 4.3 Create `.github/PULL_REQUEST_TEMPLATE.md`: gate checklist (`tsc` / `lint` / `vitest`) + SDD checklist +
  leak-scan + conventional-commit confirmation. Design `.github` skeleton.
- [ ] 4.4 FINAL GATE (Batch 4) + doc-claims verification checklist (design §Testing Strategy "Docs verify"): (a) every
  matrix cell / capability claim has a spec citation; (b) copy-paste CLI examples RUN — auto-smoke the content-free
  subset (`--help`, `--version`, `doctor`), MANUAL checklist for `init`/`sync`/`query` against the SQLite torture
  fixture; (c) no-overclaim grep (`download`, `release`, `stable`, `Phase 0`) absent or qualified; (d) leak-scan clean;
  (e) troubleshooting cites ONLY F-1..F-7. `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green. Commit
  `docs(github): add issue and PR templates`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 1** (1.1–1.11): CODE — `parse/args.ts` (`--project` long flag) + `install.ts` (`projectPath` rows,
  `resolveProjectConfigPath`, `project`/`cwd` in `InstallOptions`, `runInstall` project branch with create-when-absent /
  idempotent merge / `--remove` never-delete / Codex trust-caveat, extended `MANUAL_SNIPPET`) + `dispatch.ts`
  (`handleInstall` passes `project`) + `cli.ts` (`USAGE_TEXT` banner). Strict TDD; the load-bearing code batch.
- **Batch 2** (2.1–2.8): DOCS — `README.md` REWRITE (header, feature matrix with per-cell citations, quickstart, CLI
  reference, MCP install + env-interpolation table, troubleshooting F-1..F-7, limitations).
- **Batch 3** (3.1–3.3): DOCS — `CONTRIBUTING.md` + `SECURITY.md`.
- **Batch 4** (4.1–4.4): DOCS — `.github/ISSUE_TEMPLATE/bug_report`, `feature_request`, `PULL_REQUEST_TEMPLATE.md`;
  final doc-claims verification gate.

### Dependency bottlenecks

- **Batch 1 gates Batch 2.** README's MCP-install section (2.5) documents `--project` and the Codex trust caveat against
  REAL behavior; if Batch 1 changes the banner text or the codex summary suffix, 2.4/2.5 inherit those exact strings.
  Docs-first-then-code is INVERTED here deliberately (proposal §Recommended Ordering) so no doc claim is aspirational.
- **1.3 (`AgentDescriptor.projectPath` + `InstallOptions.project/cwd`) gates 1.4–1.10.** The row field + option shape is
  the scaffold every project-branch behavior plugs into; land it before the behavior tasks.
- **1.6 Codex + 1.10 banner carry LOAD-BEARING verbatim strings** — the trust-caveat summary line and the `USAGE_TEXT`
  install line are pinned EXACTLY by `mcp-server`/`cli-config` scenarios; a single-character drift fails the build (that
  is the intent — the pin guards the docs' quoted text in Batch 2).
- **Global regression (1.9) is the no-CI safety net.** With no CI, an accidental change to the global (no-flag) path
  would ship undetected; 1.9 + the unchanged shipped install suites are the only guard that `--project` stayed scoped.
- **Batches 2, 3, 4 are DOCS-only and mutually independent** once Batch 1 lands — they touch disjoint files and could be
  parallelized. Sequential 2→3→4 is the safe default; the FINAL doc-claims verification (4.4) MUST run after all docs
  exist (it audits README + CONTRIBUTING + SECURITY + templates together).
- **Doc-claims verification is the docs' substitute for TDD.** There is no failing test for prose; the encoded gate
  (claims↔citations, no-overclaim grep, F-1..F-7 only, content-free examples run, leak-scan) is what makes a doc claim
  falsifiable. A claim without a cited spec source is a HARD STOP — remove it or find the source.

## Definition of Done (tied to the proposal's Success Criteria)

- [ ] `README.md` no longer claims "Phase 0 / do not use"; every feature-matrix cell traces to a canonical spec;
  binaries described as source-only until v1.0. — Batch 2 (2.1, 2.2, 2.3, 2.7)
- [ ] README has TROUBLESHOOTING (real F-1..F-7 breaks + shipped remedies) and a Limitations section (MongoDB structural
  `$sample`, opt-in inference, no published release). — Batch 2 (2.6, 2.7)
- [ ] `CONTRIBUTING.md` documents the gate, strict TDD, SDD cycle, `hooks:install`, and the three test tiers. — Batch 3 (3.1)
- [ ] `SECURITY.md` states the read-only / env-indirection / content-free posture + private disclosure. — Batch 3 (3.2)
- [ ] `.github/` bug template requests content-free `dbgraph doctor` output; feature + PR templates present. — Batch 4 (4.1, 4.2, 4.3)
- [ ] `install --project` writes project-scoped config for ALL 6 verified agents (incl. Codex `.codex/config.toml` with
  the trust-caveat suffix — SUPERSEDES the proposal's earlier "Codex excluded / errors actionably" assumption), CREATES
  absent project files, keeps the `unsupported` path DORMANT for future unverifiable agents; global (no-flag) behavior
  UNCHANGED; `--remove --project` mirrors it (never deletes files). — Batch 1 (1.4–1.10)
- [ ] `mcp-server` (7 scenarios) + `cli-config` (banner, 3 scenarios) deltas are satisfied; `npx tsc --noEmit` strict +
  `npm run lint` 0/0 + `npm test` clean (baseline 2907); leak-scan clean across all batches. — Batch 1 (1.11) + every batch GATE
