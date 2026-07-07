# Graph Viz Specification

## Purpose

The `viz` command family: a read-only, export-only, human-facing side channel that renders the local
graph (`.dbgraph/dbgraph.db`) as ONE self-contained interactive HTML file (force layout, communities,
search, filters, node-detail panel) and, via `--mermaid`, a pure deterministic ER diagram. Node-detail
content is sourced from the EXISTING `present/payload.ts` / `formatObject` truth that backs CLI `object`
and MCP `dbgraph_object` — same-source-same-truth, no second renderer (ADR-004). The DETERMINISTIC parts
(embedded data, community assignment, mermaid text) are golden-pinnable; the live force ANIMATION is
explicitly NOT (ADR-008 honest split). Driven by the user's direct request to SEE the graph; complements —
never replaces — the CLI/MCP text surfaces. No formal US-xxx is yet assigned to `viz` (see open questions);
it reuses the `object`/`explore` payload truth (US-012 / US-021 area).

## Requirements

### Requirement: viz exports one self-contained offline HTML with zero network at view time

`dbgraph viz [--out <file>]` SHALL write exactly ONE HTML file with ALL JavaScript and CSS INLINED, and
the emitted file MUST make ZERO network requests when opened (air-gap safe, opens over `file://`). It MUST
NOT contain any construct that fetches a remote resource at view time — no remote `<script src>`,
`<link href>`, `@import`, `url(http…)`, `fetch(`, `import(` or `XMLHttpRequest` to a network origin. Any
literal `http(s)://` present in the output MUST be INERT embedded text (e.g. a qname), never a fetched
resource. The default `--out` is `graph.html`.

#### Scenario: emitted HTML fetches nothing at view time

- GIVEN `dbgraph viz --out graph.html` over any graph
- WHEN the emitted file is scanned for network-fetching constructs (remote `src`/`href`, `@import`, `url(http`, `fetch(`, `import(`, `XMLHttpRequest`)
- THEN none are present and every asset is inlined
- AND any literal `http(s)://` occurrence is inert embedded text, not a fetched resource

#### Scenario: file renders offline over file://

- GIVEN the emitted HTML on an air-gapped machine
- WHEN it is opened via `file://`
- THEN the graph renders with force layout, pan/zoom and dark theme with no network access

### Requirement: embedded graph data is deterministic

The graph data block EMBEDDED in the HTML SHALL be deterministic: the SAME graph MUST produce a
BYTE-IDENTICAL embedded data block (ADR-008), with node and edge ordering STABLE by node id / edge
identity. The live force ANIMATION (requestAnimationFrame + physics) is inherently non-deterministic and
MUST NOT be goldened — only the embedded data block is pinned.

#### Scenario: same graph yields a byte-identical data block

- GIVEN the torture graph exported twice
- WHEN the two embedded data blocks are compared
- THEN they are byte-identical
- AND the animation/pixels are NOT part of any golden

### Requirement: community assignment and naming are deterministic

Community ASSIGNMENT SHALL be computed in-house by SEEDED label propagation over a STABLE node id order,
producing a BYTE-REPRODUCIBLE assignment (ADR-008). Community NAMES SHALL derive from the DOMINANT
schema/table prefix of each community's members. When no communities are available the viewer MUST fall
back to coloring by `kind`. A golden snapshot MUST pin the community COUNT and per-node MEMBERSHIP on the
torture fixture.

#### Scenario: torture-fixture community assignment matches a pinned snapshot

- GIVEN the torture graph
- WHEN communities are assigned twice
- THEN both runs produce an identical community count and per-node membership, matching the golden snapshot
- AND each community name derives from its members' dominant schema/table prefix

### Requirement: viewer provides a sidebar legend, toggles, search, filters and a node-detail panel

The HTML viewer SHALL present a SIDEBAR legend listing each community with its NAME and node COUNT plus a
per-community visibility TOGGLE; a SEARCH box; and kind / degree-threshold / schema FILTERS. Clicking a
node MUST open a DETAIL panel whose content shows the SAME per-kind payload sections as
`dbgraph object <qname>` (sourced from the existing `present/payload.ts` / `formatObject` renderers — no
second renderer, no drift).

#### Scenario: sidebar lists communities with counts and toggles

- GIVEN an exported graph with multiple communities
- WHEN the sidebar renders
- THEN each community appears with its name, node count and a visibility toggle
- AND toggling a community hides/shows its nodes

#### Scenario: node click shows payload sections matching object

- GIVEN the torture graph exported and one node selected
- WHEN the detail panel renders
- THEN it shows the same per-kind payload sections (columns/constraints/indexes/triggers) as `dbgraph object` for that qname, from the shared renderer

### Requirement: the exported HTML is schema-sensitive but never embeds secrets or sampled values

The exported HTML EMBEDS schema identifiers (qnames, schema/table/column names) and SHALL therefore be
treated as EXACTLY as sensitive as `.dbgraph/dbgraph.db`; the docs MUST state this honestly. The file MUST
NEVER embed connection strings, resolved secrets, or sampled data VALUES.

#### Scenario: sentinel secret and sampled value never appear in the output

- GIVEN a resolved connection-secret sentinel and a sampled-data-value sentinel present in the environment/config during export
- WHEN the emitted HTML is scanned for both sentinels
- THEN neither sentinel appears anywhere in the file
- AND only schema identifiers (qnames / schema / table / column names) are embedded

### Requirement: columns are collapsed by default; the full graph is opt-in

The DEFAULT `viz` view SHALL COLLAPSE column nodes into their parent table/view (rendering structural
nodes + `references`/`depends_on` edges), keeping large graphs usable. A `--full` flag MUST opt into
rendering ALL nodes (including columns) as an explicit, honestly-documented "may be heavy" mode.

#### Scenario: default collapses columns, --full expands them

- GIVEN the torture graph
- WHEN `dbgraph viz` runs without `--full`
- THEN column nodes are collapsed into their parent table/view (not rendered as separate top-level nodes)
- AND WHEN `dbgraph viz --full` runs THEN column nodes are rendered individually

### Requirement: --mermaid emits a pure deterministic ER diagram

`dbgraph viz --mermaid` SHALL emit a PURE Mermaid ER diagram containing ONLY tables and their FK
(`references`) relationships, in a CANONICAL deterministic order (entities by qname; relationships sorted
deterministically), with ZERO JavaScript and ZERO dependencies. Output MUST be BYTE-IDENTICAL to a golden
on the torture fixture (ADR-008).

#### Scenario: mermaid ER matches the torture-fixture golden byte-for-byte

- GIVEN the torture graph
- WHEN `dbgraph viz --mermaid` runs twice
- THEN both outputs are byte-identical to each other and to the golden ER file
- AND the diagram lists tables and FK edges in canonical order with no JS and no deps

### Requirement: viz is a CLI-only human artifact, never an MCP tool

The `viz` capability SHALL be exposed ONLY through the CLI. It MUST NOT be registered as an MCP tool (an
interactive picture is a human artifact, not a token-economy tool result — ADR-008).

#### Scenario: viz is not registered as an MCP tool

- GIVEN the MCP tool registry
- WHEN its registered tools are inspected
- THEN no `viz` / `dbgraph_viz` tool is present
