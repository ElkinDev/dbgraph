# Design: MSSQL dynamic-SQL marker granularity

## Technical Approach

One production function changes: `hasDynamicSql` in `src/adapters/engines/mssql/tokenizer.ts:55-57`.
Everything downstream is unchanged — `map.ts:715` already stamps `hasDynamicSql: true` only when the
tokenizer returns true (`...(dynamic ? { hasDynamicSql: true } : {})`), and `calls` edges are sourced
from the CATALOG (`sys.sql_expression_dependencies` + `ref_object_type`, DOG-1), NOT from this regex. So
narrowing the regex removes the false positive on `usp_refresh_totals` while leaving its `calls`/`writes_to`
edges intact. Zero new dependency, zero traversal, zero catalog query (ADR-007, ADR-004 respected — the
change is entirely inside the mssql adapter).

## Current behaviour (verified against code)

```ts
// src/adapters/engines/mssql/tokenizer.ts:55-57  (CURRENT)
export function hasDynamicSql(body: string): boolean {
  return /\b(exec|sp_executesql)\b/i.test(body);
}
```

`\bexec\b` matches the standalone abbreviation `EXEC`. Consequences:
- `EXEC dbo.usp_log_change` → matches → `true`. FALSE POSITIVE — this is a resolved `calls` edge (DOG-1),
  not a blind spot. This is the benchmark-v2 loss (docs/benchmarks.md:339,344-356).
- `EXEC('...')`, `EXEC (@sql)` → matches → `true`. Correct.
- `sp_executesql` → matches → `true`. Correct.
- `EXECUTE dbo.proc`, `EXECUTE(@sql)` → `\bexec\b` does NOT match (word boundary FAILS between `exec` and
  `ute`, so the full keyword `EXECUTE` never matches the `exec` alternative). So a genuine
  `EXECUTE(@sql)` dynamic today produces `false` unless `sp_executesql` is also present — a LATENT FALSE
  NEGATIVE. The fix closes this too.

## The precise fix rule (D1)

`has_dynamic_sql` is `true` iff the body contains a STRING-EXECUTION form:

1. `sp_executesql` (word boundary, case-insensitive) — always dynamic; OR
2. `EXEC` or `EXECUTE` (keyword) immediately followed, after optional whitespace, by `(` or `@` — a
   parenthesized string (`EXEC('...')`, `EXECUTE (@sql)`) or a string variable (`EXEC @sql`).

It is `false` (absent) when:
- `EXEC`/`EXECUTE` is followed by an identifier operand — bracketed/quoted or bare
  (`EXEC dbo.usp_log_change`, `EXECUTE [dbo].[proc]`) → a RESOLVED CALL (already a `calls` edge); OR
- no `sp_executesql` and no `EXEC`/`EXECUTE (`/`@` form appears.

```ts
// src/adapters/engines/mssql/tokenizer.ts  (PROPOSED)
export function hasDynamicSql(body: string): boolean {
  // sp_executesql is always dynamic.
  if (/\bsp_executesql\b/i.test(body)) return true;
  // EXEC/EXECUTE of a STRING EXPRESSION: followed by '(' (parenthesized string) or
  // '@' (string variable). A bare `EXEC <identifier>` is a RESOLVED CALL (DOG-1 `calls`
  // edge, catalog-sourced), NOT dynamic SQL, so it MUST NOT match.
  return /\bexec(?:ute)?\s*[(@]/i.test(body);
}
```

Why this exact form (D2):
- `exec(?:ute)?` covers BOTH the abbreviation and the full keyword (fixes the latent false negative on
  `EXECUTE(@sql)`).
- `\s*[(@]` is the DISCRIMINATOR: a routine name starts with a word char or `[`/`"` — never `(` or `@` —
  so an identifier operand cannot match, while a string/variable operand always does.
- `sp_executesql` is checked separately (a bracketed `_` gives no `\b` before `exec`, so the operand
  regex would not catch `EXEC sp_executesql`; the dedicated check does — and `EXEC sp_executesql @sql`
  is dynamic regardless).
- Keeps ADR-007: conservative regex, NOT a T-SQL grammar. No control-flow, no variable resolution.

## Verification of the rule against the discriminating fixtures (D3)

| Body (from `test/fixtures/mssql/torture.sql`) | Current | New | Correct? |
|---|---|---|---|
| `sp_dynamic_search`: `EXEC sp_executesql @sql` (L199-210) | true | **true** | ✓ true positive kept |
| `usp_refresh_totals`: `UPDATE ...; EXEC dbo.usp_log_change @order_id, N'refreshed'` (L253-265) | true | **false** | ✓ false positive removed |

