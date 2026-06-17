# ADR-008: Deterministic indexing — no LLM on the critical path

**Status:** Accepted · **Date:** 2026-06-11

**Context:** The question came up of using (multi-)agent LLMs to "collect" the schema.

**Decision:** indexing is 100% deterministic: system catalogs are exact data to be READ, not
interpreted. An LLM there would reintroduce tokens, latency and non-determinism — exactly what
dbgraph eliminates (codegraph does the same with tree-sitter). Multi-agents belong on the
CONSUMPTION side (concurrent MCP reads, SQLite in read mode) and in the optional enrichment
`dbgraph annotate` (backlog): LLM one-line summaries of procs/triggers as node annotations,
never on the sync path.

**Consequences:** same graph → same output, byte for byte (golden files are possible); the
interpretation value stays in the client LLM, where it belongs.
