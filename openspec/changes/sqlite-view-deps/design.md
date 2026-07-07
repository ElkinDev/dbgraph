# Design: SQLite View & Trigger Dependency Extraction

## Technical Approach

Two seams, both reusing proven `_shared/tokenizer-core.ts` primitives (`maskDynamicStrings` +
`bodyContainsRef` presence-gate + `classifyAccess`), mirroring `pg/map.ts` `buildViews`:

1. **Adapter** — new `sqlite/tokenizer.ts` (`sqliteCanonicalize`, `extractTriggerActionBlock`,
   `tokenizeSqliteBody`) wired into `sqlite/map.ts`. `buildRawCatalog` assembles a `potentialDeps`
   candidate list (tables + views, already name-sorted → deterministic); views tokenize their `body`,
   triggers tokenize ONLY the header-stripped `BEGIN…END` action block. Hardcoded `dependencies: []`
   dropped. All edges `confidence:'parsed'`.
2. **Normalize** — `buildFiresOnEdges` resolves the trigger target by ACTUAL node kind (kind-agnostic
   lookup preferring a real node) instead of hardcoded `resolveOrStub('table', …)`.

Bodies are ALREADY in `RawObject.body` at `DEFAULT_LEVELS` — no new query, no re-extraction. SQLite has
no dynamic SQL (no EXECUTE), so — unlike pg/mysql — NO `hasDynamicSql` branch is needed.

## Architecture Decisions

### Decision 1 — Body sources
**Choice**: Reuse existing extraction. `extractViews`/`extractTriggers` already populate `body` from
`sqlite_master.sql` (`SQL_VIEWS`/`SQL_TRIGGERS`, level-gated to `'full'`). No column/query change.
**Rejected**: a new dependency PRAGMA — SQLite exposes none (that is the whole point). **Rationale**:
the raw material is present; only tokenizer wiring is missing.

### Decision 2 — Trigger header-strip (`extractTriggerActionBlock`)
**Choice**: A pure function that (a) builds a string-masked working copy of the trigger SQL, (b) locates
the first `\bBEGIN\b` and last `\bEND\b` on the MASKED copy, (c) slices the ORIGINAL at those offsets so
real identifiers survive for classification. Everything before `BEGIN` (`CREATE TRIGGER … [INSTEAD OF|
BEFORE|AFTER] … [UPDATE OF cols] ON <target> [WHEN …]`) is discarded.
**Rejected**: `split(/\bBEGIN\b/i)` on raw SQL (fragile if `BEGIN` appears in a WHEN-clause literal);
regex-matching the `ON <target>` to blacklist it (misses aliases, brittle). **Rationale**: the ON-target
name MUST NOT reach the tokenizer — L-009 risk #1. Masking-then-slice is robust to WHEN clauses,
`INSTEAD OF`/`BEFORE`/`AFTER`, and `UPDATE OF col-list` because all live in the header. WHEN-clause
subquery refs are conservatively dropped (ADR-007 under-approximation — acceptable).

### Decision 3 — Candidate object set
**Choice**: `potentialDeps` = all tables + all views (mirrors pg `buildPgRawCatalog`). Self-exclusion is
guaranteed by the presence-gate — a view/trigger action body never contains its own qname (pg-proven,
phase-8a lesson). No explicit self-filter, keeping SQLite byte-semantically identical to pg/mysql.
`NEW.`/`OLD.` pseudo-refs are naturally excluded (not catalog objects). **Rejected**: catalog-supplied
dep hints (SQLite has none). **Rationale**: presence-gate + no-self is the battle-tested posture.

