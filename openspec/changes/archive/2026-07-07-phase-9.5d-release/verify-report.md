# Verification Report - phase-9.5d-release

**Change**: phase-9.5d-release (v1.0.0 release preparation)
**Version**: 1.0.0
**Branch**: v1-prep | **Artifact store**: openspec
**Mode**: Standard verify (no strict-TDD flag injected) - TDD discipline evidenced structurally in the diffs
**Verdict**: PASS

One-line: 15/15 tasks complete; 13/13 spec scenarios compliant; all gates green (tsc 0, lint 0/0, 3253 tests pass, build ok, --version 1.0.0, pack dist-only); NOTHING irreversible fired. CRITICAL 0, WARNING 0, SUGGESTION 1.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total (B1.1-B1.5, B2.1-B2.3) | 8 |
| Tasks complete | 8 |
| Definition-of-Done items | 7 |
| DoD complete | 7 |
| Total checkboxes | 15/15 |

All tasks marked [x] and match code state (verified via git diff 17266d6..HEAD).

---

## Build and Tests Execution (own reproduction)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | exit 0 - clean, no any |
| Lint | npm run lint (eslint .) | exit 0 - 0 errors / 0 warnings |
| Tests | npm test (vitest run) | 3253 passed / 3253, 187 files, exit 0, 34.8s |
| Build | npm run build (tsup) | exit 0 - ESM + DTS success |
| Version smoke | env -u DBGRAPH_BUILD_VERSION node dist/cli.js --version | prints 1.0.0, exit 0 |
| Version smoke | node dist/cli.js -v | prints 1.0.0, exit 0 |
| Drift guard (isolated) | vitest run test/bin/version-single-source.test.ts | 2 passed |
| Pack gate (own repro) | npm pack --dry-run --json | 24 files, roots [LICENSE, README.md, dist, package.json], 0 offenders, 0 leaks |

Test count 3253 matches the expected baseline (3246 pre-existing + drift guard 2 + pack files unit 1 + pack spawn 4 gated tests).

### Documented deviation - npm run build executed (ACCEPTED)

The global rule is "never build reflexively after changes." Here the built artifact's version IS an acceptance criterion: R1 S1 requires "After npm run build, node dist/cli.js --version prints 1.0.0." Verifying that scenario is impossible without producing dist/. The build is therefore JUSTIFIED and NECESSARY for verification. dist/ is gitignored, so the build left the tracked tree clean (git status empty). Deviation accepted.

---

## Spec Compliance Matrix (13 scenarios / 4 requirements)

| Req | Scenario | Evidence | Result |
|-----|----------|----------|--------|
| R1 | S1 npm-dist prints 1.0.0 via fallback | cli.test.ts (unset->1.0.0 x2) + dist-shebang.test.ts (dist run->1.0.0) + own env -u repro | COMPLIANT |
| R1 | S2 SEA prints 1.0.0 via baked pkg.version | esbuild-config.test.ts (define bakes package.json.version) + drift guard pins pkg.version===1.0.0; win-binary.smoke reads pkgVersion dynamically | COMPLIANT (mechanism + source pinned; end-to-end SEA execution out-of-scope/user-gated by design) |
| R1 | S3 divergence guard fails on disagreement | version-single-source.test.ts - always-on triple-equality (2 tests, ran isolated) | COMPLIANT |
| R1 | S4 current asserts move, mechanism/historical stay | git diff - 6 FIX sites moved; esbuild-config/9.9.9/smoke/benchmark diff EMPTY | COMPLIANT |
| R2 | S5 whitelisted tarball passes | npm-pack-whitelist.test.ts (files unit + real spawn) + own repro: 0 offenders | COMPLIANT |
| R2 | S6 any source/test/tooling leak fails | forbid regex for benchmark/openspec/scripts/test/src asserted; own repro: 0 leaks | COMPLIANT |
| R2 | S7 gate builds or documents precondition | file header documents npm run build precondition; dist-payload check gated on distBuilt | COMPLIANT |
| R3 | S8 v1.0.0 entry covers every shipped area | CHANGELOG.md - 5 engines, inference, MCP stdio+HTTP, 6-agent install, win/linux binaries, docs, benchmark, connectivity | COMPLIANT |
| R3 | S9 entry truthful - accurate counts, no unshipped claims | 5 spot-checks verified (below) | COMPLIANT |
| R4 | S10 every step ordered + labeled LOCAL/USER-GATED | docs/release.md Phase 0 (LOCAL) -> Phase 1 (LOCAL-done) -> Phase 2 U1-U6 (USER-GATED) -> Phase 4 verification | COMPLIANT |
| R4 | S11 every gated step warned; private removal in publish step | U1-U6 each carry warning; private:true removal sequenced inside U5 (npm publish) | COMPLIANT |
| R4 | S12 no LOCAL step fires irreversible/CI action | explicit "Honesty guard (read first)" states agents MUST NOT fire USER-GATED steps | COMPLIANT |
| R4 | S13 repository.url mismatch surfaced, not decided | U3 flags ElkinDev/dbgraph vs niklerk23/dbgraph, "Surfaced, not decided", no auto-change | COMPLIANT |

Compliance summary: 13/13 compliant. (R3/R4 are documentation scenarios with no vitest gate - honesty is the review oracle by design; manual review confirms them.)

