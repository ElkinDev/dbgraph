# Archive Report — phase-benchmark

**Project**: dbgraph
**Change**: `phase-benchmark`
**Branch**: `closeout`
**Artifact store**: openspec (files)
**Archived**: 2026-07-06
**Verdict at archive**: PASS — 0 CRITICAL / 2 WARNING / 2 SUGGESTION (both WARNINGs accepted, artifact-consistency only, non-blocking)
**Verified commits**: `929367b`, `5d2e2ef`, `d438dbe`, `adfc477`, `6be2a2d`, `84267bb`

---

## Executive Summary

This change delivers the reproducible WITH/WITHOUT-dbgraph benchmark harness for **US-035**: a
mechanically-derived question set, a condition-blind deterministic scorer, two protocol packets that
differ only in schema access, and a `docs/benchmarks.md` report whose limitations ship alongside the
results, never buried. The harness was run on the committed SQLite torture fixture
(`torture-2026-07-06`). The headline number is reported exactly as measured and is **unfavorable to
dbgraph**: WITH scored 40% (2/5) against WITHOUT's 80% (4/5), while spending 2.2x the tokens. The
verifier independently re-ran the scorer, regenerated the ground truth from a fresh graph build, and
verified the root-cause claim by reading the actual `explore`/`query` presentation code. All 20/20 spec
scenarios are COMPLIANT. Zero CRITICAL findings. Two non-blocking WARNINGs (artifact-consistency only)
are accepted as-is below. Safe to archive.

---

## What Shipped

| Commit | Summary |
|--------|---------|
| `929367b` | SDD planning: proposal, spec (`benchmark`, 6 requirements / 20 scenarios), design (15 architecture decisions), and a 4-batch + Batch-R task breakdown. Reproducible-first, dual-substrate approach (torture fixture primary, mssql secondary optional) formalized for US-035. |
| `5d2e2ef` | Batch 1 (STRICT TDD): condition-blind scorer core — `parseAnswer`/`normalizeQname`/`canonicalType` helpers, six pure per-family comparators (`fk-path`, `column-type`, `impact`, `trigger-inventory`, `view-dependency`, `constraint-semantics`), the token-accounting formula, and `test/benchmark/scorer.test.ts` with committed fixture stubs. The only new code `npm test` exercises. |
| `d438dbe` | Batch 2: `generate.ts` — pre-registered question generator reading the built graph via `dist/index.js` + `dist/cli.js --json`; mechanical ground-truth derivation per family with `source_ddl_ref`; self-check asserts (5≤N≤10, no leaked answer values); committed the frozen `questions.yaml` + `ground-truth/*.json` + `impact-snippets/*.sql`. `tsconfig.json` gained `"benchmark"` in `include`. |
| `adfc477` | Batch 3: `build-packets.ts` (WITH/WITHOUT prompt packets, identical framing, no key/no DDL/no tool-docs self-check), `score.ts` + `render.ts` (condition-blind driver + results-table renderer), `benchmark/protocols/{with,without}.md`, and `.gitignore` entries for the generated `packets/`/`runs/` working directories. |
| `6be2a2d` | Batch 4: `docs/benchmarks.md` skeleton with all seven required sections in order and the Limitations + no-extrapolation contract drafted **before** any result existed; `docs/stories/07-quality-publication.md` US-035 reconciliation; `test/benchmark/independence.test.ts` proving no vitest suite reads `benchmark/runs/` or triggers a run. |
| `84267bb` | Batch R (orchestrator-run, not an apply task): executed the WITH/WITHOUT protocol per question via isolated sub-agents on the torture fixture, scored blind, and filled `docs/benchmarks.md` Results + Run notes + Environment faithfully — including the unfavorable headline, the root-cause finding, the circularity note, and the round-1 incident. |

