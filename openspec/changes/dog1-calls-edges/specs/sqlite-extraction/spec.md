# Delta for SQLite Extraction

> Change `dog1-calls-edges`. HONEST capability boundary: SQLite has NO stored procedures or functions
> — its `CapabilityMatrix` already declares procedures and functions UNSUPPORTED. There are therefore
> NO routine nodes to be the source or destination of a `calls` edge, and SQLite triggers cannot invoke
> a stored routine (user-defined functions are HOST-registered at runtime, not catalog objects). SQLite
> consequently gets NO positive `calls` scenario and NO new fixture objects — only an explicit negative
> that pins the absence so a future change does not fabricate a SQLite `calls` edge. The
> `CapabilityMatrix` is UNCHANGED. Stories: US-007, US-026.

## ADDED Requirements

### Requirement: SQLite emits no calls edges (capability honestly absent)

Because the SQLite `CapabilityMatrix` declares procedures and functions UNSUPPORTED, the SQLite
adapter MUST NOT emit any `calls` edge under any circumstance: there is no routine node to originate or
receive one. A trigger body naming an identifier that looks like a function invocation MUST NOT be
turned into a `calls` edge (SQLite has no stored routine to resolve against; host-registered UDFs are
not catalog objects). The `CapabilityMatrix` MUST remain UNCHANGED — procedures and functions stay
unsupported. No new fixture object is added for `calls`.

#### Scenario: SQLite torture graph contains zero calls edges

- GIVEN the existing SQLite torture graph (tables, views, triggers — no routines)
- WHEN the adapter extracts it and the catalog is normalized
- THEN the graph contains ZERO edges of kind `calls`
- AND the SQLite `CapabilityMatrix` still reports procedures and functions as unsupported

#### Scenario: a function-like token in a trigger body invents no calls edge (negative)

- GIVEN a SQLite trigger whose action body references a function-like identifier (e.g. `some_udf(x)`)
- WHEN the catalog is normalized
- THEN NO `calls` edge is fabricated (no routine node exists to resolve the invocation against)
- AND no routine stub is minted for the identifier
