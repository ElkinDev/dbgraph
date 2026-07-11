# Tasks: MSSQL dynamic-SQL marker granularity

> Standing instructions (apply to EVERY task)
> - STRICT TDD (config `strict_tdd: true`): write the FAILING test FIRST (RED → GREEN → REFACTOR) for the
>   change under `src/**`. The task `Done:` gate must pass before moving on.
> - L-009: assert EXACT booleans and EXACT sets, POSITIVE and NEGATIVE. Golden re-bless is DELIBERATE and
>   surgical — only the false flag is removed; every other byte stays identical (ADR-008).
> - The fix is a NODE-attribute detection change: it MUST NEVER add, drop, or fabricate an edge/target.
>   `calls`/`reads_from`/`writes_to` edges for `usp_refresh_totals` are UNCHANGED (DOG-1 untouched).
> - Scope guard: ONLY `src/adapters/engines/mssql/tokenizer.ts` changes in `src/`. pg/mysql/sqlite
>   tokenizers, `map.ts`, normalize, and all non-mssql goldens stay BYTE-IDENTICAL.
> - Legal guardrail: NEUTRAL names only; no validation-database codename in any test, fixture, or doc.
> - English everywhere. ONE conventional commit at the gate. Branch stays local — NO push, ever.

Single batch (XS-size). Fix one function, re-bless the enshrining test + one golden, add a live negative
control. Reference: design §D1 (rule), §D7 (matrix), §D8 (re-bless inventory).

### Spec scenario index (mssql-extraction delta)

- **S1** sp_executesql flagged (true positive kept) · **S2** bare EXEC of resolved routine NOT flagged
  (the benchmark-v2 false positive removed) · **S3** EXEC/EXECUTE of a string expression IS flagged ·
  **S4** BOTH call + dynamic still flags · **S5** DEFERRED limitation restated · **S6** re-blessed golden
  drops only the false flag, byte-identical otherwise · **S7** sibling-engine goldens untouched.

---

## Phase 1: Narrow the detection (RED → GREEN)