Task completeness: 29/29 apply tasks (Batches 1–4) + 8/8 Batch-R tasks (R.7 deliberately SKIPPED, see
below) = 37/37 checkboxes complete. The Definition of Done roll-up lines remain `[ ]` by the project's
own convention (they are traceability summaries, not tasks).

---

## Validation (as measured by sdd-verify, re-confirmed at archive)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (strict, no `any`) | PASS — exit 0, clean |
| `npm run lint` (`eslint .`) | PASS — 0 errors / 0 warnings |
| `npm test` (`vitest run`) | PASS — 3004 passed across 175 files, ZERO benchmark artifacts (`benchmark/runs/`, `benchmark/packets/` gitignored and empty per `git ls-files`) |
| `test/benchmark` subset re-run | PASS — 46 passed (scorer + independence tests) |
| Scorer re-execution on committed run | PASS — re-scored `aggregate.json` byte-identical to the committed one, matches `docs/benchmarks.md` exactly |
| Ground-truth regeneration from a fresh torture-built graph | PASS — `questions.yaml`, `ground-truth/`, `impact-snippets/` all byte-identical to committed |
| Root-cause claim (code-level) | VERIFIED TRUE — `src/core/present/explore.ts` reads `node.payload` only for the `hasDynamicSql` flag; never renders column type/nullability/PK-FK membership |
| view-dependency exclusion (code-level) | VERIFIED TRUE — `src/adapters/engines/sqlite/capabilities.ts` declares `supportsDependencyHints=false`; genuinely uninstantiable on SQLite, not a suppressed result |

Spec compliance: 20/20 scenarios COMPLIANT across the 6 requirements of `benchmark` (dual-substrate
reproducibility, mechanically-derived question set, condition-symmetric protocols, blind deterministic
scoring, honest limitations-alongside-results reporting, `npm test` independence).

---

## Headline Result — reported exactly as measured (unfavorable, not softened)

On the committed SQLite torture fixture (run `torture-2026-07-06`, N=5, one model family):

| Family | WITH accuracy | WITHOUT accuracy | WITH tokens | WITHOUT tokens |
|--------|---------------|-------------------|-------------|-----------------|
| fk-path | 0% (0/1) | 100% (1/1) | 36467 | 26693 |
| column-type (control) | 0% (0/1) | 100% (1/1) | 102282 | 26686 |
| impact | 100% (1/1) | 0% (0/1) | 41660 | 26694 |
| trigger-inventory | 100% (1/1) | 100% (1/1) | 30273 | 26704 |
| constraint-semantics | 0% (0/1) | 100% (1/1) | 82643 | 26665 |
| **Overall** | **40% (2/5)** | **80% (4/5)** | 293325 | 133442 |

**WITH lost, 40% vs 80%, while spending 2.2x the tokens.** This is exactly what the honesty contract
(spec + `docs/benchmarks.md` §Limitations, §No extrapolation) requires: the number is scoped to *this
fixture, this question set, this model*, no generalized superiority claim is made, and the loss is
stated in the Results table and in prose, not buried or explained away.

### Root-cause product finding (the substantive output of this change)

