# Design: Explore Payloads — render the facts the graph already stores (explore-payloads)

## Technical Approach

Presentation-only, ADR-004 (payload facts already live on `GraphNode.payload`; this change RENDERS
them, it does NOT re-extract). Introduce ONE pure module `src/core/present/payload.ts` exposing
per-kind section renderers (`string[]` in, `string[]` out — no I/O, core types only, ADR-008).
`formatObject` is refactored onto it BYTE-IDENTICALLY (its `object-tool-{brief,normal,full}.txt`
goldens are the REFACTOR transparency proof — the extraction step MUST NOT change them). `formatExplore`
consumes the SAME helper so a TABLE/VIEW focus renders the SAME `COLUMNS`/`CONSTRAINTS`(/`INDEXES`/
`TRIGGERS`/body) sections `formatObject` renders — BYTE-IDENTICAL, same renderers, same detail-gating
(D2) — while a COLUMN/CONSTRAINT/INDEX/TRIGGER focus renders that node's own per-kind payload line(s)
via `renderFocusPayload`. FK column→target mapping renders from the constraint payload when present,
else is RECONSTRUCTED from the table's `references` edge when unambiguous, else degrades to columns
WITHOUT a target — never guessed (D8). Because both formatters share ONE source, CLI `explore` and MCP
`dbgraph_explore` inherit the same output ("same source, same golden"). Payload is detail-gated to keep brief cheap and
sit inside the measured `docs/format-spec.md` ceilings (explore normal/full measure **73/76 tk** TODAY,
pre-payload, against **400/420** — large headroom; RE-MEASURED in Batch B after the sections land, ceilings
widened with a §6 note only if a fixture exceeds them). A thin CLI `object` command wraps the EXISTING `formatObject`
presenter for pure parity with `dbgraph_object`. The `[view]→[table]` mislabel is fixed at the
RESOLUTION layer (stub-preference), never in normalize. Every explore byte change is a DELIBERATE
re-bless paired with a format-spec grammar/budget edit + token-delta note (§6).

## Architecture Decisions

### Decision: D1 — One pure `payload.ts`; section renderers return `string[]`; `formatObject` refactors onto it byte-identically
**Choice**: Extract the per-kind blocks currently inline in `object.ts` into pure functions that
return section-body lines (header row + entry rows) WITHOUT the leading blank separator; the callers
keep pushing `''` between sections. `deriveColumnAnnotations(constraints, references)` computes the `pk`
set + `fk` colname→target map ONCE (target from constraint payload `definition` when present, else
reconstructed from the `references` edges per D8). `renderColumns / renderConstraints / renderIndexes / renderTriggers`
each return `[]` when empty. `formatObject` becomes: header → `push('')` + `...renderColumns()` →
`push('')` + `...renderConstraints()` → gate → indexes/triggers/body. | **Alternatives**: (a) renderers
own their own leading blanks; (b) duplicate the loops in `explore.ts`; (c) a single monolithic
`renderPayload(node,neighbors,detail)`. | **Rationale**: (a) makes byte-identity fragile (double/absent
blanks); (b) is the drift the proposal forbids; (c) can't compose the DIFFERENT section subsets
explore vs object need. Returning body-only lines and keeping the `push('')` cadence in the caller
reproduces today's exact bytes — that is the refactor-transparency proof (object goldens unchanged).

