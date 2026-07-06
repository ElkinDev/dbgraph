# Tasks: Phase 9.5c — Standalone binaries via Node SEA (esbuild bundle, release workflow, installers)

Standing header (every task): STRICT TDD (RED→GREEN→refactor; the failing test/smoke assertion PRECEDES the code).
HEXAGONAL (ADR-004): the `GraphStore`/`SchemaAdapter` PORTS and the composition root are the ONLY join points; core is
never touched. ALL-ADDITIVE (design §Migration): the npm/`dist` runtime path stays byte-identical — the store default
stays `better-sqlite3` unless `sea.isSea()` (true only inside a binary), the driver factories are byte-identical off-SEA,
and the existing `bin` entries are untouched. DETERMINISM (ADR-008): the esbuild bundle + SEA blob are byte-reproducible
on the pinned Node; `--version` is baked at bundle time (NO disk read). CONTENT-SAFETY / leak-scan (HARD): NO project
codename appears in any new file — the denylist scan is a gate. Strict TS, NO `any`, `exactOptionalPropertyTypes`.
EXACT / golden-pinned assertions (`.toBe` / `.toStrictEqual`); existence-only `.toBeDefined()` is FORBIDDEN. English;
conventional commits referencing US-037 (binaries half), NO AI attribution. NO CI is fired, NO tag is pushed, NO
`gh`/PR — the LOCAL gate is the ONLY safety net; nothing is pushed past `closeout`.

**D12 TEST SPLIT (the load-bearing CI-independence contract — the verify phase checks this split per task):**
`npm test` (`vitest run`) MUST stay GREEN with NO binary built — every binary-dependent assertion lives in a
`*.smoke.test.ts` (excluded from `npm test` via `vitest.config.ts`) or a shell smoke script, run ONLY by
`npm run smoke:binary` / the Docker smoke. Each implementation task below is tagged **(vitest)** = pure DATA/logic,
RED→GREEN in `npm test`, or **(smoke)** = artifact-level, opt-in/local. The smoke suites require `DBGRAPH_BINARY_PATH`;
absent → they SKIP (never fail).

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions D1–D12 + Open Questions):
- **D1 (drivers EXTERNAL, refines ADR-006):** esbuild marks `better-sqlite3`, `mysql2`, `mysql2/promise`, `pg`, `mssql`,
  `mongodb` (+ subpaths) as `external`; NONE inlined. The binary READS/serves on in-binary `node:sqlite` with ZERO
  drivers; live extraction loads a driver only if resolvable. ADR-006's "static bundling" sentence is SUPERSEDED; its
  lazy/optional guarantee STANDS.
- **D2 (isSea store flip):** in `src/infra/open-connections.ts` (L169 `createSqliteGraphStore({ path: storePath })`),
  when `sea.isSea()` pass `driver: 'node:sqlite'`; npm/dev path UNCHANGED (default `better-sqlite3`, byte-identical).
- **D3 (pin Node 24 LTS):** `node:sqlite` needs NO runtime flag on 24 (`--experimental-sqlite` dropped after 23.4);
  exact patch in `.nvmrc`. Node 24 emits a one-shot `ExperimentalWarning` → `sea-entry` installs a `process.on('warning')`
  filter that swallows ONLY that warning. **Batch 0 confirms empirically before any wiring.**
- **D4 (single CJS bundle):** `format:'cjs'`, `platform:'node'`, `target:'node24'`, `bundle:true`, one outfile
  `build/sea/dbgraph.cjs`. SEA `main` is CJS; `cli.ts`'s `import.meta.url === pathToFileURL(process.argv[1])` auto-run
  guard evaluates FALSE under SEA (no double-run) — the dedicated entry does the running.
- **D5 (dedicated entry, single binary):** `src/bin/sea-entry.ts` runs UNCONDITIONALLY (no import.meta guard). PURE
  `planEntry(argv, isSea)` computes `argv.slice(isSea ? 1 : 2)` (SEA argv = `[execPath, ...userArgs]`, NO script slot —
  Batch 0 confirms the offset) and routes `mcp` → MCP stdio vs → `runCli`. One binary per platform; MCP reached as
  `dbgraph mcp`; `server.ts` gains an exported `startMcpServer()` (its existing auto-run guard stays for `dbgraph-mcp`).
- **D6 (`--version`/`-v`):** new branch in `runCli` prints `process.env.DBGRAPH_BUILD_VERSION ?? DBGRAPH_VERSION`;
  esbuild `define` bakes the `package.json.version` literal (currently `0.0.0`). Off-SEA the env var is undefined →
  falls back to `DBGRAPH_VERSION='0.0.0'` (`src/index.ts` L9) → `test/smoke.test.ts` stays green.
- **D7 / Q1 RESOLVED (ratify D7 FULL):** `src/adapters/engines/_shared/load-optional-driver.ts` exports
  `loadOptionalDriver(name)`. SEA branch: `createRequire` with an explicit base (cwd first, then `process.execPath`) →
  `$CWD/node_modules → NODE_PATH → global`. Off-SEA branch: literally today's `await import(name as string)`
  (byte-identical — every existing factory test + golden holds). Resolution miss rethrows → the callers' EXISTING catch →
  `ConnectivityUnavailableError` `Required driver '<name>' is not installed. Run: npm i <name>` (exit 2, no stack).
