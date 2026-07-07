# Tasks: Graph Viz — self-contained interactive HTML + deterministic Mermaid ER

Standing header (every task): STRICT TDD (RED→GREEN→refactor; the failing test PRECEDES the code) for ALL pure code
under `src/core/viz/**` and the storage seam. Hexagonal ADR-004: `src/core/viz/**` is 100% pure/deterministic
(core-types-only imports, NO I/O, NO `src/adapters/**`); the IMPURE HTML shell assembly + `readFileSync`/`writeFileSync`
lives ONLY in `src/cli/commands/viz.ts`, which imports ONLY the public barrel `src/index.ts` + Node builtins. Determinism
ADR-008: golden ONLY the embedded data block, community assignment, and Mermaid text — the live force ANIMATION/pixels
are NEVER goldened. Node-detail text is the SAME `formatObject(view, 'full')` (`src/core/present/object.ts:53`) that backs
`dbgraph object` — NO second renderer, NO drift. Strict TS / NO `any` / `exactOptionalPropertyTypes` (conditional spread
for optional `VizOptions` fields). EXACT / golden-pinned assertions (L-009): `.toStrictEqual` deep-equal + byte-identical
golden compares + `toBe(N)` counts; existence-only `.toBeDefined()` is FORBIDDEN. Golden discipline: `test/core/viz/golden/`
(mermaid `.mmd` + community snapshot + data-block byte-pins) are blessed DELIBERATELY once and re-proven byte-identical on
re-run; a drift is a HARD STOP, never a silent re-bless. Leak-scan active: the emitted HTML embeds schema identifiers ONLY —
NEVER connection strings, resolved secrets, or sampled VALUES. NODE_KINDS/`NodeKind` = `src/core/model/node.ts`; `EdgeKind`
= `src/core/model/edge.ts`. Conventional commits; NO AI attribution; ENGLISH; NO push / PR / gh / tags. The torture fixture
= the SQLite catalog torture graph (~53 nodes / ~64 edges) already used across `test/adapters/engines/sqlite/`.

Baseline (VERIFY before B1): a raw `it(`/`test(` grep yields 3385 literals across 201 files on `post-v1`; the default
`npm test` green count is ~3253 because the `*.integration.test.ts` suites are gated behind `DBGRAPH_INTEGRATION=1` and
skipped, plus a few literals live in prose/regex (3385 raw ≥ 3253 executed — consistent). Apply MUST re-run `npm test`
first, record the ACTUAL green count, and treat it as the FLOOR that only grows (every batch adds tests, never removes).

RESOLVED decisions — apply MUST NOT re-litigate (design Q1–Q7 + three open questions closed as task decisions):
- Q1 — Vendor `d3-force` + `d3-quadtree` (MIT, ~30 KB, zero transitive deps) as committed static text under
  `src/cli/commands/viz/assets/vendor/`, license header VERBATIM, inlined into the emitted HTML at export time. NOT an npm
  dependency, NEVER a CDN. Recorded as NEW `docs/adr/010-vendored-client-viz-asset.md` (ADR-007 exception). In-house
  Barnes-Hut REJECTED (buys zero determinism, adds numerical risk).
- Q2 — `getAllNodes(): Promise<readonly GraphNode[]>` (`ORDER BY qname, id`) + `getAllEdges(): Promise<readonly GraphEdge[]>`
  (`ORDER BY kind, src_id, dst_id, id`) on the `GraphStore` port; SQLite adapter = ONE prepared statement each, read-only,
  in-memory arrays (NO streaming — ~30–40 MB peak at 18.7k is inside the default heap).
- Q3 — The export issues EXACTLY 2 whole-graph reads + AT MOST 1 meta read → total store reads ≤ 3, independent of node
  count; `getNode`/`getNodesByKind`/`getEdgesFrom`/`getEdgesTo` are NEVER called. Proven with a counting-store decorator.
