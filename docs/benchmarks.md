# dbgraph benchmark — WITH vs WITHOUT graph context

> **HONESTY IS THE CONTRACT.** A self-run benchmark that overstates its meaning is WORSE than no
> benchmark. Every result below is scoped to *this fixture, this question set, this model*. Any
> section that omits the limitations, buries them, suppresses an unfavorable result, or extrapolates
> beyond the measured conditions is a SPEC VIOLATION — regardless of how favorable its headline
> number is (`openspec/specs/benchmark/spec.md`).

## The claim under test

An AI agent answering database-schema questions **WITH** dbgraph graph context (the read-only
`query` / `explore` / `affected` / `status` CLI) is more accurate and/or spends fewer schema-bearing
context tokens than the **SAME** agent **WITHOUT** it (given only a raw DDL dump) — measured on the
committed SQLite torture fixture, on this pre-registered question set, with a single model family.
No claim is made beyond those measured conditions.

## Methodology

- **Primary substrate:** the committed SQLite torture fixture `test/fixtures/sqlite/torture.sql`
  (54 objects — tables, a composite FK, a WITHOUT ROWID PK, views, 6 triggers incl. an INSTEAD OF
  trigger, partial/expression/unique indexes). Anyone can rebuild the graph from committed source.
- **Question set:** mechanically derived and pre-registered in `benchmark/questions.yaml` BEFORE any
  run, served IDENTICALLY to both conditions. Ground truth is held SEPARATELY under
  `benchmark/ground-truth/`; no question embeds its own answer. Each key carries a `source_ddl_ref`
  pointer into `torture.sql` so a reviewer can audit key-vs-DDL.
- **Conditions (differ ONLY in schema access):**
  - **WITH** — a working dir with the indexed graph + read-only dbgraph CLI, limited to EXACTLY
    `query`, `explore`, `affected`, `status`; forbidden from reading any `.sql`/DDL file directly
    (`benchmark/protocols/with.md`).
  - **WITHOUT** — the complete comment-free `sqlite_master` catalog DDL dump (the realistic
    `.schema`-equivalent a developer inheriting the database gets), no tools
    (`benchmark/protocols/without.md`).
  - The model, system framing, question text, and answer-format instructions are IDENTICAL
    byte-for-byte across the pair; only the schema-access section differs.
- **Answer format:** each reply ends with a single `ANSWER: <value>` line in a per-family canonical
  shape; a deterministic comparator per family scores it, BLIND to the WITH/WITHOUT label.
- **Scoring:** closed-form only — exact match for scalars, unordered set-match for collections
  (PK column order is order-sensitive). No free-text/rubric family exists, so the headline accuracy
  is 100% closed-form. The scorer has vitest unit tests that run inside `npm test`.

## Environment

