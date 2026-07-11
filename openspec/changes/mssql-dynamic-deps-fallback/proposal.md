# Proposal: MSSQL Dynamic Dependency Fallback — Per-Object TVF When the Persisted Catalog Is Empty

> **PLANNING — proposal only.** No specs/design/tasks in this change yet; a future cycle runs the full pipeline.
> This is the high-value finding in the improvement backlog. Cross-references `doctor-dependency-catalog-health`.

## Intent

All mssql dependency edges (`calls`, `reads_from`, `writes_to`, `depends_on`) are sourced EXCLUSIVELY from the
persisted catalog `sys.sql_expression_dependencies` (`SQL_MSSQL_DEPENDENCIES`, `queries.ts:350-366`). The body
tokenizer (`tokenizeModuleDeps`, `tokenizer.ts:134-179`) is a CLASSIFIER over those catalog rows — it decides
read-vs-write and flags dynamic SQL, but it NEVER discovers an edge the catalog omitted (the loop at
`tokenizer.ts:144` iterates the catalog `deps`; there is no other source).

That persisted catalog is not always populated. On a restored/redesign-type SQL Server database it can be EMPTY
while every module still carries a full definition. **Verified live (out-of-repo):** the persisted catalog
returned **0 rows** despite **~900 modules** (872 of them stored procedures) with definitions — so `sync` produced
**ZERO** dependency edges. Yet the DYNAMIC catalog function `sys.dm_sql_referenced_entities(obj, 'OBJECT')`
resolved **20/20** sampled modules, and a full per-object scan reconstructed **11,619** dependency edges (**408**
routine→routine `calls`) where sync saw nothing (an 8.29M-token full-extraction dump for scale). The inbound
counterpart `sys.dm_sql_referencing_entities` reads that SAME empty catalog and is therefore BLIND — callers must
be recovered by INVERTING the outbound per-object scan.

Net: on precisely the databases where a dependency graph is most valuable (post-restore/redesign audits) dbgraph
silently returns an empty edge set with no signal.

## Scope

### In Scope
- A per-object dependency FALLBACK for mssql: when the persisted `sys.sql_expression_dependencies` is empty or
  SPARSE relative to module count, reconstruct outbound edges by calling
  `sys.dm_sql_referenced_entities(@object, 'OBJECT')` once per module (mirroring the shipped DOG-3 per-view query).
- Invert the outbound scan to recover inbound `calls` (callers), since the inbound TVF is blind against an empty catalog.
- Feed reconstructed rows through the EXISTING tokenizer classification (read/write, routine→routine `calls`,
  dynamic-SQL honesty) so downstream normalization is unchanged.
- A confidence/labeling decision for fallback-sourced edges (see Open Questions).
- Strategy coverage: native driver + sqlcmd (the TVF is a plain SELECT — verify sqlcmd can carry it); dump family
  degrades by absence, mirroring DOG-3.

### Out of Scope (non-goals)
- A T-SQL grammar parser / body-tokenizing DISCOVERY path — ADR-007 stands; the TVF is the truth source, not text parsing.
- Changing the persisted-catalog path when it IS populated (fallback triggers only on empty/sparse).
- Column-level lineage beyond what DOG-3 already delivers.
- Recompiling or mutating the target database — read-only posture (US-031) is INVIOLABLE.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None.

### Modified Capabilities
- `mssql-extraction`: dependency-edge sourcing gains a per-object TVF fallback when the persisted catalog is
  empty/sparse; the current "does NOT discover new targets absent from that view" contract is relaxed UNDER the
  fallback path only. Confidence labeling for reconstructed edges clarified.
