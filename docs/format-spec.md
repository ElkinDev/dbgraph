# Compact Format Specification (US-019)

This document is the CONTRACT that all `src/core/present/` formatters conform to.
Changing a golden file REQUIRES a corresponding edit to this document and a token-delta
justification in the PR description.

---

## 1. Line Grammar

### 1.1 Object header line

```
qname  [kind]
```

Examples:

```
dbo.orders  [table]
dbo.orders.order_id  [column]
dbo.usp_ProcessOrder  [procedure]
```

For engines without a schema namespace (SQLite), the bare object name is used:

```
orders  [table]
```

### 1.2 Column lines (inside `COLUMNS` section)

```
  colname  TYPE  [PK]
  colname  TYPE  [FK→ref_table.ref_col]
  colname  TYPE  [NN]
  colname  TYPE  [PK][NN]  DEFAULT 'value'
```

- `[PK]` — primary key member
- `[FK→qname]` — foreign-key reference (qualified name of the target column)
- `[NN]` — NOT NULL (non-nullable without a PK constraint)
- `DEFAULT value` — appended when a default is defined

Column lines are indented two spaces.

### 1.3 Annotation suffix on object header

```
qname  [kind]  [Nidx, Ntrg!]
```

- `Nidx` — count of associated indexes (omitted when 0)
- `Ntrg!` — count of triggers, with `!` marking hidden trigger logic

Examples:

```
dbo.orders  [table]  [2 idx, 1 trg!]
dbo.products  [table]  [1 idx]
```

### 1.4 Edge lines (inside `RELATED` and `WRITES` sections)

Outbound edge:

```
  → target_qname  [edge_kind]
```

Inbound edge:

```
  ← source_qname  [edge_kind]
```

For inferred edges, a score suffix is added:

```
  → target_qname  [inferred_reference, score=0.85]
```

### 1.5 Section headers

```
OBJECT
COLUMNS
RELATED
WRITES
```

Each section header is unindented. Content lines inside a section are indented two spaces.
An empty section is omitted entirely.

---

## 2. Detail Levels

Three levels control how much information is rendered per formatter call.
The level is supplied by the tool caller as `detail?: 'brief' | 'normal' | 'full'`.

| Level    | Description                                                                                              |
|----------|----------------------------------------------------------------------------------------------------------|
| `brief`  | Object header + annotation counts only. No column details, no neighbor qnames. Lowest token cost.       |
| `normal` | Brief + grouped neighbors (edge kind / direction / sorted qnames). No body or bodyHash. Default level.  |
| `full`   | Normal + bodyHash, indexing level, body (for modules), and `hasDynamicSql` warning when applicable.     |

Per-tool level defaults and what each section shows:

| Tool              | brief                       | normal                                | full                                      |
|-------------------|-----------------------------|---------------------------------------|-------------------------------------------|
| `dbgraph_explore` | header + counts             | + grouped neighbors                   | + bodyHash, level, dynamic-SQL warning    |
| `dbgraph_search`  | type + qname + rank         | + match column                        | + excerpt                                 |
| `dbgraph_object`  | header + annotation counts  | + columns (type/null/default), FK/PK  | + indexes, triggers, body (modules)       |
| `dbgraph_related` | grouped edge kinds + counts | + qnames per group                    | + inferred score, body excerpts           |
| `dbgraph_impact`  | chain summary               | + full chain (a→b→c), read/write split| + node types, dynamic-SQL / truncation ⚠  |
| `dbgraph_path`    | route qnames only           | + join columns per hop                | + inferred marks, no-route neighbor list  |
| `dbgraph_status`  | engine/version + last sync  | + per-type counts, configured levels  | + excluded objects, drift detail          |
| `dbgraph_precheck`| matched objects list        | + aggregated impact sections          | + confidence tags, unmatched identifiers  |

---

## 3. Pagination Contract

Tools returning lists (`dbgraph_search`, and any tool whose result can exceed its budget)
use `offset` / `limit` / `hasMore`:

```
offset  — zero-based position of the first returned item (default 0)
limit   — maximum items in this response (tool-specific default; see budget table)
hasMore — true when results beyond the returned page remain; false when this is the last page
```

The footer line format:

```
--- N results | offset M | hasMore: true ---
```

or when on the last page:

```
--- N results (total) | offset M ---
```

Callers advance `offset` by `limit` to fetch the next page. Cursor-based pagination is out of scope.

---

## 4. Token Budget Methodology

