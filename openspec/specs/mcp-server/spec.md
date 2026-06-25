# MCP Server Specification

## Purpose

The DRIVING MCP adapter that exposes the persisted graph to AI agents over the official
`@modelcontextprotocol/sdk` stdio transport, so one tool call answers what today costs 5+ exploratory
queries (the E3 Definition of Done). It defines: a deterministic, token-budgeted COMPACT output format
pinned by `docs/format-spec.md` (US-019); the 8 tools `dbgraph_explore`, `dbgraph_search`,
`dbgraph_object`, `dbgraph_related`, `dbgraph_impact`, `dbgraph_path`, `dbgraph_precheck`,
`dbgraph_status` (US-010..017); the identifier-matching precheck engine and its `dbgraph affected` CLI
sibling (US-016, US-023); the static `initialize` instructions (US-018); the `dbgraph install` agent-config
wiring (US-024); and the `src/mcp/**` import boundary.

This adapter lives under `src/mcp/` per ADR-004. It MUST import ONLY the public barrel `src/index.ts`,
Node builtins, and `@modelcontextprotocol/sdk`; it MUST NOT import `src/adapters/**` or `src/cli/**`. All
tool output MUST be produced by PURE formatters in `src/core/present/` and be byte-identical on re-run
(ADR-008). It consumes the existing public API (`getNeighbors`, `getImpact`, `findJoinPath`, `search`,
`getNodeByQName`, `getNode`, `getEdgesFrom`, `listSnapshots`, `formatExplore`, `capabilitiesFor`) and the
relocated `openConnections`; no `graph-model` or `graph-query` requirement changes.

> **Honest Phase-5 boundary.** `dbgraph_precheck` matches identifiers extracted from a DDL string by a
> CONSERVATIVE regex tokenizer (reusing the MSSQL `tokenizer.ts` pattern), NOT a SQL grammar parser.
> Every parse-derived item carries `confidence: 'parsed'`; identifiers that do not match a graph node are
> reported as unmatched, never guessed. `node-sql-parser` is explicitly OUT OF SCOPE. Cursor-based
> pagination is out of scope (offset/limit only). Token-budget ceilings are EMPIRICAL: measured on the
> committed SQLite torture fixture (`test/fixtures/sqlite/`) and pinned in `docs/format-spec.md`.

## Requirements

### Requirement: Compact format pinned by docs/format-spec.md authored first

The repository SHALL ship `docs/format-spec.md` (US-019) authored BEFORE any server code. It MUST define a
deterministic line grammar — table lines, column lines, edge lines, and inline annotations such as
`[3 idx, 1 trg!]` — three `detail` levels `brief | normal | full`, the `offset`/`limit`/`hasMore`
pagination contract, the golden discipline (changing a golden REQUIRES a spec edit plus a token-delta
justification), and a per-tool/per-`detail` TOKEN BUDGET. Budgets MUST be set EMPIRICALLY by measuring
actual output on the committed SQLite torture fixture; ceilings are recorded as measured numbers with the
`ceil(chars/4)` methodology. Every tool's output bytes MUST be produced by a PURE formatter under
`src/core/present/` (extending/reusing `formatExplore`); no formatter may read `process.env`, the clock,
randomness, or perform I/O.

#### Scenario: Format spec exists with grammar, levels and budget methodology

- GIVEN the repository before the server is built
- WHEN `docs/format-spec.md` is inspected
- THEN it defines the line grammar (table/column/edge + annotations like `[3 idx, 1 trg!]`), the `brief|normal|full` levels, and the `offset`/`limit`/`hasMore` pagination contract
- AND each per-tool/per-`detail` token ceiling is a measured number with its methodology

#### Scenario: Output is produced by a pure formatter and is byte-identical on re-run

- GIVEN any tool invoked twice with identical arguments over the same graph
- WHEN its output is compared
- THEN both invocations return byte-identical text produced by a `src/core/present/` formatter (ADR-008)
- AND no `process.env`, clock, randomness, or I/O is used to produce it

