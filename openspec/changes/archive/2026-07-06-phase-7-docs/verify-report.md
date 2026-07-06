# Verification Report — phase-7-docs

**Change**: phase-7-docs (Public documentation set + `install --project` scope, US-038)
**Branch**: closeout · **Artifact store**: openspec
**Mode**: Strict TDD (Batch 1 code) + Docs-verify gate (Batches 2-4)
**Verdict**: PASS — 0 CRITICAL / 0 WARNING / 2 SUGGESTION

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 26 (Batch 1: 11 · Batch 2: 8 · Batch 3: 3 · Batch 4: 4) |
| Tasks complete [x] | 26 |
| Tasks incomplete [ ] | 0 |
| Definition of Done | 7/7 checked |

## Gate (run by the verifier)

| Check | Command | Result |
|-------|---------|--------|
| Type-check | npx tsc --noEmit | PASS exit 0 (strict, no any) |
| Lint | npm run lint (eslint .) | PASS exit 0, 0 errors / 0 warnings |
| Tests | npm test (vitest run) | PASS 2952 passed / 0 failed / 0 skipped, 172 files (baseline 2907 -> 2952) |
| Leak-scan | test/security/no-secret-leak.test.ts (in npm test) | PASS green |

## Spec Compliance Matrix (10 scenarios — all behaviorally proven)

| # | Requirement | Scenario | Test (exact-pinned) | Result |
|---|-------------|----------|---------------------|--------|
| 1 | mcp install --project | creates absent project file (Cursor) | install.test.ts F.4 posix/win32 absent .cursor/mcp.json CREATED -> EXPECTED_MCPSERVERS_DOC bytes | COMPLIANT |
| 2 | mcp install --project | merges idempotently, preserves unrelated keys | install.test.ts F.5 adds dbgraph-mcp, preserves other+foo / re-run writes nothing | COMPLIANT |
| 3 | mcp install --project | Codex create + exact TOML bytes + trust-caveat suffix | install.test.ts F.6 pinned bytes == mergeCodexToml empty / EXACT bytes / summary EXACTLY, exit 0 | COMPLIANT |
| 4 | mcp install --project | future unverified agent excluded, never guessed (dormant) | install.test.ts F.8(b) synthetic no-projectPath row -> "not supported with --project", no write | COMPLIANT |
| 5 | mcp install --remove --project | deletes only entry, leaves valid file, never deletes it | install.test.ts F.7(a) -> {} + trailing newline, seam.exists()===true | COMPLIANT |
| 6 | mcp install --remove --project | absent file is a no-op | install.test.ts F.7(b) -> 0 writes, exit 0 | COMPLIANT |
| 7 | mcp install --project | preserves env:VAR indirection verbatim | install.test.ts F.8(a) -> DB_PASSWORD ref preserved, cleartext absent | COMPLIANT |
| 8 | cli-config banner | describes multi-agent reality (no "Claude Desktop") | cli.test.ts contains('agents') + not.toContain('Claude Desktop') + live --help | COMPLIANT |
| 9 | cli-config banner | documents --project with the EXACT text | cli.test.ts:89 exact .toBe pinned install line + live --help | COMPLIANT |
| 10 | cli-config banner | wording consistent with install source of truth | cli.test.ts multi-agent + --project + --remove, no single-agent regression | COMPLIANT |

Compliance summary: 10/10 scenarios COMPLIANT.

## Adversarial code review (install --project)

- Global (no-flag) path untouched: git diff 3a2b65f~1 3a2b65f — the else-branch of runInstall is BYTE-IDENTICAL to shipped (resolvePath->undefined=skipped, !exists=absent, merge/remove, next===raw=already/absent, else write). Only change: loop/.find over the agents param, which DEFAULTS to AGENT_TABLE. F.9 + unchanged shipped install suites prove it.
- 3 pinned verbatim strings byte-match: (a) Codex trust line "codex -> written (requires trusted project: set trust_level in ~/.codex/config.toml)" spec:55 / code CODEX_PROJECT_TRUST_SUFFIX+verb / test:2061 / README:209. (b) USAGE install line spec:32 / cli.ts:36 / cli.test.ts:89 / README:164 (prose) / live --help. (c) Codex TOML bytes header+command+args+trailing-newline spec:54 / CODEX_RENDER+newline / test:2028/2031. Cursor create bytes = EXPECTED_MCPSERVERS_DOC (2-space JSON + newline) match spec:39.
- --remove --project can never delete a file: FsSeam exposes only readFile/writeFile/exists — NO unlink/rm primitive in install.ts (grep: 0 hits). Remove path records absent (no write) or writes emptied-but-valid content; F.7(a) asserts the file still exists.
- env:VAR passes through unexpanded: merge writers spread unrelated keys verbatim; no interpolation anywhere. F.8(a) proves byte preservation and absence of the resolved value.
- Dormant unsupported unreachable in production: all 6 AGENT_TABLE rows have projectPath (F.3 asserts + toHaveLength(6)); unsupported is pushed only when row.projectPath === undefined, reachable ONLY via the injected agents test seam (F.8(b) synthetic row).

## Docs audit (measured by the verifier)