### Decision: D2 — Explore payload is detail-gated and BYTE-IDENTICAL to object's sections (spec parity contract wins)
**Choice**: `brief` renders NO payload (stays 14 tk, byte-identical golden). For a TABLE/VIEW focus,
`normal`+`full` render the EXACT SAME sections `formatObject` renders — `COLUMNS` + `CONSTRAINTS` at
`normal`, `+INDEXES` + `TRIGGERS` (+ body for modules) at `full` — through the SAME shared section
renderers, in the SAME order, BYTE-IDENTICAL to `object <qname>` for that node (parity tests come free).
For a COLUMN/CONSTRAINT/INDEX/TRIGGER focus, `normal`+ render that node's OWN per-kind payload line(s)
via `renderFocusPayload(node)` (column→`dataType`/nullable/default + PK/FK markers; constraint→type +
ordered columns + FK target; index→unique/columns/method; trigger→timing/events) using the SAME per-kind
line grammar. `full` keeps the existing bodyHash/level/dynamic-SQL block. The explore-specific neighbor
listing (grouped in/out qnames) is retained AFTER the payload sections. | **Alternatives**: (a) a SEPARATE
COMPACT one-line-per-column "container summary" variant distinct from object's sections (REJECTED per
orchestrator ruling 1); (b) payload only at `full`; (c) payload at all levels incl. brief.
| **Rationale**: the SPEC's byte-identical-to-object contract WINS over a bespoke compact summary: it is a
simpler VERIFIABLE contract (the CLI/MCP explore↔object parity tests fall out for free, no divergent
grammar to spec), and the budget headroom is ample — employees at explore `normal`/`full` measures
**73/76 tk** against the **400/420** ceilings, so reusing object's fuller sections costs nothing we
cannot afford. Rejected alternative (a) was attractive for token thrift but bought a SECOND grammar to
document + pin and a drift surface between the summary and object; with headroom this wide the thrift is
not worth the divergence. Default `--detail` is `normal`, so every success criterion ("`explore <column>`
shows type+nullability", "`explore <table>` shows ordered PK + column types", "`explore <fk-constraint>`
shows FK mapping — each in ONE call") holds at the DEFAULT level. Brief is the cheap-scan tier; polluting
it breaks its contract. Re-measure in Batch B; only widen ceilings (with a §6 note) if a fixture exceeds
them — the re-measure task + ceiling-policy delta already cover the wide-table risk.

### Decision: D3 — Fix `[view]→[table]` at the RESOLUTION layer by preferring non-`missing` nodes (NOT in normalize)
**Choice**: In BOTH resolvers — `runExplore` (`src/cli/commands/explore.ts:48-51`) and the MCP
`resolveNode` (`explore.ts` + `object.ts`) — collect ALL `NODE_KINDS` matches, then prefer a real
node over stubs: `const real = matches.filter(n => !n.missing); const effective = real.length ? real
: matches;`. CLI replaces its first-match `break` with `effective.find(...)`; MCP runs its
single/candidates/notFound branches on `effective`. | **Alternatives**: (a) reorder `NODE_KINDS` so
`view` precedes `table`; (b) fix the true cause in `reference-resolver.ts`; (c) filter by kind in the
header only. | **Rationale**: PINNED root cause (verified against `test/fixtures/sqlite/torture.sql`):
`buildFiresOnEdges` (`src/core/normalize/reference-resolver.ts:192`) hard-codes
`resolveOrStub('table', …)` for a trigger's target, but `trg_active_dept_instead_insert` fires
`INSTEAD OF INSERT ON active_departments` — a VIEW. The lookup key `table:main.active_departments`
misses the real `view:` node and MINTS a phantom `table` stub (`missing:true`). `NODE_KINDS` lists
`table`(idx 2) before `view`(idx 6), so first-match-wins returns the phantom → header `[table]`; the
MCP tool would falsely report "Ambiguous". Preferring `missing:false` fixes BOTH surfaces with a
presentation/resolution-only change (proposal scope). (a) breaks unrelated ordering assumptions and
still returns a phantom when the real node is absent; (b) is a re-extraction fix — OUT of this
change's presentation-only scope (recorded as an Open Question for a future normalize change).

### Decision: D4 — `--detail` validated by ONE pure `parseDetail` throwing `ConfigError` (exit 2), reused across handlers
**Choice**: Add pure `parseDetail(raw: unknown): ExploreDetail` (in `src/cli/parse/` or alongside
dispatch): returns the value for `brief|normal|full`, defaults `undefined`→`normal`, THROWS
`ConfigError` naming the value for anything else. Replace the silent-coercion ternaries in
`handleExplore` AND `handleAffected` (`dispatch.ts:201-204`, `231-234`) with `parseDetail(...)`. The
new `object` handler uses it too. | **Alternatives**: inline validation per handler; a Zod schema.
| **Rationale**: today garbage silently coerces to `normal` (a correctness trap). `ConfigError` is the
established `DbgraphError` subclass that maps to exit 2 (`exit-code.ts`: "any DbgraphError → 2"),
consistent with http-transport D4's `--port` handling. One pure validator = one message shape, one
unit test, three call sites. Message shape mirrors the MCP tools' wording:
`explore: "detail" must be one of brief|normal|full (got "bogus")`.

### Decision: D5 — CLI `object` is a MINIMAL wrapper over the EXISTING `formatObject`; byte-identical to `dbgraph_object`; no `--json`
**Choice**: New `src/cli/commands/object.ts` `runObject({store,qname,detail})` mirroring `runExplore`:
resolve (via the D3-corrected loop) → `getNeighbors` → `formatObject(view, detail)` → `ExploreOutcome`.
Register `object: handleObject` in `COMMAND_TABLE`; `handleObject` reads `positionals[0]` (qname) +
`parseDetail`. NO `--json` (the MCP `dbgraph_object` tool has none — parity + minimal). Add a banner
line to `USAGE_TEXT`, aligned to the pinned 10-char command column, after `explore`:
`  object    Show one object in full (columns, constraints, indexes, triggers)`. | **Alternatives**:
add `--json`; build a NEW object presenter; expose a shared `runInspect`. | **Rationale**: the presenter
already EXISTS and is MCP-exclusive — the benchmark's CLI-only agent literally couldn't reach it. A
thin dispatch wrapper reusing `formatObject` guarantees byte-identity with `dbgraph_object`
(same-source-same-golden) and adds ZERO rendering logic. The banner has pinned golden tests → the
insertion is a deliberate, alignment-preserving re-bless.

### Decision: D6 — Deliberate golden re-bless: explore normal/full + object FK lines change; refactor stays transparent; object-CLI verified by parity
**Choice**: Re-bless `test/mcp/golden/explore-{normal,full}.txt` (payload sections + reconstructed FK);
`explore-brief.txt` is UNCHANGED (no payload at brief) and stays a pin. Object goldens are handled in TWO
distinct steps: (1) the pure REFACTOR (Batch A) keeps `object-tool-*.txt` BYTE-IDENTICAL — that is the
transparency proof; (2) the D8 FK-reconstruction FEATURE DELIBERATELY re-blesses ONLY the `employees` FK
column + constraint lines in `object-tool-{normal,full}.txt` (all other object lines stay byte-identical),
§6-noted, as the SAME logical change that re-blesses explore — because both share the helper, a single
reconstruction cannot alter one surface without the other. CLI `object` output is asserted by a PARITY
test against the (now re-blessed) EXISTING `object-tool-*.txt` — NO duplicate object golden set (ruling 4).
Add a DEDICATED explore golden for a VIEW focus (`main.active_departments` → header `[view]` + payload) —
this pins BOTH the `[view]` resolution fix (D3) and payload rendering that both land there; cheap and
worth it (ruling 5). Update `docs/format-spec.md`: explore grammar + per-detail budget rows + §6
token-delta note (covering the reconstructed FK grammar); update `test/core/present/budget.test.ts`
ceilings after re-measure. | **Alternatives**: regenerate all goldens in bulk; add fresh object-CLI
goldens; cover the view fix with a unit test only (no golden). | **Rationale**: §6 protocol = every byte
change is spec-edit + token-delta + review, never silent regeneration. Splitting the object re-bless into
"refactor (no change) → feature (FK lines only)" PRESERVES the refactor-transparency proof while honestly
recording D8's byte impact. The http-transport cross-transport parity test (`test/mcp/http.test.ts`) reads
the golden FILE and asserts HTTP==STDIO==golden — content-agnostic, so it survives re-bless AUTOMATICALLY
(verified). Reusing object goldens for the CLI parity assertion proves the wrapper adds nothing.

### Decision: D7 — TDD seams per piece; benchmark re-run is an orchestrator step, not code
**Choice**: (a) `payload.ts` renderers — pure unit tests per kind on torture-derived payload fixtures,
RED-first. (b) `formatObject` refactor — existing object goldens stay green (no new tests; green ==
transparency). (c) `formatExplore` — re-blessed explore goldens + focus-payload unit tests. (d) D3
resolution — unit test: a node set with a real `view` + phantom `table` stub for one qname resolves to
the VIEW. (e) `parseDetail` — unit test: `bogus`→`ConfigError`, exit 2. (f) CLI `object` — parity test:
`runObject` bytes === `object-tool-*.txt`. The BENCHMARK re-run is an ORCHESTRATOR post-verify step
(no product code): run-id `explore-payloads-2026-MM-DD`; `build-packets.ts` regenerated against the
SAME frozen fixture — packet TEXT stays UNCHANGED (the 4-command list is pinned; confirm zero packet
drift); `docs/benchmarks.md` gains a SECOND results table LABELED with the commit; framing is
per-question deltas, same fixture/questions/model, no extrapolation, report whatever it shows
(HONESTY). | **Rationale**: matches the proposal's Batch A→D plan and the standing no-extrapolation /
no-suppression benchmark contract.

### Decision: D8 — FK column→target mapping: payload-first, else RECONSTRUCT from the `references` edge when unambiguous, else degrade (never guess)
**Choice** (orchestrator ruling 2 — resolves the SQLite FK-target open question): `deriveColumnAnnotations`
computes each FK column's target by this precedence, applied INSIDE the shared helper so `object` AND
`explore` get IDENTICAL results:
  1. **Payload target present** (mssql/pg/mysql carry it): render the constraint payload `definition`
     VERBATIM — column-level, e.g. `dbo.orders` → `[FK→dbo.customers.customer_id]` and
     `(customer_id → dbo.customers.customer_id)`.
  2. **Payload target ABSENT** (SQLite torture): RECONSTRUCT from the table's `references` edges. Unambiguous
     iff the references edge(s) matching this FK resolve to a SINGLE target table — satisfied when the
     table has exactly ONE outbound `references` edge OR this FK constraint is the table's ONLY FK (the
     `references` edge also carries `attrs.constraintName`, giving a precise per-constraint join when
     multiple FKs exist). Render the target TABLE's canonical `qname` — table-level (never a guessed
     column): `main.employees` FK on `dept_id` → column `  dept_id  INTEGER  [FK→main.departments]  [NN]`
     and constraint `  [FK]  fk_employees_0  (dept_id → main.departments)`. Composite likewise, e.g.
     `main.assignments` → `(emp_id, dept_id → main.employees)`.
  3. **Ambiguous / no resolvable target**: render the FK columns WITHOUT a target — column `[FK]` marker
     omitted (or bare), constraint line `  [FK]  <name>  (<cols>)`. HONEST degradation, never a guess.
