# E7 — Quality, publication & distribution

Goal: prove the value with our own numbers, ship to GitHub/npm without embarrassment, and close
distribution parity with codegraph in v1.0.
References: Phases 6, 7 and 9.5.

---

### US-034 — Torture schemas + green CI
**As** the project, **I want** a per-engine integration suite in CI, **so that** every change is validated against real catalogs, not mocks.
**Phase:** 2-3 (built alongside each adapter) · **Depends on:** US-026, US-027 · **Status:** ☐ partial (mssql integration CI job added in phase-3-sqlserver-adapter)

_Note: mssql-integration CI job added to `.github/workflows/ci.yml` (ubuntu-latest, needs: [], DBGRAPH_INTEGRATION=1, runs npm run test:integration). Never blocks unit matrix. PostgreSQL/MySQL/MongoDB integration jobs pending their adapters._

**Acceptance criteria:**
- GitHub Actions: lint + unit (Windows and Linux, Node 20/22) + Testcontainers integration (Linux) for every implemented adapter.
- Each engine's torture schema is documented: which object type each section exercises.
- `npm ci` + `npm audit` as gates; Dependabot active.
- The main branch does not accept merges with red CI.

### US-035 — Validation and benchmark against a real enterprise database
**As** the author, **I want** OWN numbers measured against a real enterprise database, **so that** the README promises nothing I have not tested.
**Phase:** 6 · **Depends on:** US-027, US-016, US-018 · **Change:** `phase-benchmark` · **Status:** ☐ partial (reproducible WITH/WITHOUT harness shipped on the committed SQLite torture fixture; the real-DB run is optional corroboration filled by the orchestrator run)

_Note: phase-benchmark reconciles US-035 to what actually ships. The **primary substrate is the committed SQLite torture fixture** (reproducible from source), NOT the private enterprise DB — a valid, complete benchmark is producible from the fixture alone (`docs/benchmarks.md`). The real mssql graph at `C:\temp\dbgraph-validation` is **OPTIONAL, labeled corroboration** run only if `dbgraph status` opens it. The "dedicated read-only login" AC is **DOWNGRADED to read-only BY CONSTRUCTION** of the tool (catalog `SELECT`s only): the validation config uses integrated (Windows SSPI) auth under the author's own principal, so zero-writes is a property of the tool's query surface, not of a restricted grant. The SSMS-accuracy contrast is an **author attestation**, labeled as such — never a machine-verified figure. `init + sync` duration / index size / peak memory are reported **opportunistically**, not as hard gates. The methodology, mechanically-derived question set with machine-checkable ground truth, condition-blind unit-tested scorer, and the honesty-first `docs/benchmarks.md` (limitations travel WITH the numbers; extrapolation forbidden) are the load-bearing deliverable._

**Acceptance criteria:**
- Verified prerequisites: the validation database auth mode confirmed, dedicated read-only login created (NEVER application credentials).
- `init + sync` against the validation database completes and is measured: duration, index size, peak memory; accuracy contrasted against SSMS on a sample of objects (incl. procs and triggers).
- Benchmark: 5-10 real AI tasks WITH and WITHOUT dbgraph (join query, column-rename impact analysis, module explanation); tokens and tool calls recorded; reproducible methodology in `docs/benchmarks.md`.
- Zero writes to the validation database during the whole validation (verifiable by the read-only user: it CANNOT write).

### US-036 — v0.1 publication
**As** the author, **I want** to publish the repo and the package, **so that** anyone can install it in under 5 minutes.
**Phase:** 7 · **Depends on:** US-034, US-035 · **Status:** ☐ pending

**Acceptance criteria:**
- README: value proposition, quickstart, demo, benchmark numbers with methodology link, engines×capabilities table, security posture (§4.9).
- `CONTRIBUTING.md` + "how to add an adapter" guide good enough for a third party to implement an engine without touching `src/core`.
- `npm publish` with provenance; the package ships ONLY `dist/` (`files` whitelist); `npm i -g` + `dbgraph init -i` works on a clean Windows and Linux machine.
- Issue templates, `SECURITY.md`, MIT license, v0.1.0 release with changelog.

### US-037 — Self-contained binaries (no Node)
**As** a user without Node installed, **I want** to download a binary and use dbgraph, **so that** I can adopt it without preparing any environment — parity with codegraph's "no Node.js required".
**Phase:** 9.5 · **Depends on:** US-036 · **Change:** `phase-9.5c-binaries` · **Status:** ☐ partial (phase-9.5c: win-x64 + linux-x64 SEA binaries build LOCALLY, trigger-guarded `release.yml` + checksum installers written; macOS + actual GitHub-Release publication deferred to 9.5d)

