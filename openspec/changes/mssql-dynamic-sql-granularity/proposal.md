# Proposal: MSSQL dynamic-SQL marker granularity (declared-call vs EXEC-string)

## Intent

Benchmark v2 (`mssql-plan-2026-07-10`, archive `2026-07-10-benchmark-v2-task-planning`) made dbgraph
LOSE its flagship blind-spot question. On `plan-blindspots-dynamic-sql` the ground-truth blind-spot set
is `["sp_dynamic_search"]`; the WITH agent answered `sp_dynamic_search, usp_refresh_totals` — a FALSE
POSITIVE — while the WITHOUT agent (reading bodies) answered correctly. WITH scored 0% vs WITHOUT 100%
on that question (docs/benchmarks.md:321,339).

Root cause (verified in code): `hasDynamicSql` in `src/adapters/engines/mssql/tokenizer.ts:55-57` is
`/\b(exec|sp_executesql)\b/i`. `\bexec\b` matches a bare `EXEC dbo.usp_log_change` — a RESOLVED routine
call already captured as a `calls` edge by DOG-1 — exactly like true dynamic SQL (`sp_executesql`,
`EXEC(@sql)`). The marker `[DYNAMIC SQL]` therefore flags a fully-visible declared call as a blind spot.
The benchmark record itself prescribes the fix: "REFINE the DECLARED-CALL vs EXEC-string granularity so
the `[DYNAMIC SQL]` marker no longer flags a declared call as a blind spot" (docs/benchmarks.md:355-356).

## Scope

### In Scope
- Refine `mssql` `hasDynamicSql` to flag ONLY string-expression forms: `sp_executesql`, or `EXEC`/`EXECUTE`
  followed by `(` or `@`. A bare `EXEC`/`EXECUTE <identifier>` (resolved call) MUST NOT flag.
- Preserve the true positive: `sp_dynamic_search` (`sp_executesql`) STILL flags. A routine doing BOTH a
  resolved call AND real dynamic SQL STILL flags.
- Re-bless the enshrining unit test, the mssql raw-catalog golden (drop the false `hasDynamicSql` on
  `usp_refresh_totals`), and add a live-tier negative control.
- Delta the ONE spec that canonically pins detection meaning: `mssql-extraction`.

### Out of Scope
- Re-running benchmark v2 — that is a follow-up labeled run AFTER this ships; it is the validation that
  should flip the flagship result (note, not a task here).
- pg / mysql — audited NOT affected (see below). No change.
- The npx / interop / config / docs fixes — sibling changes.
- Full T-SQL grammar parsing — still DEFERRED (ADR-007).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `mssql-extraction`: the "Dynamic SQL is flagged, never guessed" requirement is refined so a
  resolved-identifier `EXEC`/`EXECUTE` (a `calls` edge) is EXCLUDED from `has_dynamic_sql`; only
  `sp_executesql` and `EXEC`/`EXECUTE (`/`@` string-execution forms flag.

## Per-engine audit (verdict)

| Engine | Calls syntax | Dynamic syntax | Overloaded? | Verdict |
|--------|--------------|----------------|-------------|---------|
| mssql | `EXEC <ident>` | `sp_executesql`, `EXEC(@sql)` | YES — `EXEC` does both | **AFFECTED — fix** |
| pg | `SELECT`/`PERFORM`/`CALL fn()` | `EXECUTE 'sql'` (trigger `EXECUTE FUNCTION` already stripped) | No | NOT affected |
| mysql | `CALL proc()` | `PREPARE`/`EXECUTE stmt` | No | NOT affected |
| sqlite | n/a | none (no `hasDynamicSql`) | n/a | N/A |

Verified against `test/fixtures/{pg,mysql}/torture.sql`: pg `fn_wrapper` SELECTs `fn_inner()` (not
flagged); mysql `proc_orchestrate` `CALL`s `proc_step()` (not flagged). Only T-SQL conflates.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/mssql/tokenizer.ts` | Modified | `hasDynamicSql` regex (~2 lines) |
| `test/adapters/engines/mssql/tokenizer.test.ts` | Modified | Re-bless "EXEC alone" + add L-009 matrix |
| `test/fixtures/mssql/golden/golden-raw-catalog.json` | Re-blessed | Drop `hasDynamicSql:true` on `usp_refresh_totals` |
| `test/adapters/engines/mssql/extract.integration.test.ts` | Modified | Add live negative control |
| `openspec/specs/mssql-extraction/spec.md` | Delta | Refine detection requirement |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regress the true positive (`sp_dynamic_search`) | Low | `sp_executesql` check kept; explicit positive test + live assertion stay green |
| Introduce a false negative on real dynamic (`EXECUTE(@sql)`) | Low | New rule ADDS `EXECUTE`+`(`/`@` (today `\bexec\b` misses the full keyword) — net honesty gain |
| Residual `EXEC @rc = dbo.proc` over-flag | Low | Rare; conservative (errs toward flag); documented in design, not in fixture |
| Other goldens embed the false flag | Low | Task sweeps all goldens for `usp_refresh_totals`+`hasDynamicSql` |

## Rollback Plan

Single-function change. Revert `hasDynamicSql` to `/\b(exec|sp_executesql)\b/i`, restore the unit test
expectation, and re-bless the golden back (re-add `hasDynamicSql:true` to `usp_refresh_totals`). One
commit to revert.

## Dependencies

- Builds on DOG-1 (`calls` edges): a bare `EXEC <ident>` is already a resolved `calls` edge, which is
  precisely why it must not ALSO be marked dynamic.

## Success Criteria

- [ ] `usp_refresh_totals` (bare `EXEC` only) → `hasDynamicSql` absent/false.
- [ ] `sp_dynamic_search` (`sp_executesql`) → `hasDynamicSql: true` (unchanged).
- [ ] A routine doing BOTH a call AND real dynamic SQL → still flags.
- [ ] `EXEC(@sql)` / `EXECUTE @sql` / `EXECUTE(@sql)` → flag; `EXEC`/`EXECUTE dbo.proc` → no flag.
- [ ] mssql raw-catalog golden re-blessed byte-exactly (only `usp_refresh_totals` flag removed).
- [ ] pg / mysql / sqlite goldens byte-identical (no change).
