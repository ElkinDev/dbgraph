# Archive Report — phase-9.5d-release

**Project**: dbgraph
**Change**: `phase-9.5d-release`
**Branch**: `v1-prep`
**Artifact store**: openspec (files)
**Archived**: 2026-07-07
**Verdict at archive**: PASS — 0 CRITICAL / 0 WARNING / 1 SUGGESTION (non-blocking)
**Verified commits**: `17266d6`, `c20f40f`, `b18da4d`

---

## Executive Summary

dbgraph is now **version-truthful at `1.0.0`** across both distribution channels: the npm `dist`
fallback constant (`DBGRAPH_VERSION` in `src/index.ts`) and the SEA-baked `package.json.version`
(esbuild `define`) both read `1.0.0`, pinned together by an **always-on drift guard**
(`test/bin/version-single-source.test.ts`) that goes RED the instant the two sources disagree. The
npm-publish **tarball is gated to dist-only contents** — a real `npm pack --dry-run --json` spawn
(backstopped by an always-on `files===['dist']` unit) fails closed on any `benchmark/`, `openspec/`,
`scripts/`, `test/`, or `src/` leak. `CHANGELOG.md` now carries one truthful, Keep-a-Changelog
`## [1.0.0]` entry distilled from the **21 prior archived changes**, covering every shipped area with
accurate counts and no unshipped claim. A new `docs/release.md` **release runbook** documents the full
path to a public v1.0.0 release, labeling every step LOCAL (agent-executable, reversible) or
USER-GATED (user-only, irreversible/cost-bearing), with an inline warning on each gated step.

**None of the USER-GATED release actions were executed as part of this change.** Specifically, this
change did NOT fire:

- **U1** — merging the `closeout` PR
- **U2** — the `v1-prep` → `main` PR
- **U3** — the `repository.url` (`ElkinDev/dbgraph`) vs npm-scope (`@niklerk23/dbgraph`) mismatch check
- **U4** — creating the `v1.0.0` tag (which fires `release.yml`: win-x64/linux-x64 build legs, provenance
  attestation, `gh release create`)
- **U5** — `npm publish` (and the accompanying removal of `private: true`)
- **U6** — the GitHub repository visibility flip (private → public)

All six remain USER-GATED and unfired. `git tag -l` is empty, `v1-prep` has no upstream, no `gh`/PR
activity occurred, and `release.yml` is untouched by any commit in this phase. The verifier confirmed
this with an independent adversarial pass ("NOTHING FIRED" section of `verify-report.md`). Safe to
archive.

---

## What Shipped

| Commit | Summary |
|--------|---------|
| `17266d6` | SDD planning: proposal, spec (`release-packaging`, 4 requirements / 13 scenarios), design, and an 8-task breakdown across 2 batches (B1 code, B2 docs). |
| `c20f40f` | Batch B1 (STRICT TDD): `test/bin/version-single-source.test.ts` (always-on drift guard, RED-first against `0.0.0`, GREEN after the two-source bump); `package.json.version` and `src/index.ts` `DBGRAPH_VERSION` moved `0.0.0` → `1.0.0`; the six current-app-version test asserts moved with them (`test/smoke.test.ts`, `test/cli/cli.test.ts`, `test/bin/dist-shebang.test.ts`); `test/bin/npm-pack-whitelist.test.ts` (new) — an always-on `files===['dist']` unit plus a real `npm pack --dry-run --json` spawn gate, cross-platform `skipIf`'d on npm absence, diffing the full packed file list against the dist-only whitelist. |
| `b18da4d` | Batch B2 (docs, no test gate): `CHANGELOG.md` — one truthful Keep-a-Changelog `## [1.0.0] - 2026-07-07` entry grouped by shipped area, distilled from the 21 archived changes; `docs/release.md` — the ordered LOCAL/USER-GATED release runbook with inline cost/irreversibility warnings, a rollback/abort table, and post-release verification steps. |

Definition of Done: 7/7 items `[x]`. Tasks: 15/15 `[x]` across 2 batches (B1–B2). Checkbox state matches
code state — independently cross-checked against `git diff 17266d6..HEAD` by `sdd-verify`, no
over-claim found.

---

## Validation (as measured by sdd-verify, re-confirmed at archive)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (strict, no `any`) | PASS — exit 0 |
| `npm run lint` (`eslint .`) | PASS — exit 0, 0 errors / 0 warnings |
| `npm test` (`vitest run`) | PASS — 187 files, 3253 passed, 0 failed, 34.8s |
| `npm run build` (tsup, own reproduction) | PASS — ESM + DTS success |
| `env -u DBGRAPH_BUILD_VERSION node dist/cli.js --version` | PASS — prints `1.0.0`, exit 0 |
| `node dist/cli.js -v` | PASS — prints `1.0.0`, exit 0 |
| `vitest run test/bin/version-single-source.test.ts` (isolated) | PASS — 2 passed |
| `npm pack --dry-run --json` (own reproduction) | PASS — 24 files, roots `[LICENSE, README.md, dist, package.json]`, 0 offenders, 0 leaks |

