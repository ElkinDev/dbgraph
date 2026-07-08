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

The repository SHALL ship `docs/format-spec.md` (US-019). It MUST define a deterministic line grammar —
table lines, column lines, edge lines, and inline annotations such as `[3 idx, 1 trg!]` — three `detail`
levels `brief | normal | full`, the `offset`/`limit`/`hasMore` pagination contract, the golden discipline
(changing a golden REQUIRES a spec edit plus a token-delta justification), and a per-tool/per-`detail`
TOKEN BUDGET. The grammar MUST NOW ALSO cover the explore per-kind PAYLOAD lines (column
type/nullability/default, constraint kind + ordered columns + FK target mapping, index unique/columns,
trigger timing/events) that `formatExplore` renders via the shared helper. Budgets MUST be set
EMPIRICALLY by measuring ACTUAL output on the committed SQLite torture fixture; ceilings are recorded as
measured numbers with the `ceil(chars/4)` methodology. Because explore now emits payload lines, the
explore per-detail ceilings MUST be RE-MEASURED and updated with a token-delta note; the ceiling POLICY
and methodology are UNCHANGED (measured numbers, spec-edit-plus-token-delta on every golden change). Every
tool's output bytes MUST be produced by a PURE formatter under `src/core/present/`; no formatter may read
`process.env`, the clock, randomness, or perform I/O.
(Previously: the grammar and per-detail budgets covered only the neighbor-listing explore output; explore
rendered no per-kind payload lines, so its ceilings were measured without them.)

#### Scenario: Format spec exists with grammar, levels and budget methodology

- GIVEN the repository
- WHEN `docs/format-spec.md` is inspected
- THEN it defines the line grammar (table/column/edge + annotations like `[3 idx, 1 trg!]` AND the explore payload lines), the `brief|normal|full` levels, and the `offset`/`limit`/`hasMore` pagination contract
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

#### Scenario: Explore payload ceilings are re-measured and re-asserted

- GIVEN explore now renders per-kind payload lines at `normal` and `full`
- WHEN the explore output is measured on the torture fixture
- THEN the `docs/format-spec.md` explore `normal`/`full` ceilings are updated to the RE-MEASURED numbers with a token-delta note
- AND the budget assertion test re-asserts the updated ceilings and passes

### Requirement: Pagination via offset, limit and hasMore

Tools returning a list (notably `dbgraph_search`, and any tool whose result can exceed its budget) SHALL
paginate using `offset` (default 0) and `limit` (a documented default) and MUST return `hasMore: true`
when results beyond the returned page remain, `false` otherwise. Cursor-based pagination is out of scope.

#### Scenario: A second page is reachable via offset and hasMore

- GIVEN a query whose total matches exceed `limit`
- WHEN it is called with the default `offset`
- THEN the first page returns `limit` items and `hasMore: true`
- AND calling again with `offset` advanced returns the next page and eventually `hasMore: false`

### Requirement: One shared payload-render helper backs explore and object

A SINGLE pure module (`src/core/present/payload.ts`, core-types-only, deterministic — ADR-004/ADR-008)
SHALL render the per-kind node payload — column dataType/nullability/default; constraint kind + ORDERED
columns + FK target mapping; index unique/columns; trigger timing/events; module body — and MUST be the
ONLY source of those section bytes consumed by BOTH `formatExplore` and `formatObject`. There MUST be no
duplicated per-kind rendering logic and no drift: for the SAME node, the payload section bytes rendered
inside `explore` MUST be byte-identical to those rendered inside `object`. The FK target mapping MUST
render the constraint payload target when present, else RECONSTRUCT the table-level target from the node's
`references` edges when unambiguous, else render the FK columns without a target — never guessed (design
D8), applied identically to both surfaces. The EXTRACTION of the existing per-kind logic into the helper
MUST be behavior-preserving — refactoring `formatObject` onto the helper alone MUST keep the existing
object goldens byte-identical (no re-bless). The SEPARATE FK-reconstruction feature MAY change object
output ONLY where a payload-less FK gains a reconstructed target; that change is a DELIBERATE, §6-noted
re-bless of ONLY the affected FK lines, applied to `object` and `explore` together (they share the source).

