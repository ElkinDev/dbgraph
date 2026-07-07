# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-07

First public release. dbgraph reads a database's catalog (never its data),
normalizes it into an engine-agnostic graph of tables, columns, constraints,
views, procedures, functions and triggers, persists that graph in a local
SQLite + FTS5 index, and serves it to AI agents over the Model Context Protocol.

> This is a source and packaging milestone: the repository truthfully reports
> `1.0.0` on both distribution channels and the release mechanics are in place.
> Nothing has been published to npm and no binary has been released yet — those
> steps are user-gated and documented in `docs/release.md`.

### Added

#### Graph core & storage
- Engine-agnostic graph model (nodes: database, schema, table, column, view,
  trigger, procedure, function, index, field; edges: `references`, `depends_on`,
  `reads_from`, `writes_to`, `fires_on`, `indexes`, `inferred_reference`) with
  per-edge `confidence` classification (`declared` / `parsed` / `inferred`).
- Local persistence in a SQLite + FTS5 index — nothing leaves the machine.
- Native-free write path on `node:sqlite`, removing the last native module from
  storage writes and enabling the standalone-binary work.

#### Database schema-extraction engines
- Five engines: **SQLite**, **SQL Server**, **PostgreSQL**, **MySQL / MariaDB**,
  and **MongoDB**. Each ships a truthful `CapabilityMatrix` that declares what the
  engine does and does not support rather than guessing.
- SQL engines extract tables/columns, constraints and foreign keys (including
  composite), indexes, views, and — where the engine supports them — procedures,
  functions and triggers with body-derived read/write effects.
- SQLite view-dependency edges (`depends_on`) resolved from view bodies.
- MongoDB models collections with field structure inferred by sampling documents
  (dotted paths, union BSON types, presence frequency); sampled values are never
  persisted.

#### Structural inference
- Opt-in, pure-core inference engine (off by default for the SQL engines) that
  emits `inferred_reference` edges from column names and declared types alone
  (`<entity>_id`, `<entity>Id`, `id_<entity>`), gated by type compatibility and
  resolved against real target tables — never by reading data values. For
  MongoDB, inference is the only relationship source and is auto-enabled.

#### CLI, config & UX
- Command-line interface with a read-only-against-target contract: `init`,
  `query`, `search`, `explore`, `object`, `diff`, `affected`, `install`,
  `doctor`, and `mcp`, plus `--help`/`-h` and `--version`/`-v`.
- Configuration and connection handling with `${env:VAR}` interpolation so
  secrets stay out of committed config.
- Observability and richer explore payloads for agent-facing output.

#### MCP server (stdio + HTTP)
- MCP server exposing eight tools — `dbgraph_explore`, `dbgraph_search`,
  `dbgraph_object`, `dbgraph_related`, `dbgraph_impact`, `dbgraph_path`,
  `dbgraph_precheck`, `dbgraph_status` — over the official
  `@modelcontextprotocol/sdk` stdio transport.
- Streamable HTTP transport (`mcp --http`) as an alternative to stdio.

#### Multi-agent install
- `dbgraph install` idempotently wires `dbgraph-mcp` into six supported agents —
  **Claude Code**, **Cursor**, **Gemini**, **VS Code**, **OpenCode**, and
  **Codex** — from a single `AGENT_TABLE` source of truth, with `--project` for
  project-scoped config and `--remove` to undo. Global install configures an
  agent only if its config already exists.

#### Standalone binaries (build pipeline)
- win-x64 and linux-x64 standalone-binary build pipeline via Node SEA (esbuild
  bundle + `postject` injection), runnable locally (Windows natively, Linux via
  Docker), with database drivers kept external/optional so graph reads run on
  `node:sqlite` with no `node_modules` present.
- Checksum-verifying installers `install.ps1` and `install.sh` that verify a
  SHA256 before placing a binary on PATH and fail closed on mismatch.
- A trigger-guarded `release.yml` workflow (tag-push / `workflow_dispatch` only)
  that has never been fired. The macOS build leg is present but dormant and
  produces no artifact in this release.

#### Public documentation & project scope
- Public-facing documentation: README with a per-engine feature matrix
  transcribed from each engine's canonical spec, quickstart, MCP/HTTP guide,
  ADRs, and contributor docs. `--project` scope support for install.

#### Benchmark (honest)
- A reproducible benchmark harness with hardened methodology, reporting measured
  numbers only — no projected or aspirational figures.

#### Resilient connectivity
- Connectivity strategies and resilient connection handling across engines
  (for example SQL Server SQL-auth / NTLM / integrated via `sqlcmd`, and
  optional SSL/TLS for PostgreSQL, MySQL and MongoDB), surfaced by a content-free
  `doctor` self-test that is safe to share.

[1.0.0]: https://github.com/ElkinDev/dbgraph/releases/tag/v1.0.0
