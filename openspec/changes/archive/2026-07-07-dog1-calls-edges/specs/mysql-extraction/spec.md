# Delta for MySQL Extraction

> Change `dog1-calls-edges`. MySQL exposes no dependency view (`supportsDependencyHints: false`), so
> `calls` edges are derived by the SHARED conservative body tokenizer whose candidate list is EXTENDED
> to include ROUTINE names. A `CALL proc()` / `SELECT fn()` in a `ROUTINE_DEFINITION` body resolved
> against a REAL routine node becomes a `calls` edge at `confidence: 'parsed'`, presence-gated with the
> Phase-8b phantom-free / no-self-edge discipline. `reads_from`/`writes_to` classification is
> UNCHANGED. NEW torture routines exercise the path — none exist today. Stories: US-007, US-029.

## ADDED Requirements

### Requirement: Body-parsed calls edges for routine invocations, presence-gated with no phantom or self edges

The mysql adapter SHALL extend the shared tokenizer's candidate list to include ROUTINE names
(procedures and functions) so a routine invocation in a `ROUTINE_DEFINITION` body (`CALL proc()` /
`SELECT fn()`) that resolves to a REAL routine node produces a `calls` edge from the calling routine
to the referenced routine with `confidence: 'parsed'`. Emission MUST be PRESENCE-GATED over the
dynamic-string-MASKED static body (`maskDynamicStrings` + `bodyContainsRef`): a routine name appearing
only inside a masked `PREPARE`/`EXECUTE` dynamic string, a comment, or a string literal MUST NOT
produce an edge. The adapter MUST NEVER default-to-`calls` for every catalog routine, and MUST NEVER
emit a SELF-reference `calls` edge unless the routine is genuinely recursive. Extending the candidate
list MUST NOT reclassify existing table dependencies.

#### Scenario: proc CALL proc yields exactly one parsed calls edge

- GIVEN the torture procedure `app.proc_orchestrate` whose body does `CALL app.proc_step()`, and the procedure `app.proc_step` whose body does `INSERT INTO app.audit_log ...`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `app.proc_orchestrate` emits EXACTLY one `calls app.proc_step` edge with `confidence: 'parsed'` and NO `reads_from`/`writes_to` edge to `app.proc_step`
- AND `app.proc_step` emits `{ writes_to app.audit_log (parsed) }` and ZERO `calls` edge

#### Scenario: routine touching only tables emits zero calls edges (negative)

- GIVEN a procedure whose static body writes/reads only tables and CALLs no routine
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN it emits its `reads_from`/`writes_to` edges as before and ZERO `calls` edge
- AND no self-reference `calls` edge is emitted

#### Scenario: CALL name only inside a masked dynamic string yields no calls edge (negative)

- GIVEN a procedure that builds `'CALL app.proc_step()'` and runs it via `PREPARE`/`EXECUTE`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure is marked `hasDynamicSql: true` and emits NO `calls` edge to `app.proc_step` (the name is inside the masked dynamic string)

### Requirement: mysql torture fixture exercises routine-calls-routine

The committed mysql torture `.sql` (`test/fixtures/mysql/`) SHALL add `app.proc_orchestrate` (CALLing
`app.proc_step`) and `app.proc_step`, using NEUTRAL names. The golden-pinned `RawCatalog` and
end-to-end impact/path goldens MUST be re-blessed DELIBERATELY to include the `calls
app.proc_orchestrate → app.proc_step` edge (`confidence: 'parsed'`), with L-009 exact-set assertions
pinning both endpoints, exact edge counts, `stubCount: 0`, and no self-reference edge.

#### Scenario: fixture adds the routine-calls-routine objects and re-blessed golden pins the parsed calls edge

- GIVEN the materialized mysql torture database with `app.proc_orchestrate` and `app.proc_step`
- WHEN the adapter extracts it and the pipeline runs extract → normalize → upsert → query
- THEN the re-blessed goldens contain EXACTLY the edge `app.proc_orchestrate → app.proc_step` of kind `calls`, `confidence: 'parsed'`, with exact endpoints, `stubCount: 0` and no self-reference edge, byte-identical on re-run (ADR-008)
