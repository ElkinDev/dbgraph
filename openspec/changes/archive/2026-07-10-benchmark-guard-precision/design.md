# Design: Benchmark Guard Precision

## Context

Two honesty guards in the benchmark harness abort with false positives against HEAD `2f3c393`,
blocking RUN 3 (N=6). Both were verified in the code during planning:

- **Gap 1** — `benchmark/generate.ts:444-456` `assertNoAnswerLeak` uses `haystack.includes(needle)`.
  For `view-dependency-active_departments`, question text = `"Which tables or objects does the view
  active_departments read from (its direct dependencies)?"`; `answerTokens` includes `departments`
  (confirmed in `test/benchmark/generate.test.ts:71` — `active_departments` depends on
  `main.departments`, `main.employees`). `"active_departments".includes("departments")` is TRUE →
  false-positive abort.
- **Gap 2** — `benchmark/harness-checks.ts:64-68` `deriveCoverageTargets` impact branch emits
  `{kind:'table', name}` for every `whatToTest` entry; `verifyDumpCoverage` (lines 113-124) matches by
  `kind:name`. A trigger named `X` yields target `table:X`, but the dump defines `trigger:X` →
  reported missing → `build-packets.ts:341-346` exits 1.

## Constraint that shapes the design: the import seam

`test/benchmark/independence.test.ts` enforces
`STAGE_RE = /benchmark[\\/](?:generate|build-packets|score|render)\.(?:ts|js)/` — NO vitest suite may
import those four dev-stage entrypoints. `harness-checks.ts` deliberately does NOT match `STAGE_RE`; it
is the PURE, I/O-free seam whose helpers the dev stages CALL and the units IMPORT (benchmark-harness-
hardening, Decision 1). Therefore BOTH fixes' pure logic MUST live in `harness-checks.ts` so they can be
unit-tested under STRICT TDD. `generate.ts` cannot host a testable predicate — it can only WIRE to one.

## Decision 1 — Gap 1: `occursStandalone` in `harness-checks.ts`, wired into `generate.ts`

Add an exported pure helper to `harness-checks.ts` and call it from `assertNoAnswerLeak` in place of
`.includes`. Alphanumeric-adjacency semantics, deliberately NOT `\b` (see Rejected alternatives).

```ts
// benchmark/harness-checks.ts — new export
const LEAK_FLANK_RE = /[a-z0-9_]/;

/**
 * True iff `needle` occurs in `haystack` as a STANDALONE token — an occurrence NOT flanked, on
 * either side, by an alphanumeric-or-underscore character. Project alphanumeric-adjacency convention
 * (NOT a `\b` regex): the needle is matched as a LITERAL string via indexOf, so answer tokens holding
 * punctuation (dots, commas, parens — e.g. a composed FK path) are never treated as a pattern. Every
 * occurrence is scanned: a token embedded in one place AND free-standing in another still leaks.
 * Case-insensitive (lowercases both sides).
 */
export function occursStandalone(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  for (let from = 0; ; ) {
    const at = h.indexOf(n, from);
    if (at === -1) return false;
    const before = at > 0 ? h[at - 1]! : '';
    const after = at + n.length < h.length ? h[at + n.length]! : '';
    if (!LEAK_FLANK_RE.test(before) && !LEAK_FLANK_RE.test(after)) return true;
    from = at + 1; // keep scanning; overlapping/repeat occurrences allowed
  }
}
```

```ts
// benchmark/generate.ts — assertNoAnswerLeak, single line changed (import added at top)
import { occursStandalone } from './harness-checks.ts';
// ...
if (needle.length >= 2 && occursStandalone(haystack, needle)) {
  throw new Error(
    `SELF-CHECK FAILED: answer value "${token}" leaks into the question text of ${q.qid} (D5 leakage guard).`,
  );
}
```

The `needle.length >= 2` floor and the error message are UNCHANGED. `haystack`/`needle` are already
lowercased in `assertNoAnswerLeak`; `occursStandalone` lowercasing again is idempotent, keeping the
helper self-contained for its unit test.

**Non-breaking proof (Gap 1).** The new predicate flags a STRICT SUBSET of `.includes` matches: it
still flags every standalone occurrence, and only STOPS flagging occurrences embedded inside a larger
identifier (which are not readable as the answer, hence not real leaks). The frozen N=5 set generated
successfully under the old `.includes` — meaning no answer token was even a substring of its question —
so every token still returns `false` under the stricter check. Outcome for the frozen set is identical;
only the previously-blocked `active_departments` case flips from false-abort to pass.

## Decision 2 — Gap 2: `kind:'any'` sentinel + name-only branch in `verifyDumpCoverage`

Extend `ObjectKind` with a kind-agnostic sentinel; emit it for impact targets; teach
`verifyDumpCoverage` to match `'any'` by name while concrete kinds keep exact `kind:name` matching.