_Note: phase-9.5c landed the LOCAL, CI-quota-safe half via Node SEA (ADR-009): win-x64 (native) + linux-x64 (Docker) binaries, a WRITTEN-but-NEVER-FIRED `release.yml` (tag-push + `workflow_dispatch` only), and checksum-verifying `install.ps1`/`install.sh`. The macOS matrix leg is present-but-dormant and the actual Release publication is deferred to 9.5d (CI-quota-blocked). The "5 drivers statically bundled" AC below is reconciled to external/optional per ADR-009 (which refines ADR-006's bundling clause)._

**Acceptance criteria:**
- Spike documented in an ADR: Node SEA vs `bun build --compile`, with evidence of the 5 adapters working from a binary of each technology.
- win-x64/linux-x64/macos-x64/arm64 binaries built in CI, published on GitHub Releases with `SHA256SUMS` + provenance attestations.
- On a clean machine WITHOUT Node: `dbgraph init` + `sync` + MCP server work from the binary.
- The binary uses `node:sqlite`/`bun:sqlite` (zero native modules) through the `GraphStore` port; the 5 DB drivers stay **external, lazy and optional** (dynamic `import()`), NOT statically bundled — reconciled per **ADR-009**, which refines ADR-006's "static bundling in the binaries" clause. The binary's guaranteed capability is READ/serve of an already-indexed graph on the in-binary `node:sqlite` with ZERO drivers; live extraction loads a driver only when one is resolvable (`$CWD/node_modules` → `NODE_PATH` → global), otherwise the established `npm i <driver>` error.
- PowerShell (`irm|iex`) and sh (`curl|sh`) installers verify the checksum BEFORE installing.

### US-038 — Multi-agent install
**As** a user of any popular MCP agent, **I want** `dbgraph install` to detect and configure my agent automatically, **so that** I never edit JSON by hand — parity with codegraph's auto-detection.
**Phase:** 9.5a · **Depends on:** US-024 · **Change:** `phase-9.5a-multi-agent-install` · **Status:** ✅ done (Batches A–E, `src/cli/commands/install.ts`)

**Locked decisions (phase-9.5a, all 6 agents shipped):**

| Agent | Format family | Config key & entry shape | Config path (win32 / posix) |
|-------|--------------|--------------------------|------------------------------|
| Claude Code | mcpServers-JSON | `mcpServers.dbgraph-mcp = { command, args }` | `%APPDATA%\Claude\claude_desktop_config.json` / `~/.config/Claude/claude_desktop_config.json` |
| Cursor | mcpServers-JSON | `mcpServers.dbgraph-mcp = { command, args }` | `%USERPROFILE%\.cursor\mcp.json` / `~/.cursor/mcp.json` |
| Gemini CLI | mcpServers-JSON | `mcpServers.dbgraph-mcp = { command, args }` | `%USERPROFILE%\.gemini\settings.json` / `~/.gemini/settings.json` |
| VS Code | servers-JSON | `servers.dbgraph-mcp = { type:'stdio', command, args }` (NO `mcpServers` key) | `%USERPROFILE%\.vscode\mcp.json` / `~/.vscode/mcp.json` |
| opencode | mcp-JSON | `mcp.dbgraph-mcp = { type:'local', command:[…] }` (array command, NO `args`) | `%USERPROFILE%\.config\opencode\opencode.json` / `~/.config/opencode/opencode.json` |
| Codex CLI | TOML | `[mcp_servers.dbgraph-mcp]` block: `command = "npx"`, `args = ["-y", "dbgraph-mcp"]` | `%USERPROFILE%\.codex\config.toml` / `~/.codex/config.toml` |

**Three-writer split (all PURE, ZERO new runtime dependencies):**
- **mcpServers-JSON** (Claude Code, Cursor, Gemini CLI): reuses the shipped `mergeMcpConfig` / `removeMcpConfig` (ADR-001 reuse principle).
- **servers-JSON** (VS Code): `mergeVsCodeConfig` / `removeVsCodeConfig` — `servers` key with `{type:'stdio', command, args}`. The `servers`-vs-`mcpServers` distinction is explicitly asserted.
- **mcp-JSON** (opencode): `mergeOpenCodeConfig` / `removeOpenCodeConfig` — `mcp` key with `{type:'local', command:[…]}` where command is a combined array; NO `args` field.
- **TOML** (Codex CLI): in-house `mergeCodexToml` / `removeCodexToml` micro-writer (ADR-007) — line-oriented, bounded to the fixed `[mcp_servers.dbgraph-mcp]` block; NOT a general TOML parser; ZERO new deps.

**One-row-per-agent contract:** adding a 7th agent = one `AGENT_TABLE` row + one test suite covering `resolvePath` (win32 + posix exact paths, missing-env → `undefined`), `merge`/`remove` (idempotency + other-entry preservation), and `runInstall` integration.

**Acceptance criteria (all met):**
- Table-driven detection via a typed `AGENT_TABLE`; all 6 agents implemented.
- All writers PURE; reuse shipped writer for mcpServers-JSON; new dedicated writers for VS Code and opencode; in-house Codex TOML micro-writer (ADR-007 — NO `toml` library).
- An agent is configured ONLY if its config file already exists; a missing env var or file skips it (never created).
- Idempotent (re-running does not duplicate entries, incl. the TOML block); `--remove` deletes exactly the `dbgraph-mcp` entry per agent (other entries intact); one pass configures all detected agents and summarizes what it did.
- If none is detected, it prints the updated manual config snippet (names all 6 agents) — US-024 behavior preserved.
- Full 6 × {win32, posix} cross-platform path matrix asserted exactly (L-009) via `FsSeam` + injected `platform`/`env` — no real FS, green on Windows, no CI.
- ZERO new runtime dependencies; `src/cli/dispatch.ts` and the `InstallOptions`/`InstallOutcome` contract unchanged.
