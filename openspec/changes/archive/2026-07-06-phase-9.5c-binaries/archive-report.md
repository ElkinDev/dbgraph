# Archive Report — phase-9.5c-binaries

**Project**: dbgraph
**Change**: `phase-9.5c-binaries`
**Branch**: `closeout`
**Artifact store**: openspec (files)
**Archived**: 2026-07-06
**Verdict at archive**: PASS — 0 CRITICAL / 0 WARNING / 3 SUGGESTION (non-blocking test-hardening follow-ups)
**Verified commits**: `3eec63f`, `49a87b9`, `ecddd08`, `1723bca`, `44dc11a`, `c23dab9`

---

## Executive Summary

This change delivers the standalone-binary half of **US-037**: dbgraph now packages as self-contained
**win-x64** and **linux-x64** single-file executables, runnable with NO Node runtime and NO
`node_modules`, via an esbuild bundle + **Node SEA** assembly. `better-sqlite3` and the four optional DB
drivers (`mssql`, `pg`, `mysql2`, `mongodb`) stay `external` and lazily loaded, so a binary with no
resolvable driver still serves graph reads on the built-in `node:sqlite` handle (the 9.5b storage seam).
A trigger-guarded `release.yml` (tag-push / `workflow_dispatch` only) produces `SHA256SUMS` and build
provenance but was never fired in this phase, and checksum-verifying `install.ps1` / `install.sh`
installers fail closed on any mismatch. The verifier independently rebuilt the bundle and SEA blob twice
on a pinned Node (24.18.0), confirmed byte-identical determinism, ran the win-x64 exe natively and the
linux-x64 binary in a Node-less Docker container against the same golden fixtures, and mutation-tested
the release workflow's trigger guard. All 17/17 spec scenarios are COMPLIANT. Zero CRITICAL and zero
WARNING findings. Safe to archive.

---

## What Shipped

| Commit | Summary |
|--------|---------|
| `3eec63f` | SDD planning: proposal, spec (`binary-distribution`, 6 requirements / 17 scenarios), design (10 architecture decisions), and a 30-task breakdown across 5 batches. Formalizes the Node SEA approach for US-037. |
| `49a87b9` | Batch 0 spike: records empirical SEA / `node:sqlite` findings and pins the build toolchain to Node **24.18.0** via `.nvmrc`, closing open design questions before implementation. |
| `ecddd08` | SEA runtime seams: `--version` baking, `planEntry` CJS/sea-entry dispatch, `startMcpServer` bundle-safe guard, a shared `loadOptionalDriver` seam (SEA: `createRequire(process.execPath)`; off-SEA: `import()`, byte-identical), swapped into all 4 driver factories/strategies, and the `isSea` store flip in `open-connections.ts`. |
| `1723bca` | esbuild bundle (`scripts/sea/esbuild-config.mjs`, drivers + `better-sqlite3` marked `external`, plus the `tedious` transitive-external for mssql) + Windows SEA assembly (`build-sea.ps1`, postject injection) + the no-`node_modules` win smoke. Also fixes two seam bugs surfaced by the first real binary build: `detectSea()` needed `process.execPath` instead of `import.meta.url` (empty in the CJS bundle), and the sea-entry runner needed to set `process.exitCode` instead of calling `process.exit()` eagerly so piped stdout flushes. Adds the D12 vitest smoke-config split so `npm test` stays green with no binary artifact present. |
| `44dc11a` | Dockerized linux-x64 SEA build (`build-sea.sh` on `node:24.18.0-bookworm-slim`, isolated esbuild binary path so the mounted host `node_modules` is never touched) + `smoke-linux.sh`, a Node-**less** `debian:bookworm-slim` container smoke — the strongest proof that the binary needs no Node/`node_modules`. |
| `c23dab9` | Guarded `release.yml` (tag-push + `workflow_dispatch` triggers only; win/linux/macos matrix; `SHA256SUMS` + build provenance attestation, unfired); checksum-verifying `install.ps1` / `install.sh` (fail closed on mismatch, nothing partial left on PATH); reconciles the US-037 acceptance criterion in `docs/stories/07-quality-publication.md` from "5 drivers statically bundled" to external/optional per ADR-009. |

