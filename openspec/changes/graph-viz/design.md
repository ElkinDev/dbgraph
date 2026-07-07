# Design: Graph Viz — self-contained interactive HTML + deterministic Mermaid ER

## Technical Approach

Hexagonal to the letter (ADR-004). A new PURE `src/core/viz/` module owns everything deterministic —
column collapse, seeded community assignment + naming, the byte-reproducible embedded DATA BLOCK, and the
Mermaid ER emitter. The IMPURE HTML shell assembly (read asset files, inline the vendored client sim +
viewer JS/CSS, write the file) lives in a new CLI driving adapter `src/cli/commands/viz.ts`; it imports
ONLY the public barrel (`src/index.ts`) + Node builtins, NEVER `src/adapters/**`. The browser-side force
simulation runs CLIENT-side in the emitted file — dbgraph never launches a browser. A single BULK read
seam on the `GraphStore` port (`getAllNodes`/`getAllEdges`) feeds the exporter in exactly two store calls.
Node-detail text is the SAME `formatObject`/`present/payload.ts` truth that backs `dbgraph object` and
`dbgraph_object` — pre-rendered server-side, no second renderer, no drift (ADR-004 same-source-same-golden).
The deterministic parts are golden-pinnable (ADR-008); the live force ANIMATION is explicitly NOT.

## Architecture Decisions

### Decision (Q1): Vendor d3-force + d3-quadtree as an inlined CLIENT asset — NEW ADR-010

**Choice**: Vendor `d3-force` + `d3-quadtree` (MIT, ~30 KB, zero transitive deps) as committed static text
under `src/cli/commands/viz/assets/vendor/`, inlined into the emitted HTML at export time. It is a
BUILD-TIME/EXPORT-TIME asset embedded in the OUTPUT html — NOT an npm runtime dependency of dbgraph, NOT in
`package.json` dependencies, NEVER fetched from a CDN.

**Alternatives considered**: (a) in-house Barnes-Hut (~300 lines) — rejected: buys ZERO determinism (the
spec + ADR-008 explicitly exclude the animation from goldens) while carrying real numerical-stability /
correctness risk; effort with no determinism payoff. (b) CDN `<script src>` — rejected: violates the
zero-network-at-view-time requirement outright. (c) npm `d3-force` dependency — rejected: it would expand
dbgraph's install-time supply-chain surface (the exact ADR-007 concern) for code that only ever runs in the
browser.

**Rationale (ADR-007 written exception → ADR-010)**: ADR-007 governs the npm INSTALL-time supply chain; a
vendored client asset that is never `npm install`ed and never imported by dbgraph runtime does NOT touch
that surface. Battle-tested MIT layout beats a risky in-house physics engine when the output is not pinned.

**ADR-010 vendoring mechanics** (`docs/adr/010-vendored-client-viz-asset.md` — next free number, 001-009 taken):
- Files: `assets/vendor/d3-force.js` (+ `d3-quadtree.js`), original MIT license header preserved VERBATIM;
  a sibling `PROVENANCE.md` records upstream URL, exact version, sha256, and "vendored, not npm-installed, no CDN".
- Inlining: `dbgraph viz` `readFileSync`s the vendored JS + `viewer.js` + `viewer.css` + `template.html` and
  string-concatenates them into ONE HTML `<script>`/`<style>` payload; the MIT attribution is reproduced as an
  HTML comment in the output. For SEA binaries the asset dir MUST ship inside the SEA blob (ADR-009) — an apply
  concern, flagged below. No CDN, ever.

### Decision (Q2): Bulk-read seam = `getAllNodes()` + `getAllEdges()` on GraphStore, arrays (no streaming)

**Choice**: Add `getAllNodes(): Promise<readonly GraphNode[]>` and `getAllEdges(): Promise<readonly GraphEdge[]>`
to the `GraphStore` port; the SQLite adapter implements each with ONE prepared statement, read-only, deterministic
`ORDER BY` — nodes `ORDER BY qname, id`; edges `ORDER BY kind, src_id, dst_id, id` (extends the existing
`getEdgesFrom` ordering for full determinism). Return in-memory arrays — NO streaming.