#### Scenario: Brief detail respects the measured token budget

- GIVEN an entity with ≤ 30 relationships in the torture fixture
- WHEN it is rendered at `detail: brief`
- THEN the output does not exceed the format-spec brief budget for that tool

### Requirement: Pagination via offset, limit and hasMore

Tools returning a list (notably `dbgraph_search`, and any tool whose result can exceed its budget) SHALL
paginate using `offset` (default 0) and `limit` (a documented default) and MUST return `hasMore: true`
when results beyond the returned page remain, `false` otherwise. Cursor-based pagination is out of scope.

#### Scenario: A second page is reachable via offset and hasMore

- GIVEN a query whose total matches exceed `limit`
- WHEN it is called with the default `offset`
- THEN the first page returns `limit` items and `hasMore: true`
- AND calling again with `offset` advanced returns the next page and eventually `hasMore: false`

### Requirement: dbgraph_explore returns a compact neighborhood or a disambiguation list

`dbgraph_explore` SHALL accept `{ target: string, detail?: 'brief'|'normal'|'full' }` (US-010), wrap
`getNeighbors` + `formatExplore` (the CLI `runExplore` precedent), and return the pivot node with grouped
inbound/outbound neighbors in compact format at the requested `detail`. When the target matches several
entities it MUST return the disambiguation candidate list and MUST NOT guess one.

#### Scenario: Explore returns the compact neighborhood (golden)

- GIVEN the torture fixture and `dbgraph_explore({ target: "orders", detail: "brief" })`
- WHEN the tool runs
- THEN it returns the pivot table with grouped FKs/views/procs/triggers in compact format
- AND the output matches the explore × brief golden file

#### Scenario: Ambiguous target returns a disambiguation list

- GIVEN a target name matching entities in more than one schema
- WHEN `dbgraph_explore` runs
- THEN it returns the candidate qualified names and does not pick one

### Requirement: dbgraph_search returns ranked paginated hits

`dbgraph_search` SHALL accept `{ query: string, offset?, limit?, detail? }` (US-011), wrap the public
`search` (FTS5 + typo tolerance over names and `full`-level bodies and comments), and return ranked hits
each carrying type and qualified name, with `offset`/`limit`/`hasMore` and a declared total. Bodies of
objects at `metadata` or `off` MUST NOT be matched on body content.

#### Scenario: Typo search returns ranked hits with type and qname (golden)

- GIVEN the torture fixture and `dbgraph_search({ query: "custmer" })`
- WHEN the tool runs
- THEN `customers` is returned among ranked hits, each carrying its type and qualified name, with a declared total
- AND the output matches the search × detail golden file

### Requirement: dbgraph_object assembles one object's full detail via multiple store reads

`dbgraph_object` SHALL accept `{ qname: string, detail? }` (US-012) and is a NEW orchestrator (no core
change) that assembles columns with types/nullability/defaults, PK/FK/check constraints, indexes with
columns and kind, and triggers with event, plus comments — composing `getNodeByQName`, `getNode` and
`getEdgesFrom`. A module at `full` MUST include its body; at `metadata` it MUST include signature + edges
and state explicitly that the body is omitted. A name ambiguous across schemas MUST return the candidate
list for qualification, not a guess.

#### Scenario: Object returns columns, constraints, indexes and triggers (golden)

- GIVEN the torture fixture and `dbgraph_object({ qname: "dbo.orders" })`
- WHEN the tool runs
- THEN it returns columns (type/nullability/default), PK/FKs/checks, indexes with columns and kind, and triggers with event
- AND the output matches the object × detail golden file

#### Scenario: Metadata-level module states the body is omitted

- GIVEN a procedure resolved to `metadata`
- WHEN `dbgraph_object` renders it
- THEN it includes the signature and edges and explicitly states the body is omitted (not silently empty)

#### Scenario: Ambiguous qname asks for qualification

