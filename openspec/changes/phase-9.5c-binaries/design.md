# Design: Standalone binaries via Node SEA — esbuild bundle, release workflow, installers (phase-9.5c)

## Technical Approach

Node SEA (ratified over `bun build --compile`). ONE esbuild pass bundles a dedicated SEA entry
(`src/bin/sea-entry.ts`) into a single self-contained **CJS** file; the 5 DB drivers +
`better-sqlite3` are marked `external` so their `import()` calls survive as runtime dynamic imports
(ADR-006 lazy/optional preserved — NOT statically bundled). `node --experimental-sea-config`
produces the SEA blob; `postject` injects it into a copied, version-PINNED Node binary. Windows runs
the steps natively; Linux runs the SAME steps inside a Docker container. The binary's guaranteed
capability is READ/serve of an already-indexed graph on the **in-binary `node:sqlite`** (9.5b seam,
ZERO native/driver modules); the binary flips the local-store default to `node:sqlite` under SEA.
Live extraction from the binary loads a DB driver only when the user has one resolvable
(CWD `node_modules` → `NODE_PATH` → global); absent → the EXISTING `npm i <driver>` error. A written,
trigger-guarded `release.yml` (tag + dispatch ONLY, NEVER fired) and two checksum-verifying
installers complete the LOCAL, CI-quota-safe half. `--version` is embedded at bundle time (no disk
read). ADR-009 formalizes SEA and refines ADR-006's "static bundling in the binaries" clause.

The pinned build Node is **24 LTS**, chosen specifically so `node:sqlite` needs **no runtime flag**
(the `--experimental-sqlite` flag was dropped after Node 23.4) — this makes the hardest SEA problem
(passing runtime flags into a blob) disappear. The first apply task empirically confirms this on the
actual installed Node; both outcomes (flag-needed vs not) are designed below.

## Architecture Decisions

### Decision: D1 — Drivers stay EXTERNAL/optional in the binary (refines ADR-006)
**Choice**: esbuild marks `better-sqlite3`, `mysql2`, `mysql2/promise`, `pg`, `mssql`, `mongodb` (and subpaths) as `external`; the binary READS/serves on in-binary `node:sqlite` with zero drivers; live extraction loads a driver only if resolvable. | **Alternatives**: (a) statically bundle the 5 drivers per ADR-006's literal wording — breaks "works without any driver installed", bloats size, pulls native `.node` into a blob esbuild cannot inline; (b) bundle better-sqlite3, external the 4 network drivers — still forces a native module into the blob. | **Rationale**: the "works without any driver" guarantee is load-bearing (ADR-006 spirit) and the whole reason 9.5b existed. Drivers are pure runtime-optional integrations; keeping them `external` mirrors the npm path byte-for-byte and preserves the exact `import('<driver>' as string)` seam. ADR-009 refines ADR-006's one bundling sentence; ADR-006's pure-JS-driver + lazy-optional decisions stand.

### Decision: D2 — Binary forces the local store to `node:sqlite` under SEA
**Choice**: in `src/infra/open-connections.ts`, when `sea.isSea()` is true, pass `driver: 'node:sqlite'` to `createSqliteGraphStore`; npm/dev path unchanged (default `better-sqlite3`). | **Alternatives**: keep the better-sqlite3 default and ship better-sqlite3 as a sidecar; probe-and-fallback at runtime. | **Rationale**: the store is the ONE component every command touches (read AND write). Under a no-`node_modules` binary, better-sqlite3's native `.node` is absent, so the default MUST flip to the in-binary `node:sqlite`. Gating on `isSea()` keeps the npm store byte-identical (ADR-008) and requires a single additive line at the composition root — not a change to the store, factory, or any core file. The `.dbgraph/dbgraph.db` file format is identical across drivers (9.5b), so a db written by better-sqlite3 reads under node:sqlite and vice-versa.

### Decision: D3 — Pin build Node 24 LTS so `node:sqlite` needs no runtime flag
**Choice**: pin the build+embed Node to **24 LTS** (exact patch in `.nvmrc` and ADR-009), where `require('node:sqlite')` works with NO flag. | **Alternatives**: pin 22 LTS (node:sqlite needs `--experimental-sqlite`, which SEA cannot bake into the blob and which is awkward to pass); pin 23. | **Rationale**: SEA offers no supported way to embed CLI flags (no `execArgv` in `sea-config.json`); `--experimental-sqlite` is not reliably honored via `NODE_OPTIONS` and breaks the "just run it" UX. Node 24 removes the flag requirement entirely (flag dropped after 23.4), collapsing the whole class of problems. Node 24 still emits a one-shot `ExperimentalWarning` for node:sqlite → the SEA entry installs a `process.on('warning')` filter that swallows ONLY that warning (stderr stays clean; stdout is already machine-clean). **Fallback (if the machine is stuck on 22):** `node:sqlite` needs `--experimental-sqlite`; mitigations = bump the pinned Node to ≥23.4/24 (strongly preferred) OR document `NODE_OPTIONS=--experimental-sqlite` as a stopgap in the installer README. The FIRST apply task decides empirically (see Batch 0).

