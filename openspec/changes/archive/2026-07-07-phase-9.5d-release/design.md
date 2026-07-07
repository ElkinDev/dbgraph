# Design: v1.0.0 release preparation — version single-source, CHANGELOG, RELEASE runbook, npm-pack gate (phase-9.5d)

## Technical Approach

Four independent, fully-reversible deliverables, no runtime behaviour change. (1) Bump the version at BOTH sources of truth (`package.json.version`, `src/index.ts` `DBGRAPH_VERSION`) and move ONLY the current-version asserts — mechanism/dynamic/historical literals stay. (2) Add a load-bearing drift guard that fails RED the instant the two sources disagree or either leaves `1.0.0`. (3) Add an `npm test`-resident npm-pack whitelist gate that spawns real `npm pack --dry-run --json` and asserts the tarball is dist-only (leak-scan enforcement). (4) Author `CHANGELOG.md` (Keep-a-Changelog) and `docs/release.md` (the honesty-annotated runbook) — the runbook DOCUMENTS every irreversible step; agents FIRE none. This maps directly to the proposal's Approach: two channels resolve the version differently, so both literals must move, and a single test must pin them together.

## Architecture Decisions

### Decision: Drift guard lives in `test/bin/version-single-source.test.ts`
**Choice**: A new always-on `.test.ts` that `import { DBGRAPH_VERSION }` from `../../src/index.js`, reads `package.json.version` from disk (`readFileSync`), and asserts `pkg.version === DBGRAPH_VERSION === '1.0.0'`. | **Alternatives**: fold the check into `test/smoke.test.ts`; a new `test/release/` dir. | **Rationale**: `test/bin/` is already the established home for release/build/version guards (`dist-shebang`, `esbuild-config`, `release-workflow`, `asset-name`). It reads files only — NO build artifact — so it runs unconditionally in `npm test` (no `skipIf`). Triple-equality makes the #1 proposal risk (bump one source, npm reports `0.0.0`) mechanically impossible to ship. `smoke.test.ts` stays the trivial scaffold assertion; the cross-source invariant earns its own named, self-documenting file.

