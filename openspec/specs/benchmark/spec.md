# Benchmark Specification

## Purpose

The reproducible WITH/WITHOUT-dbgraph evaluation **methodology** as a durable, honesty-first
contract. It fixes the one testable README claim — that an AI agent answering database-schema
questions WITH dbgraph graph context (`query` / `explore` / `affected` / `status`) is more accurate
and/or spends fewer context tokens than the SAME agent WITHOUT it (a raw DDL dump) — and defines the
apparatus that produces an OWN, honest number for it (US-035). It covers: a mechanically-derived
question set with machine-checkable ground truth; two condition protocols that differ ONLY in schema
access under one fixed token-accounting boundary; a deterministic, blind, unit-tested scorer; and the
`docs/benchmarks.md` reporting contract whose limitations travel WITH the numbers.

This capability defines METHODOLOGY, not product behavior — it changes NOTHING in `src/**` or `dist/`.
Its load-bearing purpose is anti-overclaiming: it must make an inflated or selectively-reported result
a SPEC VIOLATION, not a stylistic choice.

> **HONESTY IS THE CONTRACT.** A self-run benchmark that overstates its meaning is WORSE than no
> benchmark. Every requirement below is enforceable: a report that omits a required section, buries or
> drops the limitations, suppresses a result unfavorable to dbgraph, extrapolates beyond the measured
> conditions, or presents the non-reproducible secondary run as reproducible is NON-CONFORMANT to this
> spec — a benchmark VIOLATION, regardless of how favorable its headline number is.

## Requirements

### Requirement: Reproducible-first, dual substrate with the fixture load-bearing

The benchmark SHALL run on a PRIMARY substrate that anyone can rebuild from committed source: the
SQLite torture fixture `test/fixtures/sqlite/torture.sql` (54 objects — tables, composite FK, WITHOUT
ROWID, views, 6 triggers, partial/expression indexes). BETWEEN the primary and the secondary, a MIDDLE
"reproducible-with-Docker" tier MAY be used: the mssql torture fixture, rebuildable by anyone WITH Docker
from committed source (`test/fixtures/mssql/torture.sql` plus the container harness
`test/fixtures/mssql/container.ts`). A Docker-tier run IS reproducible — unlike the private secondary —
but is GATED on Docker availability; when Docker is UNAVAILABLE the run MUST SKIP honestly and MUST NEVER
be fabricated. The real mssql graph at `C:\temp\dbgraph-validation` MAY be used as a SECONDARY substrate
ONLY as labeled corroboration, and ONLY if `dbgraph status` confirms it opens at run time. The deliverable
MUST NOT depend on the private graph OR on Docker: a valid, complete benchmark MUST be producible from the
committed SQLite fixture alone.

#### Scenario: Primary substrate is rebuildable from committed source

- GIVEN only the committed repository (no private database)
- WHEN a third party rebuilds the graph from `test/fixtures/sqlite/torture.sql` and follows `docs/benchmarks.md`
- THEN the full WITH/WITHOUT protocol runs and scores end-to-end with NO private DB required

#### Scenario: Secondary substrate is optional corroboration only

- GIVEN the real mssql graph at `C:\temp\dbgraph-validation`
- WHEN it is absent or `dbgraph status` reports it does not open
- THEN the benchmark still completes on the fixture alone, and the report's secondary section states the real-graph run was SKIPPED rather than failing the benchmark

#### Scenario: Docker tier is rebuildable from the committed mssql fixture (v2 positive)

- GIVEN a machine WITH Docker and the committed repository (no private database)
- WHEN a third party builds the mssql torture graph from `test/fixtures/mssql/torture.sql` via `test/fixtures/mssql/container.ts` and follows `docs/benchmarks.md`
- THEN the v2 WITH/WITHOUT planning protocol runs and scores end-to-end on the Docker tier with NO private DB required

#### Scenario: Docker unavailable — the v2 run SKIPS honestly (v2 negative)

- GIVEN a machine WITHOUT Docker
- WHEN the v2 Docker-tier run is attempted
- THEN it SKIPS honestly and the report states the Docker-tier run was SKIPPED — the numbers are NEVER fabricated, and the primary SQLite benchmark still completes on its own

### Requirement: Question set is mechanically derived and carries machine-checkable ground truth

