# MySQL Extraction Delta (dog2-routine-parameters)

## ADDED Requirements

### Requirement: Extract routine parameters from information_schema.PARAMETERS

The mysql adapter SHALL source routine parameters from `information_schema.PARAMETERS` (filtered
`SPECIFIC_SCHEMA = DATABASE()`), attaching them to each routine's `RawObject.parameters`. For each it
MUST capture `name` (`PARAMETER_NAME`), `dataType` (`DTD_IDENTIFIER`, composed IDENTICALLY to the
adapter's COLUMN `dataType`, e.g. `int`, `varchar(20)`), `direction` from `PARAMETER_MODE` (`IN`→`in`,
`OUT`→`out`, `INOUT`→`inout`; a NULL mode — as MySQL reports for FUNCTION parameters — maps to `in`),
and `ordinal` from `ORDINAL_POSITION`. The FUNCTION RETURN row (`ORDINAL_POSITION = 0`, NULL
`PARAMETER_NAME`) MUST be EXCLUDED — it is not a parameter. MySQL exposes NO parameter default column,
so `hasDefault` MUST NEVER be emitted for any mysql parameter (the field is OMITTED, not set false). A
routine with no parameters MUST carry an empty parameters array.

#### Scenario: zero-parameter procedures pinned exactly (proc_orchestrate/proc_step)

- GIVEN the torture procedures `app.proc_orchestrate()` and `app.proc_step()`
- WHEN `extract(scope)` runs
- THEN each carries `parameters: []`
- AND NO `hasDefault` field appears on any mysql parameter

#### Scenario: function return row (ordinal 0) excluded (fn_audit_write)

- GIVEN the function `fn_audit_write(p_order_id INT, p_old_status VARCHAR(20), p_new_status VARCHAR(20)) RETURNS INT`
- WHEN `extract(scope)` runs
- THEN its `parameters` are EXACTLY `[{name:"p_order_id", dataType:"int", direction:"in", ordinal:1}, {name:"p_old_status", dataType:"varchar(20)", direction:"in", ordinal:2}, {name:"p_new_status", dataType:"varchar(20)", direction:"in", ordinal:3}]`
- AND the `ORDINAL_POSITION = 0` return row is EXCLUDED and NO parameter carries `hasDefault`

#### Scenario: mysql goldens gain parameters deliberately, scanner stays green

- GIVEN the mysql raw-catalog and e2e goldens
- WHEN parameters are added
- THEN the mysql goldens are re-blessed DELIBERATELY to carry the pinned arrays; every unrelated byte is unchanged
- AND the new PARAMETERS query passes the engines write-verb scanner (catalog `SELECT` only)