The two torture routines are the EXACT discriminating pair; no new torture DDL is needed.

## Residual conservative false positive (D4 — documented, accepted)

`EXEC @rc = dbo.proc` (return-code capture: `@rc` then `= <identifier>`) matches rule 2 (`EXEC` + `@`) and
would flag as dynamic even though it is a call. This is:
- RARE (return-code capture is uncommon in scoped routines),
- CONSERVATIVE (US-007 honesty errs toward flagging — a false positive on the flag is far less harmful
  than a false NEGATIVE that hides a real blind spot),
- ABSENT from the torture fixture (no golden churn).

Eliminating it would require an assignment lookahead (`@\w+\s*=`), which edges toward grammar (ADR-007).
DECISION: accept and document the residual; do NOT add lookahead in this change. A negative-control unit
test MAY pin the residual as a KNOWN (flagged) case so a future hardening change has a home.

## Why this is MSSQL-only (D5 — cross-engine audit, verified against fixtures)

| Engine | `hasDynamicSql` today | Calls syntax (not flagged) | Dynamic syntax (flagged) | Overloaded? |
|--------|----------------------|----------------------------|--------------------------|-------------|
| mssql (`tokenizer.ts:55`) | `\b(exec|sp_executesql)\b` | `EXEC <ident>` | `sp_executesql`, `EXEC(@sql)` | **YES** |
| pg (`pg/tokenizer.ts:82`) | strip `EXECUTE FUNCTION/PROCEDURE` → bare `\bEXECUTE\b` | `SELECT fn()`, `PERFORM fn()`, `CALL proc()` | `EXECUTE 'sql'` / `EXECUTE format(...)` | No |
| mysql (`mysql/tokenizer.ts:81`) | `\b(prepare|execute)\b` | `CALL proc()` | `PREPARE`/`EXECUTE stmt` | No |
| sqlite (`sqlite/tokenizer.ts`) | none (no dynamic statement form) | n/a | n/a | n/a |

Fixture evidence:
- pg `test/fixtures/pg/torture.sql`: `fn_wrapper` reads `fn_inner()` via `SELECT` (DOG-1 calls pair,
  L206-208) → NOT flagged; `trg_audit_order_update` uses `EXECUTE FUNCTION app.audit_fn()` (L234) → the
  trigger-DDL clause already stripped by `hasPgDynamicSql`. pg's `EXECUTE` in a plpgsql body is
  exclusively dynamic. **NOT affected.**
- mysql `test/fixtures/mysql/torture.sql`: `proc_orchestrate` does `CALL app.proc_step()` (DOG-1 calls
  pair, L156-167) → NOT flagged; `proc_dynamic_query` does `PREPARE/EXECUTE` (L145-152) → flagged. mysql's
  `EXECUTE`/`PREPARE` are exclusively dynamic. **NOT affected.**

Only T-SQL overloads `EXEC`/`EXECUTE` for both a resolved call and a string execution. So the fix and the
spec delta are `mssql-extraction` ONLY. pg/mysql/sqlite tokenizers and specs are UNTOUCHED.

## Where the meaning is canonically pinned (D6)

- DETECTION (what makes a module dynamic) → `openspec/specs/mssql-extraction/spec.md` requirement
  "Dynamic SQL is flagged, never guessed" (lines ~255-275). THIS is the only spec that changes (MODIFIED).
- MARKER presentation (`[DYNAMIC SQL]`) → `openspec/specs/mcp-server/spec.md` (DOG-4). The marker's MEANING
  ("payload `hasDynamicSql === true`") is UNCHANGED; only upstream accuracy improves. NO mcp-server delta.
- There is NO `openspec/specs/graph-model/` spec; `hasDynamicSql`'s field meaning is pinned by extraction.

## L-009 test matrix (D7 — the discriminating cases)

Unit `test/adapters/engines/mssql/tokenizer.test.ts` — exact-boolean assertions, positives AND negatives:

| # | Input body | Expect | Note |
|---|-----------|--------|------|
| 1 | `EXEC sp_executesql @sql` | `true` | true positive (kept) |
| 2 | `EXEC('SELECT * FROM ' + @t)` | `true` | string expr (paren) |
| 3 | `EXEC (@sql)` | `true` | variable in paren |
| 4 | `EXEC @sql` | `true` | bare string variable |
| 5 | `EXECUTE(@sql)` | `true` | full keyword + paren (was false today) |
| 6 | `EXECUTE @sql` | `true` | full keyword + variable |
| 7 | `EXEC dbo.usp_log_change @id, N'x'` | `false` | **RE-BLESS** of the "EXEC alone detected" test |
| 8 | `EXECUTE dbo.proc` | `false` | full-keyword resolved call |
| 9 | `EXEC [dbo].[proc]` | `false` | bracketed resolved call |
| 10 | `UPDATE dbo.order_totals ...; EXEC dbo.usp_log_change ...` | `false` | the `usp_refresh_totals` body shape |
| 11 | `EXEC dbo.usp_log_change; EXEC(@sql)` | `true` | BOTH call AND dynamic → flags |
| 12 | `SELECT order_id FROM dbo.orders` | `false` | no exec at all (negative) |
| 13 | `EXEC @rc = dbo.proc` | `true` | residual (D4) — KNOWN conservative over-flag, pinned |

