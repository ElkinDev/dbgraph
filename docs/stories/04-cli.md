# E4 — CLI

Goal: everything the MCP offers, available to humans and scripts. References: §4.7, Phases 4-5.
(US-001..005 for init/sync live in E1; the rest of the CLI goes here.)

---

### US-020 — dbgraph query
**As** a developer, **I want** to search from the terminal, **so that** I can use the graph without an agent.
**Phase:** 4 · **Depends on:** US-011 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- `dbgraph query orders` prints the hits with type and qualified name (same search engine as US-011).
- `--json` emits stable JSON for scripting; exit 1 on zero results.

### US-021 — dbgraph explore (CLI)
**As** a developer, **I want** the explore bundle in the terminal, **so that** I can understand an entity without opening SSMS.
**Phase:** 4 · **Depends on:** US-010 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- `dbgraph explore dbo.orders` prints the same content as the MCP tool (same source, same golden).
- `--detail brief|normal|full` available.

### US-022 — dbgraph diff
**As** a developer, **I want** to compare two snapshots, **so that** I can see schema drift between dates.
**Phase:** 4 · **Depends on:** US-009 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- `dbgraph diff <snapA> <snapB>` (and `diff --last`) lists added/removed/modified grouped by type.
- For modified objects, it shows WHAT changed (column added, type altered, proc body changed by hash).
- Exit 0 with no changes, exit 1 with changes (usable in the user's CI gates).

### US-023 — dbgraph affected
**As** a developer with a written migration, **I want** `dbgraph affected migration.sql` BEFORE running it, **so that** I know the impact — analogous to `codegraph affected`.
**Phase:** 5 · **Depends on:** US-016 · **Status:** ☑ done (phase-5-mcp-server)

**Acceptance criteria:**
- Given a script with `ALTER TABLE` + `DROP INDEX`, then it prints the aggregated precheck of all statements (same engine as US-016).
- Non-parseable statements fall back to identifier matching and are reported as such.
- `--json` for pipeline integration.

### US-024 — dbgraph install
**As** a new user, **I want** `dbgraph install`, **so that** the MCP gets wired into my agent without editing JSON by hand.
**Phase:** 5 · **Depends on:** US-018 · **Status:** ☑ done (phase-5-mcp-server)

**Acceptance criteria:**
- Detects an installed Claude Code and registers the MCP server pointing at the current project; idempotent (re-running does not duplicate).
- If no agent is detected, it prints the documented manual config (Cursor/others) instead of failing.
- `dbgraph install --remove` undoes cleanly.

### US-025 — dbgraph watch (optional)
**As** a user actively developing the database, **I want** drift polling with auto-sync, **so that** I get codegraph-like freshness without impossible file-watchers.
**Phase:** 4 (optional) · **Depends on:** US-005, US-009 · **Status:** ☐ pending

**Acceptance criteria:**
- `dbgraph watch --interval 5m` checks the fingerprint and only syncs on drift (the fingerprint is cheap; the sync, only when needed).
- Ctrl+C terminates cleanly; transient connection errors retry with backoff without killing the process.
