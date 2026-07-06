# WITHOUT condition protocol (raw DDL dump, no graph)

Human-readable contract for the **WITHOUT** condition of the dbgraph WITH/WITHOUT benchmark
(US-035, benchmark spec Req 3). This mirrors the pinned run template in `design.md §Run
protocol` verbatim in framing. The ONLY difference from the WITH condition is schema access —
model, system framing, question text, and answer-format instructions are IDENTICAL.

## System framing (IDENTICAL to WITH)

```
You are answering ONE database-schema question. Reason as needed, then end your reply with a single
final line in EXACTLY this form:
ANSWER: <value>
where <value> follows the answer-format spec given below. Output nothing after that line.
```

## User prompt

```
QUESTION: {{QUESTION}}
ANSWER FORMAT: {{ANSWER_FORMAT_SPEC}}

Here is the database schema (DDL dump). You have no other tools for inspecting the database:
{{DDL_DUMP}}
```

## Access rules

- The agent gets **NO** dbgraph tool access and **NO** graph directory — only the embedded DDL dump.
- The dump is the **fair, un-impoverished** catalog DDL a developer inheriting the database actually
  gets (D8): `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE
  'sqlite_%' ORDER BY type, name` — the comment-free `.schema`-equivalent, produced from the SAME
  source of truth that built the graph. NO fields are omitted to weaken the baseline.
- The dump is the **comment-free catalog** DDL, NOT the annotated `test/fixtures/sqlite/torture.sql`
  (whose pedagogical comments a real catalog never carries and would inflate this condition
  unrealistically).
- One question per invocation, fresh context (D10). The `{{ANSWER_FORMAT_SPEC}}` carries the
  per-family canonical answer SHAPE only — never the expected value. The dump is fair input the
  agent must still read and reason over; it is not the pre-formatted answer.
- For the optional mssql secondary substrate, the equivalent is the catalog-scripted DDL a developer
  would obtain (SSMS "Generate Scripts" / the adapter's dump) — NON-reproducible (private schema).