- GIVEN `orders` present in both `dbo` and `sales`
- WHEN `dbgraph_object({ qname: "orders" })` runs
- THEN it returns the candidate qualified names and does not pick one

### Requirement: dbgraph_related returns neighbors grouped by edge kind and direction

`dbgraph_related` SHALL accept `{ qname: string, kinds?: string[], detail? }` (US-013), wrap
`getNeighbors`, and return neighbors grouped by edge kind (`references` in/out, `depends_on`,
`reads_from`/`writes_to`, `fires_on`) with explicit direction. Inferred edges MUST appear as a separate
group marked with their score. The `kinds` filter MUST restrict the result; absent it, all kinds return.
Neighbors MUST be deduplicated by qualified name (the graph stores one edge per FK column pair PLUS one
aggregate table-to-table edge; display collapses to table grain).

#### Scenario: Related groups neighbors by kind and direction (golden)

- GIVEN a table with inbound/outbound FKs, a dependent view and a trigger
- WHEN `dbgraph_related({ qname })` runs without `kinds`
- THEN neighbors are grouped by edge kind with explicit direction, inferred edges separated with score, references deduplicated to table grain
- AND the output matches the related × detail golden file

#### Scenario: kinds filter restricts the edge kinds

- GIVEN the same node
- WHEN `dbgraph_related({ qname, kinds: ["references"] })` runs
- THEN only `references` edges are returned, still annotated with direction

### Requirement: dbgraph_impact returns the read/write blast radius as a visible chain

`dbgraph_impact` SHALL accept `{ qname: string, depth?: number, detail? }` (US-014), wrap `getImpact`, and
return the transitive closure as a visible dependency CHAIN (a→b→c) SEPARATING read impact from write
impact, bounded by `depth` (default 3) with a truncation warning when the limit is hit. If any object in
the chain carries `has_dynamic_sql`, the result MUST include an "impact possibly incomplete" warning.

#### Scenario: Impact separates read from write with a visible chain (golden)

- GIVEN `orders.status` referenced by an index, a view, a reading proc and a writing trigger
- WHEN `dbgraph_impact({ qname: "orders.status" })` runs
- THEN the result lists the dependency chain per path with READ impact reported separately from WRITE impact
- AND the output matches the impact × detail golden file

#### Scenario: Depth truncation and dynamic-SQL each warn

- GIVEN a chain deeper than `depth` and a chain including a `has_dynamic_sql: true` node
- WHEN `dbgraph_impact` runs at that `depth`
- THEN the walk stops at the limit with a truncation warning AND an "impact possibly incomplete" warning is present

### Requirement: dbgraph_path returns the shortest join path or suggests neighbors

`dbgraph_path` SHALL accept `{ from: string, to: string, detail? }` (US-015), wrap `findJoinPath`, and
return the shortest route over `references` edges exposing the exact join columns of each hop. An
inferred-only route MUST be marked inferred. When no route exists it MUST say so and suggest the closest
neighbors of each endpoint by QUALIFIED NAME (not raw node IDs).

#### Scenario: Path exposes the join columns of each hop (golden)

- GIVEN `customers` and `shipments` connected through declared FKs
- WHEN `dbgraph_path({ from: "customers", to: "shipments" })` runs
- THEN the shortest route is returned with the exact join columns of each hop
- AND the output matches the path × detail golden file

#### Scenario: No route reports neighbors

- GIVEN two tables with no connecting route
- WHEN `dbgraph_path` runs
- THEN it states no route exists and suggests the closest neighbors of each endpoint by qualified name (zero raw SHA-1 node IDs in output)

### Requirement: dbgraph_precheck aggregates DDL impact with parsed-confidence tagging

`dbgraph_precheck` SHALL accept `{ ddl: string, detail? }` (US-016) and a shared zero-dependency engine
that extracts qualified identifiers from the DDL via the conservative regex tokenizer (reusing the MSSQL
`tokenizer.ts` pattern), matches them against the graph via `search`/`getNodeByQName`, and AGGREGATES
`getImpact` across all statements (deduplicated) into sections: triggers firing on the affected objects,
who writes/reads them, constraints/indexes involved, and what-to-test derived from the edges. Every
parse-derived item MUST be tagged `confidence: 'parsed'`. Identifiers that match no graph node MUST be
reported as unmatched, never guessed. `node-sql-parser` is out of scope.

