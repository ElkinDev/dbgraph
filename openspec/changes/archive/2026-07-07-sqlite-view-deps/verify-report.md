# Verification Report — sqlite-view-deps

**Change**: sqlite-view-deps
**Branch**: v1-prep  |  **Artifact store**: openspec
**Mode**: Strict TDD (openspec/config.yaml strict_tdd: true)
**Verifier**: sdd-verify  |  **Date**: 2026-07-06
**HEAD**: 4f0f616  |  **Baseline (planning)**: 2c599be

---

## Verdict: PASS

All 5 gates GREEN (measured), all 17 spec scenarios COMPLIANT (each proven by a passing
L-009 exact-set test), the cross-engine byte-identity invariant holds, the single-re-bless
discipline holds, questions.yaml moved exactly one note line, and the four documented
deviations are each ACCEPTED as necessary refinements or honest re-measurements.
0 CRITICAL, 0 WARNING, 2 SUGGESTION.

---

## Gate (measured by the verifier, not trusted from the report)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | exit 0 — clean, strict, no any |
| Lint | npm run lint (eslint .) | exit 0 — 0 errors / 0 warnings |
| Tests | npm test (vitest run) | 3229 passed / 3229 across 184 files, exit 0 |

Matches the expected 3229 full-green target exactly.

### Cross-engine invariant (HARD STOP surface — D4)
- git diff 2c599be..HEAD -- test/fixtures/pg test/fixtures/mssql test/fixtures/mysql -> EMPTY.
- No pg / mssql / mysql golden or fixture file appears anywhere in the 34-file changed set.
- fires-on-target.test.ts proves pg/mssql/mysql table-triggers keep byte-identical fires_on
  edge ids (edgeId comparison) after the shared buildFiresOnEdges change. Blast radius is
  SQLite-only, as designed.

### questions.yaml frozen-set guard (HARD STOP surface — spec OQ c)
- git diff shows exactly ONE line changed: the notes.view-dependency descriptive string.
- N stays pinned at 5 (familiesExcluded still lists view-dependency); no qid / prompt /
  ground-truth / structural byte moved. comment-correction.test.ts asserts version/substrate/
  perFamily/n:5, all five families, and every committed qid byte-stable.