#### Scenario: object goldens are byte-identical after the refactor step (transparency)

- GIVEN the object × detail goldens (`test/mcp/golden/object-tool-*.txt`, `test/core/present/golden/object-*.txt`) captured BEFORE this change
- WHEN `formatObject` is refactored onto the shared helper (extraction only, before the D8 FK-reconstruction feature)
- THEN every object golden is byte-identical to before — NO re-bless — e.g. `object-tool-full.txt` still renders `  salary  REAL  [NN]  DEFAULT 0.0` and `  [PK]  pk_employees  (emp_id)`

#### Scenario: the FK-reconstruction feature re-blesses ONLY the FK lines, in object and explore together

- GIVEN the D8 FK-reconstruction feature and the torture `main.employees` (payload-less FK, unambiguous `references` edge to `main.departments`)
- WHEN `object-tool-{normal,full}.txt` is re-captured
- THEN ONLY the FK lines change — the column line becomes `  dept_id  INTEGER  [FK→main.departments]  [NN]` and the constraint line becomes `  [FK]  fk_employees_0  (dept_id → main.departments)` — and every non-FK line (e.g. `  salary  REAL  [NN]  DEFAULT 0.0`, `  [PK]  pk_employees  (emp_id)`) stays byte-identical
- AND the SAME reconstruction re-blesses the explore goldens (shared source), with a matching `docs/format-spec.md` token-delta note (§6)

#### Scenario: explore and object render identical section bytes for the same node

- GIVEN the torture node `main.employees`
- WHEN its COLUMNS/CONSTRAINTS/INDEXES/TRIGGERS sections are rendered inside `explore` and inside `object`
- THEN the two renderings are byte-identical, produced by the ONE shared helper (no per-surface branch)

### Requirement: dbgraph_explore returns a compact neighborhood or a disambiguation list

`dbgraph_explore` SHALL accept `{ target: string, detail?: 'brief'|'normal'|'full' }` (US-010), wrap
`getNeighbors` + `formatExplore` (the CLI `runExplore` precedent), and return the pivot node with grouped
inbound/outbound neighbors in compact format at the requested `detail`. In ADDITION it MUST render the
pivot node's per-kind PAYLOAD via the shared payload-render helper — columns with types, ordered
PK/constraints, indexes, trigger timing/events — GATED by detail identically to `dbgraph_object`
(`brief` = counts only; `normal` = +columns+constraints; `full` = +indexes+triggers+body). Because CLI
`explore` and this tool share the SAME `formatExplore`, their output for a given graph/target/detail MUST
be BYTE-IDENTICAL. When the target matches several entities it MUST return the disambiguation candidate
list and MUST NOT guess one.
(Previously: `dbgraph_explore` rendered only grouped neighbor qnames — no column types, PK ordering, FK
mapping or trigger timing — reading payload solely for the full-level `hasDynamicSql` warning.)

#### Scenario: Explore returns the compact neighborhood (golden)

- GIVEN the torture fixture and `dbgraph_explore({ target: "orders", detail: "brief" })`
- WHEN the tool runs
- THEN it returns the pivot table with grouped FKs/views/procs/triggers in compact format
- AND the output matches the explore × brief golden file

#### Scenario: Ambiguous target returns a disambiguation list

- GIVEN a target name matching entities in more than one schema
- WHEN `dbgraph_explore` runs
- THEN it returns the candidate qualified names and does not pick one

#### Scenario: Explore payload matches the CLI byte-for-byte

- GIVEN the torture fixture, `main.employees`, and detail `normal`
- WHEN `dbgraph_explore({ target: "main.employees", detail: "normal" })` and CLI `dbgraph explore main.employees --detail normal` both run
- THEN both emit byte-identical text, including the COLUMNS lines `  emp_id  INTEGER  [PK]` and `  salary  REAL  [NN]  DEFAULT 0.0`
- AND the explore goldens are re-blessed DELIBERATELY with a matching `docs/format-spec.md` edit + token-delta note

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

