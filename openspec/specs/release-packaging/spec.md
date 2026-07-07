# Release Packaging Specification

## Purpose

The v1.0.0 RELEASE-MECHANICS layer: making the repository TRUTHFULLY report `1.0.0`
across both distribution channels, gating what actually ships in the npm tarball, and
handing the user ONE ordered, honesty-annotated runbook — all provable under `npm test`
WITHOUT firing any irreversible step. It covers four invariants: (1) the version
single-value contract — `--version` prints `1.0.0` from BOTH the npm `dist` fallback
constant `DBGRAPH_VERSION` (`src/index.ts`) and the SEA-baked `package.json.version`
(esbuild `define` → `DBGRAPH_BUILD_VERSION`), pinned by a guard that goes RED if the two
sources diverge; (2) the npm-pack tarball whitelist — `dist/**` + `package.json` +
`README.md` + `LICENSE` and NOTHING else; (3) a truthful `CHANGELOG.md` `## [1.0.0]`
entry distilled from the 21 archived changes; (4) a `docs/release.md` runbook that labels
every step LOCAL (agent-executable) vs USER-GATED (tag push / npm publish / `private`
flip / repo-visibility flip / PR merge) with inline cost + irreversibility warnings.
This capability PACKAGES and DOCUMENTS existing behavior — the CLI `--version` CONTRACT
(prints the version, exits 0) is unchanged; only the VALUE moves and the packaging gates
are added. No tag is pushed, nothing is published, and `private: true` is untouched by
any agent in this phase.

> **HONESTY is a spec-level contract, not a suggestion.** LOCAL steps are agent-executable
> and reversible; USER-GATED steps are irreversible and cost-bearing (CI minutes, a macOS
> build leg, a public npm artifact, a public repo). A scenario in which an agent-executable
> step fires a USER-GATED action (CI, tag, publish, visibility flip) is a SPEC VIOLATION,
> not a convenience. The runbook DOCUMENTS the gated steps; the user FIRES them.

> **OPEN QUESTION (for design / the user — this spec DECIDES nothing here):** the
> `repository.url` (`github.com/ElkinDev/dbgraph`) does NOT match the npm publish scope
> (`@niklerk23/dbgraph`). This may break provenance / release linkage. The runbook MUST
> SURFACE this as a pre-tag verification item; it MUST NOT auto-change either value.

## Requirements

### Requirement: Version is single-valued at 1.0.0 across both channels, guarded against divergence

The application SHALL report `1.0.0` from `--version` on BOTH distribution channels. On the
npm `dist` channel (`DBGRAPH_BUILD_VERSION` env ABSENT) the CLI MUST fall back to the
`DBGRAPH_VERSION` constant in `src/index.ts`, which MUST be `1.0.0`. On the SEA-binary
channel the esbuild `define` MUST bake `package.json.version` into `DBGRAPH_BUILD_VERSION`,
which MUST be `1.0.0`. The two sources of truth — `package.json.version` and
`DBGRAPH_VERSION` — MUST hold the SAME value; a guard test MUST assert
`package.json.version === DBGRAPH_VERSION` and MUST turn RED if either is bumped without
the other. ONLY the tests that assert the CURRENT application version move to `1.0.0`;
mechanism, dynamic, and historical version sites MUST stay unchanged.

#### Scenario: npm dist channel prints 1.0.0 via the fallback constant

- GIVEN a freshly built `dist/cli.js` run with `DBGRAPH_BUILD_VERSION` UNSET
- WHEN `--version` (or `-v`) is invoked
- THEN it exits 0 and prints EXACTLY `1.0.0\n`, resolved from the `DBGRAPH_VERSION` fallback

#### Scenario: SEA channel prints 1.0.0 via the baked package.json version

- GIVEN a SEA binary whose `DBGRAPH_BUILD_VERSION` was baked from `package.json.version`
- WHEN `--version` is invoked with NO `node_modules` present
- THEN it exits 0 and prints EXACTLY `1.0.0\n`, matching `package.json.version`

#### Scenario: Divergence guard fails when the two sources disagree

- GIVEN a guard test comparing `package.json.version` with the `DBGRAPH_VERSION` constant
- WHEN both equal `1.0.0`
- THEN the guard PASSES
- AND WHEN either value is changed without the other (e.g. only `package.json` bumped) the guard test FAILS (RED)

#### Scenario: Current-version asserts move; mechanism/historical sites stay

- GIVEN the version-assert sites in the suite
- WHEN the change is applied
- THEN `test/smoke.test.ts`, `test/cli/cli.test.ts` (`--version`/`-v` prints and the current-version anchor) and `test/bin/dist-shebang.test.ts` assert `1.0.0`
- AND the `esbuild-config` define parameterization inputs (`0.0.0`/`9.9.9`), the dynamic `pkgVersion` smoke readers, and the benchmark Environment rows remain UNCHANGED

### Requirement: npm-pack tarball contains only the dist whitelist and no source/test/tooling