```ts
// benchmark/harness-checks.ts
export type ObjectKind = 'table' | 'view' | 'trigger' | 'any'; // 'any' = kind-agnostic (name-only)

// deriveCoverageTargets, impact branch ONLY:
case 'impact': {
  // whatToTest may name a table, VIEW, or TRIGGER — match by NAME, kind-agnostic (see spec).
  const names = (gt['whatToTest'] ?? []) as readonly string[];
  return names.map((name) => ({ kind: 'any', name }));
}

// verifyDumpCoverage — build a name-only set alongside the kind:name set:
export function verifyDumpCoverage(
  ddlDump: string,
  targets: readonly CoverageTarget[],
): readonly CoverageTarget[] {
  const defined = new Set<string>();
  const definedNames = new Set<string>();
  for (const match of ddlDump.matchAll(CREATE_OBJECT_RE)) {
    const kind = (match[1] ?? '').toLowerCase();
    const name = normalizeObjectName(match[2] ?? '');
    if (name.length > 0) {
      defined.add(`${kind}:${name}`);
      definedNames.add(name);
    }
  }
  return targets.filter((t) => {
    const name = normalizeObjectName(t.name);
    return t.kind === 'any'
      ? !definedNames.has(name)              // kind-agnostic: name present under ANY kind
      : !defined.has(`${t.kind}:${name}`);   // concrete kind: exact kind:name (UNCHANGED)
  });
}
```

`build-packets.ts` is UNTOUCHED: it already calls `deriveCoverageTargets` + `verifyDumpCoverage` and
renders `${m.kind.toUpperCase()} ${m.name}` → `ANY audit_log` on a miss, which is a bare object
identifier plus a kind label — still leak-safe (no composed answer VALUE).

**Non-breaking proof (Gap 2).** (a) Only the impact branch and the `'any'` filter branch change; fk-path,
trigger-inventory, column-type, constraint-semantics, and view-dependency keep exact `kind:name`
matching byte-for-byte. (b) Frozen run-1/2 impact keys were tables-only: target `any:foo` is covered iff
`definedNames.has('foo')`, and the correct dump defines `table:foo` ⇒ `foo` ∈ `definedNames` ⇒ covered —
same pass as before. (c) No false pass on the correct substrate: SQLite object names are unique across
tables/views/triggers within a schema, so a name present implies the intended object. (d) Wrong-DB miss:
if the name is absent under every kind, `definedNames` lacks it ⇒ still reported missing ⇒ exit 1.

## Rejected alternatives

- **`\b`-anchored regex for the leak guard.** Building `new RegExp(\`\\b${needle}\\b\`)` from an
  arbitrary answer token is unsafe — tokens carry regex metacharacters (dots in qnames, commas/parens
  in composed FK paths), causing pattern injection or wrong matches. It also differs from the project's
  established alphanumeric-adjacency convention. `indexOf` + single-char flank test matches tokens
  literally and is the pinned convention.
- **A `kindAgnostic?: boolean` flag on `CoverageTarget`.** Would keep impact targets as `kind:'table'`
  while carrying a side flag — but the printed kind would then MISREPRESENT a trigger as `TABLE`. The
  `'any'` sentinel is honest in both the type and the failure message.
- **Making `verifyDumpCoverage` family-aware.** It is a pure set-membership function with no family
  input; pushing family knowledge into it breaks its single responsibility. The kind-agnostic signal
  belongs on the TARGET (`deriveCoverageTargets`), which already owns per-family derivation.

## TDD seam & test placement

All new/updated units go in `test/benchmark/harness-checks.test.ts` (imports the pure module — never a
stage). The existing impact assertion (`deriveCoverageTargets('impact-departments', ...)` expecting
`kind:'table'`) is UPDATED to expect `kind:'any'`. New cases: `occursStandalone` positive/negative +
the `active_departments` regression; `verifyDumpCoverage` impact view/trigger positive + wrong-DB
negative; a data-driven regression asserting `occursStandalone` returns `false` for every run-1/2
(question, answerToken) pair (inline literals — no import of `generate.ts`, per the independence guard).

## Requirements traceability

| Spec requirement (MODIFIED) | Scenario | Test |
|---|---|---|
| Question set … machine-checkable ground truth | embedded-identifier NOT a leak | `occursStandalone` — `active_departments` case |
| Question set … machine-checkable ground truth | standalone occurrence still aborts | `occursStandalone` — free-standing token |
| WITHOUT-dump coverage machine-asserted | impact view/trigger covered by correct dump | `verifyDumpCoverage` + impact `kind:'any'` derivation |
| WITHOUT-dump coverage machine-asserted | impact name absent still aborts | `verifyDumpCoverage` wrong-DB negative |
