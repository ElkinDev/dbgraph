# Archive Report — graph-viz

**Change**: graph-viz (dbgraph viz — self-contained offline interactive graph HTML + `--mermaid` ER)
**Branch**: post-v1 (repo dbgraph)
**Artifact store**: openspec (files) — no engram writes
**Archived**: 2026-07-07
**Verdict**: PASS — 0 CRITICAL / 1 WARNING / 3 SUGGESTION (see `verify-report.md`, carried into this archive)

## Shipped Commits

| Commit | Summary |
|--------|---------|
| `a0f54a4` | docs(dog1-calls-edges, graph-viz): add SDD planning (specs, designs, tasks); reconcile dog1 delta inventory — SHARED planning commit (dog1 + graph-viz) |
| `ab6a345` | feat(viz): pure core viz module — collapse, community, data block, mermaid (B1) |
| `16c5a6e` | feat(storage): add bulk read-only whole-graph seam to GraphStore (B2) |
| `3a29207` | feat(viz): dbgraph viz — self-contained offline HTML + --mermaid ER (B3) |
| `a3c08a0` | docs(viz): usage + sensitivity docs and manual browser smoke checklist (B4) |

## Headline

`dbgraph viz` exports a FULLY-OFFLINE interactive graph HTML — canvas force layout, DETERMINISTIC
communities (seeded label propagation + code-point tie-break) with a sidebar legend/toggles, search, and
node-detail panels whose content is BYTE-IDENTICAL to `formatObject` (the same `present/payload.ts` truth
that backs CLI `object` and MCP `dbgraph_object` — no second renderer; 713-char live parity proven for
`main.employees`) — plus a pure deterministic `--mermaid` ER diagram (byte-golden). d3-force/quadtree
(and their transitive dispatch/timer) are VENDORED as inlined client assets (ISC, PROVENANCE.md records
the honest MIT→ISC correction with per-file + tarball sha256, vendored-not-npm-not-CDN) with ZERO new npm
runtime dependency. The assets are EMBEDDED at compile time (string constants pinned byte-identical to
their reviewable on-disk source by a drift-guard) so they ship inside BOTH the npm `dist/` and the SEA
blob and keep the runtime filesystem-free — verified IN-BLOB by building the real 1.29 MB SEA bundle and
grepping the viz markers. The exporter reads the whole graph through a new bulk read-only `GraphStore`
seam with a proven 2-query ceiling (`getAllNodes` ×1 + `getAllEdges` ×1, ≤3 total). The emitted HTML
makes ZERO network requests at view time (own grep: 0 fetch constructs; the 8 `http(s)://` occurrences are
inert d3/attribution text) and embeds ONLY schema identifiers — never connection strings, resolved
secrets or sampled values (confirmed by a live canary planting secret + sample + config-shaped password +
source path, all absent). Columns collapse by default (`--full` opts into the may-be-heavy full graph);
`viz` is a CLI-only human artifact, NEVER an MCP tool (verified against the live registry). Test suite:
3441 passed / 7 skipped (3448); zero existing-golden drift.

## Documented Deviations Accepted (all evaluated SOUND per verify-report.md)

1. **Compile-time embedded assets (`embedded.generated.ts` + `assets.ts`) replace the design's literal
   `readFileSync`** — SOUND and SUPERIOR. The literal mechanism would FAIL in two ship modes: npm dist
   publishes only `dist/` (so asset source files are never shipped → runtime ENOENT) and a no-filesystem
   SEA binary cannot `readFileSync` arbitrary asset paths. Embedding as string constants makes the assets
   ship inside BOTH dist and the SEA blob and keeps the runtime FS-free; a drift-guard
   (`assets-embedded.test.ts`) pins each constant byte-identical to its reviewable on-disk source, so the
   vendored/authored files stay the single source of truth. Satisfies the design INTENT (self-contained,
   offline) better than the literal mechanism — realizes ADR-010's vendored-client-asset intent.
2. **ISC-not-MIT license fact-correction** — CORRECT and HONEST. d3-force/quadtree/dispatch/timer are ISC
   (Copyright 2010-2021 Mike Bostock), not MIT as design Q1 assumed; the design's zero-transitive-deps
   claim was ALSO wrong (d3-force needs quadtree + dispatch + timer). PROVENANCE.md records the correction
   with an explicit HONESTY NOTE, per-file + tarball sha256, and vendored-not-npm-not-CDN; ISC headers are
   preserved verbatim and reproduced in the emitted HTML (verified 9×).
3. **SEA artifact scan deferred to release smoke** — ACCEPTABLE and CLOSED at the artifact level by the
   verifier: the real SEA bundle was built and grepped for the viz markers (`__DBGRAPH_DATA__`,
   `__DBGRAPH_VIEWER__`, `forceSimulation`, `Copyright 2010-2021 Mike Bostock`, `assembleVizHtml` — all
   present). The deferral-to-release-smoke is empirically discharged, not merely source-guarded.
