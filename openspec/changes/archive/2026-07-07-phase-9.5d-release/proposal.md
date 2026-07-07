# Proposal: v1.0.0 release preparation — version single-source, CHANGELOG, RELEASE runbook, npm-pack whitelist gate (phase-9.5d)

## Intent

Every capability planned for v1.0 is DONE and archived (21 SDD changes: Núcleo-5 engines, structural inference, MCP stdio+HTTP, 6-agent install with `--project`, win/linux SEA binaries, public docs, honest benchmark). Only the RELEASE MECHANICS remain: the package still self-reports `0.0.0`, there is no `CHANGELOG`, and nothing sequences the branch → PR → tag → publish flow. This phase makes the repo TRUTHFULLY `1.0.0` and hands the user one ordered, honesty-annotated runbook — WITHOUT firing any irreversible step. Success = version reads `1.0.0` on BOTH distribution channels (npm `dist` and the SEA binary), a truthful CHANGELOG, a `docs/release.md` that labels every LOCAL vs USER-GATED step, and an automated npm-pack whitelist gate — all green under `npm test`, no tag pushed, nothing published.

## Scope

### In Scope
- **Version bump 0.0.0 → 1.0.0 across BOTH sources of truth** (this is NOT a single edit — see Approach): `package.json.version` AND the `DBGRAPH_VERSION` constant in `src/index.ts`. Update ONLY the tests that assert the CURRENT app version.
- **CHANGELOG.md** (root, Keep-a-Changelog): one `## [1.0.0]` entry, user-facing summary grouped by area (engines, inference, MCP + HTTP, install, binaries, docs, benchmark, connectivity), distilled from the 21 archived changes (proposals/archive-reports; conventional-commit history is the source of truth).
- **docs/release.md** RELEASE runbook: the exact ordered checklist — LOCAL prep (checked where already true) → USER-GATED steps with inline CI-cost + irreversibility warnings → post-release verification (binary smoke from the GitHub release + `npm install` smoke).
- **npm-pack whitelist gate**: an automated check in `npm test` that runs `npm pack --dry-run --json` and asserts the tarball contains ONLY `dist/**` + `package.json` + `README.md` + `LICENSE`, and NO `benchmark/`, `openspec/`, `scripts/`, `test/`, or `src/`.

### Out of Scope (scope CUTS, not carry-over)
- **Executing** any USER-GATED step: pushing the `v1.0.0` tag (fires `release.yml` → CI cost + macOS build leg + `gh release create`), `npm publish`, removing `private: true`, flipping the GitHub repo public, merging PRs. The runbook DOCUMENTS these; the user FIRES them.
- macOS SEA validation — happens only when the user fires the tagged release (the macOS leg is present-but-dormant in `release.yml`).
- Post-1.0 roadmap / any new product feature.
- Rewriting historical records: the `esbuild-config` define-mechanism tests (`'0.0.0'`/`'9.9.9'` parameterization), the dynamic binary smoke tests (they read `package.json` version), and the benchmark Environment rows all STAY.

## Capabilities

### New Capabilities
- `release-packaging`: version single-sourced to `1.0.0` across the npm `dist` fallback (`DBGRAPH_VERSION`) and the SEA-baked value (`package.json` via esbuild `define`); the npm-pack tarball whitelist invariant (dist + package.json + README + LICENSE only, no source/test/tooling leakage).

### Modified Capabilities
- None. The CLI `--version` CONTRACT (prints the version, exits 0) is unchanged — only the VALUE moves. CHANGELOG and the runbook are documentation artifacts, not spec'd behavior.

## Approach

Two sources of truth, because the two channels resolve the version differently (verified in code):
- **SEA binary** — `scripts/sea/build-bundle.mjs` reads `package.json.version` and bakes it via esbuild `define` into `process.env.DBGRAPH_BUILD_VERSION`. Bumping `package.json` fixes this channel.
- **npm `dist`** — `tsup.config.ts` does NOT define `DBGRAPH_BUILD_VERSION`, so `dist/cli.js` falls back to the hardcoded `DBGRAPH_VERSION` in `src/index.ts`. Bumping `package.json` ALONE would leave `npm install`'s `dbgraph --version` reporting `0.0.0`. Therefore `DBGRAPH_VERSION` MUST ALSO become `1.0.0`.

