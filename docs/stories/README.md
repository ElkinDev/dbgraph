# dbgraph — User stories

Requirements input for each phase's SDD spec (master plan kept by the maintainer).
44 stories across 8 epics.

## Protocol for the implementing agent

1. Pick ONE story in `☐ pending` state whose phase is active and whose dependencies are `☑ done`.
2. Read the plan section the story references BEFORE writing code.
3. Implement following the methodology (TDD in core; see the `dbgraph-testing` skill): every
   acceptance criterion becomes at least one test.
4. When done: mark `☑ done`, note deviations in the story, record gotchas in
   `docs/learnings.md`, commit with conventional commits referencing the ID (`feat: ... (US-012)`).
5. NEVER silently half-implement a criterion — if one cannot be met, document it and escalate
   to the orchestrator.

## Epics

| Epic | File | Stories | Plan phases |
|---|---|---|---|
| E1 — Indexing & init | `01-indexing-init.md` | US-001..005 | 2, 4 |
| E2 — Graph core | `02-graph-core.md` | US-006..009 | 1 |
| E3 — AI consumption (MCP) | `03-mcp-ai-consumption.md` | US-010..019 | 5 |
| E4 — CLI | `04-cli.md` | US-020..025 | 4, 5 |
| E5 — Engine adapters | `05-adapters.md` | US-026..030 | 2, 3, 8, 9 |
| E6 — Security | `06-security.md` | US-031..033 | cross-cutting |
| E7 — Quality, publication & distribution | `07-quality-publication.md` | US-034..038 | 6, 7, 9.5 |
| E8 — Resilient connectivity | `08-resilient-connectivity.md` | US-039..044 | 8.5 |

## Global status

Update this table when closing each epic. Last update: 2026-06-19.

| Epic | Pending | Done |
|---|---|---|
| E1 | 5 | 0 |
| E2 | 3 | 1 |
| E3 | 10 | 0 |
| E4 | 6 | 0 |
| E5 | 3 | 2 |
| E6 | 3 | 0 |
| E7 | 5 | 0 |
| E8 | 0 | 6 |
