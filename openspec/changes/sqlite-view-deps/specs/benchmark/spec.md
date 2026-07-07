# Delta for Benchmark

> Change `sqlite-view-deps`. This change makes the `view-dependency` question family INSTANTIABLE on
> the SQLite substrate (edges now exist) and corrects stale `supportsDependencyHints`-blindness
> comments. It EXPLICITLY does NOT bump N, regenerate the committed question set, add a run, or
> re-derive any key — that N-change (5→6) and its new mechanical key are DEFERRED to their own
> labeled run. Runs 1 and 2 (N=5) stay frozen. This capability changes NOTHING in `src/**` or `dist/`.

## ADDED Requirements

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
