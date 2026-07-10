# Delta for mysql-extraction (dog3-column-lineage)

> MySQL exposes NO view-column catalog — no `VIEW_COLUMN_USAGE`, no dependency view (verified against
> `capabilities.ts`/`queries.ts`). View `depends_on` STAYS object grain and its edges are BYTE-IDENTICAL to
> pre-DOG-3: degradation is expressed by ABSENCE of `attrs.dstColumns` (Model A / design Decision D — NO
> per-edge marker), documented by the `supportsColumnLineage: false` capability. It is NEVER body-parsed into
> a column (ADR-007). No fixture object is added. Stories: US-029, US-007.

## ADDED Requirements

### Requirement: View column lineage degrades by absence (no view-column catalog)

Because MySQL has no view-column catalog, the mysql adapter MUST leave `RawDependency.columns` UNSET for
every view dependency, so the view→table `depends_on` edges carry NO `attrs.dstColumns` — degradation is
expressed by ABSENCE (NO per-edge marker, no `attrs.degraded`). The adapter MUST NOT fabricate a column from
the view body text (ADR-007) — the absence is stated plainly (HONESTY). The mysql view `depends_on` edges
(`confidence: 'parsed'`, body-derived) stay BYTE-IDENTICAL to pre-DOG-3 (zero drift). The per-engine
`supportsColumnLineage: false` capability documents WHY; `supportsDependencyHints` and the existing edges are
otherwise UNCHANGED.

#### Scenario: mysql view carries object-grain depends_on, zero dstColumns, byte-identical

- GIVEN a mysql torture view whose body reads base tables `b` and `c`
- WHEN `extract(scope)` runs at `full` and the catalog is normalized
- THEN the view carries object-grain `depends_on` to `b` and to `c`, each `confidence: 'parsed'` with NO `attrs.dstColumns`
- AND those edges are byte-identical to their pre-DOG-3 form (degrade-by-absence, no marker)

#### Scenario: no body-parsed column is fabricated (negative)

- GIVEN the same view whose body names specific columns of `b`/`c`
- WHEN the catalog is normalized
- THEN the adapter MUST NOT mint an `attrs.dstColumns` entry from the body text (ADR-007)
- AND no column claim appears on any view edge

#### Scenario: mysql goldens show zero column-lineage drift

- GIVEN the mysql raw-catalog and e2e goldens
- WHEN DOG-3 is applied
- THEN the view-edge goldens are BYTE-IDENTICAL (no `attrs.dstColumns`, no marker); the only additive change is the `supportsColumnLineage: false` capability flag, which changes no edge byte
- AND the adapter's SQL still passes the engines write-verb scanner (catalog `SELECT` only)
