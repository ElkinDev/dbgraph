# E3 — AI consumption (MCP server)

Goal: an agent gets in 1 tool call what today costs 5+ exploratory queries.
Plan references: §4.6 (tools), Phase 5. The compact format (US-019) governs ALL the others.

---

### US-010 — dbgraph_explore
**As** an AI agent, **I want** to request the full context of an entity or topic, **so that** I understand its neighborhood in a single call.
**Phase:** 5 · **Depends on:** US-006, US-019 · **Status:** ☐ pending

**Acceptance criteria:**
- Given `explore("orders")`, then it returns: the pivot table(s) with summarized columns, inbound/outbound FKs, views using it, procs/triggers reading/writing it — grouped and in compact format.
- Given a term matching several entities, then it returns the disambiguation list (it does not guess).
- With `detail: brief` it fits in ≤ 800 tokens for an entity with ≤ 30 relationships (format-spec budget).

### US-011 — dbgraph_search
**As** an agent, **I want** to search objects by approximate name or comment, **so that** I can locate things without knowing the exact name.
**Phase:** 5 · **Depends on:** US-006, US-019 · **Status:** ☐ pending

**Acceptance criteria:**
- Given `search("custmer")` (typo), then FTS returns `customers` and related objects, ranked.
- It also searches catalog comments/descriptions, and bodies only when at `full` level.
- Paginated results with declared `total`; each hit includes type and qualified name.

### US-012 — dbgraph_object
**As** an agent, **I want** the full detail of ONE object, **so that** I can go deep after explore/search.
**Phase:** 5 · **Depends on:** US-006, US-019 · **Status:** ☐ pending

**Acceptance criteria:**
- Given `object("dbo.orders")`, then: columns with types/nullability/defaults, PK/FKs/checks, indexes with columns and kind, triggers with event, comments.
- Given a proc at `full` level, the body is included; at `metadata` level, signature + edges are included and it says so explicitly.
- Given a name ambiguous across schemas (`orders` in `dbo` and `sales`), it asks for qualification listing the candidates.

### US-013 — dbgraph_related
**As** an agent, **I want** the direct neighbors of a node, **so that** I can walk the graph step by step.
**Phase:** 5 · **Depends on:** US-006, US-019 · **Status:** ☐ pending

**Acceptance criteria:**
- Returns neighbors grouped by edge kind (references in/out, depends_on, reads/writes, fires_on), with explicit direction.
- Inferred edges appear separately, marked with their score.
- A `kinds` parameter filters edge kinds; without it, all are returned.

### US-014 — dbgraph_impact
**As** an agent, **I want** the transitive blast radius of a change to a table or column, **so that** I know what breaks BEFORE proposing the change.
**Phase:** 5 · **Depends on:** US-007 · **Status:** ☐ pending

**Acceptance criteria:**
- Given `impact("orders.status")`, then it transitively lists: indexes containing it, FKs, views selecting it, procs/triggers reading or writing it — with the dependency CHAIN visible (a→b→c), not just the set.
- It separates READ impact (will break on read) from WRITE impact (may corrupt data).
- Depth limited with `depth` (default 3) and a warning when truncated.
- If any object in the chain has `has_dynamic_sql`, it warns ("impact possibly incomplete").

### US-015 — dbgraph_path
**As** an agent writing queries, **I want** the join path between two tables, **so that** I can generate correct JOINs without guessing.
**Phase:** 5 · **Depends on:** US-006, US-008 · **Status:** ☐ pending

**Acceptance criteria:**
- Given `path("customers", "shipments")`, then it returns the shortest route via FKs with the exact join columns of each hop.
- If the only route uses inferred edges, it is returned marked as inferred.
- If there is no route, it says so and suggests the closest neighbors of each end.

### US-016 — dbgraph_precheck
**As** an agent about to execute a change, **I want** a pre-flight of the proposed change, **so that** I know what to test and what could break — the database "PR check".
**Phase:** 5 · **Depends on:** US-014 · **Status:** ☐ pending

**Acceptance criteria:**
- Accepts an object/column ("I will alter orders.status") OR a DDL script.
- Returns sections: TRIGGERS firing on what is affected · WHO WRITES/READS (procs, views) · CONSTRAINTS/INDEXES involved · WHAT TO TEST (list derived from the edges).
- Given a DDL with several statements, it aggregates the precheck of all of them, deduplicated.
- Everything derived from SQL parsing carries its visible `confidence`.

### US-017 — dbgraph_status
**As** an agent, **I want** to know whether the index is trustworthy RIGHT NOW, **so that** I can decide to request a re-sync before acting.
**Phase:** 5 · **Depends on:** US-009 · **Status:** ☐ pending

**Acceptance criteria:**
- Reports: engine and version, last sync timestamp, drift detected yes/no, per-type counts, configured levels, objects excluded by filters.
- Runs the live fingerprint when the connection is available; otherwise it says so and reports local state only.

### US-018 — Instructions in initialize
**As** a freshly connected agent, **I want** to receive the MCP usage instructions automatically, **so that** I use the tools well without an external instructions file.
**Phase:** 5 · **Depends on:** US-010..017 · **Status:** ☐ pending

**Acceptance criteria:**
- The `initialize` response includes guidance: when to use explore vs search vs object, and the recommended pre-change flow (status → explore → precheck).
- Each tool description includes ONE example call.
- Zero instruction files for the user to maintain (codegraph parity).

### US-019 — Compact format with token budget
**As** the project, **I want** an output format designed and PINNED by spec, **so that** the "fewer tokens" promise is measurable and stable.
**Phase:** 5 (step 1 — BEFORE the server) · **Depends on:** US-006 · **Status:** ☐ pending

**Acceptance criteria:**
- `docs/format-spec.md` exists with the grammar of each line (table, column, edge, annotations `[3 idx, 1 trg!]`) and a token budget per tool × `detail` level.
- Every tool has golden files pinning the format; changing a golden requires updating the spec and justifying the token delta in the PR.
- The format is deterministic text (same graph → same output, byte for byte), no verbose JSON.
