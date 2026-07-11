# Design: Benchmark v2 — Task-Planning Decision-Quality Measurement

## Technical Approach

v2 is PURELY ADDITIVE: three new closed-form families (`plan-callers`, `plan-blindspots`,
`plan-order`) scored on the mssql torture fixture through the UNCHANGED blind scorer / aggregate /
coverage / promptSha256 machinery. Two seams do the work: (a) a substrate-aware branch in the two
DB-reading dev stages (`generate`, `build-packets`) whose CURRENT behavior is the default, and (b)
hand-authored committed keys read through the EXISTING `--ground-truth` override — never derived
from `affected`/the store. All citations below are verified against the harness at HEAD.

## Architecture Decisions

### D1 — Key-file mechanics (anti-circularity carve-out)
**Choice**: Hand-authored keys live in a NEW committed dir `benchmark/planning-keys/<qid>.json`,
JSON mirroring `ground-truth/*.json` shape plus a per-target `source_ddl_refs` map AND a top-level
`source_ddl_ref` string. The mssql pipeline points the existing `--ground-truth
benchmark/planning-keys` flag (build-packets.ts:293-294, score.ts:88-89 — VERIFIED present).
**Alternatives**: co-locating in `benchmark/ground-truth/` (rejected — muddies generated vs
hand-authored provenance; a generator writes that dir). **Rationale**: physical separation IS the
anti-circularity story; zero new read-path code (override already exists). Top-level string keeps
`assertSourceRefs` (generate.ts:437-444) reusable UNCHANGED; the `source_ddl_refs` map (one entry per
scope/pair member) is what `verify` greps line-by-line against `test/fixtures/mssql/torture.sql`.

### D2 — generate.ts plan derivation (read-key path)
**Choice**: Under `--substrate mssql-torture`, generate does NOT open a store. For each plan family
it READS `benchmark/planning-keys/<qid>.json`, builds a `QuestionRecord` (question text + scope
block where applicable), and runs the existing self-checks. Three adaptations, all guarded so the
sqlite path is byte-identical:
- **N-bound**: `assertNInBounds` gains a substrate lower bound (sqlite 5, mssql-plan 3); default 5
  preserved (v2 pre-registers N=3).
- **Leak guard (D2a)**: for scope-list families the SCOPE block is fair input; `assertNoAnswerLeak`
  excludes it from the scan via `split(scopeBlock).join('')` — the SAME exclusion build-packets
  already applies to the DDL dump (build-packets.ts:273). `answerTokens` are COMPOSED answer forms
  only. A pre-composed answer pasted OUTSIDE the scope block still trips. plan-callers (no scope
  block) uses the standard guard unchanged.
- **Coverage assert**: `deriveCoverageTargets` (harness-checks.ts:73-115, the VERIFIED extension
  point) gains plan cases returning `{kind:'any', name}` for every planted routine/table. Because
  `CREATE_OBJECT_RE` (harness-checks.ts:128) matches only `TABLE|VIEW|TRIGGER|INDEX`, it MUST be
  extended to `PROCEDURE|PROC|FUNCTION` or mssql routines never register as defined and the
  build-time `verifyDumpCoverage` assert (build-packets.ts:341) always fails.

### D3 — Topological-order comparator (the one novel comparator)
**Choice**: New pure `comparePlanOrder` in `scorer/families.ts`. GT: `{ scope: string[]; precede:
[string,string][] }`. Answer parsed as an ORDERED comma-separated list (reuse `splitList` split/trim/
drop-empty but PRESERVE order; `normalizeQname` each). Correct IFF the answer is a PERMUTATION of
`scope` (each member exactly once, no extras, no duplicates) AND every `[u,v]` pair satisfies
`index(u) < index(v)`.
```ts
export function comparePlanOrder(
  answerParsed: string,
  groundTruth: GroundTruthByFamily['plan-order'],
): ScoreResult
```
**Alternatives**: adjacency-list input (rejected — must-precede pairs are the minimal, audit-able
contract and map 1:1 to planted FK/call precedence). **Rationale**: accepts ANY valid linearization,
rejects violations. Tie/dup/missing: duplicate → reject; missing/extra scope member → reject; empty →
reject; unconstrained pairs → any relative order accepted.

