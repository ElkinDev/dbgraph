# Verification Report — phase-9.5c-binaries

**Change**: phase-9.5c-binaries (Standalone binaries via Node SEA — esbuild bundle, release workflow, installers)
**Spec version**: binary-distribution (6 requirements, 17 scenarios)
**Mode**: Standard verify (repo has no `strict_tdd` config flag; tasks author STRICT TDD by convention — honored)
**Branch / HEAD**: `closeout` @ `c23dab9`
**Verifier Node**: default `v22.19.0`; rebuild/smoke on pinned **v24.18.0** (scratchpad, outside repo)
**Date**: 2026-07-06

---

## Verdict: **PASS**

0 CRITICAL · 0 WARNING · 3 SUGGESTION. Every one of the 17 spec scenarios is proven by a test or smoke
I executed myself. The bundle + SEA blob rebuild byte-identically on the pinned Node; win-x64 (native)
and linux-x64 (Docker, Node-less container) binaries pass the no-`node_modules` smoke against the SAME
golden; the release workflow is trigger-guarded (mutation-proven), unfired, no tag pushed; installers
fail closed. Nothing blocks archive.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 30 (B0: 6, B1: 7, B2: 8, B3: 3, B4: 6) |
| Tasks complete `[x]` | 30 |
| Tasks incomplete | 0 |
| Definition of Done | 9 / 9 `[x]` |

All task claims were cross-checked against actual code + a from-scratch rebuild — no over-claim found.

---

## Gate (measured by me)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npx tsc --noEmit` | PASS exit 0 (strict, no `any`) |
| Lint | `npm run lint` | PASS 0 errors / 0 warnings |
| Unit suite (clean machine: **build/ dist/ ABSENT**) | `npm test` | PASS **172 files, 2907 passed, 0 failed**, exit 0 |
| Golden drift | `git diff 3eec63f~1..c23dab9 -- test/golden/` | PASS EMPTY (off-SEA byte-identical, ADR-008) |
| Smoke suite (win exe built) | `npm run smoke:binary` | PASS **3 files, 25 passed, 0 skipped**, exit 0 |

`npm test` = 2907 with the binary absent — confirms D12 CI-independence (no vitest test needs a binary).

---

## Rebuild from scratch (pinned Node 24.18.0 — closes the apply-agent gap)

| Artifact | Measurement | Result |
|----------|-------------|--------|
| esbuild bundle x2 | sha256 `bb29ef2a…98ded6`, 1159909 B, identical both builds | PASS R6 bundle determinism |
| SEA blob x2 | sha256 `0e6bc793…eecf0a`, 1159955 B, identical both builds | PASS R6 blob determinism |
| Bundle sanity (off-SEA) | `--version`->`0.0.0`, `--help`->banner | PASS |
| Win exe (`build-sea.ps1`, pinned Node) | `dbgraph-win-x64.exe`, 93820416 B, exit 0 | PASS (postject "signature seems corrupted" = expected/benign, Batch 0.5; signtool absent -> skipped as designed) |
| Linux binary (Docker `node:24.18.0-bookworm-slim`) | `dbgraph-linux-x64`, 124849344 B, exit 0 | PASS (`.note.100` postject warnings = benign ELF quirk) |

## Smoke — measured first-hand (clean cwd, NO node_modules, NODE_PATH cleared)

**Windows exe** (`DBGRAPH_BINARY_PATH=… npm run smoke:binary` + independent manual run outside the repo):
- `--version` -> `0.0.0`, exit 0, empty stderr
- `--help` -> banner `dbgraph — database schema graph indexer`, exit 0
- `init … --driver node:sqlite` -> exit 0 (first sync on in-binary node:sqlite, zero native modules)
- `query orders` -> exit 0, **BYTE-IDENTICAL** to `test/bin/golden/query-orders.txt`; re-query identical
- driver-missing (`sync`, pg, env-ref pw, no resolvable driver) -> **exit 2**, Summary EXACTLY
  `Required driver 'pg' is not installed. Run: npm i pg`, **no raw stack**

**Linux Node-less container** (`bash scripts/sea/smoke-linux.sh`, `debian:bookworm-slim`): **GREEN** —
container has no node · `--version`==`0.0.0` · `--help` banner · `init->sync` exit 0 · `query` byte-identical to golden.

**Cross-platform parity**: win + linux both `--version` `0.0.0`, identical `--help` banner, identical query golden.

---

## Spec Compliance Matrix (17 / 17 COMPLIANT)