- Q4 — Insert the `viz` line into `USAGE_TEXT` IMMEDIATELY AFTER the `object` line (`src/cli/cli.ts:34`): exactly
  `  viz       Export a self-contained interactive graph HTML (--mermaid ER, --out path, --full all nodes)` — description
  begins at CHARACTER INDEX 12; every existing command line stays BYTE-IDENTICAL (insertion only).
- Q5 — Invalid flag value OR contradictory combination → `ConfigError` (exit 2), never silent coerce/no-op (the
  `parseDetail` precedent; NO new exit code). Matrix pinned in 3.1.
- Q6 — Community ASSIGNMENT = SEEDED label propagation over stable node-id order (own label → adopt most-frequent neighbor
  label per round, ties → smallest label id, fixed max rounds, re-number 0..k-1 by first appearance). NAME = dominant
  `prefixKey` (schema when >1 distinct schema else first `_`-token of `name`), ties → lexicographically smallest key by
  CODE-POINT compare (NOT `localeCompare`). No prefix → `community-<index>`; no communities → viewer colors by `kind`.
- Q7 — No formal US (user-request 2026-07-07); reuses the object/explore payload truth (US-012/US-021 area). Do NOT invent one.
- OPEN-Q1 CLOSED (conservative) — `--columns` = include column nodes but NOT other heavy kinds (lighter than `--full`);
  `--full` = every kind incl. columns; `--full` + `--columns` → `ConfigError` ("`--columns is implied by --full`").
- OPEN-Q2 CLOSED — SEA (ADR-009): the `assets/` dir (viewer + vendored d3 + template) MUST ship INSIDE the SEA blob;
  bundle via esbuild string-import so `readFileSync` resolves from the embedded blob offline (task 3.8).
- OPEN-Q3 CLOSED — pin the EXACT upstream `d3-force`/`d3-quadtree` version + sha256 in `assets/vendor/PROVENANCE.md` (task 3.5).

