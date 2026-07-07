# Tasks: Benchmark harness hardening — build-time DDL-coverage assertion + self-contained no-leak audit trail (benchmark-harness-hardening)

Standing header (every task): **STRICT TDD** — the failing `vitest` test PRECEDES the code (RED→GREEN→refactor) for
the PURE helpers. **EXACT / golden-pinned** assertions ALWAYS (`.toBe`/`.toStrictEqual`); existence-only
`.toBeDefined()` is FORBIDDEN. All logic lands in a PURE, I/O-free module `benchmark/harness-checks.ts` (design
Decision 1) — the name matches NONE of the four stage names in the independence guard's
`STAGE_RE = /benchmark[\\/](?:generate|build-packets|score|render)\.(?:ts|js)/`, so a unit MAY import it; the stages
(`build-packets.ts`, `score.ts`) keep their I/O and CALL it. Units import ONLY `../../benchmark/harness-checks.ts` —
NEVER a stage — and the test file text contains NO stage path literal (`benchmark/score.ts` etc.) and NO
`benchmark/runs` string (both are scanned by `independence.test.ts` across the whole `test/` tree). The poisoned
mini-dump and the mismatched-hash raw record are INLINE `const` literals — NO new `.json` under
`test/benchmark/fixtures/` (that dir is guard-asserted to be EXACTLY the six family stubs). Fully additive validation
on DEV/orchestrator tooling — NO `src/**` or `dist/` touch; ZERO new runtime OR dev dependencies (zero-dep ADR).
Strict TS (NO `any`); ENGLISH; conventional commits referencing `benchmark-harness-hardening`, NO AI attribution,
**NO push / PR / gh / tags** — local commits only. Leak-scan/denylist hooks active — scan before EVERY commit;
substrate is the committed synthetic SQLite torture fixture.

**GOLDEN DISCIPLINE — the stamp is ADDITIVE, scoring outcomes are BYTE-IDENTICAL (spec Req 2 HARD guard).** The
`promptSha256` field is purely additive: `aggregate.json` (per-family + overall accuracy, token totals + delta) MUST
stay BYTE-IDENTICAL for every valid run, and `scored/per-question.json` gains ONLY the new `promptSha256` per
condition — every PRIOR field byte-identical. If ANY scoring outcome (accuracy or token total) drifts, that is a
**HARD STOP defect**, NOT a re-bless — investigate the stamp wiring. `aggregate.json` is UNTOUCHED by design
(blindness D13 + ADR-008 determinism preserved).

RESOLVED design decisions — apply MUST NOT re-litigate these (design.md §Architecture Decisions + §Open Questions):
- **D1 (pure module seam):** `benchmark/harness-checks.ts` exports `deriveCoverageTargets`, `verifyDumpCoverage`,
  `joinManifestHashes` — pure, no `fs`/`crypto`/`Database`. The independence guard MECHANICALLY forces this seam
  (inlining in the stage + spawning it is forbidden; reusing a stage name trips `STAGE_RE`). `answerAtoms` /
  `assertPacketPair` stay in `build-packets.ts` (unchanged, out of the new surface).
- **D2 (per-family derivation — anchor on the KNOWN family):** targets come from the SAME typed reads `answerAtoms`
  uses, plus the table encoded in the qid via `qid.slice(family.length + 1)` (robust to hyphens). Per family:
  `fk-path` → `{table, hop.fromTable}` + `{table, hop.toTable}` per `gt.hops[]`; `trigger-inventory` →
  `{trigger, t.triggerQname}` per `gt.triggers[]`; `impact` → `{table, name}` per entry of `gt.whatToTest[]`;
  `column-type` / `constraint-semantics` → `{table, tableFromQid}` (`column-type-<table>.<col>` → before first `.`;
  `constraint-semantics-<table>`). NEVER from `source_ddl_ref` (a `file:line`). NEVER the composed answer atom (that
  is the LEAK).
- **D2-shape (committed-data reconciliation — VERIFY vs actual):** the committed `impact` ground truth stores
  `whatToTest` as a FLAT array of BARE table-name strings (`["assignments","employees"]`), NOT the `{table, name}`
  sub-objects the design's prose table implies. Derive one `{kind:'table', name: entry}` per STRING entry. Build the
  RED test against the REAL committed shape (mirror `benchmark/ground-truth/impact-*.json`), not the prose.
