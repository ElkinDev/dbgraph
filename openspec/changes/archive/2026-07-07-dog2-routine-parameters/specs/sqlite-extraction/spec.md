# SQLite Extraction Delta (dog2-routine-parameters)

## ADDED Requirements

### Requirement: SQLite emits no routine parameters (capability honestly absent)

Because the SQLite `CapabilityMatrix` declares procedures and functions UNSUPPORTED, the SQLite adapter
MUST NOT populate `RawObject.parameters` under any circumstance — there is no routine node to carry
them. `parameters` MUST remain UNSET on every SQLite `RawObject` (honest absence, declared — NEVER an
empty array, never fabricated). The `CapabilityMatrix` MUST remain UNCHANGED and NO fixture object is
added.

#### Scenario: SQLite catalog carries no parameters field

- GIVEN the existing SQLite torture catalog (tables, views, triggers — no routines)
- WHEN the adapter extracts it
- THEN no `RawObject` carries a `parameters` field (the field is UNSET, not `[]`)
- AND the SQLite `CapabilityMatrix` still reports procedures and functions unsupported

#### Scenario: SQLite present/MCP goldens show zero drift (negative)

- GIVEN the existing sqlite-substrate explore/object goldens (focusing a TABLE, `main.employees`)
- WHEN DOG-2 is applied
- THEN those goldens are byte-identical — the parameters feature adds NO SQLite output (no routine node, no PARAMETERS section)
