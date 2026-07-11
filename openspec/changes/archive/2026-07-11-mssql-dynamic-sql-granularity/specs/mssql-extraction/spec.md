# Delta for MSSQL Extraction

> Change `mssql-dynamic-sql-granularity`. Refines the `has_dynamic_sql` DETECTION so it distinguishes a
> RESOLVED-IDENTIFIER `EXEC`/`EXECUTE` (a routine call already captured as a `calls` edge — DOG-1) from a
> true dynamic-SQL string execution (`sp_executesql`, `EXEC(@sql)`, `EXECUTE @sql`). Today
> `hasDynamicSql = /\b(exec|sp_executesql)\b/i` flags a bare `EXEC dbo.usp_log_change` — a fully-visible
> declared call — as a blind spot. Benchmark v2 (`mssql-plan-2026-07-10`) surfaced this as a CONSUMER
> false positive that cost dbgraph its flagship blind-spot question: WITH answered
> `sp_dynamic_search, usp_refresh_totals` where the truth is `sp_dynamic_search` alone
> (docs/benchmarks.md:339,344-356). This delta narrows detection to string-execution forms ONLY, WITHOUT
> regressing the true positive and WITHOUT introducing a false negative. Scope is MSSQL-ONLY: pg and mysql
> keep calls (`SELECT`/`PERFORM`/`CALL`, `CALL`) syntactically distinct from dynamic
> (`EXECUTE`, `PREPARE`/`EXECUTE`) and are audited NOT affected. Stories: US-007, US-027; ADR-007.

## MODIFIED Requirements

### Requirement: Dynamic SQL is flagged, never guessed

Where a module body cannot be reliably analyzed by the conservative tokenizer — notably dynamic SQL
executed via `sp_executesql` or an `EXEC`/`EXECUTE` of a STRING EXPRESSION (`EXEC(<string>)`,
`EXEC (@sql)`, `EXECUTE @sql`) — the mssql adapter MUST mark the module `has_dynamic_sql: true` (US-007)
and MUST NOT fabricate any `reads_from`/`writes_to`/`depends_on` edge for the unanalyzable portion. This
is the honest Phase-3 boundary: full-fidelity T-SQL parsing is DEFERRED and not committed to any later
phase.

A bare `EXEC`/`EXECUTE <identifier>` whose operand is a routine name (e.g. `EXEC dbo.usp_log_change`,
`EXECUTE [dbo].[proc]`) is a RESOLVED CALL — it is already captured as a `calls` edge from the catalog
(`sys.sql_expression_dependencies`, DOG-1) and its target is fully visible. It MUST NOT, on its own,
cause `has_dynamic_sql: true`. The marker means "a dependency the STATIC graph cannot see"; a declared
call is NOT such a blind spot, and marking it as one is a false positive that misleads consumers of the
`[DYNAMIC SQL]` marker.

The distinction MUST be conservative and honest, never a full grammar:
- `sp_executesql` present → `has_dynamic_sql: true` (always).
- `EXEC`/`EXECUTE` immediately followed by `(` or `@` (a parenthesized string or a string variable) →
  `has_dynamic_sql: true`.
- `EXEC`/`EXECUTE` followed by an identifier operand (bracketed/quoted or bare) → NOT dynamic by itself.
- A module that does BOTH a resolved call AND a real dynamic-SQL execution → `has_dynamic_sql: true` (the
  presence of ANY real dynamic form flags the module, regardless of also having resolved calls).
- No `sp_executesql` and no `EXEC`/`EXECUTE (`/`@` form → `has_dynamic_sql` absent/false.

#### Scenario: Dynamic-SQL procedure via sp_executesql is flagged with no invented edges

- GIVEN the torture procedure `dbo.sp_dynamic_search` whose body builds a string and runs it via `EXEC sp_executesql @sql`
- WHEN `extract(scope)` runs at `full`
- THEN the procedure's `RawObject` is marked `has_dynamic_sql: true`
- AND NO speculative `reads_from`/`writes_to`/`depends_on` edge is fabricated for the dynamic portion

