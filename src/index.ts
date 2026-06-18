/**
 * Package public API — design §2.
 * Re-exports everything from the core barrel plus the SQLite adapter factory.
 * The adapter factory is the ONLY place core and adapters are joined (ADR-004).
 *
 * Consumers: import from '@niklerk23/dbgraph' — never from internal sub-paths.
 */

export const DBGRAPH_VERSION = '0.0.0';

// ── Infrastructure utilities (composition seam — task 2.1/2.2, phase-5-mcp-server) ─
// openConnections is re-exported here so both CLI and MCP can consume it without
// either importing the other layer (ADR-004, Design Decision 4).
export { openConnections } from './infra/open-connections.js';
export type { AdapterAndStore } from './infra/open-connections.js';

// Re-export the entire core public surface
export * from './core/index.js';

// Adapter factory — wired here so core never imports it (ADR-004)
export { createSqliteGraphStore } from './adapters/storage/sqlite/factory.js';

// Schema extraction adapter factories — the ONLY composition-root join points (ADR-004, US-026)
export { createSqliteSchemaAdapter } from './adapters/engines/sqlite/factory.js';
export { createMssqlSchemaAdapter } from './adapters/engines/mssql/factory.js';
export { createPgSchemaAdapter } from './adapters/engines/pg/factory.js';

// ── Capability lookup (Decision 6, phase-4-cli-config) ───────────────────────
// The CLI (and future MCP) must NOT import adapter modules directly (ADR-004).
// This composition root is the legal seam that exposes dialect matrices.
import { SQLITE_CAPABILITIES } from './adapters/engines/sqlite/capabilities.js';
import { MSSQL_CAPABILITIES } from './adapters/engines/mssql/capabilities.js';
import { PG_CAPABILITIES } from './adapters/engines/pg/capabilities.js';
import type { CapabilityMatrix } from './core/model/capability.js';
import { UnsupportedDialectError } from './core/errors.js';

// Re-export the capability constants so CLI/MCP modules can consume them
// without importing adapter internals directly (ADR-004 boundary).
export { SQLITE_CAPABILITIES, MSSQL_CAPABILITIES, PG_CAPABILITIES };

/**
 * Returns the static CapabilityMatrix for the given dialect WITHOUT opening
 * a database connection. Unknown dialect throws UnsupportedDialectError.
 * Design Decision 6 (phase-4-cli-config).
 */
export function capabilitiesFor(dialect: string): CapabilityMatrix {
  switch (dialect) {
    case 'sqlite':
      return SQLITE_CAPABILITIES;
    case 'mssql':
      return MSSQL_CAPABILITIES;
    case 'pg':
      return PG_CAPABILITIES;
    default:
      throw new UnsupportedDialectError(dialect);
  }
}
