# Design: Phase benchmark — WITH/WITHOUT harness, mechanical ground truth, honest numbers (phase-benchmark)

## Technical Approach

A four-stage, fully-deterministic harness lives OUTSIDE `src/`/`dist/` and drives the ALREADY-SHIPPED
CLI (`dist/cli.js`). Stage 1 (`generate`) reads the built graph and emits pre-registered questions +
mechanical ground truth. Stage 2 (`build-packets`) emits, per question, TWO prompt packets (WITH tool
docs / WITHOUT a realistic DDL dump) that never contain the answer key. Stage 3 (the RUN) is executed
by the ORCHESTRATOR between apply and verify: it dispatches one sub-agent per (question × condition),
forces a machine-parseable `ANSWER:` line, and drops transcripts + token counts under
`benchmark/runs/<run-id>/raw/`. Stage 4 (`score`) is a PURE, condition-blind comparator set that emits
per-question + aggregate JSON and the markdown table for `docs/benchmarks.md`.

The only NEW code that `npm test` exercises is the Stage-4 comparators (pure, node-builtins-only,
unit-tested under `test/benchmark/`). Stages 1–3 are dev/orchestrator tooling — never a vitest suite,
never shipped. The published package whitelist (`package.json` `"files": ["dist"]`) already excludes
`benchmark/`, `test/`, and `docs/`, and `tsup` bundles only `src` entrypoints, so NOTHING here can leak
into npm — the leak-prevention guarantee is structural, not a new ignore rule.

Every design choice below names the VALIDITY THREAT it defends against (proposal Risks table). Honesty
is the load-bearing requirement: a self-run benchmark that overstates its meaning is worse than none.

## Confirmed CLI surface (grounding the WITH condition)

Read against `src/cli/commands/*` + `src/cli/dispatch.ts` (NOT memory):

