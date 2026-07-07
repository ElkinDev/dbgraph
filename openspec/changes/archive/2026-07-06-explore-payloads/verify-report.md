# Verification Report — explore-payloads

**Change**: explore-payloads
**Branch**: v1-prep (repo dbgraph)
**Artifact store**: openspec
**Mode**: Strict TDD (per-batch RED to GREEN, golden discipline)
**Verifier**: sdd-verify (execution evidence gathered locally; no push, no mem_*)
**Date**: 2026-07-06

## Verdict: PASS

All 39/39 task checkboxes complete (31 batch + 8 DoD), all 29 spec scenarios across 7 requirements COMPLIANT with passing tests,
every gate green measured by the verifier, golden discipline honored (transparency proof intact,
re-bless confined to Batch B), FK reconstruct/degrade gate honest, live CLI matches the committed
goldens byte-for-byte, and the benchmark Run 2 table reproduces EXACTLY when re-scored blind.
0 CRITICAL, 0 WARNING, 3 SUGGESTION.

## Gates (measured by the verifier)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | PASS exit 0 (strict, no any) |
| Lint | npm run lint (eslint) | PASS exit 0 — 0 errors / 0 warnings |
| Tests | npm test (vitest run) | PASS 179 files, 3162 passed / 0 failed (matches expected 3162) |
| Working tree | git status --porcelain | Clean before writing this report |
| Push state | upstream of v1-prep | None — nothing pushed; all 6 change commits local only |
| Leak scan | denylist scan of new source | No secret-like literals |

## Golden discipline (the heart of this change)

| Check | Result |
|-------|--------|
| Batch A transparency: git diff 97743c7 5b867f0 -- test goldens | EMPTY — refactor changed zero golden bytes |
| Re-bless confined to Batch B | Only 2f0cec1 touches goldens |
| Batch C / D / R touch no goldens | Zero golden changes in 04c79dd, 98bb169, aed26be |
| Object re-bless surgical | ONLY the two main.employees FK lines (dept_id column + fk_employees_0 constraint); every non-FK line byte-identical |
| core/present object goldens (dbo.orders, payload-present FK) | Byte-identical throughout — correctly NOT re-blessed (payload-first path already rendered the column-level target) |
| Batch B golden set | explore-normal (+13), explore-full (+26), NEW explore-view (+4), object-tool-normal/full (FK lines only) |

## Adversarial checks

### D8 FK reconstruct gate — requires unambiguity, never guesses
deriveColumnAnnotations -> reconstructFkTarget (src/core/present/payload.ts:98-116): joins the
references edges to the constraint by attrs.constraintName; falls back to all references ONLY when
the table has exactly one FK (fkCount === 1); returns a target ONLY when the distinct target-qname
set has size 1, else undefined (degrade). The column-level [FK-target] marker renders only when
a.fk.has(name); the degraded constraint line drops the target. Precedence: payload definition
verbatim -> reconstruct -> omit. Probed by tests: single (payload.test.ts:337), composite (:356),
only-FK fallback (:372), payload-preferred (:379), degrade on multi-table (:394), degrade on
multi-FK unjoinable (:413). Gate is honest — CONFIRMED.

### Live CLI (built scratch torture graph; dist current — built 21:43, newer than all src; no rebuild)
- explore main.assignments --detail full -> declared-order PK "[PK]  pk_assignments  (project_id, emp_id, dept_id)" and reconstructed composite FK "[FK]  fk_assignments_0  (emp_id, dept_id -> main.employees)". Matches the exact-line pins (explore.test.ts:212-213, object.test.ts:156-157) captured from the REAL graph (ruling 3). PASS
- explore main.active_departments -> header "main.active_departments  [view]" (never [table]). D3 fix live. PASS
- explore main.employees --detail garbage -> Error: detail must be one of brief|normal|full (got "garbage"), exit 2. PASS
- object main.employees --detail full -> BYTE-IDENTICAL to test/mcp/golden/object-tool-full.txt (the MCP dbgraph_object golden). PASS
- explore main.employees --detail normal and --detail full, and explore main.active_departments --detail normal -> BYTE-IDENTICAL to explore-normal/full/view goldens. CLI == golden == MCP tool output. PASS

