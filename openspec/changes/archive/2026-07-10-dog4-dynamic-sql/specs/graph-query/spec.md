# Delta for Graph Query — dog4-dynamic-sql

> Query-surface honesty only (US-014). Builds on the SHIPPED `has_dynamic_sql` propagation (US-007).
> NO extraction, storage, edge, or traversal change. The existing blanket "impact possibly incomplete"
> warning is PRESERVED unchanged; this delta ADDS per-node identification alongside it.

## ADDED Requirements

### Requirement: Impact result identifies the specific dynamic-SQL degraded nodes

The impact query (`getImpact`) SHALL, in ADDITION to the PRESERVED blanket "impact possibly incomplete"
warning, make IDENTIFIABLE the SPECIFIC nodes in the closure that carry `has_dynamic_sql` — by qualified
name, NOT merely a whole-result boolean. A consumer MUST be able to determine WHICH routines in the
result are dynamic-SQL degraded (the presenter renders them per-node). The existing blanket-warning
behavior is UNCHANGED (a closure containing a `has_dynamic_sql` node still carries the warning).
Identifying the degraded nodes MUST NOT add any edge to the closure and MUST NOT fabricate a target for
the unknowable dynamic-string destinations. Output MUST remain deterministic and byte-identical on
re-run (ADR-008). Whether the identification is a new field on the result or derived from closure nodes
already present is an IMPLEMENTATION choice — the OBSERVABLE contract is only that the specific degraded
nodes are nameable.

#### Scenario: impact result names the dynamic-SQL node in the closure

- GIVEN a graph whose impact closure of some node includes `acme.usp_run_report` carrying `has_dynamic_sql: true`
- WHEN the impact closure is computed
- THEN the result IDENTIFIES `acme.usp_run_report` as the degraded node by qualified name
- AND the blanket "impact possibly incomplete" warning is STILL present
- AND no edge is added to the closure and no target is fabricated
- AND the output is byte-identical on re-run (ADR-008)

#### Scenario: closure without dynamic SQL identifies none (negative)

- GIVEN an impact closure containing no `has_dynamic_sql` node
- WHEN it is computed
- THEN the result identifies NO degraded node and carries NO "impact possibly incomplete" warning

#### Scenario: degraded/absent engines are unaffected (negative)

- GIVEN a sqlite graph (no dynamic-SQL statement form; no routines carrying `has_dynamic_sql`)
- WHEN any impact closure is computed
- THEN no node is identified as dynamic-SQL degraded
- AND the existing sqlite impact goldens are byte-identical to before this change
