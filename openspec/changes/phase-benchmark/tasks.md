# Tasks: Phase benchmark — WITH/WITHOUT harness, mechanical ground truth, honest numbers (phase-benchmark)

Standing header (every task): TWO natures. **Batch 1 is CODE — STRICT TDD** (RED→GREEN→refactor; the failing
`vitest` test PRECEDES the code) — the scorer/comparators are the ONLY new code `npm test` exercises. **Batches
2–4 are DEV-TOOLING + DOCS — NOT vitest-TDD**: `generate`/`build-packets`/`score`/`render` are dev/orchestrator
stages that MUST NOT become vitest suites (that would couple `npm test` to a run — a Req-6 VIOLATION); their
correctness is enforced by RUNTIME SELF-CHECK ASSERTIONS inside the stage (fail loudly) + the design honesty gate
for docs. All harness code is `.ts` OUTSIDE `src/`/`dist/`. Strict TS, NO `any`; EXACT / golden-pinned assertions
(`.toBe`/`.toStrictEqual`), existence-only `.toBeDefined()` is FORBIDDEN. English; conventional commits (NO AI
attribution) referencing US-035. NO push / PR / gh / tags. Leak-scan hooks active (`npm run hooks:install`) —
denylist scan before EVERY commit; the primary substrate is the committed SQLite torture fixture (synthetic), the
secondary mssql run is REDACTED before any private name is written. Package-leak guard is STRUCTURAL (D2): the
`"files": ["dist"]` whitelist + `tsup` src-only entries already exclude `benchmark/`/`test/`/`docs/` — add NOTHING
to the ship-path (no `.npmignore`, no move under `src/`).

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Open Questions / Architecture Decisions,
reconciled against spec Req 2's fixed 5–10 bound):
- **N / `--per-family`** (Open Q1, reconciled with spec Req 2 "FIXED N of 5–10"): committed default `--per-family 1`
  → **N = 6** (one question per family, all six families) — WITHIN the spec's fixed 5–10 bound. Design's
  `--per-family 2` (~12) would EXCEED that bound and is REJECTED as the committed default; the knob stays
  configurable but `generate.ts` HARD-ASSERTS `5 ≤ N ≤ 10` and prints N in the `questions.yaml` header + docs.
