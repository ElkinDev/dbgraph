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

> **Status.** dbgraph is **published at v1.1.0** on npm as
> [`@elkindev/dbgraph`](https://www.npmjs.com/package/@elkindev/dbgraph), with `v1.0.0` and
> `v1.1.0` tags on GitHub; `dbgraph --version` reports `1.1.0`. See the
> [Quickstart](#quickstart) to install, or build the win-x64 / linux-x64 SEA binaries from
> `release.yml`.

## What it models

Every catalog object becomes a node; every relationship becomes an edge.

- **Nodes** (`openspec/specs/graph-model/spec.md` — Node taxonomy): `database`,
  `schema`, `table`, `column`, `view`, `trigger`, `procedure`, `function`, `index`,
  and `field` (for document stores).
- **Edges** (`openspec/specs/graph-model/spec.md` — Edge taxonomy): `references`
  (declared foreign keys, plus an aggregated table→table form), `depends_on` (view
  dependencies, optionally carrying the exact consumed source columns in
  `attrs.dstColumns`), `reads_from` / `writes_to` (parsed from module bodies), `fires_on`
  (triggers, carrying the DML event), `calls` (a routine invoking another routine),
  `indexes`, and `inferred_reference` (opt-in, carrying `confidence: inferred` and a
  numeric `score`).

Every edge is classified by `confidence` — `declared`, `parsed`, or `inferred` — so
the graph never hides how it knows something. A module whose body cannot be analyzed
is flagged `has_dynamic_sql: true` rather than guessing its edges
(`openspec/specs/graph-normalization/spec.md` — "Dynamic SQL declares blindness"). The
programmable-object internals added in v1.1.0 — routine parameters, routine→routine
`calls` edges, and view column-level lineage — carry the SAME provenance discipline
(catalog-`declared`, body-`parsed`, or honestly absent per engine); see
[Programmable-object depth](#programmable-object-depth-v110).

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

### Programmable-object depth (v1.1.0)

v1.1.0 (the DOG series — deep object graph) models the INTERNALS of programmable objects,
per-engine and provenance-honest: a routine→routine call graph, routine parameters, view
column-level lineage, and a per-node dynamic-SQL degradation marker. Each cell is `declared`
(catalog-sourced), `parsed` (body-tokenized), or honestly `—` (the engine has no such
catalog / object) — never fabricated.

| Engine | `calls` edges (routine→routine) | Routine parameters | View column lineage (`attrs.dstColumns`) | `[DYNAMIC SQL]` per-node marker |
|--------|:---:|:---:|:---:|:---:|
| **SQLite** | — (no routines) | — (no routines) | object-grain¹ | — (no dynamic-SQL form) |
| **SQL Server** | declared² | ✓ `sys.parameters`³ | declared, native path⁴ | ✓⁵ |
| **PostgreSQL** | parsed⁶ | ✓ `pg_proc`⁷ | declared `view_column_usage`⁸ | ✓⁹ |
| **MySQL / MariaDB** | parsed¹⁰ | ✓ `information_schema.PARAMETERS`¹¹ | object-grain¹² | ✓¹³ |
| **MongoDB** | — (no routines) | — (no routines) | — (no SQL views) | — (no routines) |

**Legend:** `declared` = catalog-sourced · `parsed` = body-tokenized (`confidence: parsed`) ·
object-grain = the view→table `depends_on` edge stands but carries NO `attrs.dstColumns`
(degrade-by-absence, never a body-parsed guess) · ✓ / — for the marker = whether a
dynamic-SQL routine is annotated per node.

**Per-cell sources:**

¹ SQLite views keep object-grain `depends_on` with no `dstColumns` — no column catalog and no
body-parsed columns (`openspec/specs/sqlite-extraction/spec.md` — "View column lineage
degrades by absence (no catalog, no body-parsed columns)"). SQLite emits no `calls` edges and
no routine parameters, because its `CapabilityMatrix` declares procedures/functions
unsupported (same spec — "SQLite emits no calls edges (capability honestly absent)", "SQLite
emits no routine parameters (capability honestly absent)").
² SQL Server resolves `EXEC` / `SELECT fn()` calls from `sys.sql_expression_dependencies` —
catalog IDENTITY, no body parse — so mssql `calls` edges are `declared`
(`openspec/specs/mssql-extraction/spec.md` — "Catalog-declared calls edges for routine
invocations"; `openspec/specs/graph-model/spec.md` — "calls edge provenance is
engine-determined, never inferred").
³ Parameters (name incl. the `@` sigil, raw type, direction, ordinal, `hasDefault`) from
`sys.parameters`; the `parameter_id = 0` function-return row is excluded
(`openspec/specs/mssql-extraction/spec.md` — "Extract routine parameters from
sys.parameters").
⁴ On the NATIVE driver path, per-view `sys.dm_sql_referenced_entities(...)` (a TVF) sources
the consumed source-column set onto `attrs.dstColumns` and flips the covered `depends_on`
edge `parsed → declared`; the sqlcmd / dump strategies carry no view-columns family and stay
object-grain — the project's first strategy-dependent coverage difference, stated plainly
(`openspec/specs/mssql-extraction/spec.md` — "Declared consumed-column set stamped on view
depends_on via dm_sql_referenced_entities (native path)").
⁵ Routines whose body uses `EXEC` / `sp_executesql` are flagged `has_dynamic_sql: true` with
no invented edges (`openspec/specs/mssql-extraction/spec.md` — "Dynamic SQL is flagged, never
guessed").
⁶ PostgreSQL `calls` edges are derived by the shared body tokenizer over the
dynamic-string-masked static body — `confidence: parsed` (`openspec/specs/pg-extraction/spec.md`
— "Body-parsed calls edges for routine invocations").
⁷ Parameters decoded from `pg_proc` arrays (`RETURNS TABLE` result columns are excluded, not
parameters) (`openspec/specs/pg-extraction/spec.md` — "Decode routine parameters from pg_proc
arrays").
⁸ Regular views source their consumed columns from `information_schema.view_column_usage` and
flip `parsed → declared`; materialized / owner-uncovered views degrade to object-grain by
absence (`openspec/specs/pg-extraction/spec.md` — "Declared consumed-column set for regular
views via view_column_usage, with confidence flip", "Sources absent from view_column_usage
stay parsed object grain (degrade-by-absence), never guessed").
⁹ plpgsql bodies using the dynamic `EXECUTE` statement are flagged `hasDynamicSql: true`; a
trigger's `EXECUTE FUNCTION` clause is NOT dynamic (`openspec/specs/pg-extraction/spec.md` —
"Dynamic SQL is flagged via plpgsql EXECUTE, never guessed; trigger EXECUTE FUNCTION is NOT
dynamic").
¹⁰ MySQL `calls` edges are body-tokenized and presence-gated — `confidence: parsed`, never a
self-edge unless genuinely recursive (`openspec/specs/mysql-extraction/spec.md` — "Body-parsed
calls edges for routine invocations, presence-gated with no phantom or self edges").
¹¹ Parameters from `information_schema.PARAMETERS`; MySQL exposes no default column, so
`hasDefault` is omitted (never set false) (`openspec/specs/mysql-extraction/spec.md` — "Extract
routine parameters from information_schema.PARAMETERS").
¹² MySQL has no view-column catalog wired, so view `depends_on` edges stay object-grain with
`supportsColumnLineage: false` (`openspec/specs/mysql-extraction/spec.md` — "View column
lineage degrades by absence (no view-column catalog)").
¹³ Routines using `PREPARE` / `EXECUTE` are flagged `hasDynamicSql: true`, with a table named
only inside the masked dynamic string yielding no edge (`openspec/specs/mysql-extraction/spec.md`
— "Dynamic SQL via PREPARE/EXECUTE is flagged, never guessed; a non-dynamic body is not
flagged").

The `[DYNAMIC SQL]` marker — UPPERCASE, bracketed, one internal space — is a PER-NODE
degradation flag surfaced across `explore`, `object`, `precheck` / `affected`, and `impact`
(the CLI and the mirroring MCP tools), attached ONLY to the specific dynamic-SQL routine and
never as a blanket warning; SQLite and MongoDB never emit it
(`openspec/specs/mcp-server/spec.md` — "Dynamic-SQL caveat surfaces at normal AND full detail
in explore and object", "precheck and affected mark the exact dynamic-SQL degraded items per
node", "dbgraph_impact names the specific dynamic-SQL degraded routines"). Routine parameters
and view column sets render through the SAME shared payload helper that backs `object` /
`explore`, so the CLI and MCP surfaces never drift (`openspec/specs/mcp-server/spec.md` —
"Routine focus renders a PARAMETERS section via the shared payload helper", "explore and
object render a view's consumed source columns at full detail, honest").

## Benchmark (honest numbers)

> **Honesty is the contract.** Every figure below is scoped to *this fixture, this question
> set, this model* — no generalized "X% better" claim is made or implied. Full protocol,
> per-question appendix, and the complete limitations list live in
> [`docs/benchmarks.md`](docs/benchmarks.md); the numbers here are transcribed from it.

**The claim under test:** an agent answering schema questions **WITH** dbgraph's read-only
CLI (`query` / `explore` / `affected` / `status`) is at least as accurate as the SAME agent
**WITHOUT** it (given only a raw DDL dump), at fewer schema-bearing tokens — measured on the
committed SQLite torture fixture (`test/fixtures/sqlite/torture.sql`), a pre-registered
question set, and a single model family (Claude). Ground truth is held separately; the scorer
is deterministic and BLIND to the WITH/WITHOUT label.

| Run | dbgraph code | N | WITH accuracy | WITHOUT accuracy | Schema-token cost (WITH vs WITHOUT) |
|-----|--------------|:-:|:-:|:-:|--|
| 1 — `torture-2026-07-06` | pre-`explore-payloads` | 5 | **40%** (2/5) | **80%** (4/5) | 293,325 vs 133,442 — actual¹ (WITH 2.2×) |
| 2 — `explore-payloads-2026-07-06` | + `explore-payloads` | 5 | **80%** (4/5) | **80%** (4/5) | 180,373 vs 133,442 — actual¹ (WITH −38.5% vs Run 1) |
| 3 — `dog-complete-2026-07-10` | v1.1.0 (DOG-1..4 + view-deps) | 6 | **100%** (6/6) | **100%** (6/6) | 3,581 vs 4,722 — approx² (WITH −24%) |

¹ Runs 1–2 report ACTUAL runtime token usage summed across the condition agents, INCLUDING a
fixed ≈26.7k-token/agent harness overhead identical on both arms — so the cross-condition
DELTA, not the absolute, is the meaningful quantity. ² Run 3 counts only schema-bearing text
via `ceil(chars / 4)` on both arms, so its figures are NOT comparable to Runs 1–2 — only the
within-run WITH − WITHOUT delta is.

**Run 1 — dbgraph LOST its own benchmark, and we published it anyway.** WITH scored 40%
against WITHOUT's 80% while spending 2.2× the tokens. The root cause was a PRODUCT gap, not a
graph-data gap: the graph STORED the exact facts, but the CLI never rendered node payloads
(column types, PK/FK membership), so an agent could not reach them. Reporting that
unsoftened is the contract.

**Run 2 — after `explore-payloads` rendered those payloads, WITH ties WITHOUT** (80% / 80%)
on the SAME frozen protocol, at 38.5% fewer WITH tokens than Run 1 and 73% fewer tool calls
(157 → 42).

**Run 3 — on v1.1.0 code, all six closed-form families are instantiable for the first time**
(`view-dependency` fires now that SQLite carries view-dependency edges). WITH and WITHOUT both
score 100% (6/6) — a TIE on correctness — while WITH spends ≈24% fewer schema tokens (3,581 vs
4,722). Per question, a pointed graph lookup runs ≈200 schema-tokens (the trigger-inventory
and view-dependency questions cost 197 each) against WITHOUT's fixed 787-token whole-schema
dump; the WITH range across the six questions is 197–1,381.

**Read the tie honestly.** This fixture is TINY — the entire comment-free DDL is ≈787 tokens,
so it fits in a single dump. That is WITHOUT's BEST case, and even there dbgraph MATCHES
accuracy at lower token cost. The gap only widens with schema size: a real enterprise
catalog's dump does not fit a context window at all, whereas a targeted graph query stays in
the hundreds of tokens regardless of catalog size. No such larger run is claimed here — only
the direction is argued, and only the measured tie is asserted.

**Stated limitations** (full list in `docs/benchmarks.md`): self-run and not peer-reviewed; a
single model family; small N on one primary schema; token approximation when the runtime does
not report actual usage; and shared-extraction circularity — sharpest in the `impact` family,
whose ground-truth key IS dbgraph's own `affected` output, so WITH there necessarily AGREES
WITH THE TOOL rather than providing an independent check.

## Quickstart

Install from npm — dbgraph is published as
[`@elkindev/dbgraph`](https://www.npmjs.com/package/@elkindev/dbgraph) (latest `1.1.0`).
Requires **Node.js >= 22**.

```bash
npm install -g @elkindev/dbgraph    # or run ad hoc: npx @elkindev/dbgraph <command>
```

Prefer to run from source? Clone and build:

```bash
git clone https://github.com/ElkinDev/dbgraph.git
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
| `explore <qname>` | Show a node and its grouped neighbors (auto-surfacing `calls` neighbors). `--detail brief\|normal\|full`. |
| `object <qname>` | Show one object in full — columns, constraints, indexes, triggers, plus (v1.1.0) routine parameters and view consumed-column sets, with a `[DYNAMIC SQL]` marker on degraded routines. |
| `viz` | Export a self-contained, fully-offline interactive HTML graph (default `graph.html`); `--mermaid` emits a deterministic ER diagram to stdout. Shaping flags: `--out <file>`, `--full` (all nodes incl. columns), `--columns`, `--kinds <list>`, `--schema <name>`, `--min-degree <n>`. CLI-only — never an MCP tool. |
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

`dbgraph viz` is export-only and read-only: it renders `.dbgraph/dbgraph.db` to ONE
self-contained HTML file that makes ZERO network requests at view time (opens over
`file://`) and embeds schema identifiers ONLY — never connection strings, resolved secrets,
or sampled values — so treat the output as exactly as sensitive as the local index. Its
node-detail panel reuses the same payload renderer as `dbgraph object`, and `--mermaid` is a
byte-deterministic ER diagram (`openspec/specs/graph-viz/spec.md`; `src/cli/commands/viz.ts`).
Full walkthrough: [`docs/viz.md`](docs/viz.md).

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

The written entry is `command` + `args` only (`npx -y -p @elkindev/dbgraph dbgraph-mcp`) — never a secret.
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

### Serve over HTTP

`dbgraph mcp` speaks **stdio** by default. Add `--http` to serve the same read-only
8-tool surface over **Streamable HTTP** from one host, for several remote agents:

```bash
dbgraph mcp --http                 # endpoint at http://127.0.0.1:7423/mcp (loopback default)
dbgraph mcp --http --host 0.0.0.0  # bind all interfaces — prints a no-auth warning
```

**No authentication ships in v1** and the default bind is loopback (`127.0.0.1`) — that
loopback default is the primary containment. For any non-loopback exposure, front the
endpoint with a reverse proxy (TLS + auth) or network controls. HTTP mode adds no write
path and diagnostics stay content-free.

HTTP client config is **not** auto-wired (`dbgraph install` wires the stdio entry only) —
add the server by hand. Two shapes bite if copied across agents: **Gemini CLI** needs
`httpUrl` (a plain `url` silently selects deprecated SSE), and **Cursor** takes **no**
`type` field (it is inferred from the `url`). The verified 6/6 per-agent matrix, the
reverse-proxy model, and the pinned `--host 0.0.0.0` warning are in
[`docs/mcp-http.md`](docs/mcp-http.md).

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