### Decision: D4 — esbuild → single CJS bundle (not ESM)
**Choice**: `format: 'cjs'`, `platform: 'node'`, `target: 'node24'`, `bundle: true`, one output file `build/sea/dbgraph.cjs`. | **Alternatives**: ESM single-file. | **Rationale**: Node SEA's `main` script is executed as **CommonJS** — an ESM entry is not supported as a SEA main today. The source tree is ESM (`"type":"module"`, NodeNext); esbuild transpiles ESM→CJS cleanly. Consequences handled: `import.meta.url` in `cli.ts` is rewritten by esbuild (platform=node) to a `pathToFileURL(__filename)` shim; under SEA `__filename` is the executable path and `process.argv[1]` is a user arg, so `cli.ts`'s auto-run guard evaluates **false** (no double-run) — the dedicated SEA entry does the running. `__dirname`/`__filename` are real CJS natives in the blob and point at the executable's directory (useful for exe-adjacent driver resolution).

### Decision: D5 — Dedicated SEA entry `src/bin/sea-entry.ts` (bundle-only), single binary with `mcp` subcommand
**Choice**: one binary per platform; the SEA entry unconditionally dispatches: `mcp` (first user arg) → MCP stdio server; otherwise → `runCli`. Its args come from `process.argv` normalized for the SEA layout. | **Alternatives**: two binaries (`dbgraph` + `dbgraph-mcp`); bundle `cli.ts` directly. | **Rationale**: bundling `cli.ts` directly fails — its `import.meta.url === pathToFileURL(process.argv[1])` guard never fires in a SEA (no script-path arg), so the CLI would never run. A dedicated entry runs unconditionally and sidesteps the guard. One binary (not two) matches the single-file US-037 story, halves the release matrix, and yields one blob to postject/checksum/attest per platform. The MCP server is reached as `dbgraph mcp`; `server.ts` gains an exported `startMcpServer()` (its existing auto-run guard stays for the npm `dbgraph-mcp` bin). **SEA argv gotcha (empirical):** in a SEA, `process.argv` is `[execPath, ...userArgs]` — there is NO script-path slot, so user args start at index 1, not 2. `sea-entry` computes `const argv = process.argv.slice(sea.isSea() ? 1 : 2)`. Batch 0 confirms the exact layout on the pinned Node before wiring.

### Decision: D6 — `--version`/`-v` added to `runCli`, version embedded at bundle time
**Choice**: add a `--version`/`-v` branch to `runCli` that prints the resolved version and returns 0; the value is `process.env.DBGRAPH_BUILD_VERSION ?? DBGRAPH_VERSION`. esbuild `define` replaces `process.env.DBGRAPH_BUILD_VERSION` with the string literal read from `package.json` at bundle time. | **Alternatives**: read `package.json` from disk at runtime (impossible in a blob); import a generated `version.ts`. | **Rationale**: the binary must answer `--version` with no `package.json` on disk (US-037 success). A build-time `define` bakes the literal in — deterministic (ADR-008), no disk read. On the npm/dev path `process.env.DBGRAPH_BUILD_VERSION` is undefined → falls back to `DBGRAPH_VERSION='0.0.0'` (placeholder unchanged → `test/smoke.test.ts` stays green). This is the ONE intentional, minimal runtime addition; the spec captures it as a new AC under `binary-distribution`. (`--version` is a valid `runCli` addition because `cli.ts` already owns `--help`; it benefits both npm and binary.)

### Decision: D7 — Optional-driver loading centralized behind `loadOptionalDriver(name)` for deterministic SEA resolution
**Choice**: introduce `src/adapters/engines/_shared/load-optional-driver.ts` exporting `loadOptionalDriver(name)`; the 4 network factories call it instead of inlining `import('<driver>' as string)`. Under SEA (`sea.isSea()`) it resolves via `createRequire` with an explicit base (`process.cwd()` first, then `process.execPath`), honoring `$CWD/node_modules → NODE_PATH → global`; otherwise it is literally today's `await import(name)`. | **Alternatives**: rely on Node's undocumented SEA bare-specifier `import()` resolution; require users to set `NODE_PATH` only; scope live-extraction-from-binary out. | **Rationale**: ESM dynamic `import()` of a BARE specifier inside a SEA does not reliably walk CWD `node_modules`; `require`'s resolution IS well-defined (CWD-relative, `NODE_PATH`- and global-aware) and works in a SEA. Funneling all optional-driver loads through one seam makes binary driver resolution DETERMINISTIC and documented, keeps ADR-004 (drivers never enter core), and — critically — the non-SEA branch is byte-identical to the current code, so ADR-008 goldens and every existing factory test hold. The failure path is unchanged: resolution miss → existing `catch` → `ConnectivityUnavailableError` with the exact `npm i <driver>`. **Scope note:** the smoke does NOT need this (it uses node:sqlite). This seam is what makes live `init/sync` from the binary actually resolve drivers; if the team wants 9.5c strictly packaging-only, the fallback is to ship the seam but leave live-from-binary extraction "best effort via NODE_PATH" and defer robustness — flagged as Open Question Q1.