### R3 S9 truthfulness spot-checks (5/5 verified against code + archives)

1. 5 engines - SQLite, SQL Server, PostgreSQL, MySQL/MariaDB, MongoDB -> archived phases phase-2/3/8a/8b/9b. OK
2. 8 MCP tools - 8 files in src/mcp/tools/ (explore, search, object, related, impact, path, precheck, status) exactly match the CHANGELOG list. OK
3. 6 agents - AGENT_TABLE in src/cli/commands/install.ts = claude-code, cursor, gemini, vscode, opencode, codex; comment says "adding a 7th agent". OK
4. Binaries = pipeline, not published - heading "Standalone binaries (build pipeline)", "runnable locally", "release.yml ... has never been fired", "macOS build leg is present but dormant and produces no artifact". OK
5. Nothing published to npm - top banner: "Nothing has been published to npm and no binary has been released yet - those steps are user-gated". OK

---

## Adversarial Verification

### STAY-list untouched (zero churn vs 17266d6)
- git diff 17266d6..HEAD for esbuild-config.test.ts, smoke tests, benchmark/ -> EMPTY.
- esbuild-config.test.ts retains 0.0.0 and 9.9.9 define inputs (6 references, unchanged).
- cli.test.ts DBGRAPH_BUILD_VERSION=9.9.9 override test preserved (present in diff context, unchanged).
- win-binary.smoke.test.ts reads pkgVersion dynamically (auto-tracks, excluded from npm test).
- Benchmark Environment rows untouched. No false churn.

### Pack gate (own reproduction)
- npm pack --dry-run --json: 24 files; top-level roots [LICENSE, README.md, dist, package.json].
- Non-dist entries: exactly LICENSE, README.md, package.json.
- CHANGELOG.md correctly EXCLUDED (consistent with files:["dist"]).
- Offenders (not whitelisted): none. Forbidden leaks: none.
- files===['dist'] unit is always-on (backstop when npm/dist absent).

### Runbook honesty
- Every USER-GATED step (U1-U6) carries an inline warning banner with cost/irreversibility.
- private: true intact at package.json:7; removal documented only inside U5 (npm publish).
- repository.url mismatch surfaced at U3 (pre-tag), never auto-changed.
- No-fire guard present: agents MUST NOT execute any USER-GATED step; no LOCAL step pushes a tag, dispatches release.yml, runs npm publish, flips repository visibility, or removes private: true.
- Rollback caveats honest (Phase 3): tag -> GitHub keeps Actions run history + permanent attestation; unpublish < 72h + version non-reusable; visibility -> clones/forks/caches persist.

### NOTHING FIRED
- git tag -l -> empty (no v1.0.0 tag).
- v1-prep has no upstream - nothing pushed for this branch.
- Only remote is origin = ElkinDev/dbgraph; no gh/PR evidence; commits are all local.
- release.yml untouched by all three phase commits (git log 17266d6~1..HEAD for .github/workflows/ empty).

### Leak-scan / tree cleanliness
- git status --porcelain -> clean (tracked tree). No stray untracked non-ignored files.
- dist/ is gitignored; the build did not pollute the tree.
- Only new artifact after verify: this verify-report.md (uncommitted, as instructed).

---

## Correctness (Static - structural)

| Requirement | Status | Notes |
|-------------|--------|-------|
| R1 version single-valued + guarded | Implemented | Both literals=1.0.0; always-on triple-equality guard |
| R2 npm-pack whitelist gate | Implemented | files unit + real npm pack spawn, cross-platform skipIf |
| R3 truthful CHANGELOG | Implemented | One [1.0.0], all areas, counts verified |
| R4 honesty-annotated runbook | Implemented | LOCAL/USER-GATED labels, warnings, honesty guard |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Drift guard in test/bin/version-single-source.test.ts (always-on) | Yes | No skipIf; reads files only |
| Two-source bump with FIX/STAY partition | Yes | 6 FIX sites only; STAY diff empty |
| Pack gate = real spawn + files unit backstop | Yes | Windows npm.cmd gotcha handled via npm_execpath |
| CHANGELOG = one Keep-a-Changelog [1.0.0] | Yes | Dated 2026-07-07, area subsections |
| Runbook labels every step + inline warnings | Yes | private removal inside publish; repo.url surfaced |
| README false-premise correction (orchestrator) | Yes | README present, kept in allow-set, in tarball |

---

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (nice to have):
- R1 S2 (SEA channel end-to-end) is proven only at the mechanism level within npm test (esbuild define bakes package.json.version; drift guard pins the source to 1.0.0). The behavioural SEA-binary --version proof lives in win-binary.smoke.test.ts, which is excluded from npm test and requires a built binary. This is BY DESIGN (SEA binary build/run is out-of-scope/user-gated this phase), but the runbook Phase-4 post-release smoke is the place that closes the loop - worth remembering when the user fires the tagged release.

---

## Verdict

PASS - Implementation is complete and behaviorally compliant. All 15 tasks done, all 13 spec scenarios compliant, all gates green (tsc 0, lint 0/0, 3253/3253 tests, build ok, --version 1.0.0, tarball dist-only). Zero irreversible steps fired: no tag, no push, no publish, private:true intact, release.yml untouched. Ready for sdd-archive.
