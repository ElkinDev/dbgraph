# Delta for sqlite-extraction (dog3-column-lineage)

> SQLite has NO dependency/view-column catalog. Its view `depends_on` edges are already body-derived at
> `confidence: 'parsed'` (see "View and trigger dependency edges derived from bodies"); DOG-3 keeps them
> BYTE-IDENTICAL at OBJECT grain: degradation is expressed by ABSENCE of `attrs.dstColumns` (Model A / design
> Decision D — NO per-edge marker), documented by the `supportsColumnLineage: false` capability. It emits NO
> column — NEVER a body-parsed pair (ADR-007). No fixture object is added. Fixture anchor: the torture views
> `main.active_departments` and `main.employee_summary` (`test/fixtures/sqlite/`). Stories: US-026, US-007.

## ADDED Requirements

### Requirement: View column lineage degrades by absence (no catalog, no body-parsed columns)

Because SQLite has no dependency/view-column catalog, the sqlite adapter MUST leave `RawDependency.columns`
UNSET for every view dependency, so its view `depends_on` edges carry NO `attrs.dstColumns` — degradation is
expressed by ABSENCE (NO per-edge marker, no `attrs.degraded`). The presence-gated body tokenizer that
derives the object-grain view edges MUST NOT be extended to mint a column from the body text (ADR-007); the
absence of column lineage is stated plainly (HONESTY). The view `depends_on` edges stay BYTE-IDENTICAL to
pre-DOG-3 (zero drift). The `supportsColumnLineage: false` capability documents WHY; the existing object-grain
view edge set is otherwise UNCHANGED.

#### Scenario: sqlite views keep object-grain depends_on, zero dstColumns, byte-identical

- GIVEN the torture views `main.active_departments` and `main.employee_summary`
- WHEN the adapter extracts and the catalog is normalized
- THEN they RETAIN their object-grain `depends_on` edges (`main.active_departments → {main.departments, main.employees}` and `main.employee_summary → {main.employees, main.departments}`), each `confidence: 'parsed'` with NO `attrs.dstColumns`
- AND those edges are byte-identical to their pre-DOG-3 form (degrade-by-absence, no marker)

#### Scenario: no fabricated column pair (negative)

- GIVEN the same view bodies naming specific columns of their source tables
- WHEN the catalog is normalized
- THEN the adapter MUST NOT mint an `attrs.dstColumns` entry from the body text (ADR-007)
- AND no column claim appears on any view edge

#### Scenario: existing sqlite goldens show zero drift

- GIVEN the sqlite raw-catalog and e2e goldens
- WHEN DOG-3 is applied
- THEN the view-edge goldens are BYTE-IDENTICAL (no `attrs.dstColumns`, no marker, no new object); the only additive change is the `supportsColumnLineage: false` capability flag
- AND the edge set stays deterministic and byte-identical on re-run (ADR-008)
