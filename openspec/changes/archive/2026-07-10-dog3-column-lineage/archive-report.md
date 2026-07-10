# Archive Report: dog3-column-lineage

**Change**: dog3-column-lineage (DOG-3 — column-level lineage, views first)
**Archived**: 2026-07-10
**Artifact store**: openspec (files)
**Repo / branch**: `dbgraph` @ `post-v1`, HEAD `287be4a`, clean tree
**Final verdict**: ARCHIVE-READY (0 CRITICAL, 2 WARNING, 3 SUGGESTION — see `verify-report.md`)

## Executive Summary

DOG-3 delivers honest column-grain view lineage under Model A: the sorted-unique consumed-column SET rides
`attrs.dstColumns` on the EXISTING view→table `depends_on` edge (zero new edges, no column-node targets).
Where a catalog sources it — mssql via a native `sys.dm_sql_referenced_entities` per-view TVF loop, pg via
`information_schema.view_column_usage` — the covered view→table `depends_on` edge FLIPS
`confidence: 'parsed'`→`'declared'` and gains the set; everywhere else it degrades by ABSENCE
(byte-identical to pre-DOG-3, no marker). Impact is column-precise via one shared `filterReadersByColumn`
three-arm helper; render adds a FULL-only lowercase `consumes: <table>.<column>` section, byte-identical
across CLI and MCP. The three batches (A mssql, B pg, C impact/render/degrade) shipped GREEN
(tsc 0, lint 0/0, 230 files / 3595 tests; live mssql 13/13 + pg 84/84). The 9 column-lineage delta specs
are merged into the canonical `openspec/specs/`. The change is closed.

## Reconciler note (d) — recorded in `design.md`

> **(d) The D5 "mssql already declared → no flip" premise was factually wrong.** The tokenizer emits
> `confidence: 'parsed'` for mssql view `depends_on` deps (exactly as it does for pg); the shipped
> implementation FLIPS `parsed`→`declared` on COVERED view deps in BOTH mssql and pg (the covered edge
> gains `attrs.dstColumns` at the same moment it flips). Uncovered / unbindable / sqlcmd-or-dump mssql
> deps and uncovered / materialized / owner-gap pg deps STAY `parsed` object grain (degrade-by-absence).
> The observable end state every test pins (`declared` + sorted-unique `dstColumns` on covered edges) is
> CORRECT and unchanged; only D5's and the `mssql-extraction` delta's narrative of HOW confidence reaches
> `declared` was wrong. The canonical specs MUST state the flip, NEVER "already declared."
> (Surfaced independently as verify WARNING-1; recorded 2026-07-10.)

This joins the pre-existing reconciler rulings recorded in `tasks.md`: (a) `supportsColumnLineage` is an
impl detail, never a per-edge coverage oracle; (b) the proposal's "make the singular `srcColumn/dstColumn`
load-bearing" is superseded by D2's new plural `dstColumns`; (c) the mssql column source is
`sys.dm_sql_referenced_entities` (D8), not the inert `sys.sql_expression_dependencies.referenced_minor_id`.

## Specs Merged to Main (`openspec/specs/`)