4. **eslint scoping for vendored/browser files** — CORRECT hygiene. `ignores` covers only genuinely
   non-authored artifacts (assets/vendor, `embedded.generated.ts`, dist build coverage); the
   hand-authored `viewer.js` is STILL linted (browser globals + sourceType script), and the
   `src/core` host-independence path-guard is untouched. No hand-authored TS is exempted; lint 0/0 holds.

## Follow-ups Recorded (1 WARNING + 3 SUGGESTION — non-blocking, do NOT gate archive)

- **W1 — Secrets sentinel exercises the env/config surface, not a payload-embed path.**
  `offline-scan.test.ts` 3.6c plants sentinels in `process.env` and asserts absence in the HTML, but the
  exporter never reads `process.env`, so the assertion cannot catch a leak arriving via a NODE PAYLOAD
  (the path that actually reaches the embedded detail text). The scenario wording (present in the
  environment/config during export) MATCHES the test, so it is spec-COMPLIANT — but the guard is an
  env-canary, not a payload-canary. Mitigated by architecture (dbgraph is catalog-only: no row sampling;
  secrets live only in `dbgraph.config.json` env-refs resolved in `openConnections`, never persisted to
  the graph) and by the verifier's stronger live canary (config-shaped password + source path also
  confirmed absent). Recommend a defense-in-depth test injecting a secret-shaped literal into a node
  payload and asserting it is absent from the emitted detail/data block.
- **S1 — `embedded.generated.ts` (38 KB) is script/hand-generated; regeneration is enforced only by the
  drift-guard test.** Add a committed generator (or `package.json` script) so regeneration is reproducible
  and documented, not just asserted.
- **S2 — `neighbor-index.ts` orders neighbor groups with `localeCompare` (to match existing
  `getNeighbors`), whereas community/data-block ordering uses code-point compare for machine-independence.**
  Parity is pinned to `formatObject` on a single fixture (correct today); consider unifying on code-point
  compare if the detail text ever needs cross-locale byte-stability. Inherited from pre-existing code, not
  introduced here.
- **S3 — The `file://` render + interactive UI (force layout, pan/zoom, toggles, node-click) are covered
  ONLY by `docs/manual-smoke-viz.md`** (correct per ADR-008: the animation is deliberately not goldened).
  Consider a lightweight jsdom smoke of `viewer.js` boot (data-block parse + sidebar DOM build) to catch
  client regressions without goldening pixels.

## Specs Synced (3 delta specs → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| `graph-viz` | Promoted (NEW capability) | Delta `specs/graph-viz/spec.md` promoted BYTE-IDENTICAL to the new canonical `openspec/specs/graph-viz/spec.md` (7 requirements, 10 scenarios). Title `# Graph Viz Specification` already matched the canonical `# X Specification` convention — no suffix to strip (mcp-http-transport promotion precedent: delta ≡ canonical). |
| `graph-storage` | Updated | 1 ADDED. `Bulk read-only whole-graph traversal seam` (4 scenarios) appended INLINE at the tail of the `## Requirements` list — this file has NO dated-section precedent (flat inline structure, matching the phase-9.5b driver-agnostic-handle additions). Delta title / `## ADDED Requirements` heading / summary blockquote stripped; the requirement flows in as canonical content. |
| `cli-config` | Updated | 2 ADDED via a DATED sub-section `## Requirements Added by graph-viz (2026-07-07)` (matching this file's connectivity-strategies / ux-observability / http-transport / explore-payloads precedent — header + summary blockquote, no `---` on non-first sections): `viz command exports the graph and honors the exit-code contract` (4 scenarios) and `CLI usage banner documents the viz command with the exact alignment` (2 scenarios). |

## Deferred (Epic Backlog — deep-object-graph)

- The `deep-object-graph` epic (DOG-2/3/4) remains ACTIVE under `openspec/changes/` and is untouched by
  this archive. `graph-viz` was an independent human-facing side channel, not a DOG deliverable.

## Gates (re-confirmed at archive time)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `npx tsc --noEmit` | PASS |
| Lint | `npx eslint .` | PASS — 0 errors / 0 warnings |
| Tests | `npm test` | PASS — 3448 passed / 0 failed (210 files); total matches the 3448 contract exactly. The 7 DBGRAPH_INTEGRATION-gated suites that verify-report saw SKIPPED executed in this environment (node:sqlite available), so the split is 3448 passed / 0 skipped rather than 3441 + 7 — same 3448 total. |

## Next recommended: none — SDD cycle complete for `graph-viz`. W1 + S1–S3 are recorded follow-ups, not blockers. The deep-object-graph epic (DOG-2/3/4) remains the natural next change.