Version-assert sites, honestly categorized:
- **FIX → 1.0.0** (assert the CURRENT app version): `src/index.ts` `DBGRAPH_VERSION`; `package.json`; `test/smoke.test.ts` (`DBGRAPH_VERSION === '0.0.0'`); `test/cli/cli.test.ts` (the `=== '0.0.0'` anchor + `--version`/`-v` → `'0.0.0\n'` prints); `test/bin/dist-shebang.test.ts` (`dist/cli.js --version` → `0.0.0`).
- **STAY** (mechanism / dynamic / historical): `test/bin/esbuild-config.test.ts` (define parameterization, `0.0.0`/`9.9.9` are arbitrary inputs); the `9.9.9` override case in `cli.test.ts`; `test/bin/*.smoke.test.ts` (read `pkgVersion` dynamically → auto-track); benchmark Environment rows.

CHANGELOG is generated from the archived proposals + conventional-commit history. The runbook sequences: merge `closeout` PR → `main`; push `v1-prep` → PR → merge; tag `v1.0.0` from `main` (USER); `release.yml` runs; verify.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json` | Modified | `version` 0.0.0 → 1.0.0 (SEA-baked source + npm publish version) |
| `src/index.ts` | Modified | `DBGRAPH_VERSION` 0.0.0 → 1.0.0 (npm `dist` off-SEA fallback) |
| `test/smoke.test.ts`, `test/cli/cli.test.ts`, `test/bin/dist-shebang.test.ts` | Modified | Move CURRENT-version asserts to 1.0.0 |
| `CHANGELOG.md` | New | Keep-a-Changelog `## [1.0.0]` from the 21 archived changes |
| `docs/release.md` | New | Ordered runbook: LOCAL prep + USER-GATED (warned) + post-release verification |
| `test/bin/npm-pack-whitelist.test.ts` | New | `npm pack --dry-run --json` → assert dist-only whitelist, no leaks |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bump package.json only → npm CLI reports `0.0.0` | High | Bump `DBGRAPH_VERSION` too; a test asserts BOTH; documented in Approach |
| Touch a historical/mechanism version literal → false churn or corrupted benchmark record | Med | Explicit FIX-vs-STAY table; define tests + benchmark rows are OUT of scope |
| Runbook implies an agent can tag/publish | High | Every irreversible step is USER-GATED and labeled with CI-cost + irreversibility; agents never fire them |
| `private: true` blocks publish; removing it early invites accidental publish | Med | Keep as a guard; runbook removes it in the SAME user step as `npm publish`, not before |
| `repository.url` (`ElkinDev/dbgraph`) ≠ npm scope (`@niklerk23/dbgraph`) may break provenance/release linkage | Med | OPEN QUESTION for the user — verify the canonical repo before tagging; do NOT auto-change |
| npm-pack gate flaky if `dist/` not built first | Low | Gate builds (or documents `npm run build` precondition) before packing |

## Rollback Plan

Fully reversible — no irreversible action is taken this phase. Revert the two version edits (`package.json`, `src/index.ts`) and the test asserts back to `0.0.0`; delete `CHANGELOG.md`, `docs/release.md`, and the npm-pack test. No tag, no publish, and no repo-visibility change occur here, so there is nothing external to undo. The existing suite returns to green at `0.0.0`.

## Dependencies

- Pre-merge git flow (USER): `closeout` PR → `main`; then push `v1-prep` → PR → merge. Tagging happens from `main` AFTER both merges.
- `release.yml` (already committed, trigger-guarded on `v*.*.*` tag + `workflow_dispatch`) — fires ONLY when the user pushes the tag.

## Success Criteria

- [ ] After `npm run build`, `node dist/cli.js --version` prints `1.0.0`; the SEA binary (when built) prints `1.0.0` (reads `package.json`).
- [ ] `package.json.version` === `DBGRAPH_VERSION` === `1.0.0`; `npm test` green (updated asserts) with define/smoke/benchmark records untouched.
- [ ] `CHANGELOG.md` has a truthful, user-facing `## [1.0.0]` entry covering the archived work.
- [ ] `docs/release.md` lists every step in order, each tagged LOCAL or USER-GATED, with CI-cost + irreversibility warnings on tag/publish/visibility.
- [ ] The npm-pack gate asserts the tarball is dist-only (+ package.json/README/LICENSE) with NO benchmark/openspec/scripts/test/src leakage.
- [ ] NO tag pushed, NOTHING published, repo visibility unchanged, `private: true` untouched by agents.
