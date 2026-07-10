# Delta for mcp-server (dog3-column-lineage)

> `dbgraph_precheck`/`dbgraph affected` inherit the column-grain view precision from `getImpact`
> (graph-query): on declared engines, a column-drop DDL surfaces EXACTLY the consuming views (those whose
> `depends_on` edge lists the column in `attrs.dstColumns`), not every view over the table.
> `dbgraph_explore`/`dbgraph_object` (via the shared payload helper) render a view's consumed SOURCE-COLUMN
> SET from `edge.attrs.dstColumns`, gated to FULL detail only (design D-render). The rendered lines follow the
> PINNED SHAPE `consumes: <table>.<column>`; the exact label TEXT and byte layout WITHIN that shape are
> golden-locked at apply with a `docs/format-spec.md` §6 token-delta note. SOURCE-COLUMN SET only — never an
> output mapping (ADR-007). Stories: US-016/US-023 (precheck/affected), US-010/US-012/US-019 (explore/object/format).

## ADDED Requirements

### Requirement: precheck and affected surface column-grain view precision (declared engines)

On engines whose view `depends_on` edges carry `attrs.dstColumns` (declared — mssql/pg covered pairs),
`dbgraph_precheck` (and its `dbgraph affected` CLI sibling) SHALL aggregate a column-drop/alter DDL into
readers/what-to-test by FILTERING views on `attrs.dstColumns` membership: a view whose edge LISTS the dropped
column MUST appear; a view over the same TABLE whose edge does NOT list it (or whose edge carries no
`attrs.dstColumns`) is handled per the impact rule — excluded when the set is present, included when the set
is absent (degrade-include). Every parse-derived item MUST stay tagged `confidence: 'parsed'` (the DDL
identifiers are parsed even though the underlying view edges are declared). Non-matchable identifiers MUST be
reported unmatched, never guessed. On degraded engines, view impact stays object grain (unchanged).

#### Scenario: mssql column-drop precheck surfaces only the consuming view (exact set)

- GIVEN the mssql torture graph and a DDL dropping `dbo.order_items.product_id`
- WHEN `dbgraph_precheck({ ddl })` runs over that graph
- THEN `whatToTest` includes `dbo.v_order_summary` in the READERS section (its edge lists `product_id` in `attrs.dstColumns`), tagged `confidence: 'parsed'`
- AND a DDL dropping `dbo.order_items.region_id` does NOT surface `dbo.v_order_summary` (its edge does not list `region_id`)

#### Scenario: affected mirrors the precision via the shared engine

- GIVEN a `.sql` script dropping `dbo.order_items.product_id` over the mssql torture graph
- WHEN `dbgraph affected script.sql --json` runs
- THEN its `whatToTest` includes `dbo.v_order_summary` (inherited from the shared precheck engine) and exits with code 1
- AND a script dropping only `dbo.order_items.region_id` does NOT list `dbo.v_order_summary` as a view consumer

### Requirement: explore and object render a view's consumed source columns at full detail, honest

The shared payload-render helper (`src/core/present/payload.ts`, backing BOTH `formatExplore` and
`formatObject`) SHALL render, for a VIEW focus node whose `depends_on` edges carry `attrs.dstColumns`, the
source columns the view CONSUMES — gated to `full` detail ONLY (NOT `brief`, NOT `normal`; budget honesty:
the consumed-column list is a full-detail concern for wide views). CLI and MCP MUST render BYTE-IDENTICAL
bytes for the same node (one shared helper, no per-surface branch). Each rendered line MUST follow the PINNED
SHAPE `consumes: <source-table>.<column>` (the fixed `consumes:` key plus a `table.column` reference), listing
the consumed source columns in the canonical code-point order (graph-normalization); it MUST name ONLY source
columns CONSUMED — NEVER pair an output column to a source column (ADR-007). A view whose `depends_on` edges
carry NO `attrs.dstColumns` (degraded engines / uncovered pg) MUST render NO consumes section. The EXACT label
TEXT and byte layout WITHIN the pinned `consumes:` shape are pinned at apply as a DELIBERATE golden bless with
a matching `docs/format-spec.md` §6 token-delta note; the ceiling POLICY (measured numbers, spec-edit +
token-delta on every golden change) is UNCHANGED.

#### Scenario: view focus renders its consumed source columns at full only

- GIVEN a VIEW focus node whose `depends_on` edges carry `attrs.dstColumns`, rendered at `brief`, `normal`, and `full`
- WHEN the shared helper renders it inside BOTH `explore` and `object`
- THEN `full` renders a `consumes: <table>.<column>` section listing the consumed source columns in code-point order; `brief` and `normal` render NONE (object grain only)
- AND the two surfaces are byte-identical (shared source); the exact label text and bytes WITHIN the pinned `consumes:` shape are golden-locked at apply plus a `docs/format-spec.md` §6 token-delta note

#### Scenario: render names source columns consumed, never an output mapping (honesty)

- GIVEN a view whose SELECT renames or computes outputs
- WHEN its consumes section renders at `full`
- THEN the lines assert ONLY which source columns the view reads
- AND NO line pairs an output column to a source column

#### Scenario: degraded-engine view renders no consumes section (negative)

- GIVEN a mysql or sqlite view (edges carry no `attrs.dstColumns`) at `full`
- WHEN `explore`/`object` render it
- THEN NO consumes section appears (object-grain dependencies only)
- AND the existing sqlite explore/object goldens show ZERO drift from this feature
