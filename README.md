# dbgraph

> A codegraph for your database. dbgraph indexes a database catalog into a local
> graph of tables, columns, constraints, views, procedures, functions, triggers and
> their relationships, and serves it to AI agents over MCP — so one tool call answers
> what would otherwise cost several exploratory queries.

dbgraph reads a database's catalog (never its data), normalizes it into an
engine-agnostic graph, and persists that graph in a local SQLite + FTS5 index. AI
agents then query the graph over the Model Context Protocol (MCP) instead of
re-discovering the schema by hand.

- **Read-only by construction.** No command issues any write, DDL or DML against the
  target database — only catalog `SELECT`s through the adapter port
  (`openspec/specs/cli-config/spec.md` — "Read-only-against-target is INVIOLABLE").
- **100% local.** The graph lives in a local SQLite + FTS5 index; nothing leaves the
  machine (`openspec/specs/graph-storage/spec.md`).
- **Served over MCP.** The eight tools `dbgraph_explore`, `dbgraph_search`,
  `dbgraph_object`, `dbgraph_related`, `dbgraph_impact`, `dbgraph_path`,
  `dbgraph_precheck` and `dbgraph_status` expose the graph to agents over the official
  `@modelcontextprotocol/sdk` stdio transport
  (`openspec/specs/mcp-server/spec.md` — Purpose).