### Decision: D8 — SEA assembly pipeline: `scripts/sea/` + postject, per-platform outputs
**Choice**: `scripts/sea/build-bundle.mjs` (esbuild) → `build/sea/dbgraph.cjs`; `scripts/sea/sea-config.json`; `node --experimental-sea-config scripts/sea/sea-config.json` → `build/sea/dbgraph.blob`; copy the pinned Node → `postject` inject → `dist/bin/dbgraph-win-x64.exe` / `dist/bin/dbgraph-linux-x64`. Windows driver: `scripts/sea/build-sea.ps1`; Linux driver: `scripts/sea/build-sea.sh` (run inside Docker). | **Alternatives**: tsup for the bundle; a single cross-platform Node script instead of ps1+sh. | **Rationale**: raw esbuild gives exact control over `external`/`define`/`format` (D1/D4/D6) that tsup abstracts away. postject is the official Node SEA tool (justified as a dev-only build dependency per ADR-007). Per-platform shell drivers keep the postject `--sentinel-fuse` and (Windows) signature-removal steps explicit and auditable. Output names encode `<os>-<arch>` so installers derive assets deterministically.

### Decision: D9 — Linux build + smoke via Docker on a glibc base
**Choice**: build the linux binary inside `node:24-bookworm-slim` (glibc) with the repo bind-mounted, non-interactive; smoke it inside a **Node-less** `debian:bookworm-slim` container (NO node, NO node_modules) running `--version`, `--help`, and `init→sync→query` on a fixture. | **Alternatives**: Alpine/musl base; smoke inside a Node image. | **Rationale**: Docker is already a project dependency (Testcontainers integration suite). A glibc-built SEA binary needs a glibc runtime — build and smoke on the SAME libc (Debian); Alpine/musl would need a separate build (out of scope, noted). Smoking in a Node-LESS image is the strongest possible proof of "no Node, no node_modules required" — the only executable is the binary and the only sqlite is the one compiled into it.

### Decision: D10 — `release.yml` trigger-guarded to tag-push + `workflow_dispatch` ONLY, NEVER fired
**Choice**: `on: { push: { tags: ['v*.*.*'] }, workflow_dispatch: {} }` — NO branch push, NO `pull_request`; matrix `[windows-latest, ubuntu-latest, macos-latest]`; each leg builds bundle+SEA, emits `SHA256SUMS`; a release job runs `actions/attest-build-provenance` and creates the GitHub Release attaching binaries + `SHA256SUMS`. | **Alternatives**: also trigger on `push: branches` for "CI smoke"; publish to npm. | **Rationale**: CI quota is EXHAUSTED — the workflow must be impossible to fire by accident. Restricting triggers to tag-push + manual dispatch means no branch push, PR, or merge can start it; no tag is pushed this phase, so it stays dormant. `concurrency: { group: release-${{ github.ref }} }` mirrors the intended CI discipline. The macOS leg is present (for 9.5d) but validated only when CI eventually runs — it is NEVER exercised locally here.

### Decision: D11 — Installers `install.ps1` + `install.sh` verify SHA256 BEFORE install, fail closed
**Choice**: pure-shell installers (no runtime deps, ADR-007 spirit): detect platform/arch → derive asset name → download binary + `SHA256SUMS` from the pinned release → compute local hash → compare case-insensitively → on mismatch DELETE the partial download and exit non-zero → only then place on PATH-dir + print PATH guidance. Version is a pinned input (default to a pinned version, not blind `latest`). | **Alternatives**: install-then-verify; trust TLS alone. | **Rationale**: a supply-chain-sensitive tool (ADR-007) must FAIL CLOSED — a tampered/truncated download must never reach PATH. Verifying before placement and deleting partials guarantees no half-verified binary is runnable. No admin/sudo (user-local install dir); TLS 1.2+ enforced (`install.ps1`).

### Decision: D12 — Test split: `npm test` stays green with NO binary; `npm run smoke:binary` validates artifacts
**Choice**: everything CI-independent is unit-tested as DATA/pure functions in the default vitest run (never touches a binary); artifact validation lives in `*.smoke.test.ts` excluded from `npm test` and run only by `npm run smoke:binary` (requires `DBGRAPH_BINARY_PATH`). | **Alternatives**: gate `npm test` on a built binary. | **Rationale**: mirrors the proven `*.integration.test.ts` exclusion pattern (`vitest.config.ts` already excludes a suffix). `npm test` must be green on any machine with no build artifacts (CI-independence, contributor-friendliness); the binary is validated locally/opt-in. See Testing Strategy for the exact seam list.

## ADR-009 (full text — apply materializes `docs/adr/009-node-sea-standalone-binaries.md`)

