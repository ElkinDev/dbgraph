# E1 — Indexing & init

Epic goal: from the `init` command to a built graph, never touching the database with writes.
Plan references: §4.7 (init contract), §4.8 (configuration), §4.5 (sync).

---

### US-001 — Non-interactive init
**As** a developer, **I want** to initialize dbgraph with parameters (`--dialect`, `--url`), **so that** I can build the graph in a single command and automate it.
**Phase:** 4 · **Depends on:** US-006, US-026 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- Given `dbgraph init --dialect sqlite --url ./fixture.db`, when I run it, then it validates the connection, writes the committeable `dbgraph.config.json` at the project ROOT WITHOUT secrets (`${env:VAR}` references only), adds `.dbgraph/` (the index + local state) to `.gitignore`, and runs the first sync; exit code 0.
- Given an unreachable host, when I run init, then exit 2 with a message distinguishing "DNS does not resolve" / "connection refused" / "timeout".
- Given a user without catalog permissions, when I run init, then exit 3 and the message names the EXACT missing permission and the command to grant it.
- Given an unsupported `--dialect`, then exit 4 listing the available dialects.

### US-002 — Interactive init driven by capabilities
**As** a developer, **I want** `dbgraph init -i` with a wizard, **so that** I can configure without knowing the options in advance.
**Phase:** 4 · **Depends on:** US-001 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- Given a chosen dialect, when the wizard offers object types, then it ONLY shows those the adapter's `CapabilityMatrix` declares (SQLite does not offer procedures; MongoDB does not offer triggers).
- Given the connection step, when I type a literal password, then the wizard rejects it and asks for a `${env:VAR}` reference.
- The final result of `init -i` and of `init` with equivalent flags is byte-for-byte the same `config.json`.

### US-003 — off/metadata/full levels per object type
**As** a user, **I want** to control how much of each object type gets indexed, **so that** I can balance context vs size/sensitivity.
**Phase:** 1 (model) + 4 (config) · **Depends on:** US-006 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- Given `procedures: "metadata"`, when I sync, then the proc node exists with signature and reads/writes edges, but the body is NOT in the index nor in FTS.
- Given `procedures: "full"`, then the normalized body is available in `dbgraph_object` and FTS indexes it.
- Given `triggers` unset, then the default `full` applies; `procedures/functions` default to `metadata`; `statistics/sampling` default to `off`.
- Given `indexes: "off"`, then there are no index nodes and `dbgraph_object` for a table says so ("indexes not indexed by configuration").

### US-004 — Include/exclude filters
**As** a user with a huge schema, **I want** to include/exclude objects by pattern, **so that** only what matters gets indexed.
**Phase:** 4 · **Depends on:** US-001 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- Given `include: ["dbo.*"]` and `exclude: ["*.audit_*"]`, when I sync, then only `dbo` objects enter and none whose name matches `audit_`.
- Given an excluded object referenced by an included one (FK to an excluded table), then the edge exists with a "stub" node marked `excluded: true` — the graph never lies about relationships.
- `dbgraph status` reports how many objects were left out by filters.

### US-005 — Incremental sync
**As** a user, **I want** `dbgraph sync` to re-process only what changed, **so that** the graph stays fresh in seconds.
**Phase:** 4 · **Depends on:** US-001, US-009 · **Status:** ☑ done (phase-4-cli-config)

**Acceptance criteria:**
- Given an existing graph and a single procedure modified in the database, when I sync, then only that object is re-extracted (verifiable via log/counter) and the rest is preserved.
- Given an object deleted in the database, then its node and edges disappear from the graph and the snapshot records it as deleted.
- Every sync creates a `snapshots` entry with per-type counts; `sync --full` forces full re-extraction.