#### Scenario: ALTER + DROP INDEX DDL returns the aggregated, deduped precheck (golden)

- GIVEN a DDL string containing `ALTER TABLE dbo.orders ...` and `DROP INDEX ix_orders_status ON dbo.orders`
- WHEN `dbgraph_precheck({ ddl })` runs over the torture fixture
- THEN it returns triggers/writers/readers/constraints+indexes/what-to-test aggregated and deduplicated across both statements
- AND every parse-derived item is tagged `confidence: 'parsed'`
- AND the output matches the precheck × detail golden file

#### Scenario: Non-matchable identifiers are reported as unmatched

- GIVEN a DDL referencing an identifier with no corresponding graph node
- WHEN `dbgraph_precheck` runs
- THEN that identifier is reported as unmatched and no impact is fabricated for it

### Requirement: dbgraph_status reports index trust and live drift

`dbgraph_status` SHALL accept `{ detail? }` (US-017), compose `listSnapshots` + per-type counts +
`SnapshotRecord.fingerprint` + `capabilitiesFor` (the CLI `runStatus` precedent), and report engine and
version, last sync timestamp, drift yes/no, per-type counts, configured levels, and objects excluded by
filters. When a connection is available it MUST run the live fingerprint to detect drift; otherwise it
MUST say so and report local state only.

#### Scenario: Status reports counts, levels and drift (golden)

- GIVEN a persisted torture graph with a recorded snapshot fingerprint
- WHEN `dbgraph_status({})` runs with no live connection
- THEN it reports engine/version, last sync, per-type counts, configured levels and excluded objects, stating drift could not be checked live
- AND the output matches the status × detail golden file

#### Scenario: Live fingerprint detects drift when connected

- GIVEN a connection is available and the source schema changed since the last sync
- WHEN `dbgraph_status` runs
- THEN it runs the live fingerprint and reports drift detected: yes

### Requirement: stdio server with static initialize instructions

The server SHALL start as an `@modelcontextprotocol/sdk` stdio transport entry (`src/mcp/server.ts`,
`#!/usr/bin/env node`) registering the 8 tools. Its `initialize` response MUST surface usage guidance from
a STATIC, golden-tested string in `src/mcp/instructions.ts` (US-018): when to use explore vs search vs
object, and the recommended pre-change flow (status → explore → precheck). Each tool description MUST
carry exactly ONE example call. There MUST be zero user-maintained instruction files.

#### Scenario: initialize returns the static golden instructions

- GIVEN the in-process SDK client linked to the server
- WHEN it sends `initialize`
- THEN the response includes the static guidance string (explore-vs-search-vs-object + status→explore→precheck flow) matching its golden
- AND each registered tool description carries exactly one example call

### Requirement: dbgraph install idempotently wires the agent MCP config

`dbgraph install` SHALL detect EVERY supported MCP agent present on the machine and, in ONE pass, wire an
idempotent `dbgraph-mcp` server entry into each detected agent's user-level config, driven by a single typed
`AGENT_TABLE` source of truth. It MUST support ≥ 6 agents across three config-format families:
(Previously: it wired ONLY Claude Code via a single-file idempotent JSON merge.)

| Agent | Config key & shape | Format family |
|-------|--------------------|---------------|
| Claude Code, Cursor, Gemini CLI | `mcpServers.dbgraph-mcp = { command, args }` | mcpServers-JSON |
| VS Code | `servers.dbgraph-mcp = { type:'stdio', command, args }` | servers-JSON |
| opencode | `mcp.dbgraph-mcp = { type:'local', command:[…] }` (command is an ARRAY) | mcp-JSON |
| Codex CLI | TOML block `[mcp_servers.dbgraph-mcp]` with `command = "…"`, `args = […]` | TOML |