> **Status.** This repository runs **from source today**. There is no published npm
> package or binary yet — the release workflow exists but has never been fired (see
> [Limitations](#limitations)). Standalone win-x64 / linux-x64 binaries are planned for
> v1.0.

## What it models

Every catalog object becomes a node; every relationship becomes an edge.

- **Nodes** (`openspec/specs/graph-model/spec.md` — Node taxonomy): `database`,
  `schema`, `table`, `column`, `view`, `trigger`, `procedure`, `function`, `index`,
  and `field` (for document stores).
- **Edges** (`openspec/specs/graph-model/spec.md` — Edge taxonomy): `references`
  (declared foreign keys, plus an aggregated table→table form), `depends_on` (view
  dependencies), `reads_from` / `writes_to` (parsed from module bodies), `fires_on`
  (triggers, carrying the DML event), `indexes`, and `inferred_reference` (opt-in,
  carrying `confidence: inferred` and a numeric `score`).

Every edge is classified by `confidence` — `declared`, `parsed`, or `inferred` — so
the graph never hides how it knows something. A module whose body cannot be analyzed
is flagged `has_dynamic_sql: true` rather than guessing its edges
(`openspec/specs/graph-normalization/spec.md` — "Dynamic SQL declares blindness").

## Feature matrix

Five engines are supported. Each cell below is transcribed from the engine's canonical
extraction spec and its truthful `CapabilityMatrix` — not from memory.

| Engine | Tables & columns | Views | Indexes | Constraints / FKs | Procedures / functions | Triggers | Inferred relationships | Connectivity |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **SQLite** | ✓ | ✓ | ✓ | FK¹ | — | ✓ | ○ | local file (`better-sqlite3` / `node:sqlite`) |
| **SQL Server** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | SQL auth · NTLM · integrated (via `sqlcmd`) |
| **PostgreSQL** | ✓ | ✓² | ✓ | ✓ | ✓ | ✓ | ○ | host/port/db/user/password · optional SSL |
| **MySQL / MariaDB** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | host/port/db/user/password · optional SSL |
| **MongoDB** | collections + sampled fields³ | — | ✓ | —⁴ | — | — | ✓⁵ | `${env:VAR}` URI · database · sampleSize · TLS |

**Legend:** ✓ extracted · ○ opt-in, off by default · — not supported by the engine
(explicitly declared unsupported in its `CapabilityMatrix`).

**Per-cell sources:**

- **SQLite** — tables/columns, foreign keys (incl. composite), indexes
  (unique/partial/expression), views and triggers per
  `openspec/specs/sqlite-extraction/spec.md`. Its `CapabilityMatrix` declares
  procedures, functions, sequences and collections **unsupported** (same spec —
  "Truthful SQLite CapabilityMatrix"; `openspec/specs/cli-config/spec.md` — "SQLite
  offers no procedures").
  ¹ SQLite exposes foreign keys (including composite) and primary-key membership on
  columns; it has no separate named CHECK/UNIQUE constraint objects.
- **SQL Server** — tables/columns (types, nullability, defaults, computed); PK, FK
  (composite), unique and check constraints; indexes (clustered/nonclustered, filtered,
  included); views, procedures, functions and triggers with bodies per level; trigger
  `fires_on` plus its read/write effects — per
  `openspec/specs/mssql-extraction/spec.md`. Connectivity via SQL auth and NTLM, with
  integrated security handled through an external `sqlcmd` strategy (same spec; Kerberos
  SSO is unsupported).
- **PostgreSQL** — tables/columns (types, nullability, defaults, identity, generated);
  PK, FK (composite), unique and CHECK constraints; indexes (partial, expression,
  included); functions and procedures; triggers (event + timing) — per
  `openspec/specs/pg-extraction/spec.md`.
  ² Views include materialized views.
- **MySQL / MariaDB** — tables/columns (types, nullability, defaults, AUTO_INCREMENT);
  PK, FK (composite), unique and CHECK constraints; indexes (composite, uniqueness);
  views, functions, procedures and triggers — per
  `openspec/specs/mysql-extraction/spec.md`.
- **MongoDB** — collections via `listCollections`, with field structure **inferred by
  sampling** documents through `$sample` (dotted paths, union BSON types, presence
  frequency); indexes via `listIndexes`; `$jsonSchema` validators carried in `extra` —
  per `openspec/specs/mongodb-extraction/spec.md`. Its `CapabilityMatrix` declares
  `table`, `column`, `constraint`, `view`, `procedure`, `function`, `trigger` and
  `sequence` **unsupported** (`supportsBodies: false`; same spec — "Truthful MongoDB
  CapabilityMatrix"; `openspec/specs/cli-config/spec.md` — "MongoDB offers no
  triggers").
  ³ Field structure is a statistical inference over a finite sample — honest only about
  what the sample observed. Sampled **values are never persisted** (only field names,
  types and frequencies).
  ⁴ MongoDB has no foreign keys; top-level `$jsonSchema` validators are carried in the
  collection's `extra`.
  ⁵ For MongoDB, `inferred_reference` edges are the **only** relationships produced (an
  `<entity>_id` field infers a reference to the target collection's `_id`) and inference
  is auto-enabled by the presence of collection/field nodes.

**Inferred relationships** (the `○` cells) come from an opt-in, pure-core inference
engine that is **off by default** for the SQL engines. When enabled it emits
`inferred_reference` edges from column names and declared types alone — `<entity>_id`,
`<entity>Id`, `id_<entity>` resolved against real target tables and gated by type
compatibility — never by reading data values
(`openspec/specs/graph-normalization/spec.md` — "Opt-in structural inference of
references", "Inference is opt-in and OFF by default").

## Quickstart (from source)

There is no published package yet, so run from source. Requires **Node.js >= 22**.

```bash
git clone <this-repo> dbgraph
cd dbgraph
npm ci
npm run build
```

Then point dbgraph at a database and build its graph. Using SQLite as an example:

```bash
# 1. Initialize: validates the connection, writes dbgraph.config.json at the project
#    root (with ${env:VAR} references only — never plaintext secrets), gitignores the
#    local .dbgraph index, and runs the first sync.
dbgraph init --dialect sqlite --file ./app.db

# 2. Re-sync after schema changes (incremental — skips extraction when the catalog
#    fingerprint is unchanged; --full forces a rebuild).
dbgraph sync

# 3. Query the graph.
dbgraph query orders            # ranked hits, each with its type and qualified name
dbgraph query orders --json     # deterministic, machine-parseable JSON
dbgraph explore main.orders     # a node and its grouped neighbors (use the QUALIFIED name)
dbgraph status                  # counts, last snapshot, and live drift
```

`init` writes an env-only config: every connection-identity field (host, port, user,
password, URL) is stored as a `${env:VAR}` reference and resolved from `process.env` at
runtime — a plaintext credential is rejected
(`openspec/specs/cli-config/spec.md` — "Plaintext credentials are rejected").

## CLI reference

`dbgraph <command> [options]`. Run `dbgraph --help` for the full banner, or
`dbgraph <command> --help` for per-command options.

| Command | What it does |
|---------|--------------|
| `init` | Initialize the graph index for a database (writes config, gitignores `.dbgraph`, runs first sync). |
| `sync` | Synchronize the graph with the database — incremental by fingerprint; `--full` forces a rebuild. |
| `status` | Show current graph counts, the last snapshot, and whether the live schema has drifted. |
| `query <term>` | Full-text search the graph; prints type + qualified name per hit. Exits 1 on zero hits. |
| `explore <qname>` | Show a node and its grouped neighbors. `--detail brief\|normal\|full`. |
| `diff <a> <b>` | Compare two snapshots per object (added/removed/modified). `--last` compares the two most recent. Exits 1 when changes exist (CI-gate). |
| `affected <script.sql>` | Analyze a DDL script and report impacted objects. `--json` for machine output; exits 1 when anything is affected. |
| `doctor` | Run a content-free connectivity self-test (safe to share). |
| `install` | Wire `dbgraph-mcp` into supported MCP agents. `--project` for project scope, `--remove` to undo. |

Global flags: `--json` (machine-parseable output where supported), `--quiet` / `-q`
(suppress info/progress, keep warnings/errors), `--help` / `-h`, `--version` / `-v`.
`--json` payloads on stdout are deterministic and byte-identical for the same graph and
input (`openspec/specs/cli-config/spec.md`; `src/cli/cli.ts` `USAGE_TEXT`;
`src/cli/dispatch.ts` `COMMAND_TABLE`).

Exit codes map to a fixed contract (`openspec/specs/cli-config/spec.md`): `0` success ·
`1` a "negative" result (zero query hits, or diff/affected found changes) · `2`
connection failure · `3` permission failure · `4` unsupported dialect.

## MCP integration

`dbgraph install` wires an idempotent `dbgraph-mcp` server entry into every supported
agent's MCP config, driven by a single `AGENT_TABLE` source of truth
(`openspec/specs/mcp-server/spec.md` — "dbgraph install idempotently wires the agent MCP
config"; `src/cli/commands/install.ts`).

```bash
dbgraph install               # wire user-level config for every detected agent
dbgraph install --project     # write project-scoped config in the current directory
dbgraph install --remove      # remove the dbgraph-mcp entry from every detected agent
```

The written entry is `command` + `args` only (`npx -y dbgraph-mcp`) — never a secret.
Global install configures an agent **only if** its config file already exists;
`--project` (US-038) re-roots resolution at the current directory and **creates** absent
project files for the supported agents.

### Supported agents

| Agent | Config key & shape | Project-scoped file (`--project`) |
|-------|--------------------|-----------------------------------|
| Claude Code | `mcpServers.dbgraph-mcp = { command, args }` | `.mcp.json` |
| Cursor | `mcpServers.dbgraph-mcp = { command, args }` | `.cursor/mcp.json` |
| Gemini CLI | `mcpServers.dbgraph-mcp = { command, args }` | `.gemini/settings.json` |
| VS Code | `servers.dbgraph-mcp = { type: 'stdio', command, args }` | `.vscode/mcp.json` |
| opencode | `mcp.dbgraph-mcp = { type: 'local', command: [...] }` | `opencode.json` |
| Codex CLI | TOML `[mcp_servers.dbgraph-mcp]` | `.codex/config.toml` |

**Codex is trust-gated.** Codex loads project-scoped MCP servers only for **trusted**
projects, so `--project` reports it with a caveat verbatim:

```text
codex → written (requires trusted project: set trust_level in ~/.codex/config.toml)
```

### Env-var interpolation per agent

The `dbgraph-mcp` entry itself uses no interpolation (only `command` + `args`). But if
you hand-edit a config to add another server that needs a secret, each agent has its own
native env syntax — reference variables, never inline a credential:

| Agent | Config file | Env-var interpolation syntax |
|-------|-------------|------------------------------|
| Claude Code | `.mcp.json` | `${VAR}` |
| Cursor | `.cursor/mcp.json` | `${env:VAR}` |
| VS Code | `.vscode/mcp.json` | `${env:VAR}` + `inputs` |
| Gemini CLI | `.gemini/settings.json` | `$VAR` / `${VAR}` |
| opencode | `opencode.json` | `{env:VAR}` |
| Codex CLI | `.codex/config.toml` | TOML `env` tables — no string interpolation |

If no agent config is detected, `dbgraph install` prints a manual snippet for all six
formats and exits successfully.

## Troubleshooting

Run `dbgraph doctor` first — it prints a **content-free** capability report (engine,
native-driver presence, detected CLI tools with versions, ODBC presence, resolved
environment profile, and the strategy it would choose). It contains no schema name,
identifier, query result, or secret, so it is safe to paste into a bug report
(`openspec/specs/connectivity-diagnostics/spec.md` — "dbgraph doctor reports diagnostics
content-free"; `src/core/present/doctor.ts` `DoctorView`).

The real-world SQL Server connectivity breaks below are documented in
`docs/findings/connectivity-environments.md` (F-1..F-7) and handled by the
connectivity-strategy system (`openspec/specs/connectivity/spec.md`,
`openspec/specs/connectivity-diagnostics/spec.md`):

| # | Symptom | `doctor` field | Fix |
|---|---------|----------------|-----|
| F-1 | `sync` fails on an integrated-security SQL Server (no SQL login; the pure-JS driver can't do SSPI) | `cliTools` (sqlcmd absent) / `chosenStrategy: unavailable` | Install `sqlcmd`; dbgraph shells out with `sqlcmd -E` for integrated auth. |
| F-2 | Wrong `sqlcmd` flags for the installed variant/version | `resolvedProfile: <variant>@<versionRange>` | dbgraph selects flags per detected variant; if it reports an unrecognized profile, share the `doctor` output. |
| F-3 | Truncated / failed `FOR JSON` on a legacy `sqlcmd` | `resolvedProfile` (legacy) | dbgraph adapts flags per profile (e.g. `-y 0` alone on legacy 15.x). |
| F-4 | JSON parse fails at a chunk boundary | `resolvedProfile` (output shape) | dbgraph reassembles the 2033-char `FOR JSON` chunks without trimming. |
| F-5 | Non-ASCII characters corrupt the JSON stream | `resolvedProfile` (encoding) | dbgraph forces the `sqlcmd` output to codepage 65001 (`-f o:65001`). |
| F-6 | Malformed / partial tool output | actionable error (what was received, first N chars) — never a raw stack trace | Run `dbgraph doctor` and paste the content-free report. |
| F-7 | These `sqlcmd` transport breaks aren't caught by CI | — | Covered by recorded fixtures and an opt-in `sqlcmd` CI lane — see [CONTRIBUTING](CONTRIBUTING.md) and [Limitations](#limitations). |

A missing database driver surfaces the exact install command, not a stack trace —
`Required driver '<name>' is not installed. Run: npm i <name>`
(`openspec/specs/binary-distribution/spec.md`). A connection failure yields a typed,
non-blocking outcome offering at least three actionable options (run the catalog
`SELECT`s yourself, consented install, or import a manual dump) — never an unhandled
exception (`openspec/specs/connectivity-diagnostics/spec.md`).

## Limitations

Stated plainly, and by design:

- **No published release yet.** The package version is `0.0.0` and the `release.yml`
  workflow, though written and trigger-guarded, has never been fired — no tag has been
  pushed (`openspec/specs/binary-distribution/spec.md` — "release.yml is trigger-guarded
  ... and never fired"). Run from source today; standalone win-x64 / linux-x64 binaries
  are planned for v1.0.
- **MongoDB structure is inferred, not declared.** Field structure comes from `$sample`;
  it is honest only about what the sample observed. Sampled document **values are never
  persisted** — only field names, types and presence frequencies survive
  (`openspec/specs/cli-config/spec.md` — sampling is "structural only ... values never
  stored"; `openspec/specs/mongodb-extraction/spec.md`).
- **Inferred relationships are opt-in.** For the SQL engines, inference is off by
  default and must be enabled explicitly; it never reads data values
  (`openspec/specs/graph-normalization/spec.md`).
- **SQL Server integrated auth needs `sqlcmd`.** The pure-JS driver cannot do
  SSPI/Kerberos; integrated security is handled by shelling out to `sqlcmd -E`
  (`openspec/specs/mssql-extraction/spec.md`; `docs/findings/connectivity-environments.md`
  F-1).
- **The `sqlcmd` transport has a CI coverage gap.** Flag combinations, output shape,
  chunking and encoding only surface on a real `sqlcmd` run; they are covered by recorded
  fixtures and an opt-in CI lane, not the default unit matrix
  (`docs/findings/connectivity-environments.md` F-7).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the per-batch quality gate, the strict
TDD and spec-driven workflow, and the test tiers. Security posture and disclosure are in
[SECURITY.md](SECURITY.md).

## License

MIT