| Req | Scenario | Proof (executed) | Result |
|-----|----------|------------------|--------|
| R1 | Bundle boots, serves --help/--version, node_modules absent | `win-binary.smoke.test.ts` + manual exe run + bundle sanity | COMPLIANT |
| R1 | Drivers + better-sqlite3 external, none inlined | `bundle-external.smoke.test.ts` (markers absent, `import("…")` present, no `require_<drv>`) + `esbuild-config.test.ts` | COMPLIANT |
| R1 | Graph reads run on node:sqlite inside the bundle | `win-binary.smoke.test.ts` query + `open-connections.test.ts` isSea flip | COMPLIANT |
| R2 | win-x64 SEA passes no-node_modules smoke | `win-binary.smoke.test.ts` --version/--help + my manual run | COMPLIANT |
| R2 | linux-x64 builds via Docker, same smoke | `scripts/sea/smoke-linux.sh` (I ran it: GREEN) | COMPLIANT |
| R2 | query returns pinned output | win smoke + linux smoke, byte-identical to golden | COMPLIANT |
| R3 | Graph-read succeeds with no driver | win + linux smoke `query orders` exit 0, no driver | COMPLIANT |
| R3 | Live-DB w/o driver fails with install error | `win-binary.smoke.test.ts` + my manual run: exit 2, exact msg, no stack | COMPLIANT |
| R4 | Triggers ONLY tag-push + workflow_dispatch | `release-workflow.test.ts` (structural parse) — mutation-proven (below) | COMPLIANT |
| R4 | Release job: SHA256SUMS + provenance | `release-workflow.test.ts` (matrix win/linux/macos, SHA256SUMS step, `attest-build-provenance`) | COMPLIANT |
| R4 | Workflow not fired this phase | repo-state: `git tag -l` empty, no upstream on `closeout`, no dispatch | COMPLIANT |
| R5 | Matching checksum installs on PATH | `install.smoke.test.ts` (a) both shells — I ran it | COMPLIANT |
| R5 | Mismatch fails closed, nothing on PATH | `install.smoke.test.ts` (b) both shells — nothing placed, partial deleted | COMPLIANT |
| R5 | Fetch parameterized by version+platform | `install.smoke.test.ts` (c) print-plan both shells | COMPLIANT |
| R6 | Byte-identical bundle | I rebuilt x2 on pinned Node -> identical sha256 | COMPLIANT |
| R6 | Byte-identical SEA blob | I rebuilt x2 -> identical sha256 | COMPLIANT |
| R6 | Injected binary pinned by recorded checksum | release.yml SHA256SUMS step + installers verify-before-place (`install.smoke.test.ts`) | COMPLIANT |

**Compliance: 17 / 17 scenarios COMPLIANT.**

Note: R6 S15/S16 (byte-identity) and R4 S11 (not-fired) have no automated assertion inside the suite —
they are validated by the per-batch manual determinism gate / repo-state inspection, which I re-executed.

---

## Adversarial checks

| Check | Method | Result |
|-------|--------|--------|
| release.yml trigger tripwire | injected `pull_request:` into `on:`, ran `release-workflow.test.ts` | PASS: 2 tests FAILED (`toStrictEqual` trigger keys + `'pull_request' in on`); restored via `git checkout`, re-ran -> 9/9 pass, tree clean |
| Off-SEA byte-identity | `git diff 3eec63f~1..c23dab9 -- test/golden/` | PASS EMPTY |
| Driver-missing wording | grep source | PASS unchanged `Required driver '<name>' is not installed. Run: npm i <name>` (pg/mysql/mssql-strategy/mongodb) |
| Installer fail-closed, no partial | `install.smoke.test.ts` (b) | PASS install dir never created; partial deleted before any placement; tmp dir cleaned on trap |
| ADR-009 refines ADR-006 | read `docs/adr/009-*.md` | PASS header `Refines: ADR-006 (bundling clause)`; Decision.3 supersedes the "static bundling" sentence, ADR-006 lazy/optional stands |
| US-037 AC reconciliation | diff `docs/stories/07-quality-publication.md` | PASS only the "5 drivers statically bundled" AC changed -> external/optional per ADR-009; no other AC altered |
| D12 split | `vitest.config.ts` | PASS `exclude ['**/*.integration.test.ts','**/*.smoke.test.ts']`; `npm test` green with binary absent; no vitest test needs a binary |
| Reality-break fixes -> regression tests | code + tests | see SUGGESTION-1 (`--help` exit 0 vitest `cli.test.ts`; `startMcpServer` vitest `server.test.ts`; exitCode-drain + `createRequire(process.execPath)` are smoke-only by D12) |
| Leak-scan / codename | ran pre-commit denylist logic over all 47 files | PASS CLEAN (0 matches) |
| No fire / no push | `git tag -l`, upstream, dispatch | PASS no tags, no upstream on `closeout`, workflow never dispatched |

