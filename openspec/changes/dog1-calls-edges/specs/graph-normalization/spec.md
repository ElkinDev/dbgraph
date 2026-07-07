# Delta for Graph Normalization

> Change `dog1-calls-edges`. `buildDependencyEdges` now BRANCHES on the preserved
> `RawDependency.target.kind`: a routine target (`procedure` / `function`) yields a `calls` edge
> resolved to the ACTUAL routine node; every non-routine target keeps the read/write logic
> byte-for-byte. This FIXES the latent stub bug — a routine-target dependency previously defaulted
> (`targetKind = dep.target.kind ?? 'table'`) to a `reads_from` edge over a phantom `missing`
> `[table]` stub. Resolution is CONSERVATIVE (ADR-007): no real routine node → NO edge, never a stub.
> The branch is engine-agnostic and written ONCE. Stories: US-006, US-007.

## ADDED Requirements

### Requirement: Routine-target dependencies become calls edges resolved to real routines

The normalizer SHALL branch on `RawDependency.target.kind`. When the target kind is a routine
(`procedure` or `function`), the normalizer MUST emit a `calls` edge from the source routine to the
target routine, carrying the `RawDependency.confidence` UNCHANGED (`declared` for mssql, `parsed` for
pg/mysql). The target MUST be resolved against an ACTUAL routine node; when no such routine node
exists the normalizer MUST emit NO edge and MUST NOT mint any stub (ADR-007 — a builtin such as
`count()` or a table-named-like-a-function yields nothing). A routine-target dependency MUST NOT
produce a `reads_from`/`writes_to` edge nor a `missing: true` `[table]` stub. Every NON-routine
target MUST keep the existing read/write resolution unchanged. Emitted `calls` edges MUST be ordered
deterministically so the graph is golden-pinnable (ADR-008). A `calls` self-edge MUST be emitted ONLY
when a routine genuinely invokes itself (real recursion), never fabricated otherwise.
(Previously: `buildDependencyEdges` defaulted `targetKind = dep.target.kind ?? 'table'`, so a routine
invoking a routine became a `reads_from` edge to a non-existent table and minted a spurious `missing`
`[table]` stub; `calls` did not exist.)

#### Scenario: proc→proc yields exactly one calls edge and zero table stub (regression byte-pin)

- GIVEN a `RawCatalog` where procedure `dbo.usp_refresh_totals` carries a `RawDependency` to `dbo.usp_log_change` with `target.kind: 'procedure'`, and both routine nodes exist
- WHEN it is normalized
- THEN the edge set contains EXACTLY one edge `dbo.usp_refresh_totals → dbo.usp_log_change` of kind `calls`
- AND there is ZERO `reads_from`/`writes_to` edge from `dbo.usp_refresh_totals` to `dbo.usp_log_change`
- AND ZERO `missing: true` `[table] usp_log_change` stub appears (its phantom-stub count is zero)

#### Scenario: unresolved routine target invents no edge and no stub (negative)

- GIVEN a `RawDependency` whose `target.kind` is a routine but whose name resolves to NO routine node (e.g. a builtin `count`)
- WHEN it is normalized
- THEN NO `calls` edge is emitted for it
- AND NO stub node of any kind is minted for the unresolved target

#### Scenario: routine touching only tables emits zero calls edges (negative)

- GIVEN a routine whose `RawDependency` set targets only TABLES (read and write)
- WHEN it is normalized
- THEN its `reads_from`/`writes_to` edges are produced exactly as before with `confidence: parsed`
- AND ZERO `calls` edge is emitted for it

#### Scenario: self-call emitted only when recursion is real

- GIVEN a routine whose body genuinely invokes itself (`target.kind: routine`, target = the same routine node) and a second routine that does NOT invoke itself
- WHEN both are normalized
- THEN exactly one `calls` self-edge is emitted for the recursive routine
- AND NO `calls` self-edge is emitted for the non-recursive routine