The question set `benchmark/questions.yaml` SHALL contain a FIXED N of 5–10 questions across the three
US-035 families (a PLANNING substrate set MAY pre-register a FIXED N of 3–10 — the bound's INTENT is
anti-cherry-picking, so EVERY committed question in a pre-registered set MUST be run and reported in its
labeled run, none dropped), each DERIVED from the graph/DDL by a documented, re-runnable rule — NOT
hand-invented.
The pinned derivation rule per family MUST be: (a) join-query / FK-path questions derived from the
graph's foreign-key EDGE table; (b) column-type questions derived from node FIELD payloads; (c)
rename-impact questions derived from the shipped `affected` command's output. Each question MUST carry a
machine-checkable ground truth held SEPARATELY from the question text, and NO question may embed its own
answer. The no-embed (no-answer-leak) check MUST treat a ground-truth key value as embedded in the
question text ONLY when it occurs as a STANDALONE token — an occurrence NOT flanked on EITHER side by an
alphanumeric-or-underscore character (`[a-z0-9_]`), the project's alphanumeric-adjacency convention
(deliberately NOT a `\b` regex, so answer tokens containing punctuation are compared as literal strings,
never as a pattern). A key value that appears ONLY as a substring of a larger identifier (e.g.
`departments` within the view name `active_departments`) is NOT a leak; a free-standing occurrence IS.
The question text MUST be pre-registered (fixed) BEFORE any run and served IDENTICALLY to both
conditions.

EXCEPTION — hand-planted planning keys (v2, amends derivation rule (c) at canonical spec.md:53): the v2
task-planning families (`plan-callers`, `plan-blindspots`, `plan-order`) are the ONE carve-out from
mechanical derivation. Their ground-truth keys MUST be HAND-PLANTED, HUMAN-AUDITED, and COMMITTED, and
each target MUST carry a `source_ddl_ref` (fixture file + line range) that cites the DDL fact justifying
it. These keys MUST NEVER be derived from the `affected` command or `getImpact` (or any other store
query) — precisely because the impact family's mechanical key IS dbgraph's own `affected` output, which
would let a WITH agent score by REPEATING the tool. For the plan-* families ONLY, `benchmark/generate.ts`
MUST READ the committed key file instead of querying the store. Every planted key value MUST be
GREPPABLE-AUDITABLE: it MUST be verifiable against the DDL text at its cited `source_ddl_ref`, and a key
whose cited span does NOT contain its fact is a SPEC VIOLATION. (The key-file location and format are the
design phase's call; this requirement pins only hand-planted, human-audited, greppable-auditable,
never-store-derived, and read-not-queried.)

#### Scenario: Each family's ground truth is derived by its pinned rule

- GIVEN each question in `benchmark/questions.yaml`
- WHEN its ground truth is regenerated by the documented derivation step
- THEN FK-path answers come from the edge table, column-type answers from node field payloads, and rename-impact answers from `affected` output — reproducing the committed key BYTE-for-BYTE

#### Scenario: N is fixed and pre-registered before any run

