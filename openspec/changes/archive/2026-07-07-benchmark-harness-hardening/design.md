# Design: Benchmark harness hardening — build-time DDL-coverage assertion + self-contained no-leak audit trail

## Technical Approach

Both fixes are additive validation on existing DEV/orchestrator stages (`build-packets.ts`, `score.ts`) — no
`src`/`dist` touch, zero new deps. The independence guard (`test/benchmark/independence.test.ts`,
`STAGE_RE = /benchmark[\\/](?:generate|build-packets|score|render)\.(?:ts|js)/`) FORBIDS any vitest suite from
importing a stage. So all NEW logic is extracted into a pure, I/O-free module the stages import AND the units
import: `benchmark/harness-checks.ts` (the name matches none of the four stage names, so it is safe to import
from tests). Stages keep their I/O; the module holds the testable decisions.

## Architecture Decisions

### Decision: Pure helper module `benchmark/harness-checks.ts` (three exports, no I/O)

**Choice**: Extract `deriveCoverageTargets`, `verifyDumpCoverage`, `joinManifestHashes` — pure functions, no
`fs`/`crypto`/`Database`. Stages call them; units import the module directly.
**Alternatives considered**: (a) inline the logic in the stages and test via spawning the stage — forbidden by
the child-process + STAGE_RE guards; (b) reuse `score.ts`/`build-packets.ts` names — trips `STAGE_RE`.
**Rationale**: The independence guard mechanically forces the seam. A neutral module name is the ONLY way to
get unit coverage of stage-abort behavior without coupling `npm test` to a run. `answerAtoms`/`assertPacketPair`
stay in `build-packets.ts` (unchanged, out of the new surface).

### Decision: Per-family coverage-target derivation (exact source fields)

**Choice**: Derive schema object identifiers per family from the SAME typed reads `answerAtoms` uses, plus the
table encoded in the qid. Never from `source_ddl_ref` (a `file:line`, not an object).

| Family | Target(s) | Source |
|--------|-----------|--------|
| `fk-path` | `{table, hop.fromTable}`, `{table, hop.toTable}` per hop | `gt.hops[]` |
| `impact` | `{table, name}` per entry | `gt.whatToTest[]` |
| `trigger-inventory` | `{trigger, t.triggerQname}` per trigger | `gt.triggers[]` (no target table in GT) |
| `column-type` | `{table, tableFromQid}` | qid `column-type-<table>.<col>` → strip `<family>-` prefix, take before first `.` |
| `constraint-semantics` | `{table, tableFromQid}` | qid `constraint-semantics-<table>` → strip `<family>-` prefix |
| `view-dependency` | `{view, viewFromQid}` | qid `view-dependency-<view>`; inert (no committed question) |

qid parsing anchors on the KNOWN family (`qid.slice(family.length + 1)`), not a guess — robust to hyphens in
family names. Dependencies (view-dependency answer) are NOT made targets — see Open Questions.

**Alternatives considered**: matching the composed answer atoms — that is the LEAK we forbid; matching columns —
columns are not `CREATE`-defined objects, brittle.
**Rationale**: Reusing the answer-field reads keeps derivation faithful to committed shapes; qid gives the table
for the two families whose answer omits it.

### Decision: Dump-matching = membership in the set of DEFINED objects (not raw substring)

**Choice**: `verifyDumpCoverage` parses the dump's `CREATE (TABLE|VIEW|TRIGGER|INDEX) <name>` statements into a
normalized `Set<"kind:name">`, then a target is covered iff `kind:name ∈ set`. Normalization: strip an optional
`schema.` prefix (`main.`), strip surrounding `"..."`/`` `...` ``/`[...]` quoting, lowercase (SQLite identifiers
are case-insensitive). Extraction regex tolerates `IF NOT EXISTS` and `TEMP`.
**Alternatives considered**: bare `dump.includes(name)` — false-negatives impossible but false-positives on FK
`REFERENCES x` / column names; word-boundary scan of whole dump — still matches references, not just definitions.
**Rationale**: A wrong-DB dump does not DEFINE the target objects even if a name coincidentally appears. Matching
the defined-object set is deterministic (dump is `ORDER BY type,name`), robust to case/quoting (kills the
false-positive risk), and catches the round-1 wrong-DB class. `INDEX` is parsed but never targeted (harmless).

### Decision: `score.ts` manifest join — stamp the FROZEN-packet hash, honest wording

**Choice**: `score.ts` reads `benchmark/packets/manifest.json` (default `join(benchmarkDir, 'packets',
'manifest.json')`, overridable via `--manifest`; the frozen committed manifest — `packets/` is the sibling of
`runs/`). It calls `joinManifestHashes(manifest, rawRecords)` and stamps the authoritative `promptSha256` per
`(qid, condition)` into `scored/per-question.json`. Missing manifest file → throw. Per `(qid, condition)`:
non-empty raw hash ≠ manifest → collect → **fail loudly** (exit 1, all offenders); empty/absent raw hash →
**warn** to stderr (the known W1 state); `(qid,condition)` absent from manifest → fail (cannot stamp an
authoritative value). The stamped value is the SHA-256 of the frozen packet FILE as recorded at build time.
**Alternatives considered**: copy the manifest into each run-dir (duplication, drift); resolve via
`runDir/../../packets` (assumes run-dir depth) — benchmarkDir-relative is depth-independent.
**Rationale**: Defaulting to the frozen manifest deliberately ties scoring to the no-leak-audited packet set.

Exact attestation wording (frozen — the ADR/HONESTY constraint; goes in the `score.ts` comment AND is the
meaning of the field):

