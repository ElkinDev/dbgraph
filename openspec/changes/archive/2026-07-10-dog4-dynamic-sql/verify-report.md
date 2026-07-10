# Verify Report: DOG-4 — Dynamic-SQL honesty hardening

**Change**: dog4-dynamic-sql
**Verified against**: proposal → spec (mcp-server + graph-query deltas) → design → tasks → apply-progress
**Branch**: `post-v1` (HEAD `fdf2dc2`), clean tree
**Date**: 2026-07-10
**Verdict**: **ARCHIVE-READY** — 0 CRITICAL, 1 WARNING, 2 SUGGESTION

The independent reproduction confirms the implementation matches the specs. The single WARNING is a
test-coverage gap with an honest fixture constraint (not a behavior defect); both SUGGESTIONs are
non-blocking hygiene notes. No CRITICAL issue exists, so the change is eligible for archive.

---

## Reproduction (independent)

| Gate | Expected | Observed | Result |
|------|----------|----------|--------|
| `npx tsc --noEmit` | exit 0 | exit 0 | PASS |
| `npm run lint` | 0 errors / 0 warnings | 0 / 0 | PASS |
| `npm test` | all green, count ≥ 3595 | 230 files / 3639 tests, 0 failed | PASS |
| HARD-STOP: `test/mcp/golden/*.txt` | byte-identical (EMPTY diff) | EMPTY | PASS |
| HARD-STOP: sqlite + mongodb render/e2e goldens | byte-identical | EMPTY | PASS |
| HARD-STOP: extraction goldens (`golden-raw-catalog.json`) | byte-identical | EMPTY | PASS |
| HARD-STOP: `test/golden/normalize/*.json` | byte-identical | EMPTY | PASS |
| HARD-STOP: `test/core/present/budget.test.ts` ceilings | byte-identical | EMPTY | PASS |
| `docs/format-spec.md` | only the §6.2 caveat note added; budgets untouched | only §6.2 note gained | PASS |
| Legal guardrail sweep (neutral terms only) | 0 hits | 0 hits on all 3 commits (`f10f807`, `134601b`, `fdf2dc2`) | PASS |

Static edges are reported ALONGSIDE `hasDynamicSql` unchanged; the `query/impact` edge-count assertion
is green — ZERO fabricated edges/targets. The `brief` matched-objects output is byte-identical (marker
gated to `normal`+`full` on every surface).

---

## Spec scenario matrix (12 scenarios — 11 MET, 1 PARTIAL)

Scenario tags per `tasks.md`. Each unit assertion is exact-string / exact-set with positive AND negative
cases (L-009).

| Tag | Spec | Scenario | Result | Evidence |
|-----|------|----------|--------|----------|
| A1 | mcp-server | byte-identical caveat at normal (explore ≡ object) | MET | shared `renderDynamicSqlCaveat`; caveat LINE byte-identical (see S1) |
| A2 | mcp-server | caveat at full yes / brief no | MET | `explore-format` + `object-format` gated `normal`+`full` |
| A3 | mcp-server | non-dynamic routine never carries marker (negative) | MET | negative unit assertions in both format suites |
| A4 | mcp-server | sqlite + mongodb untouched (honest absence) | MET | frozen goldens EMPTY diff |
| B1 | mcp-server | precheck exact per-node degraded set | MET | `precheck/engine.test.ts` + `precheck-format.test.ts` exact set |
| B2 | mcp-server | affected mirrors per-node marking via shared engine | **PARTIAL** | engine feed proven at unit grain; NO CLI-level `affected --json` e2e (= W1) |
| B3 | mcp-server | sqlite affected byte-identical (negative) | MET | sqlite affected/precheck goldens EMPTY diff |
| C1 | mcp-server | impact names routine + keeps blanket warning | MET | `impact-format.test.ts` named block + warning verbatim |
| C2 | mcp-server | impact with no dynamic-SQL node (negative) | MET | empty `degradedNodeIds` → no block, no warning |
| Q1 | graph-query | impact names degraded closure node | MET | `query/impact.test.ts` exact `degradedNodeIds` set |
| Q2 | graph-query | closure without dynamic SQL (negative) | MET | `[]` + `dynamicSqlWarning === false` |
| Q3 | graph-query | absent engines unaffected + goldens byte-identical | MET | sqlite impact goldens EMPTY diff |

---

## Findings

### W1 (WARNING) — B2 has no CLI-level `affected --json` degraded-item end-to-end test

The per-node degradation feed is proven at UNIT grain: `precheck/engine.test.ts` asserts both the matched
item and the impact-section item for a dynamic routine carry `hasDynamicSql: true` (present-only, omitted
otherwise), and `precheck-format.test.ts` asserts the `  [DYNAMIC SQL]` suffix placement. What is NOT
covered is an END-TO-END assertion that `dbgraph affected script.sql --json` actually serializes the
`hasDynamicSql` key on a degraded item.

