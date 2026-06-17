# ADR-002: v1 engines — Core 5 and implementation order

**Status:** Accepted · **Date:** 2026-06-11

**Context:** Supporting "any database" from day one is not feasible; scope must be chosen.

**Decision:** v1.0 = PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, MongoDB (~80% of the
market, proves SQL + NoSQL). Order: SQLite (validates the pipeline with zero infrastructure) →
SQL Server (real-world validation against an enterprise database) → PostgreSQL/MySQL → MongoDB
(inference, the most novel work). Other engines: contributions via the adapter guide.

**Consequences:** the adapter architecture (ADR-004) is the structural priority; the per-engine
"torture schema" is the unit of verification.