- **DISCOVERY (correction to design File-Changes table):** the bare-specifier `import()` seams to swap are
  `pg/factory.ts` (L134 `import('pg' as string)`), `mysql/factory.ts` (L140 `import('mysql2/promise' as string)`),
  `mongodb/factory.ts` (L87 `import('mongodb' as string)`), and — NOT `mssql/factory.ts` — the mssql import lives in
  `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` (L143 `import('mssql' as string)`). The
  connectivity `probe.ts` files carry their OWN `import(<driver>)` seams (doctor/self-test path); they are OUT of D7's
  live-extraction scope and are NOT swapped this phase (noted so apply does not scope-creep).
- **D8/D9 (assembly):** `scripts/sea/esbuild-config.mjs` (data) → `build-bundle.mjs` → `build/sea/dbgraph.cjs`;
  `sea-config.json`; `node --experimental-sea-config` → `build/sea/dbgraph.blob`; copy pinned Node → `postject` inject →
  `dist/bin/dbgraph-win-x64.exe` (native, `build-sea.ps1`) / `dist/bin/dbgraph-linux-x64` (Docker `node:24-bookworm-slim`,
  `build-sea.sh`). Linux smoke runs in a Node-LESS `debian:bookworm-slim`.
- **D10 / Q7 RESOLVED (keep macOS leg dormant):** `release.yml` `on: { push: { tags: ['v*.*.*'] }, workflow_dispatch: {} }`
  — NO branch push, NO `pull_request`; matrix `[windows-latest, ubuntu-latest, macos-latest]` (macOS leg PRESENT but
  NEVER exercised here — deferred to 9.5d); each leg emits `SHA256SUMS`; release job runs `attest-build-provenance`.
  NEVER fired; NO tag pushed.
- **D11 (installers fail closed):** `install.ps1` + `install.sh` detect os/arch → `assetName()` → download binary +
  `SHA256SUMS` from a pinned release → compute local hash → compare case-insensitively → on MISMATCH delete the partial
  and exit non-zero BEFORE any PATH placement → only on MATCH place + print PATH guidance. `scripts/install/asset-name.mjs`
  is the reference mapping the ps1/sh replicate.

Per-batch GATE (ALL must pass before the next batch, then COMMIT): `npx tsc --noEmit` clean (strict, NO `any`) ·
`npm run lint` 0 errors / 0 warnings · `npm test` (`vitest run`) GREEN **with NO binary built** (D12 — smoke suites
excluded) · `git diff --exit-code test/golden/` EMPTY (off-SEA byte-identical, ADR-008) · leak-scan/denylist clean.
Then COMMIT (conventional, references US-037, NO AI attribution, NO push/PR/gh/tag). Artifact-level smoke gates
(win exe / Docker linux / installers) are OPT-IN and run LOCALLY — they NEVER block `npm test`.

## Batch 0: Empirical Node/SEA probe — pin the constants D3/D5/Q2–Q6 depend on (spikes, record into design.md)

> Decides the LOAD-BEARING constants the rest of the phase hard-codes: the pinned Node patch (Q2), the SEA `process.argv`
> slice offset (Q3, feeds `planEntry` in 1.2), `node:sqlite` no-flag + `{readOnly:true}` behavior (Q4, feeds the smoke's
> `init`/read path), the ExperimentalWarning suppression path (Q5, feeds `sea-entry`), and Windows postject signing (Q6,
> feeds `build-sea.ps1` in 2.5). These are INVESTIGATION spikes, NOT vitest RED→GREEN — the gate is "findings recorded +
> constants pinned," not `npm test`. BOTH outcomes are pre-designed (design §D3 fallback); if a probe fails, take the
> designed fallback and RECORD it. NO `src/` change in this batch.

- [x] 0.1 **(spike)** On the installed Node, confirm `require('node:sqlite')` (and `import('node:sqlite')`) works with NO
  `--experimental-sqlite` flag; record `process.version` (exact patch). Q2 decision: if the machine is < 23.4 and the flag
  is still required → BUMP the pin to the current 24 LTS (strongly preferred per D3) before proceeding; the stopgap
  `NODE_OPTIONS=--experimental-sqlite` is documented-only, not shipped. Resolves **Q2** + confirms **D3**. Record the
  exact patch to pin (used by 4.4 `.nvmrc`). Done: `process.version` + no-flag result recorded in design.md.
- [x] 0.2 **(spike)** Build a THROWAWAY SEA (a 3-line entry that prints `JSON.stringify(process.argv)`) on the pinned Node,
  inject via postject, run `./x a b c`, and confirm the layout is `[execPath, 'a', 'b', 'c']` (user args at index 1, NO
  script-path slot). This fixes the `planEntry` slice constant `slice(isSea ? 1 : 2)`. Resolves **Q3** + confirms **D5**.
  Done: observed argv array recorded in design.md; if the layout differs, record the corrected offset (1.2 consumes it).