**Honest constraint (why the gap is defensible):** the deterministic CLI golden fixtures are SQLite-only,
and SQLite has NO dynamic-SQL statement form — so no committed CLI fixture can produce a degraded item.
A true CLI-level e2e test therefore requires a NEW synthetic index fixture (a graph carrying a
`hasDynamicSql: true` routine) that the CLI can load deterministically. That fixture does not exist today.

Classified WARNING, not CRITICAL: the observable behavior is correct (the shared engine feeds the same
field the unit tests assert, and `affected` is a thin wrapper over that engine); only the end-to-end
proof is missing. Tracked as a follow-up (see archive report).

### S1 (SUGGESTION) — scenario A1 prose "the two renderings are byte-identical" is imprecise

The BINDING reconciliation r1 pins the caveat LINE bytes (`[DYNAMIC SQL] impact analysis may be
incomplete`) as byte-identical across explore and object via the shared helper. It does NOT require the
two FULL renderings to be byte-identical — explore and object legitimately place the caveat at different
positions within their own surrounding structure (position asymmetry). The implementation satisfies the
BINDING r1 (the LINE is identical); the delta's scenario A1 prose over-states it by saying "the two
renderings are byte-identical."

**Resolution applied at archive-merge:** the canonical mcp-server A1 scenario prose is tightened to
"the caveat LINE is byte-identical across the two surfaces" so the source-of-truth text is accurate.
This changes documentation only — no code, no behavior, no golden.

### S2 (SUGGESTION) — the impact-tool pre-cache line (7.2) is redundant-by-construction

`src/mcp/tools/impact.ts` adds `result.degradedNodeIds` to the id set pre-cached before `resolveSync`.
Verification proves this is redundant BY CONSTRUCTION: every degraded id is, by definition, a node in the
impact closure that is ALREADY pre-cached for the chain rendering, so the degraded ids always resolve to
qnames without the extra line. The line is therefore a defensive no-op — acceptable, but it could not be
covered by a genuine RED test (nothing fails when it is removed). Recorded so a future change can either
KEEP it as documented defense or RETIRE it behind a mock-based test that isolates the resolve set. Not
blocking (see archive report follow-up).

---

## Rulings on apply's scrutiny list

Apply flagged four items for verify scrutiny; each is adjudicated:

- **7.2 no-RED defensive line** (`mcp/tools/impact.ts` pre-cache) — UPHELD as acceptable. Proven
  redundant-by-construction (S2); shipped as defensive documentation. No behavior risk.
- **3.1 type-only** (`PrecheckItem.hasDynamicSql?: true`) — UPHELD. A pure `exactOptionalPropertyTypes`
  type addition validated by `tsc`; present-only-on-degraded, omitted otherwise. No standalone runtime
  RED is meaningful for a type-only change; the runtime contract is covered by the engine + format suites.
- **9.2 skipped (non-gating)** — UPHELD. The optional live per-engine render assertions were intentionally
  skipped: non-gating, low marginal signal. Extraction+propagation are already covered by the existing
  live e2e suites, and the render CONTRACT is fully covered by the deterministic unit suites. Skipping
  does NOT reduce the verified contract.
- **No golden re-bless needed** — CONFIRMED. All committed goldens are SQLite-backed with zero dynamic
  SQL, so the caveat/marker never enters measured output; every frozen golden diff is EMPTY. The r5
  "re-bless exact degraded sets" obligation is satisfied by the NEW synthetic `acme_*` unit suites, not by
  mutating any committed golden.

### Reconciliation rulings upheld (r1–r5)

- **r1** — caveat line exact bytes present via the shared helper; old full-only emoji line
  (`explore.ts:179-183`) DELETED. Confirmed both.
- **r2** — `hasDynamicSql` key OMITTED (never emitted as `false`) in the `--json` payload; present only on
  degraded items. Confirmed.
- **r3** — blanket "impact possibly incomplete" warning PRESERVED verbatim; below it a sorted named block
  (one line per degraded routine, `[DYNAMIC SQL]` marker, sorted by qname); `degradedNodeIds` sorted
  ascending + deduped. Confirmed.
- **r4** — `docs/format-spec.md` §6.2 one-line note added; budgets and measured goldens UNCHANGED.
  Confirmed.
- **r5** — no fixture added; exact degraded sets asserted in new synthetic unit suites; committed goldens
  unchanged. Confirmed.

---

## Conclusion

ARCHIVE-READY. 0 CRITICAL. The single WARNING (W1) is a documented coverage gap with an honest
fixture-availability constraint and a clear follow-up; both SUGGESTIONs are non-blocking (S1 fixed in the
canonical merge, S2 tracked). All HARD-STOP freezes are byte-identical, static edges are unchanged, and no
edge/target is fabricated. Proceed to archive.