#### Scenario: Bare EXEC of a resolved routine is NOT flagged as dynamic (the benchmark-v2 false positive)

- GIVEN the torture procedure `dbo.usp_refresh_totals` whose body does `UPDATE dbo.order_totals ...` and `EXEC dbo.usp_log_change @order_id, N'refreshed'` (no `sp_executesql`, no `EXEC(...)`/`EXEC @var`)
- WHEN `extract(scope)` runs at `full`
- THEN `dbo.usp_refresh_totals` is NOT marked `has_dynamic_sql` (the key is absent / false)
- AND it STILL emits its `calls dbo.usp_log_change (declared)` and `writes_to dbo.order_totals (parsed)` edges UNCHANGED (the DOG-1 behaviour is untouched)

#### Scenario: EXEC/EXECUTE of a string expression IS flagged

- GIVEN a procedure body that runs `EXEC('SELECT ...')`, or `EXEC (@sql)`, or `EXECUTE @sql`, or `EXECUTE('SELECT ...')`
- WHEN `has_dynamic_sql` is derived from the body
- THEN it is `true` for each of those string-execution forms (the full keyword `EXECUTE` is covered, not only the `EXEC` abbreviation)

#### Scenario: A routine doing BOTH a resolved call and real dynamic SQL still flags

- GIVEN a procedure whose body contains `EXEC dbo.usp_log_change` (a resolved call) AND `EXEC(@sql)` (real dynamic SQL)
- WHEN `has_dynamic_sql` is derived
- THEN it is `true` (any real dynamic form flags the module; the presence of a resolved call does not suppress the flag)

#### Scenario: Full-fidelity parsing is an acknowledged limitation, not a hidden gap

- GIVEN the Phase-3 conservative tokenizer
- WHEN a body runs genuine dynamic SQL that cannot be resolved to definite read/write targets
- THEN the module is marked `has_dynamic_sql: true` rather than guessed
- AND full T-SQL grammar parsing is recorded as DEFERRED (not committed to any later phase)

## ADDED Requirements

### Requirement: mssql goldens re-blessed to drop the resolved-call false positive

The mssql golden-pinned `RawCatalog` (`test/fixtures/mssql/golden/golden-raw-catalog.json`) and any
end-to-end / normalize golden that embeds the routine payload MUST be re-blessed DELIBERATELY so that
`dbo.usp_refresh_totals` NO LONGER carries `has_dynamic_sql: true`, while `dbo.sp_dynamic_search` KEEPS
`has_dynamic_sql: true`. The re-bless MUST be surgical: ONLY the false `has_dynamic_sql` on
resolved-call-only routines is removed; every other byte (edges, parameters, ordering) is unchanged and
byte-identical on re-run (ADR-008). The pg, mysql, sqlite and mongodb goldens MUST be BYTE-IDENTICAL to
before this change (they are not affected). The mssql live-tier suite MUST additionally assert a NEGATIVE
control: a resolved-call-only routine (`dbo.usp_refresh_totals`) has `has_dynamic_sql` absent/false, while
`dbo.sp_dynamic_search` remains flagged — both against the REAL materialized torture database.

#### Scenario: re-blessed mssql golden drops only the false flag, byte-identical otherwise

- GIVEN the materialized mssql torture database extracted at `full`
- WHEN the `RawCatalog` is serialized via `stableStringify`
- THEN `dbo.usp_refresh_totals` carries NO `has_dynamic_sql` key and `dbo.sp_dynamic_search` carries `has_dynamic_sql: true`
- AND every other byte of the golden is unchanged and byte-identical on a second extraction (ADR-008)

#### Scenario: sibling-engine goldens are untouched

- GIVEN the pg, mysql, sqlite and mongodb golden-raw-catalog files
- WHEN this change ships
- THEN each is BYTE-IDENTICAL to before (the fix is scoped to the mssql tokenizer only)