---

## Correctness (structural)

| Requirement | Status | Notes |
|-------------|--------|-------|
| R1 bundle + externals | OK | `esbuild-config.mjs`: cjs/node/node24/bundle, `external` = 6 drivers + `tedious` (justified superset — mssql/probe.ts literal import) |
| R2 SEA assembly win+linux | OK | `build-sea.ps1` (native) + `build-sea.sh`/`build-linux-docker.mjs` (Docker), postject @ fuse `…fce680ab…` |
| R3 driver degradation | OK | `loadOptionalDriver` seam (SEA: createRequire cwd->execPath; off-SEA: `import(name)` byte-identical); 4 factory/strategy swaps; `open-connections` isSea store flip |
| R4 release.yml | OK | tag+dispatch only, matrix win/linux/macos (macOS dormant), SHA256SUMS, attest-build-provenance |
| R5 installers | OK | `install.ps1`/`install.sh` verify-before-place, fail closed, version+platform parameterized; `asset-name.mjs` shared contract |
| R6 determinism | OK | `.nvmrc` 24.18.0; bundle+blob byte-reproducible (measured); injected binary pinned by SHA256SUMS |

## Coherence (design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 drivers external | Yes | + documented `tedious` transitive-external (design listed 6; apply added the required superset with test + rationale) |
| D2 isSea store flip | Yes | conditional spread respects `exactOptionalPropertyTypes` — off-SEA no `driver` key |
| D3 pin Node 24 | Yes | 24.18.0; node:sqlite no flag (I re-confirmed on the pinned Node) |
| D4/D5 CJS + sea-entry dispatch | Yes | `planEntry` slice offset 2 (Batch-0.2 correction to design's `slice(1)`) — vitest-pinned |
| D6 --version bake | Yes | esbuild `define`; off-SEA fallback `DBGRAPH_VERSION='0.0.0'` |
| D7 loadOptionalDriver | Yes | Q1 full; off-SEA byte-identical (goldens empty) |
| D8/D9 assembly + Docker | Yes | Node-less debian smoke = strongest "no node" proof |
| D10 release guard | Yes | mutation-proven tripwire |
| D11 installers fail closed | Yes | smoke (a)(b)(c) both shells |
| D12 test split | Yes | smoke excluded from `npm test` |

---

## Issues Found

**CRITICAL** (block archive): None.

**WARNING** (should fix): None.

**SUGGESTION** (non-blocking, for a follow-up):
1. **SEA runner glue is smoke-only.** `runSeaEntry`/`detectSea` in `src/bin/sea-entry.ts` (the exitCode-drain
   `process.exitCode = code` fix and the `createRequire(process.execPath)` SEA-detection base) are validated
   only by the opt-in win/linux smoke, not by `npm test`. This is CONSISTENT with D12 (both are genuinely
   SEA-runtime behaviors — the drain only matters when stdout is an async pipe in a real SEA). Still, exporting
   `runSeaEntry` for a vitest assertion that it sets `process.exitCode` (not `process.exit`) would catch a
   refactor regression on a clean machine. The pure `planEntry`, `--help` exit-0, and `startMcpServer` are
   already vitest-pinned.
2. **Spec R3 error-class prose.** R3 names a `ConnectionError` (`E_CONNECTION`); the pg live-DB path actually
   renders `ConnectivityUnavailableError` (`E_CONNECTIVITY_UNAVAILABLE`) while mssql throws `ConnectionError`.
   The OBSERVABLE contract R3 pins (exact message, exit 2, no stack) holds for all engines and passes; only
   the spec prose is imprecise about the class. Consider stating the observable contract (or both classes).
3. **R6 byte-identity has no in-suite assertion.** S15/S16 are proven by the manual per-batch determinism gate
   (which I re-ran: identical sha256). An opt-in determinism smoke (`bundle:sea` x2 -> compare) would lock it
   against future regressions without a binary artifact.

---

## Repo hygiene

- Working tree CLEAN (no tracked modifications); `build/` + `dist/` are gitignored (fresh rebuilds left on disk per contract).
- No tags; `closeout` has no upstream; release workflow never dispatched — R4 "never fired" holds.
- `verify-report.md` written (this file). NOT committed — archive commits it.
