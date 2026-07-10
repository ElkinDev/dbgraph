# Verification Report - dog2-routine-parameters

**Change**: dog2-routine-parameters (DOG-2 Routine Parameters, RoutinePayload.parameters)
**Repo / Branch**: C:/Users/ecardoso/dev/dbgraph @ post-v1 (4 commits ahead of origin/post-v1, NOT pushed)
**Artifact store**: openspec (files)
**Mode**: Standard verify + full Docker integration re-run (all measurements taken by the verifier)
**Verified commits**: 216d8bd (planning), fd2e5e4 (B1 extraction), b7c80b9 (B2 render + single re-bless), 5d0722e (checkboxes)

---

## Verdict: PASS

23/23 spec scenarios COMPLIANT. Gate green (tsc 0, lint 0/0, npm test 3506/3506). All three Docker-gated
engine tiers + the FOR-JSON dump tier green with live per-engine L-009 param pins. sqlite + MCP goldens
byte-identical vs 216d8bd. Single-re-bless discipline held. Zero CRITICAL, zero WARNING.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 14 (Batch 1: 1.1-1.7, Batch 2: 2.1-2.7) |
| Tasks complete | 14 |
| Tasks incomplete | 0 |
| Definition of Done | 7/7 checked |

All task checkboxes and the 7 DoD items are marked complete in tasks.md, each backed by real code + test evidence.

---

## Gate (measured by the verifier)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | exit 0 clean (strict, exactOptionalPropertyTypes) |
| Lint | npm run lint (eslint) | exit 0, 0 errors / 0 warnings |
| Unit + golden suite | npm test (vitest, integration excluded) | 219 files, 3506 passed, 0 failed, exit 0 |
| Write-verb scanner | security-scan.test.ts (in default run) | green, new param queries are catalog SELECT only |
| sqlite goldens vs 216d8bd | git diff | ZERO drift |
| MCP goldens (test/mcp/golden) vs 216d8bd | git diff | ZERO drift |
| e2e goldens (golden-e2e.json, all engines) | git diff | UNCHANGED (summaries, see Deviation 1) |
| Tree state | git status | clean before AND after all Docker runs (no golden regen) |

3506 matches the contract expected count exactly.

## Docker integration tiers (measured by the verifier, DBGRAPH_INTEGRATION=1)

Images already local: postgres:16, mysql:8, mcr.microsoft.com/mssql/server:2022-latest.

| Tier | Suite | Result | Live param pin spot-checked |
|------|-------|--------|------------------------------|
| pg | pg/e2e.integration.test.ts | 29 passed | fn_place_order NULL-modes -> 4x integer/in (PG-2); fn_wrapper/fn_inner empty (PG-1) |
| mysql | mysql/e2e.integration.test.ts | 25 passed | fn_audit_write FULL types, all in, no hasDefault (MY-2); proc_orchestrate/step empty (MY-1) |
| mssql | cli/mssql.e2e.integration.test.ts | 8 passed | routine params on payload, BARE types, exact sets (MS L-009) |
| mssql dump | mssql/strategies/queries-for-json.integration.test.ts | 14 passed | parameters family FOR JSON PATH parseable, BARE types, no Msg 1033 |

Tree remained clean after every run; integration suites use temp dirs and do NOT touch committed goldens.

---

## Spec Compliance Matrix (23 scenarios)