### Budget honesty (recomputed ceil(chars/4) on the re-blessed goldens by the verifier)
| Golden | chars | ceil/4 | format-spec claim | ceiling |
|--------|-------|--------|-------------------|---------|
| explore-brief | 209 | 53 | 53 | 75 PASS (no payload — pin unchanged) |
| explore-normal | 1365 | 342 | 342 | 400 UNCHANGED PASS |
| explore-full | 1756 | 439 | 439 | 420 -> 480 WIDENED PASS (documented, section 6 note + budget.test.ts comment) |
| explore-view | 82 | 21 | 21 | n/a PASS |
| object-tool-normal | 369 | 93 | 93 | 110 UNCHANGED PASS |
| object-tool-full | 713 | 179 | 179 | 225 UNCHANGED PASS |

All measured numbers match format-spec section 5 exactly. The single 420->480 widening is documented
with a section 6 token-delta note (methodology ceil(chars/4) and ceiling POLICY unchanged) — NOT silent.

### Benchmark Run 2 — re-scored BLIND by the verifier
node --experimental-strip-types benchmark/score.ts benchmark/runs/explore-payloads-2026-07-06
-> "WITH 80% / WITHOUT 80% (tokens WITH 180373 vs WITHOUT 133442)". render.ts reproduces the
committed table cell-for-cell: fk-path 34607/26697, column-type 29073/26688, impact 55885/26694,
trigger-inventory 31178/26698, constraint-semantics 29630/26665, Overall 80% (4/5) / 80% (4/5),
180373 / 133442. Matches docs/benchmarks.md Run 2 (lines 162-167) EXACTLY. Run 1 table intact
(40%/80%, 293325/133442). Impact circularity note present and accurate — mechanical key is
"assignments, employees"; the Run 2 WITH answer added the view + INSTEAD OF trigger and scored X
against the circular view-blind key (lines 181, 184-192). WITH surface documented as EXACTLY the
four commands. No extrapolation phrasings — every figure scoped to this fixture/question-set/model.

### MCP parity
test/mcp/explore.test.ts:80 asserts dbgraph_explore tool output .toBe(golden) for brief/normal/full/
view; :210-212 assert the reconstructed FK payload lines in the tool output. Since verifier-run CLI
output equals those same goldens, CLI == golden == MCP tool. Cross-transport parity
(test/mcp/http.test.ts) reads the golden FILE and is green (survives re-bless). PASS

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 39 checkboxes = 31 batch (A.1-A.6, B.1-B.10, C.1-C.7, D.1-D.3, R.1-R.5) + 8 DoD |
| Tasks complete | 39/39 (all batch tasks and all DoD boxes marked [x]; verified 0 unchecked) |
| Tasks incomplete | 0 |

## Spec Compliance Matrix (29 scenarios / 7 requirements)

### cli-config — explore output comes from a pure formatter shared with the MCP tool (MODIFIED)
| Scenario | Test | Result |
|----------|------|--------|
| explore renders the entity bundle at the requested detail | mcp/explore.test.ts golden per detail | COMPLIANT |
| explore output is deterministic and golden-pinned | explore.test.ts byte-identical-on-re-run | COMPLIANT |
| explore formatter is the single source for the MCP tool | shared formatExplore; CLI==MCP golden | COMPLIANT |
| normal renders focus column types/PK/NN in one call | explore.test.ts + live CLI | COMPLIANT |
| composite PK renders member columns in declared order | explore.test.ts:213, payload.test.ts:215 + live CLI | COMPLIANT |
| FK mapping when payload carries a target | core/present/golden/object-full.txt, payload.test.ts:379 | COMPLIANT |
| FK RECONSTRUCTED from references edge | explore.test.ts:212, payload.test.ts:337/356 + live CLI | COMPLIANT |
| FK columns WITHOUT a target when ambiguous | payload.test.ts:394/413 | COMPLIANT |
| trigger timing and events render at full | explore-full.txt, explore.test.ts | COMPLIANT |
| brief detail renders no payload lines | explore-brief.txt (header+counts only) | COMPLIANT |
| view focus labeled [view] not [table] | explore-view.txt, explore.test.ts:191 + live CLI | COMPLIANT |

### cli-config — explore and object reject an unknown --detail value (ADDED)
| unknown --detail exits 2 with an actionable message | detail.test.ts, dispatch.test.ts:284 + live CLI | COMPLIANT |
| valid --detail values are unaffected | detail.test.ts | COMPLIANT |

