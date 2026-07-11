# Verify Report: mssql-dynamic-sql-granularity

**Verdict:** ARCHIVE-READY
**Date:** 2026-07-11
**Commit verified:** ef309b2
**Gate:** `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` all green · gated live tier (`DBGRAPH_INTEGRATION=1`) GREEN (13/13 under Docker).

## Findings summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| WARNING | 0 |
| SUGGESTION | 2 |

## What shipped

`hasDynamicSql` (`src/adapters/engines/mssql/tokenizer.ts`) narrowed to string-execution forms only:
`if (/\bsp_executesql\b/i.test(body)) return true; return /\bexec(?:ute)?\s*[(@]/i.test(body);`.
A resolved-identifier `EXEC`/`EXECUTE <ident>` (already a DOG-1 `calls` edge) no longer flags — fixing the benchmark-v2 flagship FALSE POSITIVE on `usp_refresh_totals`; the full keyword `EXECUTE(@sql)` now flags — fixing a latent FALSE NEGATIVE the old `\bexec\b` missed.

## What verify reproduced first-hand

- **Pre-fix RED (isolated).** Reverted to the old regex in an isolated worktree; the enshrining unit test (`EXEC dbo.usp_other_proc` → true) and the new full-keyword/`EXECUTE(@sql)` negatives/positives failed as designed. Post-fix, the full 13-case D7 matrix is green (positives #1-#6/#11/#13, negatives #7-#10/#12).
- **Marker coverage preserved.** `sp_dynamic_search` (`sp_executesql`) STILL `has_dynamic_sql: true`; a routine doing BOTH a resolved call AND real dynamic SQL still flags. No edge added, dropped, or fabricated — `calls`/`reads_from`/`writes_to` for `usp_refresh_totals` are DOG-1-untouched.
- **Live tier GREEN.** Against the REAL materialized torture DB: `sp_dynamic_search` flagged; `usp_refresh_totals` NOT flagged (negative control).
- **Golden re-bless surgical.** `golden-raw-catalog.json` dropped exactly the one `"hasDynamicSql":true,` token on `usp_refresh_totals`; pg/mysql/sqlite/mongodb goldens, `test/golden/normalize/*.json`, `test/mcp/golden/*.txt` byte-identical.
- **Guardrail:** clean; neutral names throughout.

## Deviations (recorded)

- **D8 sweep found a SECOND co-occurrence the design inventory missed** — `test/cli/mssql.e2e.integration.test.ts` pinned `hasDynamicSql: true` on `usp_refresh_totals` as a LIVE degraded-reader assertion (~L232-248). It is NOT a frozen path (mssql e2e), so it was re-blessed to the corrected resolved-reader shape (no marker; `degradedReaders` now `[]`) and verified GREEN under Docker. Without this, `npm run test:integration` would have failed. Correctly handled during apply; recorded here for the audit trail.
- **D7 minor inaccuracy** — a line-reference in the design's test matrix drifted slightly from the actual test file; cosmetic, no functional impact.

## SUGGESTION (2) — non-blocking

1. **Residual `EXEC @rc = dbo.proc` over-flag.** Return-code capture (`@rc` then `= <ident>`) matches rule 2 (`EXEC` + `@`) and flags conservatively though it is a call. Rare, absent from the fixture, deliberately accepted (design D4) and pinned as known case #13. A future hardening change could add an assignment lookahead.
2. **D8 file-pointer imprecision.** The design's re-bless inventory line-pointers drifted; refresh them if the design is ever revisited.

## Follow-up (validation phase, NOT part of this change)

Re-run benchmark v2 as a SEPARATE labeled run now that the offline graph no longer marks `usp_refresh_totals` as a blind spot. Expectation: the flagship `plan-blindspots-dynamic-sql` result FLIPS WITH-agent from 66.7% (wrong: false positive) to 100%. This is the validation phase that confirms the fix's consumer-facing payoff.