- GIVEN the committed `benchmark/questions.yaml` (or a planning substrate's committed set file)
- WHEN its question count is inspected
- THEN N is a fixed integer between 5 and 10 for lookup sets, or between 3 and 10 for a planning substrate set, committed BEFORE any transcript exists under `benchmark/runs/` for that set's labeled run
- AND every committed question in the set appears scored in that run's report (none dropped)

#### Scenario: No question embeds its own answer

- GIVEN each question's text and its separately-held ground-truth key
- WHEN the harness checks for overlap
- THEN NO ground-truth key value appears as a STANDALONE occurrence — one not flanked by `[a-z0-9_]` — in the question text or in either condition's prompt

#### Scenario: A key value embedded inside a larger identifier is NOT a leak

- GIVEN the question `view-dependency-active_departments`, whose text names the view `active_departments`, and whose ground-truth dependency answer includes the token `departments`
- WHEN the no-answer-leak guard checks `departments` against the question text
- THEN it does NOT abort, because every occurrence of `departments` is flanked by `[a-z0-9_]` (the `_` in `active_departments`) and is therefore NOT a standalone leak — the previously-blocked N=6 generation now proceeds

#### Scenario: A real standalone answer occurrence still aborts (L-009 negative)

- GIVEN a question whose text contains its ground-truth answer token as a FREE-STANDING word (flanked by whitespace or punctuation, not by `[a-z0-9_]`)
- WHEN the no-answer-leak guard runs
- THEN it aborts LOUDLY, naming the qid — the guard is strictly MORE precise for identifier-embedded tokens while remaining fully sensitive to a genuine standalone leak

#### Scenario: A planted planning key is auditable against its cited DDL (v2 positive)

- GIVEN a committed plan-* key whose target carries a `source_ddl_ref` (fixture file + line range) — e.g. `plan-callers` target `usp_refresh_totals` citing `torture.sql:253-265`
- WHEN an auditor greps the cited DDL span for the planted fact
- THEN the fact is PRESENT at those lines, so the key PASSES audit; AND `generate.ts` read the key from the committed file, NOT from `affected`/`getImpact`

#### Scenario: A planted key whose source_ddl_ref lacks the fact FAILS audit (v2 negative)

- GIVEN a plan-* key target whose `source_ddl_ref` cites lines that do NOT contain the planted fact
- WHEN the grep audit runs over the cited span
- THEN the audit FAILS LOUDLY, naming the qid and target — an unverifiable hand-planted key is a SPEC VIOLATION, never a silent pass

#### Scenario: plan-* keys are never store-derived

- GIVEN the v2 planning families
- WHEN `generate.ts` produces their questions
- THEN it READS the committed key file for the plan-* families and NEVER calls `affected`/`getImpact` to build a plan-* key

### Requirement: Two condition protocols differ ONLY in schema access under one fixed token boundary

`benchmark/protocols/with.md` and `benchmark/protocols/without.md` SHALL specify identical model and
system framing, identical question text, and identical answer-format instructions; the ONLY permitted
difference is schema access. WITH MUST allow the agent to execute EXACTLY the documented dbgraph CLI
commands `query`, `explore`, `affected`, and `status` (each with `--json`) against the indexed graph.
WITHOUT MUST hand the agent the complete raw DDL/`.schema` dump produced from the SAME source of truth
as the graph (the realistic dump an agent gets today), NOT an impoverished strawman. A SINGLE token-
accounting boundary MUST be fixed and applied IDENTICALLY to both conditions: actual runtime usage when
the agent reports it; otherwise `characters / 4` over EVERY schema-bearing string entering the agent's
context — the WITHOUT dump up front and the WITH tool outputs on demand — LABELED as an approximation.

#### Scenario: WITH exposes exactly the four documented commands

- GIVEN the WITH protocol
- WHEN its permitted tool surface is inspected
- THEN it grants EXACTLY `query`, `explore`, `affected`, `status` (with `--json`) and NO other dbgraph or shell command

#### Scenario: WITHOUT dump is fair, from the same source of truth

- GIVEN the WITHOUT protocol
- WHEN the DDL dump is produced
- THEN it is generated from the SAME schema source that built the graph (the fixture's own DDL / `.schema`), complete and un-impoverished — no fields omitted to weaken the baseline

#### Scenario: Identical framing across conditions

- GIVEN both protocols
- WHEN question text, answer-format instructions, model, and system prompt are compared
- THEN they are IDENTICAL byte-for-byte; only the schema-access section differs

#### Scenario: One token boundary applied identically

- GIVEN a scored run
- WHEN token accounting is computed
- THEN the SAME rule (actual usage, else `chars/4`) is applied to all schema-bearing context in BOTH conditions, and any `chars/4` figure is LABELED as an approximation with its known imprecision

### Requirement: Scoring is deterministic, blind, unit-tested, and separates closed-form from rubric

The scorer under `benchmark/scorer/` SHALL score closed-form questions DETERMINISTICALLY against the
ground-truth key using PINNED rules: exact-match for scalar answers, unordered set-match for collection
answers, and valid-topological-order for ORDERING answers. The valid-topological-order rule scores an
ordering answer CORRECT if and only if the answer is a PERMUTATION of the FULL scoped object set (every
scoped object present exactly once, and no object outside the scope) AND it respects EVERY planted
must-precede pair `(a, b)` — i.e. `a` appears before `b` in the answer for every pair in the key. The
ground-truth key is a SET of must-precede PAIRS over an explicitly-scoped object set; there is NO single
canonical order. The comparator MUST be DETERMINISTIC: it returns the SAME verdict for any given answer,
independent of which valid linearization the key's pairs would themselves admit. The v2 `plan-callers`
and `plan-blindspots` families use the EXISTING unordered set-match rule (each `callers[]` / `blind_spots[]`
is a SET of routine names over an explicitly-scoped list served IDENTICALLY to both conditions);
`plan-order` uses the new valid-topological-order rule. Open-ended "explain" questions MUST be EITHER
excluded from the accuracy figure OR scored by a pinned rubric whose result is reported SEPARATELY and
flagged NON-deterministic, with the subjectivity limitation recorded. Correctness scoring MUST be BLIND:
the scorer receives answers keyed only by an opaque run identifier and NEVER the WITH/WITHOUT label. The
scorer MUST have vitest unit tests under `test/benchmark/` that run inside `npm test`; the
valid-topological-order comparator MUST carry its OWN unit matrix pinning a valid order A, a second valid
order B, a pair violation, a missing scoped object, and an extra out-of-scope object.

#### Scenario: Closed-form questions scored by pinned exact/set-match

- GIVEN a closed-form question and a candidate answer
- WHEN the scorer runs
- THEN a scalar answer passes ONLY on exact match and a collection answer passes ONLY on unordered set-equality with the ground-truth key — with no partial credit and no fuzzy matching

#### Scenario: Scorer is blind to condition labels

- GIVEN candidate answers for both conditions
- WHEN they are handed to the correctness scorer
- THEN each is keyed by an opaque run identifier and the scorer produces per-question pass/fail WITHOUT receiving or inferring the WITH/WITHOUT label

#### Scenario: Rubric items flagged non-deterministic and reported apart

- GIVEN an open-ended "explain" question
- WHEN it is scored
- THEN it is EITHER excluded from the headline accuracy figure OR rubric-scored, and any rubric score is reported in a SEPARATE section flagged non-deterministic/subjective

#### Scenario: Scorer unit tests pass inside npm test

- GIVEN the scorer's vitest unit tests under `test/benchmark/`
- WHEN `npm test` runs
- THEN the scorer tests execute and pass as part of the suite

#### Scenario: A valid linearization scores correct (topo positive A)

- GIVEN a `plan-order` key of must-precede pairs over a scoped set — e.g. `order_items→orders`, `order_items→products`, `products→regions` (all planted from `torture.sql:53-79`)
- WHEN a candidate answer lists every scoped object exactly once in an order that respects all pairs
- THEN the topological-order comparator scores it CORRECT

#### Scenario: A different valid linearization also scores correct (topo positive B)

- GIVEN the SAME `plan-order` key
- WHEN a DIFFERENT candidate answer — a distinct permutation of the full scoped set that still respects every planted pair — is scored
- THEN the comparator scores it CORRECT as well; there is NO single canonical order and both valid orders receive the SAME verdict

#### Scenario: An answer violating one planted pair scores wrong (topo negative — violation)

- GIVEN a `plan-order` key containing the pair `products→regions`
- WHEN a candidate answer places `regions` BEFORE `products`
- THEN the comparator scores it WRONG, because it violates a planted must-precede pair

#### Scenario: An answer missing a scoped object scores wrong (topo negative — missing)

- GIVEN a `plan-order` key whose scoped set has M objects
- WHEN a candidate answer omits one scoped object (fewer than M, or a scoped object absent)
- THEN the comparator scores it WRONG — a valid answer MUST be a permutation of the FULL scoped set

#### Scenario: An answer with an extra out-of-scope object scores wrong (topo negative — extra)

- GIVEN a `plan-order` key over an explicitly-scoped set
- WHEN a candidate answer includes an object NOT in the scope (or a duplicate)
- THEN the comparator scores it WRONG — no object outside the scoped set is permitted

### Requirement: The report carries all limitations alongside results and forbids extrapolation

`docs/benchmarks.md` SHALL contain, in this order, the REQUIRED sections: **Methodology**,
**Environment** (model family/version, date, dbgraph version, Node version, substrate), **N**,
**Results** (tables INCLUDING per-question outcomes and per-condition token totals), **Token
accounting** (method + boundary), **Limitations**, and **Reproduce it yourself** (step-by-step). The
**Limitations** section MUST enumerate, alongside the results and not buried, AT LEAST: self-run
(author designs, runs AND scores), single model family (Claude), small N (5–10), single/dual schema,
not peer-reviewed, non-reproducible secondary run, and the integrated-auth read-only downgrade. WHENEVER
v2 task-planning results are reported, the Limitations section MUST ADDITIONALLY enumerate, alongside
those results: (1) plan-QUALITY-unscored — only statically-decidable sub-facts are scored, never plan
prose quality; (2) format-prompting bias — the `blind_spots[]` scope list is served IDENTICALLY to both
conditions but still shapes the answer format; (3) hand-planted-key judgment risk — mitigated by the
`source_ddl_ref` DDL audit; (4) statically-decidable radius only — no dynamic-SQL resolution beyond
planted facts; and (5) Docker-tier reproducibility — v2 is reproducible only where Docker is available.
Results MUST be reported EVEN IF unfavorable to dbgraph. The secondary real-graph section MUST be labeled
NON-reproducible, and its read-only guarantee stated as read-only BY CONSTRUCTION of the tool (catalog
`SELECT`s only) — NOT enforced by a restricted grant, since the validation config uses integrated
(SSPI) auth; the SSMS-accuracy contrast MUST be labeled an author attestation. The report MUST NOT
extrapolate beyond the measured conditions: forbidden phrasings include "X% better in general", "more
accurate" unqualified, and any generalized superiority claim; every result MUST be framed as "on this
fixture, this question set, this model".

#### Scenario: All required sections present in order

- GIVEN a published `docs/benchmarks.md`
- WHEN its headings are inspected
- THEN Methodology, Environment, N, Results, Token accounting, Limitations, and Reproduce-it-yourself are ALL present; a missing section makes the report a SPEC VIOLATION

#### Scenario: Limitations enumerated alongside results

- GIVEN the report
- WHEN the Limitations section is read
- THEN it lists AT LEAST self-run, single-model-family, small-N, single/dual-schema, not-peer-reviewed, non-reproducible-secondary-run, and integrated-auth-read-only-downgrade — and appears together with the Results, not appended out of sight

#### Scenario: Unfavorable results are reported, not suppressed

- GIVEN a run in which dbgraph scores worse (or no better) on some or all questions
- WHEN the report is written
- THEN those per-question outcomes are reported faithfully; omitting or softening an unfavorable result is a SPEC VIOLATION

#### Scenario: No extrapolation beyond measured conditions

- GIVEN the report's results prose
- WHEN it is scanned for claims
- THEN it contains NO "X% better in general", NO unqualified "more accurate", and NO generalized superiority claim; every result is scoped to "on this fixture, this question set, this model"

#### Scenario: Secondary run labeled non-reproducible with honest read-only downgrade

- GIVEN the real-graph corroboration section
- WHEN it is read
- THEN it is labeled NON-reproducible, states read-only BY CONSTRUCTION (not a restricted grant, because auth is integrated/SSPI), and labels the SSMS contrast as an author attestation

#### Scenario: A v2 report carries the five task-planning limitations (v2 positive)

- GIVEN a published report that includes v2 task-planning results
- WHEN its Limitations section is read
- THEN it enumerates, alongside the results, ALL five v2 limitations (plan-quality-unscored, format-prompting bias, hand-planted-key judgment risk, statically-decidable radius, Docker-tier reproducibility) IN ADDITION to the standing self-run / single-model / small-N set

#### Scenario: Omitting a v2 limitation is a violation (v2 negative)

- GIVEN a v2 report whose Limitations section drops or buries ANY of the five v2 limitations
- WHEN the report is checked against this spec
- THEN it is NON-CONFORMANT — a SPEC VIOLATION — regardless of how favorable its headline v2 number is

### Requirement: npm test is independent of any benchmark run

`npm test` SHALL be GREEN with NO benchmark artifacts present — no `benchmark/runs/` transcripts and no
filled-in results. The benchmark run is an ORCHESTRATOR step executed between apply and verify, NOT a
vitest suite. Only the scorer's own unit tests execute inside `npm test`; running the suite MUST NOT
trigger, require, or depend on a WITH/WITHOUT execution.

#### Scenario: Suite green with no run artifacts

- GIVEN a clean checkout with `benchmark/runs/` empty or absent and `docs/benchmarks.md` results unfilled
- WHEN `npm test` runs
- THEN the suite is green, including the scorer unit tests

#### Scenario: No vitest suite triggers a benchmark run

- GIVEN the test suite definitions
- WHEN they are inspected
- THEN NO vitest test invokes the WITH/WITHOUT protocol, spawns an agent run, or reads `benchmark/runs/` transcripts

### Requirement: Multiple runs are reported as code-version-labeled tables on the frozen protocol

`docs/benchmarks.md` MAY carry MORE THAN ONE results table. Each table MUST be LABELED with the exact
dbgraph code version / run-id it was produced under (e.g. `torture-2026-07-06`,
`explore-payloads-2026-MM-DD`) and, for v2 and later, its SUBSTRATE label (e.g. `substrate: mssql-torture`)
so runs are never conflated and no reader mistakes one run's numbers for another's. A RE-RUN of an
EXISTING frozen labeled set MUST use that set's FROZEN methodology UNCHANGED: the SAME pre-registered
question set and separately-held ground-truth key, the SAME deterministic blind scorer, the SAME single
token-accounting boundary, and the SAME WITH tool surface of EXACTLY the four commands `query`, `explore`,
`affected`, `status` (each with `--json`); a re-run MUST NOT add, remove, or alter any command, question,
or scoring rule of that set. A NEW labeled run on a DIFFERENT SUBSTRATE (e.g. v2 on `mssql-torture` with
the plan-* families) is its OWN pre-registered set with its OWN frozen methodology and MAY register
additional question families and the additively-extended scorer, but it MUST NOT add, remove, or alter
any command, question, key, scoring rule, file, or table of ANY EXISTING frozen run. The v2 substrate
label MUST thread from the pre-registered set file through the packets manifest, aggregate, and render, so
every v2 output CARRIES its substrate label. The FROZEN SQLite runs (Runs 1–3) MUST remain BYTE-frozen —
their question set, keys, run files, and results tables UNTOUCHED — and labeled with their N. Results MUST
be reported HONESTLY per the standing contract: whatever the numbers show — INCLUDING no improvement or a
REGRESSION versus a prior run — is reported, scoped to "on this fixture, this question set, this model",
with NO suppression and NO extrapolation.

#### Scenario: A second results table is labeled with its code version

- GIVEN a re-run of the frozen harness after the explore-payloads change
- WHEN `docs/benchmarks.md` is updated
- THEN it gains a SECOND results table LABELED with its code version / run-id, leaving the first table intact
- AND both tables carry per-question outcomes and per-condition token totals

#### Scenario: The re-run's WITH surface is the unchanged four commands

- GIVEN the explore-payloads re-run's WITH condition
- WHEN its permitted tool surface is inspected
- THEN it grants EXACTLY `query`, `explore`, `affected`, `status` (with `--json`) — byte-identical to the first run's protocol, with no command added, removed, or altered

#### Scenario: An unfavorable second run is reported, not suppressed

- GIVEN a re-run in which dbgraph scores no better, or worse, than the first run
- WHEN the report is written
- THEN the second table reports those per-question outcomes faithfully, scoped to this fixture/question-set/model, with no extrapolation
- AND omitting or softening the unfavorable result is a SPEC VIOLATION

#### Scenario: v2 lands as its own substrate-labeled table (v2 positive)

- GIVEN the v2 task-planning run on the mssql torture fixture
- WHEN `docs/benchmarks.md` is updated
- THEN it gains a NEW results table LABELED with its code version/run-id AND a `substrate: mssql-torture` label, distinct from and leaving intact the frozen SQLite tables
- AND the new table carries per-question outcomes and per-condition token totals

#### Scenario: Frozen SQLite runs are byte-identical after v2 lands (HARD guard)

- GIVEN the frozen SQLite Runs 1–3 files and results tables as they stand before v2
- WHEN v2 is added
- THEN the SQLite question set, ground-truth keys, run files, and results tables are BYTE-IDENTICAL to their pre-v2 state — v2 is purely additive on a separate substrate

#### Scenario: v2 adds families and a scorer rule without altering any frozen run

- GIVEN v2 registers `plan-callers` / `plan-blindspots` / `plan-order` and the valid-topological-order rule
- WHEN the change lands
- THEN no command, question, key, or scoring rule of ANY existing frozen SQLite run is added to, removed from, or altered — the extension applies ONLY to the new substrate-labeled set

### Requirement: view-dependency family is instantiable; the N-change is deferred to its own run

Once SQLite view bodies emit `depends_on` edges, the `view-dependency` question family enumerated in
`benchmark/generate.ts` (from `getEdgesFrom(view, ['depends_on','reads_from'])`) SHALL yield candidates
on the SQLite substrate where it previously yielded ZERO. This change SHALL NOT bump N, regenerate or
re-freeze the committed `benchmark/questions.yaml`, add a `benchmark/runs/` transcript, or re-derive any
mechanical ground-truth key. Any N change (5→6) and any re-run against the NEW `affected`-derived
mechanical key MUST land as its OWN labeled run under the frozen methodology; Runs 1 and 2 (N=5) MUST
remain frozen and labeled with their N. Stale `supportsDependencyHints`-blindness comments in
`benchmark/generate.ts` and `benchmark/questions.yaml` SHALL be corrected to state that dependency edges
are body-derived (the flag denotes cheap catalog hints, which SQLite lacks).

#### Scenario: Enumerator now yields view-dependency candidates on SQLite

- GIVEN the SQLite substrate built from `test/fixtures/sqlite/torture.sql` after this change
- WHEN `benchmark/generate.ts` enumerates the `view-dependency` family via `getEdgesFrom(view, ['depends_on','reads_from'])`
- THEN it yields at least one candidate (the family is instantiable) where it previously yielded ZERO

#### Scenario: N and the committed question set are unchanged; prior runs stay frozen

- GIVEN the committed `benchmark/questions.yaml` and the existing Run 1 / Run 2 tables (N=5)
- WHEN this change lands
- THEN N is NOT bumped, no question is added/removed/altered, no new run is recorded, and the Run 1 / Run 2 tables remain frozen and labeled with N=5

#### Scenario: Stale blindness comments corrected

- GIVEN the `supportsDependencyHints`-blindness comments in `benchmark/generate.ts` and `benchmark/questions.yaml`
- WHEN they are inspected after this change
- THEN they state that SQLite dependency edges are body-derived and NO LONGER assert that SQLite views/triggers carry no dependency edges

### Requirement: WITHOUT-dump coverage is machine-asserted at build time

`benchmark/build-packets.ts` MUST, BEFORE writing any packet, derive each question's target object
identifiers from its family-typed ground truth and ASSERT each identifier appears in the generated
WITHOUT DDL dump. A miss MUST abort with exit code 1. This turns the existing "WITHOUT dump is fair,
from the same source of truth" scenario into a build-time MACHINE guarantee rather than a prose
expectation. Coverage matching for FK-path, trigger-inventory, column-type, constraint-semantics, and
view-dependency targets MUST be KIND-AWARE (`kind:name`). Coverage matching for IMPACT-derived targets AND
for the v2 PLANNING-derived targets (`plan-callers`, `plan-blindspots`, `plan-order`) MUST be KIND-AGNOSTIC
(by NAME only): because the `affected` command's `whatToTest` and the plan-* targets may name objects of
ANY kind — tables, views, triggers, procedures, OR functions — the assertion's PURPOSE (catch a dump from
the WRONG database) requires only that the NAMED object be DEFINED in the dump, not that its declared kind
match. A schema
object name is unique within its schema, so a name-only match cannot yield a FALSE pass on the correct
substrate; a name genuinely ABSENT from a wrong-DB dump still MISSES and aborts. The failure output MUST
name the missing OBJECT and the qid, and MUST NOT contain any ground-truth key VALUE — a bare schema
OBJECT identifier is safe (it already appears un-redacted in the dump), whereas a COMPOSED answer value
(e.g. a full FK path) is NOT.

#### Scenario: Correct dump covers every target — build succeeds

- GIVEN a WITHOUT DDL dump generated from the SAME source of truth that built the graph
- WHEN `build-packets.ts` runs the coverage assertion for every question
- THEN every derived target identifier is found in the dump, and packets are written with exit 0

#### Scenario: Wrong-DB dump missing a target — LOUD exit 1

- GIVEN a WITHOUT dump (e.g. from the wrong database) that omits a question's target object
- WHEN `build-packets.ts` runs the coverage assertion
- THEN it aborts with exit code 1, naming the missing OBJECT identifier and the offending qid

#### Scenario: Targets derived per family by pinned rule

- GIVEN each question's family-typed ground truth and its qid
- WHEN target identifiers are derived
- THEN they come from these fields ONLY:

| Family | Target identifier source | Match mode |
|--------|--------------------------|------------|
| fk-path | ground-truth `fromTable` and `toTable` | kind-aware (`kind:name`) |
| trigger-inventory | ground-truth `triggerQname` | kind-aware (`kind:name`) |
| impact | ground-truth `whatToTest` | KIND-AGNOSTIC (name only) |
| column-type / constraint-semantics | the table encoded in the `qid` | kind-aware (`kind:name`) |
| view-dependency | the view encoded in the `qid` | kind-aware (`kind:name`) |
| plan-callers | ground-truth `callers[]` routine names | KIND-AGNOSTIC (name only) |
| plan-blindspots | ground-truth `blind_spots[]` routine names over the scoped list | KIND-AGNOSTIC (name only) |
| plan-order | the scoped object set of the precedence pairs | KIND-AGNOSTIC (name only) |

#### Scenario: Impact whatToTest naming views/triggers is covered by the correct dump

- GIVEN an impact question whose ground-truth `whatToTest` names triggers and/or views (e.g. `impact-audit_log` → five triggers), and a WITHOUT dump generated from the SAME source of truth in which those objects appear as `CREATE TRIGGER` / `CREATE VIEW`
- WHEN `build-packets.ts` runs the coverage assertion
- THEN every impact-derived target is found by NAME regardless of its declared kind, the coverage check returns empty, and packets are written with exit 0

#### Scenario: Impact target name genuinely absent still aborts (L-009 negative)

- GIVEN an impact question whose `whatToTest` names an object ABSENT from a wrong-DB WITHOUT dump under EVERY kind
- WHEN the coverage assertion runs
- THEN it still aborts with exit code 1, naming the missing object and the qid — the kind-agnostic match is strictly MORE precise for view/trigger targets, never blind to a genuine miss

#### Scenario: Failure output leaks no key VALUE

- GIVEN a coverage miss for a family whose ground-truth key is a COMPOSED value (e.g. an FK path)
- WHEN the failure message is emitted
- THEN it contains ONLY the bare missing schema OBJECT identifier and the qid — NEVER the composed key value or the full ground-truth answer

#### Scenario: Correct Docker dump covers every plan-* target (v2 positive)

- GIVEN a WITHOUT DDL dump generated from the SAME mssql torture source that built the v2 graph
- WHEN `build-packets.ts` runs the coverage assertion for the plan-* questions (e.g. `plan-callers` targeting `usp_refresh_totals`, `plan-order` targeting `order_items`/`orders`/`products`/`regions`)
- THEN every plan-derived routine/object name is found by NAME regardless of kind, the coverage check returns empty, and packets are written with exit 0

#### Scenario: A plan-* target name absent from a wrong-DB dump aborts (v2 L-009 negative)

- GIVEN a plan-* question whose target routine/object is ABSENT from a wrong-DB WITHOUT dump under EVERY kind
- WHEN the coverage assertion runs
- THEN it aborts with exit code 1, naming the missing object and the qid — kind-agnostic matching for plan-* stays fully sensitive to a genuine miss

### Requirement: No-leak audit trail is self-contained in scored artifacts

`benchmark/score.ts` MUST join `packets/manifest.json` at scoring time and STAMP the authoritative
`promptSha256` per `(qid, condition)` into `scored/per-question.json`, so the no-leak audit trail is
self-contained in the scored artifacts and needs NO separate-file cross-reference. A raw run record
whose NON-EMPTY `promptSha256` MISMATCHES the manifest MUST fail scoring loudly (non-zero exit); an
EMPTY raw hash MUST be stamped from the manifest. HONESTY: the stamped field attests ONLY the FROZEN
PACKET content that the manifest hashes (the no-leak-checked packet) — it MUST NOT be represented as
proof of what the agent saw at RUNTIME. The stamp MUST be ADDITIVE.

#### Scenario: Scored output carries the manifest hash for both conditions

- GIVEN a completed run with raw records for the WITH and the WITHOUT conditions
- WHEN `score.ts` produces `scored/per-question.json`
- THEN each `(qid, condition)` entry carries a `promptSha256` equal to the manifest's hash for that packet

#### Scenario: Non-empty mismatching hash fails loudly

- GIVEN a raw record whose `promptSha256` is non-empty but does NOT equal the manifest hash for its `(qid, condition)`
- WHEN `score.ts` runs
- THEN scoring FAILS loudly with a non-zero exit and emits no scored file for that run

#### Scenario: Empty raw hash is stamped from manifest with honest attestation

- GIVEN a raw record with an EMPTY `promptSha256`
- WHEN `score.ts` stamps `scored/per-question.json`
- THEN the field is populated from `manifest.json` AND is attested as the FROZEN PACKET hash — NOT as a claim about the runtime prompt the agent actually received

#### Scenario: Stamp is additive — valid-run outcomes byte-identical (HARD guard)

- GIVEN a valid run (all raw hashes empty or matching the manifest)
- WHEN scoring runs with this change versus the pre-change scorer
- THEN accuracy and token-total outcomes, and the frozen protocol, are BYTE-IDENTICAL; the `promptSha256` field is purely ADDITIVE