- **D3 (dump matching = membership in DEFINED objects):** `verifyDumpCoverage` parses the dump's
  `CREATE (TABLE|VIEW|TRIGGER|INDEX) <name>` statements (tolerating `IF NOT EXISTS` / `TEMP`) into a normalized
  `Set<"kind:name">` — strip optional `schema.` (`main.`) prefix, strip `"…"`/`` `…` ``/`[…]` quoting, lowercase
  (SQLite identifiers case-insensitive). A target is covered iff `kind:name ∈ set`. `INDEX` is parsed but NEVER
  targeted (harmless). REJECTED: bare `dump.includes(name)` (false-positive on `REFERENCES x` / column names).
- **D4 (score.ts manifest join — frozen packet hash, honest wording):** read `benchmark/packets/manifest.json`
  (default `join(benchmarkDir, 'packets', 'manifest.json')`, overridable via `--manifest`), call
  `joinManifestHashes(manifest, rawRecords)`, stamp the authoritative `promptSha256` per `(qid, condition)` into
  `scored/per-question.json`. Missing manifest FILE → throw. The attestation wording (design §Decision 4) is FROZEN
  and goes in the `score.ts` comment: the field attests WHICH frozen packet content was scored — it is NOT a receipt
  the agent was fed those bytes at run time.
- **OQ1 RESOLVED — `missing-in-manifest` severity = FAIL:** a `(qid,condition)` absent from the manifest MUST fail
  loudly (exit 1) — an authoritative hash cannot be stamped. (Design default; encoded here, do NOT downgrade to warn.)
- **OQ2 NOTE ONLY — `view-dependency` derivation is MOOT:** the frozen 5-question set carries no view-dependency
  question, so the family's target-derivation path is inert. Derive the view from the qid IF the branch is exercised;
  do NOT treat `dependencies[]` as targets. No test is required beyond a derivation-shape unit if trivially reachable.

Per-batch GATE (ALL pass before the next batch, then COMMIT): `npx tsc --noEmit` clean (strict, no `any`) ·
`npm run lint` 0 errors / 0 warnings · `npm test` (`vitest run`) GREEN with **ZERO benchmark run artifacts** (baseline
**3229** + the B1 harness-checks unit suite; the independence guard stays green — units import only `harness-checks.ts`,
add NO `.json` to `fixtures/`, contain NO `STAGE_RE` literal, NO `benchmark/runs` string) · **`aggregate.json`
byte-identical for valid runs — no scoring drift (HARD STOP on any drift)** · leak-scan/denylist clean. Commit EACH
batch (conventional, references `benchmark-harness-hardening`, NO AI attribution, NO push/PR/gh/tag).

## Batch B1: Pure `harness-checks.ts` (3 exports) + RED-first units + stage wiring (STRICT TDD, load-bearing)

> Satisfies benchmark "WITHOUT-dump coverage is machine-asserted at build time" (scenarios: correct dump covers every
> target, wrong-DB dump → LOUD exit 1, targets derived per family by pinned rule, failure output leaks no key VALUE)
> AND "No-leak audit trail is self-contained in scored artifacts" (scenarios: scored output carries the manifest hash
> both conditions, non-empty mismatching hash fails loudly, empty raw hash stamped with honest attestation, stamp is
> additive). CODE + STRICT TDD. The pure module is the ONLY new logic `npm test` exercises; the stages import it.

- [ ] B1.1 **(vitest)** RED→GREEN `test/benchmark/harness-checks.test.ts` (new) + `benchmark/harness-checks.ts` (new):
  `deriveCoverageTargets(qid, family, gt): readonly CoverageTarget[]` (`{kind:'table'|'view'|'trigger', name}`). RED
  first with INLINE minimal GT literals mirroring `benchmark/ground-truth/*.json`: `fk-path` → `{table,'assignments'}`
  + `{table,'employees'}` from `hops[]`; `trigger-inventory` → `{trigger,'trg_active_dept_instead_insert'}`; `impact`
  → `{table,'assignments'}` + `{table,'employees'}` from the FLAT `whatToTest` string array (D2-shape); `column-type`
  qid `column-type-assignments.dept_id` → `{table,'assignments'}`; `constraint-semantics-assignments` →
  `{table,'assignments'}`. Assert qid parsing anchors on `qid.slice(family.length + 1)`. EXACT `.toStrictEqual`. Spec
  scenario "Targets derived per family by pinned rule". Design D2/D2-shape. Done: `npm test harness-checks`.