- **Six families** (D6, additive to spec's three): `fk-path`, `column-type` (NEGATIVE CONTROL), `impact`,
  `trigger-inventory`, `view-dependency`, `constraint-semantics`. The THREE spec-pinned families use the spec's
  EXACT derivation — `fk-path` from the FK EDGE table, `column-type` from node FIELD payloads, `impact` from
  `affected --json`; the other three are ADDITIVE, each mechanically derived from graph nodes/edges (D5). All are
  closed-form → NO free-text "explain" family exists (satisfies "rubric flagged" by EXCLUSION; recorded as a
  limitation in Batch 4).
- **`impact` DDL snippets** (Open Q4): GENERATED deterministically from column nodes, then COMMITTED under
  `benchmark/impact-snippets/<qid>.sql` (mechanical AND frozen/pre-registered); the snippet filename IS the
  canonical `qid` sort key. `generate.ts` writes the snippet, then runs `affected <snippet> --json` to derive the key.
- **`trigger-inventory` strictness** (Open Q5): STRICTER — ground truth + scoring include timing + events
  (`triggerQname:timing:events`), applied EQUALLY to both conditions. The torture fixture's INSTEAD-OF triggers make
  this discriminating; the extra answer-format burden is symmetric, so it stays fair.
- **Node version** (Open Q2): `package.json` `engines` STAYS `>=22` (product contract UNCHANGED). The stages run via
  `node --experimental-strip-types` (needs Node ≥ 22.6) — a `>=22.6` note ships in `docs/benchmarks.md`
  "Reproduce it yourself". `npm test` is UNAFFECTED (vitest transforms `.ts` itself).
- **eslint scope** (Open Q3 / D4): ADD `"benchmark"` to `tsconfig.json` `include`; `eslint .` already lints
  `benchmark/**` (not in `ignores`) and typescript-eslint disables `no-undef` for `.ts` with `@types/node` globals
  (`types:["node"]`) — so NO scoped eslint block is added UNLESS a batch GATE's `eslint .` reports a real violation
  on `benchmark/**` (then add `files:['benchmark/**/*.ts']` with `NODE_GLOBALS`).
- **mssql redaction** (Open Q6): GENERALIZED placeholders via a deterministic map (`customers`→`table_A`,
  `email`→`col_1`) applied BEFORE any private object name is written to docs; tag every secondary result
  `substrate: mssql-private`, `reproducible: false`, `provenance: author-attested`; read-only BY CONSTRUCTION
  (catalog SELECTs only — NOT a restricted grant, auth is integrated/SSPI); any SSMS-accuracy contrast is an author
  attestation, LABELED as such.
- **Token boundary** (D9): actual runtime usage preferred; else `ceil(chars/4)` LABELED approximate. Count ONLY
  schema-bearing text — WITHOUT = the DDL dump (once), WITH = concat of all dbgraph tool outputs received; identical
  question + system framing are EXCLUDED (they cancel). One boundary, applied identically both sides.
- **Scorer blindness** (D13): comparators receive ONLY `{ family, answerParsed, groundTruth }` — NEVER the condition
  label. WITHOUT dump = comment-free `sqlite_master` catalog DDL (D8), NOT the annotated `torture.sql`.

Per-batch GATE (ALL must pass before the next batch): `npx tsc --noEmit` clean (strict, no `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) GREEN with **ZERO benchmark artifacts** (baseline 2958 + Batch 1
scorer suites; `benchmark/runs/` empty/absent, `docs/benchmarks.md` results unfilled) · leak-scan clean. Batch 1
adds RED→GREEN proof. Batches 2–3 additionally prove each stage's SELF-CHECK assertion fires (generator/packet
guards) and that NO stage was added to a vitest suite. Commit EACH batch with a conventional-commit message (local
only — nothing pushed past `closeout`; no CI).

## Batch 1: Scorer core — condition-blind comparators + shared helpers + token formula + committed fixtures (STRICT TDD, load-bearing)

> Satisfies benchmark "Scoring is deterministic, blind, unit-tested, closed-form vs rubric" (scenarios: closed-form
> exact/set-match, scorer blind to labels, rubric flagged, scorer tests pass in `npm test`) + the token-boundary
> half of "Two protocols … one fixed token boundary" (one token boundary applied identically) + the fixtures-only
> half of "npm test independent" (suite green with no run artifacts). CODE + STRICT TDD. This is the ONLY new code
> `npm test` exercises and EVERY downstream stage imports the SAME modules (D3 — no duplicated normalization; the
> per-family `ANSWER FORMAT` spec that `build-packets` embeds is DEFINED here), so it lands FIRST.

- [x] 1.1 RED→GREEN `test/benchmark/scorer.test.ts` (new) + `benchmark/scorer/index.ts` (new): `parseAnswer(raw)`
  extracts the FINAL `ANSWER:` line (trim, empty on missing/malformed), `normalizeQname(s)` (strip quotes/brackets,
  lowercase, collapse whitespace), `canonicalType(s)` (uppercase, trim, INT↔INTEGER synonym table). RED first:
  `parseAnswer("…\nANSWER: x")==="x"`, empty on no line; `normalizeQname('"Foo"."Bar"')==="foo.bar"`,
  `normalizeQname('[Foo].[Bar]')==="foo.bar"`; `canonicalType("int")==="INTEGER"`. EXACT `.toBe`. Design §Scorer
  shared helpers; D12. Done: `npm test scorer`.
- [x] 1.2 RED→GREEN `scorer.test.ts` + `benchmark/scorer/families.ts` + committed `test/benchmark/fixtures/fk-path.json`
  (D15): `fk-path` comparator — SET equality of `A.col=B.col` hop atoms, ORDER-independent. RED: exact pass,
  reordered atoms pass, missing hop fails, no fuzzy/partial credit. Spec scenario "Closed-form questions scored by
  pinned exact/set-match". Done: `npm test scorer`.
- [x] 1.3 RED→GREEN `scorer.test.ts` + `families.ts` + fixture `column-type.json`: `column-type` (control) comparator
  — EXACT match on `TYPE|NULLABLE` (type synonym-normalized via `canonicalType`). RED: exact pass, `INT` vs
  `INTEGER` pass, nullability mismatch fails, NO partial credit. Spec scenario "Closed-form questions scored by
  pinned exact/set-match". Done: `npm test scorer`.
- [x] 1.4 RED→GREEN `scorer.test.ts` + `families.ts` + fixtures `impact.json`, `trigger-inventory.json`: `impact`
  comparator — SET equality of normalized `whatToTest` qnames; `trigger-inventory` comparator — SET equality of
  `{triggerQname,timing,events}` tuples (STRICTER, per RESOLVED). RED: set order-independence, mismatch, malformed
  tuple. Spec scenario "Closed-form questions scored by pinned exact/set-match". Done: `npm test scorer`.
- [x] 1.5 RED→GREEN `scorer.test.ts` + `families.ts` + fixtures `view-dependency.json`, `constraint-semantics.json`:
  `view-dependency` — SET equality of normalized dependency qnames; `constraint-semantics` — ORDERED column list for
  PK (order-SENSITIVE), set otherwise. RED: PK column-order mismatch FAILS, reordered set members pass. Spec scenario
  "Closed-form questions scored by pinned exact/set-match". Done: `npm test scorer`.
- [x] 1.6 RED→GREEN `scorer.test.ts` + `benchmark/scorer/tokens.ts`: `schemaTokens` — actual runtime usage passthrough
  when present, else `ceil(len/4)` with a `mode:'approx'` LABEL; counts ONLY the schema-bearing string, identical
  formula both sides. RED: `ceil(10/4)===3` boundary, empty→0, `mode` field is `'actual'` vs `'approx'`. Spec scenario
  "One token boundary applied identically" (formula half). Done: `npm test scorer`.
- [x] 1.7 RED→GREEN `scorer.test.ts` + `index.ts` re-export: `scoreAnswer({ family, answerParsed, groundTruth }) →
  { correct, expected, got, detail }` dispatcher is BLIND (D13) — RED: assert the parameter type carries NO
  `condition`/label field (compile-level), and `scoreAnswer` run TWICE on the same input yields byte-identical output
  (determinism, ADR-008). Spec scenarios "Scorer is blind to condition labels" + determinism. Done: `npm test scorer`.
- [x] 1.8 RED→GREEN `scorer.test.ts`: the `Family` union contains EXACTLY the six closed-form families and NO
  `explain`/rubric member — headline accuracy is 100% closed-form (D6). RED: assert `scoreAnswer` rejects an unknown
  family; assert no rubric path exists. Spec scenario "Rubric items flagged non-deterministic and reported apart"
  (satisfied by EXCLUSION — the free-text limitation is drafted in Batch 4). Done: `npm test scorer`.
- [x] 1.9 GATE (Batch 1): `npx tsc --noEmit` clean — `benchmark/scorer/**` is type-checked TRANSITIVELY via
  `test/benchmark/scorer.test.ts` (under the existing `"test"` include); `npm run lint` 0/0; `npm test` green
  (baseline 2958 + scorer suites) with fixtures being COMMITTED stubs — NO generated questions, NO run (D15); leak-scan
  clean. Spec scenario "Suite green with no run artifacts". Commit
  `test(benchmark): add condition-blind scorer, comparators, and token formula (US-035)`.

## Batch 2: `generate.ts` — pre-registered questions + mechanical ground truth + committed set + tsconfig include (dev tooling, self-checked)

> Satisfies benchmark "Question set is mechanically derived and carries machine-checkable ground truth" (all three
> scenarios) + the fixture-rebuild half of "Reproducible-first dual substrate" (primary substrate rebuildable). NOT
> vitest-TDD — a dev stage with LOUD self-check assertions. Reads the built graph via `dist/cli.js … --json` + the
> shipped `dist/index.js` store API — NEVER re-implements extraction (D5). Emits the FROZEN pre-registered set.

- [ ] 2.1 Modify `tsconfig.json`: add `"benchmark"` to `include` (now `["src","test","benchmark"]`, D4) so this
  batch's GATE type-checks the standalone stage files (no test imports them). Confirm `eslint .` stays 0/0 on the new
  `benchmark/**` — add a scoped `files:['benchmark/**/*.ts']` block ONLY if a real `no-undef`/violation surfaces
  (decision criterion per RESOLVED). Design D4; Open Q3. Done: `npx tsc --noEmit`; `npm run lint`.
- [ ] 2.2 Create `benchmark/generate.ts` skeleton + `benchmark/impact-snippets/`: open the built graph at
  `<project>/.dbgraph/dbgraph.db` via `createSqliteGraphStore` (from `dist/index.js`) + `dist/cli.js … --json`; wire
  the six-family enumerator with per-family candidate source + canonical lexicographic sort key + first-N-lexicographic
  selection (D7, NO seed/randomness). Emit `--per-family` (default 1 → N=6) and print N in the `questions.yaml` header.
  Design §Question generation table; Open Q1. Done: stage runs against a torture-built graph, lists candidates
  deterministically.
- [ ] 2.3 In `generate.ts`, derive the three SPEC-PINNED families BYTE-for-BYTE: `fk-path` ordered hops
  `{fromTable,toTable,joinColumns[]}` from the FK EDGE table; `column-type` `{dataType,nullable}` from node FIELD
  payloads; `impact` `whatToTest` from `affected <impact-snippets/<qid>.sql> --json` — generating each snippet from
  column nodes then WRITING it committed under `impact-snippets/` (RESOLVED). Spec scenario "Each family's ground
  truth is derived by its pinned rule (byte-for-byte)". Done: regenerating reproduces `ground-truth/*.json` identically.
- [ ] 2.4 In `generate.ts`, derive the three ADDITIVE families: `trigger-inventory` `{triggerQname,timing,events}`
  from trigger nodes + `fires_on` edges (STRICT, RESOLVED); `view-dependency` dependency qnames from
  `depends_on`/`reads_from` edges; `constraint-semantics` PK column order from `constraint` nodes (`ConstraintPayload`).
  Each key file carries a `source_ddl_ref` pointer into `torture.sql` (D5). Spec scenario "Each family's ground truth
  is derived by its pinned rule". Done: keys carry `source_ddl_ref`; `constraint-semantics` preserves PK order.
- [ ] 2.5 SELF-CHECK assertions in `generate.ts` (fail LOUDLY): (a) `5 ≤ N ≤ 10` HARD-ASSERT (guards the spec bound
  against a `--per-family` bump); (b) EVERY `ground-truth/<qid>.json` carries a `source_ddl_ref`; (c) NO ground-truth
  VALUE string appears verbatim in the matching `questions.yaml` entry (D5 leakage guard). Spec scenarios "N is fixed
  and pre-registered before any run" + "No question embeds its own answer". Done: assertions run inside `generate.ts`;
  a planted leak/over-N aborts the stage.
- [ ] 2.6 Run `generate.ts` against the torture-built graph and COMMIT the frozen pre-registered set:
  `benchmark/questions.yaml` (N=6 header) + `benchmark/ground-truth/*.json` + `benchmark/impact-snippets/*.sql`. This
  is the pre-registration — fixed BEFORE any transcript exists under `runs/`. Spec scenarios "N is fixed and
  pre-registered before any run" + "Primary substrate is rebuildable from committed source". Done: set committed;
  `git status` shows the frozen artifacts.
- [ ] 2.7 GATE (Batch 2): `npx tsc --noEmit` clean (now covers `benchmark/generate.ts`); `npm run lint` 0/0;
  `npm test` green with ZERO benchmark artifacts (the committed `questions.yaml`/`ground-truth`/`impact-snippets` are
  NOT run artifacts and MUST NOT make any vitest suite depend on a run — confirm none does); leak-scan clean (synthetic
  fixture). Commit `feat(benchmark): add generate stage — pre-registered questions and mechanical ground truth (US-035)`.

## Batch 3: `build-packets.ts` + `score.ts` + `render.ts` + protocols + `.gitignore` (Stages 2 & 4, self-checked)

> Satisfies benchmark "Two condition protocols differ ONLY in schema access under one fixed token boundary" (all four
> scenarios) + the driver half of "scorer tests pass in npm test" (the driver imports the Batch-1 scorer, condition-
> blind). NOT vitest-TDD — dev stages with LOUD self-check assertions; correctness of scoring rides on Batch 1's unit
> tests. Builds the code the ORCHESTRATOR run (Batch R) invokes.

- [ ] 3.1 Create `benchmark/build-packets.ts`: per question emit `packets/<qid>.with.md` (question + allowed-command
  doc block for EXACTLY `query --json`, `explore`, `affected --json`, `status` + "do NOT read any `.sql`/DDL file —
  use the tool", D11; NO DDL, NO key) and `packets/<qid>.without.md` (question + full `sqlite_master` DDL dump +
  IDENTICAL answer-format spec; NO tool docs, NO key). Question text + `{{ANSWER_FORMAT_SPEC}}` (the per-family
  canonical SHAPE from Batch 1, never a value) are byte-identical across the pair. Spec scenarios "WITH exposes
  exactly the four documented commands" + "Identical framing across conditions". Done: paired packets differ ONLY in
  the schema-access section.
- [ ] 3.2 In `build-packets.ts`, the WITHOUT DDL dump = `SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL
  AND name NOT LIKE 'sqlite_%' ORDER BY type,name` — the comment-free catalog DDL a dev inheriting the DB gets (D8),
  NOT the annotated `torture.sql`. Compute `schemaTokens` per side via Batch 1 `tokens.ts` (WITHOUT = dump once; WITH
  = concat of tool outputs at run time), the SAME boundary both sides. Spec scenarios "WITHOUT dump is fair, from the
  same source of truth" + "One token boundary applied identically". Done: dump is complete + un-impoverished; token
  accounting is symmetric.
- [ ] 3.3 SELF-CHECK assertion in `build-packets.ts` (fail LOUDLY): NO ground-truth key value appears in ANY packet;
  the WITH packet contains NO DDL; the WITHOUT packet contains NO tool docs. Emit `promptSha256` per packet so verify
  can later confirm no key leaked. Spec scenario "No question embeds its own answer" (prompt half). Done: a planted key
  in a packet aborts the stage.
- [ ] 3.4 Create `benchmark/protocols/with.md` + `benchmark/protocols/without.md` — human-readable condition contracts
  MIRRORING the pinned run templates (identical system framing + question + answer-format; WITH = read-only CLI, no
  file reads; WITHOUT = DDL dump only, no tools). Spec scenarios "WITH exposes exactly the four documented commands" +
  "Identical framing across conditions". Done: protocols match the design run templates verbatim in framing.
- [ ] 3.5 Create `benchmark/score.ts` + `benchmark/render.ts`: `score.ts` reads `runs/<id>/raw/*.json`, runs each
  answer (both conditions) through the Batch-1 scorer BLIND to the label (D13), writes `scored/per-question.json` +
  `aggregate.json` (per-family + overall accuracy per condition; token totals + delta); `render.ts` turns
  `aggregate.json` into the `docs/benchmarks.md` results table in STABLE order. Spec scenario "Scorer is blind to
  condition labels" (driver half). Done: driver imports `scorer/`; no label reaches the comparator.
- [ ] 3.6 Create `benchmark/.gitignore` (or root entries): ignore `benchmark/packets/` + `benchmark/runs/` (generated
  working artifacts). Confirm `benchmark/questions.yaml` + `ground-truth/` + `impact-snippets/` + `protocols/` stay
  TRACKED (the pre-registered/committed set). Design §Layout. Done: `git status` ignores packets/runs, tracks the set.
- [ ] 3.7 GATE (Batch 3): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green with ZERO benchmark artifacts
  (confirm NO vitest suite imports `build-packets`/`score`/`render` or reads `runs/`); leak-scan clean. Commit
  `feat(benchmark): add packet builder, scorer driver, renderer, and condition protocols (US-035)`.

## Batch 4: `docs/benchmarks.md` skeleton (limitations DRAFTED NOW) + US-035 reconciliation + npm-test-independence proof (docs)

> Satisfies benchmark "The report carries all limitations alongside results and forbids extrapolation" (sections in
> order + limitations enumerated + no-extrapolation prose) + "npm test is independent of any benchmark run" (both
> scenarios) + the US-035 story reconciliation (proposal Approach). DOCS + a hard independence assertion. The
> limitations + reproduce-it-yourself ship NOW so the orchestrator (Batch R) can only FILL results into a document
> that already forbids overclaiming.

- [ ] 4.1 Create `docs/benchmarks.md` with ALL required sections IN ORDER: **The claim under test**, **Methodology**,
  **Environment** (model family/version, date, dbgraph version, Node ≥22.6 note, substrate), **N** (=6, six families,
  `--per-family 1`), **Results** (placeholder table: per-family + Overall × WITH/WITHOUT accuracy + schema-tokens;
  per-question appendix), **Token accounting** (actual-preferred, else chars/4 LABELED approximate; one boundary both
  sides), **Limitations**, **Reproduce it yourself** (step-by-step build→generate→build-packets→run→score). Spec
  scenario "All required sections present in order". Done: all seven headings present in the spec's order.
- [ ] 4.2 Draft the **Limitations** section NOW, ALONGSIDE the (empty) Results — enumerate AT LEAST: self-run
  (author designs/runs/scores), single model family (Claude), small N (~6), single/dual schema, not peer-reviewed,
  non-reproducible secondary run, integrated-auth read-only DOWNGRADE, shared-extraction circularity (key derived via
  dbgraph's OWN path), chars/4 approximation, free-text QUALITY not scored. Spec scenario "Limitations enumerated
  alongside results". Done: limitations present next to Results, none buried.
- [ ] 4.3 In `docs/benchmarks.md`, PIN the anti-extrapolation contract: every result MUST be scoped "on this fixture,
  this question set, this model"; forbid "X% better in general" / unqualified "more accurate" / any generalized
  superiority claim; state the secondary section is labeled NON-reproducible with read-only BY CONSTRUCTION (not a
  grant, integrated/SSPI) + SSMS contrast = author attestation; state unfavorable results MUST be reported. Spec
  scenarios "No extrapolation beyond measured conditions" + "Secondary run labeled non-reproducible with honest
  read-only downgrade" + "Unfavorable results are reported, not suppressed" (the report's standing obligations; Batch R
  honors them at fill time). Done: the prose forbids extrapolation before any number is written.
- [ ] 4.4 Modify `docs/stories/07-quality-publication.md`: reconcile US-035 to what shipped — REPRODUCIBLE harness +
  torture-fixture-first substrate; real-DB run OPTIONAL corroboration with read-only DOWNGRADED to read-only-by-
  construction (integrated auth), SSMS contrast as author attestation; duration/index-size/peak-memory reported
  opportunistically, not as hard gates. Proposal §Stories / Approach. Done: story note matches delivered scope.
- [ ] 4.5 Add a `test/benchmark/independence.test.ts` (vitest, PART of `npm test`) that ASSERTS the decoupling: NO
  vitest suite imports `benchmark/{generate,build-packets,score,render}.ts`, spawns an agent run, or reads
  `benchmark/runs/`; the scorer suites depend ONLY on committed `test/benchmark/fixtures/*.json`. Spec scenarios
  "Suite green with no run artifacts" + "No vitest suite triggers a benchmark run". Done: `npm test` green on a clean
  checkout with `runs/` empty + Results unfilled.
- [ ] 4.6 GATE (Batch 4 — final apply): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green with ZERO
  benchmark artifacts (INCLUDING the new independence test); DOCS-verify — all seven sections in order, limitations
  enumerated alongside Results, no-extrapolation prose present, no private name in docs (only the synthetic fixture);
  leak-scan clean. Commit `docs(benchmark): add benchmarks.md methodology and limitations, wire tsconfig, reconcile US-035`.

## Batch R — the RUN (executed by the ORCHESTRATOR between apply and verify — NOT an apply-agent task)

> This batch is NOT run by an apply sub-agent and is NOT a vitest suite. The COORDINATING session executes it after
> Batch 4's GATE is green and BEFORE verify. It dispatches isolated sub-agents (one question × condition per
> invocation, fresh context — D10) using the design's PINNED templates, then scores and fills `docs/benchmarks.md`.
> Covers the RUN-TIME scenarios; verify checks presence/honesty afterward.

- [ ] R.1 Build the graph from the committed fixture: `dbgraph init` / `sync` against `test/fixtures/sqlite/torture.sql`
  → `.dbgraph/dbgraph.db` in an isolated working dir. Spec scenario "Primary substrate is rebuildable from committed
  source" (execution). READ-ONLY throughout.
- [ ] R.2 `node --experimental-strip-types benchmark/generate.ts` (Node ≥22.6) then `… benchmark/build-packets.ts` →
  `packets/<qid>.{with,without}.md` (uses the COMMITTED pre-registered set; regenerating must reproduce it). Spec
  scenario "Each family's ground truth is derived by its pinned rule".
- [ ] R.3 For EACH question, launch TWO isolated sub-agents (WITH: working dir + read-only CLI, FORBIDDEN from reading
  any `.sql`/DDL file — D11; WITHOUT: DDL dump only, no tools) with the IDENTICAL pinned system framing + question +
  `ANSWER FORMAT` spec; force the final `ANSWER:` line. Spec scenarios "WITH exposes exactly the four documented
  commands" + "Identical framing across conditions" (execution).
- [ ] R.4 Save each invocation to `benchmark/runs/<run-id>/raw/<qid>.<condition>.json` (`runId`, `qid`, `family`,
  `condition`, `model`, `promptSha256`, `answerRaw`, `answerParsed`, `tokens{mode,schemaTokens}`, `transcriptRef`) +
  the full transcript beside it. Spec scenario "One token boundary applied identically" (recorded per side).
- [ ] R.5 `node --experimental-strip-types benchmark/score.ts runs/<id>` → `scored/per-question.json` +
  `aggregate.json` (blind to condition, D13); `render.ts` → the `docs/benchmarks.md` Results table. Spec scenario
  "Scorer is blind to condition labels".
- [ ] R.6 FILL `docs/benchmarks.md` Results + per-question appendix + Environment (model id, run id, date, versions)
  FAITHFULLY — report EVERY per-question outcome even where dbgraph is no-better/worse; write NO extrapolation. Spec
  scenarios "Unfavorable results are reported, not suppressed" + "No extrapolation beyond measured conditions".
- [ ] R.7 SECONDARY (optional): if `dbgraph status` confirms `C:\temp\dbgraph-validation` opens, run the SAME harness
  read-only against the mssql graph; APPLY the redaction map (generalized placeholders) BEFORE writing any private
  name; tag `substrate: mssql-private`, `reproducible: false`, `provenance: author-attested`; restate read-only BY
  CONSTRUCTION + SSMS = author attestation. If it does NOT open, the report states the secondary run was SKIPPED (the
  benchmark still completes on the fixture). Spec scenarios "Secondary substrate is optional corroboration only" +
  "Secondary run labeled non-reproducible with honest read-only downgrade".
- [ ] R.8 Commit the filled report + committed artifacts (runs/ stays git-ignored):
  `docs(benchmark): record WITH/WITHOUT results on the torture fixture (US-035)`. Hand off to verify.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 1** (1.1–1.9): CODE — `benchmark/scorer/{index,families,tokens}.ts` (six pure comparators, `parseAnswer`/
  `normalizeQname`/`canonicalType`, token formula, condition-blind `scoreAnswer`) + `test/benchmark/scorer.test.ts` +
  committed `test/benchmark/fixtures/*.json`. STRICT TDD; the load-bearing tested core.
- **Batch 2** (2.1–2.7): DEV TOOLING — `tsconfig.json` (`"benchmark"` include) + `benchmark/generate.ts` +
  `benchmark/impact-snippets/*.sql` + COMMITTED `benchmark/questions.yaml` + `benchmark/ground-truth/*.json`. Mechanical
  derivation + self-check asserts; pre-registers the frozen set.
- **Batch 3** (3.1–3.7): DEV TOOLING — `benchmark/build-packets.ts` + `benchmark/score.ts` + `benchmark/render.ts` +
  `benchmark/protocols/{with,without}.md` + `.gitignore`. Packet builder + Stage-4 driver + protocols.
- **Batch 4** (4.1–4.6): DOCS — `docs/benchmarks.md` skeleton (limitations DRAFTED, reproduce-it-yourself,
  placeholders) + `docs/stories/07-quality-publication.md` reconciliation + `test/benchmark/independence.test.ts`.
- **Batch R** (R.1–R.8): ORCHESTRATOR-ONLY run between apply and verify — NOT an apply sub-agent, NOT vitest.

> Ordering note: this INVERTS the design's suggested "harness-first" batch order — the SCORER lands FIRST because
> every downstream stage imports its SAME modules (D3, no duplicated normalization) and the per-family `ANSWER FORMAT`
> that `build-packets` embeds is DEFINED by the scorer. The `"benchmark"` tsconfig include is pulled into Batch 2
> (not deferred) so each batch's `tsc --noEmit` GATE honestly covers the standalone stages it introduces. Both moves
> are dictated by the artifacts (skill §"Adjust as the artifacts dictate").

### Dependency bottlenecks

- **Batch 1 gates Batches 2–4 and Batch R.** `generate.ts`, `build-packets.ts`, and `score.ts` all import
  `benchmark/scorer/` (D3). If the scorer's canonical answer forms drift after packets are built, the run inherits a
  mismatched `ANSWER FORMAT` — build the tested core FIRST.
- **Batch 2 (committed pre-registered set) gates Batch 3 and Batch R.** `build-packets` reads `questions.yaml` +
  `ground-truth/`; the set MUST be frozen (pre-registered BEFORE any run) or "N fixed before any run" is violated.
- **Spec↔design N conflict is the sharp edge.** Design D6's six families × `--per-family 2` (~12) EXCEEDS spec Req 2's
  fixed 5–10 bound. Resolved to `--per-family 1` (N=6) with a HARD `5 ≤ N ≤ 10` assert in `generate.ts` (2.5). If a
  future run bumps `--per-family`, the assert MUST fail the stage — do NOT relax it without amending the spec.
- **Self-check assertions are the docs/dev-tooling substitute for TDD.** Stages 2–3 are NOT vitest suites (coupling
  `npm test` to a run is a Req-6 VIOLATION); the generator leak/`source_ddl_ref`/N asserts (2.5) and the packet
  no-key/no-DDL/no-tool-docs asserts (3.3) are what make the harness falsifiable without a run.
- **The `4.5` independence test + every batch GATE's "green with ZERO benchmark artifacts" are the no-CI safety net.**
  With no CI, a vitest suite accidentally reading `runs/` or spawning an agent would couple `npm test` to a run and
  ship undetected; 4.5 pins the decoupling.
- **Batch 4 must precede Batch R.** The orchestrator FILLS a `docs/benchmarks.md` that already carries the limitations
  + anti-extrapolation contract, so a favorable headline can never ship without them.
- **Batch R is the ONLY non-mechanical step** — it depends on live sub-agent behavior + the optional private mssql
  graph. Its honesty (report unfavorable results, redact private names, no extrapolation) is enforced by the Batch-4
  document contract and re-checked by verify, NOT by a test.

## Definition of Done (tied to the proposal's Success Criteria; 20 spec scenarios traced)

- [ ] Anyone rebuilds the torture-fixture graph and re-runs WITH/WITHOUT per `docs/benchmarks.md` — reproducible, no
  private DB. — Batch 2 (2.6), Batch 4 (4.1), Batch R (R.1–R.2) [scenarios: primary rebuildable, secondary optional]
- [ ] Ground truth is DERIVED mechanically (documented, re-runnable) — six families, three spec-pinned by their exact
  rule, `source_ddl_ref` on every key. — Batch 2 (2.3, 2.4, 2.5) [scenarios: pinned-rule derivation, N pre-registered,
  no embedded answer]
- [ ] Both conditions get IDENTICAL questions + framing; schema access is the ONLY difference; WITH = exactly the four
  documented commands; WITHOUT = fair `sqlite_master` dump. — Batch 3 (3.1, 3.2, 3.4) [scenarios: four commands,
  fair dump, identical framing]
- [ ] Scoring is deterministic + BLIND for closed-form; no free-text family (rubric excluded, flagged as a
  limitation); one token boundary applied identically, chars/4 LABELED. — Batch 1 (1.2–1.8), Batch 3 (3.2)
  [scenarios: exact/set-match, blind to labels, rubric flagged, one token boundary]
- [ ] `docs/benchmarks.md` presents ALL required sections IN ORDER with limitations ALONGSIDE results, forbids
  extrapolation, reports unfavorable results, labels the secondary run non-reproducible with the read-only downgrade.
  — Batch 4 (4.1, 4.2, 4.3), Batch R (R.6, R.7) [scenarios: sections in order, limitations enumerated, no
  extrapolation, unfavorable reported, secondary labeled]
- [ ] `npm test` is GREEN with ZERO benchmark artifacts; the scorer unit tests pass inside it; NO vitest suite triggers
  a run. — Batch 1 (1.9), Batch 4 (4.5, 4.6) + every batch GATE [scenarios: suite green no artifacts, no vitest
  triggers a run]
- [ ] No writes to any target DB; the real validation graph, if used, is opened read-only and REDACTED. — Batch R
  (R.1, R.7)
- [ ] `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; leak-scan clean — all proven LOCALLY (no CI),
  nothing pushed past `closeout`. — every batch GATE (1.9, 2.7, 3.7, 4.6)