### D4 — Substrate threading (5 modules)
**Choice**: `generate` + `build-packets` gain `--substrate` (default `sqlite-torture` = current
behavior). `scorer/index.ts` registers 3 families (`Family`, `FAMILIES`, `scoreAnswer` switch,
`GroundTruthByFamily`); `scorer/families.ts` gains 3 comparators (set-match reused for
callers/blindspots, new topo for order). `render.ts` gains an OPTIONAL `--substrate <label>` flag
that prepends a caption; ABSENT → byte-identical output. Manifest entries gain an additive
`substrate` field; `questions.yaml` already carries `substrate:` (generate.ts:402). **score.ts is
UNTOUCHED** (family-generic; picks up families once registered — VERIFIED FAMILIES loop). v2 runs
under `runs/mssql-plan-<date>/`.

### D5 — mssql WITHOUT dump + Docker-gated proof
**Choice**: For `--substrate mssql-torture`, the WITHOUT dump is the DETERMINISTIC comment/header-
stripped `test/fixtures/mssql/torture.sql` (drop `--` full-line comments + the header block + `GO`
separators; keep every CREATE incl. full SP bodies verbatim). Token cost measured honestly over the
stripped text via the existing `scorer/tokens.ts`. **Alternatives**: live catalog reconstruction from
`sys.` views (rejected — MSSQL stores no table CREATE text; reconstruction is fragile/error-prone
and adds false precision; `sys.sql_modules.definition` returns the SAME body text the fixture holds).
**Rationale**: the applied fixture IS byte-identical to the catalog source, so stripped torture.sql
is a faithful, Docker-free, deterministic dump that carries the whole SP story (sp_executesql, EXEC
chains, composite FKs). The **Docker gate** lives where it must: an integration proof
(`describe.skipIf(!DBGRAPH_INTEGRATION)`, reusing `container.ts`) spins mssql, applies torture.sql,
indexes it with dbgraph (the WITH graph), runs `build-packets --substrate mssql-torture`, and ASSERTS
the WITHOUT dump embeds the SP bodies and that plan-* coverage passes on the live substrate. Docker
absent → SKIPS honestly.

### D6 — What stays byte-identical
Frozen SQLite artifacts UNTOUCHED: `benchmark/questions.yaml`, `ground-truth/*.json` (6 keys),
`packets/*` + `manifest.json`, `runs/{torture,explore-payloads,dog-complete}-*`, the sqlite `.db`
and `torture.sql`. Existing comparators (`compareFkPath`…`compareConstraintSemantics`), `score.ts`,
and default `render.ts` output — byte-identical. Every new branch activates ONLY under
`--substrate mssql-torture`.

