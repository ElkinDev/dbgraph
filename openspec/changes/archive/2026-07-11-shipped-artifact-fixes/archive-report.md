# Archive Report: shipped-artifact-fixes

**Change:** shipped-artifact-fixes
**Archived:** 2026-07-11
**Archive destination:** `openspec/changes/archive/2026-07-11-shipped-artifact-fixes/`
**Artifact store:** openspec (files)
**Verify verdict:** ARCHIVE-READY (0 CRITICAL / 1 WARNING-environmental-resolved / 2 SUGGESTION)
**Commits:** f04916d, d99136f, b89147f

## What shipped (1.1.1)

- **Bug 1 — scoped npx (kills the squat + 404).** `dbgraph install` now writes `npx -y -p @elkindev/dbgraph dbgraph-mcp` at every emission site (entry, Codex render, all four manual snippets) and in README; runs the `dbgraph-mcp` bin from INSIDE `@elkindev/dbgraph` instead of a non-existent (squattable) registry package.
- **Bug 2 — mssql CJS→ESM interop fix.** `native-tedious.strategy.ts` resolves `ConnectionPool` interop-safely (`mod['ConnectionPool'] ?? mod['default']?.['ConnectionPool']`) via an injectable `importModule` seam, matching the pg/mysql2/mongodb sibling pattern (ADR-006).
- **Gated dist-level live-connect test** (`dist-connect.integration.test.ts`) — spawns a fresh Node child that `require()`s the BUILT `dist/index.cjs`, closing the masking class where vitest lifted CJS named exports and hid the shipped-artifact defect.
- **config.yaml integration.available** false → true (stale flag corrected; testcontainers is installed and the integration suites run).

## Traceability (artifacts, openspec paths)

| Artifact | Path (in archive) |
|----------|-------------------|
| proposal | `2026-07-11-shipped-artifact-fixes/proposal.md` |
| spec delta — mcp-server | `2026-07-11-shipped-artifact-fixes/specs/mcp-server/spec.md` |
| spec delta — mssql-extraction | `2026-07-11-shipped-artifact-fixes/specs/mssql-extraction/spec.md` |
| design | `2026-07-11-shipped-artifact-fixes/design.md` |
| tasks | `2026-07-11-shipped-artifact-fixes/tasks.md` |
| apply-progress | `2026-07-11-shipped-artifact-fixes/apply-progress.md` |
| verify-report | `2026-07-11-shipped-artifact-fixes/verify-report.md` |
| archive-report | `2026-07-11-shipped-artifact-fixes/archive-report.md` |

## Canonical spec merges applied

### `openspec/specs/mcp-server/spec.md` — 2 MODIFIED

- **Requirement "dbgraph install idempotently wires the agent MCP config"** — opening gains the scoped-command sentence (`args: ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]`); "Previously" note updated to the args-fix rationale; every scenario's written entry re-scoped (mcpServers-JSON, VS Code `servers`, opencode array `command`, Codex TOML `args`); the manual-snippet scenario now shows the scoped example; the no-secrets scenario `e.g.` re-scoped. All other rules/scenarios preserved verbatim.
- **Requirement "dbgraph install --project scopes agent config to the project directory"** — opening entry re-scoped + args-fix "Previously" note added; the `--project` create/merge/Codex-TOML scenarios re-scoped. Preservation of `${env:VAR}` indirection and all other rules unchanged.

### `openspec/specs/mssql-extraction/spec.md` — 2 ADDED

Appended as section `## Requirements Added by shipped-artifact-fixes (2026-07-11)`:
- **Requirement "Optional mssql driver is resolved interop-safely across ESM and bundled CJS"** (3 scenarios) — sits alongside the existing "Missing mssql driver names the install command" requirement without modifying it.
- **Requirement "Live SQL Server connectivity is verified against the bundled dist, not vitest-loaded src"** (2 scenarios) — the gated dist-tier verification contract.

## Notes

- The single WARNING was concurrent-sibling tree contamination (not this change) and RESOLVED. Both SUGGESTIONs (assert skip-count; refresh cosmetic suite-count wording) are non-blocking and deferred.
- Version bump / CHANGELOG / release cut are intentionally OUT OF SCOPE (post-archive release concern).

## SDD cycle

Planned → implemented (STRICT TDD) → verified (ARCHIVE-READY) → archived. Change complete.
