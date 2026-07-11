# Proposal: Sync Honors Configured Extraction Levels

> **PLANNING — proposal only.** No specs/design/tasks yet; a future cycle runs the full pipeline.
> Bug: configured `levels` are parsed but never reach extraction.

## Intent

`dbgraph sync` silently ignores the `levels` block in `dbgraph.config.json`. Two independent breaks compound:

1. `runSync` hardcodes the extraction scope to adapter defaults —
   `const scope = { levels: adapter.capabilities.defaultLevels }` (`sync.ts:99-101`). It never receives or consults
   config levels; `SyncOptions` has no levels field.
2. `openConnections` parses the config — config `levels` IS read (`parse-config.ts:344`) and lands on the resolved
   `DbgraphConfig` — but the function returns only `{ adapter, store }`; the resolved `levels` are DROPPED, never
   threaded into an `ExtractionScope` (`open-connections.ts:184-206`).

For mssql, `defaultLevels` gates bodies OFF for the heavier object types (bodies are level-gated —
`capabilities.ts`: `supportsBodies` "level-gated"). Net effect: a user who sets
`levels: { procedures: "full", functions: "full" }` to capture routine bodies gets metadata regardless — the config
is inert. **Verified live (out-of-repo):** obtaining a full-level extraction required driving the library API
directly, bypassing the CLI, because the CLI path cannot override levels.

## Scope

### In Scope
- Thread resolved config `levels` from `openConnections` → `runSync` → the `ExtractionScope` passed to
  `adapter.extract()` and `normalizeCatalog()`.
- Respect adapter `defaultLevels` ONLY for object types the config leaves unspecified (per-key merge; config wins).

### Out of Scope (non-goals)
- New level values or new object types (`VALID_LEVELS` unchanged).
- CLI flags for levels (config-file only for now).
- Changing any adapter's `defaultLevels`.

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None.

### Modified Capabilities
- `cli-config`: `sync` MUST apply configured `levels` to the extraction scope, falling back to adapter defaults
  per-key only when the config is silent.

**Affected canonical specs:** `openspec/specs/cli-config/spec.md` (primary); `openspec/specs/schema-extraction/spec.md`
(the `ExtractionScope` / `ObjectTypeLevels` reference — likely unchanged).

## Approach

`openConnections` already holds the resolved config; surface `resolved.levels` to the caller (return it, or expose
an `ExtractionScope` builder). `runSync` accepts an optional `levels`/`scope` on `SyncOptions` and merges:
`{ ...adapter.capabilities.defaultLevels, ...configLevels }`. When the config omits `levels` entirely the result is
byte-identical to today — back-compatible. The merge is a pure function, unit-testable in isolation.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/cli/commands/sync.ts` | Modified | `SyncOptions` gains optional levels/scope; merge with defaults; drop the hardcoded scope |
| `src/infra/open-connections.ts` | Modified | Surface resolved `levels` (return value or scope builder) |
| CLI sync wiring (composition root) | Modified | Pass config levels into `runSync` |
| `openspec/specs/cli-config/spec.md` | Modified | Requirement + scenarios: config levels honored; defaults only when silent |

## Size Estimate

**S** — one seam threaded, a per-key merge, a back-compat default, a spec delta.

## Open Questions (for design)

- Where should the merge live — `openConnections` (returns a ready `ExtractionScope`) or `runSync` (receives raw
  config levels)? Hexagonal cleanliness (ADR-004) favors the composition root, but `runSync` owns the scope today.
- Should `openConnections` return the whole resolved config or just `levels`? Minimal keeps the seam tight.
- Interaction with the fingerprint short-circuit: if `levels` change but the DB fingerprint did not, should a level
  change force a re-extract? (Likely yes — a level change alters output — but confirm in design.)

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Higher levels pull large bodies unexpectedly | Low | User explicitly opted in via config; defaults unchanged |
| Level change not reflected until fingerprint moves | Med | Design decision: treat a level change as forcing re-extract, or document `--full` |
| Threading regresses level-less configs | Low | Per-key merge; empty config → defaults, byte-identical |

## Rollback Plan

Revert the `SyncOptions` levels field and the `openConnections` surface change; `runSync` returns to the hardcoded
`defaultLevels`. No storage or schema change.

## Dependencies

- Existing `parseConfig` levels parsing; `ExtractionScope` / `ObjectTypeLevels`; adapter `defaultLevels`.

## Success Criteria

- [ ] A config with `levels: { procedures: "full", functions: "full" }` yields routine bodies through
      `dbgraph sync` — no library-API workaround.
- [ ] A config with no `levels` behaves exactly as today (defaults; goldens unchanged).
- [ ] Per-key: specifying one object type's level leaves the others at their adapter default.
