# Delta for Benchmark

> `benchmark-harness-hardening`. Two ADDED enforceable requirements on the DEV / orchestrator
> tooling ONLY — `build-packets.ts` and `score.ts`. Both are ADDITIVE validation: the frozen
> question set, N, scoring rules, protocols, and the token-accounting boundary are UNTOUCHED (HARD
> guard); no `src/**` or `dist/` change. They turn two defects caught today only by MANUAL
> cross-check — a wrong-DB WITHOUT dump, and an empty raw `promptSha256` — into build-time /
> score-time failures.

## ADDED Requirements

### Requirement: WITHOUT-dump coverage is machine-asserted at build time

`benchmark/build-packets.ts` MUST, BEFORE writing any packet, derive each question's target object
identifiers from its family-typed ground truth and ASSERT each identifier appears in the generated
WITHOUT DDL dump. A miss MUST abort with exit code 1. This turns the existing "WITHOUT dump is fair,
from the same source of truth" scenario into a build-time MACHINE guarantee rather than a prose
expectation. The failure output MUST name the missing OBJECT and the qid, and MUST NOT contain any
ground-truth key VALUE — a bare schema OBJECT identifier is safe (it already appears un-redacted in
the dump), whereas a COMPOSED answer value (e.g. a full FK path) is NOT.

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

| Family | Target identifier source |
|--------|--------------------------|
| fk-path | ground-truth `fromTable` and `toTable` |
| trigger-inventory | ground-truth `triggerQname` |
| impact | ground-truth `whatToTest` |
| column-type / constraint-semantics | the table encoded in the `qid` |

#### Scenario: Failure output leaks no key VALUE

- GIVEN a coverage miss for a family whose ground-truth key is a COMPOSED value (e.g. an FK path)
- WHEN the failure message is emitted
- THEN it contains ONLY the bare missing schema OBJECT identifier and the qid — NEVER the composed key value or the full ground-truth answer

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
