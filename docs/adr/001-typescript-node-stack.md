# ADR-001: TypeScript/Node.js stack

**Status:** Accepted · **Date:** 2026-06-11

**Context:** The project needs drivers for 5 database engines, a mature MCP SDK, and simple
distribution, on a dev machine where only npm packages may be installed.

**Decision:** TypeScript on Node.js >= 20. Official `@modelcontextprotocol/sdk`. Distribution
via npm; self-contained binaries in Phase 9.5 (future ADR after the SEA vs bun spike).

**Consequences:** 100% JavaScript drivers available for every engine (ADR-006); larger
contributor base in the AI-tooling niche; v0.1 requires Node installed.

**Amendment (2026-06-12):** minimum Node raised from >=20 to **>=22** and the CI matrix moved
to 22.x/24.x — Node 20 reached end-of-life on 2026-04-30 and its jobs broke the matrix. A
pre-release project does not support EOL runtimes. Bonus: `node:sqlite` (>=22.5) is now
available on every supported runtime.
