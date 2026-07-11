# Proposal: MSSQL Dynamic-SQL Flag — Strip Comments Before Detection

> **PLANNING — proposal only.** No specs/design/tasks yet; a future cycle runs the full pipeline.
> Small bug: `has_dynamic_sql` false-positives on comment content.

## Intent

`hasDynamicSql` (`tokenizer.ts:69-76`) runs its detection regexes directly on the RAW module body with no comment
stripping. Both `/\bsp_executesql\b/i` and `/\bexec(?:ute)?\s*[(@]/i` match text inside `--` line comments and
`/* */` block comments. A module whose only string-execution token appears INSIDE a comment is therefore falsely
flagged `has_dynamic_sql: true` — declaring a blindness the module does not actually have and (per the spec's
honesty contract) suppressing edges that should exist.

**Verified live (out-of-repo):** a stored procedure whose sole string-execution occurrence sat in a comment block
was flagged. Across the live database **278** modules carried the dynamic flag; an unknown fraction are
comment-driven false positives.

## Scope

### In Scope
- Strip `--` line comments and `/* */` block comments (T-SQL block comments NEST) from the body before the
  dynamic-SQL regexes run.
- Preserve comment markers that appear inside string literals (`'...'`) — the classic pitfall.
- Re-bless affected goldens; extend the L-009 dynamic-SQL matrix with comment cases.

### Out of Scope (non-goals)
- Reworking read/write classification (only the dynamic-SQL gate consumes the stripped text; classification already
  operates on the target canonical name, not free body text).
- A full T-SQL lexer — ADR-007 stands; a conservative comment/string scanner only.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None.

### Modified Capabilities
- `mssql-extraction`: the "Dynamic SQL is flagged, never guessed" requirement gains a rule — comment and
  string-literal content MUST NOT trigger the dynamic-SQL flag.

**Affected canonical specs:** `openspec/specs/mssql-extraction/spec.md`.

## Approach

A small, conservative pre-pass strips comments while respecting string literals and nested `/* */` blocks; then
`hasDynamicSql` tests the stripped text. The same hazard exists for any body-scanning engine, so the stripper is a
candidate for `src/adapters/engines/_shared/tokenizer-core.ts` (design decides shared vs mssql-local). Pure
function, table-driven tests.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/mssql/tokenizer.ts` | Modified | `hasDynamicSql` runs on a comment-stripped body |
| `src/adapters/engines/_shared/tokenizer-core.ts` | Modified (maybe) | Shared comment/string-aware stripper |
| `openspec/specs/mssql-extraction/spec.md` | Modified | Scenario: comment-only EXEC not flagged; string-literal marker safe |
| goldens / fixtures | Modified | Re-bless affected dynamic-flag goldens |

## Size Estimate

**XS–S** — one focused function plus a shared stripper, scenarios and goldens. The nesting/string pitfalls are the
only real complexity.

## Open Questions (for design)

- Shared (`tokenizer-core`) vs mssql-local stripper? PG/MySQL bodies carry the same hazard.
- **ADJACENT (verify):** the current `@` branch (introduced by archived `mssql-dynamic-sql-granularity`,
  2026-07-11, to catch `EXECUTE @sql`) also matches the return-code-capture form `EXECUTE @rc = <routine>` — a
  RESOLVED call, not dynamic SQL — in LIVE code, not only in comments. Separate false positive to fix here or a
  follow-up? It may account for part of the 278.
- Do nested `/* /* */ */` blocks occur in practice, or is single-level stripping sufficient (with a documented limit)?

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stripper removes a real EXEC hidden by a string containing `--` | Med | String-literal-aware scan; table tests for marker-in-string |
| Nested block comments mishandled | Med | Depth counter; tests for nested cases; document any cap |
| Golden churn hides a real regression | Low | Re-bless only comment-affected goldens; diff-review each |

## Rollback Plan

Revert `hasDynamicSql` to test the raw body and restore the prior goldens. No API or storage change.

## Dependencies

- The L-009 dynamic-SQL matrix; existing tokenizer goldens.
- **Predecessor:** archived `mssql-dynamic-sql-granularity` (2026-07-11) produced the current
  `/\bexec(?:ute)?\s*[(@]/i` regex (declared-call vs EXEC-string). This change is complementary — it adds
  comment/string-literal stripping, which the granularity change did not address.

## Success Criteria

- [ ] A module whose only string-execution token is inside a comment is NOT flagged `has_dynamic_sql`.
- [ ] A comment marker inside a string literal does not cause a real EXEC to be missed.
- [ ] Genuine `sp_executesql` / `EXEC(@sql)` / `EXECUTE @sql` outside comments still flag.
- [ ] The L-009 matrix is extended; affected goldens are re-blessed and diff-reviewed.
