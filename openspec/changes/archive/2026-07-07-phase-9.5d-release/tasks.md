# Tasks: v1.0.0 release preparation — version single-source, CHANGELOG, RELEASE runbook, npm-pack whitelist gate (phase-9.5d-release)

Standing header (every task): **STRICT TDD** — the failing `vitest` assertion PRECEDES the code (RED→GREEN→refactor).
**EXACT / golden-pinned** assertions ALWAYS (`.toBe`/`.toStrictEqual`); existence-only `.toBeDefined()` is FORBIDDEN.
Four fully-reversible deliverables, ZERO runtime behaviour change — the CLI `--version` CONTRACT (prints the version,
exits 0) is UNCHANGED; only the VALUE moves and two packaging gates are added. **TWO SOURCES OF TRUTH** move together
(`package.json.version` + `src/index.ts` `DBGRAPH_VERSION`) because the two channels resolve the version differently
(SEA bakes `package.json` via esbuild `define`; npm `dist` falls back to `DBGRAPH_VERSION`). **HONESTY is a spec-level
contract:** `docs/release.md` DOCUMENTS every irreversible step; agents FIRE none. **NO push / PR / gh / tag / publish
/ visibility flip / `private:true` removal** by any agent this phase — LOCAL commits only; `private: true`
(package.json:7) is UNTOUCHED. Strict TS (NO `any`, `exactOptionalPropertyTypes`); ENGLISH; conventional commits
referencing `phase-9.5d-release`, NO AI attribution. Leak-scan/denylist active — scan before EVERY commit.

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions + §Open Questions):
- **Drift guard = `test/bin/version-single-source.test.ts` (ALWAYS-ON).** `import { DBGRAPH_VERSION }` from
  `../../src/index.js`, `readFileSync` `package.json.version`, assert `pkg.version === DBGRAPH_VERSION === '1.0.0'`.
  Reads FILES only (NO build artifact) → runs unconditionally in `npm test`, **NO `skipIf`**. Triple-equality makes the
  #1 risk (bump one source, npm reports `0.0.0`) mechanically impossible to ship.
- **RED framing (NOT both-at-0.0.0):** with both literals still `0.0.0` the equality `pkg===DBGRAPH` PASSES but
  `=== '1.0.0'` FAILS → RED. Bumping BOTH literals → GREEN. This proves the two-source contract before anything else.
- **FIX / STAY partition (verified against code — NO global find-replace).** FIX exactly the current-app-version sites
  (table in B1.2); leave every mechanism/dynamic/historical literal untouched: the `9.9.9` override case (proves the
  env var wins regardless of app version), `esbuild-config` define inputs (`0.0.0`/`9.9.9` are arbitrary), the
  `pkgVersion`-reading `*.smoke.test.ts` (auto-track, excluded from `npm test`), and the benchmark Environment rows.
- **Pack gate = REAL `npm pack --dry-run --json`, backstopped by a `files` unit.** `test/bin/npm-pack-whitelist.test.ts`
  spawns the real packer, parses `result[0].files[].path`, asserts `allow = p==='package.json' || p==='README.md' ||
  p==='LICENSE' || p.startsWith('dist/')` and `forbid = /^(benchmark|openspec|scripts|test|src)\//`. **Windows gotcha:**
  `spawnSync('npm', …)` is ENOENT (npm is `npm.cmd`) — prefer `process.env.npm_execpath` via `process.execPath`, else
  `spawnSync('npm', …, { shell: true })`; PROBE first (`--version`, status 0) and `skipIf(!hasNpm)` (mirrors the
  `hasBash`/`hasPwsh` pattern in `install.smoke.test.ts`). The gate builds `dist/` OR documents `npm run build` as an
  explicit precondition so the list is complete (spec R2 S7). The always-on `files===['dist']` unit is the instant
  tripwire when npm/dist are absent.
- **README OPEN QUESTION is a FALSE PREMISE (RESOLVED 2026-07-07):** `README.md` EXISTS at the repo root (phase-7-docs,
  archive/2026-07-06-phase-7-docs). It STAYS in the pack allow-set (npm auto-includes it) — REQUIRED-present. No task.
- **CHANGELOG = ONE Keep-a-Changelog `## [1.0.0] - 2026-07-07`,** `### Added` grouped by area, distilled from the 21
  archived changes per the design §"CHANGELOG source mapping" table; TRUTHFUL — no unshipped claim (no macOS binary as
  delivered, nothing published). NOT in the npm tarball (`files:["dist"]`) — repo artifact only, consistent with the
  whitelist.
