# Delta for PostgreSQL Extraction

> Change `dog1-calls-edges`. pg has no cheap call catalog (`supportsDependencyHints: false`), so
> `calls` edges are derived by the SHARED conservative body tokenizer whose candidate list is EXTENDED
> to include ROUTINE nodes. A routine-invocation reference resolved against a REAL routine node becomes
> a `calls` edge at `confidence: 'parsed'`. `reads_from`/`writes_to` classification is UNCHANGED. NEW
> torture routines exercise the path — none exist today (`fn_place_order`/`proc_cancel_order` touch
> tables only), so `calls` coverage is currently ZERO. Stories: US-007, US-028.

## ADDED Requirements

### Requirement: Body-parsed calls edges for routine invocations

The pg adapter SHALL extend the shared tokenizer's candidate list to include ROUTINE names (functions
and PG11+ procedures) so a routine-invocation reference in a `pg_get_functiondef` body (`SELECT fn()`
/ `PERFORM fn()` / `CALL proc()`) that resolves to a REAL routine node produces a `calls` edge from
the calling routine to the referenced routine with `confidence: 'parsed'`. Emission MUST stay
PRESENCE-GATED over the dynamic-string-MASKED static body (`maskDynamicStrings` + `bodyContainsRef`):
a name appearing only in a comment, a string literal, or a dynamic `EXECUTE` string MUST NOT produce
an edge. A reference to a BUILTIN (e.g. `now()`, `count()`) that resolves to no routine node MUST
produce NO edge. The adapter MUST NEVER emit a SELF-reference `calls` edge unless the routine is
genuinely recursive. Extending the candidate list MUST NOT reclassify existing table dependencies —
routines only ADD candidates.

#### Scenario: function invoking a function yields exactly one parsed calls edge

- GIVEN the torture function `app.fn_wrapper` whose body does `SELECT app.fn_inner()`, and the function `app.fn_inner` whose body does `SELECT ... FROM app.orders`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN `app.fn_wrapper` emits EXACTLY one `calls app.fn_inner` edge with `confidence: 'parsed'` and NO `reads_from`/`writes_to` edge to `app.fn_inner`
- AND `app.fn_inner` emits `{ reads_from app.orders (parsed) }` and ZERO `calls` edge

#### Scenario: builtin invocation and body-absent routines emit no calls edge (negative)

- GIVEN a routine whose static body invokes only builtins (`now()`, `count()`) and names no user routine
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN ZERO `calls` edge is emitted (no builtin resolves to a routine node)
- AND no `calls` edge is fabricated for any routine whose name does not appear in the masked static body

#### Scenario: routine name only inside a dynamic EXECUTE string yields no calls edge (negative)

- GIVEN a plpgsql routine that builds `'SELECT app.fn_inner()'` and runs it via the dynamic `EXECUTE` statement
- WHEN `extract(scope)` runs at `full`
- THEN the routine is marked `hasDynamicSql: true` and emits NO `calls` edge to `app.fn_inner` (the name is inside the masked dynamic string)

### Requirement: pg torture fixture exercises routine-calls-routine

The committed pg torture `.sql` (`test/fixtures/pg/`) SHALL add `app.fn_wrapper` (invoking
`app.fn_inner`) and `app.fn_inner`, using NEUTRAL names. The golden-pinned `RawCatalog` and
end-to-end impact/path goldens MUST be re-blessed DELIBERATELY to include the `calls app.fn_wrapper →
app.fn_inner` edge (`confidence: 'parsed'`), with L-009 exact-set assertions pinning both endpoints,
`stubCount: 0`, and no self-reference edge.

#### Scenario: fixture adds the routine-calls-routine objects and re-blessed golden pins the parsed calls edge

- GIVEN the materialized pg torture database with `app.fn_wrapper` and `app.fn_inner`
- WHEN the adapter extracts it and the pipeline runs extract → normalize → upsert → query
- THEN the re-blessed goldens contain EXACTLY the edge `app.fn_wrapper → app.fn_inner` of kind `calls`, `confidence: 'parsed'`, with exact endpoints and `stubCount: 0`, byte-identical on re-run (ADR-008)