Test #7 is the CURRENT test at `tokenizer.test.ts:134-137` (`EXEC dbo.usp_other_proc` → expects `true`).
It ENSHRINES the bug — it MUST flip to `false` and be renamed (e.g. "bare EXEC of a resolved routine is a
call, not dynamic"). Under STRICT TDD this is a RED→GREEN: write #7 (and #2-#13) failing first, then the
regex fix makes them green.

## Re-bless inventory (D8 — exhaustive)

1. **Unit** `test/adapters/engines/mssql/tokenizer.test.ts` — flip + rename test #7; add tests #2-#6, #8-#13.
2. **Golden** `test/fixtures/mssql/golden/golden-raw-catalog.json` — REMOVE `"hasDynamicSql":true,` from
   the `usp_refresh_totals` object ONLY. Verified current bytes:
   `...}],"hasDynamicSql":true,"kind":"procedure","name":"usp_refresh_totals",...` → drop the
   `"hasDynamicSql":true,` token. `sp_dynamic_search` (`..."hasDynamicSql":true,...,"name":"sp_dynamic_search"...`)
   is UNCHANGED. This golden is consumed by `extract.integration.test.ts` (byte-compare).
3. **Live-tier** `test/adapters/engines/mssql/extract.integration.test.ts` — KEEP the existing
   `sp_dynamic_search hasDynamicSql=true` assertion (L263-269, stays green). ADD a NEGATIVE control:
   `usp_refresh_totals` has `hasDynamicSql` absent/falsy against the REAL torture DB.
4. **Sweep** — grep every golden/e2e/normalize file for the co-occurrence of `usp_refresh_totals` and
   `hasDynamicSql` (and any other resolved-call-only routine) and re-bless any that embed the false flag.
   Known co-occurrence today: only `golden-raw-catalog.json`. The DOG-1 impact/path goldens pin EDGES,
   not the node payload flag; confirm they stay byte-identical.
5. **FROZEN — HARD STOP (must stay byte-identical):** pg / mysql / sqlite / mongodb
   `golden-raw-catalog.json`; `test/golden/normalize/*.json` (SQLite-backed, no dynamic SQL);
   `test/mcp/golden/*.txt` (SQLite-backed). None reference the mssql tokenizer.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit (tokenizer) | the D7 matrix (13 cases) | pure, no DB — exact boolean vs each body |
| Golden (integration) | mssql raw-catalog byte-identical except the one removed flag | `extract.integration` byte-compare, re-blessed |
| Live (Docker, gated) | `sp_dynamic_search` flagged; `usp_refresh_totals` NOT flagged on the real DB | add negative control to `extract.integration.test.ts`; gated `DBGRAPH_INTEGRATION=1` |

The DETERMINISTIC contract lives in the pure unit matrix; the live tier proves the adapter→golden
round-trip on the real materialized torture schema.

## Batching

**ONE batch (XS).** One production function, one unit test file, one golden re-bless, one live negative
control, one spec delta. No cross-file ripple (map.ts and normalize are unchanged).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regress `sp_dynamic_search` true positive | Low | `sp_executesql` branch kept; matrix #1 + live assertion green |
| False negative on real `EXECUTE(@sql)` | Low→removed | new rule ADDS full-keyword coverage the old regex missed |
| Another golden embeds the false flag | Low | D8 sweep before re-bless |
| Residual `EXEC @rc = proc` over-flag | Low | documented (D4), pinned as known case #13, conservative-by-choice |

## Open Questions

- [ ] None blocking. The residual (D4) is a deliberate, documented accept; the exact regex, the
      discriminating fixtures, and the re-bless inventory are all pinned above.

## Non-goals (restated for apply/verify)

- Re-running benchmark v2 — a SEPARATE labeled follow-up run AFTER ship; it is the validation expected to
  flip `plan-blindspots` WITH from 0% to 100%. Do NOT run it here.
- pg/mysql changes; npx/interop/config/docs (sibling changes); full T-SQL parsing (still DEFERRED).
