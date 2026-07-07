# Delta for MCP Server

> Change `sqlite-view-deps`. No change to the precheck ENGINE — it already aggregates `getImpact`
> over inbound `writes_to`/`reads_from`/`depends_on`/`references` edges. What changes is the INPUT:
> the SQLite adapter now emits view `depends_on` and trigger `writes_to` edges, so `precheck` and its
> `affected` CLI sibling surface the dependent views + INSTEAD OF trigger that were previously
> view-blind on SQLite. L-009 exact-set: the `whatToTest` set is pinned by qname.

## MODIFIED Requirements

### Requirement: dbgraph_precheck aggregates DDL impact with parsed-confidence tagging

`dbgraph_precheck` SHALL accept `{ ddl: string, detail? }` (US-016) and a shared zero-dependency engine
that extracts qualified identifiers from the DDL via the conservative regex tokenizer (reusing the MSSQL
`tokenizer.ts` pattern), matches them against the graph via `search`/`getNodeByQName`, and AGGREGATES
`getImpact` across all statements (deduplicated) into sections: triggers firing on the affected objects,
who writes/reads them, constraints/indexes involved, and what-to-test derived from the edges. Because
impact traversal follows inbound `writes_to`/`reads_from`/`depends_on`/`references` edges, the
aggregation MUST surface view and trigger dependents on EVERY engine that emits those edges — including
SQLite. Every parse-derived item MUST be tagged `confidence: 'parsed'`. Identifiers that match no graph
node MUST be reported as unmatched, never guessed. `node-sql-parser` is out of scope.
(Previously: on SQLite the aggregation was view/trigger-blind — the adapter emitted no `depends_on`/`writes_to` edges for views/triggers, so a `departments` column-drop surfaced only the FK-linked `employees`/`assignments` and MISSED the dependent views and the INSTEAD OF trigger.)

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

### Requirement: dbgraph affected mirrors precheck via the CLI

`dbgraph affected <script.sql>` (US-023) SHALL be a thin CLI wrapper over the SAME precheck engine,
producing the aggregated what-to-test\what-breaks result with `confidence: 'parsed'` tagging. It MUST
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