| **Alternatives**: (a) NEVER reconstruct — keep the pre-change honest degradation everywhere on SQLite
(FK relationship still discoverable via the explore `references` neighbor line `→ main.departments [table]`);
(b) reconstruct a COLUMN-level target using the edge `attrs.dstColumn` (`main.departments.dept_id`).
| **Rationale**: reconstruction closes the SQLite gap the benchmark exposed (an agent gets the FK target in
ONE call) while staying presentation-only — it reads the `references` edges the graph ALREADY stores, no
re-extraction (ADR-004). Table-level (not column-level, alt (b)) is chosen because it stays clean for
COMPOSITE FKs (`(emp_id, dept_id → main.employees)` vs an ambiguous column-pair listing) and mirrors the
edge's authoritative endpoint (the `dst` is the target TABLE node); the payload-present path keeps its
richer column-level target since it is a FACT, not an inference (honest asymmetry: reconstruction yields
LESS precision than a full payload definition). Alt (a) was the safest for the transparency invariant but
leaves SQLite degraded when the fact is recoverable; ruling 2 prefers the reconstruction. The
schema-qualified `qname` (`main.departments`, NOT bare `departments`) is used for consistency with every
other rendered target and the `references` neighbor line. **CONSEQUENCE — object goldens (see D6)**:
because reconstruction lives in the SHARED helper, it also changes `object main.employees` (its FK column +
constraint lines), so the "object goldens never change" invariant softens to "the pure REFACTOR keeps them
byte-identical; the FK-reconstruction FEATURE is a DELIBERATE, §6-noted re-bless of ONLY the FK lines,
applied to object AND explore together" — verified: the torture `employees`/`assignments` FKs QUALIFY
(each has exactly one FK / one references edge).

