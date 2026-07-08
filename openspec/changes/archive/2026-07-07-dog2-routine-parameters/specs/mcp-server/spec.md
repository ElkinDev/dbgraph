# MCP Server Delta (dog2-routine-parameters)

> The PARAMETERS section is added to the ONE shared payload helper, so CLI `explore`/`object` AND the
> MCP tools inherit it together (the `cli-config` explore requirement references this same helper — no
> separate cli-config delta is required; the section bytes have a single source).

## ADDED Requirements

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
