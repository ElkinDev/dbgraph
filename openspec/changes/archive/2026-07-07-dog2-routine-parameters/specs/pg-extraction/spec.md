# PostgreSQL Extraction Delta (dog2-routine-parameters)

## ADDED Requirements

### Requirement: Decode routine parameters from pg_proc arrays

The pg adapter SHALL extend `SQL_PG_ROUTINES` with `proargnames`, `proargmodes` and `proallargtypes`
(argument type names decoded via `regtype` in SQL — see design §4.2) and decode them into
`RawObject.parameters`. For each argument it MUST capture `name` (from `proargnames` by array position;
NULL when unnamed), `dataType` (the canonical type name as PostgreSQL exposes it for FUNCTION ARGUMENTS —
the SAME type vocabulary the adapter's COLUMN `dataType` uses, e.g. `integer`, `numeric`; NOTE PostgreSQL
does NOT store per-argument length/precision typmod, so a `numeric(10,2)` argument HONESTLY surfaces as
`numeric` — the precision a COLUMN would show is PHYSICALLY absent for a function argument and MUST NOT be
fabricated), `direction` from `proargmodes` (`i`→`in`, `o`→`out`, `b`→`inout`, `v` VARIADIC→`in` — a
VARIADIC argument IS an input; `t` TABLE→**EXCLUDED** from `parameters` — `RETURNS TABLE` entries are
RESULT columns, NOT call parameters, mirroring the mysql `ORDINAL_POSITION = 0` return-row exclusion; they
belong to the deferred TVF-column-set work), and `ordinal` from array position (contiguous 1..N over the
EMITTED arguments, after excluding any `t`-mode entry). When `proargmodes` is NULL, ALL arguments are `in`
(the PostgreSQL encoding for an all-IN routine — the adapter MUST NOT emit `out`/`inout` unless the mode
array PROVES it). `hasDefault` MAY be set for the trailing `pronargdefaults` arguments ONLY; where it
cannot be cleanly attributed it MUST be OMITTED, never fabricated. A routine with no arguments MUST carry
an empty parameters array.

#### Scenario: zero-parameter routines pinned exactly (fn_wrapper/fn_inner)

- GIVEN the torture functions `app.fn_wrapper()` and `app.fn_inner()` (no arguments)
- WHEN `extract(scope)` runs
- THEN each carries `parameters: []` (a real empty signature) — NOT unset
- AND no direction or `hasDefault` is fabricated for either

#### Scenario: NULL proargmodes yields all-IN (fn_place_order)

- GIVEN `app.fn_place_order(p_order_id int, p_customer_id int, p_product_id int, p_qty int)` with `proargmodes = NULL`
- WHEN `extract(scope)` runs
- THEN its `parameters` are EXACTLY four entries at ordinals 1..4, each `direction:"in"` and `dataType:"integer"`, names `p_order_id` / `p_customer_id` / `p_product_id` / `p_qty` in order
- AND NO parameter is emitted as `out` or `inout`

#### Scenario: VARIADIC is an input; RETURNS TABLE columns are excluded (pinned modes)

- GIVEN a routine with a VARIADIC argument (`proargmodes` element `v`) and, separately, a `RETURNS TABLE`
  routine whose `proargmodes` carries `t` entries
- WHEN `extract(scope)` runs
- THEN the VARIADIC argument is emitted with `direction:"in"` (it is an input)
- AND every `t` (TABLE) entry is EXCLUDED from `parameters` — the result columns are NOT call parameters
  (mirror of the mysql `ORDINAL_POSITION = 0` return-row exclusion)
- AND note: no current DOG-1 pg fixture exercises `v` or `t`; unit-fixture coverage for both modes is
  added at apply so the goldens pin these bytes

#### Scenario: pg parameter dataType carries no fabricated precision (typmod-less args)

- GIVEN a pg routine argument declared with a precision type (e.g. `numeric(10,2)`)
- WHEN `extract(scope)` runs
- THEN its `dataType` is the canonical type name `numeric` — NOT `numeric(10,2)` — because PostgreSQL
  stores no per-argument typmod; the precision is honestly absent, never invented

#### Scenario: pg goldens gain parameters deliberately, scanner stays green

- GIVEN the pg raw-catalog and e2e goldens
- WHEN parameters are added
- THEN the pg goldens are re-blessed DELIBERATELY to carry the pinned arrays; every unrelated byte is unchanged
- AND `SQL_PG_ROUTINES` still passes the engines write-verb scanner (catalog `SELECT` only)
