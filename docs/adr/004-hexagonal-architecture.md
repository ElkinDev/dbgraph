# ADR-004: Hexagonal architecture (ports and adapters)

**Status:** Accepted · **Date:** 2026-06-11

**Context:** 5 different engines, 3 inbound interfaces (MCP, CLI, API), and a pure-logic core
that must be testable without infrastructure.

**Decision:** `src/core` (model, normalizer, storage, query) imports NOTHING from drivers, MCP
or CLI. Ports: `SchemaAdapter` (extraction) and `GraphStore` (persistence). Driven adapters:
the 5 engines and the SQLite storage. Driving adapters: MCP, CLI, programmatic API.

**Consequences:** the core is fully testable without starting a database; adding an engine
never touches the core; storage is swappable (better-sqlite3 ↔ node:sqlite, key for binaries);
a lint boundary rule enforces layer separation.
