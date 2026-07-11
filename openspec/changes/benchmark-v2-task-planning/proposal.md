# Proposal: Benchmark v2 — Task-Planning Decision-Quality Measurement

## Intent

Runs 1–3 score FACTUAL LOOKUP only; the scorer throws on any unknown family
(`benchmark/scorer/index.ts:150-172`) and every ground-truth key is MECHANICALLY derived from
dbgraph itself (`benchmark/generate.ts:493-514`). The impact family shows the trap this creates:
its key IS dbgraph's own `affected` output, so a WITH agent scores best by REPEATING the tool
(docs/benchmarks.md:106-112, 184-192). None of this answers the user's driving case — does an agent
WITH dbgraph context make measurably better DECISIONS when PLANNING a change to a large stored
procedure? v2 measures decidable sub-facts of that plan on the mssql torture fixture, which already
carries the whole SP story (calls chains, dynamic SQL, FK precedence) that SQLite cannot.

Success = a new, honestly-scoped labeled run whose keys are HAND-PLANTED and DDL-audited, so a WITH
win reflects DECISION quality on statically-decidable facts — not tool-copying.

## Scope

### In Scope
- Three per-field closed-form planning families on the mssql torture fixture (Docker-gated), scored
  by the EXISTING blind scorer / aggregate / coverage / promptSha256 machinery.
- Anti-circularity contract: committed, human-audited key files with `source_ddl_ref`; `generate.ts`
  READS them for these families instead of querying the store.
- A new valid-topological-order comparator for `plan-order`.
- A declared "reproducible-with-Docker" substrate tier + a substrate dimension in generate/build-packets.

### Out of Scope (non-goals)
- No rubric / LLM-judge / prose-quality scoring — plan QUALITY stays unscored.
- No change to the FROZEN SQLite Runs 1–3 (question set, N, keys, tables untouched).
- No 2000-line body padding (a padded-body variant is a later labeled run).
- No dynamic radius beyond statically-decidable facts.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `benchmark`: methodology extended for decision-quality planning families (hand-planted GT carve-out,
  topo-order rule, Docker substrate tier, coverage + limitations deltas).

## Approach — the three scenarios

| Scenario | Family | Decision tested | Scoring | Planted key (source_ddl_ref) | Circularity regime |
|----------|--------|-----------------|---------|------------------------------|--------------------|
| plan-callers | `plan-callers` | Which callers break on a signature change to `usp_refresh_totals` | set-match | `{usp_refresh_totals}` from the EXEC site (torture.sql:253-265) | dbgraph `calls`/`affected` KNOWN-COMPLETE here; key is DDL-planted not tool-derived → tests USING correct facts, low anti-circularity |
| plan-blindspots | `plan-blindspots` | Recognizing that `sp_dynamic_search`'s `sp_executesql` reference to `orders` is invisible to static edges | set-match | `{sp_dynamic_search}` (torture.sql:199-210) | FLAGSHIP — regime where dbgraph's own `affected` is KNOWN-INCOMPLETE (dynamic SQL); measures KNOWING-YOUR-BLIND-SPOTS, the opposite of tool-copying |
| plan-order | `plan-order` | A valid drop/recreate order over planted precedence pairs | NEW valid-topological-order comparator | linearization of FK chain `order_items→orders/products→regions` (:53-79) + `fn_net_amount→fn_round_money` (:225-239) + `usp_refresh_totals→usp_log_change` (:263) | precedence pairs known-complete; DECISION is composing ANY valid linearization — no single canonical order |

## Affected Areas — harness blast radius (5 modules)

| Module | Impact | Change |
|--------|--------|--------|
| `benchmark/generate.ts` | Modified | 3 per-field emitters; READ committed planning key instead of store; substrate dimension |
| `benchmark/scorer/index.ts` | Modified | register 3 families in `Family` (:13-19), `FAMILIES` (:22-29), `scoreAnswer` switch (:154-166) |
| `benchmark/scorer/families.ts` | Modified | 3 pure comparators incl. the new topo-order validator |
| `benchmark/build-packets.ts` | Modified | coverage targets for 3 families; substrate dimension |
| `benchmark/render.ts` | Modified | render substrate-labeled v2 table |

