# dbgraph — project context

Database schema graph for AI agents (the "codegraph for databases"): indexes the catalog into a
local SQLite+FTS5 graph and serves it over MCP. Read-only by construction.

## Status

- Current phase: **Phase 0 — Foundations** (master plan kept by the maintainer outside the repo).
- Requirements: `docs/stories/` (38 stories; implementation protocol in its README).
- Decisions: `docs/adr/` (001–008). Gotchas: `docs/learnings.md` (append-only, feeds the skills).

## Commands

- `npm test` · `npm run lint` · `npm run build` (tsup). CI: lint+test+audit on Windows/Linux, Node 22/24 (Node 20 dropped — EOL 2026-04).

## Methodology

- SDD per phase; STRICT TDD in `src/core` and output formats (golden files); integration-first
  for adapters (Testcontainers, never mock the driver).
- Skills in `.claude/skills/`: `dbgraph-conventions` (hexagonal, ADR-004), `dbgraph-testing`,
  `dbgraph-security`. They are development tooling — NOT published (npm ships `dist/` only).
- Conventional commits, one commit per task, reference the story: `feat: ... (US-012)`.

## Language policy

- EVERYTHING public is in English: code, comments, commit messages, branch names, documentation,
  issues, PRs, releases. Internal team communication may be in Spanish.

## Git identity (CRITICAL)

- PERSONAL project (GitHub account **ElkinDev**, email `niklerk23@gmail.com` via
  `~/.gitconfig-personal` + includeIf). Remote: `git@github-personal:ElkinDev/dbgraph.git`.
- BEFORE any push: `git config user.email` must return `niklerk23@gmail.com`.
  NEVER the corporate identity. NEVER use the `gh` CLI if it is authenticated with the
  corporate account.

## Security rules (summary — details in the skills and ADRs)

- Catalog SELECTs only; secrets via `${env:}` only; `.dbgraph/` always gitignored;
  dependencies = closed list (ADR-007); validation database via a dedicated read-only login.
