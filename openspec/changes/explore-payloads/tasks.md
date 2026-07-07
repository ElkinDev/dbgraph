# Tasks: Explore Payloads — render the facts the graph already stores (explore-payloads)

Standing header (every task): **STRICT TDD** — the failing `vitest` test PRECEDES the code (RED→GREEN→refactor);
EXACT / golden-pinned assertions (`.toBe`/`.toStrictEqual`), existence-only `.toBeDefined()` is FORBIDDEN.
Presentation-only, ADR-004/ADR-008: payload facts already live on `GraphNode.payload` — this change RENDERS them,
it NEVER re-extracts and touches NO schema/store/extraction. `src/core/present/**` imports ONLY core model/port
types; the CLI `object` command imports ONLY `src/index.ts` + Node builtins, NEVER `src/adapters/**`. Pure
formatters, byte-identical on re-run, trailing newline, NO `process.env`/clock/`Math.random`/I/O. Target DB stays
strictly READ-ONLY. Strict TS, NO `any`; English; conventional commits (NO AI attribution) — product batches
reference **US-036** (payload-rendering follow-up), the benchmark batch references **US-035**. NO push / PR / gh /
tags — local commits only. Leak-scan hooks active (`npm run hooks:install`) — denylist scan before EVERY commit; the
substrate is the committed synthetic SQLite torture fixture (`test/fixtures/sqlite/torture.sql`).

**GOLDEN DISCIPLINE is the heart of this change.** Batch A (refactor onto `payload.ts`) MUST leave ALL object
goldens BYTE-IDENTICAL — a single changed byte is a FAILURE, not a re-bless; that is the transparency proof. Batch B
is the ONLY batch that re-blesses goldens, and every byte change is a DELIBERATE, §6-paired re-bless (format-spec
grammar/budget edit + token-delta note in the SAME commit) with a REVIEWED diff summary in the commit body — NEVER a
silent regeneration.

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions / §Open Questions;
proposal §Approach wording reconciled where noted):
- **Container summary shape** (ruling 1 → D2): the proposal's "compact container summary" wording is SUPERSEDED — the
  separate compact summary is DROPPED. A TABLE/VIEW focus in `explore` renders `formatObject`'s FULL sections
  BYTE-IDENTICALLY at each detail level (byte-identical-to-object WON over a bespoke summary); there is NO second
  grammar to spec and the explore↔object parity tests fall out for free. Ample budget headroom justifies it
  (normal/full measure ~73/76 tk against 400/420, RE-MEASURED in Batch B).
- **FK column→target mapping** (ruling 2 → D8): payload-first, else RECONSTRUCT the TABLE-level target from the node's
  `references` edge when UNAMBIGUOUS, else DEGRADE to columns WITHOUT a target — never guessed. Torture
  `employees`/`assignments` QUALIFY (one FK / one references edge each) → reconstructed `main.departments` /
  `main.employees`; the payload-present path (`dbo.orders` fixture) keeps its richer column-level target (it is a
  FACT). Applied INSIDE the shared helper so `object` and `explore` get IDENTICAL results.
- **Refactor vs feature golden split** (D6): the pure REFACTOR (Batch A) keeps `object-tool-*.txt` +
  `test/core/present/golden/object-*.txt` BYTE-IDENTICAL (transparency); the D8 FK-reconstruction FEATURE (Batch B)
  DELIBERATELY re-blesses ONLY the `employees` FK column + constraint lines (every non-FK line byte-identical),
  §6-noted, applied to object AND explore TOGETHER because they share the source.
- **Assignments constraint goldens** (ruling 3): the composite-FK constraint NAME for `main.assignments` is NOT
  pinned in the spec. CAPTURE its COLUMNS/CONSTRAINTS golden lines DURING apply (Batch B), once the real constraint
  name is observed from the built graph — pin `(emp_id, dept_id → main.employees)` and the declared-order PK
  `(project_id, emp_id, dept_id)` THEN, never a guessed generated name.
- **CLI `object` goldens** (ruling 4 → D5/D6): the CLI `object` command asserts BYTE-equality against the (Batch-B
  re-blessed) EXISTING `test/mcp/golden/object-tool-*.txt` — NO duplicate object golden set. It adds ZERO rendering
  logic (thin wrapper over the EXISTING `formatObject`).
- **`[view]` explore golden** (ruling 5 → D6): add ONE DEDICATED explore golden for the `main.active_departments`
  view focus — it pins BOTH the D3 `[view]` resolution fix and payload rendering (cheap, worth it).