- **Runbook labels EVERY step LOCAL or USER-GATED** with an inline ⚠️ cost/irreversibility banner on every gated step;
  `private:true` removal is sequenced INSIDE the same user step as `npm publish` (never earlier); the
  `repository.url`(`ElkinDev/dbgraph`) vs npm-scope (`@niklerk23/dbgraph`) mismatch is a pre-tag USER verification item —
  SURFACED, never auto-changed.

Per-batch GATE (ALL pass before the next batch, then COMMIT): `npx tsc --noEmit` clean (strict, NO `any`) ·
`npm run lint` 0 errors / 0 warnings · `npm test` (`vitest run`) GREEN (baseline **3246** + the new drift guard + pack
`files` unit; the `npm pack` spawn `skipIf`s cleanly when npm/dist absent) · define/`9.9.9`/smoke/benchmark records
UNTOUCHED · `private:true` UNTOUCHED · leak-scan/denylist clean. Commit EACH batch (conventional, references
`phase-9.5d-release`, NO AI attribution, **NO push/PR/gh/tag/publish**).

## Batch B1: Two-source version bump behind an always-on drift guard + npm-pack whitelist gate (STRICT TDD, load-bearing)

> Satisfies `release-packaging` R1 (version single-valued at 1.0.0, guarded against divergence — S1 npm-dist fallback,
> S2 SEA baked, S3 divergence guard RED, S4 current-asserts-move/mechanism-stays) and R2 (npm-pack whitelist — S5
> whitelisted passes, S6 leak fails, S7 build precondition). CODE + STRICT TDD. The drift guard is the RED-first oracle
> that pins the two literals together BEFORE they move.

- [x] B1.1 **(vitest, RED)** Create `test/bin/version-single-source.test.ts` (always-on, NO `skipIf`):
  `import { DBGRAPH_VERSION } from '../../src/index.js'`, `readFileSync` + `JSON.parse` the repo-root `package.json`,
  assert `pkg.version === DBGRAPH_VERSION` AND `DBGRAPH_VERSION === '1.0.0'` with EXACT `.toBe`. Run `npm test` and
  OBSERVE **RED** — equality holds (both `0.0.0`) but `=== '1.0.0'` fails. This is the two-source contract, asserted
  before the bump. Spec R1 S3 "Divergence guard fails when the two sources disagree". Design §"Drift guard". Done: the
  guard exists and is RED against the `0.0.0` state.
- [x] B1.2 **(vitest, GREEN — two-source bump + FIX-list asserts)** Move EXACTLY the current-app-version sites to
  `1.0.0`, turning B1.1 GREEN; leave every STAY literal untouched:

  | Site | Line | Action |
  |------|------|--------|
  | `package.json` `"version"` | 3 | FIX `0.0.0`→`1.0.0` (`private:true` at :7 UNTOUCHED) |
  | `src/index.ts` `DBGRAPH_VERSION` | 9 | FIX `0.0.0`→`1.0.0` |
  | `test/smoke.test.ts` `toBe('0.0.0')` | 6 | FIX →`'1.0.0'` |
  | `test/cli/cli.test.ts` fallback-anchor `toBe('0.0.0')` (+ title text) | 279–281 | FIX →`'1.0.0'` |
  | `test/cli/cli.test.ts` `--version`/`-v` → `'0.0.0\n'` (2 tests) | 283–293 | FIX →`'1.0.0\n'` |
  | `test/bin/dist-shebang.test.ts` `--version` → `'0.0.0'` (+ title) | 60–63 | FIX →`'1.0.0'` (runs only when dist built) |
  | `test/cli/cli.test.ts` `DBGRAPH_BUILD_VERSION='9.9.9'` override | 295–300 | **STAY** — proves env override wins |
  | `test/bin/esbuild-config.test.ts` `versionDefine`/`buildOptions('0.0.0'\|'9.9.9')` | all | **STAY** — arbitrary inputs |
  | `test/bin/*.smoke.test.ts` (read `pkgVersion` dynamically) | — | **STAY** — auto-track, excluded from `npm test` |
  | benchmark Environment rows | — | **STAY** — historical record |

  Spec R1 S1 "npm dist channel prints 1.0.0 via the fallback constant", S2 "SEA channel prints 1.0.0 via the baked
  package.json version", S4 "Current-version asserts move; mechanism/historical sites stay". Design §"FIX / STAY
  inventory". Done: B1.1 GREEN; `npm test cli smoke` green; NO STAY literal moved.