| Req | Scenario | Evidence | Result |
|-----|----------|----------|--------|
| GM graph-model | view carries name/type/direction/ordinal, ascending | model/parameters.test.ts + normalize/parameters.test.ts | COMPLIANT |
| GM | absent catalog leaves field UNSET | sqlite/parameters-absence.test.ts (in-operator + toBeUndefined) | COMPLIANT |
| GM | hasDefault only where sourced | model test + mssql has_default_value true/false + pg trailing + mysql omit | COMPLIANT |
| MCP-1 | mssql focus exact lines, byte-identical explore/object | parameter-render.test.ts + parameters-wiring.test.ts + goldens | COMPLIANT |
| MCP-2 | UPPERCASE OUT/INOUT/DEFAULT; in unmarked | parameters.test.ts grammar + golden txt | COMPLIANT |
| MCP-3 | detail-gated normal+full, absent brief | parameters-wiring.test.ts (explore + object) | COMPLIANT |
| MCP-4 | order follows ordinal, never re-sorted | parameters.test.ts (out-of-order to ascending) | COMPLIANT |
| MCP-5 | non-routine / UNSET to no section | parameter-render.test.ts negatives + sqlite/MCP zero-drift | COMPLIANT |
| SE-1 | adapter with catalog populates parameters | mssql/pg/mysql parameters.test.ts + 3 gated e2e tiers | COMPLIANT |
| SE-2 | no-catalog UNSET + byte-identical | sqlite absence test + sqlite/MCP goldens zero drift | COMPLIANT |
| MS-1 | usp_log_change exact (BARE int/nvarchar) | mssql parameters.test.ts + mssql e2e + raw-catalog golden | COMPLIANT |
| MS-2 | single-param + scalar fns; parameter_id=0 excluded | mssql parameters.test.ts + e2e (fn_net_amount/fn_round_money BARE decimal) | COMPLIANT |
| MS-3 | goldens re-blessed deliberately, scanner green | raw-catalog + dump re-bless (params-only) + security-scan + FOR-JSON tier | COMPLIANT |
| PG-1 | zero-arg routines parameters empty array | pg parameters.test.ts + pg e2e (fn_wrapper/fn_inner) | COMPLIANT |
| PG-2 | NULL proargmodes to all-IN | pg parameters.test.ts + pg e2e (fn_place_order 4x integer/in) | COMPLIANT |
| PG-3 | VARIADIC v to in; t EXCLUDED; contiguous ordinal | pg parameters.test.ts unit fixtures (v/t) | COMPLIANT |
| PG-4 | typmod-less dataType (numeric not numeric-10-2) | pg parameters.test.ts + raw-catalog golden (character varying, integer) | COMPLIANT |
| PG-5 | pg goldens re-blessed deliberately, scanner green | raw-catalog re-bless (params-only) + security-scan | COMPLIANT |
| MY-1 | zero-param procs empty array, no hasDefault | mysql parameters.test.ts + mysql e2e (proc_orchestrate/proc_step) | COMPLIANT |
| MY-2 | fn_audit_write ordinal-0 EXCLUDED, FULL types | mysql parameters.test.ts + mysql e2e | COMPLIANT |
| MY-3 | mysql goldens re-blessed deliberately, scanner green | raw-catalog re-bless (params-only) + security-scan | COMPLIANT |
| SQ-1 | sqlite catalog carries no parameters field | sqlite/parameters-absence.test.ts + CapabilityMatrix unchanged | COMPLIANT |
| SQ-2 | sqlite present/MCP goldens zero drift | git diff MCP + sqlite goldens byte-identical | COMPLIANT |

**Compliance summary: 23/23 scenarios COMPLIANT.**

---

## Honesty invariants (verified DIRECTLY in the re-blessed goldens, not just tests)

Word-diff of golden-raw-catalog.json (216d8bd..HEAD) shows changed bytes are EXCLUSIVELY parameters arrays:

- mssql BARE types, no precision: @order_id int, @new_status nvarchar, @gross decimal, @price decimal;
  never decimal-12-2. All direction=in; no hasDefault.
- pg typmod-less canonical regtype names: integer, character varying (NOT character varying-20); the
  argument typmod is physically absent and never fabricated. fn_wrapper/fn_inner/audit_fn carry empty arrays.
- mysql FULL DTD_IDENTIFIER: int, varchar(20). No hasDefault on any mysql param. fn_audit_write has exactly
  3 params, ordinal-0 return excluded.
- Direction markers: golden txt renders [OUT]/[INOUT]/[DEFAULT] UPPERCASE; in (@order_id) unmarked.
- hasDefault sourcing: mssql has_default_value to hasDefault true unit-pinned (with negative on non-default
  params); pg trailing pronargdefaults unit-pinned; mysql omitted entirely. No fabrication.

sqlite absence guard is a GENUINE unset assertion: filter on the parameters-key present-check to toStrictEqual empty
PLUS o.parameters toBeUndefined() for every object (the in operator distinguishes UNSET from empty array).

---

## Coherence (design D1-D6 + section 10)

| Decision | Followed? | Evidence |
|----------|-----------|----------|
| D1 per-engine natural join (mssql/mysql separate, pg extend pg_proc) | Yes | SQL_MSSQL_PARAMETERS/SQL_MYSQL_PARAMETERS separate; SQL_PG_ROUTINES extended with exact regtype text-array idiom |
| D2 first-class RawParameter, ordinal-sorted pure copy | Yes | catalog.ts/node.ts types; normalize.ts:278-279 conditional ordinal-sorted copy, no edge/inference |
| D3 ONE shared renderParameters wired into BOTH surfaces | Yes | payload.ts renderParameters; renderFocusPayload procedure/function; object.ts:107 OWN block after CONSTRAINTS before normal early-return |
| D4 no storage migration | Yes | payload opaque JSON; no schema change |
| D5 determinism + per-engine honesty | Yes | ORDER BY to normalize sort to render sort; verbatim per-engine types (verified in goldens) |
| D6 ordinal contiguous 1..N over emitted | Yes | all three maps use list length + 1 after exclusions; pg/mysql contiguity unit-pinned |
| section 10 no delta for graph-normalization/benchmark/cli-config | Yes | no spec files for those; pure payload copy via one shared helper |

