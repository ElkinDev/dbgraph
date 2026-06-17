# dbgraph

> Database schema graph for AI agents — index your database catalog into a local graph, served over MCP.

**Status: pre-alpha, under active development (Phase 0). Do not use yet — first usable release will be v0.1.**

## Vision

AI agents working against a database explore blindly: they query `information_schema`, read huge
DDL dumps, and guess at relationships — burning tokens and missing what matters most (triggers,
who writes where). dbgraph pre-builds a local graph of your schema:

- **Nodes**: tables, columns, views, indexes, constraints, procedures, functions, triggers, collections.
- **Edges**: foreign keys, view dependencies, `reads_from`/`writes_to` of procedures and triggers, and *inferred* relationships where no FK is declared.
- **Served over MCP**: agents get exact, compact answers (`explore`, `impact`, `precheck`, `path`...) in one tool call.
- **100% local**: SQLite + FTS5 index, read-only against your database by construction, no telemetry.

Planned engine support (v1.0): PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, MongoDB.

## Development

```bash
npm ci
npm test
npm run lint
```

Architecture and decisions live in `docs/adr/`. Requirements live in `docs/stories/`.

## License

MIT