### Decision 4 — `buildFiresOnEdges` fix + cross-engine blast radius
**Choice**: Add `resolveTriggerTarget(schema, name, nodeMap, …)` that probes `nodeMap` for an EXISTING
real node across `['table','view']`; only if none exists falls back to `resolveOrStub('table', …)`
(preserving current missing-stub semantics). For a table-firing trigger the resolved node — and thus the
`fires_on` edge id (`edgeId('fires_on', trig, dst, event)`) — is UNCHANGED, so table-triggers stay
byte-identical.
**Rejected**: carrying `kind` from `RawTrigger` (engine-specific, invasive; SQLite `parseTriggerInfo`
cannot cheaply know view-vs-table); "try view first" via `resolveOrStub` (would mint a phantom VIEW stub
for real tables). **Rationale**: fixes the phantom `[table] active_departments` at the shared source with
zero behavior change elsewhere.

**Blast-radius audit (HONESTY)** — every engine's torture trigger AUDITED:
| Engine | Trigger | Fires on | Kind | Golden impact |
|--------|---------|----------|------|---------------|
| pg | `trg_audit_order_update` | `app.orders` | TABLE | none — behavior-preserving |
| mssql | `trg_audit_order_update` | `dbo.orders` | TABLE | none — behavior-preserving |
| mysql | `trg_after_order_update` | table | TABLE (no INSTEAD OF / no view-triggers) | none |
| **sqlite** | `trg_active_dept_instead_insert` | `active_departments` | **VIEW** | **drifts** |
Cross-engine re-bless is EMPTY. Only SQLite exercises a view-targeted trigger today; the fix is a latent
correctness gain everywhere, observable only on SQLite fixtures.

### Decision 5 — Golden / re-bless protocol
**Choice**: ONE deliberate re-bless commit, inventory in the message (explore-payloads discipline).
Confirmed drift (from measured `golden-e2e`: `edgeCount 54→64`, `nodeCount 54→53`, `stubCount 1→0`):
+4 `depends_on` (2 views ×2), +6 `writes_to` (5 emp-triggers→`audit_log`, 1 instead→`departments`),
phantom stub removed. **Rejected**: per-file drip re-bless (obscures the justification). **Rationale**:
every byte change traces to the new edges or the stub removal; L-009 tests pin the EXACT sets first.

### Decision 6 — Capability honesty
**Choice**: Keep `supportsDependencyHints: false` (matches pg/mysql/mongodb — the flag denotes CHEAP
catalog hints, which SQLite lacks; edges are body-derived). Correct the misleading comment in
`capabilities.ts` and the stale blindness notes in `benchmark/generate.ts` (SUBSTRATE NOTE L16-17, inline
L259, YAML string L402) + `questions.yaml` L18. **Rejected**: flipping the flag to `true` (dishonest —
would imply a catalog source that does not exist). **Rationale**: honesty over convenience.