Token costs are measured EMPIRICALLY on the committed SQLite torture fixture at
`test/fixtures/sqlite/`. The approximation formula is:

```
tokens ≈ ceil(output_chars / 4)
```

This is the documented LLM tokenizer approximation used by OpenAI and Anthropic.
It slightly overestimates, making budgets conservative.

Measurement procedure (performed in Batch E, task 5.4):
1. Start the in-process `InMemoryTransport` harness over the torture fixture.
2. Call each tool at each `detail` level with a representative entity that has ≤ 30 relationships.
3. Capture the output string length.
4. Apply `ceil(chars / 4)`.
5. Record the result in the table below and replace every "TBD until measured" placeholder.
6. Add a brief-budget assertion in `test/core/present/` verifying the measured ceiling is respected.

---

## 5. Per-Tool / Per-Detail Token Budget Table

All ceilings are EMPIRICALLY measured (Batch E, task 5.4) on the committed SQLite torture fixture
(`test/fixtures/sqlite/torture.sql`) using `main.employees` (a table with ≤ 30 relationships) as
the representative entity. Formula: `ceil(chars / 4)`. Ceilings include a ~25–50% headroom
margin above the measured value to accommodate slightly larger entities.

Measured raw values and headroom ceilings:

| Tool              | brief measured / ceiling | normal measured / ceiling | full measured / ceiling |
|-------------------|--------------------------|---------------------------|-------------------------|
| `dbgraph_explore` | 53 chars→14 tk / 75      | 291 chars→73 tk / 400     | 303 chars→76 tk / 420   |
| `dbgraph_search`  | 209 chars→53 tk / 275    | 209 chars→53 tk / 275     | 294 chars→74 tk / 400   |
| `dbgraph_object`  | 17 chars→5 tk / 30       | 82 chars→21 tk / 110      | 168 chars→42 tk / 225   |
| `dbgraph_related` | 57 chars→15 tk / 80      | 296 chars→74 tk / 400     | 296 chars→74 tk / 400   |
| `dbgraph_impact`  | 29 chars→8 tk / 50       | 34 chars→9 tk / 55        | 34 chars→9 tk / 55      |
| `dbgraph_path`    | 62 chars→16 tk / 80      | 62 chars→16 tk / 80       | 62 chars→16 tk / 80     |
| `dbgraph_status`  | 44 chars→11 tk / 65      | 190 chars→48 tk / 250     | 198 chars→50 tk / 265   |
| `dbgraph_precheck`| 25 chars→7 tk / 40       | 43 chars→11 tk / 65       | 79 chars→20 tk / 110    |

Simplified ceiling table (tokens — use these for budget assertions):

| Tool              | `brief` (tokens) | `normal` (tokens) | `full` (tokens) |
|-------------------|------------------|-------------------|-----------------|
| `dbgraph_explore` | 75               | 400               | 420             |
| `dbgraph_search`  | 275              | 275               | 400             |
| `dbgraph_object`  | 30               | 110               | 225             |
| `dbgraph_related` | 80               | 400               | 400             |
| `dbgraph_impact`  | 50               | 55                | 55              |
| `dbgraph_path`    | 80               | 80                | 80              |
| `dbgraph_status`  | 65               | 250               | 265             |
| `dbgraph_precheck`| 40               | 65                | 110             |

Note: `dbgraph_path` only has found/no-route variants, not brief/normal/full; the ceiling uses the
larger no-route output (62 chars). `dbgraph_status` includes a non-deterministic ISO timestamp
(~25 chars) that is excluded from deterministic golden comparisons but included in budget accounting.

---

## 6. Golden Discipline

A golden file is a committed text file whose content is the byte-identical expected output of
a formatter invoked with a fixed `*View` input struct.

Rules:
- A golden file MUST be committed before the corresponding formatter code is written (RED-first).
- Changing a golden file REQUIRES both a corresponding edit to this `format-spec.md` document
  AND a token-delta justification in the PR description explaining why the output changed.
- Goldens under `test/core/present/golden/` cover formatter × detail (unit-level, fixed view structs).
- Goldens under `test/mcp/golden/` cover tool × detail (E2E-level, through the transport harness).
- Every golden assertion must be byte-identical: `expect(output).toBe(goldenContent)`.

---

## 7. Purity Contract

Every formatter in `src/core/present/` MUST be a pure function:
- No `process.env` reads
- No `Date.now()` or clock calls
- No `Math.random()`
- No file I/O or network calls
- Same `(*View, detail)` input → always the exact same output bytes (ADR-008)
