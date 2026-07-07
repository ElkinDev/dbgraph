# Proposal: Graph Viz — a self-contained interactive HTML view of the local graph (+ Mermaid ER export)

## Intent

The user has SEEN what they want: a graphify-style picture — force-directed layout, thousands of
nodes, color-coded COMMUNITIES with a toggleable legend/sidebar (community name + count), dark theme,
pan/zoom, click-a-node-for-detail. The question was literal: *"¿Podremos tener algo así?"* Today
dbgraph can only TALK about the graph — `query`/`explore`/`object` render text; there is no way to
SEE it. The graph already lives locally in `.dbgraph/dbgraph.db` (nodes: kind/qname/payload; edges:
kind/src/dst/confidence/attrs), and the reference corporate graph is ~18.7k nodes / ~21k edges (the
torture fixture is 53/64) — big enough that a picture is genuinely the fastest way for a human to
grasp shape, clusters, and blast radius.

Now is the moment: the payload/present layer just matured (explore-payloads shipped a pure per-kind
`present/payload.ts` + a CLI `object` command), so a viewer can REUSE the exact node-detail semantics
users already trust instead of inventing a second truth. This is a human-facing side channel that
complements — not replaces — the MCP/CLI text surfaces.

Success = `dbgraph viz` writes ONE self-contained HTML file (all JS/CSS inline, ZERO network at view
time) that opens offline and shows the graph the way graphify does: force layout, communities with a
toggleable legend, search, kind/degree/schema filters that keep ~18k nodes usable, and a node-click
panel whose contents match `dbgraph object`. Plus a tiny sibling: `dbgraph viz --mermaid` emits a
deterministic ER diagram (tables + FKs) for READMEs. The data the file embeds is deterministic and
golden-pinnable even though the live force animation is not.

## Scope

### In Scope
- **`dbgraph viz [--out graph.html]`** — export a SELF-CONTAINED interactive HTML: force-directed
  layout, pan/zoom, node color by COMMUNITY (fallback: by `kind`), a sidebar legend listing community
  name + node count with per-community visibility toggles, a search box, and node-click → a detail
  panel. NO network at view time; all assets inlined; opens with `file://` (air-gap safe).
- **Node-detail panel reuses the EXISTING truth.** The panel content is sourced from the same
  `present/payload.ts` renderers / `formatObject` semantics that back CLI `object` and MCP
  `dbgraph_object` — same-source-same-truth, no second renderer, no drift (ADR-004).
- **In-house, deterministic community assignment** (label propagation, seeded, stable node order) so
  the ASSIGNMENT is byte-reproducible per ADR-008; community NAMING derives from the dominant
  schema/table prefix of its members (graphify names clusters after dominant symbols).
- **A whole-graph read seam on `GraphStore`.** The port today has NO bulk read (per-id / per-kind /
  per-edge only); a viz over 18.7k nodes must not fan out into an N-query storm. Add a bulk
  `getAllNodes()` / `getAllEdges()` (or a streamed read) so export is one pass. Read-only (ADR-004).
- **Scale strategy = default filters.** Columns dominate the node count, so the DEFAULT view collapses
  columns into their table/view (expandable) and shows structural nodes + `references`/`depends_on`
  edges — keeping the default to hundreds–low-thousands of nodes. Toggles: show-columns, per-kind
  visibility, degree threshold, schema filter. The full ~18k is an explicit opt-in "may be heavy" mode.
- **`dbgraph viz --mermaid`** — a PURE, deterministic Mermaid ER export (tables + FK `references`
  edges only), golden-pinnable, zero JS, zero deps — drop-in for READMEs/docs.
- **`viz` command wiring** — a new dispatch handler + `COMMAND_TABLE` entry mirroring `handleObject`;
  writes the file and prints a one-line confirmation + the output path to stdout.

### Out of Scope (deferred, justified)
- **WebGL / GPU rendering (sigma.js/regl/pixi).** Needed only at ~100k+ nodes; Canvas 2D covers 18.7k.
  GPU variance + bundle size don't earn their keep in v1 — deferred.
- **MCP tool exposure.** An interactive HTML/binary is a HUMAN artifact; an MCP tool returns text for
  an LLM to reason over (ADR-008 frames MCP as the token-economy consumption side). A picture is
  useless as a tool result and would burn tokens — viz stays CLI-only. (Spec/design verify it is NOT
  registered as a tool.)
- **Louvain community detection.** Higher-quality modularity clustering, but heavier; label
  propagation is good-enough + in-house + deterministic for v1. Deferred.
- **Live/streaming re-layout, saved layouts, PNG/SVG rasterization, per-column lineage overlays.**
  Separate changes.

