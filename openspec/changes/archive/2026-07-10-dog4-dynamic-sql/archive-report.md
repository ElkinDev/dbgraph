# Archive Report: DOG-4 — Dynamic-SQL honesty hardening

**Change**: dog4-dynamic-sql — promote the `hasDynamicSql` caveat to `normal` detail and mark per-node
degradation in `precheck`/`affected`/`impact`
**Epic**: deep-object-graph (DOG) — **this is the LAST child; the epic closes with it**
**Archive date**: 2026-07-10
**Branch**: `post-v1` (HEAD `fdf2dc2`) — NOT pushed (local per tasks standing instruction)
**Commits**: `f10f807`, `134601b`, `fdf2dc2` (three commits landed on `post-v1`, culminating at HEAD)
**Verdict**: ARCHIVE-READY — 0 CRITICAL, 1 WARNING (W1), 2 SUGGESTION (S1, S2)

---

## What Shipped

A PRESENTATION + QUERY honesty change. The `hasDynamicSql` flag was already detected, propagated, and
persisted (US-007); DOG-4 stops UNDER-surfacing it. Zero extraction, storage, edge, or traversal change;
zero new npm deps; zero catalog queries. All changes additive and revertible.

### Shared marker + caveat helper (`src/core/present/payload.ts`)
- `export const DYNAMIC_SQL_MARKER = '[DYNAMIC SQL]'` — UPPERCASE bracket family (DOG-2 `[OUT]`/`[INOUT]`
  precedent); exported from the `src/core/index.ts` barrel for L-009 exact-string tests.
- `renderDynamicSqlCaveat(node): string[]` — returns `['[DYNAMIC SQL] impact analysis may be incomplete']`
  when `node.payload?.hasDynamicSql === true`, else `[]` (degrade-by-absence).

### Explore + object caveat at `normal`+`full` (`present/explore.ts`, `present/object.ts`)
- Both surfaces `push` the shared caveat, gated `normal`+`full`, never `brief`. Because ONE helper
  produces the bytes, the caveat LINE is byte-identical across explore and object.
- The old full-only emoji block (`explore.ts:179-183`) is DELETED (r1/D6) — replaced by this line at both
  thresholds; no test/golden asserted the emoji line, so removal is clean.

### Precheck / affected per-node degradation (`present/precheck.ts`, `precheck/engine.ts`)
- `PrecheckItem.hasDynamicSql?: true` — present ONLY on degraded items, OMITTED otherwise
  (`exactOptionalPropertyTypes`-clean). The engine sets it from `node.payload['hasDynamicSql']` at BOTH
  construction sites (matched + impact-section), so an ISOLATED degraded routine (no inbound edges) is
  still flagged. Text render appends `  [DYNAMIC SQL]` after the `(confidence: …)` suffix, gated
  `detail !== 'brief'`. `--json` gains the additive `hasDynamicSql` key on degraded items only.

### Impact query names degraded nodes (`ports/graph-store.ts`, `query/impact.ts`, `present/impact.ts`, `mcp/tools/impact.ts`)
- `ImpactResult.degradedNodeIds: readonly string[]` — NEW, sorted ascending + deduped (ADR-008);
  `dynamicSqlWarning` KEPT and derived (`degradedNodeIds.length > 0`).
- Impact render KEEPS the blanket "impact possibly incomplete" warning VERBATIM and adds a NAMED block:
  one line per degraded routine (resolved qname + `[DYNAMIC SQL]`), sorted by qname, at `normal`+`full`.

### Docs (`docs/format-spec.md` §6.2)
- One-line token-delta note for the caveat line. Budget ceilings and `budget.test.ts` UNCHANGED
  (SQLite goldens never render the caveat).

### Per-engine reality (unchanged, honest)
mssql/pg/mysql HAVE dynamic SQL; sqlite has NO dynamic-SQL statement form; mongodb has no routines. sqlite
and mongodb are untouched — honest absence, byte-identical goldens.

---