- [x] B1.3 **(vitest, RED→GREEN — pack `files` unit, always-on)** Add to `test/bin/npm-pack-whitelist.test.ts` (new) a
  fast always-on unit: `readFileSync` `package.json`, assert `pkg.files` `.toStrictEqual(['dist'])`. RED first (assert
  before trusting), then GREEN against the existing `files:["dist"]` (package.json:11). This is the instant tripwire
  when npm/dist are absent. Spec R2 S5 "Whitelisted tarball passes the gate" (unit backstop). Design §"npm-pack gate".
  Done: `npm test npm-pack-whitelist` green.
- [x] B1.4 **(vitest, spawn — real packer, `skipIf` cross-platform)** In `test/bin/npm-pack-whitelist.test.ts` add the
  behavioural gate: PROBE npm (`--version`, status 0) via `process.env.npm_execpath` through `process.execPath`, else
  `spawnSync('npm', …, { shell: true })` (Windows `npm.cmd` ENOENT gotcha); `skipIf(!hasNpm)`. Build `dist/` first OR
  assert an explicit `npm run build` precondition (spec R2 S7). Spawn `npm pack --dry-run --json`, parse
  `result[0].files[].path`; assert EVERY entry ∈ `{p.startsWith('dist/'), 'package.json', 'README.md', 'LICENSE'}` and
  NO path matches `/^(benchmark|openspec|scripts|test|src)\//` — DIFF the full list against the whitelist (not a
  spot-check), reporting any offender. Spec R2 S5 "Whitelisted tarball passes the gate", S6 "Any source/test/tooling
  leak fails the gate", S7 "Gate builds or documents its build precondition". Design §"Interfaces / Contracts". Done:
  gate green with `dist/` built; `skipIf`s cleanly (leaving B1.3 the always-on backstop) when npm absent.
- [x] B1.5 GATE (Batch B1): `npx tsc --noEmit` clean (NO `any`); `npm run lint` 0/0; `npm test` GREEN (baseline 3246 +
  drift guard + pack `files` unit; the `npm pack` spawn green with `dist/` built or `skipIf` clean); the drift guard is
  ALWAYS-ON (no `skipIf`); `esbuild-config`/`9.9.9`/`*.smoke`/benchmark records UNTOUCHED; `private:true` (package.json:7)
  UNTOUCHED; leak-scan clean. Then COMMIT `feat(9.5d): bump version to 1.0.0 across both sources behind a drift guard +
  npm-pack whitelist gate`. Done: all gates green; both channels resolve `1.0.0`; whitelist enforced.

## Batch B2: CHANGELOG + honesty-annotated release runbook + final gate/DoD (docs, no test gate)