**Alternatives considered**: streamed/paged cursor — rejected: the memory math does not demand it (below).
Reusing `getNodesByKind` per kind — rejected: 13 calls + no single edge read; the bulk seam is cleaner and the
spec asks for one bounded pass.

**Memory honesty (ESTIMATE, not measured)**: at ~18.7k nodes, a hydrated `GraphNode` (id 40-hex + a handful of
strings + a parsed `payload` object) ≈ 0.5–1 KB → ~10–19 MB; edges (schema graphs are edge-heavy, `has_column`
dominates, ~2–3× nodes ≈ 40–55k) at ~0.3 KB ≈ 12–17 MB. Peak hydrated set ≈ 30–40 MB — comfortably inside
Node's default heap. Streaming would add complexity for no benefit at this scale. Stated as an estimate per the
HONESTY rule; a bulk-read test records the real numbers on the torture fixture.

### Decision (Q3): Bounded-query ceiling — exactly 2 whole-graph reads, total ≤ 3 store calls

**Choice**: The export issues EXACTLY two whole-graph reads (`getAllNodes` ×1, `getAllEdges` ×1) and NO
per-node/per-edge reads. The command MAY additionally make at most one meta/version read (`schemaVersion`/
`getMeta`) for the HTML header. A counting-store decorator test asserts **total store read calls ≤ 3** and that
`getNode`/`getNodesByKind`/`getEdgesFrom`/`getEdgesTo` are NEVER called (independent of node count — no storm).
Per-node detail text and neighbor grouping are built IN MEMORY from the two bulk arrays.

### Decision (Q4): viz banner line — blessed, description at character index 12

**Choice**: Insert, immediately AFTER the `object` line in `USAGE_TEXT`, the exact line:

```
  viz       Export a self-contained interactive graph HTML (--mermaid ER, --out path, --full all nodes)
```

Verified alignment: `  viz` (2 spaces + `viz`) + 7 spaces → description begins at index 12, matching
`init`…`object`/`mcp`/`install`. Adding it leaves every existing line byte-identical (insertion only). A unit
test pins the line and its `--mermaid`/`--out` mention.

### Decision (Q5): Invalid-combo matrix — hard `ConfigError` (exit 2), per the `parseDetail` precedent

**Choice**: Validate up front and THROW `ConfigError` (exit 2) — never silently coerce or no-op (mirrors
`parseDetail`). `--mermaid` emits a PURE ER diagram, so viewer-shaping flags are contradictory with it.

| Combination | Result | Message (actionable) |
|---|---|---|
| `--mermaid` + `--full`/`--columns`/`--kinds`/`--schema`/`--min-degree` | ConfigError, exit 2 | `--mermaid emits a pure ER diagram and cannot be combined with viewer flag <flag> (drop <flag> or --mermaid).` |
| `--mermaid` + `--out` | OK | writes the ER `.mmd` to `--out` (default: STDOUT) |
| `--full` + `--kinds` | ConfigError | `--full renders every kind and cannot be combined with the --kinds allowlist.` |
| `--full` + `--columns` | ConfigError | `--columns is implied by --full; pass one, not both.` |
| `--min-degree` non-integer / negative | ConfigError | `--min-degree must be a non-negative integer, got "<v>".` |
| `--kinds` unknown kind | ConfigError | `--kinds contains unknown kind "<k>" (valid: <NODE_KINDS>).` |
| `--schema` empty | ConfigError | `--schema requires a non-empty schema name.` |

No new exit code is introduced (established contract; `ConfigError` → 2).

### Decision (Q6): Community naming tie-break — dominant prefix, lexicographic-min tie-break, code-point compare

**Choice**: Assignment is SEEDED LABEL PROPAGATION over stable node-id order (each node starts as its own
label; per round, in stable id order, adopts the most frequent neighbor label, ties → smallest label id;
fixed max rounds → convergence; communities re-numbered 0..k-1 by first appearance). NAME per community:
1. `prefixKey(node)` = `node.schema` when the graph has >1 distinct schema; else the first `_`-delimited token
   of `node.name` (raw token, no case folding) — so single-schema SQLite graphs still get meaningful names
   (`order_items`,`order_lines` → `order`).