```markdown
# ADR-009: Standalone binaries via Node SEA

**Status:** Accepted · **Date:** 2026-07-06 · **Refines:** ADR-006 (bundling clause), ADR-008 (determinism)

**Context:** US-037 asks for a single-file, self-contained CLI a user runs with NO Node.js and NO
`node_modules` (codegraph parity). Phase 9.5b removed the last native module from the local index
(the `node:sqlite` storage seam), making a native-free binary possible. Two toolchains were on the
table: `bun build --compile` and Node SEA (single executable applications). ADR-006 had earlier
written "static bundling in the binaries" for the drivers, which conflicts with ADR-006's own
"works without any driver installed" guarantee and with keeping the 5 drivers optional.

**Decision:**
1. Build standalone binaries with **Node SEA**, not `bun build --compile`: one toolchain, alignment
   with the 9.5b `node:sqlite` seam, no second runtime, an official Node feature.
2. Pin the build+embed Node to **24 LTS** (exact patch in `.nvmrc`) so `node:sqlite` needs NO
   runtime flag (`--experimental-sqlite` was dropped after 23.4) and output is deterministic (ADR-008).
3. **Refine ADR-006's "static bundling in the binaries" clause:** the 5 DB drivers and
   `better-sqlite3` are NOT statically bundled. They stay `external`, lazy, and optional (dynamic
   import) — exactly as on the npm path. The binary's guaranteed capability is READ/serve of an
   already-indexed graph on the in-binary `node:sqlite` — zero drivers required. Live extraction from
   the binary loads a driver only when present, resolved from `$CWD/node_modules` → `NODE_PATH` →
   global; absent → the existing `npm i <driver>` error.
4. The binary defaults its local-index store to `node:sqlite`; the npm default stays
   `better-sqlite3` (byte-identical, ADR-008).

**Consequences:** the small external-driver surface is preserved; "works without any driver
installed" holds for the binary; binary size ≈ the Node runtime (~tens of MB); SEA is experimental
(stability 1.1) so the Node pin is load-bearing across minors; drivers for live extraction are the
user's `npm i`, not shipped; only ADR-006's single bundling sentence is superseded — ADR-006's
pure-JS-driver and lazy-optional decisions stand. macOS + arm64 binaries and any actual release
publication are deferred (9.5d, CI-quota-blocked).
```

## Data Flow