## Data Flow

    planning-keys/*.json ─┐                         (WITH)  dbgraph index ─┐  Docker-gated
    (hand-authored, DDL-  ├─> generate --substrate ─> questions.yaml ──────┼─> build-packets
     audited refs)        │   mssql-torture           (N=3, substrate)     │   --substrate
    torture.sql (mssql) ──┘   [read-key, no store]                         │   [WITHOUT=stripped
                                                                            │    torture.sql dump]
                                                                            v
    scorer (3 new families) <── score.ts (UNCHANGED, family-generic) <── raw/  ──> render --substrate

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `benchmark/planning-keys/plan-callers-*.json` | Create | Hand-authored set key + `source_ddl_refs` |
| `benchmark/planning-keys/plan-blindspots-*.json` | Create | `blind_spots[]` + `scope[]` + refs |
| `benchmark/planning-keys/plan-order-*.json` | Create | `scope[]` + `precede[[u,v]]` + refs |
| `benchmark/scorer/index.ts` | Modify | Register 3 families (type/FAMILIES/switch/GT shapes) |
| `benchmark/scorer/families.ts` | Modify | 3 comparators incl. new `comparePlanOrder` |
| `benchmark/harness-checks.ts` | Modify | `deriveCoverageTargets` plan cases; `CREATE_OBJECT_RE` += PROCEDURE/FUNCTION |
| `benchmark/generate.ts` | Modify | `--substrate`; read-key path; substrate-aware N-bound + scope-excluded leak guard |
| `benchmark/build-packets.ts` | Modify | `--substrate`; mssql stripped-DDL dump; manifest substrate field |
| `benchmark/render.ts` | Modify | Optional `--substrate` caption (absent ⇒ byte-identical) |
| `test/benchmark/scorer.test.ts` | Modify | Comparator units incl. topo matrix |
| `test/benchmark/harness-checks.test.ts` | Modify | Plan coverage-target + regex + non-leak regression |
| `test/benchmark/mssql-substrate.test.ts` | Create | Docker-gated live pipeline proof |
| `test/benchmark/fixtures/plan-*.json` | Create | Committed stubs for comparator units |

## Interfaces / Contracts

```ts
'plan-callers':    { readonly callers: readonly string[] };
'plan-blindspots': { readonly blind_spots: readonly string[]; readonly scope: readonly string[] };
'plan-order':      { readonly scope: readonly string[];
                     readonly precede: readonly (readonly [string, string])[] };
// every plan key also carries: source_ddl_ref: string; source_ddl_refs: Record<string,string>
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (Batch A) | 3 comparators; topo matrix (valid / alt-valid / violation / missing / dup / extra / empty / quoted / no-pairs) | RED-first; `.toStrictEqual`; committed `fixtures/plan-*.json` |
| Unit (Batch A) | `deriveCoverageTargets` plan cases; `CREATE_OBJECT_RE` PROCEDURE/FUNCTION; scope-excluded non-leak | Inline literals; frozen-set regression style (benchmark-guard-precision pattern) |
| Integration (Batch B) | Live mssql pipeline: index → build-packets → dump embeds SP bodies + coverage passes | `describe.skipIf(!DBGRAPH_INTEGRATION)` via `container.ts` |

## Migration / Rollout

No migration. Removal = delete `benchmark/planning-keys/` + the change folder; frozen sqlite state
restores exactly (D6).

## Task Batching

- **Batch A** (Docker-free, `npm test`): harness-checks + scorer (3 families/comparators) + committed
  planning-keys + unit tier.
- **Batch B**: substrate pipeline (`generate`/`build-packets`/`render` `--substrate`) + Docker-gated
  packet-build proof.

## Open Questions (for spec reconciliation)

- [ ] plan-callers framing: WHICH routine's signature changes vs which callers are the answer —
  proposal wording ("signature change to usp_refresh_totals", key `{usp_refresh_totals}`) implies the
  callee is `usp_log_change` (EXEC site torture.sql:263); spec MUST pin the exact question + key.
- [ ] Spec must define the SCOPE-block delimiter/marker so both leak guards exclude the same region.
- [ ] Spec re-anchor: impact-circularity citation (proposal cited `spec.md:320-322`; canonical
  `openspec/specs/benchmark/spec.md` puts it near line 53) — spec phase re-anchors.
- [ ] Confirm N-bound relaxation (3) is acceptable as the mssql pre-registered set size.

## Reconciliation (orchestrator rulings, 2026-07-10 — BINDING for tasks/apply/verify)

Spec and design were written in parallel; reconciled as follows:

- **(r1) plan-callers framing PINNED**: the question is a signature change to the CALLEE `usp_log_change` ("a required parameter must be added to usp_log_change — which routines call it and must be updated?"). The key is the COMPLETE set of its callers planted in the fixture — expected `{usp_refresh_totals}` (EXEC site, torture.sql:253-265 region), but apply MUST grep the ENTIRE fixture for every call site of `usp_log_change` when planting the key (completeness by DDL audit, not assumption). The proposal's scenario-table wording "signature change to usp_refresh_totals" was self-inconsistent (a routine is not its own caller) and is superseded by this ruling.
- **(r2) SCOPE block markers PINNED**: the scope list is delimited by the literal marker lines `=== SCOPE BEGIN ===` and `=== SCOPE END ===` (own lines, uppercase). The leak-guard exclusion of that region is implemented ONCE as a shared pure helper in `benchmark/harness-checks.ts` and called by BOTH generate's assertNoAnswerLeak path and build-packets' assertPacketPair path — never two hand-copied patterns. Both conditions' packets carry the IDENTICAL scope block.
- **(r3) N bound**: delta spec amended (requirement 1) — planning substrate sets pre-register FIXED N 3–10; anti-cherry-pick clause added (every committed question runs and is reported). v2 ships N=3.
- **(r4) Coverage**: plan-order's coverage row is kind-agnostic over the SCOPED OBJECT SET (tables + routines), per the spec's phrasing; `CREATE_OBJECT_RE` gains `PROCEDURE|PROC|FUNCTION` (D2c) — a real correctness blocker the design caught; its regression test is mandatory in Batch A.