## Data Flow

    sqlite_master.sql (body, already extracted)
        │
   extractViews ─────► tokenizeSqliteBody(body, tables+views) ──► RawDependency[] (depends_on)
   extractTriggers ──► extractTriggerActionBlock(body) ─┐
                                                        └► tokenizeSqliteBody(action, cands) ──► RawDependency[] (writes_to/reads_from)
        │
   buildRawCatalog ──► RawCatalog.objects[].dependencies
        │
   normalize: buildDependencyEdges ──► depends_on / reads_from / writes_to
              buildFiresOnEdges (resolveTriggerTarget) ──► fires_on → real VIEW node (no phantom stub)
        │
   GraphStore ──► getImpact (IMPACT_EDGE_KINDS) ──► runPrecheck.whatToTest (now sees views+trigger)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/adapters/engines/sqlite/tokenizer.ts` | Create | `sqliteCanonicalize` (strip `[]`/`""`/backtick), `extractTriggerActionBlock` (pure header-strip), `tokenizeSqliteBody` (mask→presence-gate→classify, `confidence:'parsed'`) |
| `src/adapters/engines/sqlite/map.ts` | Modify | `buildRawCatalog` builds `potentialDeps`; `extractViews`/`extractTriggers` take candidates, tokenize body / action-block; drop `dependencies: []` |
| `src/core/normalize/reference-resolver.ts` | Modify | `resolveTriggerTarget` kind-agnostic lookup; `buildFiresOnEdges` uses it (cross-engine) |
| `src/adapters/engines/sqlite/capabilities.ts` | Modify | Correct `supportsDependencyHints` comment (body-derived edges) |
| `benchmark/generate.ts`, `benchmark/questions.yaml` | Modify | Correct stale blindness notes; N-change deferred |
| `test/fixtures/sqlite/golden-raw-catalog.json` | Re-bless | Views/triggers gain `dependencies` |
| `test/fixtures/sqlite/golden-e2e.json` | Re-bless | 54→64 edges, 54→53 nodes, stub 1→0 |
| `test/mcp/golden/explore-view.txt` (+ impact/precheck/related/object tool goldens over torture) | Re-bless | View gains neighbors; whatToTest gains dependents |
| `test/adapters/engines/sqlite/*` | Create | L-009 exact src+dst qname edge assertions |

## Interfaces / Contracts

```ts
// src/adapters/engines/sqlite/tokenizer.ts
export function sqliteCanonicalize(rawName: string): string;
export function extractTriggerActionBlock(triggerSql: string): string; // BEGIN..END body, header removed
export function tokenizeSqliteBody(
  body: string,
  deps: readonly { schema: string; name: string }[],
): readonly RawDependency[]; // each { target:{schema,name}, access:'read'|'write', confidence:'parsed' }

// src/core/normalize/reference-resolver.ts
function resolveTriggerTarget( // probes ['table','view'] for a real node, else stubs as 'table'
  schema: string | null, name: string, nodeMap: NodeMap,
  excludedQNames: ReadonlySet<string>, referencedById: string): ResolveResult;
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (pure) | `extractTriggerActionBlock` | header-strip cases: WHEN clause, INSTEAD OF/BEFORE/AFTER, `UPDATE OF cols`, ON-target never in output, `BEGIN`/`END` inside masked literals |
| Unit | `tokenizeSqliteBody` | presence-gate, no-self, string-literal masking (`'employees'` literal → no edge), read/write classification |
| Integration (L-009 exact-set) | torture graph edges | `active_departments`→{`departments`,`employees`}, `employee_summary`→{`employees`,`departments`} (`depends_on`); `trg_emp_*`→`audit_log`, `trg_active_dept_instead_insert`→`departments` (`writes_to`); NEGATIVE: no self, no ON-target `reads_from` leak, exact set only |
| Unit (normalize) | `resolveTriggerTarget` | INSTEAD-OF-view → view node (no `[table]` stub); table-trigger → unchanged edge id |
| Integration | precheck/affected | `whatToTest` for `departments`/`departments.dept_id` now includes dependent views + trigger |
| Determinism (ADR-008) | extract twice | byte-identical `dependencies` ordering (candidates name-sorted) |

## Migration / Rollout

No data migration, no schema/store/query contract change. Reversible: restore `dependencies: []`, revert
`resolveTriggerTarget`, `git revert` the golden re-bless commit. Benchmark N-change (5→6, re-run, new
labeled run) DEFERRED — this change only makes the family instantiable.

## Open Questions

- [ ] Enumerate the exact set of `test/mcp/golden/*` (impact/precheck/related/object tool) over the
      torture graph that drift — audit during apply; re-bless in the single golden commit.
- [ ] Confirm present-layer goldens (`test/core/present/golden/*`) use synthetic PresentView inputs (NOT
      the torture graph) and therefore do NOT drift.
- [ ] Confirm no benchmark test snapshots `generate.ts` output over the torture graph (the enumerator now
      yields view-dependency candidates — comment-only change must not silently move a committed artifact).
- [ ] View→view `depends_on`: `RawDependency.target.kind` is unset → normalizer defaults to `'table'`
      (shared pg/mysql behavior). Torture views depend only on base tables, so no phantom today. Setting
      `target.kind` for view candidates is a latent correctness item — OUT OF SCOPE, note for future.
