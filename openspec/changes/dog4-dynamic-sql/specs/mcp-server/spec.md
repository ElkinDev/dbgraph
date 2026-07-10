# Delta for MCP Server — dog4-dynamic-sql

> Presentation + query-surface honesty only. Builds on the SHIPPED `hasDynamicSql`
> detection/propagation (US-007). NO extraction, storage, edge, or traversal change.
> Marker string PINNED: `[DYNAMIC SQL]` (UPPERCASE, bracketed, single space — DOG-2 `[OUT]`/`[INOUT]` family).

## ADDED Requirements

### Requirement: Dynamic-SQL caveat surfaces at normal AND full detail in explore and object

The dynamic-SQL blind-spot caveat SHALL render for a routine focus node whose payload carries
`hasDynamicSql === true`, produced by the ONE shared payload-render helper backing BOTH `formatExplore`
and `formatObject` (US-010/US-012/US-021). It MUST be GATED to `normal` AND `full` detail and MUST NOT
render at `brief` (the counts-only contract is untouched). The caveat MUST be the EXACT marker
`[DYNAMIC SQL]` — UPPERCASE, bracketed, one internal space, consistent with the DOG-2
`[OUT]`/`[INOUT]`/`[DEFAULT]` family; any lowercase or reworded variant (`[dynamic sql]`,
`dynamic-SQL`, `possibly incomplete`) is a SPEC VIOLATION. Because the ONE shared helper produces the
bytes, CLI `explore`/`object` and MCP `dbgraph_explore`/`dbgraph_object` MUST render BYTE-IDENTICAL
output for the same node. The marker is a NODE-attribute caveat: it MUST NOT emit any edge and MUST NOT
fabricate a target for the unknowable dynamic-string destinations. `confidence` stays `declared|parsed`
— NO new tier. Exact byte placement is golden-locked at apply with a matching `docs/format-spec.md` §6
token-delta note.
(Previously: explore surfaced the dynamic-SQL warning ONLY at `full`; `object` never surfaced it at any detail.)

#### Scenario: dynamic-SQL routine shows the caveat at normal (explore and object byte-identical)

- GIVEN a routine `acme.usp_run_report` whose payload carries `hasDynamicSql: true`, at detail `normal`
- WHEN it renders in BOTH `dbgraph_explore` and `dbgraph_object`
- THEN both emit the EXACT marker `[DYNAMIC SQL]` exactly once for that routine, and the two renderings are byte-identical (shared helper, no per-surface branch)
- AND the routine's existing static neighbors/edges still render unchanged (no edge dropped, none fabricated)

#### Scenario: caveat renders at full too, never at brief

- GIVEN the same `acme.usp_run_report` rendered at `brief`, `normal`, and `full`
- WHEN each renders in explore and object
- THEN `normal` and `full` BOTH emit `[DYNAMIC SQL]`; `brief` emits NO `[DYNAMIC SQL]` line

#### Scenario: a routine WITHOUT dynamic SQL never carries the marker (negative)

- GIVEN a routine `acme.usp_touch_totals` whose payload carries `hasDynamicSql: false` (or unset)
- WHEN it renders in explore and object at `normal` and `full`
- THEN NO `[DYNAMIC SQL]` marker appears in its output at ANY detail level

#### Scenario: sqlite and mongodb are untouched (honest absence)

- GIVEN a sqlite graph (no dynamic-SQL statement form) and a mongodb graph (no routines)
- WHEN explore/object render any of their nodes at any detail
- THEN NO `[DYNAMIC SQL]` marker is EVER emitted
- AND the existing sqlite explore/object goldens are BYTE-IDENTICAL to before this change (zero drift)

### Requirement: precheck and affected mark the exact dynamic-SQL degraded items per node

`dbgraph_precheck` and its `dbgraph affected` CLI sibling (US-016/US-023) SHALL annotate EACH surfaced
item whose subject routine's payload carries `hasDynamicSql === true` with the EXACT marker
`[DYNAMIC SQL]` — a PER-NODE degradation marker, NEVER a node-agnostic blanket warning. The marker MUST
attach ONLY to the specific degraded item(s); an item whose subject routine is not dynamic-SQL MUST NOT
carry it. The marker MUST NOT fabricate an edge or a target. Every parse-derived item MUST stay tagged
`confidence: 'parsed'` — the caveat is ORTHOGONAL to confidence (no new tier). The `--json` affected
payload MUST mark the same degraded item(s); on mssql/pg/mysql the degraded-node set is re-blessed as an
EXACT set (L-009), and on sqlite/mongodb the output stays byte-identical (no degraded items).

#### Scenario: precheck marks only the dynamic-SQL item (exact set, per-node)

- GIVEN a graph where impacted items include `acme.usp_run_report` (hasDynamicSql:true) and `acme.usp_touch_totals` (hasDynamicSql:false)
- WHEN `dbgraph_precheck({ ddl })` runs
- THEN the item for `acme.usp_run_report` carries `[DYNAMIC SQL]` and the item for `acme.usp_touch_totals` does NOT
- AND both items stay tagged `confidence: 'parsed'`, and NO new edge appears

#### Scenario: affected mirrors the per-node marking via the shared engine

- GIVEN a `.sql` script over a pg graph whose impact surfaces a dynamic-SQL routine `acme.fn_exec_stmt`
- WHEN `dbgraph affected script.sql --json` runs
- THEN the degraded set marked dynamic-SQL is EXACTLY `{acme.fn_exec_stmt}` (inherited from the shared precheck engine) and it exits 1
- AND a script whose impact touches no dynamic-SQL routine marks NO item

#### Scenario: sqlite affected is byte-identical (negative)

- GIVEN a `.sql` script over the sqlite torture graph
- WHEN `dbgraph affected script.sql --json` runs
- THEN NO item is marked `[DYNAMIC SQL]` and the sqlite affected/precheck goldens are byte-identical to before

### Requirement: dbgraph_impact names the specific dynamic-SQL degraded routines

`dbgraph_impact` (US-014) SHALL, in ADDITION to the PRESERVED blanket "impact possibly incomplete"
warning, NAME each routine in the impact result whose body carries `has_dynamic_sql` — the specific
degraded node(s) by qualified name, NOT merely a blanket boolean. Each named routine MUST carry the
EXACT `[DYNAMIC SQL]` marker. Naming MUST NOT fabricate an edge or a target for the unknowable dynamic
destinations. The blanket-warning semantics are PRESERVED for compatibility.

#### Scenario: impact names the degraded routine and keeps the blanket warning

- GIVEN an impact chain including `acme.usp_run_report` (has_dynamic_sql:true)
- WHEN `dbgraph_impact({ qname })` runs
- THEN the result NAMES `acme.usp_run_report` with the `[DYNAMIC SQL]` marker
- AND the blanket "impact possibly incomplete" warning is STILL present
- AND no fabricated edge/target is added for the dynamic-SQL destinations

#### Scenario: impact with no dynamic-SQL node names none (negative)

- GIVEN an impact chain containing no `has_dynamic_sql` node
- WHEN `dbgraph_impact` runs
- THEN NO `[DYNAMIC SQL]` marker appears and NO "impact possibly incomplete" warning is emitted