> Satisfies `release-packaging` R3 (truthful v1.0.0 CHANGELOG — S8 covers every shipped area, S9 truthful/accurate
> counts) and R4 (runbook labels LOCAL vs USER-GATED, no local step fires a gated action — S10 ordered+labeled, S11
> gated-step warnings, S12 honesty guard, S13 repository.url surfaced). DOCS only — no vitest gate; the honesty contract
> is the review oracle. Depends on B1 (the version is now truthfully `1.0.0`, which the runbook's phase-0 check asserts).

- [x] B2.1 **(doc)** Create `CHANGELOG.md` at the repo root, Keep-a-Changelog form, ONE `## [1.0.0] - 2026-07-07`
  entry with `### Added` grouped by area from the design §"CHANGELOG source mapping" table: Graph core & storage;
  5 schema-extraction engines (sqlite, sqlserver, pg, mysql, mongodb); structural inference; CLI/config/UX; MCP stdio +
  HTTP; multi-agent install (6 agents); win/linux SEA binaries; public docs & `--project`; honest benchmark; resilient
  connectivity. TRUTHFUL — every claim traces to an archived change/commit; accurate engine/agent counts; NO unshipped
  claim (NO macOS binary as delivered, NOTHING published). Spec R3 S8 "v1.0.0 entry exists and covers every shipped
  area", S9 "Entry is truthful — no unshipped claims, accurate counts". Design §"Decision: CHANGELOG". Done: the entry
  names all shipped areas and every line maps to shipped work.
- [x] B2.2 **(doc)** Create `docs/release.md` per design §"Runbook structure": (1) **Phase-0 state check** — `npm test`
  green, `git status` clean, on the intended branch, both version literals read `1.0.0`. (2) **LOCAL-done checklist**
  (pre-checked) — version bump, asserts moved, CHANGELOG, drift guard + pack gate green. (3) **USER-GATED ordered steps**,
  EACH with a ⚠️ cost/irreversibility banner: (a) merge `closeout` PR → `main`; (b) push `v1-prep` → PR → merge; (c) tag
  `v1.0.0` from `main` ⚠️ fires `release.yml` (win-x64 + linux-x64 legs, macOS leg PRESENT-BUT-DORMANT, provenance
  attestation, `gh release create`, burns CI quota); (d) `npm publish` — remove `private:true` in the SAME step (npm
  refuses a `private:true` package) ⚠️ version effectively non-reusable; (e) repo-visibility flip (deferred, user call);
  (f) pre-tag OPEN QUESTION — `repository.url`(`ElkinDev/dbgraph`) vs npm scope (`@niklerk23/dbgraph`), verify, do NOT
  auto-change. (4) **Rollback/abort table** (per-step honest caveats — tag/publish/visibility are NOT fully reversible;
  this phase's edits ARE). (5) **Post-release verification** — SEA binary from the GitHub release (SHA256 vs
  `SHA256SUMS`, `--version`→`1.0.0`), `npm install` smoke (`dbgraph --version`→`1.0.0`), record the macOS leg produced
  NO artifact (dormant). State EXPLICITLY that agents MUST NOT fire USER-GATED steps and NO LOCAL step pushes a tag,
  dispatches CI, publishes, flips visibility, or removes `private:true`. Spec R4 S10 "Every step is ordered and labeled
  LOCAL or USER-GATED", S11 "Every USER-GATED step carries an inline cost + irreversibility warning", S12 "No LOCAL step
  fires an irreversible or CI action", S13 "repository.url mismatch is surfaced, not decided". Design §"Runbook
  structure" + §"Rollback / abort". Done: every step ordered + labeled; every gated step warned; `private` removal in
  the publish step; `repository.url` surfaced.
- [x] B2.3 GATE (Batch B2 — FINAL): `npx tsc --noEmit` strict clean; `npm run lint` 0/0; `npm test` FULL GREEN
  (baseline 3246 + drift guard + pack `files` unit; `npm pack` spawn green or `skipIf` clean); after `npm run build`,
  `node dist/cli.js --version` prints `1.0.0`; `package.json.version === DBGRAPH_VERSION === '1.0.0'`; the pack gate
  reports dist-only + package.json/README/LICENSE, no leaks; `CHANGELOG.md` + `docs/release.md` present and honest;
  **NO tag pushed, NOTHING published, `private:true` UNTOUCHED, repo visibility unchanged** (inspect `git tag` — none;
  no `gh`/PR fired); leak-scan clean; nothing pushed past `closeout`. Trace the Definition of Done below. Then COMMIT
  `docs(9.5d): add v1.0.0 CHANGELOG + honesty-annotated release runbook`. Hand off to `sdd-verify`. Done: all gates
  green; repo truthfully `1.0.0`; no irreversible step fired.

## Apply Batch Grouping (one sub-agent session each)

- **Batch B1** (B1.1–B1.5): CODE + STRICT TDD — `version-single-source.test.ts` RED first, then the two-source bump
  (`package.json:3`, `src/index.ts:9`) + the FIX-list asserts → GREEN; `npm-pack-whitelist.test.ts` (`files` unit +
  real `npm pack --dry-run --json` spawn with cross-platform `skipIf`). The load-bearing batch: the drift guard pins
  the two literals together before they move.
- **Batch B2** (B2.1–B2.3): DOCS — `CHANGELOG.md` (Keep-a-Changelog `[1.0.0]`) + `docs/release.md` (LOCAL/USER-GATED
  ordered runbook, rollback table, post-release verification) + final gate/DoD trace. No test gate; the honesty contract
  is the review oracle. Hand off to verify.

### Parallel vs sequential

- **Batches are SEQUENTIAL: B1 → B2.** B2's runbook phase-0 check asserts both literals read `1.0.0` — it cannot be
  truthful until B1 lands the bump. Within B1, B1.1→B1.2 are strictly ordered (RED then GREEN — the guard must be RED
  first, then the bump turns it GREEN); B1.3 (`files` unit) and B1.4 (spawn gate) are independent of the version bump
  but live in the same new file (one session, not split). Within B2, B2.1 (CHANGELOG) and B2.2 (runbook) are
  independent docs.

### Dependency bottlenecks

- **The drift guard is the single load-bearing gate.** Its triple-equality is what makes proposal risk #1 (bump one
  source, npm reports `0.0.0`) mechanically impossible — it MUST be RED before the bump and GREEN after, or the
  two-source contract was never proven. Do NOT bump the literals before writing the guard.