```
Build (local):
  package.json.version ─┐
                        ▼
  src/bin/sea-entry.ts ──esbuild(bundle,cjs,external[6 drivers],define version)──▶ build/sea/dbgraph.cjs
                        │
  sea-config.json ──node --experimental-sea-config──▶ build/sea/dbgraph.blob
                        │
  copy pinned Node(exe) ──postject(inject blob @ NODE_SEA_FUSE)──▶ dist/bin/dbgraph-<os>-x64[.exe]

Runtime (no node_modules):
  ./dbgraph <args>
     │ sea-entry: argv = argv.slice(isSea?1:2); install ExperimentalWarning filter
     ├─ "--version"/"-v"  ─▶ print DBGRAPH_BUILD_VERSION (baked)              ─▶ exit 0
     ├─ "--help"/"-h"     ─▶ runCli → USAGE_TEXT                              ─▶ exit 0
     ├─ "mcp"             ─▶ startMcpServer() over stdio
     └─ otherwise         ─▶ runCli(argv) ─▶ dispatch ─▶ handler
                                 │ openConnections: isSea() ⇒ store driver = 'node:sqlite'
                                 │   store ops  ─▶ in-binary node:sqlite (zero drivers)   [READ/serve guarantee]
                                 │   live extract ─▶ loadOptionalDriver(name):
                                 │        isSea ⇒ createRequire(cwd) resolve  [CWD→NODE_PATH→global]
                                 │        absent ⇒ ConnectivityUnavailableError("npm i <driver>")
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `docs/adr/009-node-sea-standalone-binaries.md` | Create | ADR-009 (full text above); refines ADR-006 bundling clause. |
| `src/bin/sea-entry.ts` | Create | Bundle-only entry: normalize SEA argv, warning filter, dispatch `mcp` vs `runCli`. Never referenced by tsup/npm build. |
| `src/cli/cli.ts` | Modify | Add `--version`/`-v` branch in `runCli` printing `process.env.DBGRAPH_BUILD_VERSION ?? DBGRAPH_VERSION`. Add `version`/`v` to USAGE. Auto-run guard UNCHANGED (safe-false under SEA). |
| `src/mcp/server.ts` | Modify | Export `startMcpServer()`; keep the existing auto-run guard for the npm `dbgraph-mcp` bin. |
| `src/infra/open-connections.ts` | Modify | When `sea.isSea()`, pass `driver:'node:sqlite'` to `createSqliteGraphStore` (line ~169). npm path unchanged. |
| `src/adapters/engines/_shared/load-optional-driver.ts` | Create | `loadOptionalDriver(name)` seam (SEA: createRequire from cwd; else `import(name)`). |
| `src/adapters/engines/{mysql,pg,mssql,mongodb}/factory.ts` | Modify | Replace inline `import('<driver>' as string)` with `loadOptionalDriver('<driver>')`. Non-SEA branch byte-identical. |
| `scripts/sea/esbuild-config.mjs` | Create | Exports the esbuild options OBJECT (data) + a `versionDefine(version)` helper — unit-testable. |
| `scripts/sea/build-bundle.mjs` | Create | Reads `package.json.version`, calls `esbuild.build(options)` → `build/sea/dbgraph.cjs`. |
| `scripts/sea/sea-config.json` | Create | `{ "main":"build/sea/dbgraph.cjs", "output":"build/sea/dbgraph.blob", "disableExperimentalSEAWarning":true, "useSnapshot":false, "useCodeCache":false }`. |
| `scripts/sea/build-sea.ps1` | Create | Windows: bundle → sea-config → copy `node.exe` → postject → `dist/bin/dbgraph-win-x64.exe`. |
| `scripts/sea/build-sea.sh` | Create | Linux (inside Docker): bundle → sea-config → copy `node` → postject → `dist/bin/dbgraph-linux-x64`. |
| `scripts/sea/build-linux-docker.(ps1\|sh)` | Create | `docker run --rm -v repo:/w -w /w node:24-bookworm-slim bash scripts/sea/build-sea.sh`. |
| `scripts/sea/smoke-linux.sh` | Create | `docker run --rm` on `debian:bookworm-slim` (NO node): `--version`/`--help`/`init→sync→query`. |
| `scripts/install/asset-name.mjs` | Create | Pure `assetName(platform, arch)` mapping — shared contract, unit-tested; ps1/sh replicate it. |
| `install.ps1` | Create | Checksum-verifying Windows installer (D11). |
| `install.sh` | Create | Checksum-verifying POSIX installer (D11). |
| `.github/workflows/release.yml` | Create | Trigger-guarded (tag + dispatch ONLY); matrix; SHA256SUMS; attest-build-provenance. NEVER fired. |
| `.nvmrc` | Create | Pin Node 24 LTS exact patch (determinism, ADR-008/ADR-009). |
| `vitest.smoke.config.ts` | Create | `include: ['test/**/*.smoke.test.ts']`; required env `DBGRAPH_BINARY_PATH`. |
| `test/**/*.smoke.test.ts` | Create | Artifact validation (excluded from `npm test`). |
| `test/bin/*.test.ts` | Create | Unit tests: esbuild-config data, sea-entry arg logic, loadOptionalDriver, asset-name. |
| `package.json` | Modify | Add scripts `bundle:sea`, `build:sea:win`, `build:sea:linux`, `smoke:binary`; add devDeps `esbuild`, `postject` (justify per ADR-007); drivers stay external. |
| `vitest.config.ts` | Modify | Add `**/*.smoke.test.ts` to `exclude` (keep `npm test` green with no binary). |
| `docs/stories/07-quality-publication.md` (US-037) | Modify | Reconcile "5 drivers statically bundled" AC → external/optional per ADR-009. |

## Interfaces / Contracts

```typescript
// src/bin/sea-entry.ts — bundle-only entry (unconditional run; NO import.meta.url guard)
import { runCli } from '../cli/cli.js';
import { startMcpServer } from '../mcp/server.js';
// isSea via createRequire('node:sea') to avoid a static node:sea type dep.

/** PURE — unit-testable without spawning. Returns the mode + args for a given argv/isSea. */
export function planEntry(argv: readonly string[], isSea: boolean):
  | { mode: 'mcp' }
  | { mode: 'cli'; args: readonly string[] } {
  const args = argv.slice(isSea ? 1 : 2);      // SEA: [execPath, ...userArgs] — no script slot
  return args[0] === 'mcp' ? { mode: 'mcp' } : { mode: 'cli', args };
}
```

```typescript
// src/adapters/engines/_shared/load-optional-driver.ts
/**
 * Loads an OPTIONAL DB driver, preserving ADR-006 lazy/optional semantics.
 * SEA:  createRequire(join(cwd,'_.js'))(name)  → resolves $CWD/node_modules → NODE_PATH → global.
 * npm:  await import(name)                      → byte-identical to today's `import(name as string)`.
 * @throws the driver's own resolution error (callers keep their existing catch → npm i <driver>).
 */