## Data Flow

```
CLI: dbgraph explore <qname> --detail D        MCP: dbgraph_explore {target,detail}
  handleExplore: parseDetail(D) ──ConfigError──▶ exit 2        parseArgs
        │                                                          │
  runExplore/resolveNode: getNodeByQName × NODE_KINDS ─▶ prefer !missing (D3) ─▶ node
        │                                   (phantom table stub dropped → real view kept)
  getNeighbors(node) ─▶ NeighborGroups (has_column/has_constraint/has_index/fires_on/references)
        ▼
  formatExplore(view, detail) ── brief: header+counts (no payload)
        │        table/view focus, normal/full: SAME sections as object (byte-identical) + neighbor listing
        │        column/constraint/index/trigger focus: renderFocusPayload(node) + neighbor listing
        └──▶ payload.ts ─ deriveColumnAnnotations(constraints, references) ─▶ renderColumns/Constraints/…
                 ▲                                   (FK target: payload → reconstruct from references → degrade, D8)
  formatObject(view, detail) ─── renderColumns/Constraints/Indexes/Triggers ─┘  (SAME source, SAME bytes)
        ▲
CLI: dbgraph object <qname>  (handleObject → runObject → formatObject)  ≡ dbgraph_object bytes
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/present/payload.ts` | Create | Pure per-kind section renderers + `deriveColumnAnnotations(constraints, references)` (FK target: payload → reconstruct → degrade, D8) + `renderFocusPayload`. Core types only, `string[]`→`string[]`, ADR-004/008. |
| `src/core/present/object.ts` | Modify | Refactor sections onto `payload.ts`. Refactor step BYTE-IDENTICAL; FK-reconstruction (D8) DELIBERATELY re-blesses only the `employees` FK column + constraint lines (§6-noted, same change as explore). |
| `src/core/present/explore.ts` | Modify | table/view focus renders object's sections BYTE-IDENTICALLY; column/constraint/index/trigger focus renders `renderFocusPayload`; neighbor listing retained; brief unchanged. |
| `src/cli/commands/object.ts` | Create | `runObject` wrapper over `formatObject` (mirrors `runExplore`). |
| `src/cli/commands/explore.ts` | Modify | D3: collect matches, prefer `!missing`; drop first-match `break`. |
| `src/mcp/tools/explore.ts`, `src/mcp/tools/object.ts` | Modify | D3: `resolveNode` filters `missing` stubs before single/candidates/notFound. |
| `src/cli/dispatch.ts` | Modify | Register `object`; `parseDetail` in `handleExplore`/`handleAffected`/`handleObject`. |
| `src/cli/parse/detail.ts` | Create | Pure `parseDetail(raw): ExploreDetail`, throws `ConfigError`. |
| `src/cli/cli.ts` | Modify | Add aligned `object` line to `USAGE_TEXT` (pinned-test re-bless). |
| `docs/format-spec.md` | Modify | Explore payload grammar + per-detail budgets + §6 token-delta note. |
| `test/mcp/golden/explore-{normal,full}.txt` | Modify | Deliberate re-bless (payload sections + reconstructed FK). brief unchanged. |
| `test/mcp/golden/explore-view.txt` (or equivalent) | Create | Dedicated explore golden for a VIEW focus (`main.active_departments`) — pins the `[view]` fix + payload (ruling 5, D6). |
| `test/mcp/golden/object-tool-{normal,full}.txt` | Modify | Deliberate re-bless of ONLY the `employees` FK lines from D8 reconstruction (§6-noted). brief unchanged; all non-FK lines byte-identical. |
| `test/core/present/*` , `test/cli/*` | Create/Modify | payload unit tests (incl. D8 FK reconstruction + degradation); view-resolution test; `parseDetail` test; object CLI↔MCP parity test; budget re-assert. |
| `docs/benchmarks.md` | Modify | Second, commit-labeled results table (orchestrator re-run). |