### Single-re-bless discipline (D5)
- Every golden (golden-e2e.json, golden-raw-catalog.json, all test/mcp/golden/*) changed in
  ONLY commit b884ab6 (B4). Commits 28c5e7b (B1), 72fe26a (B2), cc9b3ef (B3) touched ZERO
  goldens — the family was knowingly held and re-blessed once, exactly as D5 requires.
- golden-e2e.json drift measured: edgeCount 54->64, nodeCount 54->53, stubCount 1->0 — matches
  the D5 predicted drift byte-for-byte (+4 depends_on, +6 writes_to, phantom stub removed).

---

## Spec Compliance Matrix (17 scenarios / 5 requirements — all COMPLIANT)

| # | Requirement | Scenario | Proving test | Result |
|---|-------------|----------|--------------|--------|
| 1 | sqlite-extraction | View bodies emit exact depends_on | dependency-edges.test.ts (toStrictEqual 4-set + confidence parsed) | COMPLIANT |
| 2 | sqlite-extraction | Trigger action bodies emit exact writes_to | dependency-edges.test.ts (toStrictEqual 6-set + confidence) | COMPLIANT |
| 3 | sqlite-extraction | Trigger header never leaks (negative) | dependency-edges.test.ts (reads_from empty, no ON-target) + tokenizer.test.ts | COMPLIANT |
| 4 | sqlite-extraction | No self-edges and no phantom edges (negative) | dependency-edges.test.ts + tokenizer.test.ts (literal/NEW./OLD./comment/self) | COMPLIANT |
| 5 | sqlite-extraction | supportsDependencyHints stays false, comment corrected | capabilities.test.ts (false + comment guard) | COMPLIANT |
| 6 | sqlite-extraction | Edge set is deterministic | dependency-edges.test.ts (extract-twice byte-identical) | COMPLIANT |
| 7 | graph-normalization | Minimal fixture normalizes to golden graph | normalize.test.ts (catalog-minimal regression) | COMPLIANT |
| 8 | graph-normalization | Trigger firing on a view -> view node (cross-engine) | fires-on-target.test.ts (view node, no stub) | COMPLIANT |
| 9 | graph-normalization | SQLite INSTEAD OF fires on view, no phantom stub (exact) | fires-on-target.test.ts + normalize.test.ts | COMPLIANT |
| 10 | mcp-server: precheck | ALTER + DROP INDEX golden | precheck.test.ts (detail-level goldens) | COMPLIANT |
| 11 | mcp-server: precheck | Non-matchable identifiers reported unmatched | precheck.test.ts (phantom_missing_table, no fabricated impact) | COMPLIANT |
| 12 | mcp-server: precheck | SQLite column-drop surfaces exact view+trigger dependents | precheck.test.ts (whatToTest/readers/triggers toStrictEqual) | COMPLIANT |
| 13 | mcp-server: affected | affected reports changes exits 1; clean exits 0 | affected.test.ts (exit-code suite) | COMPLIANT |
| 14 | mcp-server: affected | affected on SQLite dept column-drop includes view+trigger deps | affected.test.ts (--json whatToTest toStrictEqual 5-set) | COMPLIANT |
| 15 | benchmark | Enumerator now yields view-dependency candidates | generate.test.ts (toStrictEqual 2-view candidate set) | COMPLIANT |
| 16 | benchmark | N and committed question set unchanged | comment-correction.test.ts (byte-stability) + one-line diff | COMPLIANT |
| 17 | benchmark | Stale blindness comments corrected | comment-correction.test.ts + generate.ts/questions.yaml diffs | COMPLIANT |

Compliance: 17/17 scenarios COMPLIANT.

---

## Adversarial Findings (verifier-measured)

### L-009 exactness — PASS
- dependency-edges.test.ts positives are ALL toStrictEqual over the FULL set (depends_on 4-edge
  set; writes_to 6-edge set); reads_from asserted toStrictEqual(empty). Explicit negatives: no
  trg_emp_x-to-employees, no trg_active-to-active_departments, no self-edge.
- Probe (does any test assert mere existence?): the only toBeDefined() at line 132 is PAIRED
  with a toMatch value assertion on the dst qname; it is a shape guard, not an existence-only
  positive. No existence-only positive found. Assertion quality: excellent.

### resolveTriggerTarget — PASS
- Table probed BEFORE view (reference-resolver.ts L113-121), then resolveOrStub(table, ...).
- Table-trigger fires_on edge id proven byte-identical via edgeId(fires_on,trig,dst,event)
  comparison (fires-on-target.test.ts L104-126) and across pg/mssql/mysql (L197-225).
- Phantom stub gone: stubCount 1->0 in golden-e2e; test asserts no [table] active_departments
  node AND the stubs list empty for that qname. INSTEAD-OF trigger resolves to the view node.

### Header-strip robustness — PASS (one minor coverage gap -> SUGGESTION)
- Covered: INSTEAD OF ON view; BEFORE UPDATE OF col ON table WHEN; a BEGIN/END token inside a
  MASKED WHEN-clause literal (length-preserving mask -> no mis-slice); no-BEGIN returns empty
  string. Mask-then-slice on the ORIGINAL is correct.
- Gap (SUGGESTION S-1): no explicit CASE-END-in-body test to lock the LAST-END-wins behavior
  against an intermediate END token. Nested BEGIN-END is N/A (SQLite trigger grammar forbids
  compound nesting), so that is not a real gap.

### Budget honesty — PASS (independently recomputed)
- precheck-tool-normal.txt: measured JS length 290 -> ceil(290/4)=73 tk <= 85 ceiling.
- precheck-tool-full.txt:   measured JS length 479 -> ceil(479/4)=120 tk <= 140 ceiling.
- Both match docs/format-spec.md section 5 (290ch->73tk/85, 479ch->120tk/140) EXACTLY.
  Methodology ceil(chars/4) unchanged; only the two precheck ceilings widened, and only because
  the fixture output genuinely grew (view dependents now in READERS + WHAT TO TEST).

### Live behavior (departments.dept_id drop + explore) — PASS (via source oracle + goldens)
- precheck.test.ts and affected.test.ts pin whatToTest EXACTLY to the 5-set
  {main.active_departments, main.assignments, main.employee_summary, main.employees,
  main.trg_active_dept_instead_insert} via toStrictEqual; readers/triggers carry confidence
  parsed; affected --json exits 1; pivot is the departments TABLE (bare dept_id unmatched — OQ a
  resolved); negatives exclude the pivot and unrelated objects.
- explore-view.txt golden: main.active_departments [view] + depends_on out -> {departments,
  employees} + fires_on in <- trg_active_dept_instead_insert [trigger]; NO phantom [table] stub.
- explore-normal.txt golden: main.employees gains 2 inbound depends_on <- the two views.
- golden-raw-catalog.json: exact view/trigger dependencies (views->read x2; instead-trigger->
  departments:write; 5 emp-triggers->audit_log:write). No reads_from, no self, no ON-header leak.

> Verification note (methodology, NOT a defect): the requested live-via-dist CLI run was
> substituted with the source-level oracle. dist/ is stale (built 21:43, before the 23:04-23:14
> src edits) and this environment enforces a hard never-build-after-changes rule, so dist was NOT
> rebuilt. The vitest suite imports src/ directly (e.g. runPrecheck from ../../src/index.js),
> making these green tests + committed re-blessed goldens the authoritative behavioral evidence —
> equivalent to, and more direct than, a dist bundle run of the same source.

### Provenance / hygiene — PASS
- Nothing pushed: no upstream tracking branch; no tags contain the change commits.
- Leak-scan: pre-commit codename-denylist hook installed (core.hooksPath=scripts/git-hooks);
  all 6 commits passed it. Independent scan of the diff for secrets/PII/keys -> clean.
- Working tree clean except this verify-report.md (uncommitted, as required).

---

## Documented deviations — verifier ruling

| # | Deviation | Ruling | Rationale |
|---|-----------|--------|-----------|
| a | Explicit self-exclusion in extractViews (D3 said presence-gate suffices) | ACCEPT | Necessary: sqlite_master.sql view body INCLUDES the CREATE VIEW name AS header, so the presence-gate WOULD match the view own name (unlike pg/mysql catalog bodies). Caller filters self out; documented map.ts L356-359; no-self-edge upheld + tested (dependency-edges L80-84, tokenizer L188-202). |
| b | SQLite-local comment stripping in tokenizeSqliteBody | ACCEPT | Necessary: sqlite_master.sql retains author comments verbatim; without stripSqlComments a name in a line/block comment would fabricate an edge. Documented tokenizer.ts L109-120; tested with both comment styles (tokenizer L172-186). Upholds No self-edges and no phantom edges. |
| c | Precheck ceilings widened 65->85 / 110->140 + format-spec section-5 note + budget.test comments | ACCEPT | Second-order drift not in the design table, but an HONEST re-measurement (explore-payloads precedent): ceil(chars/4) methodology unchanged; only two ceilings moved, only because fixture output genuinely grew. Numbers independently re-verified (73<=85, 120<=140). |
| d | explore.test.ts negative narrowed from a bare [table] check to the pivot-scoped main.active_departments [table] check | ACCEPT | MORE precise, not weaker: new view depends_on edges legitimately surface neighbor tables ([table]); scoping the negative to the pivot qname preserves the exact phantom-stub guard while permitting real neighbors. Upholds L-009 intent. |

---

## TDD Compliance (Strict TDD mode)

| Check | Result | Details |
|-------|--------|---------|
| TDD trace present | YES | openspec mode: tasks.md per-task RED->GREEN checkboxes (19/19 [x]) + DoD 8/8 [x]; no separate apply-progress table expected in openspec mode |
| All tasks have tests | YES | Every batch suite exists and passes (tokenizer, extract, dependency-edges, capabilities, fires-on-target, normalize, precheck, affected, generate, comment-correction, budget) |
| RED confirmed (tests exist) | YES | Test files present; docstrings assert RED-first (fails until src exists) |
| GREEN confirmed (tests pass) | YES | 3229/3229 green on the verifier own run |
| Assertion quality | YES | toStrictEqual full sets + explicit negatives throughout; no tautology, no ghost loop, no existence-only positive |

---

## Issues

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (non-blocking):
- S-1: Add a CASE-END-in-trigger-body unit test to tokenizer.test.ts locking the LAST-END-wins
  slice behavior against an intermediate END token. The code is already correct (last-END logic);
  this only hardens the regression net. (Nested BEGIN-END is N/A — SQLite grammar forbids it.)
- S-2: The two dbgraph_precheck ceiling widenings (deviation c) were an unforeseen second-order
  consequence. Consider adding token-budget re-measurement to the design blast-radius checklist
  for any change that grows neighbor-bearing tool output, so it is anticipated rather than
  discovered during apply.

---

## Recommendation

Ready for sdd-archive. The change is code-complete at b884ab6; 4f0f616 is docs-only (checkboxes).
No CRITICAL or WARNING blockers.