| Command | `--json`? | JSON shape (the WITH agent's structured surface) |
|---------|-----------|--------------------------------------------------|
| `query <term> --json` | YES | `{ term, total, hits:[{ kind, qname, id, score }] }` (`format/query.ts`) |
| `affected <file.sql> --json` | YES | `PrecheckView` = `{ matchedObjects:[{qname,kind,confidence}], impact:{triggers,writers,readers,constraintsAndIndexes,whatToTest}, unmatchedIdentifiers }` (`precheck/engine.ts`) |
| `explore <qname> [--detail brief\|normal\|full]` | **NO — text only** | Deterministic text (`present/explore.ts`); neighbor groups by edge kind/direction |
| `status` | text | per-kind counts + snapshot/drift (`format/status.ts`) |

Finding that shapes the design: **`explore` has NO `--json` path** (`handleExplore` never reads a json
flag). So ground-truth DERIVATION uses `query --json` + `affected --json` + direct graph-store reads
(never `explore`); the WITH AGENT may still use `explore` text output for reasoning — text is fine for a
reader. The graph is a SQLite DB at `<project>/.dbgraph/dbgraph.db` (nodes/edges/fts/snapshots), openable
via the shipped `createSqliteGraphStore` from `dist/index.js`.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale + THREAT mitigated |
|---|----------|--------|----------|------------------------------|
| D1 | Harness home | Top-level `benchmark/` (code + questions + packets + runs); scorer unit tests under `test/benchmark/` | `scripts/benchmark/` | `benchmark` is a durable METHODOLOGY contract (its own spec), not build tooling; proposal names `benchmark/` verbatim. `scripts/` is reserved for SEA/git-hooks build drivers. |
| D2 | Package-leak guard | RELY on the existing `"files": ["dist"]` whitelist + `tsup` src-only entries; add NOTHING to ship-path | add `.npmignore`; move code under `src/` | Whitelist already excludes `benchmark/`/`test/`/`docs/`; verified nothing references benchmark from a `tsup` entry. THREAT: benchmark artifacts leaking into the published package (Standard: "no benchmark artifacts"). |
| D3 | Language + run mode | ALL harness code is `.ts`. Pure comparators tested by vitest. Executable entrypoints (`generate`/`build-packets`/`score`/`render`) run via `node --experimental-strip-types` (engines `>=22`; benchmark run is a dev/orchestrator step) | `.mjs` scripts that can't import the typed comparators; add `tsx`/`ts-node` dep | Zero new deps (Standard); the comparators the tests cover are the SAME modules the run imports — no duplicated normalization. THREAT: scorer divergence between tested code and run code. |
| D4 | tsconfig / eslint scope | ADD `"benchmark"` to `tsconfig.json` `include`; let `eslint .` lint `benchmark/**` (not in `ignores`) | leave benchmark untyped/unlinted | Type-checks + lints the harness under the same gate; build (tsup) is unaffected (its entries are src-only) so dist stays clean. THREAT: silent type/lint rot in the eval apparatus. |
| D5 | Ground-truth source | DERIVE mechanically from the BUILT graph (`--json` + store reads), and EMIT alongside each key a `source_ddl_ref` pointer into `torture.sql` so a reviewer can audit key==DDL | hand-author answers; parse DDL with a bespoke extractor | Mechanical + re-runnable + auditable. THREAT: self-run bias / author unconsciously biasing questions toward dbgraph's strengths. Circularity (key shares dbgraph's extraction path) is NAMED as a limitation, not hidden. |
| D6 | Question families | SIX closed-form families: `fk-path`, `column-type`, `impact`, `trigger-inventory`, `view-dependency`, `constraint-semantics`. NO free-text "explain" family scored | a rubric-scored prose "explanation" family | Closed-form = deterministic scoring. `column-type` is the NEGATIVE CONTROL (a DDL reader answers it as easily). THREAT: leading questions cherry-picked to favor the graph; scorer subjectivity on open-ended items. |
| D7 | Selection rule | Per family: enumerate ALL candidates from the graph, sort by a canonical lexicographic key, dedupe identical ground-truth tuples, take FIRST N. NO seed, NO randomness | random sampling; hand-picked instances | Seed-free determinism (ADR-008). THREAT: cherry-picking; non-reproducibility. |
| D8 | DDL dump (WITHOUT) | `sqlite_master.sql` for all non-internal objects, deterministically ordered (type, then name) — the comment-free catalog DDL a dev inheriting the DB actually gets | the annotated `torture.sql` source file | The authored file's teaching comments are NOT what a real dev has; using them would inject an unrealistic advantage. Realism is the honesty criterion, applied even though it happens to remove comments. THREAT: condition asymmetry / strawman-or-inflated WITHOUT input. |
| D9 | Token accounting | Prefer ACTUAL runtime usage; else `ceil(chars/4)` LABELED approximate. Boundary is fixed + identical both sides: count ONLY schema-bearing text — WITHOUT = the DDL dump (once, up front); WITH = concatenation of all dbgraph tool outputs received. Question + system framing are identical across conditions → EXCLUDED (they cancel) | count whole prompts; different formula per side | One boundary, applied identically. THREAT: token-unfairness between conditions. |
| D10 | Run granularity | ONE question per agent invocation (not batched), fresh context each time | batch all questions per agent | Batching lets a WITH agent accumulate the whole schema across questions (collapsing the token delta) and bleeds context across answers. THREAT: cross-question contamination + token-delta collapse. |
| D11 | WITH isolation | WITH agent gets a working dir with the built graph + read-only CLI, and is FORBIDDEN from reading any `.sql`/DDL file directly (must go through the tool) | let WITH read files freely | If WITH can `cat torture.sql` it degenerates into WITHOUT. THREAT: condition collapse. |
| D12 | Answer format | Final line MUST be `ANSWER: <canonical-value>` (per-family canonical form); scorer parses ONLY that line | free-form answers scored by an LLM | Machine-parseable + deterministic; no LLM-judge subjectivity. THREAT: scorer subjectivity; ground-truth leakage (format spec carries NO expected value). |
| D13 | Scorer blindness | Comparators receive ONLY `{ family, answerParsed, groundTruth }` — NEVER the condition label | pass the condition through for "context" | A scorer that knows the label can bias. THREAT: self-run scoring bias. |
| D14 | Primary substrate | Committed SQLite `torture.sql` is load-bearing; the mssql graph is OPTIONAL, labeled corroboration | make the real DB the headline number | The private DB is non-reproducible + non-committable. THREAT: overstated/private-provenance results; deliverable depending on a private graph. |
| D15 | `npm test` decoupling | Scorer tests import COMMITTED fixture ground-truth stubs under `test/benchmark/fixtures/`; they need no generated questions and no run | drive scorer tests off a live run | `npm test` stays green on a clean checkout with zero benchmark artifacts (Standard). THREAT: `npm test` accidentally coupled to a benchmark run. |