- **`[view]→[table]` fix locus** (D3): fixed at the RESOLUTION layer (prefer non-`missing` nodes) in BOTH
  `runExplore` and the MCP `resolveNode`, NOT in normalize. The true stub cause (`buildFiresOnEdges` hard-coding
  `resolveOrStub('table', …)` for an INSTEAD-OF trigger on a view) is an Open Question deferred to a future NORMALIZE
  change — OUT of this presentation-only scope.
- **Format-spec §6 pairing** (design §Migration / spec golden-discipline clause): because §6 requires every golden
  re-bless to be PAIRED with its `docs/format-spec.md` grammar/budget edit + token-delta note in the SAME commit, the
  explore-payload grammar + re-measured budget rows + §6 note land IN Batch B (with the re-bless) — NOT deferred.
  Batch D is a docs consistency + benchmark-scaffold pass. This is the artifacts dictating batch content.
- **Budget policy** (D2/D6): RE-MEASURE explore `normal`/`full` on the torture fixture after the sections land; the
  ceiling POLICY and `ceil(chars/4)` methodology are UNCHANGED (measured numbers). Widen the 400/420 ceilings ONLY if
  a fixture exceeds them, and ONLY with a §6 token-delta note.
- **Benchmark re-run is orchestrator-only** (D7): Batch R is executed by the COORDINATING session between apply and
  verify — it is NOT an apply sub-agent task and NOT a vitest suite; the frozen US-035 harness is UNCHANGED.