The benchmark's most useful result is not the number itself but WHY dbgraph lost: **`explore` and
`query` never render node payloads.** `src/core/present/explore.ts`'s `formatExplore` renders the
header, neighbor groups, `bodyHash`, level, and a `hasDynamicSql` warning — it touches `node.payload`
ONLY to read that one boolean flag. It never surfaces column type, nullability, or PK/FK column
membership, even though the graph stores those exact facts (the ground truth itself was mechanically
derived from those same payloads via the store API). `src/cli/format/query.ts` returns hits carrying
only `kind`/`qname`/`id`/`score` — no payload at all. This is precisely why the WITH agents lost on
`column-type`, `constraint-semantics`, and `fk-path` (all three exhausted every `--detail` level and
still couldn't retrieve the field), and why the two WITH wins came from `affected --json` — the one
command that already returns structured facts instead of formatted text.

**Recommended follow-up (out of scope for this change, product work for a future change):**
render node payloads in `explore` output, and/or give `query`/`explore` a `--json` "detail" view that
exposes column type/nullability/PK-FK membership directly. Until that ships, the graph's exactness is
stored but not reachable by an agent through the CLI — the gap this benchmark exists to surface.

**Second product follow-up (separate, smaller in scope):** SQLite view-dependency extraction. The
`impact` family's ground truth is dbgraph's own `affected --json whatToTest`, and on SQLite the adapter
declares `supportsDependencyHints=false`, so that key cannot include view/trigger dependents. The
WITHOUT agent's answer (which listed the two views + the INSTEAD OF trigger) was scored incorrect
against that incomplete key — a concrete instance of the shared-extraction-circularity limitation the
report names. Extending SQLite view-dependency extraction would improve both `affected`'s real output
and the fairness of this benchmark family.

---

## Issues Found — accepted as-is (both WARNINGs, artifact-consistency only)

**W1 — empty `promptSha256` in raw run records (accepted).** Design (Persistence) and task R.4 specify
a populated `promptSha256` per raw record so verify can corroborate that no ground-truth text entered
any prompt. The committed raw records under `benchmark/runs/torture-2026-07-06/raw/` (gitignored,
working artifacts) leave this field empty. The no-leak guarantee is NOT lost: per-packet hashes ARE
present in `benchmark/packets/manifest.json`, and `build-packets.ts` enforces the no-key/no-DDL/no-
tool-docs self-check at BUILD time (before any prompt is ever sent). This affects gitignored working
artifacts only, not the committed pre-registered set or the report. Accepted without a fix.

**W2 — stale N=6 wording in `tasks.md` (accepted).** `tasks.md`'s RESOLVED block and tasks 2.4/4.2
describe six instantiated families (including `view-dependency`) and an N of ~6. The actual delivered,
committed set is **N=5** — `view-dependency` yields no candidates on the SQLite substrate because the
adapter declares `supportsDependencyHints=false` (US-007), so the family enumerator is present and
correct but produces nothing here. This is honestly reconciled in `benchmark/questions.yaml`'s header
(`familiesExcluded: [view-dependency]` with an explanatory note) and in `docs/benchmarks.md` §N. N=5 is
within the spec's fixed 5–10 bound and passes `generate.ts`'s hard assert — not a spec or honesty
violation, just stale wording left in the planning artifact. Accepted without a fix; `tasks.md` travels
into the archive as-is (an audit trail, not corrected retroactively).

**Suggestions (follow-up, not required before archive):**
1. Harness hardening: `build-packets.ts` should assert the emitted DDL dump covers every question's
   target object against `ground-truth`'s `source_ddl_ref` — this would have caught the round-1
   wrong-DDL incident (below) automatically instead of by manual cross-check.
2. Product follow-up: render node payloads in `explore`/`query --json` (see Root-cause finding above) —
   belongs to a later change (US-036+), not this one.

---

## Round-1 Incident (protocol integrity — recorded, not hidden)

During Batch R execution, the first WITHOUT round was **invalidated and discarded**: the orchestrator
invoked the packet-builder with a POSIX-style path on Windows, and the embedded DDL dump did not match
the actual target database (MSYS path-mangling is implicated — the same session saw two agents hit
MSYS path issues on their first CLI calls). This was caught by cross-checking the WITH agents' live
tool outputs against the WITHOUT packet's DDL content, not by an automated assertion. Remediation:
packets were rebuilt using a native Windows path, the dump was re-verified against the live database,
and the WITHOUT round was re-run cleanly. The WITH round was unaffected — those agents were hitting the
real graph throughout, confirmed by re-executing their recorded commands. Round-1 WITHOUT transcripts
were discarded; only the corrected round is committed under `benchmark/runs/torture-2026-07-06/`. This
incident is documented in `docs/benchmarks.md` §Run notes (item 3) and is the source of Suggestion 1
above.

---

## Deliberate Scope Decisions

- **R.7 (secondary mssql run) was deliberately SKIPPED**, per spec permission (Requirement 1 makes the
  secondary substrate optional corroboration only). Recorded in `tasks.md` (annotated SKIPPED) and in
  `docs/benchmarks.md`'s Environment row + Run notes. Rationale: the primary finding (the CLI
  presentation layer never surfaces payloads) is CLI-surface-level and engine-agnostic — a secondary
  run against the mssql graph would not have changed that finding, so it was not run this cycle. This
  is a scope decision, not a defect.

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|-----------------|
| `benchmark` | **New capability** — promoted essentially as-is from the change's full spec (not a delta) | `openspec/specs/benchmark/spec.md` |