- `connectivity` (possible): document the native-vs-sqlcmd-vs-dump coverage difference for the fallback (mirrors
  DOG-3's first strategy-dependent coverage difference).

**Affected canonical specs:** `openspec/specs/mssql-extraction/spec.md` (primary), `openspec/specs/connectivity/spec.md`.

## Approach

Precedent-driven. DOG-3 already calls `sys.dm_sql_referenced_entities(@view, @class)` once per view, native-driver
only, with a bound `@view` variable, `referenced_minor_id > 0` filtering, per-call try/catch skip, and
degrade-by-absence (`SQL_MSSQL_VIEW_REFERENCED_COLUMNS`, `queries.ts:391-399`). Reuse that pattern at OBJECT grain:
a cheap guard query (persisted row count vs module count) decides fallback activation; sorted iteration over modules
(ADR-008 determinism); a bound `@object` argument (NEVER string interpolation). Reconstructed rows enter
`tokenizeModuleDeps` unchanged; callers come from inverting the outbound edge set in memory. Cross-reference
`doctor-dependency-catalog-health`: the doctor warning should point users at this fallback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/mssql/queries.ts` | Modified | New per-object `dm_sql_referenced_entities(@object,'OBJECT')` query at OBJECT grain |
| `src/adapters/engines/mssql/map.ts` | Modified | Fallback activation guard; per-object loop; invert outbound→inbound callers |
| `src/adapters/engines/mssql/tokenizer.ts` | Reused | Classification unchanged; new source rows flow through it |
| `src/adapters/engines/mssql/strategies/*` | Modified | Carry the fallback SELECT on native + sqlcmd; dump degrades by absence |
| `openspec/specs/mssql-extraction/spec.md` | Modified | New requirement + scenarios for the empty-catalog fallback |

## Size Estimate

**M** — one adapter, new query + activation guard + in-memory inversion, per-strategy coverage, spec deltas, goldens.

## Open Questions (for design)

- Confidence tier for fallback edges: reuse `declared`/`parsed`, or introduce a distinct `reconstructed` tier so
  consumers can distinguish catalog-declared from TVF-reconstructed?
- Activation threshold: empty-only, or a ratio (persisted rows ÷ modules-with-definitions < X)? What X?
- Per-object loop cost on ~900 modules — acceptable within one sync? Batch, or accept the DOG-3 per-call pattern?
- Can sqlcmd carry the TVF SELECT with a bound object argument across the reassembly path (verify vs the profile registry)?
- Does the fallback interact with `has_dynamic_sql` semantics for reconstructed edges?

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Per-object TVF loop slow on large catalogs | Med | Guard activates only when persisted is empty/sparse; single sorted pass; measure |
| TVF raises on an unresolvable module | Med | Per-call try/catch skip (DOG-3 precedent); degrade by absence, never crash |
| sqlcmd cannot carry the TVF | Med | Verify; if not, native-only fallback + documented coverage gap (DOG-3 precedent) |
| Fallback edges mislabeled vs declared | Low | Explicit confidence decision in design; scenario coverage |
| Determinism drift | Low | Explicit ORDER BY; in-memory inversion is deterministic (ADR-008) |

## Rollback Plan

Additive and guarded. Revert by removing the fallback query, the activation guard, and the inversion in `map.ts`;
the persisted-catalog path and all existing goldens remain untouched and green.

## Dependencies

- DOG-3 per-view TVF pattern (shipped) as the template; existing tokenizer classification; ADR-007/008; the
  read-only US-031 write-verb scanner.
- **Predecessor:** DOG-1 `calls` edges are ALSO sourced from `sys.sql_expression_dependencies`, so they are
  likewise ZERO on an empty catalog — the 408 reconstructed routine→routine calls are a subset of the 11,619
  edges this fallback recovers. No shipped DOG child (DOG-1..4) addresses the empty-catalog case.

## Success Criteria

- [ ] When the persisted catalog is empty/sparse, mssql reconstructs outbound dependency edges via the per-object
      TVF; on the verified live shape this yields the ~11,619 edges / 408 calls that `sync` currently misses.
- [ ] Callers (inbound `calls`) are recovered by inverting the outbound scan.
- [ ] Reconstructed edges carry an explicit, documented confidence label; classification is unchanged.
- [ ] Native + sqlcmd carry the fallback (or native-only with a documented coverage difference); dump degrades by absence.
- [ ] When the persisted catalog IS populated, behavior and goldens are byte-identical (fallback dormant).
