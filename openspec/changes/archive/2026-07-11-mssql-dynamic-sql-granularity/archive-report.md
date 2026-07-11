# Archive Report: mssql-dynamic-sql-granularity

**Change:** mssql-dynamic-sql-granularity
**Archived:** 2026-07-11
**Archive destination:** `openspec/changes/archive/2026-07-11-mssql-dynamic-sql-granularity/`
**Artifact store:** openspec (files)
**Verify verdict:** ARCHIVE-READY (0 CRITICAL / 0 WARNING / 2 SUGGESTION)
**Commit:** ef309b2

## What shipped

`hasDynamicSql` narrowed to string-exec forms only — excludes a resolved-identifier `EXEC`/`EXECUTE <ident>` (a fully-visible DOG-1 `calls` edge) from `has_dynamic_sql`; only `sp_executesql` and `EXEC`/`EXECUTE (`/`@` string executions flag. Fixes the benchmark-v2 flagship FALSE POSITIVE (`usp_refresh_totals`) AND a latent FALSE NEGATIVE (`EXECUTE(@sql)`). One production function changed; `map.ts`/normalize/`calls`-sourcing untouched.

## Traceability (artifacts, openspec paths)

| Artifact | Path (in archive) |
|----------|-------------------|
| proposal | `2026-07-11-mssql-dynamic-sql-granularity/proposal.md` |
| spec delta — mssql-extraction | `2026-07-11-mssql-dynamic-sql-granularity/specs/mssql-extraction/spec.md` |
| design | `2026-07-11-mssql-dynamic-sql-granularity/design.md` |
| tasks | `2026-07-11-mssql-dynamic-sql-granularity/tasks.md` |
| verify-report | `2026-07-11-mssql-dynamic-sql-granularity/verify-report.md` |
| archive-report | `2026-07-11-mssql-dynamic-sql-granularity/archive-report.md` |

## Canonical spec merges applied

### `openspec/specs/mssql-extraction/spec.md` — 1 MODIFIED + 1 ADDED

- **MODIFIED — Requirement "Dynamic SQL is flagged, never guessed"** — the requirement body is refined to distinguish a RESOLVED-IDENTIFIER `EXEC`/`EXECUTE` (a `calls` edge, NOT a blind spot) from a true string-execution (`sp_executesql`, `EXEC(@sql)`, `EXECUTE @sql`), with an explicit conservative rule list. Scenarios re-blessed to: sp_executesql flagged (true positive kept); bare-EXEC resolved routine NOT flagged (the benchmark-v2 false positive, with `calls`/`writes_to` edges unchanged); string-expression IS flagged (full keyword `EXECUTE` covered); BOTH call + dynamic still flags; DEFERRED-limitation restated.
- **ADDED — Requirement "mssql goldens re-blessed to drop the resolved-call false positive"** — appended as section `## Requirements Added by mssql-dynamic-sql-granularity (2026-07-11)` (2 scenarios): pins the surgical golden re-bless (drop only the false flag on `usp_refresh_totals`, keep it on `sp_dynamic_search`) and freezes the pg/mysql/sqlite/mongodb goldens byte-identical. Follows the file's established golden-rebless-requirement convention (cf. dog1/dog3 sections).

> **Coexistence note.** This MODIFIED requirement and the ADDED section sit cleanly ALONGSIDE `shipped-artifact-fixes`' 2 ADDED mssql-extraction requirements (interop-safe resolution + dist-tier verification), which were merged FIRST into this same canonical. No overlap; all coexist.
>
> **Discrepancy flagged for transparency.** The orchestrator's task summary described change 3 as "mssql-extraction (MODIFIED)" only. The verified delta artifact ALSO contains an `## ADDED Requirements` section (the golden-rebless requirement above). Being faithful to the ARCHIVE-READY delta and the repo convention, BOTH were applied.

## Deviations (from apply/verify)

- **D8 sweep found + re-blessed a 2nd co-occurrence** the design inventory missed — `test/cli/mssql.e2e.integration.test.ts` (live degraded-reader assertion) re-blessed to the corrected resolved-reader shape; GREEN under Docker.
- **D7 minor line-reference inaccuracy** in the design test matrix — cosmetic.

## Notes

- SUGGESTIONs deferred: residual `EXEC @rc=` over-flag (documented, pinned as known case #13); D8 file-pointer imprecision.
- **FOLLOW-UP (validation phase):** a labeled benchmark-v2 re-run should now FLIP the flagship `plan-blindspots-dynamic-sql` result from 66.7% → 100% (recorded as the post-ship validation, not a task in this change).

## SDD cycle

Planned → implemented (STRICT TDD) → verified (ARCHIVE-READY) → archived. Change complete.