| Field | Value |
|-------|-------|
| Model family | Claude (single family — no cross-model claim) |
| Model id / version | claude-fable-5 (all 10 condition agents; orchestrated sub-agents, fresh context each) |
| Run date | 2026-07-06 |
| Run id | torture-2026-07-06 |
| dbgraph version | 0.0.0 (closeout) |
| Node | >= 22.6 required to RUN the harness (`node --experimental-strip-types`); the product engine contract stays `>=22`, and `npm test` is unaffected (vitest transforms `.ts` itself) |
| Primary substrate | SQLite torture fixture (`test/fixtures/sqlite/torture.sql`, committed) |
| Secondary substrate | mssql-private — **NOT RUN** in torture-2026-07-06 (optional per spec; the primary run's finding is CLI-surface-level and engine-agnostic, so a secondary would not alter it; see Run notes) |

## N

**N = 5**, pre-registered and fixed BEFORE any transcript exists under `benchmark/runs/`
(`--per-family 1`). Six closed-form families are DEFINED — `fk-path`, `column-type` (negative
control), `impact`, `trigger-inventory`, `view-dependency`, `constraint-semantics` — and **five are
instantiable on the SQLite substrate.** `view-dependency` yields NO candidates here because the
SQLite schema adapter declares dependency blindness (`supportsDependencyHints=false`, US-007), so
views carry no `depends_on`/`reads_from` edges; the family enumerator is present and correct but
produces nothing on this substrate, and it is recorded as EXCLUDED in `questions.yaml`. It may fire
on the mssql secondary substrate. N stays within the pre-registered 5–10 bound, hard-asserted by
`generate.ts`.

## Results

Run `torture-2026-07-06` (scored blind by `benchmark/score.ts`; table produced by `render.ts`):

| Family | WITH accuracy | WITHOUT accuracy | WITH tokens (actual) | WITHOUT tokens (actual) |
|--------|---------------|------------------|----------------------|-------------------------|
| fk-path | 0% (0/1) | 100% (1/1) | 36467 | 26693 |
| column-type (control) | 0% (0/1) | 100% (1/1) | 102282 | 26686 |
| impact | 100% (1/1) | 0% (0/1) | 41660 | 26694 |
| trigger-inventory | 100% (1/1) | 100% (1/1) | 30273 | 26704 |
| constraint-semantics | 0% (0/1) | 100% (1/1) | 82643 | 26665 |
| **Overall** | **40% (2/5)** | **80% (4/5)** | 293325 | 133442 |

**On this fixture, this question set, this model, the WITH condition LOST — 40% vs 80% — while
spending 2.2× the tokens.** That unfavorable result is reported unsoftened, per the standing
contract below, and it is the most useful outcome this benchmark could have produced (see Run
notes).

Per-question appendix (key from `benchmark/ground-truth/`; raw records in
`benchmark/runs/torture-2026-07-06/raw/`, git-ignored):

| qid | key | WITH answer | WITHOUT answer |
|-----|-----|-------------|----------------|
| column-type-assignments.dept_id | `INTEGER\|NOT NULL` | `INTEGER\|NULL` ✗ (nullability GUESSED — not retrievable via CLI) | `INTEGER\|NOT NULL` ✓ |
| constraint-semantics-assignments | `project_id, emp_id, dept_id` | `emp_id, project_id` ✗ (PK membership not retrievable via CLI; 69 tool calls exhausted) | `project_id, emp_id, dept_id` ✓ |
| fk-path-assignments-employees | both atoms (`emp_id`, `dept_id`) | `assignments.emp_id=employees.emp_id` ✗ (FK column mapping not retrievable via CLI) | both atoms ✓ |
| impact-departments | `assignments, employees` (= `affected --json` whatToTest) | `assignments, employees` ✓ | `active_departments, employee_summary, employees, trg_active_dept_instead_insert` ✗ vs the mechanical key — see circularity note |
| trigger-inventory-active_departments | `trg_active_dept_instead_insert:INSTEAD OF:INSERT` | ✓ (inferred from trigger NAME + view semantics; timing/events not exposed as fields) | ✓ |

### Run notes (findings and incidents — part of the record)

1. **ROOT CAUSE of the WITH losses — a product gap, not a graph-data gap.** The graph STORES the
   exact facts (ground truth was mechanically derived from node payloads via the store API), but the
   CLI presentation layer never renders payloads: `explore --detail full` shows edges + `bodyHash` +
   `level` only — no column types/nullability, no PK/FK column membership — and `query`'s FTS indexes
   names only. Both failing WITH agents proved this exhaustively (every `--detail` value, `--json`
   flags, `affected` probes) and said so in their transcripts. The two WITH wins came from
   `affected --json`, the ONE command that returns structured facts. **Follow-up: render node
   payloads in `explore` (and/or give `query`/`explore` a `--json` payload view).** Until then, the
   graph's exactness is not reachable by an agent through the CLI.
2. **Circularity made concrete (impact family).** The mechanical key IS dbgraph's own
   `affected --json whatToTest`. On SQLite the adapter declares dependency blindness
   (`supportsDependencyHints=false`), so the key cannot contain view/trigger dependents; the WITHOUT
   agent listed the two views + the INSTEAD OF trigger (which genuinely break) and was scored ✗
   against that key. A human reviewer would judge that answer partially MORE complete than the key.
   This family measures agreement-with-the-tool, exactly as the circularity limitation warns.
   Follow-up: SQLite view-dependency extraction would improve both `affected` and this family.
3. **Run incident (protocol integrity).** The first WITHOUT round was INVALIDATED and re-run: the
   orchestrator invoked `build-packets.ts --db` with a POSIX-style path on Windows and the embedded
   DDL dump did not match the real database (source undetermined — MSYS path conversion is
   implicated; the same session saw two agents hit MSYS path-mangling on their first CLI calls).
   Detected by cross-checking WITH-agent tool outputs against the packet DDL; fixed by regenerating
   packets with a native Windows path and verifying the dump against the live database
   (`full_name` present, etc.). Round-1 WITHOUT transcripts were discarded. The WITH round was
   unaffected (agents hit the real graph — verified by re-executing their commands). Harness
   hardening candidate: `build-packets` should assert the dump covers every question's target
   objects against `ground-truth` source refs.
4. **Smaller paper cuts observed by WITH agents:** `explore --detail` accepts ANY value silently
   (no validation); `explore` headers render views as `[table]`; per-command `--help` prints only
   the generic banner; `affected` matches only schema-qualified identifiers (bare `assignments`
   goes to `unmatchedIdentifiers`); `explore` rejects node ids that `query` returns.

Every figure above is scoped to *this fixture, this question set, this model*. Unfavorable
per-question outcomes (dbgraph no-better or worse) MUST be reported here, not softened or omitted —
suppression is a spec violation.

## Results — Run 2 (`explore-payloads-2026-07-06`)

> **SCAFFOLD — awaiting the re-run.** This SECOND results table is LABELED with its code version /
> run-id and is intentionally left with empty (`_pending_`) cells. The coordinating session FILLS it
> in Batch R, after building the graph from the SAME committed fixture and running the FROZEN harness;
> **no number here is invented ahead of the run.** The first `torture-2026-07-06` table above stays
> INTACT and is never overwritten — the two runs are never conflated.

The re-run uses the FROZEN methodology UNCHANGED: the SAME pre-registered question set and
separately-held ground-truth key, the SAME deterministic blind scorer, and the SAME single
token-accounting boundary. **The re-run's WITH surface grants EXACTLY `query`, `explore`, `affected`,
`status` (each with `--json`) — byte-identical to the first run's protocol, with NO command added,
removed, or altered.** Only the dbgraph code under test differs (the explore-payloads rendering
change); the fixture, questions, ground truth, model family, and scoring rules are identical.

### Environment (Run 2)

| Field | Value |
|-------|-------|
| Model family | Claude (single family — no cross-model claim) |
| Model id / version | claude-fable-5 (all 10 condition agents; orchestrated sub-agents, fresh context each — same as Run 1) |
| Run date | 2026-07-06 |
| Run id | `explore-payloads-2026-07-06` |
| dbgraph version / commit | 0.0.0 — explore-payloads feature commits `5b867f0`+`2f0cec1` (code under test built from `98bb169`) |
| Primary substrate | SQLite torture fixture (`test/fixtures/sqlite/torture.sql`, committed — UNCHANGED) |

### Results (Run 2 — `explore-payloads-2026-07-06`)

| Family | WITH accuracy | WITHOUT accuracy | WITH tokens (actual) | WITHOUT tokens (actual) |
|--------|---------------|------------------|----------------------|-------------------------|
| fk-path | 100% (1/1) | 100% (1/1) | 34607 | 26697 |
| column-type (control) | 100% (1/1) | 100% (1/1) | 29073 | 26688 |
| impact | 0% (0/1) | 0% (0/1) | 55885 | 26694 |
| trigger-inventory | 100% (1/1) | 100% (1/1) | 31178 | 26698 |
| constraint-semantics | 100% (1/1) | 100% (1/1) | 29630 | 26665 |
| **Overall** | **80% (4/5)** | **80% (4/5)** | 180373 | 133442 |

**Run 2 vs Run 1, same frozen protocol: WITH accuracy 40% → 80%; WITH tokens 293325 → 180373
(−38.5%); WITH tool calls 157 → 42 (−73%). WITH now TIES WITHOUT on accuracy on this fixture.**
Scoped to *this fixture, this question set, this model* — no generalized claim.

Per-question appendix (Run 2) — Batch R fills the answers AND the per-question DELTA versus
`torture-2026-07-06`; the `key` column is FROZEN (byte-identical to Run 1, never re-derived):

| qid | key | WITH answer | WITHOUT answer | Δ vs Run 1 |
|-----|-----|-------------|----------------|------------|
| column-type-assignments.dept_id | `INTEGER\|NOT NULL` | `INTEGER\|NOT NULL` ✓ (3 tool calls — read directly from the rendered column payload; Run 1: ✗ after 49 calls) | `INTEGER\|NOT NULL` ✓ | WITH ✗→✓ |
| constraint-semantics-assignments | `project_id, emp_id, dept_id` | ✓ (3 calls — `[PK] pk_assignments (project_id, emp_id, dept_id)` rendered verbatim; Run 1: ✗ after 69 calls) | ✓ | WITH ✗→✓ |
| fk-path-assignments-employees | both atoms (`emp_id`, `dept_id`) | ✓ (9 calls — `[FK] fk_assignments_0 (emp_id, dept_id → main.employees)` rendered via D8 reconstruction; Run 1: ✗) | ✓ | WITH ✗→✓ |
| impact-departments | `assignments, employees` | `active_departments, assignments, employees, trg_active_dept_instead_insert` ✗ vs the mechanical key — see note below | `active_departments, employee_summary, employees, trg_active_dept_instead_insert` ✗ (same class as Run 1) | WITH ✓→✗ (circularity artifact, see note) |
| trigger-inventory-active_departments | `trg_active_dept_instead_insert:INSTEAD OF:INSERT` | ✓ (7 calls — timing/events now rendered as `INSTEAD OF INSERT`; Run 1 inferred them from the trigger NAME) | ✓ | ✓→✓ (evidence quality improved) |

**Impact-family note (the circularity limitation, live in both directions).** The mechanical key IS
dbgraph's own view-blind `affected --json whatToTest` (SQLite `supportsDependencyHints=false`). In
Run 1 the WITH agent scored ✓ by REPEATING the tool's output; in Run 2, with the richer explore
surface (and FTS evidence that trigger bodies reference `dept_id`), the agent trusted its own
semantic analysis, named the view + trigger that genuinely break — and scored ✗ against the
circular key. Both conditions now converge on semantically defensible answers the key cannot
credit. This is not a regression of the tool; it is the strongest evidence yet that the impact
family measures agreement-with-the-tool, and that SQLite view-dependency extraction (the next
planned change) is what both `affected` and this family need.

**WITHOUT totals curiosity:** the Run 2 WITHOUT sum (133442) coincidentally equals Run 1's — the
five per-agent values differ slightly (±10 tokens each) but sum identically; the WITHOUT condition
is dominated by the fixed prompt+DDL size, so its cost is effectively constant across runs.

### Run 2 honesty framing (standing contract — binds before the numbers exist)

Whatever the re-run shows — **including no improvement or a REGRESSION versus
`torture-2026-07-06`** — MUST be reported here faithfully, scoped to *this fixture, this question set,
this model*, with NO suppression and NO extrapolation. Omitting or softening an unfavorable
per-question outcome is a SPEC VIOLATION. The explore-payloads change renders the node payloads the
graph ALREADY stored (column types/nullability, PK/FK column membership, trigger timing/events) that
Run 1 found unreachable through the CLI; this re-run measures ONLY whether that presentation change
moves the WITH outcomes on this frozen substrate — it licenses NO generalized superiority claim.

## Results — Run 3 (`dog-complete-2026-07-10`)

The THIRD run uses the FROZEN methodology UNCHANGED: the SAME pre-registered families and
separately-held ground-truth keys, the SAME deterministic blind scorer, and the SAME single
token-accounting boundary. The two tables above (`torture-2026-07-06`, `explore-payloads-2026-07-06`)
stay INTACT and are never overwritten; the three runs are never conflated. Only the dbgraph code under
test differs (post-v1) and — as a mechanical consequence of that code's new edges — the instantiable
question set derives differently (see note a).

### Environment (Run 3)

| Field | Value |
|-------|-------|
| Model family | Claude (single family — no cross-model claim) |
| Model id / version | claude-fable-5 (both conditions; fresh context per question — same as Runs 1–2) |
| Run date | 2026-07-10 |
| Run id | `dog-complete-2026-07-10` |
| dbgraph version / commit | post-v1 @ `73d3de2` (DOG-1..4 + SQLite view-deps + guard-precision all in) |
| Primary substrate | SQLite torture fixture (`test/fixtures/sqlite/torture.sql`, committed — UNCHANGED) |

### N (Run 3)

**N = 6** — for the FIRST time all six closed-form families are instantiable on the SQLite substrate.
`view-dependency` now fires: post-v1 SQLite view-dependency extraction (sqlite-view-deps) gives views
their `depends_on`/`reads_from` edges, so the family enumerator that yielded NO candidates in Runs 1–2
now produces one. N stays within the pre-registered 5–10 bound.

### Results (Run 3 — `dog-complete-2026-07-10`)

Scored blind by `benchmark/score.ts`; table produced by `render.ts`:

| Family | WITH accuracy | WITHOUT accuracy | WITH schema-tokens | WITHOUT schema-tokens |
|--------|---------------|------------------|--------------------|-----------------------|
| fk-path | 100% (1/1) | 100% (1/1) | 1381 | 787 |
| column-type | 100% (1/1) | 100% (1/1) | 237 | 787 |
| impact | 100% (1/1) | 100% (1/1) | 996 | 787 |
| trigger-inventory | 100% (1/1) | 100% (1/1) | 197 | 787 |
| view-dependency | 100% (1/1) | 100% (1/1) | 197 | 787 |
| constraint-semantics | 100% (1/1) | 100% (1/1) | 573 | 787 |
| **Overall** | 100% (6/6) | 100% (6/6) | 3581 | 4722 |

Schema-token delta (WITH − WITHOUT): -1141 (WITH 3581 vs WITHOUT 4722).

**Run 3, blind scorer: WITH 100% (6/6) / WITHOUT 100% (6/6) — a TIE on correctness on this fixture,
this question set, this model.** With correctness tied, the efficiency comparison is the story, and
the numbers are reported as they are: WITH spent 3581 approx schema-tokens versus WITHOUT's 4722
(delta −1141), across 21 WITH tool calls versus 0 WITHOUT. No generalized claim is made beyond these
measured conditions.

### Run 3 protocol notes (part of the record)

1. **Question-set derivation changed mechanically, not by choice (N=6).** `view-dependency` is
   instantiable for the FIRST time (post-v1 sqlite-view-deps extraction). The impact question CHANGED
   from `impact-departments` (Runs 1–2) to `impact-audit_log`: post-v1 trigger `writes_to` edges made
   `audit_log`'s impact set non-empty, and the family enumerator selects the lexicographic-first
   candidate among the non-empty set — `audit_log` sorts ahead of `departments`. This is a DERIVATION
   of the frozen selection rule over the new edge set, not a hand-picked substitution.
2. **Code version.** post-v1 @ `73d3de2` — DOG-1..4, SQLite view-dependency extraction, and
   guard-precision are all in.
3. **Impact-family circularity AMPLIFIED.** The mechanical key IS dbgraph's OWN `affected` output,
   which now includes the view/trigger edges added post-v1. The WITH agent produced its answer by
   using `affected` directly, so on this family WITH necessarily AGREES WITH THE TOOL. This is the
   standing shared-extraction circularity limitation, stated plainly: the impact family measures
   agreement-with-the-tool, now over a richer (view/trigger-aware) edge set.
4. **Token accounting (Run 3 mode).** Both conditions use `approx` mode this run (the runtime did not
   report actual usage): WITH = `ceil(chars/4)` over the concatenated tool stdout the agent received;
   WITHOUT = `ceil(chars/4)` over the packet DDL dump. Model claude-fable-5 on both conditions, fresh
   context per question. Because both sides are approx here (Runs 1–2 reported ACTUAL usage), Run 3's
   absolute token figures are NOT directly comparable to the Run 1/2 numbers — only the within-run
   WITH−WITHOUT delta is meaningful.
5. **Tool calls.** WITH total 21, distributed 3 / 3 / 8 / 3 / 2 / 2 across
   column-type / constraint-semantics / fk-path / impact / trigger-inventory / view-dependency.
   WITHOUT made 0 tool calls (single DDL packet, no tools).
6. **Paper cut observed.** `explore` requires `main.`-qualified object names; the WITH agents
   recovered by running `query` FIRST to obtain the qualified name, then `explore`.

## Token accounting

One boundary, applied IDENTICALLY to both conditions:

- **ACTUAL** runtime-reported usage is preferred when the agent reports it.
- Otherwise `ceil(chars / 4)`, **LABELED an approximation** with known imprecision.
- The boundary counts ONLY schema-bearing text: **WITHOUT** = the DDL dump (counted once, up front);
  **WITH** = the concatenation of all dbgraph tool outputs the agent received during the question.
- The question text and system framing are byte-identical across conditions and are EXCLUDED (they
  cancel in the delta).

The `chars/4` figure is an approximation, never presented as an exact token count.

**What Run 2 used (explore-payloads-2026-07-06):** the SAME actual-usage boundary as Run 1 (below),
identically applied — actual runtime token usage per condition agent, including the fixed per-agent
harness overhead (≈26.7k, identical on both sides; the WITHOUT agents measure it directly), so the
DELTA between conditions and BETWEEN RUNS is the meaningful quantity. Zero packet drift vs Run 1 was
verified before launching (byte-diff of all 10 regenerated packets).

**What Run 1 used (torture-2026-07-06):** the per-agent transcripts were not persisted by the
runtime, so the schema-bearing-only `chars/4` figure was NOT computable after the fact. The table
reports **ACTUAL runtime token usage per condition agent** (the spec-preferred boundary), applied
identically to both conditions. Caveat, stated plainly: this figure includes a fixed per-agent
harness overhead (system prompt + framing, ≈26.7k tokens, identical on both sides — the WITHOUT
agents, which used zero tools, measure it directly), so the DELTA between conditions — not the
absolute numbers — is the meaningful quantity. The WITHOUT DDL dump itself is ≈787 approx tokens
(from `benchmark/packets/manifest.json`).

## Limitations

*(Drafted NOW, alongside the Results — a result MUST NOT ship without these.)*

- **SELF-RUN.** The author designed, ran, AND scored this evaluation. It is not peer-reviewed.
- **SINGLE MODEL FAMILY** (Claude). No cross-model generalization is claimed.
- **SMALL N (5)** on a SINGLE primary schema (plus an optional single secondary). No significance
  testing, no p-values.
- **SHARED-EXTRACTION CIRCULARITY.** Ground truth is derived via dbgraph's OWN extraction path, so a
  systematic extraction bug would bias BOTH the key and the WITH answer the same way. Named, not
  hidden.
- **TOKEN APPROXIMATION.** When the runtime does not report actual usage, token counts use the
  `chars/4` approximation.
- **FREE-TEXT QUALITY IS NOT SCORED.** Only closed-form facts are scored; explanation quality is out
  of scope (no rubric family), recorded here as a limitation.
- **NON-REPRODUCIBLE SECONDARY RUN.** The optional real-DB (mssql) corroboration is on a private
  schema — its questions, ground truth, and object names CANNOT be committed and a third party cannot
  rebuild it. It is author-attested, not reproducible.
- **INTEGRATED-AUTH READ-ONLY DOWNGRADE.** For the secondary substrate, read-only is BY CONSTRUCTION
  of the tool (catalog `SELECT`s only) — NOT enforced by a restricted grant, because the validation
  config uses integrated (Windows SSPI) auth under the author's own principal. Any SSMS-accuracy
  contrast is an AUTHOR ATTESTATION, labeled as such, never a machine-verified figure.

### No extrapolation (standing contract)

- Every result is framed "on this fixture, this question set, this model." FORBIDDEN phrasings:
  "X% better in general", unqualified "more accurate", and any generalized superiority claim.
- The secondary real-graph section is labeled **NON-reproducible**, states read-only BY CONSTRUCTION
  (not a restricted grant, because auth is integrated/SSPI), and labels the SSMS contrast an author
  attestation.
- Results unfavorable to dbgraph MUST be reported, not suppressed.

## Reproduce it yourself

You need Node **>= 22.6** (for `node --experimental-strip-types`). `npm test` does NOT require this —
it is only for running the harness stages.

1. **Build the graph** from the committed fixture: materialize `test/fixtures/sqlite/torture.sql`
   into a SQLite database, then `dbgraph init --dialect sqlite --file <torture.db>` (and `sync`) to
   produce `.dbgraph/dbgraph.db` in an isolated working dir. Read-only throughout.
2. **Generate** the pre-registered questions + mechanical ground truth (regenerating reproduces the
   committed set byte-for-byte):
   `node --experimental-strip-types benchmark/generate.ts --project <graph-dir>`.
3. **Build packets** (one WITH + one WITHOUT per question; the WITHOUT DDL dump comes from the target
   database's `sqlite_master`):
   `node --experimental-strip-types benchmark/build-packets.ts --db <torture.db>`.
4. **Run** BOTH packets per question with your own agent — ONE question per invocation, fresh
   context. Save each transcript to `benchmark/runs/<run-id>/raw/<qid>.<condition>.json` with the
   parsed `ANSWER:` value and token counts.
5. **Score** (blind to condition) and render the table:
   `node --experimental-strip-types benchmark/score.ts benchmark/runs/<run-id>` →
   `scored/per-question.json` + `aggregate.json`; then
   `node --experimental-strip-types benchmark/render.ts benchmark/runs/<run-id>/aggregate.json`
   produces the Results table above.

`benchmark/packets/` and `benchmark/runs/` are git-ignored working artifacts; the pre-registered set
(`questions.yaml`, `ground-truth/`, `impact-snippets/`, `protocols/`) is committed and frozen.