2. Name = the prefixKey with the highest member count; ties broken by the LEXICOGRAPHICALLY SMALLEST key using
   CODE-POINT compare (`a < b`) — NOT locale-sensitive `localeCompare` — so the golden is machine-independent.
3. No resolvable prefix → `community-<index>`. No communities at all → viewer colors by `kind` (spec fallback).

A golden snapshot pins community COUNT + per-node MEMBERSHIP + NAMES on the torture fixture.

### Decision (Q7): No formal US — honest user-request record

**Choice**: `grep` of `docs/stories/` finds NO viz story. Recorded honestly: **user-request 2026-07-07, no US**.
`viz` reuses the object/explore payload truth (change `explore-payloads` / US-036 area; US-012/US-021 object/explore),
which the specs already note. No US is invented (HONESTY / config rule satisfied by explicit absence).

### Decision (Arch): Pure core vs impure HTML assembly; assets are FILES, not a core template string

**Choice**: `src/core/viz/` is 100% pure/deterministic (core-only imports, no I/O, ADR-004): `collapse`,
`community`, `neighbor-index`, `graph-data` (the embedded block, incl. per-node detail text via `formatObject`),
`mermaid`. The interactive viewer (`viewer.js`/`viewer.css`/`template.html`) + vendored d3 live as REAL asset
FILES under `src/cli/commands/viz/assets/`; the CLI command reads + inlines them.

**Rationale**: client-side browser code is not core domain logic — embedding it as a giant template literal
inside pure core would pollute the layer ADR-004 keeps infrastructure-free; asset files stay lintable/reviewable
and keep the vendored d3 an honest committed artifact with its license header. HTML assembly needs `readFileSync`
(I/O) → belongs in the driving adapter, not core.

### Decision (Arch): Collapse pre-filtered at export; interactive filters client-side; detail text pre-rendered server-side

**Choice**: (1) Column-COLLAPSE (default) and the CLI shaping flags `--schema/--min-degree/--kinds/--columns/--full`
PRE-FILTER the embedded node set AT EXPORT (server-side) — this is what keeps the default file small. (2) The
sidebar community/kind/degree TOGGLES filter VISIBILITY client-side over the already-embedded set (no re-export).
(3) The per-node DETAIL text is pre-rendered server-side by the EXISTING `formatObject(view, 'full')` (columns +
constraints + indexes + triggers) — the client injects the ready string into a `<pre>`; NO client payload renderer.

Crucially, the neighbor index + detail text are built from the FULL node/edge set even when the VISIBLE graph is
collapsed, so a collapsed table's panel still shows its COLUMNS section (byte-identical to `dbgraph object <qname> --detail full`).

**Data-size honesty (ESTIMATES)**: default collapsed structural set (~1–2k nodes) as minimal JSON ≈ 150–300 KB;
per-node detail text (`object` full ≈ 700 chars × ~2k) ≈ ~1.4 MB; + ~30 KB vendored d3 + viewer JS/CSS → default
`graph.html` ≈ 1.5–2 MB. `--full` (18.7k nodes) ≈ ~1.5 MB graph JSON + ~13 MB detail text → ~15 MB — honestly
documented "may be heavy". Rejected alternative: embed STRUCTURED payload + a client formatter mirroring
`renderFocusPayload` — that IS a second renderer (drift risk), which the spec forbids; pre-rendered text wins on
the spec's own "no second renderer" terms.

## Data Flow

