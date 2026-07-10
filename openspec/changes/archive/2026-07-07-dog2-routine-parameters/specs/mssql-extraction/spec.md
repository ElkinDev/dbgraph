# MSSQL Extraction Delta (dog2-routine-parameters)

## ADDED Requirements

### Requirement: Extract routine parameters from sys.parameters

The mssql adapter SHALL source routine parameters via a new `SQL_MSSQL_PARAMETERS` query over
`sys.parameters` joined to `sys.types` (FOR JSON PATH-compatible, per the existing `SQL_MSSQL_*`
convention), attaching them to each procedure/function `RawObject.parameters`. For each parameter it
MUST capture `name` (verbatim, e.g. `@order_id`), `dataType` (the `sys.types` type NAME — BARE,
consistent with the adapter's existing COLUMN `dataType` which stores the bare catalog type name, e.g.
`int` / `nvarchar` / `decimal`, NOT `decimal(12,2)`), `direction` mapped from `is_output` (`0`→`in`,
`1`→`out`; SQL Server exposes no explicit INOUT in `sys.parameters`), `ordinal` from `parameter_id`,
and `hasDefault` from `has_default_value`. The FUNCTION RETURN row (`parameter_id = 0`, empty name)
MUST be EXCLUDED — it is not a parameter (the scalar return is already captured by `returns`). A
routine with no parameters MUST carry an empty parameters array.

#### Scenario: procedure parameters pinned exactly (usp_log_change)

- GIVEN the torture procedure `dbo.usp_log_change (@order_id int, @new_status nvarchar(20))`
- WHEN `extract(scope)` runs
- THEN its `parameters` are EXACTLY `[{name:"@order_id", dataType:"int", direction:"in", ordinal:1}, {name:"@new_status", dataType:"nvarchar", direction:"in", ordinal:2}]`
- AND no parameter carries `hasDefault: true` (none is defaulted)

#### Scenario: single-parameter procedure and scalar functions pinned exactly

- GIVEN `dbo.usp_refresh_totals (@order_id int)`, `dbo.fn_net_amount (@gross decimal(12,2))` and `dbo.fn_round_money (@amount decimal(12,2))`
- WHEN `extract(scope)` runs
- THEN `usp_refresh_totals.parameters` is EXACTLY `[{name:"@order_id", dataType:"int", direction:"in", ordinal:1}]`
- AND `fn_net_amount.parameters` is EXACTLY `[{name:"@gross", dataType:"decimal", direction:"in", ordinal:1}]` and `fn_round_money.parameters` is EXACTLY `[{name:"@amount", dataType:"decimal", direction:"in", ordinal:1}]`, each with the `parameter_id = 0` return row EXCLUDED

#### Scenario: mssql goldens gain parameters deliberately, scanner stays green

- GIVEN the mssql raw-catalog and e2e goldens
- WHEN parameters are added
- THEN the mssql goldens are re-blessed DELIBERATELY to carry the pinned `parameters` arrays; every other byte is unchanged
- AND the new `SQL_MSSQL_PARAMETERS` passes the engines write-verb scanner (catalog `SELECT` only)