### Requirement: explore and related surface calls neighbors automatically

`dbgraph_explore` and `dbgraph_related` SHALL render `calls` edges in the grouped neighbor sections
with explicit direction — WITHOUT any edge-kind allowlist change — because `getNeighbors` returns all
kinds and the shared formatters iterate the sorted neighbor kinds. A routine that invokes another MUST
show an OUTBOUND `calls` neighbor; the invoked routine MUST show the INBOUND `calls` neighbor. Any
golden that gains a `calls` section MUST be re-blessed DELIBERATELY with a matching `docs/format-spec.md`
note. Because CLI `explore` and the MCP tool share the SAME formatter, their `calls` rendering for a
given graph/target/detail MUST be byte-identical.

#### Scenario: explore of a calling routine shows the outbound calls neighbor

- GIVEN the mssql torture graph and `dbgraph_explore({ target: "dbo.usp_refresh_totals" })`
- WHEN the tool runs
- THEN the grouped neighbors include an OUTBOUND `calls` entry to `dbo.usp_log_change`
- AND `dbgraph_explore({ target: "dbo.usp_log_change" })` shows the corresponding INBOUND `calls` entry from `dbo.usp_refresh_totals`

#### Scenario: related filters to the calls kind

- GIVEN `dbgraph_related({ qname: "dbo.usp_refresh_totals", kinds: ["calls"] })`
- WHEN the tool runs
- THEN only the `calls` neighbor(s) are returned, annotated with direction (outbound to `dbo.usp_log_change`)
- AND a routine with no invocations returns an empty `calls` group, never a fabricated entry

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
who writes/reads them, constraints/indexes involved, and what-to-test derived from the edges. Because
impact traversal follows inbound `writes_to`/`reads_from`/`depends_on`/`references`/`calls` edges, the
aggregation MUST surface view, trigger AND routine-caller dependents on EVERY engine that emits those
edges. A `calls` edge is traversed as READ-impact (a caller depends on its callee like a read, not a
write), so a change to a called routine MUST surface its callers in the read/what-to-test sections.
Every parse-derived item MUST be tagged `confidence: 'parsed'`. Identifiers that match no graph node
MUST be reported as unmatched, never guessed. `node-sql-parser` is out of scope.
(Previously: impact traversal followed inbound `writes_to`/`reads_from`/`depends_on`/`references` only;
a change to a called routine did NOT surface its callers because `calls` edges did not exist.)

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

#### Scenario: SQLite column-drop surfaces the exact view + trigger dependents

- GIVEN the SQLite torture graph and a DDL dropping `departments.dept_id` (e.g. `ALTER TABLE departments DROP COLUMN dept_id`)
- WHEN `dbgraph_precheck({ ddl })` runs over that graph
- THEN `whatToTest` is EXACTLY `{main.active_departments, main.assignments, main.employee_summary, main.employees, main.trg_active_dept_instead_insert}`
- AND `main.active_departments` and `main.employee_summary` appear in the READERS section (inbound `depends_on`), and `main.employees`/`main.assignments` remain there (inbound FK `references`)
- AND `main.trg_active_dept_instead_insert` appears in the TRIGGERS section (inbound `writes_to`), with every item tagged `confidence: 'parsed'`

#### Scenario: Altering a called routine surfaces its callers through the calls chain

- GIVEN the mssql torture graph containing `calls dbo.usp_refresh_totals → dbo.usp_log_change` and a DDL altering `dbo.usp_log_change`
- WHEN `dbgraph_precheck({ ddl })` runs over that graph
- THEN `whatToTest` is EXACTLY `{dbo.usp_refresh_totals}` (the caller reached through the inbound `calls` edge)
- AND `dbo.usp_refresh_totals` appears in the READ / what-to-test section (a `calls` edge is READ-impact, not write)

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

### Requirement: Transport-selectable server with static initialize instructions

