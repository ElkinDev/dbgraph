# Proposal: Doctor — Dependency Catalog Health Warning

> **PLANNING — proposal only.** No specs/design/tasks yet; a future cycle runs the full pipeline.
> UX/honesty. Cross-references `mssql-dynamic-deps-fallback` (the remedy this warning points to).

## Intent

`dbgraph doctor` today reports only CONNECTIVITY shape — engine, native-driver presence, CLI tools, ODBC, resolved
profile, chosen strategy (`present/doctor.ts`, US-043) — and is content-free by contract. It gives NO signal when
the SQL Server persisted dependency catalog (`sys.sql_expression_dependencies`) is empty or sparse. That is exactly
the condition (see `mssql-dynamic-deps-fallback`) under which `sync` silently produces ZERO dependency edges despite
full module bodies.

**Verified live (out-of-repo):** **0** persisted dependency rows against **~900** modules with definitions — a
silently incomplete graph with no warning. Users have no way to know their dependency graph is blind.

## Scope

### In Scope
- A content-free health signal (doctor and/or sync summary): when modules-with-definitions is high but persisted
  dependency rows are ~0, WARN — e.g. "N modules with definitions but 0 dependency rows; your dependency graph is
  likely incomplete — recompile modules or enable the dynamic-TVF fallback."
- COUNTS ONLY — no schema names, object identifiers, or bodies (doctor's content-free contract, US-043).
- Reference the `mssql-dynamic-deps-fallback` remedy in the message.

### Out of Scope (non-goals)
- Implementing the fallback itself (that is `mssql-dynamic-deps-fallback`).
- Any content-bearing output (never object names).
- Non-mssql engines (the persisted-catalog concept is SQL-Server-specific).

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None.

### Modified Capabilities
- `connectivity-diagnostics`: `doctor` MAY surface an mssql dependency-catalog-health indicator (counts only),
  preserving the content-free contract.
- `cli-config` (possible): the `sync` summary MAY carry the same warning post-extraction.
- `mssql-extraction` (possible): defines the health metric (modules-with-definitions vs persisted dependency rows).

**Affected canonical specs:** `openspec/specs/connectivity-diagnostics/spec.md` (primary);
`openspec/specs/cli-config/spec.md` and `openspec/specs/mssql-extraction/spec.md` (surface / metric — design decides).

## Approach

Compute two cheap counts — modules carrying definitions, and rows in `sys.sql_expression_dependencies` — and
compare. If definitions are many and dependency rows ~0 (or below a ratio), emit a content-free warning. Extend
`DoctorView` with an optional health field and/or add a line to the sync summary. The metric is a scalar pair; no
content leaves the boundary.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/present/doctor.ts` | Modified | Optional `DoctorView` health field + content-free line |
| `src/cli/format/sync.ts` (option) | Modified | Post-sync warning line when the catalog is empty/sparse |
| mssql adapter / probe | Modified | Two cheap counts (definitions vs dependency rows) |
| `openspec/specs/connectivity-diagnostics/spec.md` | Modified | Scenario: empty catalog → content-free warning |

## Size Estimate

**XS** — two counts, a threshold, one warning line, a content-free assertion test.

## Open Questions (for design)

- Surface: doctor, sync summary, or both? Doctor runs without a full extract; sync knows the post-extraction truth.
- Threshold: strictly 0 rows, or a ratio (rows ÷ modules < X)?
- Which capability owns the metric — `mssql-extraction` (producer) vs `connectivity-diagnostics` (surface)?
- Wording must stay content-free AND actionable — reference recompile + the TVF fallback without naming objects.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Warning leaks content | Low | Counts only; a test asserts NO schema/object/secret in output (mirrors existing doctor content-free tests) |
| False alarm on a legitimately dependency-free DB | Low | Threshold + wording ("likely incomplete"), not an error; never blocks |
| Doctor cannot cheaply get counts without a connection | Med | Gate behind an available connection; otherwise report "not evaluated" |

## Rollback Plan

Revert the `DoctorView` health field and the warning line(s); the connectivity report returns to its current shape.
No storage change.

## Dependencies

- Cross-references `mssql-dynamic-deps-fallback` (the remedy the warning points to). Independent to ship — the
  warning is useful even before the fallback lands.

## Success Criteria

- [ ] With an empty/sparse persisted dependency catalog against many modules, doctor and/or sync emits a
      content-free warning naming the counts and the remedy.
- [ ] A content-free test asserts NO schema name, object identifier, or secret appears.
- [ ] With a populated catalog, NO warning appears.