### Promotion detail — benchmark

`benchmark` had no prior canonical spec — this is a brand-new capability directory. Followed the same
promotion precedent applied to `binary-distribution` (`2026-07-06-phase-9.5c-binaries`), itself
following `cli-config` (`2026-06-17-phase-4-cli-config`) and `connectivity`
(`2026-06-18-connectivity-strategies`): the ONLY change made at promotion time is stripping the
change-suffix from the title — the body carries over unchanged, including the "HONESTY IS THE
CONTRACT" provenance blockquote in the Purpose section.

- Title changed from `# Benchmark Specification (new — phase-benchmark)` to `# Benchmark
  Specification`.
- The "HONESTY IS THE CONTRACT" blockquote (the spec's load-bearing anti-overclaiming statement) was
  KEPT verbatim.
- No other structural change was made — the diff between the change-folder source and the new
  canonical file is exactly the one title line (confirmed via `diff`).

---

## Archive Contents (current location, PRE-MOVE)

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `design.md` | Present (15 architecture decisions; reproducible-first dual-substrate approach) |
| `tasks.md` | Present (37/37 task checkboxes `[x]`; R.7 annotated SKIPPED; N=6 wording left stale — W2, accepted) |
| `specs/benchmark/spec.md` | Present (full spec, new capability; promoted to canonical, see above) |
| `verify-report.md` | Present (PASS, 0 CRITICAL / 2 WARNING / 2 SUGGESTION, 3004 tests) |
| `archive-report.md` | This file |

**GOTCHA (same as prior archives)**: `verify-report.md` and `archive-report.md` are UNTRACKED in git. A
plain `git mv` only relocates TRACKED files — the two untracked `.md` files must be explicitly
`git add`-ed after the move (along with the whole destination folder) or they will not be picked up as
renames and will look like unrelated new files rather than travelling with the change.

---

## Closing Steps

```bash
cd "C:\Users\ecardoso\dev\dbgraph"

# 1. Move the change folder (git mv only relocates TRACKED files)
git mv openspec/changes/phase-benchmark openspec/changes/archive/2026-07-06-phase-benchmark

# 2. Pick up the untracked files (verify-report.md, archive-report.md) at their new path
git add openspec/changes/archive/2026-07-06-phase-benchmark

# 3. Add the new canonical spec
git add openspec/specs/benchmark/spec.md

# 4. Confirm nothing remains at the old path
git status

# 5. Re-confirm the local gate is green on closeout
npx tsc --noEmit
npm run lint
npm test

# 6. Single conventional commit (no PR, no push, no gh, no AI attribution)
git commit -m "chore(sdd): archive phase-benchmark; promote benchmark canonical spec (US-035)"
```

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (4 batches, commits `929367b` + `5d2e2ef` + `d438dbe` + `adfc477`
+ `6be2a2d`) → RUN (Batch R, commit `84267bb`) → VERIFY (PASS, 0C/2W/2S) → **ARCHIVE (complete)**.

Next recommended: a follow-up change (US-036+) to render node payloads in `explore`/`query --json` —
the substantive product gap this benchmark surfaced — and, separately, SQLite view-dependency
extraction to improve both `affected`'s real output and the `impact`/`view-dependency` benchmark
families.