export async function loadOptionalDriver(name: string): Promise<unknown>;
```

```jsonc
// scripts/sea/esbuild-config.mjs — the OBJECT is the unit-tested contract (D12)
export const SEA_EXTERNAL = [
  'better-sqlite3', 'mysql2', 'mysql2/promise', 'pg', 'mssql', 'mongodb'
]; // node:* builtins are auto-external on platform:node (incl. node:sqlite)
export function buildOptions(version) {
  return {
    entryPoints: ['src/bin/sea-entry.ts'],
    outfile: 'build/sea/dbgraph.cjs',
    bundle: true, platform: 'node', format: 'cjs', target: 'node24',
    external: SEA_EXTERNAL,
    define: { 'process.env.DBGRAPH_BUILD_VERSION': JSON.stringify(version) },
    banner: { js: "const require=require;" }, // esbuild injects import.meta.url shim for node/cjs
    minify: false, sourcemap: false, legalComments: 'none',
  };
}
```

```yaml
# .github/workflows/release.yml — TRIGGER GUARD (the load-bearing safety contract). NEVER FIRED.
on:
  push:
    tags: ['v*.*.*']        # NO `branches:` — cannot fire on push/merge
  workflow_dispatch: {}     # manual only
# NO `pull_request:` trigger anywhere.
permissions:
  contents: write           # create release + upload assets
  id-token: write           # attest-build-provenance
  attestations: write
