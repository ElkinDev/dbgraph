# Manual browser smoke — `dbgraph viz`

The live, interactive viewer (force layout, pan / zoom, toggles, node click) is inherently
non-deterministic and is **NOT** automated in `npm test` (ADR-008 honest split — `npm test`
asserts only the deterministic embedded data block, community assignment, and Mermaid text).
This checklist is the ONLY coverage for the interactive UI. Run it by hand before a release
that changes anything under `src/cli/commands/viz/assets/**` or the HTML assembly.

## Produce a file to test

```
# from a project that has a synced .dbgraph/dbgraph.db
dbgraph viz --out graph.html          # default collapsed view
dbgraph viz --full --out graph-full.html   # heavy: every node incl. columns
dbgraph viz --mermaid --out schema.mmd     # deterministic ER (open in any Mermaid viewer)
```

To exercise the offline / air-gap guarantee honestly, copy `graph.html` to a machine with NO
network (or disable networking / open DevTools → Network and confirm zero requests).

## Checklist

### A. Offline render (spec: "file renders offline over file://")

- [ ] Open `graph.html` via `file://` (double-click, or `file:///…/graph.html`).
- [ ] On an air-gapped machine (or with the network disabled) the graph STILL renders.
- [ ] DevTools → Network shows **ZERO** requests (no CDN, no fonts, no fetch).
- [ ] The theme is dark; nodes lay out with a force simulation (they spread out and settle).
- [ ] Drag on empty canvas PANS the graph; mouse wheel ZOOMS toward the cursor.

### B. Sidebar legend + toggles (spec: "sidebar lists communities with counts and toggles")

- [ ] The sidebar lists each community with its NAME and node COUNT.
- [ ] Clicking a community row toggles its visibility (its nodes hide / show; the row dims).
- [ ] When the graph has no communities, the legend says "colored by kind" and the Kinds list
      drives the colors instead.
- [ ] The Kinds and Schemas lists each show entries with counts and working visibility toggles.
- [ ] The footer shows the total node / edge counts.

### C. Search + filters (spec: "columns are collapsed by default; the full graph is opt-in")

- [ ] Typing in the search box narrows the visible nodes to label substring matches.
- [ ] Clearing the search restores the full set.
- [ ] Dragging the "Min degree" slider hides low-degree nodes; the readout updates.
- [ ] Toggling a kind / schema hides / shows exactly that subset.
- [ ] In the DEFAULT file, individual `column` nodes are NOT present as separate dots
      (collapsed into their tables); in `--full`, they ARE.

### D. Node detail panel (spec: "node click shows payload sections matching object")

- [ ] Clicking a node opens the right-hand detail panel; its title is the node's qname.
- [ ] The panel body shows the SAME sections as `dbgraph object <qname> --detail full`
      (COLUMNS / CONSTRAINTS / INDEXES / TRIGGERS as applicable) — compare side by side.
- [ ] A COLLAPSED table's panel STILL lists its COLUMNS section (detail is built from the full
      graph, not the collapsed view).
- [ ] Clicking empty canvas (or the ✕) closes the panel.

### E. Content sensitivity (spec: "schema-sensitive but never embeds secrets/sampled values")

- [ ] `view-source:` / a text editor on `graph.html` shows schema identifiers (qnames) only.
- [ ] It contains NO connection string, NO resolved secret, NO sampled row VALUES.
- [ ] Grep confirms no fetching construct: `grep -Ei 'fetch\(|XMLHttpRequest|@import|src=["'\'']https?:|href=["'\'']https?:' graph.html` returns nothing.

## `--mermaid` spot check

- [ ] `dbgraph viz --mermaid` output is pure text (no `<script>`, no JS).
- [ ] It renders as an ER diagram (tables + FK relationships) in any Mermaid viewer.
- [ ] Running it twice on the same graph yields BYTE-IDENTICAL output (deterministic).

Record the date, dbgraph version, browser, and OS with each run.