- [x] 0.3 **(spike)** Confirm `node:sqlite` `new DatabaseSync(path, { readOnly: true })` opens an existing `.dbgraph`
  file read-only on the pinned Node 24 (9.5b validated the WRITABLE store on 22, not the read-only SOURCE open on 24) —
  the smoke's `init→sync→query` read path depends on it. Resolves **Q4**. Done: option name/behavior recorded; if the
  option differs on 24, record the corrected read-open call (2.6 smoke consumes it).
- [x] 0.4 **(spike)** Confirm a `process.on('warning')` filter in the entry FULLY silences the node:sqlite
  `ExperimentalWarning` on the pinned Node (stderr stays clean; stdout is already machine-clean), OR whether
  `sea-config.json.disableExperimentalSEAWarning` + a startup flag is ALSO needed. Resolves **Q5**. Done: the confirmed
  suppression recipe recorded (1.2/`sea-entry` + 2.5 `sea-config.json` consume it).
- [x] 0.5 **(spike, Windows)** Confirm whether the copied `node.exe` needs `signtool remove /s` (strip signature) BEFORE
  postject on the pinned Node build, and that the produced exe runs on a clean Windows (SmartScreen may warn — code
  signing is explicitly OUT of scope, but the exe MUST run). Resolves **Q6**. Done: the required pre-postject steps
  recorded (2.5 `build-sea.ps1` consumes them).
- [x] 0.6 GATE (Batch 0): all 0.1–0.5 findings recorded into a new **"Batch 0 — empirical findings"** section appended to
  `openspec/changes/phase-9.5c-binaries/design.md` (pin the exact Node patch, argv offset, readOnly recipe, warning-filter
  recipe, Windows postject steps); the Node-pin decision (Q2) is FINAL. NO `src/` changed. Then COMMIT
  `docs(9.5c): record Batch 0 empirical SEA/node:sqlite findings`. Done: design.md updated; pin decided.

## Batch 1: Pure runtime seams — `--version`, `planEntry`, `startMcpServer`, `loadOptionalDriver`, factory swaps, isSea store flip (ALL vitest, NO artifact)

> Satisfies `binary-distribution` R1 ("bundle boots + serves `--version`", `node:sqlite` read path) and R3
> ("driver-degradation preserved") at the CODE-SEAM level — every seam is pure TypeScript, RED→GREEN in `npm test`, NO
> binary required. This batch is the honest TDD half: the off-SEA branch of every seam is BYTE-IDENTICAL to today, so the
> regression goldens (`git diff --exit-code test/golden/`) stay EMPTY. NO esbuild/SEA/postject here — only the seams the
> bundle will later exercise. Realizes **Q1** (D7 full) and consumes the **Q3** argv offset from Batch 0.

- [x] 1.1 **(vitest)** RED→GREEN `test/cli/cli.test.ts` (extend) + `src/cli/cli.ts`: add a `--version`/`-v` branch in
  `runCli` that prints `process.env.DBGRAPH_BUILD_VERSION ?? DBGRAPH_VERSION` (imported from `../index.js`) and returns 0;
  add a `version` line to `USAGE_TEXT`. Auto-run guard (L98) UNCHANGED. RED first: with `DBGRAPH_BUILD_VERSION` UNSET,
  `runCli(['--version'])` prints EXACTLY `0.0.0` + returns 0; with it SET to `'9.9.9'`, prints `9.9.9`. Assert `--help`
  still prints `USAGE_TEXT` beginning `dbgraph — database schema graph indexer`. Spec scenario R1 "Bundle boots and serves
  --help/--version" (`--version` half), design D6. Done: `npm test cli`.
- [x] 1.2 **(vitest)** RED→GREEN `test/bin/sea-entry.test.ts` (new) + `src/bin/sea-entry.ts` (new): export PURE
  `planEntry(argv, isSea): { mode:'mcp' } | { mode:'cli'; args }` = `args = argv.slice(isSea ? 1 : 2)` (offset from Batch
  0.2), route `args[0]==='mcp'` → `{mode:'mcp'}` else `{mode:'cli',args}`. RED first: assert SEA slice(1) vs npm slice(2),
  `mcp` routing, `--version`/`--help` pass-through, empty argv. NO spawn, NO `import.meta` guard. Wire the unconditional
  runner (dispatch `mcp`→`startMcpServer()` else `runCli(args)`) + the Batch-0.4 `process.on('warning')` filter (logic
  tested via `planEntry`; the runner glue is smoke-covered in 2.6). Spec scenario R1 "Bundle boots…", design D5. Done:
  `npx tsc --noEmit`; `npm test sea-entry`.