concurrency: { group: 'release-${{ github.ref }}', cancel-in-progress: false }
```

```
# install.sh / install.ps1 — verification contract (FAIL CLOSED, D11)
1. detect os/arch → assetName()                       (asset-name.mjs is the reference mapping)
2. download <asset> and SHA256SUMS from pinned release
3. expected = grep(assetName, SHA256SUMS); actual = sha256(downloaded)
4. if actual !== expected (case-insensitive):  rm downloaded; exit 1   ← BEFORE any PATH placement
5. chmod +x (sh); move to install dir; print PATH guidance             ← only on match
```

## Testing Strategy

| Layer | What to test | Approach | Runs in |
|-------|--------------|----------|---------|
| Unit | esbuild options are correct DATA | Import `buildOptions(v)`; assert `format==='cjs'`, `platform==='node'`, `bundle===true`, `external` ⊇ all 6 drivers, `define` has the baked version, entry is `sea-entry`. | `npm test` |
| Unit | SEA arg/dispatch logic | `planEntry(argv,isSea)` — assert SEA slice(1) vs npm slice(2), `mcp` routing, `--version`/`--help` pass-through. NO spawn. | `npm test` |
| Unit | `loadOptionalDriver` seam | Inject fake `createRequire`/`import`; assert SEA branch resolves from cwd base, npm branch calls `import(name)`, resolution miss rethrows (→ existing `npm i` catch). | `npm test` |
| Unit | `--version` fallback | Set/unset `process.env.DBGRAPH_BUILD_VERSION`; assert `runCli(['--version'])` prints baked value or `DBGRAPH_VERSION`. | `npm test` |
| Unit | asset-name mapping | `assetName('win32','x64')==='dbgraph-win-x64.exe'`, `assetName('linux','x64')==='dbgraph-linux-x64'`. | `npm test` |
| Regression | npm store default unchanged | With `isSea()===false`, all existing storage goldens BYTE-IDENTICAL (better-sqlite3). | `npm test` |
| Smoke (win) | built exe works with NO node_modules | `vitest.smoke.config.ts`: temp cwd (no node_modules), fixture sqlite source + `driver:node:sqlite` config; run `--version` (== pkg.version), `--help` (USAGE), `init→sync→query <term>` (asserts hit + exit code). | `npm run smoke:binary` |
| Smoke (linux) | built binary in a Node-LESS container | `scripts/sea/smoke-linux.sh`: `debian:bookworm-slim` (no node), same `--version`/`--help`/`init→sync→query`. | manual/local |

**CI-independence guarantee:** `npm test` NEVER requires a binary — every binary-dependent assertion
lives in `*.smoke.test.ts` (excluded via `vitest.config.ts`). The smoke suites require
`DBGRAPH_BINARY_PATH`; absent → they skip (not fail). This is the honest RED→GREEN seam for apply:
config-as-data and pure dispatch/resolution logic go RED→GREEN in `npm test`; the artifact-level
smoke is a separate, opt-in, local gate.

## Migration / Rollout

All-additive. NOTHING in the npm/`dist` runtime path changes behavior: the store default stays
better-sqlite3 unless `isSea()` (only true inside a binary), the driver factories are byte-identical
off-SEA, and the existing `bin` entries are untouched. `--version` is a new, backward-compatible flag.
Rollback = delete the new files (`src/bin/sea-entry.ts`, `scripts/sea/**`, `scripts/install/**`,
`install.*`, `.github/workflows/release.yml`, `.nvmrc`, smoke config/tests, ADR-009), revert the
`open-connections.ts` `isSea()` line, the 4 factory `loadOptionalDriver` swaps, the `cli.ts`/`server.ts`
additions, and the `package.json` scripts/devDeps. The shipped npm package and CLI behavior are
unaffected. No data migration — the `.dbgraph/dbgraph.db` format is identical across drivers (9.5b).

## Apply Batch Ordering (TDD)

0. **Empirical Node/SEA probe (FIRST — decides D3/D5 constants).** On the pinned Node: confirm
   `require('node:sqlite')` works WITHOUT `--experimental-sqlite` (record `process.version`); build a
   throwaway SEA that prints `process.argv` for `./x a b c` to fix the argv slice offset. Record both
   outcomes; if node:sqlite still needs the flag → bump the pin to 24 (preferred) before proceeding.
1. **ADR-009 + bundle (drivers external) + version embed.** ADR-009 file; `esbuild-config.mjs`
   (RED→GREEN on the options-data unit tests) + `build-bundle.mjs`; `sea-entry.ts` + `planEntry`
   tests; `--version` in `runCli` + `startMcpServer` export; `loadOptionalDriver` + 4 factory swaps
   (prove existing factory tests + goldens BYTE-IDENTICAL off-SEA). Assert `build/sea/dbgraph.cjs`
   runs on Node with node_modules PRESENT.
2. **SEA assembly (Windows native) + `open-connections.ts` isSea store flip + win smoke.**
   `sea-config.json` + `build-sea.ps1` + postject → `dbgraph-win-x64.exe`; `vitest.smoke.config.ts` +
   win `*.smoke.test.ts` (`--version`/`--help`/`init→sync→query`, NO node_modules).
3. **Linux leg via Docker + Node-less smoke.** `build-linux-docker` + `build-sea.sh` →
   `dbgraph-linux-x64`; `smoke-linux.sh` in `debian:bookworm-slim`.
4. **`release.yml` (guarded, unfired) + `asset-name.mjs` (unit-tested) + `install.ps1`/`install.sh`
   (SHA256 fail-closed) + `.nvmrc` + US-037 AC reconciliation.** Final denylist/codename scan +
   `tsc` strict + lint + `npm test` green (no binary needed).

## Open Questions

- [ ] **Q1 (driver model scope):** ratify D7 in full (ship `loadOptionalDriver` and make live
      `init/sync` from the binary resolve drivers from CWD/NODE_PATH/global) — or keep 9.5c strictly
      packaging-only and defer robust binary driver resolution, documenting live-from-binary as
      "best effort via NODE_PATH"? Design recommends D7 full (non-SEA path is byte-identical).
- [ ] **Q2 (Node pin patch):** exact Node 24 LTS patch to pin in `.nvmrc`/ADR-009 (confirm the
      current 24-LTS patch and that the dev machine + Docker image both provide it). Batch 0 gates this.
- [ ] **Q3 (SEA argv layout):** confirm empirically whether a SEA `process.argv` is
      `[execPath, ...args]` (slice 1) on the pinned Node — the `planEntry` offset constant depends on it.
- [ ] **Q4 (node:sqlite readOnly on binary):** the sqlite SOURCE adapter opens node:sqlite with
      `{ readOnly: true }` — confirm the option name/behavior on the pinned Node 24 for the smoke's
      `init` step (9.5b validated the writable store path, not the read-only source-open on 24).
- [ ] **Q5 (ExperimentalWarning suppression):** confirm the `process.on('warning')` filter in
      `sea-entry` fully silences the node:sqlite experimental warning, or whether
      `sea-config.json.disableExperimentalSEAWarning` + a startup flag is also needed.
- [ ] **Q6 (Windows postject signing):** confirm whether the copied `node.exe` needs
      `signtool remove /s` (unsigned) before postject on the pinned Node build, and that the produced
      exe runs on a clean Windows without SmartScreen blocking (code signing is explicitly out of scope).
- [ ] **Q7 (macOS leg):** `release.yml` carries the macOS matrix leg but it is NEVER exercised here;
      confirm the leg stays present-but-dormant for 9.5d rather than being removed.

## Batch 0 — empirical findings (spikes 0.1–0.5; recorded per task 0.6)

**Probe environment.** All spikes were run on a standalone **Node v24.18.0** ("Krypton", the latest Node 24
LTS as of 2026-07-06), win-x64, obtained as the official `node-v24.18.0-win-x64` zip in a throwaway scratch
directory OUTSIDE the repo (the dev machine's default `node` is v22.19.0 and no version manager — volta /
nvm-windows / fnm — is installed). Throwaway SEA probes were built, injected and run entirely in scratch;
no probe artifact was committed. `postject@latest` was used for injection.

### 0.1 / Q2 / D3 — node:sqlite needs NO flag on the pin (design PRIMARY branch) → **pin FINAL: 24.18.0**

On v24.18.0 both `require('node:sqlite')` and `import('node:sqlite')` return a working module (`DatabaseSync`
is a function) with **no** `--experimental-sqlite` flag and `process.execArgv === []`. This matches the design's
primary branch (D3); the Node-22 flag-required fallback is NOT taken. **Q2 decision is FINAL: pin Node 24.18.0**
(recorded in `.nvmrc`; consumed by `build-sea.ps1`/`build-sea.sh` and `release.yml`).

### 0.2 / Q3 / D5 — SEA argv layout — **REALITY-BREAK: design fallback offset taken (slice 2, not slice 1)**

A throwaway SEA (`entry.cjs` printing `JSON.stringify(process.argv)`) injected into a copied `node.exe` and run
as `./probe.exe a b c` reports:

```
process.argv = [ <execPath>, <execPath>, "a", "b", "c" ]   // execPath appears TWICE
```

Node fills the argv[1] "script-path" slot with the **executable path** (not a gap), so **user args start at
index 2**, IDENTICAL to a normal `node <script> a b c` launch — NOT `[execPath, ...args]`/index 1 as design
D5/Q3 assumed. Verified across `a b c`, `--version foo`, empty argv (`[execPath, execPath]` → `[]`), and a
second node:sqlite SEA that correctly queried term `orders` after `process.argv.slice(2)` yielded `["orders"]`.
**Corrected constant (consumed by `planEntry`, task 1.2): the SEA branch uses `slice(2)`.** Because both the SEA
and the non-SEA offsets are 2, `planEntry(argv, isSea)` slices at a named offset of 2 for both branches (the
`isSea` seam is retained for the documented contract and future divergence). Task 0.2 pre-authorized this
correction ("if the layout differs, record the corrected offset"); design D5's `slice(isSea ? 1 : 2)` is
SUPERSEDED by `slice(2)` on the pinned Node.

### 0.3 / Q4 — node:sqlite `{ readOnly: true }` opens existing file read-only (design PRIMARY branch)

`new DatabaseSync(path, { readOnly: true })` on v24.18.0: the option name is camelCase **`readOnly`**; it opens
an existing `.dbgraph` file, `prepare(...).all()` returns the expected rows, and a write is rejected with
`attempt to write a readonly database`. Matches the design's assumed option name/behavior. The smoke read path
(2.6 / 3.2) uses `{ readOnly: true }`.

### 0.4 / Q5 — ExperimentalWarning suppression — **REALITY-BREAK: no node:sqlite warning fires (harmless)**

On v24.18.0 node:sqlite emits **NO `ExperimentalWarning` at all** — not on `require`, not on `import`, not on
`DatabaseSync` construction or use. Verified with a `process.on('warning')` listener that DID capture a control
`SanityWarning` (proving the listener + stderr capture work) but captured no sqlite/ExperimentalWarning. Design
D3 assumed "Node 24 still emits a one-shot ExperimentalWarning"; it does not on this patch. **Confirmed
suppression recipe:**
- The SEA-level *"Single executable application is an experimental feature"* warning (a DIFFERENT warning) is
  suppressed by `sea-config.json`'s `"disableExperimentalSEAWarning": true` — verified: the injected SEA exe's
  stderr is empty.
- `sea-entry.ts` still installs the design-mandated defensive `process.on('warning')` filter that swallows ONLY
  an `ExperimentalWarning` whose message matches `/sqlite/i`. On 24.18.0 this is a **no-op** (nothing to swallow)
  but is retained per D3 so the entry stays robust if a later 24 patch reintroduces the warning.
- **No startup flag is needed** for either warning.

### 0.5 / Q6 — Windows postject viability (design PRIMARY: exe runs; signtool best-effort)

`postject <exe> NODE_SEA_BLOB <blob> --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` on Windows
injects successfully (exit 0) and prints `warning: The signature seems corrupted!`. The produced exe **runs
correctly** — exit 0, `require('node:sea').isSea() === true`, correct argv, and node:sqlite works — from an
arbitrary cwd with NO `node_modules`, **without** running `signtool remove /s` (signtool is not installed on
this machine). **Recipe for `build-sea.ps1` (task 2.5):** `signtool remove /s node.exe` is NOT required for the
exe to run and MUST be **best-effort / guarded on signtool availability**; the "signature seems corrupted"
warning is expected and benign (code signing is explicitly out of scope). SmartScreen may warn on first run of
the unsigned exe (out of scope); the exe executes.

### Pinned constants (hard-coded by later batches)

| Constant | Value | Consumed by |
|----------|-------|-------------|
| Build/embed Node patch (Q2) | **24.18.0** | `.nvmrc` (4.4), `build-sea.ps1`/`.sh` (2.5/3.1), `release.yml` (4.2) |
| SEA argv user-arg offset (Q3) | **`slice(2)`** (NOT `slice(1)`) | `planEntry` in `sea-entry.ts` (1.2) |
| node:sqlite read-open option (Q4) | `{ readOnly: true }` (camelCase) | smoke read path (2.6/3.2) |
| node:sqlite ExperimentalWarning (Q5) | none fires on 24.18.0; defensive `process.on('warning')` /sqlite/ filter + `disableExperimentalSEAWarning:true` | `sea-entry.ts` (1.2), `sea-config.json` (2.5) |
| postject sentinel fuse | `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` | `build-sea.ps1`/`.sh` (2.5/3.1) |
| Windows signtool remove (Q6) | NOT required; best-effort if available | `build-sea.ps1` (2.5) |
| sea-config.json shape | `{ main, output, "disableExperimentalSEAWarning": true, "useSnapshot": false, "useCodeCache": false }` | `sea-config.json` (2.5) |