- [ ] B1.2 **(vitest)** RED→GREEN `harness-checks.test.ts` + `harness-checks.ts`: `verifyDumpCoverage(ddlDump, targets):
  readonly CoverageTarget[]` returns the targets NOT DEFINED (empty ⇒ full coverage). RED first on INLINE mini-dump
  strings: HIT — a dump defining `CREATE TABLE assignments (...)` etc. returns `[]`; MISS — a POISONED dump (wrong-DB
  in unit form) omitting `assignments` returns `[{table,'assignments'}]`; quoted `CREATE TABLE "Assignments"` and
  `CREATE TABLE main.assignments` and `IF NOT EXISTS` / `TEMP` variants all COVER `{table,'assignments'}`
  (case-insensitive, schema/quote-stripped, D3); a mere `REFERENCES assignments` (no CREATE) does NOT cover.
  `.toStrictEqual`. Spec scenarios "Correct dump covers every target" + "Wrong-DB dump missing a target — LOUD exit 1"
  (pure MISS half). Design D3. Done: `npm test harness-checks`.
- [ ] B1.3 **(vitest)** RED→GREEN `harness-checks.test.ts` + `harness-checks.ts`: `joinManifestHashes(manifest, raw):
  readonly HashJoinResult[]` — pure, NO throw; status ∈ `ok|mismatch|empty-raw|missing-in-manifest`. RED first on
  INLINE manifest + raw literals: matching non-empty raw → `ok` + `authoritativePromptSha256` from manifest;
  non-empty raw ≠ manifest → `mismatch`; empty/absent raw → `empty-raw` with `rawPromptSha256:''`;
  `(qid,condition)` absent from manifest → `missing-in-manifest` with `authoritativePromptSha256:null`. PIN the leak
  guard: assert NO CoverageTarget/answer key VALUE appears in any result — only qid/condition/hash. `.toStrictEqual`.
  Spec scenarios "Scored output carries the manifest hash" + "Non-empty mismatching hash fails loudly" +
  "Empty raw hash is stamped" (join half) + "Failure output leaks no key VALUE" (pin). Design D4/OQ1. Done:
  `npm test harness-checks`.
- [ ] B1.4 **(stage wiring — self-checked, NOT vitest)** Modify `benchmark/build-packets.ts`: import the helpers;
  in the main loop AFTER `assertPacketPair(...)` add
  `const missing = verifyDumpCoverage(ddlDump, deriveCoverageTargets(q.qid, q.family, gt));` and, on non-empty,
  `throw` the PINNED LOUD message `SELF-CHECK FAILED: <qid> (<family>) — DDL dump does not define target object(s):
  TABLE <name>, ...` (an uncaught throw → exit 1). The message names ONLY `KIND bare-identifier` (already present
  un-redacted in a correct dump) — NEVER a composed answer value. Spec scenarios "Wrong-DB dump → LOUD exit 1" +
  "Failure output leaks no key VALUE" (stage half). Design §Stage wiring. Done: correct fixture-built db still exits 0
  (proven in B2.1-adjacent smoke); wrong-db aborts (B2.2).
- [ ] B1.5 **(stage wiring — self-checked, NOT vitest)** Modify `benchmark/score.ts`: add `readonly promptSha256?:
  string` to `RawRecord`, `promptSha256: string` to `ConditionResult`; read the frozen manifest (default
  `join(benchmarkDir, 'packets', 'manifest.json')`, `--manifest` override; missing FILE → throw); call
  `joinManifestHashes` and, per `(qid,condition)`: `mismatch` → COLLECT then FAIL loudly (exit 1, ALL offenders, no
  scored file emitted); `missing-in-manifest` → FAIL (OQ1); `empty-raw` → WARN to stderr and STAMP the authoritative
  value; `ok` → stamp. Add the FROZEN attestation comment (design §Decision 4). `aggregate.json` UNTOUCHED (additive
  guard). Spec scenarios "Scored output carries the manifest hash" + "Non-empty mismatching hash fails loudly" +
  "Empty raw hash is stamped with honest attestation" (stage half). Design D4/OQ1. Done: score.ts stamps additively;
  the field is honest.