```
dbgraph viz [flags]            (CLI adapter: handleViz — validates flags, ConfigError matrix)
   │
   ▼  openConnections → GraphStore
   ├─ store.getAllNodes()   ┐  EXACTLY 2 bulk reads (deterministic order); no per-node storm
   └─ store.getAllEdges()   ┘
   ▼  src/core/viz  (PURE, deterministic — ADR-008)
   collapse(nodes,edges,opts)      → visible structural set (default) | all (--full)
   assignCommunities(nodes,edges)  → {community, name} per node (seeded label-prop)
   buildNeighborIndex(edges,nodes) → in-memory NeighborGroups per node (NO per-node store call)
   buildVizData(...)               → deterministic DATA BLOCK  (nodes/edges/legend
                                      + per-node detail = formatObject(view,'full') — SAME presenter as `object`)
   [--mermaid] emitMermaidER(tables, references) → BYTE-GOLDEN ER text
   ▼  CLI assembly (I/O)
   readFileSync(template.html, viewer.css, viewer.js, vendor/d3-force.js)
   inline(dataBlock + assets)  → ONE self-contained HTML string
   writeFileSync(--out=graph.html)   |   [--mermaid] write .mmd (--out) or STDOUT
   ▼
graph.html  →  opens offline over file://  →  d3-force runs CLIENT-side (never in dbgraph)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/ports/graph-store.ts` | Modify | Add `getAllNodes()` / `getAllEdges()` to the `GraphStore` port |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | Modify | Implement both — 1 prepared stmt each, read-only, deterministic `ORDER BY` |
| `src/core/viz/collapse.ts` | Create | Pure column-collapse (default) / pass-through (--full) + flag pre-filters |
| `src/core/viz/community.ts` | Create | Seeded label propagation + dominant-prefix naming + code-point tie-break |
| `src/core/viz/neighbor-index.ts` | Create | Pure in-memory `NeighborGroups` builder from bulk edges (feeds `formatObject`) |
| `src/core/viz/graph-data.ts` | Create | Deterministic embedded data block (nodes/edges/legend/detail text), stable serialization |
| `src/core/viz/mermaid.ts` | Create | Pure Mermaid ER emitter (tables + `references`, canonical order) |
| `src/core/viz/index.ts` | Create | Barrel: `buildVizData`, `emitMermaidER`, viz types |
| `src/core/index.ts` | Modify | Re-export `core/viz` public API |
| `src/cli/commands/viz.ts` | Create | `handleViz`: flag validation (ConfigError matrix), open store, call core, assemble+write HTML; `--mermaid` path |
| `src/cli/commands/viz/assets/template.html` | Create | Dark-theme HTML shell: canvas/svg, sidebar, detail panel skeleton |
| `src/cli/commands/viz/assets/viewer.css` | Create | Inlined styles (dark theme) |
| `src/cli/commands/viz/assets/viewer.js` | Create | Client wiring: d3-force sim, pan/zoom, search, community/kind/degree toggles, detail-panel `<pre>` injection (NO payload renderer) |
| `src/cli/commands/viz/assets/vendor/d3-force.js` (+ `d3-quadtree.js`) | Create | Vendored MIT, license header preserved verbatim |
| `src/cli/commands/viz/assets/vendor/PROVENANCE.md` | Create | Upstream URL, version, sha256, "vendored, not npm-installed, no CDN" |
| `src/cli/dispatch.ts` | Modify | Register `viz: handleViz` in `COMMAND_TABLE` + import |
| `src/cli/cli.ts` | Modify | Insert the pinned `viz` `USAGE_TEXT` line after `object` |
| `docs/adr/010-vendored-client-viz-asset.md` | Create | ADR-007 exception + vendoring mechanics (Decision Q1) |
| `docs/manual-smoke-viz.md` | Create | Manual browser smoke checklist (no browser automation in `npm test`) |

Test files: `test/core/viz/{community,mermaid,graph-data,collapse,detail-parity}.test.ts` (+ goldens under
`test/core/viz/golden/`), `test/adapters/storage/sqlite/bulk-read.test.ts`, `test/cli/viz/{query-count,offline-scan,usage-banner}.test.ts`,
`test/mcp/viz-not-registered.test.ts` (or extend the registry test).

## Interfaces / Contracts