Test count 3253 matches the expected baseline (3246 pre-existing + drift guard 2 + pack `files` unit 1 +
pack spawn 4 gated tests). `npm run build` was executed by the verifier as a **documented, justified
deviation** from the "never build reflexively" rule — the built artifact's version is itself an
acceptance criterion (R1 S1), so verifying it is impossible without producing `dist/`. `dist/` is
gitignored; the tracked tree stayed clean throughout.

---

## Spec Compliance (from verify-report.md)

13/13 scenarios COMPLIANT across the 4 requirements of `release-packaging` (version single-source +
drift guard, npm-pack whitelist, truthful CHANGELOG, honesty-annotated runbook). R3/R4 are documentation
scenarios with no vitest gate — honesty is the review oracle by design; the verifier manually confirmed
them, including 5/5 truthfulness spot-checks (engine count, MCP tool count, agent count, binary-pipeline
wording, "nothing published" wording) traced against code and the 21 prior archives.

## Suggestions Accepted (non-blocking — do not block archive)

Carried forward verbatim from `verify-report.md` as a follow-up, not required before archive:

1. **S-1 — SEA behavioural `--version` proof deferred to post-release smoke.** R1 S2 (the SEA channel)
   is proven only at the mechanism level within `npm test` (the esbuild `define` bakes
   `package.json.version`; the drift guard pins that source to `1.0.0`). The behavioural proof — actually
   running a built SEA binary and reading `--version` — lives in `win-binary.smoke.test.ts`, which is
   excluded from `npm test` and requires a built binary artifact. This is BY DESIGN: SEA binary build/run
   is out-of-scope/user-gated in this phase. `docs/release.md`'s Phase-4 post-release verification is
   the place that closes this loop, and it is already documented there — worth remembering when the
   user fires the tagged release. Not a blocker.

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|----------------|
| `release-packaging` | **New capability** — promoted essentially as-is from the change's full spec (not a delta) | `openspec/specs/release-packaging/spec.md` |

### Promotion detail — release-packaging

`release-packaging` had no prior canonical spec — this is a brand-new capability directory. Followed the
same promotion precedent used for `binary-distribution` (`2026-07-06-phase-9.5c-binaries`),
`cli-config` (`2026-06-17-phase-4-cli-config`), and `connectivity` (`2026-06-18-connectivity-strategies`):
the ONLY change made at promotion time was stripping the change-folder title's `(new — <change-name>)`
suffix — the body carried over unchanged, including the Purpose-section provenance blockquotes (the
version single-value contract note and the `repository.url` open-question blockquote).

- Title changed from `# Release Packaging Specification (new — phase-9.5d-release)` to
  `# Release Packaging Specification`.
- No other structural change was made — the diff between the change-folder source and the new canonical
  file is exactly the one title line.

---

## Deferred Scope

Executing any USER-GATED release action (U1–U6 above) is explicitly OUT of scope for this phase and is
left for the user to fire when ready. macOS SEA validation happens only when the tagged release runs
(the macOS leg in `release.yml` is present-but-dormant, unchanged since `phase-9.5c-binaries`). Post-1.0
roadmap and any new product feature are likewise out of scope.

---

## Open Items Left For The User

1. **`repository.url` mismatch** — `package.json`'s `repository.url` points at `github.com/ElkinDev/dbgraph`,
   which does NOT match the npm publish scope (`@niklerk23/dbgraph`). `docs/release.md` surfaces this as a
   pre-tag (U3) verification item; it was NOT auto-changed. The user must resolve which value is correct
   before tagging.
2. **Repository visibility** — the GitHub repo's private/public state (U6) still needs to be decided and,
   if desired, changed by the user. No agent action in this phase touched visibility.

---

## Archive Contents (current location, PRE-MOVE)

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `design.md` | Present |
| `tasks.md` | Present (15/15 tasks `[x]`; 2 batches B1–B2; DoD 7/7 `[x]`) |
| `specs/release-packaging/spec.md` | Present (full spec, new capability; promoted to canonical, see above) |
| `verify-report.md` | Present (PASS, 0 CRITICAL / 0 WARNING / 1 SUGGESTION, 187 files / 3253 tests) |
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
git mv openspec/changes/phase-9.5d-release openspec/changes/archive/2026-07-07-phase-9.5d-release

# 2. Pick up the untracked files (verify-report.md, archive-report.md) at their new path
git add openspec/changes/archive/2026-07-07-phase-9.5d-release

# 3. Add the new canonical spec
git add openspec/specs/release-packaging/spec.md

# 4. Confirm nothing remains at the old path
git status

# 5. Re-confirm the local gate is green
npx tsc --noEmit
npm run lint
npm test

# 6. Single conventional commit (no PR, no push, no gh, no tag, no AI attribution)
git commit -m "chore(sdd): archive phase-9.5d-release; promote release-packaging canonical spec"
```

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (2 batches, commits `17266d6` + `c20f40f` + `b18da4d`) → VERIFY
(PASS) → **ARCHIVE (complete)**.

Next recommended: fire the USER-GATED release sequence (U1–U6) documented in `docs/release.md` when
ready — starting with resolving the `repository.url` mismatch and the repository-visibility decision.
