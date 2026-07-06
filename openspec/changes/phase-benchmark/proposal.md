# Proposal: Phase benchmark — WITH/WITHOUT dbgraph, own honest numbers (US-035)

## Intent

The README makes ONE testable claim: an AI agent answering database-schema questions WITH dbgraph
graph context (exact catalog data via `dbgraph query` / `explore` / `affected`) is more accurate
and/or spends fewer context tokens than the SAME agent WITHOUT it (a raw DDL dump). US-035 says the
README "promises nothing I have not tested." Today that number does not exist. This change ships the
apparatus to produce it — and, because the project owner explicitly rejects inflated claims, it ships
that apparatus honesty-first: a self-run benchmark that overstates its meaning is WORSE than no
benchmark, so methodology limitations travel WITH the numbers, never buried.

Why now: every dependency is shipped — US-016 (`precheck`/`affected` impact engine), US-018 (MCP
instructions), US-027 (SQL Server adapter). The CLI surface the WITH condition needs is already built
and present in `dist/` (`query`, `explore`, `affected`, `status`, all with `--json`). A real mssql
validation graph already exists at `C:\temp\dbgraph-validation\.dbgraph\`. Nothing external gates this.

Success = a REPRODUCIBLE harness (question set + mechanical ground truth + two condition protocols +
deterministic scorer) that anyone can re-run with their own agent, plus a `docs/benchmarks.md` whose
limitations section is as prominent as its results. `npm test` stays green WITHOUT running the
benchmark.

## Scope

### In Scope

- **Question set** (`benchmark/questions.yaml`) — 5–10 real schema tasks in the three families US-035
  names: join-query authoring, column-rename impact analysis, module/relationship explanation. Each
  question is phrased ONCE and served IDENTICALLY to both conditions.
- **Mechanical ground truth** — answer keys DERIVED from the graph/DDL by a documented, re-runnable
  step (queries over the graph or the fixture's own DDL), NOT hand-invented answers. This is the
  primary defense against the author unconsciously biasing questions toward dbgraph's strengths.
- **Two condition protocols** — `benchmark/protocols/with.md` (agent may run the dbgraph CLI against
  the indexed graph) and `benchmark/protocols/without.md` (agent is handed the raw DDL/`.schema` dump
  an agent would realistically get today). Same model framing, same system prompt, same questions;
  the ONLY difference is schema access.
- **Deterministic scorer + unit tests** — `benchmark/scorer/` scores a run's answers against the
  ground-truth key (exact-match / set-match for closed-form questions) and computes the token
  accounting per condition. Scorer unit tests live under `test/benchmark/` and run inside `npm test`.
- **`docs/benchmarks.md`** — methodology, the FULL limitations list, a results section the
  orchestrator fills after running both conditions, and a "reproduce it yourself" walkthrough.
- **The run itself** — executed by the ORCHESTRATOR between apply and verify (WITH/WITHOUT sub-agents
  in isolated context), scored, and written into the results section. Not a vitest suite.
- **Reproducible-first substrate** (see Approach) — the committed SQLite torture fixture is the
  load-bearing benchmark; the real mssql graph is optional, clearly-labeled corroboration.
- **US-035 story reconciliation** — update the story note to match what was actually delivered.

### Out of Scope

- HTTP/SSE MCP transport — the benchmark drives the shipped CLI only.
- Multi-model comparison — SINGLE model family (Claude). No cross-model generalization is claimed.
- Publishing results externally (npm publish, README numbers, a public leaderboard) — README numbers
  land later with US-036; this change only produces `docs/benchmarks.md`.
- Statistical significance testing — N is 5–10 on one/two schemas; no p-values, no confidence intervals.
- Peak-memory / index-size instrumentation of `init+sync` as a hard requirement — reported only if
  trivially observable during the real-graph run; NOT the core deliverable.
- Any change to `src/**` product behavior or to `dist/`.

## Capabilities

### New Capabilities

- `benchmark`: the reproducible WITH/WITHOUT evaluation METHODOLOGY as a durable contract — the
  question-set schema, the mechanical ground-truth derivation rule, the two condition protocols, the
  deterministic scorer contract (closed-form vs rubric questions), the token-accounting definition,
  and the honesty/limitations requirements that MUST accompany any published number.

### Modified Capabilities

- None. No `src/**` behavior changes; no existing spec's requirements change.

## Approach

**Reproducible-first, dual substrate** (key decision, made deliberately for honesty):

1. **PRIMARY = committed SQLite torture fixture** (`test/fixtures/sqlite/torture.sql`, 54 objects:
   tables, composite FK, WITHOUT ROWID, views, 6 triggers, partial/expression indexes). Anyone can
   rebuild the graph from committed DDL and re-run the whole benchmark with their own agent. Smaller
   than a real enterprise DB, but PEER-CHECKABLE — this is what makes the number credible.
2. **SECONDARY (optional) = the real mssql graph** at `C:\temp\dbgraph-validation`, used ONLY if the
   run phase confirms it opens (`dbgraph status`). Reported as a larger-scale, NON-reproducible
   corroboration, explicitly labeled with its provenance limits (see reconciliation below).

**Honest reconciliation with US-035's letter.** US-035 asked for a "dedicated read-only login (NEVER
application credentials)" and zero writes "verifiable by the read-only user: it CANNOT write." The
actual validation config uses `integrated` (Windows SSPI) auth — the author's own principal, NOT a
dedicated read-only login. So the zero-writes guarantee is DOWNGRADED and stated as such: writes are
prevented BY CONSTRUCTION of the tool (dbgraph issues only catalog `SELECT`s — the README's inviolable
read-only invariant), NOT enforced by a restricted DB grant. The SSMS-accuracy contrast US-035 names
becomes an author attestation, labeled as such, not a machine-verified figure.

**Flow.** apply builds the harness (RED→GREEN on the scorer's unit tests) → orchestrator RUNS both
conditions per question and records transcripts + token counts under `benchmark/runs/` → scorer
produces accuracy + token deltas → orchestrator writes `docs/benchmarks.md` results → verify checks
the harness and that limitations are present alongside results.

**Token accounting.** Prefer ACTUAL usage reported by the agent runtime when available; otherwise
approximate as characters/4 and LABEL it as an approximation with its known imprecision. The accounting
boundary is fixed and stated: every schema-bearing token the agent sees — the WITHOUT dump up front,
the WITH tool outputs on demand — counted the same way for both conditions.

**Zero product deps.** The scorer uses node builtins + vitest (already a devDependency). No new runtime
dependency; nothing ships to `dist/` (the `files` whitelist is `dist` only, so `benchmark/` is never
published).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `benchmark/questions.yaml` | New | 5–10 questions across join / rename-impact / explanation families; served identically to both conditions |
| `benchmark/ground-truth/` | New | Answer keys DERIVED mechanically from the graph/DDL, with the derivation step documented and re-runnable |
| `benchmark/protocols/with.md`, `benchmark/protocols/without.md` | New | The two condition protocols; identical framing, schema-access is the only difference |
| `benchmark/scorer/` | New | Deterministic scorer: closed-form exact/set match + token accounting; rubric questions flagged non-deterministic |
| `benchmark/runs/` | New | Orchestrator drops raw transcripts + token counts here during the run |
| `test/benchmark/scorer.test.ts` | New | Scorer unit tests — part of `npm test`; keep the suite green with no benchmark run |
| `docs/benchmarks.md` | New | Methodology + FULL limitations + results (filled post-run) + reproduce-it-yourself |
| `docs/stories/07-quality-publication.md` | Modified | US-035 status/note reconciled to what shipped (harness + torture-fixture-first + integrated-auth downgrade) |
| `openspec/specs/benchmark/spec.md` | New (via sdd-spec) | The `benchmark` methodology contract, authored in the spec phase |
| `tsconfig`/`eslint` include | Possibly modified | May need to cover `benchmark/**` + `test/benchmark/**` (design decides) |

## Risks

| Risk (threat to benchmark VALIDITY) | Likelihood | Mitigation |
|------|------------|------------|
| Self-run bias — author designs, runs AND scores their own eval | High | Mechanical ground truth; deterministic scorer; questions pre-registered (fixed) BEFORE any run; reproduce-it-yourself so third parties can independently re-run and refute |
| Leading questions phrased to favor the graph | High | Derive questions neutrally from the schema; phrase each ONCE, identical across conditions; INCLUDE questions where dbgraph is not expected to help, to avoid cherry-picking |
| Ground-truth leakage into prompts (the answer key pasted into a condition input) | High | The scorer key is held SEPARATELY from condition inputs; questions require lookup/reasoning, never verbatim copy; a check asserts no key text appears in any prompt |
| Condition asymmetry / token-unfairness (WITHOUT gets a strawman dump; accounting differs) | High | WITHOUT uses the REALISTIC DDL/`.schema` an agent gets today, not a bloated one; one fixed accounting boundary applied identically to both; both get the same model + system framing |
| Overclaiming from small N / single schema / single model | High | `docs/benchmarks.md` states N, schema(s) and model up front; per-question results reported, not just aggregate; no significance claimed; multi-model explicitly out of scope |
| Real-graph provenance overstated (read-only "enforced" vs integrated auth) | Med | Downgrade stated explicitly: read-only BY CONSTRUCTION of the tool, not by a restricted grant; SSMS contrast labeled as author attestation |
| `npm test` accidentally coupled to a benchmark run | Med | Benchmark is NOT a vitest suite; only the scorer's own unit tests run in `npm test`; a run is an orchestrator step |
| Real validation graph unusable/absent at run time | Med | Torture fixture is the load-bearing PRIMARY substrate; the deliverable never depends on the private graph |
| Scorer subjectivity on open-ended "explain" questions | Med | Prefer closed-form questions with checkable ground truth; rubric-scored items FLAGGED as non-deterministic and reported separately |

## Rollback Plan

Fully additive and outside `src/`/`dist/`. Delete `benchmark/`, `test/benchmark/`, `docs/benchmarks.md`,
the new `openspec/specs/benchmark/spec.md`, revert the US-035 story note, and revert any
`tsconfig`/`eslint` include change. No runtime dependency was added. `npm test` returns to its prior
green state; the product, CLI, adapters and MCP server are untouched.

## Dependencies

- US-027 (SQL Server adapter, shipped) — provided the real mssql validation graph.
- US-016 (`precheck`/`affected`, shipped) and US-018 (MCP instructions, shipped) — the WITH condition
  exercises the shipped `affected` impact engine for the rename-impact family.
- The shipped CLI in `dist/` (`query`/`explore`/`affected`/`status`) — the WITH condition's tool
  surface. `dist/` is already built (`npm run build` if stale; exit-0 confirmed).
- ZERO new runtime dependencies. Scorer uses node builtins + the existing vitest devDependency.

## Stories

- Mapped: **US-035** — reconciled honestly. Delivered as a REPRODUCIBLE harness + `docs/benchmarks.md`
  with torture-fixture-first substrate; the real-DB run is optional corroboration with its integrated-auth
  read-only guarantee downgraded to read-only-by-construction, and the SSMS contrast labeled as author
  attestation. Duration/index-size/peak-memory are reported opportunistically, not as hard gates.
- Unblocks: **US-036** (v0.1 publication) — supplies the benchmark numbers + methodology link the README
  will cite. Publishing those numbers is US-036's job, not this change's.

## Success Criteria

- [ ] Anyone can rebuild the torture-fixture graph and re-run the WITH/WITHOUT protocol with their own
      agent by following `docs/benchmarks.md` — reproducible, no private DB required.
- [ ] Ground truth is DERIVED mechanically from the graph/DDL (documented, re-runnable), not authored by hand.
- [ ] Both conditions receive IDENTICAL questions and model/system framing; schema access is the only difference.
- [ ] The scorer is deterministic for closed-form questions; rubric-scored items are flagged as non-deterministic.
- [ ] Token accounting method is stated (actual usage preferred; chars/4 labeled as an approximation) and
      applied identically to both conditions.
- [ ] `docs/benchmarks.md` presents ALL limitations (self-run, single model family, small N, single/dual
      schema, not peer-reviewed, non-reproducible secondary run, integrated-auth downgrade) ALONGSIDE the
      results, not buried.
- [ ] `npm test` is green WITHOUT any benchmark run; the scorer unit tests pass inside it.
- [ ] No writes to any target database; the real validation graph, if used, is opened read-only.