`score.ts` (aggregate + promptSha256) is family-generic and needs NO edit — it picks up the new
families once registered.

## Spec delta list (`benchmark` capability)

1. **Req-2 carve-out** ("mechanically derived GT"): add an EXCEPTION — plan-* keys are HAND-PLANTED,
   human-audited, committed with `source_ddl_ref`, NEVER from `affected`/`getImpact`; `generate.ts`
   reads them. New scenario: verify can grep each key against the cited DDL lines.
2. **New topo-order scoring rule** ("deterministic/blind scoring"): add a THIRD pinned rule beside
   exact-match and set-match — valid-topological-order (respects all planted precedence pairs).
3. **Substrate tier** ("reproducible-first, dual substrate"): declare a MIDDLE "reproducible-with-Docker"
   tier (mssql torture fixture) above the private-graph secondary; v2 is its own pre-registered set.
4. **Multiple-runs delta**: v2 is a distinct labeled run on a NEW substrate/question-set; SQLite Runs
   1–3 stay frozen and labeled with their N.
5. **Coverage delta**: extend the target-derivation table with plan-callers / plan-blindspots /
   plan-order rows (kind-agnostic name match, since targets are routines).
6. **Limitations delta**: add plan-quality-unscored, format-prompting bias, hand-planted-key judgment
   risk (mitigated by source_ddl_ref audit), statically-decidable radius, Docker tier — plus standing
   self-run / single-model / small-N.

## Pre-declared limitations

Plan QUALITY unscored (only decidable sub-facts); format-prompting bias (`blind_spots[]` prompts both
sides); hand-planted-key judgment risk (mitigated by DDL audit); statically-decidable radius only;
Docker-tier reproducibility; single-model / self-run / small-N standing limits.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Hand-planted key encodes author bias | Med | `source_ddl_ref` on every target; verify audits each key line by grep |
| `blind_spots[]` prompt format leaks the answer shape | Med | Identical framing both conditions; declared as a limitation |
| Docker unavailability blocks the run | Med | Substrate is a declared tier; run SKIPS honestly, never fabricated |
| Topo-comparator wrongly rejects a valid order | Low | Pinned pairwise-precedence rule + unit tests before any run |

## Rollback Plan

Delete `openspec/changes/benchmark-v2-task-planning/` and any committed `benchmark/keys/plan-*`
files; v2 is purely additive — Runs 1–3, the frozen SQLite set, and `score.ts` are untouched, so
removal restores the exact prior state.

## Dependencies

- Docker + the existing mssql fixture harness (`test/fixtures/mssql/container.ts`, `torture.sql`).

## Size verdict

**S** (validated; explore said XS–S). Family registration and `score.ts` reuse are trivial, but the
NOVEL topological-order comparator (own test matrix), the committed-key read path, and the genuinely
new mssql/Docker substrate dimension in generate/build-packets push it past XS.

## Open questions (for spec + design)

1. Key-file format and location — one file per family or one per qid; how `source_ddl_ref` cites lines.
2. Exact `plan-blindspots` answer shape — `blind_spots[]` set vs a boolean-per-object, given the
   format-prompting-bias concern.
3. Topo-order comparator input contract — pairwise precedence set vs adjacency list; tie handling.
4. Substrate dimension representation in packets/manifest/aggregate (new field vs run-id convention).
5. Spec-citation re-anchor: mandate cited `spec.md:320-322` for the impact circularity, but current
   canonical spec puts that at line 53 — spec phase should re-anchor.

## Success Criteria

- [ ] Three planning families register and score through the UNCHANGED blind scorer.
- [ ] Every planning key is committed, DDL-audited, and NEVER store-derived.
- [ ] `plan-order` accepts every valid linearization and rejects precedence violations.
- [ ] v2 lands as a Docker-tier labeled run; Runs 1–3 remain byte-frozen.
- [ ] All six pre-declared limitations travel with the v2 results.