---

## Evaluation of the 5 documented deviations - ALL HONEST and CORRECT

1. golden-e2e NOT re-blessed - VERIFIED. Read mssql/golden/golden-e2e.json: it is a SUMMARY
   (edgeCount, edgeKinds, firstNodes kind+qname, nodeCount, stubCount) with ZERO payloads
   (grep payload/parameters/signature/body to 0). Adding a payload field cannot change it. Parameters are
   instead pinned by DBGRAPH_INTEGRATION-gated live it() assertions (added in B1), which I ran green.
   The re-bless-golden-e2e task line was a no-op against reality; the chosen path is strictly more honest.

2. Aggregate goldens container-generated, not fixture-generated - VERIFIED. rows/parameters.json (mysql)
   uses routine names place_order/log_audit, DISTINCT from the golden routines (proc_place_order,
   proc_orchestrate, proc_step, fn_audit_write). The map-unit fixtures are dedicated (non-golden-feeding);
   the raw-catalog aggregates are regenerated from a live container. This is exactly the discipline the tasks
   demanded to keep the re-bless a single Batch-2 commit. B1 (fd2e5e4) touched ZERO fixtures (git show --stat).

3. Gated assertion placement by data availability - VERIFIED. pg/mysql zero-arg e2e assertions check
   payload parameters toBeUndefined() (post-normalize the empty array is elided), whereas the map-unit
   tier asserts RawObject.parameters toStrictEqual empty array. Both correct at their layer; placement
   honestly reflects where the empty-vs-unset distinction lives.

4. sqlcmd / manual-dump strategy wiring extension - VERIFIED and TESTED. The parameters family is registered
   in dump-emitter.ts + sqlcmd.strategy.ts CATALOG_FAMILIES/CATALOG_FAMILY_KEYS, and json-rows.ts gains
   coerceParameterRow (OPTIONAL/backward-compatible so pre-DOG-2 dumps still parse). Beyond the literal task
   but necessary: without it the manual-dump connectivity path would silently drop parameters. Proven by
   dump-emitter.test.ts (default suite) and the live FOR-JSON tier (parameters FOR JSON PATH parseable JSON,
   no Msg 1033; and BARE types) - both green.

5. mysql fixture param types partially inferred - VERIFIED HONEST. The map-unit fixture uses synthetic types
   (varchar(100)/varchar(50)) on synthetic routines, precisely to avoid conflation with the golden-feeding
   routines. The REAL types (int, varchar(20)) are sourced from the live container into the aggregate golden
   and pinned by the gated e2e assertion (fn_audit_write FULL types). The fixture only exercises the map
   verbatim DTD_IDENTIFIER passthrough + NULL-mode-to-in + ordinal logic; no fabrication reaches any output path.

---

## Adversarial checks

- Live render byte-consistency: param-render-explore-normal.txt and param-render-object-normal.txt carry the
  IDENTICAL PARAMETERS block (@order_id int / @new_status nvarchar [OUT] / @rowcount int [INOUT] /
  @amount decimal [DEFAULT]); the only difference is the explore surface trailing no-neighbors line
  (outside the section). Cross-surface byte-identity also asserted programmatically (parameters-wiring MCP-1).
- Detail gating: brief omits, normal+full emit; pinned for BOTH explore and object.
- Ordinal contiguity / ordinal-0 exclusion / pg zero-arg: pg PG-3 exact-set proves contiguity after
  t-exclusion; mysql pins ordinals 1,2 after the ordinal-0 return exclusion; pg empty arg-type-names
  yields an empty array (the string_to_array empty edge additionally confirmed by the container golden).
- Single-re-bless discipline: B1 touched no goldens; the entire re-bless is one commit (b7c80b9).
- Nothing pushed: branch is 4 commits ahead of origin, unpushed; tree clean (only this report, uncommitted).

---

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (non-blocking):
- The live-container honesty pins (per-engine e2e param sets + FOR-JSON parameters-family coexistence) run
  ONLY under DBGRAPH_INTEGRATION=1 and are excluded from the default npm test gate. This mirrors the
  established DOG-1 pattern and the map-unit + golden tiers cover the logic in default CI; the verifier
  executed all gated tiers by hand (green). No action required unless the team wants these in CI.

---

## Verdict

PASS - DOG-2 is complete, correct, and behaviorally compliant. 23/23 scenarios COMPLIANT with real test
evidence; all 5 documented deviations are honest and better-justified than the literal task text; the honesty
invariants (mssql BARE / pg typmod-less / mysql FULL / hasDefault only where sourced / UPPERCASE markers /
sqlite genuine UNSET) are verifiable directly in the re-blessed goldens; sqlite + MCP + e2e goldens show zero
drift; nothing pushed. Ready for sdd-archive.