### cli-config — object CLI command mirrors dbgraph_object (ADDED)
| object full detail byte-identical to the MCP tool | object.test.ts:189 parity + live CLI | COMPLIANT |
| object honors the CLI import boundary | test/core/boundaries.test.ts | COMPLIANT |
| usage banner documents the object line at index 12 | cli.test.ts:120 + live --help | COMPLIANT |

### mcp-server — One shared payload-render helper backs explore and object (ADDED)
| object goldens byte-identical after refactor (transparency) | git diff 97743c7 5b867f0 EMPTY | COMPLIANT |
| FK-reconstruction re-blesses ONLY the FK lines, object+explore together | git diff 2f0cec1~1 2f0cec1 | COMPLIANT |
| explore and object render identical section bytes | shared payload.ts; verifier section diff identical | COMPLIANT |

### mcp-server — dbgraph_explore returns a compact neighborhood or disambiguation list (MODIFIED)
| Explore returns the compact neighborhood (golden) | explore-brief.txt + explore.test.ts | COMPLIANT |
| Ambiguous target returns a disambiguation list | resolveNode candidates branch; MCP tests | COMPLIANT |
| Explore payload matches the CLI byte-for-byte | verifier CLI==golden==MCP tool | COMPLIANT |

### mcp-server — Compact format pinned by docs/format-spec.md authored first (MODIFIED)
| Format spec exists with grammar/levels/budget methodology | format-spec.md (explore payload grammar added) | COMPLIANT |
| Output pure formatter, byte-identical on re-run | ADR-008 tests; verifier re-run identical | COMPLIANT |
| Brief detail respects the measured budget | budget.test.ts (53 <= 75) | COMPLIANT |
| Explore payload ceilings re-measured and re-asserted | budget.test.ts (342<=400, 439<=480) + section 6 note | COMPLIANT |

### benchmark — Multiple runs are code-version-labeled tables (ADDED)
| A second results table is labeled with its code version | benchmarks.md Run 2 (explore-payloads-2026-07-06) | COMPLIANT |
| Re-run WITH surface is the unchanged four commands | Run 2 doc + protocol; verifier re-score | COMPLIANT |
| An unfavorable second run is reported, not suppressed | impact 0/0 reported with circularity note | COMPLIANT |

Compliance summary: 29/29 scenarios COMPLIANT.

## Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 pure payload.ts, string[] renderers, caller cadence | Yes | formatObject/Explore push blank between sections; renderers body-only |
| D2 detail-gated, byte-identical container sections | Yes | brief no payload; table/view render object sections; focus via renderFocusPayload |
| D3 [view] fix at resolution (prefer non-missing) both surfaces | Yes | runExplore, runObject, MCP resolveNode (explore+object) |
| D4 parseDetail throws ConfigError, exit 2, 3 call sites | Yes | explore/affected/object |
| D5 CLI object thin wrapper, no --json, byte-identical | Yes | runObject reuses formatObject; parity green |
| D6 deliberate re-bless, refactor transparent, view golden | Yes | transparency proof + section-6-paired re-bless confined to B |
| D7 TDD seams; benchmark orchestrator-only | Yes | Batch R not a vitest suite |
| D8 payload -> reconstruct -> degrade, never guess | Yes | gate verified in code + tests + live CLI |

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (non-blocking, evaluated deviations — all acceptable):
1. explore-view.txt pins the [view] label but shows (no neighbors) / no payload, because the torture
   main.active_departments view carries no has_column neighbors (SQLite view-column extraction is out
   of scope, supportsDependencyHints=false). Container payload rendering for the view code path
   (isContainer = table or view) is proven by the main.employees table golden. A future fixture with a
   view that carries column neighbors would strengthen this pin. Acceptable.
2. main.assignments is pinned via exact-line .toContain assertions (explore.test.ts:212-213,
   object.test.ts:156-157) captured from the REAL built graph rather than a full-file golden — the
   ruling-3 deferral (constraint name unknown until apply). It shares the code path with the fully
   golden-pinned main.employees, and the verifier confirmed the live output matches. Acceptable; a full
   assignments golden could be added later for symmetry.
3. renderFocusPayload was authored in Batch B (B.3) rather than Batch A, though the D1 interface listed
   it — a documented TDD-purity deferral (it is consumed by formatExplore, which lands in B). No
   functional impact; unit-tested per kind (payload.test.ts:428+). Acceptable.

## Next recommended: sdd-archive (clean — no CRITICAL issues).
