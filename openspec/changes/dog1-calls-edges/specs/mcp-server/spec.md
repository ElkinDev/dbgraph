# Delta for MCP Server

> Change `dog1-calls-edges`. Two surface effects of the new `calls` edge, both nearly free. (1) The
> precheck/impact engine adds `calls` to the traversed edge kinds as a READ-impact kind (a call is not a
> write), so `impact`/`affected`/`precheck` reach CALLERS through call chains. (2) `getNeighbors` applies
> no edge-kind allowlist and the shared formatters iterate `Object.keys(view.neighbors).sort()`, so
> `dbgraph_explore`/`dbgraph_related` render a `calls` section automatically once the edges exist. The
> `calls` behavioral pins are framed over the mssql routine chain (the SQLite in-process golden harness
> has no routines); the test vehicle — an mssql-gated e2e vs a synthetic normalized graph — is a design
> decision. Stories: US-013, US-014, US-016, US-023.

## MODIFIED Requirements

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

## ADDED Requirements

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