An agent is configured ONLY if its config file already exists (the agent is considered installed); a missing
env var or a missing file MUST cause that agent to be SKIPPED, never created. Each write MUST be idempotent:
re-running detects the existing `dbgraph-mcp` entry (incl. the TOML block) and writes nothing, never
duplicating. `--remove` MUST delete EXACTLY the `dbgraph-mcp` entry from each detected agent, leaving all
other entries intact. The written entry MUST be `command` + `args` only (no secrets). When ZERO agents are
detected the command MUST print the documented manual snippet and exit successfully. Config paths MUST be
host-independent (`pathWin32.join` on win32, `pathPosix.join` on posix) with the correct env var per agent
per OS, so the resolved path is identical regardless of where Node.js runs.

#### Scenario: mcpServers-JSON agents get the {command,args} entry

- GIVEN existing config files for Claude Code, Cursor and Gemini CLI
- WHEN `dbgraph install` runs
- THEN each file's `mcpServers.dbgraph-mcp` equals `{ "command": "npx", "args": ["-y", "dbgraph-mcp"] }`
- AND any pre-existing `mcpServers` entries are preserved

#### Scenario: VS Code gets a servers entry with type stdio, not mcpServers

- GIVEN an existing VS Code `mcp.json`
- WHEN `dbgraph install` runs
- THEN `servers.dbgraph-mcp` equals `{ "type": "stdio", "command": "npx", "args": ["-y", "dbgraph-mcp"] }`
- AND no `mcpServers` key is written

#### Scenario: opencode gets a local entry with an array command

- GIVEN an existing opencode `opencode.json`
- WHEN `dbgraph install` runs
- THEN `mcp.dbgraph-mcp` equals `{ "type": "local", "command": ["npx", "-y", "dbgraph-mcp"] }`

#### Scenario: Codex CLI gets the TOML mcp_servers block

- GIVEN an existing Codex `config.toml`
- WHEN `dbgraph install` runs
- THEN it contains a `[mcp_servers.dbgraph-mcp]` block with `command = "npx"` and `args = ["-y", "dbgraph-mcp"]`
- AND any other existing TOML content is preserved

#### Scenario: Only agents with an existing config file are configured

