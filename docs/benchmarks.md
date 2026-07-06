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
| Model id / version | {{MODEL_ID}} *(filled at run time)* |
| Run date | {{RUN_DATE}} *(filled at run time)* |
| Run id | {{RUN_ID}} *(filled at run time)* |
| dbgraph version | 0.0.0 (closeout) |
| Node | >= 22.6 required to RUN the harness (`node --experimental-strip-types`); the product engine contract stays `>=22`, and `npm test` is unaffected (vitest transforms `.ts` itself) |
| Primary substrate | SQLite torture fixture (`test/fixtures/sqlite/torture.sql`, committed) |
| Secondary substrate | mssql-private (OPTIONAL corroboration only; see Limitations) |

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

*[FILLED POST-RUN — the orchestrator run (Batch R) fills these placeholders faithfully, reporting
EVERY per-question outcome even where dbgraph is no-better or worse. No number is invented here.]*

| Family | WITH accuracy | WITHOUT accuracy | WITH schema-tokens | WITHOUT schema-tokens |
|--------|---------------|------------------|--------------------|-----------------------|
| fk-path | {{ }} | {{ }} | {{ }} | {{ }} |
| column-type (control) | {{ }} | {{ }} | {{ }} | {{ }} |
| impact | {{ }} | {{ }} | {{ }} | {{ }} |
| trigger-inventory | {{ }} | {{ }} | {{ }} | {{ }} |
| constraint-semantics | {{ }} | {{ }} | {{ }} | {{ }} |
| **Overall** | {{ }} | {{ }} | {{ }} | {{ }} |

Per-question appendix: {{ }}

Every figure above is scoped to *this fixture, this question set, this model*. Unfavorable
per-question outcomes (dbgraph no-better or worse) MUST be reported here, not softened or omitted —
suppression is a spec violation.

## Token accounting

One boundary, applied IDENTICALLY to both conditions:

- **ACTUAL** runtime-reported usage is preferred when the agent reports it.
- Otherwise `ceil(chars / 4)`, **LABELED an approximation** with known imprecision.
- The boundary counts ONLY schema-bearing text: **WITHOUT** = the DDL dump (counted once, up front);
  **WITH** = the concatenation of all dbgraph tool outputs the agent received during the question.
- The question text and system framing are byte-identical across conditions and are EXCLUDED (they
  cancel in the delta).

The `chars/4` figure is an approximation, never presented as an exact token count.

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
