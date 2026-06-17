# ADR-005: Local SQLite + FTS5 storage

**Status:** Accepted · **Date:** 2026-06-11

**Context:** The graph needs local persistence, full-text search, and zero external services
(codegraph parity: 100% local, no telemetry).

**Decision:** `.dbgraph/dbgraph.db` with `nodes`, `edges`, `nodes_fts` (FTS5), `snapshots`,
`meta` tables. Driver: `better-sqlite3` on the npm path; built-in `node:sqlite` for the
self-contained binaries (verified available on Node 22). `body_hash` enables incremental sync;
snapshots enable `diff` and drift detection via `fingerprint()`.

**Consequences:** `.dbgraph/` is ALWAYS gitignored (the schema is sensitive); the `GraphStore`
port (ADR-004) absorbs the driver duality.