- **`skipIf` correctness is the CI-independence sharp edge.** The `npm pack` spawn MUST `skipIf(!hasNpm)` and handle the
  Windows `npm.cmd` ENOENT gotcha (`npm_execpath`/`shell:true`); mislabeling it as always-on would break `npm test` on a
  clean machine. The `files===['dist']` unit is the always-on backstop that stays green regardless.
- **HONESTY is the B2 sharp edge (spec-level contract).** A runbook step that reads as agent-executable but fires a
  USER-GATED action (CI, tag, publish, visibility flip, `private` removal) is a SPEC VIOLATION (R4 S12), not a
  convenience. `private:true` removal MUST sit inside the `npm publish` step (R4 S11), and `repository.url` MUST be
  surfaced, never auto-changed (R4 S13).
- **STAY literals are the false-churn trap.** A global `0.0.0`→`1.0.0` replace corrupts the `esbuild-config` mechanism
  inputs, the `9.9.9` override proof, the dynamic `*.smoke` readers, and the benchmark record (proposal risk #2). FIX
  only the six current-app-version sites in B1.2's table.

## Definition of Done (tied to the proposal's Success Criteria; 13 spec scenarios across 4 requirements traced)

- [x] After `npm run build`, `node dist/cli.js --version` prints `1.0.0` via the `DBGRAPH_VERSION` fallback; the SEA
  channel bakes `package.json.version`→`1.0.0`. — B1.2, B2.3 [R1 S1 "npm dist channel prints 1.0.0 via the fallback
  constant", S2 "SEA channel prints 1.0.0 via the baked package.json version"]
- [x] `package.json.version === DBGRAPH_VERSION === '1.0.0'`, pinned by an always-on guard that goes RED if either is
  bumped without the other. — B1.1 (RED), B1.2 (GREEN) [R1 S3 "Divergence guard fails when the two sources disagree"]
- [x] ONLY the six current-app-version asserts move to `1.0.0`; the `9.9.9` override, `esbuild-config` define inputs,
  dynamic `*.smoke` readers, and benchmark Environment rows STAY. — B1.2 [R1 S4 "Current-version asserts move;
  mechanism/historical sites stay"]
- [x] An `npm test`-resident gate runs `npm pack --dry-run --json` and asserts the tarball is EXACTLY `dist/**` +
  `package.json` + `README.md` + `LICENSE`, diffing the full list; any `benchmark/openspec/scripts/test/src` entry
  FAILS with the offender named; the gate builds `dist/` or documents `npm run build`; the `files===['dist']` unit is
  the always-on backstop. — B1.3, B1.4 [R2 S5 "Whitelisted tarball passes the gate", S6 "Any source/test/tooling leak
  fails the gate", S7 "Gate builds or documents its build precondition"]
- [x] `CHANGELOG.md` has ONE truthful Keep-a-Changelog `## [1.0.0] - 2026-07-07` covering all shipped areas (5 engines,
  inference, MCP stdio+HTTP, install for 6 agents, win/linux binaries, docs, benchmark) with accurate counts and NO
  unshipped claim. — B2.1 [R3 S8 "v1.0.0 entry exists and covers every shipped area", S9 "Entry is truthful — no
  unshipped claims, accurate counts"]
- [x] `docs/release.md` is an ordered checklist, EVERY step labeled LOCAL or USER-GATED, each gated step (tag push,
  `npm publish`, `private` removal, visibility flip, PR merge) carrying an inline cost/irreversibility warning; NO LOCAL
  step fires a gated action (stated explicitly); `private` removal sits inside the publish step; the `repository.url`
  mismatch is surfaced pre-tag; ends with post-release verification. — B2.2 [R4 S10 "Every step is ordered and labeled
  LOCAL or USER-GATED", S11 "Every USER-GATED step carries an inline cost + irreversibility warning", S12 "No LOCAL step
  fires an irreversible or CI action", S13 "repository.url mismatch is surfaced, not decided"]
- [x] `npx tsc --noEmit` strict clean; `npm run lint` 0/0; `npm test` GREEN (baseline 3246 + drift guard + pack unit);
  NO tag pushed, NOTHING published, repo visibility unchanged, `private:true` UNTOUCHED by agents; leak-scan clean —
  proven LOCALLY, nothing pushed past `closeout`. — every batch GATE (B1.5, B2.3)