## Capabilities

### New Capabilities
- `graph-viz`: the `viz` command family — self-contained interactive HTML export (force layout,
  communities + legend/toggles, search, filters, node-detail panel) AND the `--mermaid` ER export;
  the in-house community-assignment + community-naming rules; the self-contained/no-network-at-view
  and content-sensitivity contracts.

### Modified Capabilities
- `graph-storage`: a bulk whole-graph read (`getAllNodes`/`getAllEdges` or streamed) added to the
  `GraphStore` port + SQLite adapter — strictly read-only, deterministic ordering.
- `cli-config`: register the `viz` command; `--out` (default `graph.html`), `--mermaid`, and the
  filter flags (`--schema`, `--min-degree`, `--kinds`, `--columns`); exit-code contract; usage banner.
- `mcp-server`: verify-only — confirm `viz` is NOT exposed as an MCP tool (no change expected).

## Approach

Hexagonal (ADR-004), export-only, read-only. Three seams:

1. **Read** — add a bulk graph read to the `GraphStore` port (the one honest gap: no whole-graph read
   exists today) so the exporter makes one deterministic pass instead of N per-node queries. SQLite
   adapter implements it read-only.
2. **Model** — a pure `core/present/viz-model.ts` (core-types-only, deterministic — ADR-008) turns the
   graph into a view model: community assignment (seeded label propagation, stable id order), community
   names (dominant schema/table prefix), collapsed-column default, and the per-node detail text pulled
   from the EXISTING payload renderers / `formatObject` so the panel equals `dbgraph object`. This
   model is byte-deterministic and golden-pinnable. A pure `mermaid-er.ts` emits the ER text.
3. **View** — a template step inlines the view model + the viewer JS/CSS into ONE HTML file. Rendering
   is **Canvas 2D** — this is not a tradeoff, it is a hard limit: SVG (one DOM node per element)
   collapses well before 18.7k. The runtime force ANIMATION is inherently non-deterministic
   (requestAnimationFrame + physics); we DO NOT golden the pixels — only the embedded data/community
   assignment/mermaid text (ADR-008 honest split).

**THE key design decision (defer to sdd-design, with a leaning): the force SIMULATION.** A force layout
at 18.7k nodes needs Barnes-Hut O(n·log n) (naive O(n²) ≈ 350M pairs/tick is unusable). Two honest paths:
- **(A) Vendor + INLINE `d3-force` + `d3-quadtree`** (~30KB, MIT, zero transitive deps). Battle-tested
  Barnes-Hut; low correctness risk. It is a BUILD-time asset INLINED into the generated HTML — it is
  NOT a dbgraph RUNTIME dep and never touches the DB path, so the ADR-007 supply-chain concern (a tool
  that connects to databases) is materially weaker; still needs a written ADR-007 justification.
- **(B) In-house Barnes-Hut sim** (~200–400 lines: quadtree, theta, cooling). Honors the ZERO-new-deps
  preference and the ADR-007 in-house precedent (Codex TOML writer, YAML on-block parser, tokenizer-core)
  — but a numerically-stable force sim is genuinely nontrivial and a real correctness/time risk.

