# Proposal: Explore Payloads — render the facts the graph already stores

## Intent

The US-035 benchmark (`docs/benchmarks.md`, run `torture-2026-07-06`) is the trigger: WITH-dbgraph
LOST **40% vs 80%** WITHOUT on the committed torture fixture, spending 2.2× the tokens. The
verify-report (`archive/2026-07-06-phase-benchmark`) independently confirmed the ROOT CAUSE is a
PRODUCT gap, not a graph-data gap: the graph STORES the exact facts in node payloads
(`ColumnPayload` dataType/nullable/default; `ConstraintPayload` type + ordered columns + FK
definition; `TriggerPayload` timing/events; `IndexPayload` unique/columns) — ground truth was
mechanically derived from them via the store API — but `formatExplore` (`src/core/present/explore.ts`)
reads payload ONLY for `hasDynamicSql`. Two WITH agents burned 49–69 tool calls and still could not
retrieve a column type, a PK column list, or an FK column mapping. `affected --json` (the one
structured-fact command) produced the only two WITH wins.

Now is the moment: the harness is frozen and re-runnable, so a payload-rendering fix can be measured
against the identical fixture/questions/model with only the tool surface changed.

KEY DISCOVERY (reconciliation, task item 5): `formatObject` (`src/core/present/object.ts`) ALREADY
renders exactly the missing facts — COLUMNS (type/null/default, `[PK]`/`[FK→target]`/`[NN]`),
CONSTRAINTS (kind + ordered columns + FK target), INDEXES (unique/columns), TRIGGERS (timing/events),
BODY — gated by detail. But `formatObject` is reachable ONLY via the MCP `dbgraph_object` tool; the
CLI has NO `object` command (dispatch: init/sync/status/query/explore/diff/affected/install/doctor).
The payload-rendering presenter EXISTS but is MCP-exclusive — a CLI-only agent (the benchmark WITH
condition, limited to query/explore/affected/status) literally cannot reach it.

Success = a CLI/MCP agent retrieves column type/nullability, ordered PK membership, and FK column
mapping in ONE explore call; explore and object stay coherent (one payload-render source); goldens
re-blessed deliberately; and a labeled second benchmark table reports whatever the re-run shows.

## Scope

### In Scope
- Render the FOCUS node's per-kind payload in `formatExplore` (shared formatter → CLI `explore` AND
  MCP `dbgraph_explore` inherit together, "same source same golden"): column type/nullable/default;
  constraint kind + ordered columns + FK target mapping; trigger timing/events; index
  unique/columns/expression; table/view/routine useful metadata. Gate on `--detail` (payload at
  normal+; heavier at full) to respect `docs/format-spec.md` Phase-5 budgets.
- For container nodes (table/view), surface a COMPACT column + PK/FK summary from the
  `has_column`/`has_constraint` neighbor payloads explore already receives, so `explore <table>`
  answers "columns + PK" in one call.
- Extract per-kind payload rendering into ONE pure helper module consumed by BOTH `formatExplore`
  and `formatObject` (refactor object onto it) — coherence by construction, no duplication, no drift
  (ADR-004).
- Expose an `object` CLI command (thin dispatch wrapper over the EXISTING `formatObject` presenter,
  mirroring `dbgraph_object`) — closes the CLI↔MCP surface asymmetry the benchmark exposed; output
  byte-identical to the MCP tool.
- Paper cuts (small, same run): validate `--detail` — reject unknown values with a `ConfigError`
  naming the offending value (established style; today `dispatch.ts` silently coerces garbage →
  `normal`); fix the explore header rendering a VIEW as `[table]` (verified NOT an adapter mislabel —
  `sqlite/map.ts` emits `kind:'view'` — so a presentation/resolution defect; design pins the locus).
- Golden re-bless protocol: update `docs/format-spec.md` grammar + per-detail budgets for the new
  explore payload lines, then DELIBERATELY re-capture `explore-{brief,normal,full}` goldens + any
  object-CLI goldens with a token-delta justification (format-spec §6). The http-transport
  cross-transport parity test reads the golden FILE and asserts HTTP==STDIO==golden, so it survives
  re-bless automatically (verified in `test/mcp/http.test.ts` task 3.3).
- Benchmark re-run (the payoff): orchestrator re-runs the frozen US-035 harness (run-id
  `explore-payloads-2026-MM-DD`); `docs/benchmarks.md` gains a SECOND results table LABELED with the
  code version; honest framing (same fixture/questions/model, only the tool surface changed);
  whatever the numbers show is reported.

### Out of Scope (deferred to backlog, justified)
- Per-command `--help` (generic-banner cut): broad CLI UX, unrelated to payloads — separate change.
- `affected` bare-identifier matching (schema-qualified requirement): precheck identifier-matching
  improvement, orthogonal to presentation — separate.
- `explore`-by-id (query returns ids explore rejects): a query↔explore resolution-input contract
  change; compounds but is distinct from payload rendering — separate (focus-payload rendering
  already lets an agent answer via qname, reducing the need).
