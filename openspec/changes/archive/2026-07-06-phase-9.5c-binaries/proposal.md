# Proposal: Standalone binaries via Node SEA — esbuild bundle, release workflow, installers (phase-9.5c)

## Intent

9.5b removed the last native dependency from the storage WRITE path (`WritableSqliteHandle` +
`nodeSqliteHandle`), so the local `.dbgraph` index now runs with ZERO native modules on
`node:sqlite`. That was the PREREQUISITE for standalone binaries. 9.5c realizes **US-037**'s "no
Node.js required" parity with codegraph: single-file, self-contained **win-x64 + linux-x64**
binaries a user downloads and runs with no Node and no `node_modules`. The user has RATIFIED
**Node SEA** over `bun build --compile` (single toolchain, `node:sqlite` alignment from 9.5b, no
second runtime). This phase formalizes that decision in **ADR-009** and ships the LOCAL,
CI-quota-safe half: an esbuild bundle + SEA assembly runnable on the dev machine (Windows native,
Linux via Docker), plus a WRITTEN-but-NEVER-FIRED release workflow and checksum-verifying
installers. Success: a binary runs `--help`/`--version` and a real `query` against an existing
graph with `node_modules` absent.

> Note: the task brief said "US-036 area". Verified against `docs/stories/07-quality-publication.md`
> — US-036 is "v0.1 publication"; the binaries story is **US-037**. This proposal targets US-037.

## Scope

### In Scope
- **ADR-009** (`docs/adr/009-*.md`, existing concise format): Node SEA vs bun rationale (single
  toolchain, `node:sqlite` alignment, no second runtime), tradeoffs (binary size, SEA experimental
  stability, `node:sqlite` runtime), decision drivers; explicitly REFINES ADR-006's "static
  bundling in the binaries" clause (see Risks). Authored in the apply phase; decision content is
  captured here.
- **esbuild bundle**: one self-contained bundle of the combined CLI+MCP entry. `better-sqlite3` +
  the 5 DB drivers stay EXTERNAL, lazy, OPTIONAL dynamic imports (ADR-006) — the "works without any
  driver installed" guarantee is PRESERVED; graph reads run on `node:sqlite` in-binary (9.5b seam).
- **SEA assembly**: `sea-config.json` + `postject` injection for win-x64 + linux-x64, runnable
  LOCALLY (Windows native; Linux via Docker). Smoke tests: binary runs `--help`, `--version`, and a
  real `query` against an existing `.dbgraph` graph with NO `node_modules` present.
- **`release.yml`**: matrix (windows/linux/macos), builds bundle+binary, `SHA256SUMS`, artifact
  attestation/provenance — WRITTEN, trigger-guarded (tag-push + `workflow_dispatch` ONLY; never
  branch push / `pull_request`), NEVER fired.
- **Installers**: `install.ps1` (`irm|iex`) + `install.sh` (`curl|sh`) — fetch a released binary by
  version/platform, verify SHA256 BEFORE install, place on PATH.

### Out of Scope
- Publishing an actual release / pushing any tag; **macOS** binaries (need CI runners) — deferred to
  **9.5d** (v1.0, blocked on CI-quota refresh); arm64 binaries.
- npm-publish changes; code signing / notarization.
- Firing ANY CI (quota exhausted).
- Runtime-behavior changes to existing capabilities (extraction, query, MCP) — PACKAGING only.

## Capabilities

### New Capabilities
- `binary-distribution`: esbuild bundle contract (drivers external/optional preserved), SEA assembly
  + local no-`node_modules` smoke tests, trigger-guarded release workflow, checksum-verifying
  installers.

### Modified Capabilities
- None. The binary PACKAGES existing behavior; no existing capability's REQUIREMENTS change.
  ADR-006's "works without any driver installed" runtime guarantee is PRESERVED, not altered.

## Approach

