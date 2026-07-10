# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-10

Deepens the graph with the INTERNALS of programmable objects — a routine call
graph, routine parameters, view column-level lineage, and per-node dynamic-SQL
honesty — and adds an offline, self-contained graph visualization. Every new
edge and payload declares its provenance (catalog-declared vs body-parsed vs
honestly absent) per engine; nothing is fabricated where a catalog cannot
source it.

> Like 1.0.0, this is a source and packaging milestone: both distribution
> channels truthfully report `1.1.0`. Publishing to npm and cutting a binary
> Release remain user-gated and are documented in `docs/release.md`.

### Added

#### Routine call graph (`calls` edges)
- `calls` edges model routine→routine invocation (`EXEC` / `CALL` /
  `SELECT fn()`) as a first-class edge: catalog-declared where the engine
  resolves it (SQL Server `sys.sql_expression_dependencies`) and body-parsed
  elsewhere (PostgreSQL, MySQL, SQLite), each carrying its exact confidence tier.
- Impact and `affected` traversal now follows `calls`, so a leaf table reaches
  the routines that reach it through call chains.
- Preserving the referenced object's kind end-to-end removes the spurious
  "missing table" stub a proc→proc reference previously produced.

#### Routine parameters
- Routine parameters (name, type, direction, default) are captured as
  `RoutinePayload.parameters` and rendered in `explore` and `object`.
- Per-engine catalog sourcing with type honesty: SQL Server `sys.parameters`,
  PostgreSQL `pg_proc`, MySQL `information_schema.PARAMETERS`. SQLite has no
  parameter catalog and honestly reports parameters unavailable rather than
  fabricating them.

#### View column lineage
- View output columns map to their source `table.column` via column-grain edge
  attributes (`dstColumns`), sharpening impact to column precision.
- Per-engine catalog-or-degrade: SQL Server sources columns via
  `dm_sql_referenced_entities`; PostgreSQL via `view_column_usage` (parsed →
  declared); MySQL and SQLite degrade to object grain by absence. A column pair
  is emitted only where the catalog sources it — never fabricated.

#### Dynamic-SQL honesty
- The `[DYNAMIC SQL]` caveat is surfaced per node across `explore`, `object`,
  `precheck`, and `impact`, and degraded nodes are marked per-node in
  `precheck` / `affected` / `impact` output so incompleteness is never silent.

#### Graph visualization
- `dbgraph viz` exports a fully-offline, self-contained interactive HTML graph —
  vendored client assets, zero network requests at view time, embedding schema
  identifiers only (never connection strings, resolved secrets, or sampled
  values) — plus a deterministic `--mermaid` ER diagram. The exporter reads the
  whole graph through a new bulk read-only `GraphStore` seam. `viz` is a
  CLI-only human artifact, never an MCP tool.

#### Benchmark (honest)
- Benchmark honesty guards made precise (standalone-token / alphanumeric-
  adjacency no-leak checks; kind-aware without-dump coverage), and benchmark
  RUN 3 recorded (N=6): the dbgraph-fed and raw-schema arms tie at 100% accuracy
  while dbgraph uses about 24% fewer schema tokens (3581 vs 4722).

### Fixed
- Aligned the npm package scope (`@elkindev`) with the GitHub repository owner,
  resolving the pre-tag `repository.url` vs npm-scope mismatch flagged as a
  release verification item in `docs/release.md` (Step U3).

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

[1.1.0]: https://github.com/ElkinDev/dbgraph/releases/tag/v1.1.0
[1.0.0]: https://github.com/ElkinDev/dbgraph/releases/tag/v1.0.0