### Decision: Two-source bump with an explicit FIX/STAY partition
**Choice**: Edit exactly the current-app-version sites; leave every mechanism/dynamic/historical literal untouched (table below). | **Alternatives**: global find-replace `0.0.0`→`1.0.0`. | **Rationale**: `esbuild-config.test.ts` uses `'0.0.0'`/`'9.9.9'` as ARBITRARY define inputs; the `9.9.9` override case proves the env var wins regardless of app version; `*.smoke.test.ts` read `pkgVersion` dynamically and auto-track; benchmark rows are a historical record. A blind replace corrupts the mechanism tests and the benchmark trail (proposal risk #2).

### Decision: npm-pack gate = real `npm pack --dry-run --json`, backstopped by a `files` unit
**Choice**: `test/bin/npm-pack-whitelist.test.ts` (a `.test.ts`, so it runs in `npm test`) spawns `npm pack --dry-run --json`, parses `result[0].files[].path`, asserts (a) every entry ∈ {`dist/**`, `package.json`, `README.md`, `LICENSE`} and (b) NO path starts with `benchmark/`, `openspec/`, `scripts/`, `test/`, `src/`. PLUS a fast always-on unit asserting `pkg.files` deep-equals `['dist']`. | **Alternatives**: runbook-only manual check; `files`-whitelist unit ALONE. | **Rationale**: spawning the REAL packer is the STRONGEST mechanically-enforceable option — it validates npm's actual inclusion rules (`.npmignore`, `directories`, always-included set), not a proxy. Precedent exists: `dist-shebang.test.ts` already spawns a subprocess inside `npm test`, gated by artifact presence. The benchmark-independence guard is scoped to `benchmark/` only, so a `test/bin/` spawn is not in conflict. Defense-in-depth: the `files===['dist']` unit is the instant tripwire when npm/dist are absent; the spawn is the behavioural truth.

### Decision: CHANGELOG = one Keep-a-Changelog `## [1.0.0] - 2026-07-07` with area subsections
**Choice**: Single release section, `### Added` grouped by area, distilled from the 21 archived proposals/archive-reports (mapping below); honest date = today. | **Alternatives**: per-phase changelog entries; Unreleased section. | **Rationale**: v1.0.0 is the first public cut — one honest, user-facing section beats 21 internal-phase entries. `files: ["dist"]` means CHANGELOG is NOT in the npm tarball (repo artifact only) — consistent with the whitelist, no conflict.

### Decision: Runbook labels every step LOCAL or USER-GATED with inline cost/irreversibility
**Choice**: `docs/release.md` = phase-0 state check → LOCAL-done checklist → USER-GATED ordered steps (each with a ⚠️ CI-cost + irreversibility banner) → post-release verification. Agents never fire USER-GATED steps. | **Alternatives**: a flat "how to release" doc. | **Rationale**: HONESTY is the product here — the reader must never mistake a documented step for an executed one. Every quota-burning or irreversible action is explicitly the USER's to trigger.

## FIX / STAY inventory (verified against code)

| Site | Line | Action |
|------|------|--------|
| `package.json` `version` | 3 | FIX `0.0.0`→`1.0.0` |
| `src/index.ts` `DBGRAPH_VERSION` | 9 | FIX `0.0.0`→`1.0.0` |
| `test/smoke.test.ts` `toBe('0.0.0')` | 6 | FIX →`'1.0.0'` |
| `test/cli/cli.test.ts` fallback-anchor `toBe('0.0.0')` (+ its title text) | 279–281 | FIX →`'1.0.0'` |
| `test/cli/cli.test.ts` `--version`/`-v` → `'0.0.0\n'` (2 tests) | 283–293 | FIX →`'1.0.0\n'` |
| `test/bin/dist-shebang.test.ts` `--version` → `'0.0.0'` (+ title) | 60–63 | FIX →`'1.0.0'` (runs only when dist built) |
| `test/cli/cli.test.ts` `DBGRAPH_BUILD_VERSION='9.9.9'` override case | 295–300 | **STAY** — proves env override wins |
| `test/bin/esbuild-config.test.ts` `versionDefine`/`buildOptions('0.0.0'\|'9.9.9')` | all | **STAY** — arbitrary mechanism inputs |
| `test/bin/*.smoke.test.ts` (read `pkgVersion` dynamically) | — | **STAY** — auto-track, excluded from `npm test` |
| benchmark Environment rows | — | **STAY** — historical record |

## CHANGELOG source mapping (21 archived changes → areas)

| Area | Archived changes |
|------|------------------|
| Graph core & storage | phase-1-graph-core; phase-9.5b-graphstore-node-sqlite |
| Schema-extraction engines | phase-2-sqlite; phase-3-sqlserver; phase-8a-pg; phase-8b-mysql; phase-9b-mongodb; sqlite-view-deps |
| Structural inference | phase-9a-inference-engine |
| CLI, config & UX | phase-4-cli-config; ux-observability; explore-payloads |
| MCP server + HTTP | phase-5-mcp-server; http-transport |
| Install (multi-agent) | phase-9.5a-multi-agent-install |
| Standalone binaries | phase-9.5c-binaries |
| Public docs & `--project` | phase-7-docs |
| Benchmark (honest) | phase-benchmark; benchmark-harness-hardening |
| Resilient connectivity | connectivity-strategies; resilient-connectivity |

## Data Flow (version resolution — why both must move)

    package.json.version ─┬─ build-bundle.mjs (esbuild define) ─→ SEA binary  --version → 1.0.0
                          └─ npm publish version
    src/index.ts DBGRAPH_VERSION ─ tsup (NO define) ─→ dist/cli.js fallback  --version → 1.0.0
                          ▲
       version-single-source.test.ts asserts pkg.version === DBGRAPH_VERSION === '1.0.0'

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | `version` 0.0.0→1.0.0 (`private:true` UNTOUCHED) |
| `src/index.ts` | Modify | `DBGRAPH_VERSION` 0.0.0→1.0.0 |
| `test/smoke.test.ts`, `test/cli/cli.test.ts`, `test/bin/dist-shebang.test.ts` | Modify | FIX current-version asserts to 1.0.0 |
| `test/bin/version-single-source.test.ts` | Create | Triple-equality drift guard (always-on) |
| `test/bin/npm-pack-whitelist.test.ts` | Create | `npm pack --dry-run --json` whitelist + `files===['dist']` unit |
| `CHANGELOG.md` | Create | Keep-a-Changelog `## [1.0.0] - 2026-07-07` |
| `docs/release.md` | Create | LOCAL / USER-GATED ordered runbook |

## Interfaces / Contracts

```
npm pack --dry-run --json → [ { files: [{ path: string, size, mode }, ...], ... } ]
allow  = p === 'package.json' || p === 'README.md' || p === 'LICENSE' || p.startsWith('dist/')
forbid = /^(benchmark|openspec|scripts|test|src)\//.test(p)
```
Gotcha: on Windows `spawnSync('npm', …)` is ENOENT (npm is `npm.cmd`). Prefer `process.env.npm_execpath` (set when run via `npm test`) invoked through `process.execPath`, else `spawnSync('npm', …, { shell: true })`. Probe first (`--version`, status 0) and `skipIf(!hasNpm)`, mirroring the `hasBash`/`hasPwsh` pattern in `install.smoke.test.ts`.

## Runbook structure (`docs/release.md`)

1. **Phase-0 state check** — verify `npm test` green, `git status` clean, on the intended branch, both version literals read `1.0.0`.
2. **LOCAL-done checklist** (pre-checked) — version bump, asserts moved, CHANGELOG, drift guard + pack gate green.
3. **USER-GATED ordered steps** (each with ⚠️ cost/irreversibility banner):
   a. Merge the `closeout` PR → `main`.
   b. Push `v1-prep` → open PR → merge → `main`.
   c. Tag `v1.0.0` from `main`. ⚠️ Fires `release.yml`: win-x64 + linux-x64 build legs, macOS leg PRESENT-BUT-DORMANT (no-op `exit 0`), provenance attestation, `gh release create`. Burns CI quota.
   d. Publish decision: `npm publish` — remove `private: true` in the SAME step (npm refuses to publish a `private:true` package). ⚠️ Version number is effectively non-reusable.
   e. Repo-visibility decision: flip public (deferred; user call).
   f. OPEN QUESTION to resolve BEFORE tagging: `repository.url` = `ElkinDev/dbgraph` vs npm scope `@niklerk23/dbgraph`.
4. **Post-release verification** — download the SEA binary from the GitHub release, verify SHA256 against `SHA256SUMS`, run `--version` → `1.0.0`; `npm install` smoke → `dbgraph --version` → `1.0.0`; record that the macOS leg produced NO artifact this release (dormant).

## Rollback / abort (per USER step — honest limits)

| Step | Abort | Honest caveat |
|------|-------|---------------|
| Tag pushed | `git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0` | GitHub KEEPS the Actions run history; the Release and provenance attestation are NOT auto-deleted (`gh release delete`; attestation is logged in the public transparency log — permanent). |
| `npm publish` | `npm unpublish` | Allowed only < 72h AND if nothing depends on it; the version number can NEVER be reused. |
| `private:true` removed | Re-add before publish | Moot once published. |
| Repo flipped public | Flip back to private | Clones/forks/caches made during the public window persist. |
| This phase's edits | Revert 2 literals + moved asserts to `0.0.0`; delete CHANGELOG/release.md/2 new tests | Fully reversible — nothing external was fired. |

## Migration / Rollout

No data migration. `.dbgraph` DB format unchanged. Pure documentation + test + constant edits. The SEA bundle stays deterministic (ADR-008): bumping `package.json` re-bakes the same literal via `define`, byte-identical given the pinned Node.

## Apply Batch Ordering (TDD)

1. **Drift guard first (RED)** — add `version-single-source.test.ts` expecting `1.0.0` → RED, then bump both literals + move the current-version asserts → GREEN. Proves the two-source contract before anything else.
2. **Pack gate** — add `npm-pack-whitelist.test.ts` (+ `files` unit); GREEN with `files:["dist"]`.
3. **Docs** — `CHANGELOG.md` + `docs/release.md` (no test gate).

## Open Questions

- [x] ~~No root README.md exists~~ **RESOLVED — FALSE PREMISE (orchestrator verification 2026-07-07)**: `README.md` EXISTS at the repo root, tracked, rewritten by phase-7-docs (archive/2026-07-06-phase-7-docs) with the cited feature matrix. The pack gate keeps `README.md` in the allowed set (npm auto-includes it); it is REQUIRED-present in practice. No decision needed.
- [ ] `repository.url` (`ElkinDev/dbgraph`) ≠ npm scope (`@niklerk23/dbgraph`) — verify the canonical repo before tagging (provenance/linkage). Do NOT auto-change.
- [ ] Confirm the `npm pack` spawn resolves cross-platform under CI (`npm_execpath` vs `shell:true`); if npm is unavailable the suite must `skipIf` cleanly, leaving the `files` unit as the always-on backstop.