- [x] 1.3 **(vitest)** RED→GREEN `test/mcp/server.test.ts` (extend) + `src/mcp/server.ts`: export `startMcpServer()`
  (wrapping the existing stdio-server startup at ~L420); KEEP the existing auto-run guard for the npm `dbgraph-mcp` bin
  (byte-identical behavior on that path). RED first: assert `startMcpServer` is exported and callable over an injected/fake
  transport WITHOUT the auto-run guard firing. Spec: design D5 (MCP reached as `dbgraph mcp`). Done: `npx tsc --noEmit`;
  `npm test server`.
- [x] 1.4 **(vitest)** RED→GREEN `test/adapters/engines/_shared/load-optional-driver.test.ts` (new) +
  `src/adapters/engines/_shared/load-optional-driver.ts` (new): `loadOptionalDriver(name): Promise<unknown>`. Inject fake
  `isSea`/`createRequire`/`import` seams. RED first: (a) SEA branch (`isSea()===true`) resolves via `createRequire` from an
  explicit cwd base (assert base = `process.cwd()` first, then `process.execPath` fallback), (b) off-SEA branch calls
  `import(name)` byte-identically to today, (c) a resolution MISS RETHROWS (so the callers' existing catch → `npm i`
  error). Spec scenario R3 "Live-DB command without a driver fails…", design D7, Q1 (D7 full). Done: `npx tsc --noEmit`;
  `npm test load-optional-driver`.
- [x] 1.5 **(vitest)** RED→GREEN (regression = RED-safe) swap the FOUR bare-specifier `import()` seams to
  `loadOptionalDriver`, non-SEA branch BYTE-IDENTICAL: `src/adapters/engines/pg/factory.ts` (L134),
  `src/adapters/engines/mysql/factory.ts` (L140), `src/adapters/engines/mongodb/factory.ts` (L87), and
  `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` (L143) — NOT `mssql/factory.ts` (see DISCOVERY).
  PRESERVE each existing `deps.import*` test override (route it through `loadOptionalDriver`'s injected `import` seam so the
  MODULE_NOT_FOUND catch still fires). Every existing factory/strategy test + golden passes UNCHANGED (they are the RED→GREEN
  oracle: a drift means the seam leaked). Do NOT touch the `probe.ts` import seams (out of scope). Spec scenario R3
  "Live-DB command without a driver fails with the established install-command error" (byte-identical off-SEA), design D7,
  ADR-006. Done: `npx tsc --noEmit`; `npm test` (all engine suites green, no golden drift).
- [x] 1.6 **(vitest)** RED→GREEN `test/infra/open-connections.test.ts` (new or extend) + `src/infra/open-connections.ts`:
  at L169, when `sea.isSea()` is true pass `driver:'node:sqlite'` to `createSqliteGraphStore` (conditional spread —
  `exactOptionalPropertyTypes`); npm/dev path UNCHANGED (no `driver` → default `better-sqlite3`). Access `isSea` via a
  `createRequire('node:sea')` seam INJECTABLE for the test (avoid a static `node:sea` type dep). RED first: with a fake
  `isSea()===true`, assert `createSqliteGraphStore` receives `driver:'node:sqlite'`; with `isSea()===false`, assert NO
  `driver` key is passed (default preserved). Spec scenario R1 "Graph reads run on node:sqlite inside the bundle",
  design D2. Done: `npx tsc --noEmit`; `npm test open-connections`.
- [x] 1.7 GATE (Batch 1): `npx tsc --noEmit` clean (NO `any`); `npm run lint` 0/0; `npm test` full suite GREEN with NO
  binary; `git diff --exit-code test/golden/` EMPTY (every off-SEA branch byte-identical, ADR-008) — ANY drift is a HARD
  STOP (a seam leaked behavior; investigate, do NOT re-bless). Confirm NO static top-level driver import was introduced and
  the `dbgraph`/`dbgraph-mcp` bin behavior is unchanged. Then COMMIT `feat(9.5c): runtime seams for SEA binary (--version,
  entry dispatch, optional-driver + node:sqlite store)`. Done: all gates green; goldens empty.

## Batch 2: Bundle pipeline + SEA assembly (Windows native) + ADR-009 + win no-node_modules smoke

