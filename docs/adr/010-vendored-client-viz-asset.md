# ADR-010: Vendored client-side viz asset (d3-force) — an ADR-007 exception

- Status: Accepted
- Date: 2026-07-07
- Change: graph-viz (Batch 3)
- Supersedes/relates: ADR-004 (hexagonal), ADR-007 (npm supply-chain), ADR-008
  (deterministic indexing), ADR-009 (Node SEA standalone binaries)

## Context

`dbgraph viz` emits ONE self-contained, offline HTML file that runs an interactive
force-directed graph in the browser. It needs a force-layout physics engine on the
CLIENT side. Three ways to get one:

1. **CDN `<script src="https://…d3-force…">`** — violates the hard "zero network at view
   time / air-gap safe" requirement outright. Rejected.
2. **npm `d3-force` dependency** — expands dbgraph's INSTALL-time supply-chain surface
   (the exact ADR-007 concern) for code that only ever runs in the browser and never in
   the dbgraph runtime. Rejected.
3. **In-house Barnes-Hut (~300 lines)** — buys ZERO determinism (ADR-008 explicitly
   excludes the live animation from goldens) while carrying real numerical-stability and
   correctness risk. Effort with no determinism payoff. Rejected.

## Decision

**Vendor** `d3-force` (+ its runtime deps `d3-quadtree`, `d3-dispatch`, `d3-timer`) as
committed static text under `src/cli/commands/viz/assets/vendor/`, and INLINE it into the
emitted HTML at export time. It is a BUILD-TIME / EXPORT-TIME asset embedded in the OUTPUT
html — NOT an npm runtime dependency of dbgraph, NOT in `package.json` dependencies,
NEVER fetched from a CDN.

### Why this does not violate ADR-007

ADR-007 governs the **npm install-time supply chain** — packages pulled by
`npm install @niklerk23/dbgraph`. A vendored client asset that is never installed and
never imported by the dbgraph runtime does not touch that surface. `package.json`
`dependencies` stays exactly `{@modelcontextprotocol/sdk, better-sqlite3}` — ZERO new
runtime dependency. This is a written, scoped exception to ADR-007, not a repeal.

### License — ISC, not MIT (design correction)

The graph-viz design (Q1) assumed these packages were MIT. **They are ISC** (Copyright
2010-2021 Mike Bostock). The vendored files preserve the ISC `LICENSE` text VERBATIM in a
leading block comment plus the upstream `// https://d3js.org/…` attribution line. ISC is a
permissive, MIT-compatible license; the vendoring is licit. `PROVENANCE.md` records the
exact versions and sha256 digests (npm tarballs + upstream `dist/*.min.js`). This ADR
corrects the design's MIT assumption to the verified ISC fact (HONESTY rule).

## Mechanics (how it ships offline everywhere)

The asset files are the reviewable source of truth. A generated TypeScript module
(`src/cli/commands/viz/assets/embedded.generated.ts`, produced by
`scripts/gen-viz-assets.mjs`) embeds each asset as a string constant. `handleViz`
assembles the HTML from those string constants — it does NOT `readFileSync` asset paths at
runtime.

This single mechanism satisfies every distribution channel:

- **`npm test` / dev / tsx** — the constants are plain TS strings, resolved with no
  filesystem access.
- **npm-published `dbgraph` CLI (tsup dist)** — tsup inlines the imported constants into
  `dist`; no separate asset files need shipping (the `package.json` `files: ["dist"]`
  whitelist is unaffected).
- **SEA standalone binary (ADR-009)** — the constants are reachable from `sea-entry.ts →
  cli → dispatch → viz → assets → embedded.generated.ts`, so esbuild **inlines them into
  `build/sea/dbgraph.cjs`** (an "esbuild string-import"). The viz assets therefore ship
  INSIDE the SEA blob and `handleViz` resolves them offline with no disk read. No
  `esbuild-config.mjs` change is required — being in the import graph is sufficient.

A drift-guard test asserts the embedded constants are byte-identical to the on-disk asset
files, so the two never diverge. `npm run bundle:sea` regenerates the embedded module if
an asset changes; the release smoke scans the built bundle for a viz asset marker.

## Consequences

- ZERO new npm runtime dependency; ADR-007 surface unchanged.
- The emitted HTML is fully offline (`file://`, air-gapped) — no CDN, no fetch.
- The live force animation is NOT goldened (ADR-008); only the deterministic embedded
  data block, community assignment, and Mermaid text are pinned.
- Upstream d3 updates are a deliberate, auditable re-vendor (re-run `npm pack`, refresh
  the files + `PROVENANCE.md` sha256s), never a silent `npm update`.