- [ ] B1.6 GATE (Batch B1): `npx tsc --noEmit` clean (covers `harness-checks.ts` via the `benchmark` include + the
  test via `test`); `npm run lint` 0/0; `npm test` GREEN (baseline 3229 + harness-checks unit suite) with the
  independence guard green (units import ONLY `harness-checks.ts`; NO new `fixtures/*.json`; NO `STAGE_RE` literal; NO
  `benchmark/runs` string) and ZERO run artifacts; leak-scan clean. Then COMMIT
  `feat(benchmark): add harness-checks coverage + manifest-hash module, wire build-packets abort and score stamp`.

## Batch B2: Runtime proof against existing artifacts + poisoned-db negative proof + final gate/DoD (verification)

> Satisfies benchmark "Stamp is additive — valid-run outcomes byte-identical (HARD guard)" via a real re-score of the
> committed runs, and re-proves the wrong-DB abort (spec Req 1) end-to-end at the STAGE level (the independence guard
> forbids importing the stage into vitest, so this is a documented smoke proof, NOT a suite). No new source expected —
> the change is CODE-complete at the B1 commit; this batch is the verification oracle before `sdd-verify`.

- [ ] B2.1 **(proof — byte-identical scoring, smoke-style)** CAPTURE the pre-change `aggregate.json` bytes for BOTH
  `benchmark/runs/torture-2026-07-06` and `benchmark/runs/explore-payloads-2026-07-06` (they are the pre-change
  oracle — the raw records carry EMPTY/absent `promptSha256`, the known W1 state). Re-run
  `node --experimental-strip-types benchmark/score.ts runs/<id>` (default frozen manifest) for each. ASSERT:
  `aggregate.json` BYTE-IDENTICAL to the captured bytes (accuracy + token totals unchanged, D13/ADR-008);
  `scored/per-question.json` gains ONLY the additive `promptSha256` per condition, every PRIOR field byte-identical;
  every empty raw hash was WARNED and STAMPED from the frozen manifest; NO `mismatch`/`missing-in-manifest` (all run
  qids are present in the frozen manifest). ANY scoring-outcome drift is a HARD STOP. Spec scenarios "Stamp is
  additive — byte-identical" + "Scored output carries the manifest hash" + "Empty raw hash stamped". Design D4.
- [ ] B2.2 **(negative proof — poisoned db, smoke-style, NOT vitest)** Materialize a WRONG mini-db that OMITS one
  question's target object (e.g. drop `assignments` from a torture-derived copy), then run
  `node --experimental-strip-types benchmark/build-packets.ts --db <wrong.db>`. OBSERVE: exit code 1; the message is
  the PINNED `SELF-CHECK FAILED: <qid> (<family>) — DDL dump does not define target object(s): TABLE <name>, ...`
  naming the missing OBJECT + qid and containing NO composed answer value. This is documented HERE (not a vitest
  suite — `STAGE_RE` forbids importing `build-packets`). Spec scenarios "Wrong-DB dump missing a target — LOUD exit 1"
  + "Failure output leaks no key VALUE". Design §Stage wiring.