## Interfaces / Contracts

```ts
// src/core/present/payload.ts — PURE, core types only (ADR-004/008)
interface NeighborEntry { readonly node: GraphNode; readonly edge?: GraphEdge }
export interface ColumnAnnotations { readonly pk: ReadonlySet<string>; readonly fk: ReadonlyMap<string,string>; }
// FK target: constraint payload `definition` when present, else reconstructed from `references` edges when unambiguous, else omitted (D8)
export function deriveColumnAnnotations(constraints: readonly NeighborEntry[], references: readonly NeighborEntry[]): ColumnAnnotations;
export function renderColumns(columns: readonly NeighborEntry[], a: ColumnAnnotations): string[]; // 'COLUMNS' + rows, [] if none
export function renderConstraints(constraints: readonly NeighborEntry[], a: ColumnAnnotations): string[]; // 'CONSTRAINTS' + rows (FK target via a.fk)
export function renderIndexes(indexes: readonly NeighborEntry[]): string[];                        // full-only caller
export function renderTriggers(triggers: readonly NeighborEntry[]): string[];                      // fires_on.in
export function renderFocusPayload(node: GraphNode, a?: ColumnAnnotations): string[];  // explore non-container focus, per-kind; PK/FK markers only when `a` (parent context) is available — a bare column focus still shows type/null/default (meets the success criterion)
```
```ts
// src/cli/parse/detail.ts
export function parseDetail(raw: unknown): ExploreDetail; // undefined→'normal'; invalid→throw ConfigError
```
Renderers return section-body lines WITHOUT a leading blank; callers keep the inter-section `push('')`
cadence → byte-identity. `deriveColumnAnnotations` and every renderer consume ONLY the neighbor
payloads/edges `getNeighbors` already returns — including the `references` group for D8 FK reconstruction
(no new store read, presentation-only).

