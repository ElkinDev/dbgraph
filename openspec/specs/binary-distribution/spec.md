# Binary Distribution Specification

## Purpose

The self-contained, no-Node-required packaging of dbgraph as single-file **win-x64 + linux-x64**
binaries a user downloads and runs with NO Node runtime and NO `node_modules` — the delivery half of
**US-037**. It covers: an esbuild bundle of the combined CLI+MCP entry with `better-sqlite3` and the
five DB drivers marked `external`; **Node SEA** assembly (`sea-config.json` + `postject`) runnable
LOCALLY (Windows native, Linux via Docker); a WRITTEN-but-NEVER-FIRED, trigger-guarded `release.yml`
producing `SHA256SUMS` and provenance attestation; and checksum-verifying `install.ps1` / `install.sh`.
This capability PACKAGES existing behavior — it introduces NO runtime-behavior change to extraction,
query, or MCP. Graph reads run on the built-in `node:sqlite` handle inside the binary (the 9.5b
storage seam), so the binary needs ZERO native modules. The SEA-vs-bun decision and the ADR-006
refinement are captured in **ADR-009**; determinism follows **ADR-008**.

> **The binary keeps DB drivers EXTERNAL, not statically bundled.** This REFINES / SUPERSEDES
> ADR-006's "static bundling in the binaries" clause and reconciles the US-037 acceptance criterion
> that read "5 drivers statically bundled". The lazy, OPTIONAL `import()` model (ADR-006's runtime
> guarantee) is PRESERVED: a binary with no resolvable driver still serves graph reads on
> `node:sqlite`. The design doc formalizes the ADR-006 refinement; this spec asserts the observable
> external-driver behavior.

## Requirements

### Requirement: One self-contained bundle with drivers and better-sqlite3 external

The build SHALL emit ONE self-contained esbuild bundle from the combined CLI+MCP entry. `better-sqlite3`
and the four optional DB drivers (`mssql`, `pg`, `mysql2`, `mongodb`) — together the five engine drivers
of ADR-002 — MUST be marked `external` so their lazy, optional dynamic `import()` semantics survive;
NONE of them may be inlined into the bundle. The bundle MUST boot on the pinned Node with `node_modules`
ABSENT and serve `--help` and `--version`, and MUST reach graph persistence through the `node:sqlite`
handle (no native addon).

#### Scenario: Bundle boots and serves --help/--version with node_modules absent

- GIVEN the produced single-file bundle run on the pinned Node with NO `node_modules` directory present
- WHEN `--help` is invoked
- THEN it exits 0 and prints the usage text beginning `dbgraph — database schema graph indexer` listing the `init`/`sync`/`status`/`query`/`explore`/`diff` commands
- AND WHEN `--version` is invoked it exits 0 and prints EXACTLY the `version` string from `package.json` (currently `0.0.0`)

#### Scenario: better-sqlite3 and the four optional drivers are external, not inlined

- GIVEN the emitted bundle source
- WHEN its contents are scanned for the driver module bodies
- THEN `better-sqlite3` and each of `mssql`, `pg`, `mysql2`, `mongodb` are referenced only as `external` dynamic imports and NONE of their module bodies appears inlined in the bundle

#### Scenario: Graph reads run on node:sqlite inside the bundle

- GIVEN the bundle executed with `node_modules` absent against an existing `.dbgraph` graph
- WHEN a graph-read command runs
- THEN persistence is reached through the `node:sqlite` `WritableSqliteHandle` (9.5b seam) with NO native module loaded

### Requirement: SEA binaries build locally for win-x64 and linux-x64 and pass a no-node_modules smoke

The SEA assembly SHALL produce a single-file executable for **win-x64** (built NATIVELY on Windows)
and **linux-x64** (built via Docker running the SAME steps). Each binary MUST be produced by
`node --experimental-sea-config sea-config.json` + `postject` injection using a PINNED Node LTS (>=22).
Both binaries MUST pass the no-`node_modules` smoke: `--version` prints exactly the `package.json`
version, and a real `query` against an existing `.dbgraph` graph returns its pinned output.

#### Scenario: win-x64 SEA binary passes the no-node_modules smoke

- GIVEN the win-x64 SEA binary built natively, run in an environment with NO `node_modules`
- WHEN `--version` runs
- THEN it exits 0 and prints EXACTLY the `package.json` `version` string (currently `0.0.0`)
- AND `--help` prints the usage text beginning `dbgraph — database schema graph indexer`

#### Scenario: linux-x64 SEA binary builds via Docker and passes the same smoke

- GIVEN the linux-x64 SEA binary built inside a Docker container running the SAME assembly steps on the pinned Node
- WHEN the smoke runs with NO `node_modules` present
- THEN `--version` prints EXACTLY the `package.json` `version` string and `--help` prints the same usage text as the win-x64 binary

#### Scenario: query against an existing graph returns pinned output

- GIVEN either binary run with NO `node_modules` against a pre-built `.dbgraph` graph containing matches for a fixed term
- WHEN `query <term>` runs
- THEN it exits 0 and prints each hit with its type and qualified name, BYTE-IDENTICAL to the recorded golden fixture (ADR-008)

### Requirement: Driver-degradation contract is preserved in the binary