- Feature-matrix cells checked against cited canonical specs: 24 (SQLite x8, SQL Server x8, PostgreSQL x6, MySQL x7, MongoDB x9). Every cell traces to its cited spec:
  - SQLite procs/functions unsupported / sqlite-extraction "procedures, functions ... unsupported"; triggers supported / same spec; FK note / composite FK requirement.
  - MongoDB triggers/procs/FK unsupported / mongodb-extraction CapabilityMatrix (table/column/constraint/view/procedure/function/trigger/sequence UNSUPPORTED); inferred-only / "Inferred relationships ... only relationships"; "values never persisted" / spec:111.
  - SQL Server procs/triggers/integrated-via-sqlcmd / mssql-extraction (procs/functions/sequences SUPPORTED; integrated via external-tool).
  - PostgreSQL materialized views / pg-extraction:8; MySQL CHECK/AUTO_INCREMENT/procs / mysql-extraction:7-12.
  - cli-config anchors: "Read-only-against-target is INVIOLABLE" (:16), "SQLite offers no procedures; MongoDB offers no triggers" (:122), "Plaintext credentials are rejected" (:67), "values never stored" (:42) — all present.
- CLI examples run (content-free subset, via source entry — see SUGGESTION-1): 3/3 exit 0.
  - --version -> 0.0.0 (matches Limitations "version is 0.0.0").
  - --help -> banner install line byte-matches the pinned text; multi-agent, no "Claude Desktop".
  - doctor -> content-free report (Engine / Native driver / CLI tools+version / ODBC / Resolved profile / Chosen strategy); path shown as basename SQLCMD.EXE (confirms SECURITY "reduced to a basename"). Fields cliTools/resolvedProfile/chosenStrategy from the F-1..F-7 table all appear live.
- No-overclaim grep (download|release|stable|phase 0|pre-alpha|do not use) across README/CONTRIBUTING/SECURITY/templates: download/stable/Phase 0/pre-alpha/do-not-use = 0 hits; release = 5 hits, ALL negated/qualified ("no published release yet", "never been fired", "trigger-guarded").
- Troubleshooting cites ONLY F-1..F-7; each fix matches docs/findings/connectivity-environments.md and the connectivity / connectivity-diagnostics specs.
- CONTRIBUTING/SECURITY anchors verified: config.yaml strict_tdd true (:11) + "failing test first ... src/core" (:59); scripts test:integration/smoke:binary/hooks:install/format present; .nvmrc = 24.18.0; engines.node >=22; "Write-verb scanner over engines" / sqlite-extraction:160.
- .github templates: bug_report.md requests dbgraph doctor output justified content-free BY SPEC (connectivity-diagnostics) + version/OS/engine/repro; feature_request.md present; PULL_REQUEST_TEMPLATE.md = tsc/lint/vitest/leak-scan gate + openspec SDD checklist + conventional-commit.

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 optional projectPath + shared resolveProjectConfigPath | Yes | Exact-string path tests both platforms. |
| D2 BOOLEAN --project flag (cwd seam) | Yes | project in BOOLEAN_LONG_FLAGS; --project --remove both parse true. |
| D3 create-when-absent (project only, zero new writer code) | Yes | seeds raw empty -> merge-on-empty. |
| D4 global unchanged (absent => absent) | Yes | byte-identical else-branch; F.9 green. |
| D5 Codex included, mergeCodexToml, trust-caveat suffix | Yes | exact bytes + verbatim summary line. |
| D6 --remove --project never deletes | Yes | no delete primitive; F.7. |
| D7 docs = no capability spec files | Yes | only mcp-server + cli-config deltas under the change dir. |
| D8 per-cell matrix citations | Yes | every cell cites a spec. |

## Integrity

- Files touched (impl commits 3a2b65f..a9be4db) = exactly the design File Changes set: cli.ts, install.ts, dispatch.ts, parse/args.ts + their tests + README.md/CONTRIBUTING.md/SECURITY.md/.github/* + tasks.md (progress). 15 files.
- No golden/snapshot/fixture files touched — no golden drift.
- Existing install suites unmodified and green (regression net intact).
- Nothing pushed: no origin/closeout branch; none of the 4 phase commits are on any remote branch.
- No tags: repo tag count = 0.
- Working tree clean except this untracked report.

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (non-blocking):
1. Pre-existing doubled-shebang bug in dist/cli.js (the node shebang appears twice) breaks `node dist/cli.js`. NOT introduced by this phase (build tooling, out of scope); content-free examples were verified via the source entry (npx tsx src/cli/cli.ts) as the README documents the dbgraph interface abstractly. README does not overclaim (states "runs from source today", no published binary). Recommend fixing the build before any v1.0 binary ships.
2. Spec-delta promotion deferred to archive: the design File Changes table lists openspec/specs/mcp-server/spec.md and openspec/specs/cli-config/spec.md as "Modify (delta)", but the canonical specs are unchanged — deltas live under openspec/changes/phase-7-docs/specs/ per openspec convention. sdd-archive MUST promote them. Expected pre-archive state, not a defect.

## Verdict

PASS. All 10 spec scenarios are behaviorally COMPLIANT (exact-byte-pinned passing tests), the full gate is green (tsc 0, lint 0/0, 2952 tests), every documentation claim traces to a cited canonical spec, no overclaim, leak-scan clean, no golden drift, nothing pushed, no tags. Ready for sdd-archive (which must promote the two spec deltas).