## Layout

```
benchmark/
  generate.ts          # Stage 1 — build questions.yaml + ground-truth/*.json from the built graph
  build-packets.ts     # Stage 2 — emit packets/<qid>.{with,without}.md (never the key)
  score.ts             # Stage 4 driver — read runs/<id>/raw/*.json → scored + aggregate + table
  render.ts            # Stage 4 — aggregate.json → docs/benchmarks.md results table (stable order)
  scorer/
    index.ts           # re-exports comparators + parseAnswer + normalizeQname
    families.ts        # one pure comparator per family (D6)
    tokens.ts          # token-accounting formula (D9), pure
  questions.yaml       # GENERATED, committed as the pre-registered set (fixed before any run)
  ground-truth/*.json  # GENERATED keys, each with source_ddl_ref (D5)
  protocols/
    with.md            # human-readable WITH condition contract (mirrors D11/D12)
    without.md         # human-readable WITHOUT condition contract
  packets/             # GENERATED per-question prompt bodies (git-ignored working artifact)
  runs/                # RUN outputs: <run-id>/raw/*.json + /scored + /aggregate.json (git-ignored)
test/benchmark/
  scorer.test.ts       # vitest — every comparator rule, RED→GREEN, in `npm test`
  fixtures/*.json      # committed ground-truth + answer stubs (D15)
docs/benchmarks.md     # methodology + FULL limitations + results placeholder + reproduce-it-yourself
```

`benchmark/packets/` and `benchmark/runs/` are generated working artifacts → add to `.gitignore`.
`benchmark/questions.yaml` + `benchmark/ground-truth/` ARE committed (the pre-registered set — proposal:
questions fixed BEFORE any run). tsconfig `include` gains `"benchmark"` (D4).

## Question generation (`generate.ts`)

Input: the built graph at `<project>/.dbgraph/dbgraph.db` (torture fixture primary; mssql secondary).
Reads via the shipped `dist/index.js` store API + `dist/cli.js ... --json` — NEVER re-implements
extraction. Output: `questions.yaml` (pre-registered set) + `ground-truth/<qid>.json`.

Families, torture-fixture candidates, canonical sort key, ground-truth derivation, scorer rule:

| Family | Example question | Candidate source | Canonical sort key | Ground-truth derivation | Scorer rule |
|--------|------------------|------------------|--------------------|-------------------------|-------------|
| `fk-path` | "What FK join path connects `assignments` to `departments`?" | `references` edges / join-path query | `fromTable\|toTable` | ordered hops `{fromTable,toTable,joinColumns[]}` from graph edges | SET equality of `A.col=B.col` hop atoms (D12 canonical) |
| `column-type` (control) | "Declared type + nullability of `employees.salary`?" | column nodes | `table.column` | `ColumnPayload {dataType,nullable}` | EXACT match on `TYPE\|NULL` (synonym-normalized) |
| `impact` | "Given this `ALTER TABLE employees …`, what should you test?" | `affected --json` over a generated DDL snippet | snippet filename | `PrecheckView.impact.whatToTest` set | SET equality of normalized qnames |
| `trigger-inventory` | "Which triggers fire on `employees` for UPDATE, and their timing?" | trigger nodes + `fires_on` edges | `table\|event` | set of `{triggerQname,timing,events}` | SET equality of trigger qnames (+ optional timing/events) |
| `view-dependency` | "Which tables does view `employee_summary` read from?" | `depends_on`/`reads_from` edges | view qname | set of dependency qnames | SET equality of normalized qnames |
| `constraint-semantics` | "Columns of the composite PK of `assignments`?" | `constraint` nodes (`ConstraintPayload`) | `table\|constraintType` | ordered/set column list | SET equality (ordered for PK column order) |