Definition of Done: 9/9 items `[x]`. Tasks: 30/30 `[x]` across 5 batches (B0–B4). Checkbox state matches
code state — independently cross-checked against a from-scratch rebuild by `sdd-verify`, no over-claim
found.

---

## Validation (as measured by sdd-verify, re-confirmed at archive)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (strict, no `any`) | PASS — exit 0 |
| `npm run lint` (`eslint .`) | PASS — exit 0, 0 errors / 0 warnings |
| `npm test` (`vitest run`, clean machine: `build/`/`dist/` absent, no binary artifact needed) | PASS — 172 files, 2907 passed, 0 failed |
| `git diff <range> -- test/golden/` | PASS — empty (off-SEA behavior byte-identical, ADR-008) |
| `npm run smoke:binary` (opt-in, win exe built) | PASS — 3 files, 25 passed, 0 skipped |
| Bundle + SEA blob rebuild x2 (pinned Node 24.18.0) | PASS — identical sha256 both times (R6 determinism) |
| win-x64 native exe + linux-x64 Docker (Node-less container) smoke | PASS — both byte-identical to the same golden, cross-platform parity confirmed |
| Release workflow trigger-guard mutation test | PASS — injecting `pull_request:` into `on:` fails 2 tests as expected; reverted, tree clean |

`npm test` runs the full unit suite via plain `vitest run` — `vitest.config.ts` excludes
`**/*.integration.test.ts` and `**/*.smoke.test.ts` by design (D12), so no binary artifact is required for
the default `npm test` script; the win/linux binary smokes are a separate opt-in `smoke:binary` script.
No deviation from `npm test` was needed.

---

## Spec Compliance (from verify-report.md)

17/17 scenarios COMPLIANT across the 6 requirements of `binary-distribution` (bundle + externals, SEA
assembly + smoke, driver-degradation contract, guarded release workflow, checksum-verifying installers,
determinism). R6 (byte-identity) and R4 (workflow not fired) scenarios have no automated in-suite
assertion — they are validated by the per-batch manual determinism gate and repo-state inspection, both
independently re-executed by the verifier.

## Suggestions Accepted (non-blocking — do not block archive)

Carried forward verbatim from `verify-report.md` as follow-up test-hardening work, not required before
archive:

1. **SEA runner glue is smoke-only.** `runSeaEntry`/`detectSea` in `src/bin/sea-entry.ts` (the
   exitCode-drain `process.exitCode = code` fix and the `createRequire(process.execPath)` SEA-detection
   base) are validated only by the opt-in win/linux smoke, not by `npm test`. This is consistent with D12
   (both are genuinely SEA-runtime behaviors). Exporting `runSeaEntry` for a vitest assertion that it sets
   `process.exitCode` (not `process.exit`) would catch a refactor regression on a clean machine.
2. **Spec R3 error-class prose.** R3 names a `ConnectionError` (`E_CONNECTION`); the pg live-DB path
   actually renders `ConnectivityUnavailableError` (`E_CONNECTIVITY_UNAVAILABLE`) while mssql throws
   `ConnectionError`. The observable contract R3 pins (exact message, exit 2, no stack) holds for all
   engines and passes; only the spec prose is imprecise about the class. Consider stating the observable
   contract explicitly (or naming both classes).
3. **R6 byte-identity has no in-suite assertion.** S15/S16 are proven by the manual per-batch determinism
   gate (re-run at verify: identical sha256). An opt-in determinism smoke (`bundle:sea` x2 → compare)
   would lock it against future regressions without requiring a binary artifact.

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|----------------|
| `binary-distribution` | **New capability** — promoted essentially as-is from the change's full spec (not a delta) | `openspec/specs/binary-distribution/spec.md` |

