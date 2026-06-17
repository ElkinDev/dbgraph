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
**Phase:** 6 · **Depends on:** US-027, US-016, US-018 · **Status:** ☐ pending

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
**Phase:** 9.5 · **Depends on:** US-036 · **Status:** ☐ pending

**Acceptance criteria:**
- Spike documented in an ADR: Node SEA vs `bun build --compile`, with evidence of the 5 adapters working from a binary of each technology.
- win-x64/linux-x64/macos-x64/arm64 binaries built in CI, published on GitHub Releases with `SHA256SUMS` + provenance attestations.
- On a clean machine WITHOUT Node: `dbgraph init` + `sync` + MCP server work from the binary.
- The binary uses `node:sqlite`/`bun:sqlite` (zero native modules) through the `GraphStore` port; the 5 drivers are statically bundled.
- PowerShell (`irm|iex`) and sh (`curl|sh`) installers verify the checksum BEFORE installing.

### US-038 — Multi-agent install
**As** a user of any popular MCP agent, **I want** `dbgraph install` to detect and configure my agent automatically, **so that** I never edit JSON by hand — parity with codegraph's auto-detection.
**Phase:** 9.5 · **Depends on:** US-024 · **Status:** ☐ pending

**Acceptance criteria:**
- Table-driven detection (agent → known config path → format); initial set ≥ 6: Claude Code, Cursor, Codex CLI, Gemini CLI, opencode, VS Code/JetBrains via MCP.
- Idempotent (re-running does not duplicate entries); `--remove` deletes exactly what was added; one pass configures all detected agents and summarizes what it did.
- If none is detected, it prints the manual config (US-024 behavior) — it never fails dry.
- Adding support for a new agent = one table row + one test (documented in CONTRIBUTING as an easy contribution).