| Domain | Action | Detail |
|--------|--------|--------|
| graph-model | Updated (+2 requirements) | "Consumed source-column set on view depends_on via attrs.dstColumns" + "Per-engine column provenance and honest degradation-by-absence"; the confidence sentence states the `parsed`→`declared` FLIP on covered pairs (never "already declared") |
| graph-normalization | Updated (+1 requirement) | "buildDependencyEdges stamps the consumed source-column set as sorted-unique attrs.dstColumns" (Model A, ADR-008; the flip is done by the adapter's map.ts, not the normalizer) |
| graph-query | Updated (MODIFIED in place) | "Depth-limited impact closure separating read and write" gains the three-arm column rule (present-includes → affected; present-excludes → excluded; absent → included) + a second `(Previously:)` note + 4 column scenarios; the DOG-1 `calls` content and the neighbors/path/search/DoD requirements are PRESERVED |
| schema-extraction | Updated (+1 requirement) | "Optional RawDependency.columns is an engine-agnostic source-column-set contract" |
| mssql-extraction | Updated (+labeled section) | "## Requirements Added by dog3-column-lineage (2026-07-10)": native `dm_sql_referenced_entities` TVF-loop source, parsed→declared flip on covered deps (D5 CORRECTED), unbindable-view skip, sqlcmd/dump object-grain degrade, deliberate golden re-bless |
| pg-extraction | Updated (+3 requirements) | `view_column_usage` covered-pair flip; materialized + owner-gap degrade-by-absence; capability note (`supportsDependencyHints` stays false, `supportsColumnLineage:true`) + per-edge coverage coexistence |
| mysql-extraction | Updated (+1 requirement) | "View column lineage degrades by absence"; `supportsColumnLineage:false`; byte-identical view edges |
| sqlite-extraction | Updated (+1 requirement) | "View column lineage degrades by absence"; `supportsColumnLineage:false`; byte-identical view edges |
| mcp-server | Updated (+2 requirements) | precheck/affected column-grain view precision; explore/object FULL-only lowercase `consumes: <table>.<column>` render — NO uppercase header/marker (distinct from the DOG-2 `PARAMETERS` uppercase convention) |

## Merge Rulings (conflicts adjudicated at archive)

1. **`openspec/specs/` was NOT empty (tool false-negative).** The Glob tool returned "No files found" for
   `openspec/specs/**`; direct Reads proved the canonical specs EXIST and are current (they already carry
   DOG-1 `calls`, DOG-2 parameters, US-008 inference and phase-9b mongodb content). The 9 deltas were
   therefore merged into the ACTUAL current canonical specs (append / in-place MODIFY), NOT reconstructed
   from the phase-1/phase-2 archived bases. No base requirements were lost.
2. **D5 flip correction (reconciler d).** The `mssql-extraction` delta and design D5 asserted the mssql
   view `depends_on` was "already declared → no flip." This is false. The merged canonical `mssql-extraction`
   (and the `graph-model` confidence clause) state the `parsed`→`declared` FLIP on covered pairs, mirroring
   pg. The archived `design.md` carries an ERRATA marker on D5 plus a "## Reconciliation notes" section.
3. **graph-query MODIFIED, not appended.** DOG-3's cumulative version of the impact-closure requirement
   (calls from DOG-1 + the three-arm column rule from DOG-3) REPLACED the existing requirement block in
   place; all sibling requirements were preserved. This matches the repo's MODIFIED-requirement pattern.
4. **Convention matched per file.** `mssql-extraction` uses labeled `## Requirements Added by {change}`
   sections (dog1/dog2 precedent) → DOG-3 followed that pattern there. Every other spec integrates change
   requirements directly under `## Requirements` → DOG-3 appended directly there.
5. **`consumes:` render shape.** The DOG-3 render is a LOWERCASE inline `consumes: <table>.<column>` line,
   explicitly NOT an uppercase `CONSUMES` header/`[CONSUMES]` marker (which would clash with the DOG-2
   `PARAMETERS`/`[OUT]`/`[DEFAULT]` uppercase convention). The canonical `mcp-server` requirement pins this.

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/graph-model/spec.md` | Present (ADDED requirements delta) |
| `specs/graph-normalization/spec.md` | Present |
| `specs/graph-query/spec.md` | Present (MODIFIED requirement delta) |
| `specs/schema-extraction/spec.md` | Present |
| `specs/mssql-extraction/spec.md` | Present |
| `specs/pg-extraction/spec.md` | Present |
| `specs/mysql-extraction/spec.md` | Present |
| `specs/sqlite-extraction/spec.md` | Present |
| `specs/mcp-server/spec.md` | Present |
| `design.md` | Present (D5 ERRATA + "## Reconciliation notes (archive-time)" with reconciler d) |
| `tasks.md` | Present (32/32 boxes complete — 24 tasks A/B/C + 8 DoD) |
| `verify-report.md` | Present (ARCHIVE-READY; reproduction table; 9-delta compliance; WARNING-1/2; 3 SUGGESTIONs) |
| `archive-report.md` | This file |

## Finalization steps requiring shell (NOT executable by this file-only executor)

This executor has file tools only (Read/Edit/Write/Glob) — no shell/git/npm. The following MECHANICAL
steps remain and MUST be run by an operator with shell access (a filesystem move, then ONE conventional
commit through the active leak-scan hooks — NEVER `--no-verify`; NO push / PR / tags):

```
# 1. Move the change folder into the dated archive (moves ALL artifacts, tracked + new)
Move-Item openspec/changes/dog3-column-lineage openspec/changes/archive/2026-07-10-dog3-column-lineage

# 2. Stage everything (moved change + merged canonical specs + updated epic)
git add -A

# 3. ONE conventional commit (leak-scan hooks active — never --no-verify)
git commit -m "docs(openspec): archive dog3-column-lineage; merge column-lineage deltas into canonical specs"

# 4. Post-commit sanity (specs-only commit must not affect tests) + clean tree
npm test
git status
```

## SDD Cycle Complete (content)

dog3-column-lineage has been fully planned, implemented, verified, and its 9 column-lineage delta specs are
merged into `openspec/specs/` as canonical source of truth with the D5 flip corrected. The change is ready
to be moved into the archive and committed by the finalization steps above.