### Promotion detail — binary-distribution

`binary-distribution` had no prior canonical spec — this is a brand-new capability directory. Followed
the promotion precedent set by the two other "new capability" archives whose change-folder spec titles
carried a `(new — <change-name>)` suffix (`cli-config` from `2026-06-17-phase-4-cli-config`, and
`connectivity` from `2026-06-18-connectivity-strategies`): in both precedents the ONLY change made at
promotion time was stripping that title suffix — the body was carried over unchanged, including any
provenance blockquotes. The same treatment was applied here:

- Title changed from `# Binary Distribution Specification (new — phase-9.5c-binaries)` to
  `# Binary Distribution Specification`.
- The ADR-006 supersession provenance blockquote ("The binary keeps DB drivers EXTERNAL, not statically
  bundled. This REFINES / SUPERSEDES ADR-006's 'static bundling in the binaries' clause...") was KEPT
  verbatim, matching how the `mongodb-extraction` and `connectivity-diagnostics` canonical specs retain
  their own Purpose-section provenance blockquotes.
- No other structural change was made — the diff between the change-folder source and the new canonical
  file is exactly the one title line.

---

## Deferred Scope

macOS/arm64 builds, package publishing (npm/Homebrew/winget etc.), and binary signing are explicitly
OUT of scope for this phase and are deferred to a future phase **9.5d**. The `release.yml` matrix already
includes a `macos` leg (dormant, unexercised), and `build-sea.ps1`'s `signtool` step is best-effort/skip-
when-absent by design — both are placeholders for 9.5d, not gaps in this phase's contract.

---

## Archive Contents (current location, PRE-MOVE)

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `design.md` | Present (10 architecture decisions; SEA-vs-bun tradeoff; ADR-009) |
| `tasks.md` | Present (30/30 tasks `[x]`; 5 batches B0–B4; DoD 9/9 `[x]`) |
| `specs/binary-distribution/spec.md` | Present (full spec, new capability; promoted to canonical, see above) |
| `verify-report.md` | Present (PASS, 0 CRITICAL / 0 WARNING / 3 SUGGESTION, 172 files / 2907 tests) |
| `archive-report.md` | This file |

**GOTCHA (same as prior archives)**: `verify-report.md` and `archive-report.md` are UNTRACKED in git. A
plain `git mv` only relocates TRACKED files — the two untracked `.md` files must be explicitly `git add`-
ed after the move (along with the whole destination folder) or they will not be picked up as renames and
will look like unrelated new files rather than travelling with the change.

---

## Closing Steps

```bash
cd "C:\Users\ecardoso\dev\dbgraph"

# 1. Move the change folder (git mv only relocates TRACKED files)
git mv openspec/changes/phase-9.5c-binaries openspec/changes/archive/2026-07-06-phase-9.5c-binaries

# 2. Pick up the untracked files (verify-report.md, archive-report.md) at their new path
git add openspec/changes/archive/2026-07-06-phase-9.5c-binaries

# 3. Add the new canonical spec
git add openspec/specs/binary-distribution/spec.md

# 4. Confirm nothing remains at the old path
git status

# 5. Re-confirm the local gate is green on closeout
npx tsc --noEmit
npm run lint
npm test

# 6. Single conventional commit (no PR, no push, no gh, no AI attribution)
git commit -m "chore(sdd): archive phase-9.5c-binaries; promote binary-distribution canonical spec (US-037)"
```

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (5 batches, commits `3eec63f` + `49a87b9` + `ecddd08` + `1723bca` +
`44dc11a` + `c23dab9`) → VERIFY (PASS) → **ARCHIVE (complete)**.

Next recommended: phase **9.5d** — macOS/arm64 builds, package publishing, and binary signing, all
explicitly deferred by this phase's scope.
