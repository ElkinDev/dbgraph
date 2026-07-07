# Delta for benchmark

> Change: `explore-payloads`. Adds a SECOND, code-version-labeled results table to `docs/benchmarks.md`
> for the explore-payloads re-run on the FROZEN US-035 harness. The methodology — protocol, question
> set, ground truth, scoring, and token boundary — is UNCHANGED; only the code under test differs. The
> existing honesty contract is fully preserved. Methodology-only: touches NOTHING in `src/**` or `dist/`.

## ADDED Requirements

### Requirement: Multiple runs are reported as code-version-labeled tables on the frozen protocol

`docs/benchmarks.md` MAY carry MORE THAN ONE results table. Each table MUST be LABELED with the exact
dbgraph code version / run-id it was produced under (e.g. `torture-2026-07-06`,
`explore-payloads-2026-MM-DD`) so runs are never conflated and no reader mistakes one run's numbers for
another's. Every additional run MUST use the FROZEN methodology UNCHANGED: the SAME pre-registered
question set and separately-held ground-truth key, the SAME deterministic blind scorer, the SAME single
token-accounting boundary, and the SAME WITH tool surface of EXACTLY the four commands `query`,
`explore`, `affected`, `status` (each with `--json`). A re-run MUST NOT add, remove, or alter any command,
question, or scoring rule. Results MUST be reported HONESTLY per the standing contract: whatever the
numbers show — INCLUDING no improvement or a REGRESSION versus the first run — is reported, scoped to
"on this fixture, this question set, this model", with NO suppression and NO extrapolation.

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