The server SHALL start as an `@modelcontextprotocol/sdk` server (`src/mcp/server.ts`,
`#!/usr/bin/env node`) registering the 8 tools, with a SELECTABLE transport: STDIO is the DEFAULT
(`startMcpServer()` → `StdioServerTransport`) and Streamable HTTP is an OPT-IN alternative
(`startHttpMcpServer()`, see `mcp-http-transport`). The `createDbgraphServer()` factory, the 8-tool
table, and the static `initialize` instructions MUST be reused UNCHANGED across BOTH transports. Its
`initialize` response MUST surface usage guidance from a STATIC, golden-tested string in
`src/mcp/instructions.ts` (US-018): when to use explore vs search vs object, and the recommended
pre-change flow (status → explore → precheck). Each tool description MUST carry exactly ONE example
call. There MUST be zero user-maintained instruction files. With the HTTP mode ABSENT, the STDIO path
MUST stay BYTE-IDENTICAL to today through BOTH MCP entry seams — the SEA `dbgraph mcp` route
(`sea-entry.planEntry` dispatching `startMcpServer()`) AND the npm `dbgraph-mcp` bin auto-run guard —
producing no new output and taking no new branch off the flag.
(Previously: the server started ONLY as a stdio transport entry; there was no transport selection and no HTTP launcher.)

#### Scenario: initialize returns the static golden instructions

- GIVEN the in-process SDK client linked to the server
- WHEN it sends `initialize`
- THEN the response includes the static guidance string (explore-vs-search-vs-object + status→explore→precheck flow) matching its golden
- AND each registered tool description carries exactly one example call

#### Scenario: Bare mcp stays byte-identical STDIO across both entry seams

- GIVEN the HTTP mode is absent (bare `dbgraph mcp` / npm `dbgraph-mcp`)
- WHEN the server starts through the SEA `planEntry` route AND through the npm bin auto-run guard
- THEN each starts `startMcpServer()` over `StdioServerTransport` with no new output and no HTTP listener
- AND the STDIO behavior is byte-identical to before this change (regression-pinned)

#### Scenario: Both transports serve the identical 8-tool surface from one factory

- GIVEN the STDIO transport and the HTTP transport
- WHEN each is connected to a `Server` built by `createDbgraphServer()`
- THEN both expose the same 8 tools with the same descriptions and `initialize` instructions
- AND no transport-specific tool rendering exists (formatters are shared, ADR-008)

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

### Requirement: dbgraph install --project scopes agent config to the project directory

`dbgraph install --project` SHALL re-root every supported agent's config-path resolution from the user
home to the PROJECT directory (default: the current working directory) and write the SAME per-agent
`dbgraph-mcp` entry (`{ command: "npx", args: ["-y", "dbgraph-mcp"] }`) in that agent's native format
(mcpServers-JSON / servers-JSON / mcp-JSON / TOML per the existing `AGENT_TABLE` families). With
`--project` ABSENT, `dbgraph install` behavior — including user-home resolution and skip-if-absent —
MUST be byte-identical to today and UNCHANGED.