> Satisfies R1 ("one self-contained bundle, drivers external/not inlined"), R2 win-x64 half ("SEA binary passes the
> no-node_modules smoke"), R3 in-binary ("graph-read succeeds / live-DB fails with install error"), and R6
> ("byte-identical bundle + SEA blob"). The pure config is **(vitest)**; everything that produces or inspects an ARTIFACT
> is **(smoke)** — `npm test` stays green with NO binary. Materializes ADR-009 alongside the bundle it documents.

- [x] 2.1 **(doc)** Create `docs/adr/009-node-sea-standalone-binaries.md` verbatim from design.md §"ADR-009 (full text)"
  (Status Accepted · Date 2026-07-06 · Refines ADR-006 bundling clause + ADR-008). REFINES ADR-006's "static bundling in
  the binaries" sentence; ADR-006's pure-JS-driver + lazy-optional decisions STAND. Spec: R1 external-driver refinement
  narrative. Done: file exists, matches the design text, denylist-clean.
- [x] 2.2 **(vitest)** RED→GREEN `test/bin/esbuild-config.test.ts` (new) + `scripts/sea/esbuild-config.mjs` (new): export
  `SEA_EXTERNAL` (the 6 specifiers) + `buildOptions(version)` (DATA) + a `versionDefine(version)` helper. RED first: assert
  `buildOptions('0.0.0')` has `format==='cjs'`, `platform==='node'`, `bundle===true`, `target==='node24'`, `external` ⊇
  `['better-sqlite3','mysql2','mysql2/promise','pg','mssql','mongodb']`, entry is `src/bin/sea-entry.ts`, outfile
  `build/sea/dbgraph.cjs`, and `define['process.env.DBGRAPH_BUILD_VERSION'] === JSON.stringify('0.0.0')`. Spec scenario R1
  "better-sqlite3 and the four optional drivers are external, not inlined" (config half), design D4/D6. Done:
  `npm test esbuild-config`.
- [x] 2.3 **(smoke)** `scripts/sea/build-bundle.mjs` (new): reads `package.json.version`, calls
  `esbuild.build(buildOptions(version))` → `build/sea/dbgraph.cjs`. Add `esbuild` devDep + `package.json` script
  `bundle:sea`. Local sanity (NOT in `npm test`): `node build/sea/dbgraph.cjs --version` prints `0.0.0` and `--help`
  prints the usage on a Node WITH `node_modules` present (proves the bundle wired the entry). Spec scenario R1 "Bundle
  boots…", design D8. Done: `npm run bundle:sea` emits the cjs; sanity run passes.
- [x] 2.4 **(smoke)** `test/bin/bundle-external.smoke.test.ts` (new, requires the built `build/sea/dbgraph.cjs`): scan the
  emitted bundle source and assert `better-sqlite3`, `mysql2`, `pg`, `mssql`, `mongodb` appear ONLY as external dynamic
  references and NONE of their module BODIES is inlined (assert the drivers' internal marker strings are ABSENT). Spec
  scenario R1 "better-sqlite3 and the four optional drivers are external, not inlined". Done: `npm run smoke:binary`
  (this file) green; SKIPS cleanly when the bundle is absent.
- [x] 2.5 **(smoke)** `scripts/sea/sea-config.json` (new: `main`/`output`/`disableExperimentalSEAWarning:true` +
  Batch-0.4 flags) + `scripts/sea/build-sea.ps1` (new): bundle → `node --experimental-sea-config` → `build/sea/dbgraph.blob`
  → copy pinned `node.exe` → (Batch-0.5 `signtool remove /s` if required) → `postject` inject at `NODE_SEA_FUSE` →
  `dist/bin/dbgraph-win-x64.exe`. Add `postject` devDep (justify per ADR-007) + `package.json` script `build:sea:win`. Spec
  scenario R2 "win-x64 SEA binary passes the no-node_modules smoke" (build half), design D8, Q6. Done: `npm run
  build:sea:win` emits the exe.
- [x] 2.6 **(smoke)** `vitest.smoke.config.ts` (new: `include:['test/**/*.smoke.test.ts']`, requires
  `DBGRAPH_BINARY_PATH`) + `vitest.config.ts` (add `**/*.smoke.test.ts` to `exclude`) + `package.json` script
  `smoke:binary` + `test/bin/win-binary.smoke.test.ts` (new): in a TEMP cwd with NO `node_modules`, using a `node:sqlite`
  fixture `.dbgraph` graph, assert the exe `--version` == `package.json.version` (`0.0.0`), `--help` prints the usage
  beginning `dbgraph — database schema graph indexer`, and `init→sync→query <term>` exits 0 with output BYTE-IDENTICAL to
  the recorded golden (ADR-008), reaching persistence through the `node:sqlite` handle with NO native module. Spec
  scenarios R2 "win-x64 SEA binary…", R2 "query against an existing graph returns pinned output", R3 "Graph-read commands
  succeed with no driver present", R1 "Graph reads run on node:sqlite". Consumes Batch-0.3 readOnly recipe. Done:
  `npm run smoke:binary` green; `npm test` STILL green with the smoke EXCLUDED.
- [x] 2.7 **(smoke)** `test/bin/win-binary.smoke.test.ts` (extend) — driver-degradation in the binary: with NO resolvable
  driver, a live-DB command (e.g. `sync` against a live DB) FAILS with a `ConnectivityUnavailableError` whose message is
  EXACTLY `Required driver '<name>' is not installed. Run: npm i <name>`, exits code 2, and prints NO raw stack trace.
  Spec scenario R3 "Live-DB command without a driver fails with the established install-command error", design D7. Done:
  `npm run smoke:binary` green.
- [x] 2.8 GATE (Batch 2): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN with NO binary built (smoke
  EXCLUDED — D12); then LOCALLY the win exe builds and `npm run smoke:binary` is green; DETERMINISM: rebuild `dbgraph.cjs`
  and `dbgraph.blob` from the same source on the pinned Node and assert BOTH are byte-identical to the first build (the
  injected exe is NOT asserted byte-stable — its checksum is the anchor, R6). Denylist scan clean. Then COMMIT
  `feat(9.5c): esbuild bundle + Windows SEA assembly + no-node_modules smoke`. Spec scenarios R6 "Same source and pinned
  Node yield a byte-identical bundle", R6 "SEA blob is byte-identical across rebuilds". Done: gates green; bundle+blob
  byte-identical.

## Batch 3: Linux leg via Docker + Node-LESS container smoke

> Satisfies R2 linux-x64 half ("SEA binary builds via Docker and passes the SAME smoke") and R6 (linux bundle
> determinism). Depends on Batch 2's `esbuild-config.mjs` + `build-bundle.mjs` (shared) but NOT on the win exe. All
> **(smoke)** — Docker-gated, opt-in, never in `npm test`. The Node-LESS smoke image is the strongest proof of "no Node,
> no node_modules required" (design D9).

- [x] 3.1 **(smoke)** `scripts/sea/build-sea.sh` (new: bundle → sea-config → copy the pinned `node` → postject →
  `dist/bin/dbgraph-linux-x64`) + `scripts/sea/build-linux-docker.(ps1|sh)` (new:
  `docker run --rm -v <repo>:/w -w /w node:24-bookworm-slim bash scripts/sea/build-sea.sh`) + `package.json` script
  `build:sea:linux`. Same steps as the ps1 (D8) on a glibc base (D9). Spec scenario R2 "linux-x64 SEA binary builds via
  Docker…" (build half), design D9. Done: `npm run build:sea:linux` emits `dist/bin/dbgraph-linux-x64`.
- [x] 3.2 **(smoke)** `scripts/sea/smoke-linux.sh` (new): `docker run --rm` on `debian:bookworm-slim` (NO node, NO
  node_modules, ONLY the binary bind-mounted) → `--version` == `package.json.version`, `--help` prints the SAME usage as
  the win binary, and `init→sync→query <term>` returns output BYTE-IDENTICAL to the golden (ADR-008) on the in-binary
  `node:sqlite`. Spec scenarios R2 "linux-x64 SEA binary builds via Docker and passes the same smoke", R2 "query returns
  pinned output", R3 "Graph-read commands succeed with no driver present". Done: `bash scripts/sea/smoke-linux.sh` green
  in a Node-less container.
- [x] 3.3 GATE (Batch 3): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN with NO binary; then LOCALLY the
  Docker build + Node-less smoke are green; DETERMINISM: rebuild the linux `dbgraph.cjs`/`.blob` and assert byte-identical
  (R6); CROSS-PLATFORM PARITY: the linux binary's `--version` and `--help` output are IDENTICAL to the win binary's.
  Denylist clean. Then COMMIT `feat(9.5c): linux-x64 SEA build via Docker + Node-less container smoke`. Done: gates green;
  parity + determinism confirmed.

## Batch 4: `release.yml` (trigger-guarded, unfired) + installers (SHA256 fail-closed) + `asset-name` + `.nvmrc` + US-037 reconciliation + final gate

> Satisfies R4 ("release.yml trigger-guarded, provenance-producing, never fired"), R5 ("installers verify SHA256 before
> PATH, fail closed"), R6 ("injected binary pinned by recorded checksum"). Pure mapping + the yaml trigger-guard are
> **(vitest)**; the fail-closed installer behavior is **(smoke)** against LOCAL fixtures (no release is fired). Q7 (macOS
> leg) is realized here as present-but-dormant. This batch closes the phase.

- [ ] 4.1 **(vitest)** RED→GREEN `test/bin/asset-name.test.ts` (new) + `scripts/install/asset-name.mjs` (new): pure
  `assetName(platform, arch)`. RED first: `assetName('win32','x64')==='dbgraph-win-x64.exe'`,
  `assetName('linux','x64')==='dbgraph-linux-x64'`; an unsupported pair throws (or a defined sentinel). This is the shared
  contract the ps1/sh replicate. Spec scenario R5 "Fetch is parameterized by version and platform" (asset half). Done:
  `npm test asset-name`.
- [ ] 4.2 **(vitest)** RED→GREEN `test/bin/release-workflow.test.ts` (new — the TRIGGER-GUARD test) +
  `.github/workflows/release.yml` (new): trigger-guarded `on: { push: { tags: ['v*.*.*'] }, workflow_dispatch: {} }`;
  matrix `[windows-latest, ubuntu-latest, macos-latest]` (macOS leg PRESENT but dormant — Q7); each leg builds bundle+SEA
  and emits `SHA256SUMS`; a release job runs `actions/attest-build-provenance` + creates the Release attaching binaries +
  `SHA256SUMS`; `permissions: contents/id-token/attestations: write`; `concurrency`. RED first: parse the `on:` block and
  assert the ONLY trigger keys are `push.tags` + `workflow_dispatch`, with NO `pull_request` and NO branch-`push`; assert a
  `SHA256SUMS`-producing step and an attestation step exist. Spec scenarios R4 "Workflow triggers contain ONLY tag-push and
  workflow_dispatch", R4 "Release job produces SHA256SUMS and provenance attestation", design D10, Q7. Done:
  `npm test release-workflow`.
- [ ] 4.3 **(smoke)** `install.ps1` + `install.sh` (new, pure shell, no runtime deps — D11): detect os/arch →
  `assetName()` (replicating 4.1) → download binary + `SHA256SUMS` from a pinned release selected by VERSION+PLATFORM →
  compute local SHA256 → compare case-insensitively → on MISMATCH delete the partial and exit non-zero with an actionable
  message BEFORE any PATH placement → on MATCH `chmod +x`(sh)/move to a user-local install dir + print PATH guidance.
  Fail-closed SMOKE (local fixtures, NO real release, download stubbed to a temp "release" dir): (a) matching checksum →
  binary placed + exit 0; (b) tampered checksum → nothing placed, partial deleted, non-zero exit; (c) the asset URL +
  checksum are selected by the version+platform pair (not hard-coded). Spec scenarios R5 "Matching checksum installs the
  binary on PATH", R5 "Checksum mismatch fails closed with nothing on PATH", R5 "Fetch is parameterized by version and
  platform", R6 "Injected binary integrity is pinned by its recorded checksum", design D11. Done: fail-closed smoke green
  (both installers) against local fixtures.
- [ ] 4.4 **(config)** `.nvmrc` (new): pin the exact Node 24 LTS patch decided in Batch 0.1 (determinism, ADR-008/ADR-009);
  `package.json` `engines.node` stays `>=22` (npm path), `.nvmrc` is the BUILD/embed pin. Spec: R6 determinism, design D3,
  Q2. Done: `.nvmrc` content matches the Batch-0 pin + ADR-009.
- [ ] 4.5 **(doc)** `docs/stories/07-quality-publication.md` (US-037): reconcile the "5 drivers statically bundled" AC →
  external/optional per ADR-009 (drivers stay `external`, lazy, optional; the binary READS on in-binary `node:sqlite` with
  zero drivers). Spec: R1 refinement narrative, ADR-006→ADR-009. Done: the AC wording matches ADR-009; no other AC altered.
- [ ] 4.6 GATE (Batch 4 — FINAL): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` GREEN with NO binary (includes
  the `asset-name` 4.1 + `release-workflow` 4.2 vitest tests); `git diff --exit-code test/golden/` EMPTY; the installer
  fail-closed smoke green LOCALLY; **`release.yml` has NOT been dispatched and NO release tag has been pushed** (inspect
  `git tag` + workflow-run history — the R4 "never fired" scenario); FINAL denylist/codename scan across ALL new files
  clean; confirm nothing pushed past `closeout`. Then COMMIT `feat(9.5c): guarded release workflow + checksum-verifying
  installers + Node pin (US-037 binaries)`. Spec scenario R4 "Workflow has not been fired this phase". Done: all gates
  green; workflow unfired; no tag.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 0** (0.1–0.6): empirical SEA/node:sqlite spikes on the pinned Node; record findings into design.md; pin the
  Node patch. NO `src/` change. GATE = findings recorded + Node pin FINAL (not a vitest gate).
- **Batch 1** (1.1–1.7): pure runtime seams — `--version` in `cli.ts`, `planEntry`/`sea-entry.ts`, `startMcpServer`
  export, `loadOptionalDriver` + 4 factory/strategy swaps, `open-connections.ts` isSea store flip. ALL **(vitest)**, off-SEA
  byte-identical, NO artifact. Load-bearing regression-safety batch.
- **Batch 2** (2.1–2.8): ADR-009 doc; `esbuild-config.mjs` **(vitest)** + `build-bundle.mjs`; `sea-config.json` +
  `build-sea.ps1` + postject → win exe; smoke config + win no-node_modules smoke. First ARTIFACT batch.
- **Batch 3** (3.1–3.3): `build-sea.sh` + `build-linux-docker.*` → linux binary; `smoke-linux.sh` Node-less container
  smoke. Docker-gated, opt-in.
- **Batch 4** (4.1–4.6): `asset-name.mjs` **(vitest)** + `release.yml` trigger-guard **(vitest)** + `install.ps1`/`install.sh`
  fail-closed **(smoke)** + `.nvmrc` + US-037 reconciliation + final unfired/denylist gate. Closes the phase.

### Dependency bottlenecks & parallelism

- **STRICTLY SEQUENTIAL across batches: 0 → 1 → 2 → 3 → 4.** Batch 0's constants (Node pin, argv offset, readOnly/warning
  recipes, Windows postject steps) are hard-coded by later batches — a wrong pin invalidates 2.x/3.x builds. Batch 0 is the
  single most load-bearing gate.
- **Within Batch 1, the seams PARALLELIZE** (1.1 `--version`, 1.2 `planEntry`, 1.3 `startMcpServer`, 1.6 isSea flip are
  independent pure seams) EXCEPT **1.5 depends on 1.4** — the 4 factory/strategy swaps require `loadOptionalDriver` to
  exist first. The `mssql` seam is in `strategies/native-tedious.strategy.ts`, NOT `factory.ts` (DISCOVERY) — missing this
  leaves mssql live-extraction broken in the binary.
- **1.2 (`planEntry`) hard-depends on Batch 0.2** (the `slice(isSea?1:2)` offset). A wrong offset silently drops the first
  user arg in the binary — the win smoke (2.6) is the safety net that catches it.
- **Batch 2's `esbuild-config.mjs` (2.2) + `build-bundle.mjs` (2.3) gate BOTH 2.5 (win) AND all of Batch 3 (linux)** — the
  bundle is shared; only the postject host differs per platform. 2.6's smoke config (`vitest.smoke.config.ts` +
  `vitest.config.ts` exclude) is the D12 seam that keeps `npm test` green — if the exclude is missed, `npm test` breaks on
  machines with no binary (the whole CI-independence contract).
- **Batch 4 is largely INDEPENDENT of 2/3** (no real artifact is consumed — the installers use LOCAL fixtures and the
  workflow is never fired): 4.1 (`asset-name`), 4.2 (`release.yml`), 4.3 (installers), 4.5 (US-037 doc) can proceed in
  parallel; 4.3 replicates 4.1's mapping, and 4.4 (`.nvmrc`) consumes Batch 0.1's pin.
- **D12 is the phase-wide bottleneck:** every artifact-touching task is `*.smoke.test.ts`/shell, opt-in behind
  `DBGRAPH_BINARY_PATH`/Docker; `npm test` NEVER requires a binary. The verify phase checks the (vitest) vs (smoke) tag on
  each task — mislabeling a binary-dependent assertion as (vitest) would break `npm test` on a clean machine.

## Definition of Done (tied to the proposal's Success Criteria)

- [ ] ADR-009 authored (concise format); states SEA-vs-bun, tradeoffs, and explicitly REFINES ADR-006's "static bundling"
  clause; drivers stay external/optional. — Batch 2 (2.1), Batch 4 (4.5)
- [ ] ONE self-contained esbuild bundle is emitted; `better-sqlite3` + the 4 optional drivers are `external` and NONE is
  inlined; the bundle boots and serves `--help`/`--version` with `node_modules` absent; determinism (ADR-008) preserved
  (bundle + blob byte-identical across rebuilds). — Batch 1 (1.1, 1.2), Batch 2 (2.2, 2.3, 2.4, 2.8)
- [ ] win-x64 (native) + linux-x64 (Docker) SEA binaries build LOCALLY and pass the no-`node_modules` smoke: `--version` ==
  `package.json.version`, `--help` usage, and a real `query` against an existing graph BYTE-IDENTICAL to the golden. —
  Batch 2 (2.5, 2.6), Batch 3 (3.1, 3.2)
- [ ] The "works without any driver installed" guarantee holds in the binary: graph-READ (`query`/`explore`/`status`)
  succeeds on in-binary `node:sqlite` with ZERO drivers; a live-DB command without a driver fails with the EXACT
  `Required driver '<name>' is not installed. Run: npm i <name>` (`ConnectivityUnavailableError`, exit 2, no stack). —
  Batch 1 (1.4, 1.5, 1.6), Batch 2 (2.6, 2.7)
- [ ] `release.yml` exists, is trigger-guarded (tag-push + `workflow_dispatch` ONLY, NO `pull_request`/branch-push), defines
  the windows/linux/macos matrix, emits `SHA256SUMS`, and attaches build provenance — and has NOT been fired; NO tag
  pushed. — Batch 4 (4.2, 4.6)
- [ ] `install.ps1` + `install.sh` verify SHA256 BEFORE placing on PATH and FAIL CLOSED on mismatch (partial deleted,
  nothing on PATH, non-zero exit); the asset + checksum are selected by version+platform; the injected binary's integrity
  is anchored by its recorded `SHA256SUMS` checksum. — Batch 4 (4.1, 4.3)
- [ ] Determinism (ADR-008/ADR-009): the pinned Node patch is in `.nvmrc`; the esbuild bundle + SEA blob are
  byte-reproducible; the injected binary is NOT asserted byte-stable but pinned by checksum. — Batch 0 (0.1), Batch 2
  (2.8), Batch 3 (3.3), Batch 4 (4.4)
- [ ] No project codename leaks (denylist scan clean across all new files); `npx tsc --noEmit` strict clean (NO `any`);
  `npm run lint` 0/0; `npm test` GREEN with NO binary built (D12 CI-independence); no `test/golden` re-bless — all proven
  LOCALLY (no CI burn), nothing pushed past `closeout`. — Batch 1 (1.7), Batch 2 (2.8), Batch 3 (3.3), Batch 4 (4.6)
- [ ] US-037 (binaries half) satisfied for win/linux; the "5 drivers statically bundled" AC is reconciled to
  external/optional per ADR-009; macOS + release publication explicitly deferred to 9.5d (matrix leg present-but-dormant). —
  Batch 4 (4.2, 4.5)