- SQLite view-dependency extraction (`supportsDependencyHints=false`): adapter/extraction work, not
  presentation (benchmark Run note #2).

## Capabilities

### New Capabilities
- None. All work modifies existing capabilities; the shared payload-render helper is an internal
  pure module, not a user-facing capability.

### Modified Capabilities
- `mcp-server`: `formatExplore` renders per-kind payload; a shared payload-render helper also backs
  `formatObject`; `docs/format-spec.md` grammar + budget updates; deliberate golden re-bless;
  cross-transport parity preserved.
- `cli-config`: `--detail` validation (reject unknown → `ConfigError`); explore header kind-label
  fix; NEW `object` CLI command; CLI `explore` inherits payload output via the shared formatter.
- `benchmark`: a second, code-version-LABELED results table for the explore-payloads re-run; honesty
  contract unchanged (unfavorable results reported, no extrapolation).

## Approach

Hexagonal, presentation-only (ADR-004): payload facts already live on `GraphNode.payload`; this
change RENDERS them, it does not re-extract. Introduce a pure `src/core/present/payload.ts`
(core-types-only, deterministic — ADR-008) exposing per-kind render helpers; `formatObject` is
refactored onto it (behavior-preserving, existing object goldens hold) and `formatExplore` consumes
it for the focus node plus a compact container summary from neighbor payloads it already gathers.
Detail-gating keeps brief cheap and pins payload to normal/full within the measured format-spec
ceilings (explore normal/full have large headroom today: ~73/76 tk against 400/420). The CLI `object`
command is a thin dispatch wrapper reusing the existing `formatObject` — pure parity with
`dbgraph_object`.

Golden discipline is the safety rail: every byte change to explore output is a DELIBERATE re-bless
paired with a format-spec edit + token-delta note (§6), reviewed — never a silent regeneration. The
cross-transport parity test reads the golden file, so re-blessing updates both transports at once.

The benchmark re-run is orchestrator-run AFTER implementation on the frozen harness; the second table
is labeled with the code version and framed honestly per the standing no-extrapolation /
no-suppression contract.

Recommended apply batches: **A)** shared payload helper + refactor `formatObject` (goldens hold) →
**B)** `formatExplore` focus payload + container summary + explore golden re-bless + format-spec/budget
update → **C)** CLI `object` command + `--detail` validation + header kind-label fix →
**D)** (orchestrator) benchmark re-run + second `docs/benchmarks.md` table.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/present/payload.ts` | New | Pure per-kind payload-render helpers (single source) |
| `src/core/present/explore.ts` | Modified | Render focus-node payload + compact container summary via the helper |
| `src/core/present/object.ts` | Modified | Refactor onto the shared helper (behavior-preserving) |
| `src/cli/commands/object.ts` | New | CLI object handler wrapping `formatObject` (mirrors `runExplore`) |
| `src/cli/dispatch.ts` | Modified | Register `object`; validate `--detail` (throw `ConfigError` on unknown) |
| `docs/format-spec.md` | Modified | Explore payload grammar + updated per-detail budgets + token-delta note |
| `test/mcp/golden/explore-*.txt`, `test/core/present/golden/` | Modified/New | Deliberate re-bless; new object-CLI goldens |
| `test/core/present/budget.test.ts` | Modified | Re-assert explore ceilings after re-measure |
| `docs/benchmarks.md` | Modified | Second code-version-labeled results table (orchestrator re-run) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Payload rendering blows explore token budget | Med | Detail-gate (payload at normal+); re-measure; large headroom today (73/76 vs 400/420); update ceilings with justification if needed |
| Silent/incorrect golden re-bless | Med | format-spec §6 protocol: spec edit + token-delta + review; parity test reads the file |
| explore/object drift into incoherence | Med | ONE shared render helper; refactor object onto it so both share the source |
| Benchmark re-run shows no/negative improvement | Med | HONESTY contract: report whatever it shows, code-version-labeled, scoped to fixture/set/model — an unfavorable second table is still the truthful outcome |
| `[table]` root cause deeper than presentation | Low | Verified adapter emits `kind:'view'`; design pins the exact resolution/label locus before coding |
| Scope creep via CLI object command | Low | Thin wrapper over an EXISTING presenter; no new rendering logic |

## Rollback Plan

Additive and presentation-only. Revert by: deleting `src/core/present/payload.ts` and the CLI
`object` command (dispatch entry + handler); restoring `formatExplore`/`formatObject` to their prior
bodies; reverting the format-spec grammar/budget edits and re-blessed goldens (git revert of the
golden commit restores the byte-pins); reverting the `docs/benchmarks.md` second table. No
schema/store/extraction change is touched, so the graph, adapters, query, and existing CLI/MCP
surfaces stay green. The benchmark harness is frozen and untouched.

## Dependencies

- Consumes existing store reads (`getNeighbors`, `getNodeByQName`) and the existing
  `GraphNode.payload` — no new runtime dependency, no re-extraction.
- Benchmark re-run requires Node ≥22.6 (harness only) on the frozen US-035 set; orchestrator-run
  after implementation.

## Stories

- Primary: the US-035 benchmark follow-up (verify-report SUGGESTION #2 / Run note #1: "render node
  payloads in explore"). US-036+ product follow-up.
- Deferred: per-command `--help`, `affected` bare-identifier matching, `explore`-by-id, SQLite
  view-dependency extraction.

## Success Criteria

- [ ] `explore <column>` shows dataType + nullability; `explore <table>` shows ordered PK columns +
      column types; `explore <fk-constraint>` shows the FK column→target mapping — each in ONE call.
- [ ] `formatExplore` and `formatObject` render payload facts through ONE shared pure helper (no
      duplicated per-kind logic).
- [ ] A CLI `object` command exists and its output is byte-identical to `dbgraph_object`
      (same-source-same-golden).
- [ ] `explore --detail bogus` fails with a `ConfigError` naming the value; the explore header labels
      a view as `[view]`.
- [ ] Explore goldens re-blessed with a matching `docs/format-spec.md` grammar + token-delta note;
      budget assertions pass; the cross-transport parity test is green.
- [ ] `docs/benchmarks.md` carries a SECOND results table labeled with the code version, framed
      honestly (same fixture/questions/model, tool surface only), reporting whatever the re-run shows.
- [ ] Target database remains strictly read-only; ADR-004 boundary test green.
