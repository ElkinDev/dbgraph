/**
 * Static usage instructions for the dbgraph MCP server (US-018).
 *
 * This string is surfaced in the MCP initialize response so that AI agents
 * understand how to use the 8 dbgraph tools effectively without consulting
 * external documentation.
 *
 * Design Decision 7 (phase-5-mcp-server): the instructions are a STATIC
 * golden-tested constant — no user-maintained instruction files, no runtime
 * computation. Changing this string REQUIRES updating the golden file
 * test/mcp/golden/instructions.txt.
 *
 * ADR-008: trailing newline, byte-identical on re-run.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Guidance string
// ─────────────────────────────────────────────────────────────────────────────

export const DBGRAPH_INSTRUCTIONS = `\
dbgraph exposes your database schema as a searchable graph. Use these tools:

DISCOVERY
  dbgraph_explore  — Given a table/view/proc name, returns all direct neighbors
                     (FKs, dependencies, triggers). Start here when you know the
                     object name. Example: dbgraph_explore({ target: "orders" })

  dbgraph_search   — Full-text search over names and bodies. Use when you only
                     know a keyword or partial name. Returns ranked hits with
                     type and qualified name.
                     Example: dbgraph_search({ query: "customer invoice" })

  dbgraph_object   — Assembles full detail for one object: columns with
                     type/nullability/default, PK/FK/check constraints, indexes,
                     triggers, and (at full detail) the body.
                     Example: dbgraph_object({ qname: "dbo.orders" })

  dbgraph_related  — Returns neighbors grouped by edge kind and direction.
                     Use the kinds filter to focus on a specific relationship.
                     Example: dbgraph_related({ qname: "dbo.orders", kinds: ["references"] })

IMPACT ANALYSIS
  dbgraph_impact   — Transitive read/write blast radius from an object.
                     Use before modifying a table or column.
                     Example: dbgraph_impact({ qname: "dbo.orders", depth: 3 })

  dbgraph_path     — Shortest JOIN path between two tables.
                     Example: dbgraph_path({ from: "customers", to: "shipments" })

PRE-CHANGE WORKFLOW
  Before making schema changes, run this flow:
    1. dbgraph_status   — confirm the index is fresh and drift is not detected
    2. dbgraph_explore  — understand the object and its immediate neighborhood
    3. dbgraph_precheck — analyze DDL statements and get aggregated impact

  dbgraph_precheck — Accepts raw DDL (ALTER TABLE, CREATE/DROP INDEX,
                     ADD/DROP COLUMN). Extracts identifiers, matches them
                     against the graph, and returns aggregated impact sections.
                     Every result carries confidence: parsed.
                     Example: dbgraph_precheck({ ddl: "ALTER TABLE dbo.orders DROP COLUMN status" })

  dbgraph_status   — Reports engine, last sync timestamp, per-type counts,
                     configured levels, excluded objects, and drift (live
                     fingerprint when a connection is available).
                     Example: dbgraph_status({})
`;
