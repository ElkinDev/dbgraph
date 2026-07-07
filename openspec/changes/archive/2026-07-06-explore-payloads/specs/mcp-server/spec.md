# Delta for mcp-server

> Change: `explore-payloads`. `dbgraph_explore` gains the per-kind payload sections via a shared pure
> helper that ALSO backs `dbgraph_object` (coherence by construction); `docs/format-spec.md` grammar +
> per-detail budgets are updated with a token-delta note; `dbgraph_object` behavior is UNCHANGED
> (refactor-transparent). Presentation-only (ADR-004/ADR-008); byte-pins against
> `test/fixtures/sqlite/torture.sql`.

## ADDED Requirements

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

## MODIFIED Requirements

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