```ts
// GraphStore port additions (src/core/ports/graph-store.ts)
getAllNodes(): Promise<readonly GraphNode[]>;   // ORDER BY qname, id
getAllEdges(): Promise<readonly GraphEdge[]>;   // ORDER BY kind, src_id, dst_id, id

// src/core/viz public API
export interface VizOptions {
  readonly full: boolean;                 // --full: every kind (heavy)
  readonly columns?: boolean;             // --columns: include column nodes (lighter than --full)
  readonly schema?: string;               // --schema: scope to one schema
  readonly minDegree?: number;            // --min-degree: drop low-degree nodes
  readonly kinds?: readonly NodeKind[];   // --kinds: explicit allowlist
}
export interface CommunityInfo { readonly id: number; readonly name: string; readonly count: number; }
export interface VizNode  { readonly i: number; readonly label: string; readonly kind: NodeKind;
                            readonly community: number; readonly degree: number; readonly detail: string; }
export interface VizEdge  { readonly s: number; readonly t: number; readonly kind: EdgeKind; }
export interface VizGraphData { readonly nodes: readonly VizNode[]; readonly edges: readonly VizEdge[];
                                readonly communities: readonly CommunityInfo[]; }

export function buildVizData(nodes: readonly GraphNode[], edges: readonly GraphEdge[], opts: VizOptions): VizGraphData; // pure, deterministic
export function emitMermaidER(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string;                        // pure, byte-golden
```

The embedded block is emitted as `<script id="dbgraph-data" type="application/json">…</script>` with STABLE
key order + stable node/edge order → byte-identical across runs (ADR-008); extractable by tests without a browser.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit (pure core) | community count + membership + names | seeded label-prop on torture → golden JSON (byte-exact) |
| Unit (pure core) | Mermaid ER | `emitMermaidER` on torture → `golden/mermaid-er.mmd` byte-identical, twice |
| Unit (pure core) | data-block determinism | `buildVizData` on torture twice → byte-identical; === golden |
| Unit (pure core) | collapse transform | columns folded, edges rewired to parent; `--full` pass-through |
| Unit (pure core) | detail-text parity | per-node detail string === `formatObject(view,'full')` (same-source-same-golden) |
| Adapter | bulk seam | `getAllNodes/getAllEdges` deterministic order, read-only (no write verbs), records real node/edge counts |
| CLI (bounded) | query count | counting-store decorator asserts ≤ 3 store reads, exactly 2 whole-graph, no per-node calls |
| CLI (structural) | offline / no-network | grep emitted HTML: no remote `src`/`href`/`@import`/`url(http`/`fetch(`/`import(`/`XMLHttpRequest`; any `http(s)://` is inert data-block text |
| CLI (structural) | data-block extraction | parse `#dbgraph-data` out of the HTML, assert === golden block |
| CLI (security) | secrets/samples absent | export with secret + sampled-value sentinels → grep HTML → both absent |
| CLI (structural) | banner + import boundary | `USAGE_TEXT` viz line pinned at index 12; boundary test: `viz.ts` imports only `src/index.ts` + builtins |
| CLI (structural) | invalid-combo matrix | each contradictory combo → `ConfigError` + exit 2 + exact message |
| MCP | not registered | registry has no `viz` / `dbgraph_viz` tool |
| Manual | live viewer smoke | `docs/manual-smoke-viz.md` checklist (force layout, pan/zoom, search, toggles, detail panel) — NO browser automation in `npm test` |

The live force ANIMATION / pixels are explicitly NOT goldened (ADR-008 honest split) — only the deterministic
data block, community assignment, and Mermaid text are pinned. STRICT TDD applies to everything under `src/core`.

## Migration / Rollout

No migration required. Fully additive. The public API gains `getAllNodes`/`getAllEdges` on `GraphStore` (both
SQLite drivers implement identically — no cross-driver port change) and the `viz` CLI command; no existing
contract changes. The vendored d3 asset adds ZERO npm runtime dependency.

## Open Questions

- [ ] `--columns` vs `--full` exact semantics (columns-only opt-in vs full "everything") — a proposal.md is
      absent from the change folder; confirm the precise flag interaction (and whether `--columns`+`--full`
      is redundant-error or no-op) against the proposal/user before finalizing the invalid-combo matrix.
- [ ] SEA binary packaging (ADR-009): the `assets/` dir (viewer + vendored d3) MUST be embedded in the SEA
      blob so standalone binaries can inline them offline — resolve the asset-bundling mechanism during apply.
- [ ] Confirm the exact vendored d3-force/d3-quadtree upstream version + sha256 to pin in `PROVENANCE.md` at apply time.