- [ ] B2.3 GATE (Batch B2 — FINAL): `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; `npm test` FULL
  GREEN (baseline 3229 + harness-checks suite) with the independence guard green and ZERO run artifacts;
  `aggregate.json` byte-identical for BOTH runs (no scoring drift — HARD STOP otherwise); no `questions.yaml`/N/scoring
  rule/protocol byte moved; leak-scan clean; confirm NOTHING pushed (NO push/PR/gh/tag). Trace the Definition of Done
  below. No new commit expected (proof only — re-scored artifacts land under git-ignored `runs/`). Hand off to
  `sdd-verify`.

## Apply Batch Grouping (one sub-agent session each)

- **Batch B1** (B1.1–B1.6): CODE — `benchmark/harness-checks.ts` (`deriveCoverageTargets` + `verifyDumpCoverage` +
  `joinManifestHashes`, pure) + `test/benchmark/harness-checks.test.ts` (RED-first, inline literals) + thin wiring into
  `benchmark/build-packets.ts` (coverage abort) and `benchmark/score.ts` (manifest join + additive stamp + severities).
  STRICT TDD on the pure module; the wiring rides on the units + the B2 smoke proofs.
- **Batch B2** (B2.1–B2.3): VERIFICATION — re-score the two committed runs proving `aggregate.json` byte-identity +
  additive stamp, the poisoned-db exit-1 negative proof (smoke, documented not vitest), final gate + DoD trace. No new
  source; hand off to verify.

### Parallel vs sequential

- **Batches are SEQUENTIAL: B1 → B2.** B2 is the runtime proof of B1's wiring — it cannot run until the stages call the
  new module. Within B1 the three pure exports (B1.1/B1.2/B1.3) are logically independent but land in the single
  `harness-checks.ts` (one sub-agent, not split); the two stage wirings (B1.4 build-packets, B1.5 score) are
  independent of each other and each depends only on the module being present.

### Dependency bottlenecks

- **The pure module gates everything.** `build-packets.ts` and `score.ts` both import `harness-checks.ts`; if a target
  derivation or the DEFINED-object matching drifts, both stages inherit it. Build and unit-pin the module FIRST.
- **The independence guard is the sharp edge (D1).** A unit that imports a stage, adds a `.json` to `fixtures/`, or
  writes the literal `benchmark/score.ts` / `benchmark/runs` in its text turns `npm test` RED via `independence.test.ts`.
  Units import ONLY `harness-checks.ts` and use INLINE literals — this is WHY the seam exists.
- **Additivity is the golden-discipline sharp edge (spec Req 2).** `aggregate.json` must be byte-identical for valid
  runs; `scored/per-question.json` gains ONLY `promptSha256`. The proof is B2.1 against the two REAL committed runs —
  ANY accuracy/token drift is a HARD STOP defect, never a re-bless.
- **`missing-in-manifest` is FAIL, not warn (OQ1).** The real runs' qids are all in the frozen manifest, so B2.1 sees
  only `empty-raw` (warn + stamp); the FAIL path is exercised by the B1.3 unit. Do NOT relax it to warn.
- **The wrong-DB abort has NO vitest coverage by design.** The pure MISS unit (B1.2) IS the regression; the stage-level
  exit-1 is proven by the B2.2 documented smoke (the guard forbids importing the stage). Both are required.

## Definition of Done (tied to the proposal's Success Criteria; 8 spec scenarios across 2 requirements traced)

- [ ] A WITHOUT dump from the WRONG database (missing a target object) makes `build-packets` exit 1 with a message
  naming the missing OBJECT + qid — no composed key value leaked. — B1.2 (pure MISS), B1.4 (stage abort), B2.2 (smoke)
  [scenarios: Wrong-DB dump → LOUD exit 1; Failure output leaks no key VALUE]
- [ ] A correct dump passes unchanged and every target is derived per family by the pinned rule (fk-path from/to,
  trigger qname, impact `whatToTest`, column-type/constraint table-from-qid). — B1.1, B1.2 (HIT) [scenarios: Correct
  dump covers every target; Targets derived per family by pinned rule]
- [ ] `scored/per-question.json` carries the authoritative `promptSha256` per `(qid, condition)`, sourced from the
  frozen `manifest.json`, with the honest FROZEN-PACKET attestation. — B1.3, B1.5, B2.1 [scenarios: Scored output
  carries the manifest hash; Empty raw hash stamped with honest attestation]
- [ ] A raw record whose non-empty `promptSha256` MISMATCHES the manifest fails scoring loudly (exit 1, no scored
  file); a `(qid,condition)` missing from the manifest also fails (OQ1). — B1.3, B1.5 [scenario: Non-empty mismatching
  hash fails loudly]
- [ ] For valid runs, `aggregate.json` (accuracy + token totals) is BYTE-IDENTICAL pre/post change and
  `scored/per-question.json` differs ONLY by the additive `promptSha256` — proven against the two committed runs. —
  B2.1 [scenario: Stamp is additive — valid-run outcomes byte-identical (HARD guard)]
- [ ] Zero changes to `questions.yaml`, N, scoring rules, protocols, `src/**`, or `dist/`; zero new deps;
  `npx tsc --noEmit` strict clean; `npm run lint` 0/0; `npm test` GREEN (baseline 3229 + harness-checks suite) with the
  independence guard green; leak-scan clean — proven LOCALLY, nothing pushed. — every batch GATE (B1.6, B2.3)