Node SEA (ratified). esbuild produces one bundled entry from `src/cli/cli.ts` (MCP reachable via a
subcommand or a second entry — design decides single-dispatch vs two binaries), marking
`better-sqlite3` + the 5 `optionalDependencies` as `external` so lazy `import()` semantics survive:
a binary with no resolvable driver still serves graph reads on `node:sqlite`.
`node --experimental-sea-config sea-config.json` builds the blob; `postject` injects it into a
copied Node binary; the build Node version is PINNED (LTS >=22) for determinism (ADR-008). Windows
runs the steps natively; Linux runs the SAME steps inside a Docker container (Docker is already used
by the Testcontainers integration suite). `release.yml` mirrors `ci.yml`'s proven trigger-guard
discipline (`workflow_dispatch` + `if:` gates, concurrency cancel) but restricted to
tag-push/dispatch — no tag is pushed here. Installers are pure shell, no runtime deps (ADR-007
spirit), and FAIL CLOSED on SHA256 mismatch.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `docs/adr/009-node-sea-standalone-binaries.md` | New | ADR formalizing SEA; refines ADR-006 bundling clause. |
| `scripts/build-bundle.*` (+ esbuild config) | New | Single-file bundle; drivers + better-sqlite3 marked `external`. |
| `sea-config.json` + `scripts/build-sea.*` (ps1 + sh/Docker) | New | SEA blob + postject injection, win + linux. |
| `test/**/binary-smoke.*` | New | No-`node_modules` smoke (`--help`/`--version`/`query`). |
| `.github/workflows/release.yml` | New | Trigger-guarded (tag + dispatch only); NEVER fired. |
| `install.ps1`, `install.sh` | New | Checksum-verifying installers. |
| `package.json` (scripts) | Modified | Add `bundle` / `build:sea`; better-sqlite3 + 5 drivers stay external. |
| `docs/stories/07-quality-publication.md` (US-037) | Modified | Reconcile "5 drivers statically bundled" AC (see Risks). |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ADR-006 + US-037 AC say "5 drivers STATICALLY bundled"; 9.5c keeps them EXTERNAL/optional — DIRECT conflict. | High | ADR-009 explicitly refines/supersedes that clause; DESIGN decides the driver-resolution model for a no-`node_modules` binary (read/serve-first on `node:sqlite`; live-DB indexing loads drivers from a resolvable sidecar or npm install). Flag to design. |
| Node SEA is experimental (stability 1.1) — behavior may shift across Node minors. | Med | Pin the exact build Node version (LTS >=22); document it in ADR-009; determinism per ADR-008. |
| `node:sqlite` may require `--experimental-sqlite` at runtime on the pinned Node; a SEA binary can't take CLI flags easily. | Med | Confirm against pinned Node in design; embed the flag via SEA exec-args / `NODE_OPTIONS` if required; 9.5b already validated `node:sqlite` on Node 22. |
| Accidentally firing CI burns exhausted quota. | High | `release.yml` triggers restricted to tag-push + `workflow_dispatch` ONLY; NO branch push / `pull_request`; no tag pushed this phase; mirror `ci.yml` concurrency-cancel. |
| Bundling inlines a driver and breaks "works without any driver". | Med | Mark better-sqlite3 + 5 drivers `external`; smoke test asserts the binary runs with `node_modules` ABSENT and no driver installed. |
| macOS binary needs a CI runner (no local macOS). | Low (scoped out) | Deferred to 9.5d; `release.yml` carries the macOS matrix leg but stays unfired. |

## Rollback Plan

All-additive: new build scripts, one new (unfired) workflow, new installers, one new ADR. NOTHING
in `src/` runtime changes; the npm/`dist` path and existing `bin` entries are untouched. Revert =
delete the new files and the added `package.json` scripts; the shipped npm package and CLI behavior
are unaffected.

## Dependencies

- 9.5b DONE (`node:sqlite` storage seam — binary needs ZERO native modules).
- Node LTS >=22 locally (SEA + `node:sqlite`). Docker available locally for the Linux leg.
- `postject` (dev-only build tool — justify in-writing per ADR-007).
- NO CI dependency — bundle + SEA + smoke are locally runnable.

## Success Criteria

- [ ] ADR-009 authored in the concise ADR format; states the SEA-vs-bun decision, tradeoffs, and explicitly reconciles ADR-006's bundling clause.
- [ ] esbuild produces one self-contained bundle; better-sqlite3 + the 5 drivers remain external/optional; determinism (ADR-008) preserved.
- [ ] win-x64 + linux-x64 SEA binaries build LOCALLY (Windows native + Linux via Docker) and pass the no-`node_modules` smoke: `--help`, `--version`, real `query` against an existing graph.
- [ ] The "works without any driver installed" guarantee holds for the binary (graph reads on `node:sqlite`).
- [ ] `release.yml` exists, is trigger-guarded (tag-push + `workflow_dispatch` ONLY), and has NOT been fired; no tag pushed.
- [ ] `install.ps1` + `install.sh` verify SHA256 BEFORE install and fail closed on mismatch.
- [ ] No project codename leaks (denylist scan clean); `tsc` strict + lint + test clean.
- [ ] US-037 (binaries half) satisfied for win/linux; macOS + release publication explicitly deferred to 9.5d.

## Recommended Apply Batch Ordering

1. ADR-009 + esbuild bundle (drivers `external`) + `bundle` script; assert the bundle runs on Node with `node_modules` present.
2. SEA assembly (`sea-config.json` + postject) on Windows native; no-`node_modules` smoke (`--help`/`--version`/`query`).
3. Linux SEA leg via Docker; the SAME smoke inside the container.
4. `release.yml` (trigger-guarded, unfired) + `install.ps1` + `install.sh` with SHA256 verification; final denylist + strict-build gate.