## Testing Strategy

| Layer | What to Test | Approach (RED-first) |
|-------|-------------|----------------------|
| Unit | `payload.ts` per-kind renderers | torture-derived payload fixtures → exact `string[]`; empty → `[]`. Pure. |
| Unit | D8 FK target mapping | payload-present → column-level target; torture (payload absent, 1 references edge) → reconstructed `[FK→main.departments]`; multi-target/ambiguous → NO target (degrade, never guess). |
| Unit | D3 resolution | real `view` + phantom `table` stub, same qname → resolves to `view` (CLI + MCP). |
| Unit | `parseDetail` | `brief/normal/full` pass; `undefined`→`normal`; `bogus`→`ConfigError`→exit 2. |
| Golden | `formatObject` REFACTOR (Batch A) | `object-tool-{brief,normal,full}.txt` UNCHANGED — transparency proof for the extraction step (before D8). |
| Golden | `formatObject` FK feature (D8) | `object-tool-{normal,full}.txt` re-blessed on ONLY the `employees` FK lines; every non-FK line byte-identical. |
| Golden | `formatExplore` payload | re-blessed `explore-{normal,full}.txt`; `explore-brief.txt` unchanged; DEDICATED `[view]` (`active_departments`) golden. |
| Parity | CLI `object` ↔ MCP `dbgraph_object` | `runObject` bytes === EXISTING `object-tool-*.txt` (no duplicate set, ruling 4). |
| Budget | explore ceilings | re-measure; assert normal/full within 400/420 (widen w/ §6 note only if exceeded). |
| Regression | cross-transport parity | `test/mcp/http.test.ts` reads golden file → survives re-bless automatically (verified). |

## Migration / Rollout

Additive, presentation-only, no schema/store/extraction change. Batches: **A)** `payload.ts` + refactor
`object.ts` (object goldens HOLD byte-identical — refactor transparency proof, BEFORE D8) → **B)**
`explore.ts` table/view sections + `renderFocusPayload` + D8 FK reconstruction (re-blesses explore AND the
`employees` object FK lines together, §6-noted) + dedicated `[view]` explore golden + format-spec/budget
update → **C)** CLI `object` + `parseDetail` + D3 resolution fix → **D)**
(orchestrator, post-verify) benchmark re-run + second `docs/benchmarks.md` table. Rollback: delete
`payload.ts`/`object.ts` command/`detail.ts`, restore the two formatters + resolvers, `git revert` the
golden/format-spec/benchmark commits. Frozen harness untouched.

## Open Questions

- [ ] **True stub cause deferred** (still open): `buildFiresOnEdges` (`reference-resolver.ts:192`)
      hard-codes `resolveOrStub('table', …)` — INSTEAD OF triggers on views mint a phantom `table` stub.
      D3 masks it at resolution (presentation scope). A future NORMALIZE change should resolve the
      trigger target by actual kind (or against the existing node) to stop minting the phantom.

### Resolved by orchestrator rulings

- [x] **FK column→target mapping on SQLite** (ruling 2 → D8): reconstruct from the `references` edge when
      unambiguous; torture `employees`/`assignments` QUALIFY → reconstructed table-level target; degrade
      (no target) otherwise. Spec pins aligned to the reconstructed outcome.
- [x] **Container summary shape at `full`** (ruling 1 → D2): OBSOLETE — the separate compact container
      summary is DROPPED; a table/view focus renders object's full sections byte-identically at each
      detail level, so there is no distinct summary shape to decide.
- [x] **`[view]` explore golden vs unit-only** (ruling 5 → D6): DECIDED — add ONE dedicated explore golden
      for the `main.active_departments` view focus (pins the `[view]` fix + payload; cheap).
- [x] **CLI `object` goldens** (ruling 4 → D5/D6): DECIDED — `object` asserts byte-equality against the
      EXISTING `object-tool-*.txt` goldens; NO duplicate object golden set.

### Tasks-level note (for the tasks/apply phase)

- **Assignments constraint goldens** (ruling 3): the composite-FK constraint NAME for `main.assignments`
  (torture) is not yet pinned. Capture the `assignments` COLUMNS/CONSTRAINTS goldens DURING apply, once
  the real constraint names are observed from the built graph — pin the reconstructed FK line
  `(emp_id, dept_id → main.employees)` then, not before (avoids guessing the generated name).