Torture coverage is rich enough for all six: composite FK (`assignments`→`employees`), WITHOUT ROWID PK
(`counters`), 6 triggers incl. INSTEAD OF on a view, two views, partial/expression/unique indexes.

**N per family:** default `--per-family 2` → ~10–12 questions total (proposal's 5–10 is the floor; N is a
declared knob, its value printed in the `questions.yaml` header and in `docs/benchmarks.md`). Selection
is deterministic first-N-lexicographic (D7). Small N is a STATED limitation, never hidden.

**Pre-registration + leakage guard:** `generate.ts` asserts (a) each ground-truth key file carries a
`source_ddl_ref` (D5), and (b) NO ground-truth VALUE string appears in the corresponding `questions.yaml`
entry (defends "ground-truth leakage into prompts", proposal Risk 3). `questions.yaml` is committed once
and treated as frozen for a given run.

## Condition packet builder (`build-packets.ts`)

Per question, emits two packets that share the IDENTICAL question text and answer-format spec and differ
ONLY in schema access:

- **WITH** (`packets/<qid>.with.md`): question + the allowed-command doc block (read-only usage of
  `query --json`, `explore`, `affected --json`, `status`) + "the indexed graph is in your working dir;
  do NOT read any `.sql`/DDL file — use the tool" (D11). NO DDL. NO key.
- **WITHOUT** (`packets/<qid>.without.md`): question + the full DDL dump (D8). NO tool docs, NO graph. NO key.

