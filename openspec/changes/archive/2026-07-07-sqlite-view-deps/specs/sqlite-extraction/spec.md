# Delta for SQLite Extraction

> Change `sqlite-view-deps`. SQLite view bodies now emit `depends_on` edges and trigger ACTION
> bodies emit `reads_from`/`writes_to` via the shared conservative tokenizer
> (`engines/_shared/tokenizer-core.ts`), replacing the hardcoded `dependencies: []` in
> `sqlite/map.ts` `extractViews`/`extractTriggers`. `supportsDependencyHints` STAYS `false`
> (it denotes CHEAP catalog hints, which SQLite lacks; edges are body-derived like pg/mysql —
> the flag gates no code path). All new edges carry `confidence: 'parsed'`. L-009 exact-set:
> every scenario pins src+dst qnames — never existence-only. Qnames use the `main.` schema prefix.

## MODIFIED Requirements

### Requirement: View and trigger dependency edges derived from bodies via the shared tokenizer

The SQLite adapter SHALL derive dependency edges for views and triggers from their bodies in
`sqlite_master.sql` using the shared conservative presence-gate tokenizer
(`maskDynamicStrings` + `bodyContainsRef`, byte-identical to pg/mysql/mssql), matched against a
candidate list of all tables and views. A view body SHALL yield `depends_on` edges (a view's read
dependency normalizes to `depends_on`); a trigger's ACTION body (`BEGIN…END` only) SHALL yield
`writes_to` (INSERT/UPDATE/DELETE targets) and `reads_from` (read targets). The `CREATE TRIGGER … ON
<object>` header MUST be STRIPPED before presence-gating so the fires_on object never leaks a
`reads_from`/`writes_to` edge. All emitted edges MUST carry `confidence: 'parsed'`. The presence-gate
MUST match only real catalog objects (word-boundary, dynamic strings masked): a name appearing only in
a comment or string literal, a `NEW.`/`OLD.` pseudo-reference, or a self-reference MUST NOT fabricate
an edge, and an unparseable/dynamic body MUST be marked `has_dynamic_sql: true` rather than guessed.
`supportsDependencyHints` MUST remain `false` and its comment MUST be corrected to state that SQLite
derives edges from bodies (the flag denotes cheap catalog hints, which SQLite lacks).
(Previously: full SQL-body dependency parsing was DEFERRED beyond Phase 2; `extractViews`/`extractTriggers`
hardcoded `dependencies: []`, so view and trigger nodes carried no `depends_on`/`reads_from`/`writes_to` edges.)

#### Scenario: View bodies emit exact `depends_on` edges

- GIVEN the torture fixture views `active_departments` and `employee_summary`
- WHEN the adapter extracts and the catalog is normalized
- THEN `depends_on` edges are EXACTLY `main.active_departments → {main.departments, main.employees}`
  and `main.employee_summary → {main.employees, main.departments}` — no other, no fewer
- AND every such edge carries `confidence: 'parsed'`

#### Scenario: Trigger action bodies emit exact `writes_to` edges

- GIVEN the torture triggers
- WHEN the adapter extracts and the catalog is normalized
- THEN `writes_to` edges are EXACTLY `main.trg_emp_before_insert`, `main.trg_emp_after_insert`,
  `main.trg_emp_before_update`, `main.trg_emp_after_delete`, `main.trg_emp_salary_update` each
  `→ main.audit_log`, and `main.trg_active_dept_instead_insert → main.departments`
- AND every such edge carries `confidence: 'parsed'`

#### Scenario: Trigger header never leaks a `reads_from`/`writes_to` edge (negative)

- GIVEN the same triggers whose `ON <object>` header names `employees` / `active_departments`
- WHEN the catalog is normalized
- THEN NO trigger emits `reads_from` or `writes_to` to its fires_on object
  (no `trg_emp_* → main.employees`, no `trg_active_dept_instead_insert → main.active_departments`)
- AND no trigger emits any `reads_from` edge at all (the bodies only write)

#### Scenario: No self-edges and no phantom edges (negative)

- GIVEN view/trigger bodies referencing `NEW.`/`OLD.` pseudo-columns and their own names
- WHEN the catalog is normalized
- THEN no view or trigger emits a `depends_on`/`reads_from`/`writes_to` edge to itself
- AND no edge is fabricated for a `NEW.`/`OLD.` pseudo-reference or a name appearing only in a comment or string literal

#### Scenario: `supportsDependencyHints` stays false, comment corrected

- GIVEN the SQLite `CapabilityMatrix`
- WHEN `supportsDependencyHints` is inspected
- THEN it is `false` (matching pg/mysql/mongodb) even though body-derived edges are emitted
- AND the accompanying comment states edges are derived from bodies; the flag denotes cheap catalog hints SQLite lacks

#### Scenario: Edge set is deterministic

- GIVEN the same materialized torture catalog extracted twice
- WHEN both edge sets are serialized
- THEN they are byte-identical (ADR-008) — same catalog yields the identical view/trigger dependency edge set
