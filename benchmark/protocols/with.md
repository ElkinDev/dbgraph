# WITH condition protocol (dbgraph graph context)

Human-readable contract for the **WITH** condition of the dbgraph WITH/WITHOUT benchmark
(US-035, benchmark spec Req 3). This mirrors the pinned run template in `design.md §Run
protocol` verbatim in framing. The ONLY difference from the WITHOUT condition is schema
access — model, system framing, question text, and answer-format instructions are IDENTICAL.

## System framing (IDENTICAL to WITHOUT)

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

You have a dbgraph-indexed graph of the target database in your working directory. Use ONLY the
read-only dbgraph CLI to inspect the schema:
  dbgraph query "<term>" --json
  dbgraph explore "<qname>" --detail full
  dbgraph affected "<script.sql>" --json
  dbgraph status
Do NOT open, cat, or read any .sql / DDL / schema file directly — use the tool. The tool issues only
read-only catalog SELECTs; you must not attempt any write.
```

## Access rules

- The agent gets a working directory containing `.dbgraph/dbgraph.db` + `dbgraph.config.json` and
  **read-only** dbgraph CLI access.
- Permitted tool surface is **EXACTLY** the four documented commands — `query`, `explore`,
  `affected`, `status` (each with `--json` where supported; `explore` is text-only) — and **NO
  other dbgraph or shell command**.
- The agent is **FORBIDDEN** from opening, `cat`-ing, or reading any `.sql` / DDL / schema file
  directly (D11). If it could read the raw DDL it would collapse into the WITHOUT condition.
- One question per invocation, fresh context (D10). The `{{ANSWER_FORMAT_SPEC}}` carries the
  per-family canonical answer SHAPE only — never the expected value.
