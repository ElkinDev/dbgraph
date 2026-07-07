# `dbgraph viz` — self-contained interactive graph HTML

`dbgraph viz` exports the local graph index (`.dbgraph/dbgraph.db`) as ONE self-contained,
offline HTML file you can open in any browser to SEE the schema — force layout, communities,
search, filters, and a per-node detail panel. With `--mermaid` it instead emits a
deterministic Mermaid ER diagram (tables + FK relationships).

It is a **CLI-only, read-only, export-only** human artifact. It complements — never replaces
— the `dbgraph`/`dbgraph-mcp` text surfaces, and it is deliberately **NOT** an MCP tool (an
interactive picture is a human artifact, not a token-economy tool result). It reads the local
index only; it never connects to your database.

> No formal `US-xxx` is assigned to `viz` (user request, 2026-07-07). It reuses the
> `object` / `explore` payload truth (the US-012 / US-021 area).

## Usage

```
dbgraph viz [--out <file>] [--full | --columns] [--schema <name>] [--min-degree <n>] [--kinds <k,...>]
dbgraph viz --mermaid [--out <file>]
```

On success it writes the output file and prints a one-line confirmation carrying the path,
then exits `0`. An invalid flag value or a contradictory flag combination surfaces a
`ConfigError` with an actionable message and exits `2` (the established exit-code contract —
no new exit code).

### Flags

| Flag | Meaning |
|------|---------|
| `--out <file>` | Output path. Default `graph.html` for the HTML export; STDOUT for `--mermaid`. |
| `--mermaid` | Emit a pure Mermaid ER diagram (tables + FK `references`) instead of HTML. Zero JS, zero deps. Cannot be combined with any viewer-shaping flag. |
| `--full` | Render EVERY node kind, including columns. Explicit, honestly-documented "may be heavy" mode (see sizes below). |
| `--columns` | Include column/field nodes but no other heavy kinds (lighter than `--full`). Implied by `--full` — passing both is an error. |
| `--schema <name>` | Scope the export to a single schema. |
| `--min-degree <n>` | Drop nodes with fewer than `n` incident edges (non-negative integer). |
| `--kinds <k,...>` | Explicit comma-separated node-kind allowlist (e.g. `table,view`). Cannot be combined with `--full`. |

### Collapse / `--full` semantics

The **default** view COLLAPSES column nodes into their parent table/view and folds the other
heavy kinds (constraints, indexes, triggers) into their parent too, rendering structural
nodes plus `references` / `depends_on` edges. This is what keeps a large (~18.7k node) graph
usable at a glance. `--full` opts into rendering every node individually; `--columns` is the
middle ground (structural + columns, no other heavy kinds).

The shaping flags (`--schema` / `--min-degree` / `--kinds` / `--columns` / `--full`)
PRE-FILTER the embedded node set at export time (server-side) — that is what keeps the
default file small. Inside the viewer, the sidebar community / kind / degree / schema toggles
filter VISIBILITY client-side over the already-embedded set (no re-export).

Crucially, a collapsed table's DETAIL panel still shows its COLUMNS section: the node-detail
text and neighbor grouping are built from the FULL graph even when the visible graph is
collapsed.

### Invalid combinations (exit 2)

| Combination | Message |
|---|---|
| `--mermaid` + any viewer flag | `--mermaid emits a pure ER diagram and cannot be combined with viewer flag <flag> (drop <flag> or --mermaid).` |
| `--full` + `--kinds` | `--full renders every kind and cannot be combined with the --kinds allowlist.` |
| `--full` + `--columns` | `--columns is implied by --full; pass one, not both.` |
| non-integer / negative `--min-degree` | `--min-degree must be a non-negative integer, got "<v>".` |
| unknown `--kinds` kind | `--kinds contains unknown kind "<k>" (valid: <kinds>).` |
| empty `--schema` | `--schema requires a non-empty schema name.` |

## What renders offline

The emitted HTML inlines ALL CSS and JavaScript — including the vendored client force-layout
engine — and makes **ZERO network requests** at view time. It opens over `file://` on an
air-gapped machine with force layout, pan / zoom, and a dark theme. There is no remote
`<script src>`, no `<link href>`, no `@import`, no `fetch(`, no `import(`, no
`XMLHttpRequest`, no CDN. Any literal `http(s)://` in the file is inert text (the vendored d3
attribution comment), never a fetched resource.

The vendored client engine is `d3-force` (+ `d3-quadtree` / `d3-dispatch` / `d3-timer`),
**ISC-licensed** (Copyright 2010-2021 Mike Bostock), committed as static assets — NOT an npm
dependency, NEVER a CDN. See `docs/adr/010-vendored-client-viz-asset.md` and
`src/cli/commands/viz/assets/vendor/PROVENANCE.md` (exact versions + sha256 digests).

### Approximate sizes (estimates, not measured)

| Export | Approx. size | Note |
|--------|--------------|------|
| default (collapsed structural set) | ~1.5–2 MB | ~30 KB vendored d3 + viewer + per-node detail text |
| `--full` (all ~18.7k nodes) | ~15 MB | honestly "may be heavy" — prefer the default or a `--schema` scope |

## Determinism (what is golden-pinned, what is not)

The DETERMINISTIC parts are byte-reproducible and golden-pinned (ADR-008):

- the embedded data block (`#dbgraph-data`) — the same graph yields a BYTE-IDENTICAL block;
- the community ASSIGNMENT + naming (seeded label propagation, code-point tie-break);
- the `--mermaid` ER text.

The live force ANIMATION (physics / pixels / frame timing) is inherently non-deterministic
and is **explicitly NOT goldened**. Its only coverage is the manual browser smoke checklist
(`docs/manual-smoke-viz.md`); `npm test` asserts the deterministic data / community / mermaid
only, never the animation.

## Node detail = the same truth as `dbgraph object`

Clicking a node opens a detail panel whose content is the SAME per-kind payload text
(columns / constraints / indexes / triggers) as `dbgraph object <qname> --detail full`. It is
pre-rendered server-side by the EXISTING `formatObject` presenter (`src/core/present/`) and
injected verbatim into a `<pre>` — there is NO second renderer and no drift (see
`docs/format-spec.md`).

## Content sensitivity (read this)

The exported HTML EMBEDS schema identifiers — qualified names, schema / table / column names —
so it is **EXACTLY as sensitive as `.dbgraph/dbgraph.db`**. Treat the file accordingly: store
it, share it, and delete it with the same care you give the graph database itself.

It **NEVER** embeds connection strings, resolved secrets, or sampled data VALUES — only schema
identifiers. This is enforced by a structural test (resolved-secret and sampled-value
sentinels placed in the environment during export are verified absent from the output) and by
the dbgraph read-only, content-free security posture (dbgraph-security).