Unlike the default user scope (which SKIPS an agent whose config file is absent and NEVER creates it),
`--project` MUST CREATE an absent project file, because project config files usually do not pre-exist —
a scoped, opt-in departure confined to `--project`. All SIX supported agents have a project-scoped config location VERIFIED by a LIVE official-docs check on
2026-07-06 (Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`, Gemini CLI
`.gemini/settings.json`, opencode `opencode.json`, Codex `.codex/config.toml`), so `--project` now writes
6/6 agents. Codex's project file `<cwd>/.codex/config.toml` reuses the SAME TOML `[mcp_servers.<name>]`
merge-writer as its global `~/.codex/config.toml`; because Codex loads project MCP servers ONLY for
TRUSTED projects, the codex summary line MUST carry a trust-caveat suffix. The exclusion rule REMAINS as
dormant machinery for any FUTURE agent whose project-scoped location cannot be verified: such an agent
MUST be reported with an actionable message and MUST NOT be guessed. `dbgraph install
--project` MUST still exit 0 even when some agents are unsupported at project scope (US-024 spirit).
`dbgraph install --remove --project` MUST mirror install at project scope. Writes MUST remain
deterministic (byte-stable for identical inputs), MUST preserve unrelated keys verbatim — including any
`${env:VAR}` indirection in other entries (NEVER expanded to a cleartext secret) — and the written
`dbgraph-mcp` entry MUST carry only `command` + `args` (no credentials).

#### Scenario: --project creates an absent project file for a supported agent

- GIVEN no `<cwd>/.cursor/mcp.json` exists (Cursor, a design-verified project-scoped agent)
- WHEN `dbgraph install --project` runs with cwd as the project root
- THEN the file is CREATED containing exactly `mcpServers.dbgraph-mcp = { "command": "npx", "args": ["-y", "dbgraph-mcp"] }`, serialized as 2-space-indented JSON with a single trailing newline
- AND the default (no-`--project`) run would have reported Cursor `absent` and created nothing

#### Scenario: --project merges idempotently and preserves unrelated keys

- GIVEN `<cwd>/.cursor/mcp.json` already contains `mcpServers.other = {…}` and a top-level `"foo": 1`
- WHEN `dbgraph install --project` runs
- THEN `mcpServers.dbgraph-mcp` is added equal to `{ "command": "npx", "args": ["-y", "dbgraph-mcp"] }`
- AND `mcpServers.other` and `foo` are preserved unchanged
- AND re-running writes nothing (idempotent) and leaves the file byte-identical

#### Scenario: --project creates an absent Codex config with the exact TOML bytes and a trust-caveat suffix

- GIVEN no `<cwd>/.codex/config.toml` exists (Codex CLI, LIVE-verified 2026-07-06 to support project-scoped `.codex/config.toml` via `[mcp_servers.<name>]` tables, identical format to global `~/.codex/config.toml`)
- WHEN `dbgraph install --project` runs with cwd as the project root
- THEN the file is CREATED via the SAME `mergeCodexToml` writer as global scope, containing exactly the bytes `[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]\n` (single trailing newline — byte-identical to the global writer's output for the absent case)
- AND the codex summary line reads exactly `codex → written (requires trusted project: set trust_level in ~/.codex/config.toml)`
- AND the command exits with code 0

#### Scenario: A future unverified agent is excluded, never guessed (rule dormant today)

- GIVEN a FUTURE agent whose project-scoped config location is NOT verified (as of 2026-07-06 ALL SIX shipped agents — Claude Code, Cursor, VS Code, Gemini CLI, opencode, Codex — are live-verified, so this rule currently binds NO shipped agent and remains as dormant machinery for agents added later)
- WHEN `dbgraph install --project` runs
- THEN that agent is reported as unsupported at project scope via the actionable `→ not supported with --project` message
- AND no path is invented and no project file is written for it

#### Scenario: --remove --project deletes only the entry and leaves a valid file, never deleting it

- GIVEN `<cwd>/.cursor/mcp.json` contains ONLY `mcpServers.dbgraph-mcp`
- WHEN `dbgraph install --remove --project` runs
- THEN the file REMAINS on disk, left as valid JSON `{}` with a single trailing newline (the emptied `mcpServers` key is dropped)
- AND the file is NOT deleted even though the removed entry was the only one

#### Scenario: --remove --project on an absent file is a no-op

- GIVEN no `<cwd>/.cursor/mcp.json` exists
- WHEN `dbgraph install --remove --project` runs
- THEN no file is created and none is written (remove NEVER creates)
- AND the command exits with code 0

#### Scenario: --project preserves ${env:VAR} indirection verbatim

- GIVEN `<cwd>/.cursor/mcp.json` contains another server entry whose args include the string `"${env:DB_PASSWORD}"`
- WHEN `dbgraph install --project` runs
- THEN the `"${env:DB_PASSWORD}"` string is preserved byte-for-byte in the written file
- AND it is NEVER expanded to a cleartext secret

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

#### Scenario: affected on a SQLite departments column-drop includes view + trigger dependents

- GIVEN a SQLite graph over the torture fixture and a `.sql` script dropping `departments.dept_id`
- WHEN `dbgraph affected script.sql --json` runs
- THEN its `whatToTest` includes `main.active_departments`, `main.employee_summary` and `main.trg_active_dept_instead_insert` (inherited from the shared engine), alongside `main.employees` and `main.assignments`
- AND it exits with code 1 (changes detected)

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

### Requirement: Routine focus renders a PARAMETERS section via the shared payload helper

The shared payload-render helper (`src/core/present/payload.ts`, backing BOTH `formatExplore` and
`formatObject` — see "One shared payload-render helper backs explore and object") SHALL render a
`PARAMETERS` section for a FOCUS node of kind `procedure` or `function`, filling the routine branch
that today returns no payload lines. The section MUST render each parameter — in ascending `ordinal`
order — with its `name`, raw `dataType` and `direction`, and MUST mark `hasDefault` where present. It
MUST be produced by the ONE shared helper (no per-surface branch), so CLI `explore`/`object` and the
MCP `dbgraph_explore`/`dbgraph_object` tools render BYTE-IDENTICAL bytes for the same node. Rendering
MUST be detail-GATED as the routine analog of the COLUMNS section: rendered at `normal` and `full`, NOT
at `brief`. A routine whose `parameters` is UNSET (e.g. SQLite) MUST render NO PARAMETERS section.
Every byte of new output is a DELIBERATE golden bless paired with a `docs/format-spec.md` §6
token-delta note.

#### Scenario: mssql routine focus renders the PARAMETERS section (exact lines)

- GIVEN a routine focus node for `dbo.usp_log_change` with parameters `[{@order_id, int, in, 1}, {@new_status, nvarchar, in, 2}]` at detail `normal`
- WHEN the shared helper renders it inside BOTH `explore` and `object`
- THEN both emit a `PARAMETERS` header followed, in ascending `ordinal`, by the line `  @order_id  int` then `  @new_status  nvarchar` (2-space indent, double-space gaps) — an `in` parameter carries NO direction marker (the DEFAULT, exactly as a nullable column shows no `[NN]`); exact header/line bytes are golden-locked at apply + noted in `docs/format-spec.md` §6
- AND the two renderings are byte-identical (shared source, no per-surface branch — the SAME `renderParameters` backs CLI/MCP `explore` AND `object`)

#### Scenario: direction and default markers are UPPERCASE; `in` is unmarked

- GIVEN four routine parameters — one `direction:"out"`, one `direction:"inout"`, one `direction:"in"`, and one carrying `hasDefault:true`
- WHEN the PARAMETERS section renders
- THEN the `out` line appends `[OUT]`, the `inout` line appends `[INOUT]`, and the defaulted line appends `[DEFAULT]` — ALL UPPERCASE, double-space separated
- AND the `in` line appends NO direction marker
- AND the casing matches the established COLUMNS marker convention `[PK]`/`[FK→]`/`[NN]` (a lowercase `[in]`/`[out]`/`[default]` is a SPEC VIOLATION); `[DEFAULT]` is a PRESENCE marker only (the default VALUE is never rendered)

#### Scenario: PARAMETERS is detail-gated to normal and full, absent at brief (COLUMNS analog)

- GIVEN the SAME routine focus (with parameters) rendered at `brief`, at `normal`, and at `full`
- WHEN each renders in BOTH `explore` and `object`
- THEN `brief` emits NO PARAMETERS section, while `normal` and `full` BOTH emit it — the identical detail gating the COLUMNS section uses

#### Scenario: parameter order follows ordinal, never re-sorted

- GIVEN a routine whose parameters are supplied out of ordinal order
- WHEN the PARAMETERS section renders
- THEN the lines appear in ascending `ordinal` — not alphabetized, not input-order

#### Scenario: routine without parameters and non-routine focus render no PARAMETERS section (negative)

- GIVEN a routine focus whose `parameters` is UNSET, and a TABLE focus node
- WHEN each is rendered
- THEN neither emits a PARAMETERS section
- AND the existing sqlite-substrate explore/object goldens (TABLE focus) show ZERO drift