> `promptSha256`: SHA-256 of the FROZEN packet file `packets/<qid>.<condition>.md` as recorded in
> `packets/manifest.json` at build time — the no-leak-audited content. It attests WHICH packet content was
> scored for this `(qid, condition)`. It is NOT a receipt that the agent was fed exactly these bytes at run
> time (no fed-prompt hash is captured). A non-empty raw-record hash disagreeing with this value is a loud
> integrity failure.

### Decision: TDD seams + inline fixtures (fixtures/ dir is guard-locked)

**Choice**: RED-first units in `test/benchmark/harness-checks.test.ts` importing ONLY `../../benchmark/harness-checks.ts`.
The poisoned mini-dump (miss case) and mismatched-hash raw record are INLINE `const` literals in the test — NOT
new files under `test/benchmark/fixtures/`, which `independence.test.ts` asserts is EXACTLY the six family
`.json` stubs.
**Rationale**: A new `.json` in `fixtures/` breaks the fixture-set guard; inline literals keep both guards green.

## Interfaces / Contracts (`benchmark/harness-checks.ts` — pure)

```ts
export type ObjectKind = 'table' | 'view' | 'trigger';
export interface CoverageTarget { readonly kind: ObjectKind; readonly name: string; }

/** Derive the schema objects a question's answer depends on. Pure; qid + typed GT only. */
export function deriveCoverageTargets(
  qid: string, family: Family, gt: Record<string, unknown>,
): readonly CoverageTarget[];

/** Return the targets NOT DEFINED in the dump (empty ⇒ full coverage). Pure. */
export function verifyDumpCoverage(
  ddlDump: string, targets: readonly CoverageTarget[],
): readonly CoverageTarget[];

export interface ManifestHashEntry {
  readonly qid: string; readonly condition: 'with' | 'without'; readonly promptSha256: string;
}
export interface RawHashRef {
  readonly qid: string; readonly condition: 'with' | 'without'; readonly promptSha256?: string;
}
export type HashJoinStatus = 'ok' | 'mismatch' | 'empty-raw' | 'missing-in-manifest';
export interface HashJoinResult {
  readonly qid: string; readonly condition: 'with' | 'without';
  readonly authoritativePromptSha256: string | null; // from manifest (null if missing)
  readonly rawPromptSha256: string;                   // '' if empty/absent
  readonly status: HashJoinStatus;
}
/** Join raw hashes to the authoritative manifest hashes. Pure — no throw; caller decides severity. */
export function joinManifestHashes(
  manifest: readonly ManifestHashEntry[], raw: readonly RawHashRef[],
): readonly HashJoinResult[];
```

Stage wiring: `build-packets.ts` main loop, after `assertPacketPair(...)`, adds
`const missing = verifyDumpCoverage(ddlDump, deriveCoverageTargets(q.qid, q.family, gt));` and throws a LOUD
`SELF-CHECK FAILED: <qid> (<family>) — DDL dump does not define target object(s): TABLE <name>, ...` on miss.
The message names only `KIND bare-identifier` (already present in a correct dump) — NEVER a composed key value.
`score.ts` adds `readonly promptSha256?: string` to `RawRecord`, adds `promptSha256: string` to `ConditionResult`,
and stamps the manifest value; `aggregate.json` is untouched (blindness D13 + ADR-008 determinism preserved).

## Data Flow

    build-packets:  gt + qid ─→ deriveCoverageTargets ─┐
                    DDL dump ───────────────────────────┴─→ verifyDumpCoverage ─→ [] ok | [missing] → exit 1

    score:  raw/*.json.promptSha256 ─┐
            packets/manifest.json ────┴─→ joinManifestHashes ─→ mismatch→exit1 | empty→warn
                                                              └─→ stamp authoritative → scored/per-question.json

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `benchmark/harness-checks.ts` | Create | Pure `deriveCoverageTargets` + `verifyDumpCoverage` + `joinManifestHashes` |
| `benchmark/build-packets.ts` | Modify | Import helpers; per-question coverage assertion + LOUD exit-1 on miss |
| `benchmark/score.ts` | Modify | Read frozen manifest; join + stamp `promptSha256`; fail on mismatch, warn on empty |
| `test/benchmark/harness-checks.test.ts` | Create | RED→GREEN units; inline poisoned-dump + mismatched-hash literals |
| `benchmark/ground-truth/*.json`, `questions.yaml` | Unchanged | Read-only source; HARD scope guard |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `deriveCoverageTargets` per family (fk from/to, impact, trigger qname, column-type/constraint table-from-qid) | Inline minimal GT literals mirroring committed shapes |
| Unit | `verifyDumpCoverage` HIT (all defined), MISS (poisoned dump → wrong-DB in unit form), quoted + case-insensitive coverage | Inline mini-dump strings |
| Unit | `joinManifestHashes` ok / mismatch / empty-raw / missing-in-manifest | Inline manifest + raw literals |

Stage-level exit-1 wiring is validated by the orchestrator run (not vitest — the guard forbids importing the
stage); the pure MISS unit IS the wrong-DB regression. Independence guard stays green: tests import only
`harness-checks.ts`, no `child_process`, no `benchmark/runs` read, no `.json` added to `fixtures/`. Test files
must avoid the literal path `benchmark/score.ts` etc. in comments/strings (STAGE_RE scans full file text).

## Open Questions

- [ ] `missing-in-manifest` severity: design defaults to FAIL (cannot stamp an authoritative hash). Confirm vs warn.
- [ ] `view-dependency`: derive only the view from qid (chosen), or also treat `dependencies[]` as targets?
      Moot for the frozen 5-question set (no committed view-dependency question) — decide only if that family is added.