**Recommendation:** ship path **(A)** for v1 (audited, inlined, off the DB path) with a written ADR-007
justification, and document **(B)** as the fallback if the team rejects the build-dep. I will NOT
pretend hand-rolling Barnes-Hut is trivial to satisfy a preference — but the choice is the team's, so
design pins it. The Canvas renderer, community logic, filters, and mermaid export are 100% in-house
regardless of this choice.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/ports/graph-store.ts` | Modified | Add bulk `getAllNodes`/`getAllEdges` (or streamed) read — read-only |
| `src/adapters/storage/sqlite/sqlite-graph-store.ts` | Modified | Implement the bulk read (deterministic order) |
| `src/core/present/viz-model.ts` | New | Pure view model: communities (seeded LPA), names, column-collapse, per-node detail via existing renderers |
| `src/core/present/mermaid-er.ts` | New | Pure deterministic Mermaid ER (tables + FK `references`) |
| `src/core/present/payload.ts` / `object.ts` | Reused | Source the node-detail panel text — no new renderer |
| `src/cli/commands/viz.ts` | New | `runViz` — bulk read → model → inline template → write file |
| `src/cli/viz/template.ts` + inlined viewer JS/CSS (+ vendored d3 if path A) | New | Self-contained HTML template; Canvas viewer; all assets inline |
| `src/cli/dispatch.ts` | Modified | Register `viz`; parse `--out`/`--mermaid`/filter flags |
| `src/cli/cli.ts` | Modified | `USAGE_TEXT` gains the `viz` line |
| `package.json` (path A only) | Modified | Add `d3-force`/`d3-quadtree` as a BUILD/dev dep + ADR-007 written justification |
| `docs/format-spec.md` / new `docs/viz.md` | New/Modified | Document the export, filters, determinism split, and content-sensitivity |
| `test/core/present/` + `test/cli/` | New | Golden the view-model + mermaid output; assert self-contained (no `http`/`src=` remote) + no-secret leakage |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 18.7k nodes janky / unusable | High | Canvas 2D + Barnes-Hut; DEFAULT collapses columns + structural-only; degree/kind/schema filters; full graph is opt-in "may be heavy"; publish honest perf targets (smooth at ~2–5k visible) |
| ADR-007 tension over vendoring d3-force | Med | Inlined build-time asset off the DB path; written justification; in-house Barnes-Hut documented as fallback — design makes the call, not propose |
| HTML file leaks sensitive schema | Med | The file embeds qnames/schema/table/column names → it is EXACTLY as sensitive as `.dbgraph/dbgraph.db`; document that honestly (dbgraph-security); NEVER embed connection strings/secrets/sampled values (doctor/logger content-safety invariant) |
| Non-determinism breaks a golden | Med | Golden ONLY the embedded data + community assignment + mermaid text (deterministic); NEVER the animation/pixels; seeded LPA + stable id order (ADR-008) |
| Bulk store read balloons memory at scale | Med | Streamed/paged read option in the port; default column-collapse shrinks the working set; measure at 18.7k |
| Node-detail panel drifts from `object` | Low | Panel text comes from the SAME `payload.ts`/`formatObject` renderers — one source, no second truth |
| Scope creep (WebGL, Louvain, MCP tool) | Low | Explicitly deferred/out-of-scope above with justification |

## Rollback Plan

Purely additive and read-only. Revert by: deleting `viz.ts`/`viz-model.ts`/`mermaid-er.ts` + the
template/viewer assets; removing the `viz` dispatch entry, the `USAGE_TEXT` line, and the flag parsing;
reverting the bulk-read additions to the `GraphStore` port + SQLite adapter (no other caller depends on
them); `git revert` of the golden commit; and (path A) removing the `d3-force`/`d3-quadtree` dev-dep.
No schema/sync/extraction/query CONTRACT changes are touched, so the graph, adapters, existing CLI/MCP
surfaces, and the frozen benchmark harness stay green.

## Dependencies

- Reuses the existing `present/payload.ts`/`object.ts` renderers and the `GraphNode.payload` facts — no
  re-extraction.
- Path A adds `d3-force`/`d3-quadtree` as a BUILD/dev dep (INLINED into output, NOT a runtime dbgraph
  dep), pending an ADR-007 written justification. Path B adds NO packages. Design decides.
- No network at view time; no new database work; strictly read-only against `.dbgraph/dbgraph.db`.

## Stories

- Primary: the user's direct request — a graphify-style interactive picture of the local graph
  (*"¿Podremos tener algo así?"*), plus the standing roadmap note that the user wants to SEE the graph.
- Secondary: `viz --mermaid` ER export for README/docs embedding.
- Deferred: WebGL scale mode, Louvain communities, MCP exposure, saved layouts, per-column lineage.

## Success Criteria

- [ ] `dbgraph viz` writes ONE self-contained HTML (all JS/CSS inline, ZERO network/CDN at view time)
      that opens over `file://` and renders the graph with force layout, pan/zoom, and dark theme.
- [ ] Nodes are colored by COMMUNITY (fallback `kind`); a sidebar legend lists community name + node
      count with per-community visibility toggles (the graphify UX).
- [ ] A search box + kind/degree/schema filters + column-collapse keep the reference ~18.7k-node graph
      usable; the full graph is an explicit opt-in mode with honestly-documented perf expectations.
- [ ] Clicking a node opens a detail panel whose content MATCHES `dbgraph object <qname>` (same
      `payload.ts`/`formatObject` source — no second renderer).
- [ ] Community ASSIGNMENT + the embedded data + `--mermaid` output are byte-deterministic and
      golden-pinned; the live animation is explicitly NOT goldened (ADR-008 split documented).
- [ ] `dbgraph viz --mermaid` emits a valid deterministic ER diagram (tables + FKs).
- [ ] The generated file embeds NO connection strings/secrets/sampled values; docs state the file is as
      sensitive as the graph DB itself (dbgraph-security).
- [ ] The `GraphStore` bulk read is strictly read-only; ADR-004 boundary test green; `viz` is NOT
      registered as an MCP tool.
