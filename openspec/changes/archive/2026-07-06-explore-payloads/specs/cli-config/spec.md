# Delta for cli-config

> Change: `explore-payloads`. Renders the per-kind node PAYLOAD the graph already stores in `explore`
> output (US-035 follow-up), adds an `object` CLI command mirroring `dbgraph_object`, validates
> `--detail`, and fixes the view kind-label. Presentation-only (ADR-004/ADR-008). Byte-pins are against
> `test/fixtures/sqlite/torture.sql` unless noted. FK-target rendering (design D8): render the constraint
> payload target when present (the `dbo.orders` presenter fixture carries a column-level target); when the
> torture FK payload carries NO target, RECONSTRUCT the table-level target from the table's `references`
> edge when unambiguous (torture `employees`/`assignments` qualify), else render the FK columns without a
> target — never guessed.

## MODIFIED Requirements

### Requirement: explore output comes from a pure formatter shared with the MCP tool

`dbgraph explore <qname>` SHALL render an entity bundle (the node plus its neighbors via the core
`getNeighbors` primitive) through a PURE, deterministic formatter, supporting `--detail brief|normal|full`
(US-021). That formatter MUST be the SINGLE source the MCP `explore` tool reuses ("same source, same
golden"): the CLI MUST NOT carry its own divergent rendering. In ADDITION to the grouped neighbor
listing, the formatter MUST render the FOCUS node's per-kind PAYLOAD facts — column
dataType/nullability/default, constraint kind + ORDERED columns + FK target mapping, index
unique/columns, trigger timing/events — through the ONE shared payload-render helper also used by
`object` (see mcp-server "One shared payload-render helper backs explore and object"), GATED by detail
EXACTLY as `object` gates: `brief` = header + neighbor-kind counts only (NO payload lines); `normal` =
+ COLUMNS + CONSTRAINTS; `full` = + INDEXES + TRIGGERS + body. The header MUST label the focus node with
its ACTUAL kind — a view renders `[view]`, never `[table]`. Output for a given graph, qname and detail
level MUST be byte-identical on re-run and pinned by a golden; every byte change to explore output is a
DELIBERATE re-bless paired with a `docs/format-spec.md` edit + token-delta note (§6).
(Previously: explore rendered ONLY the grouped neighbor qname listing — no column types, PK ordering, FK
mapping or trigger timing — reading payload solely for the full-level `hasDynamicSql` warning; the header
labeled a view as `[table]`.)

#### Scenario: explore renders the entity bundle at the requested detail

- GIVEN a graph containing `dbo.orders`
- WHEN `dbgraph explore dbo.orders --detail normal` runs
- THEN it prints the entity bundle (node plus grouped neighbors) at `normal` detail
- AND `brief` and `full` produce correspondingly less/more detail from the same formatter

#### Scenario: explore output is deterministic and golden-pinned

- GIVEN the same graph, qname and detail level
- WHEN `dbgraph explore` runs twice
- THEN the two outputs are byte-identical and match the golden file (ADR-008)

#### Scenario: explore formatter is the single source for the MCP tool

- GIVEN the explore formatter
- WHEN its rendering is invoked
- THEN it is a PURE function of (entity bundle, detail level) reusable by the MCP tool with no CLI-only branching

#### Scenario: normal detail renders focus column types, PK and NN markers in one call

- GIVEN the torture graph and `dbgraph explore main.employees --detail normal`
- WHEN it runs
- THEN the COLUMNS section renders each column's dataType with PK/FK/NN markers, byte-identical to `object main.employees`, including the lines `  emp_id  INTEGER  [PK]`, `  salary  REAL  [NN]  DEFAULT 0.0`, and `  dept_id  INTEGER  [FK→main.departments]  [NN]` (the FK target RECONSTRUCTED from the `references` edge since the torture FK payload carries none — design D8)
- AND the CONSTRAINTS section renders `  [PK]  pk_employees  (emp_id)` and `  [FK]  fk_employees_0  (dept_id → main.departments)`

#### Scenario: composite PK renders member columns in declared order

- GIVEN the torture graph and `dbgraph explore main.assignments --detail normal`
- WHEN it runs
- THEN the CONSTRAINTS section renders the composite primary key with its member columns in DECLARED order — `(project_id, emp_id, dept_id)` — never re-sorted or alphabetized

#### Scenario: FK constraint renders the column → target mapping when the payload carries a target

- GIVEN an object whose FK constraint payload carries a `definition` target (the `dbo.orders` presenter fixture)
- WHEN it is rendered at `normal`
- THEN the FK constraint line reads `  [FK]  FK_orders_customers  (customer_id → dbo.customers.customer_id)`
- AND the referencing column line carries `[FK→dbo.customers.customer_id]`, byte-identical to `object`

#### Scenario: FK target is RECONSTRUCTED from the references edge when the payload carries none

- GIVEN the torture graph and `main.employees`, whose single FK `fk_employees_0` payload carries NO target but whose `references` edge resolves UNAMBIGUOUSLY to `main.departments`
- WHEN it is rendered at `normal`
- THEN the FK constraint line reads `  [FK]  fk_employees_0  (dept_id → main.departments)` and the `dept_id` column line carries `[FK→main.departments]` — the TABLE-level target reconstructed from the edge (never a guessed column), byte-identical between `explore` and `object`

#### Scenario: FK columns render WITHOUT a target when reconstruction is ambiguous

- GIVEN a table whose FK constraint payload carries no target AND whose `references` edges do not resolve to a single unambiguous target table
- WHEN it is rendered at `normal`
- THEN the FK constraint line renders the columns WITHOUT a `→ target` (e.g. `  [FK]  <name>  (<cols>)`) and the column line carries no reconstructed `[FK→…]` — honest degradation, never a guess

#### Scenario: trigger timing and events render at full detail

- GIVEN the torture graph and `dbgraph explore main.employees --detail full`
- WHEN it runs
- THEN the TRIGGERS section renders each trigger's timing + events, byte-identical to `object`, including `  trg_emp_after_insert  AFTER INSERT` and `  trg_emp_salary_update  BEFORE UPDATE`

#### Scenario: brief detail renders no payload lines

- GIVEN `dbgraph explore main.employees --detail brief`
- WHEN it runs
- THEN it renders only the header and the neighbor-kind counts (e.g. `  has_column             6 out`) and NO COLUMNS/CONSTRAINTS/INDEXES/TRIGGERS lines

#### Scenario: view focus node is labeled [view] not [table]

- GIVEN the torture graph containing the view `main.active_departments`
- WHEN `dbgraph explore main.active_departments` runs
- THEN the header reads `main.active_departments  [view]`
- AND it NEVER reads `[table]`

## ADDED Requirements

### Requirement: explore and object reject an unknown --detail value

`dbgraph explore` and `dbgraph object` SHALL VALIDATE the `--detail` value against the EXACT set
`brief | normal | full` and REJECT any other value with a `ConfigError` naming the offending value,
mapped to exit code 2 per the established exit-code contract (consistent with the `mcp --port`
validation precedent). The parser MUST NOT silently coerce an unknown value to `normal`. (US-021; ADR-004.)

#### Scenario: unknown --detail value exits 2 with an actionable message

- GIVEN `dbgraph explore main.employees --detail bogus`
- WHEN the flag is parsed
- THEN it surfaces a `ConfigError` naming `bogus` as an invalid detail level
- AND the process exits with code 2 (established exit-code contract)

#### Scenario: valid --detail values are unaffected

- GIVEN `--detail brief`, `--detail normal`, and `--detail full`
- WHEN each is parsed
- THEN each is accepted and drives the corresponding detail level with no error

### Requirement: object CLI command mirrors dbgraph_object

The CLI SHALL expose an `object <qname>` command — a thin dispatch wrapper over the EXISTING
`formatObject` presenter (the same presenter `dbgraph_object` uses), supporting `--detail brief|normal|full`
— so a CLI-only agent can retrieve one object's full detail (columns, constraints, indexes, triggers,
body) WITHOUT the MCP server. Its output for a given graph, qname and detail level MUST be BYTE-IDENTICAL
to `dbgraph_object({ qname, detail })` (same-source-same-golden) and pinned by a golden. The command MUST
import ONLY the public core API (`src/index.ts`) and Node builtins — NEVER `src/adapters/**` (ADR-004).
The top-level usage banner MUST document the command on an `object` line whose description begins at
character index 12 (two leading spaces, `object`, four spaces — the SAME column alignment as the existing
`query`/`explore`/`install` lines), and a unit test MUST pin that line. (US-012 parity; closes the
CLI↔MCP surface asymmetry the US-035 benchmark exposed.)

#### Scenario: object renders one object's full detail, byte-identical to the MCP tool

- GIVEN the torture graph and `dbgraph object main.employees --detail full`
- WHEN it runs
- THEN it prints columns/constraints/indexes/triggers via `formatObject`, byte-identical to `dbgraph_object({ qname: "main.employees", detail: "full" })`, including `  salary  REAL  [NN]  DEFAULT 0.0` and `  idx_emp_email  UNIQUE (email)`

#### Scenario: object honors the CLI import boundary

- GIVEN the `object` command source under `src/cli/**`
- WHEN the boundary test analyzes it
- THEN it imports only `src/index.ts` and Node builtins (no `src/adapters/**`) and the boundary test stays green

#### Scenario: usage banner documents the object line with the exact alignment

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `object` line is inspected
- THEN its description begins at character index 12 (`  object` followed by four spaces), matching every other command line
- AND a unit test pins the line so dropping the `object` command fails the build