**DDL dump source (D8, the FAIREST):** `SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND
name NOT LIKE 'sqlite_%' ORDER BY type,name` — the comment-free catalog DDL a developer inheriting the
database actually gets (equivalent to `.schema`). NOT the authored `torture.sql` (its pedagogical comments
are not present in any real catalog and would inflate WITHOUT unrealistically). For the mssql secondary,
the equivalent is the catalog-scripted DDL a dev would obtain (SSMS "Generate Scripts" / the adapter's dump)
— NON-reproducible (private schema).

**Token accounting (D9), applied identically to both:**
```
schemaTokens(actual) = runtime-reported input+output tokens for schema-bearing content, when available
schemaTokens(approx) = ceil(len(schemaText)/4)          # LABELED approximate
  WITHOUT.schemaText = the DDL dump (counted once)
  WITH.schemaText    = concat(all dbgraph tool outputs the agent received during the question)
# question text + system framing are byte-identical across conditions → excluded (cancel in the delta)
```
`tokens.ts` is pure and unit-tested (chars/4 boundary, actual-vs-approx labeling).

## Run protocol (executed by the ORCHESTRATOR between apply and verify)

NOT a vitest suite. The coordinating session runs, for each question, TWO isolated sub-agent invocations
(D10: one question per invocation, fresh context). Pinned templates (placeholders `{{…}}`):

**System framing (IDENTICAL both conditions):**
```
You are answering ONE database-schema question. Reason as needed, then end your reply with a single
final line in EXACTLY this form:
ANSWER: <value>
where <value> follows the answer-format spec given below. Output nothing after that line.
```

**WITH user prompt:**
```
QUESTION: {{QUESTION}}
ANSWER FORMAT: {{ANSWER_FORMAT_SPEC}}

You have a dbgraph-indexed graph of the target database in your working directory. Use ONLY the
read-only dbgraph CLI to inspect the schema:
  dbgraph query "<term>" --json
  dbgraph explore "<qname>" --detail full
  dbgraph affected "<script.sql>" --json
  dbgraph status
Do NOT open, cat, or read any .sql / DDL / schema file directly — use the tool. The tool issues only
read-only catalog SELECTs; you must not attempt any write.
```

**WITHOUT user prompt:**
```
QUESTION: {{QUESTION}}
ANSWER FORMAT: {{ANSWER_FORMAT_SPEC}}

Here is the database schema (DDL dump). You have no other tools for inspecting the database:
{{DDL_DUMP}}
```

Neither template contains the ground-truth value (asserted by `build-packets.ts`). `{{ANSWER_FORMAT_SPEC}}`
is the per-family canonical form (e.g. fk-path → `A.col=B.col; C.col=D.col` sorted; column-type →
`TYPE|NULLABLE`; sets → comma-separated sorted qnames) — carries the SHAPE, never the value.

**Access rules:** WITH agents get a working dir containing `.dbgraph/dbgraph.db` + `dbgraph.config.json`
and read-only CLI access; WITHOUT agents get NO dbgraph tool access and NO graph dir — only the embedded
DDL dump. Both get the identical system framing + question + format spec.

**Persistence** — each invocation writes `benchmark/runs/<run-id>/raw/<qid>.<condition>.json`:
```json
{
  "runId": "2026-07-06T…", "qid": "fk-path-001", "family": "fk-path",
  "condition": "with|without", "model": "<model-id>",
  "promptSha256": "…", "answerRaw": "…full final line…", "answerParsed": "…",
  "tokens": { "mode": "actual|approx", "schemaTokens": 1234 },
  "transcriptRef": "raw/fk-path-001.with.transcript.txt"
}
```
Full transcript text saved beside it. `promptSha256` lets verify confirm no key text was in any prompt.

## Scorer (`benchmark/scorer/`, pure, condition-blind — D13)

`scoreAnswer({ family, answerParsed, groundTruth }) → { correct: boolean, expected, got, detail }`.
Comparator per family (D6 table). Shared helpers: `parseAnswer(raw)` (extract the `ANSWER:` line, trim),
`normalizeQname(s)` (strip quotes/brackets, lowercase, collapse whitespace), `canonicalType(s)`
(uppercase, trim, INT↔INTEGER synonym table). All comparators are order-independent SET equality except
`column-type` (exact `TYPE|NULL`) and PK-order (`constraint-semantics` ordered). Rubric/open-ended items
are OUT (D6) — headline accuracy is 100% closed-form; free-text quality is explicitly NOT scored.

`score.ts` reads `runs/<id>/raw/*.json`, runs each answer (both conditions) through the SAME comparator
blind to the label, and emits:
- `runs/<id>/scored/per-question.json` — `{ qid, family, with:{correct,tokens}, without:{correct,tokens} }`
- `runs/<id>/aggregate.json` — per-family + overall accuracy per condition; token totals + delta
- the markdown results table (via `render.ts`) for `docs/benchmarks.md`

**vitest (`test/benchmark/scorer.test.ts`, RED→GREEN):** per comparator — exact match, mismatch,
set-equality order-independence, normalization (case/quotes/type-synonyms), empty answer, malformed
`ANSWER:` line; `parseAnswer` edge cases; token formula (chars/4 boundary, actual-vs-approx). One
determinism test: same input twice → identical output (ADR-008). Fixtures are committed stubs (D15) —
no generated questions, no run required.

## docs/benchmarks.md skeleton (limitations DRAFTED NOW — must ship WITH results)

```
# dbgraph benchmark — WITH vs WITHOUT graph context

## The claim under test
[one sentence: agent answering schema questions WITH dbgraph is more accurate and/or spends fewer
 schema-bearing tokens than the SAME agent WITHOUT it]

## Methodology
- Primary substrate: committed SQLite torture fixture (54 objects). N=<per-family> per family, 6 families.
- Ground truth: DERIVED mechanically from the built graph; each key carries a torture.sql source ref.
- Conditions: WITH (read-only dbgraph CLI) / WITHOUT (comment-free catalog DDL dump). Identical question
  + system framing; schema access is the only difference.
- Token accounting: actual runtime usage preferred; else chars/4 (APPROXIMATION). Same boundary both sides.
- Answer format: final `ANSWER:` line; deterministic comparator per family; scorer blind to condition.

## Results  [FILLED POST-RUN — placeholders below]
| Family | WITH accuracy | WITHOUT accuracy | WITH schema-tokens | WITHOUT schema-tokens |
|--------|---------------|------------------|--------------------|-----------------------|
| …      | {{ }}         | {{ }}            | {{ }}              | {{ }}                 |
| Overall| {{ }}         | {{ }}            | {{ }}              | {{ }}                 |
Per-question appendix: {{ }}   Model: {{ }}   Run id: {{ }}

## Limitations  [DRAFTED NOW — a result MUST NOT ship without these]
- SELF-RUN: the author designed, ran, and scored this eval. Not peer-reviewed.
- SINGLE MODEL FAMILY (Claude). No cross-model generalization claimed.
- SMALL N (~10) on a SINGLE primary schema (+ optional single secondary). No significance / p-values.
- Ground truth is derived via dbgraph's OWN extraction path — a shared-extraction circularity risk
  (a systematic extraction bug would bias both the key and the WITH answer the same way).
- Token counts use chars/4 APPROXIMATION when the runtime does not report actual usage.
- Free-text explanation QUALITY is not scored — only closed-form facts.
- The secondary real-DB run (if present) is NON-REPRODUCIBLE (private schema) and author-attested.
- Real-DB read-only is BY CONSTRUCTION of the tool (catalog SELECTs only), NOT enforced by a restricted
  grant — the validation config uses integrated (Windows SSPI) auth, the author's own principal.

## Reproduce it yourself
1. Build the graph from the committed fixture: `dbgraph init` / `sync` against torture.sql.
2. `node --experimental-strip-types benchmark/generate.ts` → questions + ground truth.
3. `node --experimental-strip-types benchmark/build-packets.ts` → per-question packets.
4. Run BOTH packets per question with your own agent (one question per invocation); save transcripts.
5. `node --experimental-strip-types benchmark/score.ts runs/<id>` → scored + aggregate + this table.
```

## Real-graph corroboration (`C:\temp\dbgraph-validation`, mssql — SECONDARY, optional)

Same harness, pointed at the private mssql graph (config verified: `dialect: mssql`, `auth: integrated`,
graph already built at `.dbgraph/dbgraph.db`). Run ONLY if `dbgraph status` opens it; read-only throughout.

- **What runs the same:** `generate` (same families, first-N-lexicographic), `build-packets` (WITHOUT dump
  = catalog-scripted DDL), the run protocol, and the scorer — identical code paths.
- **What is NOT reproducible:** the schema is private/proprietary — questions, ground truth, and object
  names CANNOT be committed; a third party cannot rebuild it. Results are corroboration, not the headline.
- **Labeling rules:** tag every secondary result `substrate: mssql-private`, `reproducible: false`,
  `provenance: author-attested`; REDACT/generalize private object names in `docs/benchmarks.md`; restate
  read-only-BY-CONSTRUCTION (not by grant) given integrated auth; any SSMS-accuracy contrast is an author
  attestation, LABELED as such (never a machine-verified figure). US-035's "dedicated read-only login" is
  reconciled as downgraded in the story note (proposal Approach).

## Data Flow

```
torture.sql ──dbgraph init/sync──▶ .dbgraph/dbgraph.db (nodes/edges/fts)
                                        │
                generate.ts ──reads via dist/cli.js --json + store API──▶ questions.yaml + ground-truth/*.json
                                        │                                   (source_ddl_ref; no key in questions)
                build-packets.ts ──────▶ packets/<qid>.with.md  (question + tool docs, NO ddl, NO key)
                       │                packets/<qid>.without.md (question + sqlite_master DDL, NO key)
                       ▼
   ORCHESTRATOR run (per question, 1 invocation each):
       WITH agent  (working dir + read-only CLI) ─┐
       WITHOUT agent (DDL only, no tools) ────────┤─▶ runs/<id>/raw/<qid>.<cond>.json  (ANSWER: + tokens)
                                                   ▼
       score.ts ──scorer/ (blind to condition)──▶ scored/per-question.json + aggregate.json
                                                   ▼
       render.ts ─────────────────────────────▶ docs/benchmarks.md results table
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `benchmark/generate.ts` | Create | Stage 1 — pre-registered questions + mechanical ground truth (D5/D6/D7); leakage + source-ref asserts |
| `benchmark/build-packets.ts` | Create | Stage 2 — WITH/WITHOUT packets; `sqlite_master` DDL dump (D8); no-key assert |
| `benchmark/score.ts`, `benchmark/render.ts` | Create | Stage 4 driver + markdown renderer (stable order) |
| `benchmark/scorer/{index,families,tokens}.ts` | Create | Pure comparators (D6) + token formula (D9); condition-blind (D13) |
| `benchmark/questions.yaml`, `benchmark/ground-truth/*.json` | Create (generated, committed) | The frozen pre-registered set + keys with `source_ddl_ref` |
| `benchmark/protocols/with.md`, `benchmark/protocols/without.md` | Create | Human-readable condition contracts mirroring the run templates |
| `benchmark/.gitignore` (or root entries) | Create/Modify | Ignore `benchmark/packets/` + `benchmark/runs/` (generated) |
| `test/benchmark/scorer.test.ts` + `test/benchmark/fixtures/*.json` | Create | Comparator unit tests in `npm test`; committed stubs (D15) |
| `docs/benchmarks.md` | Create | Methodology + FULL limitations (now) + results placeholder + reproduce-it-yourself |
| `tsconfig.json` | Modify | Add `"benchmark"` to `include` (D4) |
| `docs/stories/07-quality-publication.md` | Modify | US-035 reconciliation note (harness + torture-first + integrated-auth downgrade) |
| `openspec/specs/benchmark/spec.md` | Create (sdd-spec phase) | The `benchmark` methodology contract — authored in the spec phase, not here |

No `src/**` or `dist/**` change. No new runtime/dev dependency.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (comparators) | Each family rule: exact/set/ordered; case/quote/synonym normalization; empty + malformed `ANSWER:` | vitest, committed fixture stubs — RED→GREEN, in `npm test`, NO run required (D15) |
| Unit (parse/tokens) | `parseAnswer` extraction; `normalizeQname`; token chars/4 boundary + actual-vs-approx label | pure-function assertions |
| Unit (determinism) | Same input twice → byte-identical scorer output | ADR-008 pin |
| Generator self-check | Every key has `source_ddl_ref`; no ground-truth VALUE appears in `questions.yaml` | assertion inside `generate.ts` (fails loudly) |
| Packet self-check | No key text in any packet; WITH has no DDL, WITHOUT has no tool docs | assertion inside `build-packets.ts` |
| Gate | `tsc --noEmit` (now covers `benchmark`) + `eslint .` (lints `benchmark/**`) + `npm test` green with zero benchmark artifacts | local `closeout` gate (no CI) |
| Run + verify | Orchestrator run produces `runs/<id>/…`; verify checks harness present, limitations present ALONGSIDE results, `promptSha256` corroborates no-leak | verify phase |

## Migration / Rollout

Fully additive, outside `src/`/`dist/`. Rollback = delete `benchmark/`, `test/benchmark/`,
`docs/benchmarks.md`, the new `openspec/specs/benchmark/spec.md`, revert the US-035 story note and the
one-line `tsconfig` include. No runtime dep added; `npm test` returns to prior green; product/CLI/MCP
untouched. The published package is unaffected at every step (D2).

## Open Questions (for the tasks phase)

- [ ] `--per-family` DEFAULT: confirm `2` (~10–12 total) vs the proposal's 5–10 floor. Whatever is chosen
      is printed in `questions.yaml` + `docs/benchmarks.md`; small N stays a stated limitation.
- [ ] `node --experimental-strip-types` (D3) requires Node >= 22.6 to RUN the harness (engines say `>=22`).
      Confirm acceptable for the dev/orchestrator run, or pin a `>=22.6` note in `docs/benchmarks.md`.
      (Does not affect `npm test` — vitest transforms `.ts` itself.)
- [ ] Confirm `eslint .` passes cleanly on `benchmark/**` under the existing flat config, or add a scoped
      `files: ['benchmark/**/*.ts']` block (Node globals are typed via `@types/node`, so likely no `no-undef`).
- [ ] `impact` family DDL snippets: fix a small committed set of `ALTER/DROP` snippets under
      `benchmark/impact-snippets/`, or generate them from column nodes? Generation keeps it mechanical (D5);
      tasks decides the snippet source + naming (drives the `qid` sort key).
- [ ] Whether to include timing/events assertions in `trigger-inventory` scoring or keep it qname-set only
      (stricter = more discriminating, but raises the answer-format burden on both conditions equally).
- [ ] Secondary mssql run: confirm `docs/benchmarks.md` redaction rule (generalized names vs `<redacted>`)
      before any private object name could be written.
```