## Validation

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run lint` | PASS (0 errors / 0 warnings) |
| `npm test` | PASS — 230 files / 3639 tests, 0 failed |
| HARD-STOP freezes (mcp goldens, sqlite/mongodb, extraction, normalize, budget) | BYTE-IDENTICAL (all diffs EMPTY) |
| `docs/format-spec.md` | only §6.2 caveat note added; budgets untouched |
| Static-edge preservation | edge-count assertion green — ZERO fabricated edges/targets |
| Legal guardrail sweep | 0 hits on all 3 commits |

Per-batch gate passed before each commit (Batch A count 3612; Batch B count 3639).

---

## Deviations (honestly recorded)

1. **7.2 no-RED defensive line** — the `mcp/tools/impact.ts` pre-cache addition
   (`result.degradedNodeIds` into the resolve set) is REDUNDANT BY CONSTRUCTION: every degraded id is
   already a pre-cached closure node, so it resolves without the extra line. It could not be covered by a
   genuine failing test; shipped as an acceptable defensive no-op (→ verify S2, follow-up below).
2. **3.1 type-only** — `PrecheckItem.hasDynamicSql?: true` landed as a pure `exactOptionalPropertyTypes`
   type addition validated by `tsc` with no standalone runtime RED (the runtime contract is covered by the
   engine + format suites). Not a defect; noted for audit honesty.
3. **9.2 skipped (non-gating)** — the OPTIONAL live per-engine render assertions
   (`[DYNAMIC SQL]` on real `EXEC`/`EXECUTE`/`PREPARE`) were intentionally SKIPPED: non-gating, low
   marginal signal; extraction+propagation already covered by the live e2e suites and the render contract
   fully covered by deterministic unit suites.
4. **No golden re-bless needed** — all committed goldens are SQLite-backed (zero dynamic SQL), so the
   caveat/marker never enters measured output; r5's exact-set obligation is met by NEW synthetic `acme_*`
   unit suites, not by mutating any committed golden.
5. **Commit count** — the `tasks.md` DoD anticipated TWO batch commits; the shipped `post-v1` history is
   THREE commits (`f10f807`, `134601b`, `fdf2dc2`) — the extra commit carries the finalization (the §6.2
   docs note / gate) per the verify reproduction. No scope change; recorded as a minor plan-vs-history
   deviation.
6. **Canonical A1 prose tightened at merge** — see "Merge Rulings" below (implements verify S1).

---

## Follow-ups (tracked, non-blocking)

- **W1 — CLI-level `affected --json` degraded-item e2e test.** The per-node feed is proven at unit grain
  (`precheck/engine.test.ts`, `precheck-format.test.ts`), but there is no END-TO-END test that
  `dbgraph affected script.sql --json` serializes the `hasDynamicSql` key on a degraded item. **Honest
  constraint:** the deterministic CLI fixtures are SQLite-only and SQLite has NO dynamic SQL, so no
  committed fixture can produce a degraded item — this test needs a NEW synthetic index fixture (a graph
  carrying a `hasDynamicSql: true` routine) that the CLI can load deterministically. Recommended as the
  first task of any DOG-4 hardening follow-up.
- **S2 — the redundant pre-cache line (`mcp/tools/impact.ts`).** Either KEEP it as documented defense or
  RETIRE it behind a mock-based test that isolates the resolve set and proves the degraded ids resolve
  from the chain pre-cache alone.

---

## Merge Rulings (delta → canonical)

Both deltas are ADDED (additive) requirements; no MODIFIED/REMOVED, so the merge preserves every existing
requirement untouched.

| Delta | Canonical target | Action | Requirements merged |
|-------|------------------|--------|---------------------|
| `specs/mcp-server/spec.md` | `openspec/specs/mcp-server/spec.md` | appended (3 ADDED) | dynamic-SQL caveat at normal+full; precheck/affected per-node degradation; `dbgraph_impact` names degraded routines |
| `specs/graph-query/spec.md` | `openspec/specs/graph-query/spec.md` | inserted after the impact-closure requirement (1 ADDED) | impact result identifies the specific dynamic-SQL degraded nodes |

**RULING (implements verify S1) — canonical mcp-server scenario A1 prose tightened.** The delta's A1
scenario read "…the two renderings are byte-identical (shared helper, no per-surface branch)". Because the
BINDING r1 pins only the caveat LINE bytes (explore and object legitimately differ in the caveat's
POSITION within their own structure — position asymmetry), the whole renderings are NOT byte-identical.
The canonical text is tightened to "…the caveat LINE is byte-identical across the two surfaces (shared
helper, no per-surface branch)" so the source-of-truth spec is accurate. Documentation-only; no code, no
behavior, no golden change.

---

## Specs Updated (Source of Truth)

| Spec | Action | Details |
|------|--------|---------|
| `openspec/specs/mcp-server/spec.md` | UPDATED | +3 ADDED requirements (dynamic-SQL caveat; precheck/affected per-node; `dbgraph_impact` named degraded routines); A1 prose tightened per S1 |
| `openspec/specs/graph-query/spec.md` | UPDATED | +1 ADDED requirement (impact identifies specific degraded nodes) |

---

## Epic Closure

DOG-4 is the FOURTH and FINAL child of the `deep-object-graph` epic. With it archived, ALL FOUR children
are SHIPPED — the epic is COMPLETE:

| Child | Archived | Ref |
|-------|----------|-----|
| DOG-1 calls-edges | 2026-07-07 | `openspec/changes/archive/2026-07-07-dog1-calls-edges/` |
| DOG-2 routine-parameters | 2026-07-07 | `openspec/changes/archive/2026-07-07-dog2-routine-parameters/` |
| DOG-3 column-lineage | 2026-07-10 | `openspec/changes/archive/2026-07-10-dog3-column-lineage/` |
| DOG-4 dynamic-sql | 2026-07-10 | `openspec/changes/archive/2026-07-10-dog4-dynamic-sql/` (this change) |

The epic proposal (`openspec/changes/deep-object-graph/proposal.md`) is marked COMPLETE and archived
alongside its last child.

---

## SDD Cycle Complete

DOG-4 was fully planned (proposal → mcp-server + graph-query specs → design → tasks), implemented under
Strict TDD across two batches (three commits on `post-v1`), verified (ARCHIVE-READY, 0 CRITICAL), and is
now archived. The canonical specs reflect the shipped behavior. The change folder moves to
`openspec/changes/archive/2026-07-10-dog4-dynamic-sql/`, and the epic closes with it.