The binary SHALL preserve the "works without any driver installed" guarantee. Graph-READ commands
(`query`, `explore`, `status`) against an existing `.dbgraph` MUST succeed with NO driver present.
Any live-DB command that REQUIRES a driver (e.g. `sync`/`init` against a live database) MUST fail with
the ESTABLISHED actionable error — a `ConnectionError` (code `E_CONNECTION`) whose message is
`Required driver '<name>' is not installed. Run: npm i <name>` — exiting with the connection-failure
exit code 2. The binary MUST NOT crash with a raw stack trace and MUST NOT silently degrade to a partial result.

#### Scenario: Graph-read commands succeed with no driver present

- GIVEN either binary run with NO `node_modules` and NO DB driver resolvable, against an existing `.dbgraph` graph
- WHEN `query`, `explore` or `status` runs
- THEN each succeeds on the `node:sqlite` read path and exits 0 (or 1 for a legitimate zero-result query), with no native module required

#### Scenario: Live-DB command without a driver fails with the established install-command error

- GIVEN either binary with no resolvable DB driver
- WHEN a live-DB command (e.g. `sync` against a live database) requires the driver
- THEN it fails with a `ConnectionError` (`E_CONNECTION`) whose message is EXACTLY `Required driver '<name>' is not installed. Run: npm i <name>`
- AND the process exits with code 2 and prints no raw stack trace

### Requirement: release.yml is trigger-guarded, provenance-producing, and never fired

`release.yml` SHALL be WRITTEN with triggers restricted to tag-push AND `workflow_dispatch` ONLY — it
MUST NOT trigger on branch `push` or `pull_request`. It MUST define the build matrix (windows, linux,
macos), assemble each binary, emit a `SHA256SUMS` file over the release artifacts, and attach build
provenance / artifact attestation. In THIS phase the workflow MUST NOT be fired and NO tag is pushed.

#### Scenario: Workflow triggers contain ONLY tag-push and workflow_dispatch

- GIVEN the `release.yml` `on:` block
- WHEN its trigger keys are inspected
- THEN the ONLY triggers present are a tag `push` (e.g. `push.tags`) and `workflow_dispatch`
- AND NO `pull_request` trigger and NO branch-`push` trigger is present

#### Scenario: Release job produces SHA256SUMS and provenance attestation

- GIVEN the `release.yml` job definitions
- WHEN they are inspected
- THEN the matrix covers windows, linux and macos, and the job steps produce a `SHA256SUMS` file over the built artifacts and emit build provenance / artifact attestation

#### Scenario: Workflow has not been fired this phase

- GIVEN the repository state at the end of this phase
- WHEN the release history and pushed tags are inspected
- THEN `release.yml` has NOT been dispatched and NO release tag has been pushed

### Requirement: Installers verify SHA256 before placing on PATH and fail closed

`install.ps1` (`irm|iex`) and `install.sh` (`curl|sh`) SHALL fetch a released binary selected by
VERSION and PLATFORM, compute its SHA256 and compare it to the published checksum BEFORE placing the
binary anywhere on PATH. On a checksum MATCH the binary MUST be placed on PATH; on any MISMATCH the
installer MUST FAIL CLOSED — abort with a non-zero exit and leave NOTHING on PATH. Installers use only
shell builtins / OS-provided tools (no runtime dependency).

#### Scenario: Matching checksum installs the binary on PATH

- GIVEN a downloaded binary whose computed SHA256 equals the published checksum for its version+platform
- WHEN the installer runs
- THEN it verifies the checksum BEFORE placement and then places the binary on PATH, exiting 0

#### Scenario: Checksum mismatch fails closed with nothing on PATH

- GIVEN a downloaded binary whose computed SHA256 does NOT equal the published checksum
- WHEN the installer runs
- THEN it aborts with a non-zero exit and an actionable mismatch message
- AND NO binary is placed on PATH

#### Scenario: Fetch is parameterized by version and platform

- GIVEN an installer invoked for a specific version and the host platform (win-x64 or linux-x64)
- WHEN it resolves the download URL and checksum
- THEN both are selected by that version+platform pair (not hard-coded to a single artifact)

### Requirement: Bundle and SEA blob are deterministic; injected binary pinned by recorded checksum

Determinism SHALL follow ADR-008. Building from the SAME source on the SAME pinned Node LTS (>=22)
MUST produce a BYTE-IDENTICAL bundle and a BYTE-IDENTICAL SEA blob across rebuilds. Because `postject`
injection into a copied host Node executable is NOT guaranteed byte-stable across platforms/tool
versions, byte-reproducibility of the FINAL injected binary is NOT guaranteed; instead the injected
binary's integrity MUST be pinned by its recorded SHA256 in `SHA256SUMS`, which the installers verify.

#### Scenario: Same source and pinned Node yield a byte-identical bundle

- GIVEN the same source tree built twice with the same pinned Node LTS version
- WHEN the esbuild bundle is produced each time
- THEN the two bundle files are byte-identical (ADR-008)

#### Scenario: SEA blob is byte-identical across rebuilds

- GIVEN the byte-identical bundle and the same `sea-config.json` on the pinned Node
- WHEN the SEA blob is generated twice
- THEN the two blobs are byte-identical

#### Scenario: Injected binary integrity is pinned by its recorded checksum

- GIVEN a produced SEA binary whose post-injection bytes are NOT asserted to be cross-machine reproducible
- WHEN its SHA256 is recorded in `SHA256SUMS`
- THEN that recorded checksum is the integrity anchor the installers verify BEFORE placing the binary on PATH