- [x] 1.1 RED — `test/adapters/engines/mssql/tokenizer.test.ts`: rewrite the `hasDynamicSql` describe block
  to the design §D7 matrix (13 cases). Specifically:
  - FLIP + RENAME the current "EXEC alone detected" test (`tokenizer.test.ts:134-137`,
    `EXEC dbo.usp_other_proc` → `true`) to expect `false`, renamed e.g. "bare EXEC of a resolved routine
    is a call, not dynamic" (matrix #7).
  - ADD positives: `EXEC('...')` (#2), `EXEC (@sql)` (#3), `EXEC @sql` (#4), `EXECUTE(@sql)` (#5),
    `EXECUTE @sql` (#6), and BOTH-forms `EXEC dbo.usp_log_change; EXEC(@sql)` (#11) → all `true`.
  - ADD negatives: `EXECUTE dbo.proc` (#8), `EXEC [dbo].[proc]` (#9), the `usp_refresh_totals` body shape
    `UPDATE dbo.order_totals ...; EXEC dbo.usp_log_change @order_id, N'refreshed'` (#10),
    `SELECT ... FROM dbo.orders` (#12) → all `false`.
  - KEEP `EXEC sp_executesql @sql` → `true` (#1) and the case-insensitive `exec sp_executesql` case.
  - PIN the residual `EXEC @rc = dbo.proc` → `true` (#13) as a KNOWN conservative over-flag (design §D4),
    with a comment marking it a documented residual.
  Confirm the suite is RED (the flipped #7 and new #5/#6/#8/#9/#10 fail on the current regex).
  Done: `npm test -- mssql/tokenizer` shows the expected failures.

- [x] 1.2 GREEN — `src/adapters/engines/mssql/tokenizer.ts:55-57`: replace `hasDynamicSql` with the design
  §D1 form:
  ```ts
  export function hasDynamicSql(body: string): boolean {
    if (/\bsp_executesql\b/i.test(body)) return true;
    return /\bexec(?:ute)?\s*[(@]/i.test(body);
  }
  ```
  Update the function's doc comment (and the file header note at :44-57) to state the new rule: a bare
  `EXEC`/`EXECUTE <identifier>` is a RESOLVED CALL (DOG-1 `calls` edge), NOT dynamic; only `sp_executesql`
  and `EXEC`/`EXECUTE (`/`@` string-execution forms flag. Do NOT touch `tokenizeModuleDeps` — the
  `calls`/read/write classification is unchanged. Satisfies S1/S2/S3/S4/S5.
  Done: `npm test -- mssql/tokenizer` all green.

## Phase 2: Re-bless the golden + live negative control

- [x] 2.1 RED-by-golden — `test/fixtures/mssql/golden/golden-raw-catalog.json`: after 1.2, the
  `extract.integration` byte-compare will fail on `usp_refresh_totals` (it still carries the flag).
  Re-bless DELIBERATELY: remove the `"hasDynamicSql":true,` token from the `usp_refresh_totals` object
  ONLY (design §D8 item 2). Confirm `sp_dynamic_search` STILL carries `"hasDynamicSql":true`. Every other
  byte unchanged. Satisfies S6.
  Done: `git diff` on the golden shows exactly ONE removed token on the `usp_refresh_totals` object.

- [x] 2.2 Sweep — grep ALL goldens/e2e/normalize outputs for co-occurrence of `usp_refresh_totals`
  (and any other resolved-call-only routine) with `hasDynamicSql`; re-bless any that embed the false flag
  (design §D8 item 4). Confirm the DOG-1 impact/path goldens (edge-only) stay byte-identical. Confirm pg /
  mysql / sqlite / mongodb `golden-raw-catalog.json`, `test/golden/normalize/*.json`, and
  `test/mcp/golden/*.txt` are BYTE-IDENTICAL (HARD STOP — design §D8 item 5). Satisfies S7.
  Done: `git diff --stat` touches ONLY the mssql golden(s); every frozen path is empty.
  NOTE (sweep finding — deviation from design §D8): the sweep found a SECOND co-occurrence the D8
  inventory missed — `test/cli/mssql.e2e.integration.test.ts` pinned `hasDynamicSql: true` on
  `usp_refresh_totals` as a LIVE (Docker) positive degraded-reader assertion (lines ~232-248). It
  is NOT a frozen path (mssql e2e, not pg/mysql/sqlite/mongodb/normalize/mcp), so it was re-blessed
  to the corrected 3-key resolved-reader shape (no marker; `degradedReaders` now `[]`). Verified
  GREEN under Docker (13/13). Without this, `npm run test:integration` would have failed.

- [x] 2.3 Live negative control — `test/adapters/engines/mssql/extract.integration.test.ts`: KEEP the
  existing `sp_dynamic_search is marked hasDynamicSql = true` test (L263-269). ADD a test asserting
  `dbo.usp_refresh_totals` has `hasDynamicSql` absent/falsy against the REAL materialized torture DB
  (proves the fix end-to-end at the live tier). Gated by `DBGRAPH_INTEGRATION=1`. Satisfies S2 (live).
  Done: `DBGRAPH_INTEGRATION=1 npm run test:integration -- mssql/extract` green where Docker is available;
  skipped-with-reason otherwise.

## Phase 3: Gate + commit

- [x] 3.1 Gate: `npx tsc --noEmit` clean; `npm run lint` 0 errors / 0 warnings; `npm test` all green.
  HARD STOP — `git diff` shows ZERO change to pg/mysql/sqlite/mongodb goldens, `test/golden/normalize/*.json`,
  `test/mcp/golden/*.txt`, and to `map.ts`/normalize; the ONLY `src/` change is `mssql/tokenizer.ts`; the
  ONLY golden change is the removed `usp_refresh_totals` flag. Then ONE conventional commit
  (e.g. `fix(mssql): exclude resolved-identifier EXEC from hasDynamicSql`). NO push.

---

## Definition of Done

- [x] All 7 spec scenarios covered (S1-S7), each POSITIVE and NEGATIVE where applicable (L-009).
- [x] `usp_refresh_totals` (bare `EXEC` only) → `hasDynamicSql` absent/false; `sp_dynamic_search`
      (`sp_executesql`) → `hasDynamicSql: true`; a routine doing BOTH → still flags.
- [x] `EXEC(@sql)` / `EXECUTE @sql` / `EXECUTE(@sql)` → flag (full keyword now covered);
      `EXEC`/`EXECUTE dbo.proc` / `EXEC [dbo].[proc]` → no flag.
- [x] The enshrining unit test flipped + renamed; the D7 matrix (13 cases incl. the documented residual
      #13) is green.
- [x] mssql raw-catalog golden re-blessed surgically (one token removed); pg/mysql/sqlite/mongodb goldens,
      normalize goldens, and mcp goldens BYTE-IDENTICAL.
- [x] `calls`/`reads_from`/`writes_to` edges for `usp_refresh_totals` UNCHANGED (DOG-1 untouched); ZERO
      fabricated or dropped edges.
- [x] Live negative control added (`usp_refresh_totals` not flagged) alongside the kept `sp_dynamic_search`
      positive.
- [x] Gate green (tsc clean / lint 0-0 / npm test all green); exactly ONE conventional commit; NOT pushed.
- [x] Only the change folder + the files in design §D8 (plus the swept `test/cli/mssql.e2e.integration.test.ts`)
      touched; no other `openspec/` spec modified.

## Follow-up (NOT a task here)

- Re-run benchmark v2 as a SEPARATE labeled run AFTER this ships. Expectation: `plan-blindspots` WITH flips
  from 0% (1/1 wrong) to 100% because dbgraph's offline graph no longer marks `usp_refresh_totals` as a
  blind spot (docs/benchmarks.md:339,355-356; `benchmark/planning-keys/plan-blindspots-dynamic-sql.json`
  key is `["sp_dynamic_search"]`).
