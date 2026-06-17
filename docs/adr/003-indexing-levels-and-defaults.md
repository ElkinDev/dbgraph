# ADR-003: off/metadata/full indexing levels and conservative defaults

**Status:** Accepted · **Date:** 2026-06-11

**Context:** Indexing full bodies of hundreds of procedures bloats the index and the tokens;
not indexing them blinds the AI. The schema itself is sensitive information.

**Decision:** three levels per object type: `off` / `metadata` (signature + edges, no body) /
`full`. Defaults: structural core (tables, columns, PK/FK, indexes, views) always on;
**triggers `full`** (small bodies, maximum hidden logic); procedures/functions `metadata`;
statistics and sampling `off` (opt-in). MongoDB: STRUCTURAL sampling only (keys + types,
values never persisted).

**Consequences:** the per-adapter capability matrix drives `init`; a publicly defensible
privacy posture; the AI requests `full` only when it needs it.