Per-batch GATE (ALL must pass before the next batch): `npx tsc --noEmit` clean (strict, no `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) GREEN (baseline **3088** + that batch's new suites) with EVERY
golden byte-identical on re-run · cross-transport parity (`test/mcp/http.test.ts`) green · leak-scan clean. Batch A
additionally proves ZERO object-golden drift (transparency). Batch B carries the DELIBERATE re-bless with its §6
format-spec pairing + reviewed diff summary. Commit EACH batch with a conventional-commit message (local only —
nothing pushed; no CI).

## Batch A: `payload.ts` extraction + `formatObject` refactor — TRANSPARENCY (all object goldens byte-identical)

> Satisfies mcp-server "One shared payload-render helper backs explore and object" (scenario: object goldens are
> byte-identical after the refactor step — transparency) + the extraction half of "explore and object render
> identical section bytes". STRICT TDD for the pure renderers; the refactor's proof is that the EXISTING object
> goldens stay BYTE-IDENTICAL (green == transparency). NO golden re-bless in this batch — a changed object byte is a
> FAILURE. `payload.ts` is the single source both formatters will consume, so it lands FIRST (D1).

- [x] A.1 (vitest) RED→GREEN `test/core/present/payload.test.ts` (new) + `src/core/present/payload.ts` (new):
  `renderColumns(columns, a)` returns a `'COLUMNS'` header + one row per column (`  <name>  <TYPE>
  [PK]/[FK→…]/[NN]  DEFAULT …`), `[]` when none — body-only lines WITHOUT a leading blank (D1). RED first on
  torture-derived `NeighborEntry[]` fixtures: `main.employees` yields `  emp_id  INTEGER  [PK]` and
  `  salary  REAL  [NN]  DEFAULT 0.0`; empty → `[]`. Core types only, `string[]`→`string[]`, no I/O. Design D1.
  Done: `npm test payload`.
- [x] A.2 (vitest) RED→GREEN `payload.test.ts` + `payload.ts`: `renderConstraints(constraints, a)` → `'CONSTRAINTS'`
  + rows (`  [PK]  <name>  (<cols>)`, `  [FK]  <name>  (<cols> → <target>)` via `a.fk`); `renderIndexes(indexes)`
  (`  <name>  UNIQUE (cols)` / method); `renderTriggers(triggers)` (timing + events from the `fires_on.in` group).
  Each returns `[]` when empty. RED on torture fixtures incl. `  idx_emp_email  UNIQUE (email)` and
  `  trg_emp_after_insert  AFTER INSERT`. Design D1. Done: `npm test payload`.
- [x] A.3 (vitest) RED→GREEN `payload.test.ts` + `payload.ts`: `deriveColumnAnnotations(constraints, references)`
  computes the `pk` set + `fk` colname→target map ONCE — in this batch the PAYLOAD-PRESENT path only: constraint
  payload `definition` target rendered VERBATIM at column level (the `dbo.orders` presenter fixture →
  `[FK→dbo.customers.customer_id]` and `(customer_id → dbo.customers.customer_id)`). Composite PK preserves DECLARED
  order, never re-sorted/alphabetized. RED: payload-present → column-level target; composite PK order preserved. (D8
  reconstruct/degrade paths are Batch B.) Design D1/D8. Done: `npm test payload`.
- [x] A.4 (golden — MUST NOT change) Refactor `src/core/present/object.ts` onto `payload.ts`: `formatObject` becomes
  header → `push('')` + `...renderColumns()` → `push('')` + `...renderConstraints()` → gate → indexes/triggers/body,
  keeping the inter-section `push('')` cadence in the CALLER so today's bytes are reproduced EXACTLY (D1). The
  EXISTING object goldens — `test/mcp/golden/object-tool-{brief,normal,full}.txt` AND
  `test/core/present/golden/object-{brief,normal,full}.txt` — MUST stay BYTE-IDENTICAL. A changed byte here is a
  FAILURE, not a re-bless. Spec: mcp-server "object goldens are byte-identical after the refactor step". Done:
  `npm test object-format`; `npm test mcp/object` (both green, zero golden diff).
- [x] A.5 Re-export the `payload.ts` renderers + `ColumnAnnotations` type via `src/core/index.ts` (barrel); the core
  boundary holds (`src/core/present/**` imports ONLY core model/port types, ADR-004/008). Done: `npx tsc --noEmit`;
  `npm test barrel`; `npm test boundaries` (core scan green).
- [x] A.6 GATE (Batch A): `npx tsc --noEmit` clean (no `any`); `npm run lint` 0/0; `npm test` green (baseline 3088 +
  payload unit suites) with EVERY object golden byte-identical (transparency proof); cross-transport parity green;
  leak-scan clean. Commit `refactor(present): extract pure payload renderers, refactor formatObject onto them (US-036)`.

## Batch B: `formatExplore` payload sections + D8 FK reconstruction + `[view]` fix + DELIBERATE re-bless + budget re-measure

> Satisfies cli-config "explore output comes from a pure formatter shared with the MCP tool" (scenarios: normal
> renders focus column types/PK/NN; composite PK declared order; FK payload-present mapping; FK RECONSTRUCTED; FK
> DEGRADED; trigger timing/events at full; brief no payload; view labeled `[view]`; deterministic golden-pinned;
> single source; bundle at detail) + mcp-server "dbgraph_explore … payload via shared helper" (Explore payload
> matches CLI byte-for-byte; compact neighborhood golden; ambiguous disambiguation) + "the FK-reconstruction feature
> re-blesses ONLY the FK lines, in object and explore together" + "explore and object render identical section bytes"
> + "Explore payload ceilings are re-measured and re-asserted". FEATURES: the ONLY batch that RE-BLESSES goldens —
> every byte change is DELIBERATE, §6-PAIRED (format-spec grammar/budget + token-delta note in the SAME commit),
> reviewed diff summary in the commit body. NEVER silent.

- [x] B.1 (vitest) RED→GREEN `payload.test.ts` + `payload.ts`: extend `deriveColumnAnnotations` with the D8 RECONSTRUCT
  path — when the constraint payload carries NO target, reconstruct the TABLE-level target from the node's
  `references` edges when UNAMBIGUOUS (exactly one outbound `references` edge OR this FK is the table's only FK,
  joined per-constraint via the edge `attrs.constraintName` when several exist); render the target's canonical
  schema-qualified `qname` (`main.departments`, never bare, never a guessed column). RED: torture `main.employees`
  (payload-less FK, 1 references edge) → column `  dept_id  INTEGER  [FK→main.departments]  [NN]` + constraint
  `  [FK]  fk_employees_0  (dept_id → main.departments)`; composite `main.assignments` →
  `(emp_id, dept_id → main.employees)`. Spec: cli-config "FK target is RECONSTRUCTED from the references edge when the
  payload carries none". Design D8. Done: `npm test payload`.
- [x] B.2 (vitest) RED→GREEN `payload.test.ts` + `payload.ts`: D8 DEGRADE path — when the payload carries no target
  AND the `references` edges do NOT resolve to a single unambiguous target table, render the FK columns WITHOUT a
  `→ target` (`  [FK]  <name>  (<cols>)`) and NO reconstructed `[FK→…]` on the column line. HONEST degradation, never
  a guess. RED: an ambiguous/multi-target fixture → no target rendered. Spec: cli-config "FK columns render WITHOUT a
  target when reconstruction is ambiguous". Design D8. Done: `npm test payload`.
- [x] B.3 (vitest) RED→GREEN `payload.test.ts` + `payload.ts`: `renderFocusPayload(node, a?)` for an explore
  NON-container focus — column→`dataType`/nullable/default (+PK/FK markers ONLY when parent-context `a` is supplied; a
  bare column focus STILL shows type/null/default, meeting the success criterion); constraint→type + ordered columns
  + FK target; index→unique/columns/method; trigger→timing/events — SAME per-kind line grammar as the section
  renderers. RED per kind on torture fixtures. Design D2. Done: `npm test payload`.
- [x] B.4 (vitest) RED→GREEN `test/core/present/explore-format.test.ts` + `src/core/present/explore.ts`:
  `formatExplore` renders the focus node's payload via the shared helper, GATED identically to `object` — `brief` =
  header + neighbor-kind counts, NO payload; `normal` = + COLUMNS + CONSTRAINTS; `full` = + INDEXES + TRIGGERS (+
  body). A TABLE/VIEW focus renders the EXACT SAME sections as `formatObject` (byte-identical, same renderers, same
  order); a COLUMN/CONSTRAINT/INDEX/TRIGGER focus renders `renderFocusPayload`; the grouped in/out neighbor listing is
  RETAINED after the payload sections. RED: `main.employees --detail normal` COLUMNS byte-identical to
  `object main.employees`; `--detail full` TRIGGERS render `  trg_emp_after_insert  AFTER INSERT` and
  `  trg_emp_salary_update  BEFORE UPDATE`; brief renders no payload lines. Spec: cli-config "normal detail renders
  focus column types, PK and NN markers in one call", "composite PK renders member columns in declared order",
  "trigger timing and events render at full detail", "brief detail renders no payload lines", "explore renders the
  entity bundle at the requested detail", "explore formatter is the single source for the MCP tool"; mcp-server
  "explore and object render identical section bytes for the same node". Done: `npm test explore-format`.
- [x] B.5 (vitest) RED→GREEN D3 `[view]→[table]` resolution fix (prefer non-`missing`) on BOTH surfaces:
  `src/cli/commands/explore.ts` `runExplore` (collect ALL `NODE_KINDS` matches; `const real = matches.filter(n =>
  !n.missing); const effective = real.length ? real : matches;`; drop the first-match `break`, use `effective.find`)
  AND `src/mcp/tools/explore.ts` + `src/mcp/tools/object.ts` `resolveNode` (run single/candidates/notFound on
  `effective`). RED: a node set with a real `view` + phantom `table` stub for one qname resolves to the VIEW (CLI +
  MCP). NOT in normalize (true stub cause deferred). Spec: cli-config "view focus node is labeled [view] not [table]".
  Design D3. Done: `npm test explore` (CLI + MCP resolution).
- [x] B.6 (golden — DELIBERATE re-bless) Re-capture `test/mcp/golden/explore-{normal,full}.txt` with the payload
  sections + reconstructed FK; `explore-brief.txt` stays UNCHANGED (a pin — no payload at brief). CREATE the dedicated
  view golden `test/mcp/golden/explore-view.txt` for `main.active_departments` (header `[view]` + payload) — pins BOTH
  the D3 fix and payload rendering (ruling 5). Re-bless ONLY the `employees` FK column + constraint lines in
  `object-tool-{normal,full}.txt` AND `test/core/present/golden/object-{normal,full}.txt` (all non-FK lines
  byte-identical); object/explore brief unchanged. Spec: cli-config "explore output is deterministic and
  golden-pinned"; mcp-server "the FK-reconstruction feature re-blesses ONLY the FK lines, in object and explore
  together", "Explore payload matches the CLI byte-for-byte", "Explore returns the compact neighborhood (golden)".
  Done: `npm test mcp/explore`; `npm test mcp/object`; `npm test object-format`; byte-identical re-run.
- [x] B.7 (golden — capture during apply, ruling 3) Capture the `main.assignments` COLUMNS/CONSTRAINTS golden lines
  (explore + object) ONCE the real composite-FK constraint NAME is observed from the built torture graph — pin the
  reconstructed line `(emp_id, dept_id → main.employees)` and the declared-order PK `(project_id, emp_id, dept_id)`
  THEN, never a guessed generated name. Spec: cli-config "composite PK renders member columns in declared order".
  Design §Tasks-level note (ruling 3). Done: assignments goldens captured from the real graph and committed.
- [x] B.8 (vitest) RED→GREEN `test/core/present/budget.test.ts`: RE-MEASURE explore `normal`/`full` output on the
  torture fixture (`ceil(chars/4)`) now that payload lines land; re-assert the ceilings. Ceiling POLICY + methodology
  UNCHANGED; widen the 400/420 ceiling ONLY if a fixture exceeds it, and ONLY with a §6 token-delta note (record the
  ceiling-policy OUTCOME either way). RED: updated ceilings asserted; `normal`/`full` within policy. Spec: mcp-server
  "Explore payload ceilings are re-measured and re-asserted", "Brief detail respects the measured token budget".
  Design D2/D6. Done: `npm test budget`.
- [x] B.9 (golden discipline — §6 PAIR, SAME commit as the re-bless) Update `docs/format-spec.md`: add the explore
  per-kind PAYLOAD line grammar (column type/nullable/default; constraint kind + ORDERED columns + FK target mapping
  INCLUDING the reconstructed table-level form and the degraded no-target form; index unique/columns; trigger
  timing/events), update the explore `normal`/`full` per-detail budget rows to the B.8 re-measured numbers, and add a
  §6 token-delta NOTE recording the byte/token delta + ceiling-policy outcome. NON-NEGOTIABLE: no golden changes
  without this matching spec edit in the same commit. Spec: mcp-server "Compact format pinned by docs/format-spec.md
  authored first" (grammar now covers explore payload lines) + cli-config golden-discipline clause. Design D6. Done:
  format-spec grammar + budgets + §6 note present; every re-blessed golden has a paired spec edit.
- [x] B.10 GATE (Batch B): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green (payload D8 +
  `renderFocusPayload` + explore-format + resolution + budget suites) with the re-blessed goldens byte-identical on
  re-run; cross-transport parity (`test/mcp/http.test.ts`) green (reads the golden FILE — survives re-bless
  automatically); leak-scan clean. Commit `feat(explore): render focus payload via shared helper, reconstruct FK
  targets, fix [view] label (US-036)` — the commit body carries the REVIEWED re-bless diff summary (which goldens
  changed, the token delta, why), per §6. NEVER a silent regeneration.

## Batch C: `parseDetail` validation + CLI `object` command + banner + parity

> Satisfies cli-config "explore and object reject an unknown --detail value" (both scenarios) + "object CLI command
> mirrors dbgraph_object" (all three scenarios). CLI SURFACE: the `object` command is a THIN wrapper over the EXISTING
> `formatObject` (ZERO new rendering logic); its parity is asserted against the (Batch-B re-blessed) EXISTING object
> goldens (ruling 4). Consumes the D3-corrected resolution loop from Batch B (D5).

- [x] C.1 (vitest) RED→GREEN `test/cli/parse/detail.test.ts` (new) + `src/cli/parse/detail.ts` (new): pure
  `parseDetail(raw: unknown): ExploreDetail` — returns the value for `brief|normal|full`, `undefined`→`normal`,
  THROWS `ConfigError` naming the offending value (message shape `explore: "detail" must be one of brief|normal|full
  (got "bogus")`). RED: `bogus`→`ConfigError`; the three valid values pass; `undefined`→`normal`. Spec: cli-config
  "valid --detail values are unaffected". Design D4. Done: `npm test detail`.
- [x] C.2 (vitest) RED→GREEN `test/cli/dispatch.test.ts` + `src/cli/dispatch.ts`: replace the silent-coercion
  `--detail` ternaries in `handleExplore` (`dispatch.ts:201-204`) AND `handleAffected` (`231-234`) with
  `parseDetail(...)`; a `ConfigError` (a `DbgraphError`) maps to exit 2 via the established `exit-code.ts` contract.
  RED: `explore … --detail bogus` exits 2 surfacing the ConfigError; `affected … --detail bogus` likewise. Spec:
  cli-config "unknown --detail value exits 2 with an actionable message". Design D4. Done: `npm test dispatch`.
- [x] C.3 (vitest) RED→GREEN `test/cli/commands/object.test.ts` (new) + `src/cli/commands/object.ts` (new):
  `runObject({store,qname,detail})` mirroring `runExplore` — resolve via the D3-corrected loop → `getNeighbors` →
  `formatObject(view, detail)` → `ExploreOutcome`. NO `--json` (parity with the MCP tool, which has none). Imports
  ONLY `src/index.ts` + Node builtins — NEVER `src/adapters/**` (ADR-004). RED: `runObject` returns the formatted
  object bytes; the boundary scan flags any adapter import. Spec: cli-config "object honors the CLI import boundary".
  Design D5. Done: `npm test object` (command); `npm test boundaries` (CLI scan green).
- [x] C.4 (vitest) RED→GREEN `dispatch.test.ts` + `src/cli/dispatch.ts`: register `object: handleObject` in
  `COMMAND_TABLE`; `handleObject` reads `positionals[0]` (qname) + `parseDetail(...)`, opens the store, calls
  `runObject`. RED: `dbgraph object main.employees --detail full` dispatches and prints via `runObject`. Design D5.
  Done: `npm test dispatch`.
- [x] C.5 (vitest) RED→GREEN `test/cli/cli.test.ts` (USAGE_TEXT pin) + `src/cli/cli.ts`: add an `object` line to
  `USAGE_TEXT` after `explore`, its description beginning at character index 12 (`  object` + four spaces) — the SAME
  alignment as `query`/`explore`/`install`: `  object    Show one object in full (columns, constraints, indexes,
  triggers)`. RED: the pinned banner test asserts the line at the exact column (dropping the `object` command fails
  the build). Spec: cli-config "usage banner documents the object line with the exact alignment". Design D5. Done:
  `npm test cli` (banner pin).
- [x] C.6 (golden — parity, no new golden set) RED→GREEN `test/cli/commands/object.test.ts`: PARITY assertion —
  `runObject` output bytes === the (Batch-B re-blessed) EXISTING `test/mcp/golden/object-tool-{brief,normal,full}.txt`,
  byte-identical to `dbgraph_object({qname,detail})` (same-source-same-golden; NO duplicate object golden set, ruling
  4). RED on `main.employees --detail full` incl. `  salary  REAL  [NN]  DEFAULT 0.0` and `  idx_emp_email  UNIQUE
  (email)`. Spec: cli-config "object renders one object's full detail, byte-identical to the MCP tool". Design D5/D6.
  Done: `npm test object` (parity green).
- [x] C.7 GATE (Batch C): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green (parseDetail + dispatch +
  object command + banner + parity suites); CLI boundary test green (`object` imports only the barrel + Node
  builtins); cross-transport parity green; leak-scan clean. Commit `feat(cli): add object command, validate --detail
  with ConfigError (US-036)`.

## Batch D: docs consistency + benchmark second-table scaffold + final gate + DoD

> Satisfies mcp-server "Compact format pinned by docs/format-spec.md authored first" (Format spec exists with
> grammar/levels/budget methodology; Output produced by a pure formatter and byte-identical on re-run) — final
> consistency pass — + benchmark "Multiple runs are reported as code-version-labeled tables" (scaffold the labeled
> second table + honesty framing so Batch R only FILLS numbers). DOCS + the final consolidated gate. No product code.

- [ ] D.1 (docs) Scaffold the SECOND, code-version-LABELED results table in `docs/benchmarks.md` for the
  explore-payloads re-run: a labeled placeholder table (run-id `explore-payloads-2026-MM-DD`) leaving the first
  `torture-2026-07-06` table INTACT, reusing the EXISTING anti-extrapolation / honesty framing (same
  fixture/questions/model, tool surface ONLY; unfavorable results reported, no extrapolation). The WITH-surface note
  restates EXACTLY the four commands `query`, `explore`, `affected`, `status` (with `--json`) — byte-identical to the
  first run's protocol, no command added/removed/altered. Batch R FILLS the numbers; this batch lands only the
  labeled scaffold + framing. Spec: benchmark "A second results table is labeled with its code version", "The re-run's
  WITH surface is the unchanged four commands". Done: labeled placeholder table + framing present; first table
  untouched.
- [ ] D.2 (docs) Final `docs/format-spec.md` consistency pass: confirm the explore payload GRAMMAR (incl. the
  reconstructed FK table-level form + the degraded no-target form), the re-measured `normal`/`full` budget rows, and
  the §6 token-delta note authored in Batch B are complete and consistent with the re-blessed goldens; methodology
  (`ceil(chars/4)`, measured numbers, spec-edit-plus-token-delta on every golden change) UNCHANGED. Spec: mcp-server
  "Format spec exists with grammar, levels and budget methodology", "Output is produced by a pure formatter and is
  byte-identical on re-run". Done: no gap between the format-spec grammar and the re-blessed goldens.
- [ ] D.3 GATE (Batch D — final apply): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green (FULL suite:
  baseline 3088 + all payload/explore/parseDetail/object/banner/parity/budget suites) with EVERY golden byte-identical
  on re-run; cross-transport parity green; DOCS-verify — format-spec grammar+budgets+§6 note consistent,
  `docs/benchmarks.md` carries the labeled second-table scaffold with honesty framing and the first table intact;
  read-only invariant + ADR-004 core/CLI boundary tests green; leak-scan clean. Commit
  `docs(explore-payloads): format-spec grammar/budgets and second benchmark table scaffold (US-036)`.

## Batch R — the RE-RUN (executed by the ORCHESTRATOR between apply and verify — NOT an apply-agent task)

> This batch is NOT run by an apply sub-agent and is NOT a vitest suite (coupling `npm test` to a run would be a
> benchmark-honesty VIOLATION). The COORDINATING session executes it AFTER Batch D's GATE is green and BEFORE verify,
> on the FROZEN US-035 harness with the explore-payloads code under test. Mirrors phase-benchmark's Batch R precedent
> (design D-benchmark / D7); honesty is enforced by the standing `docs/benchmarks.md` contract and re-checked by
> verify, NOT by a test.

- [ ] R.1 (orchestrator) Build the graph from the committed fixture: `dbgraph init` / `sync` against
  `test/fixtures/sqlite/torture.sql` → `.dbgraph/dbgraph.db` in an isolated working dir. READ-ONLY throughout; the
  frozen harness is UNTOUCHED. Spec: benchmark "The re-run's WITH surface is the unchanged four commands" (setup).
- [ ] R.2 (orchestrator) `node --experimental-strip-types benchmark/generate.ts` then `… benchmark/build-packets.ts`
  against the SAME committed pre-registered set — CONFIRM ZERO packet drift (the 4-command list + questions + ground
  truth are PINNED; regenerating must reproduce them byte-identically). Spec: benchmark "The re-run's WITH surface is
  the unchanged four commands". Design D-benchmark.
- [ ] R.3 (orchestrator) For EACH question launch TWO isolated sub-agents (WITH: read-only CLI limited to
  `query`/`explore`/`affected`/`status` with `--json`, FORBIDDEN from reading any `.sql`/DDL file; WITHOUT: DDL dump
  only, no tools) with the IDENTICAL pinned framing + question + `ANSWER FORMAT` spec — run-id
  `explore-payloads-2026-MM-DD`. Save each to `benchmark/runs/<run-id>/raw/<qid>.<condition>.json` + transcript. Spec:
  benchmark "The re-run's WITH surface is the unchanged four commands".
- [ ] R.4 (orchestrator) `node --experimental-strip-types benchmark/score.ts runs/<run-id>` (BLIND to condition) →
  `scored/`; `render.ts` → the SECOND `docs/benchmarks.md` results table. FILL the labeled table (D.1 scaffold) +
  per-question DELTAS + Environment (model id, run-id, date, commit) FAITHFULLY — report EVERY per-question outcome
  INCLUDING no-improvement or REGRESSION versus the first run; NO extrapolation, scoped to this
  fixture/question-set/model. Spec: benchmark "A second results table is labeled with its code version", "An
  unfavorable second run is reported, not suppressed".
- [ ] R.5 (orchestrator) Commit the filled second table (`runs/` stays git-ignored): `docs(benchmark): record
  explore-payloads re-run on the torture fixture (US-035)`. Hand off to verify.

## Apply Batch Grouping (one sub-agent session each)

- **Batch A** (A.1–A.6): CODE/REFACTOR — `src/core/present/payload.ts` (pure `renderColumns`/`renderConstraints`/
  `renderIndexes`/`renderTriggers` + `deriveColumnAnnotations` payload-present path) + `object.ts` refactored onto it
  + barrel + `test/core/present/payload.test.ts`. STRICT TDD; transparency proof — object goldens UNCHANGED.
- **Batch B** (B.1–B.10): FEATURES — D8 reconstruct/degrade + `renderFocusPayload` + `formatExplore` sections + D3
  `[view]` fix (CLI + MCP) + the DELIBERATE re-bless (explore normal/full + new view golden + object FK lines +
  assignments capture) + budget re-measure + format-spec §6 pairing. The ONLY re-bless batch.
- **Batch C** (C.1–C.7): CLI SURFACE — `parseDetail` (D4) + `object` command (D5) + banner pin + dispatch wiring +
  parity test against the EXISTING object goldens.
- **Batch D** (D.1–D.3): DOCS + FINAL — benchmark second-table scaffold, format-spec consistency, final consolidated
  gate + DoD.
- **Batch R** (R.1–R.5): ORCHESTRATOR-ONLY re-run between apply and verify — NOT an apply sub-agent, NOT vitest.

### Parallel vs sequential

- **Batches are STRICTLY SEQUENTIAL: A → B → C → D → R.** They share `payload.ts` and a SINGLE golden re-bless chain,
  so they cannot overlap. A's transparency proof MUST land before B re-blesses (else a refactor byte-slip is
  indistinguishable from a feature re-bless); B's re-blessed object goldens are C's parity oracle; D's scaffold must
  precede R's fill; R runs only after all product code is frozen and green.
- **Within a batch the independent-renderer tasks are logically parallel but authored in ONE session/file.** A.1/A.2
  (the four section renderers) and B.1/B.2/B.3 (the D8 reconstruct/degrade paths + `renderFocusPayload`) all land in
  the single `payload.ts` — one apply sub-agent per batch, not split across agents.

### Dependency bottlenecks

- **Batch A gates everything.** `payload.ts` is the single source both formatters consume; if the extraction is not
  BYTE-TRANSPARENT first (object goldens unchanged), a feature re-bless in B cannot be distinguished from an
  accidental refactor regression. Land the transparent refactor FIRST.
- **Batch B is the ONLY re-bless and the sharp edge for GOLDEN DISCIPLINE.** The explore/object FK re-bless, the new
  `explore-view.txt`, the budget re-measure, and the format-spec §6 edit MUST all be in the SAME commit (§6 pairing).
  A golden byte changed without the matching format-spec edit + token-delta note is a SPEC VIOLATION, not a
  convenience.
- **D8 reconstruction DELIBERATELY softens the "object goldens never change" invariant.** Because reconstruction
  lives in the SHARED helper, it also changes `object main.employees` FK lines; that is a §6 re-bless of ONLY the FK
  lines (all non-FK lines byte-identical), applied to object AND explore together. Verified: torture
  `employees`/`assignments` qualify (one FK / one references edge each).
- **The `assignments` constraint name is not pinned until apply (ruling 3).** B.7 captures the composite-FK golden
  line from the REAL built graph — do NOT guess the generated constraint name in the tasks/spec; pin it once observed.
- **D3 lands in Batch B, before Batch C's object command reuses the corrected loop (D5).** The `[view]` fix touches
  BOTH CLI `runExplore` and the MCP `resolveNode` (explore + object); the `object` command consumes the same corrected
  resolution.
- **Batch D must precede Batch R.** The orchestrator FILLS a `docs/benchmarks.md` that already carries the labeled
  second-table scaffold + anti-extrapolation framing, so a favorable headline can never ship without the honesty
  contract.
- **Batch R is the ONLY non-mechanical step** — live sub-agent behavior on the frozen harness. Its honesty (report
  unfavorable results, exact four-command surface, no extrapolation) is enforced by the D.1 document contract + verify,
  NOT by a test; `npm test` stays DECOUPLED from the run.

## Definition of Done (tied to the proposal's Success Criteria; 29 spec scenarios across 7 requirements traced)

- [ ] `explore <column>` shows dataType + nullability, `explore <table>` shows ordered PK columns + column types, and
  `explore <fk-constraint>` shows the FK column→target mapping — each in ONE call. — Batch B (B.1, B.2, B.3, B.4)
  [scenarios: normal renders focus column types/PK/NN, composite PK declared order, FK payload-present mapping, FK
  reconstructed, FK degraded, trigger timing/events at full, brief no payload]
- [ ] `formatExplore` and `formatObject` render payload facts through ONE shared pure helper (no duplicated per-kind
  logic, no drift). — Batch A (A.1–A.4), Batch B (B.4) [scenarios: object goldens byte-identical after refactor,
  explore and object render identical section bytes, the FK-reconstruction re-blesses ONLY the FK lines in object and
  explore together]
- [ ] A CLI `object` command exists and its output is BYTE-IDENTICAL to `dbgraph_object` (same-source-same-golden),
  importing only the barrel + Node builtins. — Batch C (C.3, C.4, C.5, C.6) [scenarios: object full detail
  byte-identical, object honors the CLI import boundary, usage banner alignment]
- [ ] `explore --detail bogus` (and `object`/`affected`) fails with a `ConfigError` naming the value (exit 2); the
  explore header labels a view as `[view]`. — Batch B (B.5), Batch C (C.1, C.2) [scenarios: unknown --detail exits 2,
  valid --detail unaffected, view focus labeled [view] not [table]]
- [ ] Explore goldens re-blessed DELIBERATELY with a matching `docs/format-spec.md` grammar + token-delta note (§6);
  budget assertions pass on the re-measured ceilings; the cross-transport parity test is green. — Batch B (B.6, B.8,
  B.9), Batch D (D.2) [scenarios: explore deterministic and golden-pinned, Explore payload matches CLI byte-for-byte,
  Explore compact neighborhood golden, ambiguous target disambiguation, ceilings re-measured, brief budget respected,
  format spec grammar/levels/budget methodology, output byte-identical on re-run]
- [ ] `docs/benchmarks.md` carries a SECOND results table LABELED with the code version, framed honestly (same
  fixture/questions/model, tool surface only; unfavorable results reported, no extrapolation). — Batch D (D.1), Batch
  R (R.4) [scenarios: second table labeled with its code version, re-run WITH surface is the unchanged four commands,
  unfavorable second run reported not suppressed]
- [ ] Target DB stays strictly READ-ONLY; the ADR-004 core/CLI boundary tests are green. — Batch C (C.3), Batch D
  (D.3), Batch R (R.1)
- [ ] `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; `npm test` green (baseline 3088 + new suites)
  with every golden byte-identical on re-run; leak-scan clean — proven LOCALLY (no CI), nothing pushed. — every batch
  GATE (A.6, B.10, C.7, D.3)