Per-batch GATE (ALL must pass before the next batch): `npx tsc --noEmit` clean (strict, NO `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) green with the count ≥ the recorded baseline. Every golden-touching
batch ADDITIONALLY re-proves `git diff --exit-code test/core/viz/golden/` EMPTY after a second run (byte-identical, ADR-008).
NO CI for this change — the byte-identical golden gate + the counting-decorator ceiling are the load-bearing safety nets.

## Batch 1: Pure core `src/core/viz/**` — collapse, community, neighbor-index, data-block, detail-parity, mermaid (golden-pinned)

> Satisfies `graph-viz` "embedded graph data is deterministic", "community assignment and naming are deterministic",
> "columns are collapsed by default; the full graph is opt-in", "--mermaid emits a pure deterministic ER diagram", and the
> node-detail-parity half of "viewer provides a sidebar legend, toggles, search, filters and a node-detail panel". 100%
> PURE / deterministic (ADR-004, ADR-008) — NO adapter, NO CLI, NO I/O. Everything here is golden-pinnable.

- [x] 1.1 RED→GREEN `test/core/viz/collapse.test.ts` + `src/core/viz/collapse.ts`: pure `collapse(nodes, edges, opts: VizOptions)` — DEFAULT folds `column` nodes into their parent table/view (rewires `has_column` endpoints to the parent; keeps structural nodes + `references`/`depends_on` edges); `--full` = pass-through (every kind incl. columns); `--columns` = include columns but no other heavy kinds; apply `--schema`/`--min-degree`/`--kinds` pre-filters. EXACT-set: on the torture fixture, default → no top-level `column` node + column edges rewired to parents; `--full` → column nodes present individually. Encode OPEN-Q1 semantics. Spec scenario `graph-viz` "default collapses columns, --full expands them" (vitest). Done: `npm test viz/collapse`.
- [x] 1.2 RED→GREEN `test/core/viz/community.test.ts` + `src/core/viz/community.ts` + `test/core/viz/golden/community-torture.json`: seeded label propagation (Q6) + dominant-prefix naming + code-point tie-break. Assign twice on the torture fixture → IDENTICAL community COUNT + per-node MEMBERSHIP + NAMES, `.toStrictEqual` the blessed golden snapshot (bless deliberately once). Each name derives from its members' dominant schema/table prefix. Spec scenario `graph-viz` "torture-fixture community assignment matches a pinned snapshot" (golden). Done: `npm test viz/community`; golden diff empty on re-run.
- [x] 1.3 RED→GREEN `test/core/viz/neighbor-index.test.ts` + `src/core/viz/neighbor-index.ts`: pure `buildNeighborIndex(edges, nodes)` → in-memory `NeighborGroups` per node built from the FULL bulk arrays (NO per-node lookup), feeding `formatObject`. EXACT-set: a collapsed table's neighbor groups still include its COLUMN members (so its panel keeps the columns section). Spec scenario `graph-viz` "node click shows payload sections matching object" (neighbor-build half, vitest). Done: `npm test viz/neighbor-index`.
- [x] 1.4 RED→GREEN `test/core/viz/graph-data.test.ts` + `src/core/viz/graph-data.ts` + `test/core/viz/golden/data-block-torture.json`: `buildVizData(nodes, edges, opts): VizGraphData` (VizNode `{i,label,kind,community,degree,detail}`, VizEdge `{s,t,kind}`, `communities: CommunityInfo[]`) with STABLE key + node/edge order → serialize twice on the torture fixture → BYTE-IDENTICAL and `.toStrictEqual` the blessed data-block golden (byte-pins). Spec scenario `graph-viz` "same graph yields a byte-identical data block" (golden). Done: `npm test viz/graph-data`; golden diff empty on re-run.
- [x] 1.5 RED→GREEN `test/core/viz/detail-parity.test.ts`: each `VizNode.detail` string === `formatObject(view, 'full')` (`src/core/present/object.ts`) for the same qname over the torture fixture — same-source-same-golden, proving NO second renderer. EXACT-set: `.toStrictEqual` per node (columns/constraints/indexes/triggers sections match `dbgraph object <qname> --detail full`). Spec scenario `graph-viz` "node click shows payload sections matching object" (parity half, vitest). Done: `npm test viz/detail-parity`.
- [x] 1.6 RED→GREEN `test/core/viz/mermaid.test.ts` + `src/core/viz/mermaid.ts` + `test/core/viz/golden/mermaid-er.mmd`: pure `emitMermaidER(nodes, edges)` → tables + FK `references` ONLY, canonical order (entities by qname; relationships sorted deterministically), ZERO JS/deps. Run twice on the torture fixture → BYTE-IDENTICAL to each other AND to the blessed `.mmd` golden. Spec scenario `graph-viz` "mermaid ER matches the torture-fixture golden byte-for-byte" (golden). Done: `npm test viz/mermaid`; golden diff empty on re-run.
- [x] 1.7 GREEN `src/core/viz/index.ts` (barrel: `buildVizData`, `emitMermaidER`, `VizOptions`/`VizNode`/`VizEdge`/`VizGraphData`/`CommunityInfo`) + `src/core/index.ts` re-export; extend `test/core/barrel.test.ts` to pin the new public surface. Done: `npx tsc --noEmit`; `npm test barrel`.
- [x] 1.8 GATE — `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` green (count ≥ baseline) · `git diff --exit-code test/core/viz/golden/` EMPTY on a second run. Prove ADR-004: `src/core/viz/**` imports no `src/adapters/**`, no I/O (extend `test/core/boundaries.test.ts`). Done: all gates green; NO adapter/CLI file touched.

## Batch 2: Storage bulk-read seam — `getAllNodes`/`getAllEdges` on the port + SQLite adapter (ORDER BY pinned, read-only, bounded, driver-agnostic)

> Satisfies `graph-storage` "Bulk read-only whole-graph traversal seam" (all four scenarios). Strictly READ-ONLY,
> deterministic ordering, bounded queries, identical across `better-sqlite3` and `node:sqlite`. The `GraphStore` PORT gains
> two methods; NO other method changes; NO existing storage golden may drift (this is additive).

- [x] 2.1 RED→GREEN `test/core/ports/graph-store.test.ts` (extend/add) + `src/core/ports/graph-store.ts`: add `getAllNodes(): Promise<readonly GraphNode[]>` and `getAllEdges(): Promise<readonly GraphEdge[]>` to the port interface (type-level assertion that an implementer satisfies it). NO other port method touched. Done: `npx tsc --noEmit`; port-shape test green.
- [x] 2.2 RED→GREEN `test/adapters/storage/sqlite/bulk-read.test.ts` (new) + `src/adapters/storage/sqlite/sqlite-graph-store.ts`: implement both with ONE prepared statement each, read-only, deterministic `ORDER BY` — nodes `ORDER BY qname, id`; edges `ORDER BY kind, src_id, dst_id, id`. Over the torture fixture, assert every node + every edge is returned and RECORD the real node/edge counts. Spec scenario `graph-storage` "whole-graph read uses a bounded number of queries" (returns-everything half, vitest). Done: `npm test bulk-read`.
- [x] 2.3 RED→GREEN `test/adapters/storage/sqlite/bulk-read.test.ts` (extend) with a counting-store decorator (introduced here, reused in B3): (a) BOUNDED — reading the whole graph issues EXACTLY 2 prepared-statement executions independent of node count (no N-per-node storm); (b) DETERMINISTIC — two reads of the same persisted graph return identical, stable order; (c) READ-ONLY — no write/DDL/DML verb issued, ADR-004 boundary/read-only test stays green. Spec scenarios `graph-storage` "whole-graph read uses a bounded number of queries" + "bulk read ordering is deterministic" + "bulk read is strictly read-only" (vitest). Done: `npm test bulk-read`.
- [x] 2.4 RED→GREEN `test/adapters/storage/sqlite/bulk-read.test.ts` (extend, `describe.skipIf(!isNodeSqliteAvailable())`): read the SAME persisted graph via `better-sqlite3` and via `node:sqlite` → returned nodes/edges AND their order `.toStrictEqual` across both drivers; assert the `GraphStore` port surface is otherwise unchanged. Spec scenario `graph-storage` "bulk seam is driver-agnostic" (vitest). Done: `npm test bulk-read` (green on Node 22.5+, cleanly skipped below).
- [x] 2.5 GATE — `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` green (count ≥ baseline) · `git diff --exit-code test/golden/` EMPTY (additive seam drifts NO existing storage golden). Done: all gates green.

## Batch 3: CLI `viz` command + HTML assembly — flag matrix, template + vendored d3 inlining, ADR-010/PROVENANCE, structural pins, SEA bundling

> Satisfies `cli-config` "viz command exports the graph and honors the exit-code contract" + "CLI usage banner documents the
> viz command with the exact alignment", `graph-viz` "viz exports one self-contained offline HTML with zero network at view
> time" + "the exported HTML is schema-sensitive but never embeds secrets or sampled values" + "viz is a CLI-only human
> artifact, never an MCP tool", and the Q3 bounded-query ceiling. IMPURE assembly ONLY (ADR-004): `viz.ts` imports the barrel
> `src/index.ts` + Node builtins, NEVER `src/adapters/**`.

- [ ] 3.1 RED→GREEN `test/cli/commands/viz.test.ts` + `src/cli/commands/viz.ts` (`handleViz` flag validation): parse `--out`/`--mermaid`/`--full`/`--columns`/`--schema`/`--min-degree`/`--kinds`; validate up-front and THROW `ConfigError` (exit 2) per the Q5 matrix — `--mermaid`+any viewer flag, `--full`+`--kinds`, `--full`+`--columns`, non-integer/negative `--min-degree`, unknown `--kinds` kind, empty `--schema` — each with its exact actionable message. EXACT-set: each contradictory combo → `ConfigError` + exit 2 + exact message. Spec scenario `cli-config` "invalid flag value or combination exits 2 with an actionable message" (vitest). Done: `npm test commands/viz`.
- [ ] 3.2 RED→GREEN `test/cli/commands/viz.test.ts` (extend) + `src/cli/commands/viz.ts` + assets `src/cli/commands/viz/assets/{template.html,viewer.css,viewer.js}`: on the happy path open the store, call `buildVizData`, `readFileSync` template+viewer+vendored d3, string-concat into ONE self-contained HTML `<script id="dbgraph-data" type="application/json">…</script>` + inlined `<script>`/`<style>` (MIT attribution as an HTML comment), `writeFileSync(--out=graph.html)`, print a one-line confirmation carrying the path, exit 0. Spec scenario `cli-config` "viz writes a self-contained HTML and exits 0" (vitest). Done: `npm test commands/viz`.
- [ ] 3.3 RED→GREEN `test/cli/commands/viz.test.ts` (extend): `--mermaid` path calls `emitMermaidER`, writes the `.mmd` to `--out` (default STDOUT), ZERO JS/deps, exit 0. EXACT-set: output === the B1 mermaid golden text; combining `--mermaid` with a viewer flag already errors (3.1). Spec scenario `cli-config` "--mermaid emits the ER diagram" (vitest). Done: `npm test commands/viz`.
- [ ] 3.4 RED→GREEN `test/cli/dispatch.test.ts` + `src/cli/dispatch.ts` (register `viz: handleViz` in `COMMAND_TABLE` + import) AND `test/cli/cli.test.ts` + `src/cli/cli.ts` (insert the pinned `viz` line AFTER `object` at line 34). EXACT-set: `dispatch('viz')` resolves to the handler; the `viz` line description begins at index 12; every OTHER `USAGE_TEXT` command line is byte-identical to before (insertion-only); dropping the `viz`/`--mermaid`/`--out` mention fails the pin. Spec scenarios `cli-config` "viz banner line is present with the exact aligned text" + "adding the viz line leaves other command lines unchanged" (vitest). Done: `npm test dispatch cli`.
- [ ] 3.5 GREEN `src/cli/commands/viz/assets/vendor/{d3-force.js,d3-quadtree.js}` (MIT header VERBATIM) + `src/cli/commands/viz/assets/vendor/PROVENANCE.md` (upstream URL, EXACT version, sha256, "vendored, not npm-installed, no CDN") + `docs/adr/010-vendored-client-viz-asset.md` (ADR-007 exception + vendoring mechanics, Q1). Extend `test/cli/commands/viz.test.ts` to assert PROVENANCE records a non-empty version + 64-hex sha256 and the vendored files carry the MIT header. Closes OPEN-Q3. Done: `npm test commands/viz`.
- [ ] 3.6 RED→GREEN `test/cli/viz/offline-scan.test.ts` (structural pins): export over the torture fixture, then (a) OFFLINE — grep the emitted HTML for remote `src`/`href`/`@import`/`url(http`/`fetch(`/`import(`/`XMLHttpRequest` → NONE; any `http(s)://` is inert data-block text; (b) DATA-BLOCK — parse `#dbgraph-data` out of the HTML → `.toStrictEqual` the B1 data-block golden; (c) SECRETS — export with a resolved-secret sentinel + a sampled-value sentinel in the environment → grep HTML → BOTH absent, only schema identifiers embedded. Spec scenarios `graph-viz` "emitted HTML fetches nothing at view time" + "same graph yields a byte-identical data block" (CLI extraction half) + "sentinel secret and sampled value never appear in the output" (vitest). Done: `npm test viz/offline-scan`.
- [ ] 3.7 RED→GREEN `test/cli/viz/query-count.test.ts` + `test/cli/boundaries.test.ts` (extend) + `test/mcp/boundaries.test.ts` (extend): (a) the counting-store decorator (from 2.3) asserts the command issues ≤ 3 total store reads, EXACTLY 2 whole-graph, and NEVER `getNode`/`getNodesByKind`/`getEdgesFrom`/`getEdgesTo` — independent of node count (Q3); (b) the boundary test proves `src/cli/commands/viz.ts` imports only `src/index.ts` + Node builtins (no `src/adapters/**`); (c) the MCP registry has NO `viz`/`dbgraph_viz` tool. Spec scenarios `cli-config` "viz honors the CLI import boundary" + `graph-storage` "whole-graph read uses a bounded number of queries" (command ≤3 half) + `graph-viz` "viz is not registered as an MCP tool" (vitest). Done: `npm test viz/query-count boundaries mcp/boundaries`.
- [ ] 3.8 RED→GREEN `test/bin/sea-entry.test.ts` (extend) + the SEA/esbuild asset step: the `viz/assets/` dir (viewer + vendored d3 + template) MUST ship INSIDE the SEA blob (ADR-009) — bundle assets via esbuild string-import so `handleViz`'s `readFileSync` resolves from the embedded blob offline in a standalone binary. EXACT-set: the SEA entry test asserts the viz assets are present in the bundled blob (not read from disk). Closes OPEN-Q2. Done: `npm test sea-entry`.
- [ ] 3.9 GATE — `npx tsc --noEmit` clean · `npm run lint` 0/0 · `npm test` green (count ≥ baseline) · `git diff --exit-code test/core/viz/golden/` STILL EMPTY. Confirm the offline/secrets/query-count/boundary pins all green. Done: all gates green.

## Batch 4: Docs, manual browser smoke checklist, final gate + DoD

> Satisfies the docs half of `graph-viz` "the exported HTML is schema-sensitive but never embeds secrets or sampled values"
> (honest sensitivity statement) and the live-viewer scenarios that CANNOT be automated in `npm test` (documented smoke,
> not asserted). No new production behavior — docs + manual checklist + closeout.

- [ ] 4.1 GREEN `docs/viz.md` (new) + `docs/format-spec.md` (touch): document the export, the filter flags + collapse/`--full` semantics, the determinism split (data/community/mermaid goldened; animation NOT), and the content-sensitivity statement — the file is EXACTLY as sensitive as `.dbgraph/dbgraph.db`, embeds schema identifiers only, NEVER secrets/sampled values (dbgraph-security). Honestly scoped — no invented US (Q7). Done: files present and reviewable.
- [ ] 4.2 GREEN `docs/manual-smoke-viz.md` (new): a manual browser smoke checklist (NO browser automation in `npm test`) covering — file opens over `file://` on an air-gapped machine with force layout + pan/zoom + dark theme; sidebar lists communities with name + count + working visibility toggles; search + kind/degree/schema toggles filter the visible set; clicking a node opens a detail panel whose sections match `dbgraph object <qname>`. Spec scenarios `graph-viz` "file renders offline over file://" + "sidebar lists communities with counts and toggles" + "node click shows payload sections matching object" (UI-click half) (manual-smoke). Done: checklist present and reviewable.
- [ ] 4.3 Final GATE + closeout: `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` green (count strictly ≥ recorded baseline); `git diff --exit-code test/core/viz/golden/` + `test/golden/` EMPTY (byte-identical, ADR-008); confirm ZERO new npm RUNTIME dependency (vendored d3 is an inlined asset, not `package.json` deps), ADR-004 boundary green, `viz` NOT an MCP tool. Done: all gates green.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 1** (1.1–1.8): pure `src/core/viz/**` — `collapse`, `community` (+ golden), `neighbor-index`, `graph-data` (+ byte-golden), `detail-parity`, `mermaid` (+ byte-golden), barrels. NO adapter/CLI, NO I/O.
- **Batch 2** (2.1–2.5): `getAllNodes`/`getAllEdges` on the `GraphStore` port + SQLite adapter (ORDER BY pinned, read-only, bounded ≤2, driver-agnostic) + the counting-store decorator. Additive — no existing golden drifts.
- **Batch 3** (3.1–3.9): `handleViz` (ConfigError matrix), HTML assembly (template/viewer/vendored d3 inline), `--mermaid` path, dispatch + banner pin, ADR-010 + PROVENANCE, offline/data-block/secrets structural pins, query-count ≤3 + import boundary + viz-not-MCP, SEA asset bundling.
- **Batch 4** (4.1–4.3): `docs/viz.md` + format-spec + security statement, the manual browser smoke checklist, final gate + DoD.

### Dependency bottlenecks

- **Batch 1 gates Batch 3.** `buildVizData` (1.4) + `emitMermaidER` (1.6) + the data-block/community/mermaid goldens are what B3's HTML assembly (3.2) inlines and what the offline-scan (3.6) and `--mermaid` (3.3) pins compare against. B3 cannot start until the core public API + goldens are frozen.
- **Batch 2 gates Batch 3.** `handleViz` (3.2/3.7) calls `getAllNodes`/`getAllEdges` and the query-count ceiling (3.7) reuses the counting-store decorator introduced in 2.3. The seam shape + decorator must land first.
- **1.5 (detail-parity) is load-bearing for the "no second renderer" contract** — it pins each `VizNode.detail` === `formatObject(view, 'full')`; if the core detail string drifts from `dbgraph object`, the whole same-source-same-truth guarantee (and success criterion 4) fails. It depends on 1.3 (neighbor-index feeds `formatObject`).
- **3.5 (PROVENANCE version/sha) + 3.8 (SEA bundling) are the two apply-time OPEN questions** — the exact vendored d3 version/sha256 (OPEN-Q3) and the esbuild string-import asset embedding (OPEN-Q2) are resolved DURING B3 apply; a mistake here silently breaks offline rendering inside standalone binaries. Flag if the SEA blob cannot embed the asset dir.
- **The live force ANIMATION is NEVER goldened** — B4's manual smoke (4.2) is the ONLY coverage for the interactive UI (force layout, pan/zoom, toggles, node click); `npm test` asserts the deterministic data/community/mermaid ONLY. Do not attempt to automate the animation.

## Definition of Done (tied to the proposal's Success Criteria)

- [ ] `dbgraph viz` writes ONE self-contained HTML (all JS/CSS inline, ZERO network at view time) that opens over `file://` with force layout, pan/zoom and dark theme. — Batch 3 (3.2, 3.6), Batch 4 (4.2 manual)
- [ ] Nodes are colored by COMMUNITY (fallback `kind`); the sidebar legend lists community name + count with per-community visibility toggles. — Batch 1 (1.2), Batch 4 (4.2 manual)
- [ ] Search + kind/degree/schema filters + column-collapse keep the ~18.7k graph usable; the full graph is explicit opt-in (`--full`), honestly documented. — Batch 1 (1.1), Batch 3 (3.1), Batch 4 (4.1, 4.2)
- [ ] Clicking a node opens a detail panel whose content MATCHES `dbgraph object <qname>` (same `formatObject` source, no second renderer). — Batch 1 (1.5), Batch 4 (4.2 manual)
- [ ] Community ASSIGNMENT + the embedded data block + `--mermaid` output are byte-deterministic and golden-pinned; the live animation is NOT goldened (ADR-008 split). — Batch 1 (1.2, 1.4, 1.6), Batch 3 (3.6)
- [ ] `dbgraph viz --mermaid` emits a valid deterministic ER diagram (tables + FKs). — Batch 1 (1.6), Batch 3 (3.3)
- [ ] The generated file embeds NO connection strings/secrets/sampled values; docs state it is as sensitive as the graph DB. — Batch 3 (3.6), Batch 4 (4.1)
- [ ] The `GraphStore` bulk read is strictly read-only (ADR-004 boundary green), bounded (≤2 whole-graph, ≤3 total store calls), driver-agnostic; `viz` is NOT registered as an MCP tool. — Batch 2 (2.3, 2.4), Batch 3 (3.7)
- [ ] Vendored `d3-force`/`d3-quadtree` are inlined assets (ADR-010, PROVENANCE version+sha256) with ZERO new npm runtime dependency, shipped inside the SEA blob for offline standalone binaries. — Batch 3 (3.5, 3.8)
- [ ] `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0/0; `npm test` green with count strictly ≥ the recorded baseline; all viz + storage goldens byte-identical (ADR-008). — Batch 4 (4.3)