An automated gate in `npm test` SHALL run `npm pack --dry-run --json` and assert the tarball
file list equals EXACTLY the allowed set: `dist/**`, `package.json`, `README.md`, and
`LICENSE`. The gate MUST FAIL if ANY of `benchmark/`, `openspec/`, `scripts/`, `test/`, or
`src/` appears in the tarball. The assertion MUST diff the actual packed file list against
the whitelist (not merely spot-check one path). The gate MUST build `dist/` first OR document
`npm run build` as a precondition so the packed list is complete and the check is not flaky.

#### Scenario: Whitelisted tarball passes the gate

- GIVEN a built `dist/` and the packaging gate running `npm pack --dry-run --json`
- WHEN the packed file list is compared to the whitelist
- THEN every entry is under `dist/`, or is `package.json`, `README.md`, or `LICENSE`
- AND the gate exits green with no extra files reported

#### Scenario: Any source/test/tooling leak fails the gate

- GIVEN a packaging configuration that would include a non-whitelisted path
- WHEN the gate diffs the packed file list against the whitelist
- THEN the presence of ANY `benchmark/`, `openspec/`, `scripts/`, `test/`, or `src/` entry causes the gate to FAIL with the offending path(s) reported

#### Scenario: Gate builds or documents its build precondition

- GIVEN the packaging gate about to run `npm pack`
- WHEN `dist/` is required for a complete file list
- THEN the gate either builds `dist/` itself or asserts an explicit `npm run build` precondition, so the whitelist check is deterministic

### Requirement: CHANGELOG carries a truthful v1.0.0 entry covering the shipped areas

`CHANGELOG.md` SHALL exist at the repository root in Keep-a-Changelog form with exactly one
`## [1.0.0]` entry. That entry MUST group the user-facing summary by the shipped areas: the
5 database engines, structural inference, MCP (stdio + HTTP), install for 6 agents, the
win/linux SEA binaries, public docs, and the benchmark. The content MUST be TRUTHFUL —
distilled from the 21 archived changes (proposals / archive-reports, conventional-commit
history as source of truth) — with accurate dates and counts, and MUST NOT claim any
feature that did not ship (e.g. no macOS binary as delivered, nothing published).

#### Scenario: v1.0.0 entry exists and covers every shipped area

- GIVEN `CHANGELOG.md` at the repository root
- WHEN the `## [1.0.0]` section is read
- THEN it names all shipped areas: 5 engines, structural inference, MCP stdio + HTTP, install for 6 agents, win/linux binaries, docs, and benchmark

#### Scenario: Entry is truthful — no unshipped claims, accurate counts

- GIVEN the `## [1.0.0]` entry cross-checked against the 21 archived changes
- WHEN each listed item is traced to an archived change or commit
- THEN every claim maps to shipped work, engine/agent counts are accurate, and no not-yet-shipped item (e.g. a published npm package or a macOS binary) is asserted as delivered

### Requirement: Release runbook labels every step LOCAL vs USER-GATED and no local step fires a gated action

`docs/release.md` SHALL exist as an ORDERED release checklist. Every step MUST be labeled
either LOCAL (agent-executable, reversible) or USER-GATED (user-only, irreversible /
cost-bearing). Every USER-GATED step — pushing the `v1.0.0` tag (fires `release.yml` → CI
cost + macOS build leg + `gh release create`), `npm publish`, removing `private: true`,
flipping the GitHub repo public, and merging PRs — MUST carry an INLINE cost + irreversibility
warning at that step. NO LOCAL / agent-executable step may fire CI, push a tag, publish, flip
visibility, or remove `private: true`; the runbook MUST state this guard explicitly. The
`private: true` removal MUST be sequenced INSIDE the same user step as `npm publish`, never
earlier. The runbook MUST include the pre-tag `repository.url`-vs-npm-scope verification item
(see open question) and post-release verification (binary smoke from the GitHub release +
`npm install` smoke).

#### Scenario: Every step is ordered and labeled LOCAL or USER-GATED

- GIVEN `docs/release.md`
- WHEN its checklist is read top to bottom
- THEN the steps are in execution order and EACH is tagged either LOCAL or USER-GATED, ending with post-release verification (release-binary smoke + `npm install` smoke)

#### Scenario: Every USER-GATED step carries an inline cost + irreversibility warning

- GIVEN the USER-GATED steps (tag push, `npm publish`, `private` removal, repo-visibility flip, PR merge)
- WHEN each is read
- THEN it carries an inline warning naming its CI cost and/or irreversibility, and the `private: true` removal is placed in the SAME step as `npm publish` (not before)

#### Scenario: No LOCAL step fires an irreversible or CI action (honesty guard)

- GIVEN the LOCAL / agent-executable steps in the runbook
- WHEN they are inspected
- THEN NONE pushes a tag, dispatches `release.yml`, runs `npm publish`, flips repo visibility, or removes `private: true`
- AND the runbook explicitly states that agents MUST NOT fire USER-GATED steps

#### Scenario: repository.url mismatch is surfaced, not decided

- GIVEN the `repository.url` (`ElkinDev/dbgraph`) differs from the npm scope (`@niklerk23/dbgraph`)
- WHEN the runbook reaches its pre-tag verification
- THEN it flags the mismatch as a user verification item and CHANGES neither value automatically