- GIVEN Claude Code's config file exists but Cursor's does not (and Cursor's env var is unset)
- WHEN `dbgraph install` runs
- THEN Claude Code is configured and Cursor is reported skipped/not-present
- AND no Cursor config file is created

#### Scenario: Re-running is idempotent for every format including TOML

- GIVEN every detected agent already contains the `dbgraph-mcp` entry from a prior install
- WHEN `dbgraph install` runs again
- THEN each JSON agent still has exactly one `dbgraph-mcp` entry and the Codex file has exactly one `[mcp_servers.dbgraph-mcp]` block
- AND no file is rewritten with a changed value

#### Scenario: --remove deletes only the dbgraph-mcp entry per agent

- GIVEN every detected agent contains the `dbgraph-mcp` entry alongside other entries
- WHEN `dbgraph install --remove` runs
- THEN the `dbgraph-mcp` entry (and the Codex `[mcp_servers.dbgraph-mcp]` block) is gone from each agent
- AND every other entry/block in those files is untouched

#### Scenario: No detected agent prints the manual snippet and exits 0

- GIVEN a machine where no supported agent config file exists
- WHEN `dbgraph install` runs
- THEN it prints the documented manual configuration snippet
- AND it exits successfully (never fails dry)

#### Scenario: Config paths resolve correctly on win32

- GIVEN `platform = win32`, `APPDATA = C:\Users\u\AppData\Roaming`, `USERPROFILE = C:\Users\u`
- WHEN each agent's `configPath` is resolved
- THEN Claude Code resolves to `C:\Users\u\AppData\Roaming\Claude\claude_desktop_config.json`
- AND Cursor (USERPROFILE-rooted) resolves to `C:\Users\u\.cursor\mcp.json`
- AND opencode (USERPROFILE `.config`-rooted) resolves to `C:\Users\u\.config\opencode\opencode.json`

#### Scenario: Config paths resolve correctly on posix

- GIVEN `platform = linux` and `HOME = /home/u`
- WHEN each agent's `configPath` is resolved
- THEN Claude Code resolves to `/home/u/.config/Claude/claude_desktop_config.json`
- AND Cursor resolves to `/home/u/.cursor/mcp.json`
- AND opencode resolves to `/home/u/.config/opencode/opencode.json`

#### Scenario: Written entries carry no secrets

- GIVEN any detected agent being configured
- WHEN its `dbgraph-mcp` entry is written
- THEN the entry contains only `command` and `args` (e.g. `npx -y dbgraph-mcp`) and no credentials or tokens

### Requirement: dbgraph affected mirrors precheck via the CLI

`dbgraph affected <script.sql>` (US-023) SHALL be a thin CLI wrapper over the SAME precheck engine,
producing the aggregated what-to-test/what-breaks result with `confidence: 'parsed'` tagging. It MUST
support `--json` for machine-readable output and MUST exit with code 1 when the precheck reports affected
objects (a non-zero "changes detected" signal) and 0 when nothing is affected.

#### Scenario: affected reports changes and exits 1; clean script exits 0

- GIVEN a `.sql` script whose identifiers match graph nodes with downstream impact
- WHEN `dbgraph affected script.sql --json` runs
- THEN it prints the aggregated precheck as JSON with parsed-confidence tags and exits with code 1
- AND a script affecting nothing exits with code 0

### Requirement: src/mcp boundary and openConnections relocation

`src/mcp/**` MUST NOT import `src/adapters/**` or `src/cli/**`; it MUST import only the public barrel
`src/index.ts`, Node builtins, and `@modelcontextprotocol/sdk` (ADR-004). The boundary test MUST fail the
build on violation. Because the MCP cannot import the CLI, `openConnections` MUST be relocated from
`src/cli/config/` to a neutral `src/infra/open-connections.ts` and consumed by both CLI and MCP through
the public barrel. `@modelcontextprotocol/sdk` (pinned exact) MUST be the ONLY new runtime dependency, and
the target database MUST remain strictly read-only (the server issues no writes through any connection).
Config modules (`schema.ts`, `parse-config.ts`, `resolve-secrets.ts`) live under `src/infra/config/` so
that `src/infra/` has zero imports from `src/cli/` or `src/mcp/`.

#### Scenario: Boundary test fails on an adapter or CLI import from src/mcp

- GIVEN a file under `src/mcp/**`
- WHEN it imports from `src/adapters/**` or `src/cli/**`
- THEN the boundary test fails the build
- AND importing the public barrel, Node builtins, or the SDK passes

#### Scenario: openConnections is consumed from the barrel and SDK is the only new dep

- GIVEN the relocated `src/infra/open-connections.ts` re-exported via `src/index.ts`
- WHEN CLI and MCP consume `openConnections`
- THEN both import it from the public barrel (not from `src/cli/config/`)
- AND `@modelcontextprotocol/sdk` is the only added runtime dependency and the target database stays read-only

### Requirement: In-process SDK harness drives every tool golden over the torture fixture

The test suite SHALL drive the server IN-PROCESS via the SDK `InMemoryTransport` (a linked
client/server pair) over the committed SQLite torture fixture, with a golden file per tool × `detail`
level (US-019; ADR-008). Each tool's output MUST be byte-identical on re-run, and changing any golden MUST
require a corresponding `docs/format-spec.md` edit plus a token-delta justification.

#### Scenario: Every tool is exercised in-process and matches its golden

- GIVEN the SDK `InMemoryTransport` client linked to the server over the torture fixture
- WHEN each of the 8 tools is called at each `detail` level
- THEN every response matches its committed tool × detail golden file
- AND a second identical call returns byte-identical output (ADR-008)
