/**
 * Package public API — design §2.
 * Re-exports everything from the core barrel plus the SQLite adapter factory.
 * The adapter factory is the ONLY place core and adapters are joined (ADR-004).
 *
 * Consumers: import from '@niklerk23/dbgraph' — never from internal sub-paths.
 */

export const DBGRAPH_VERSION = '0.0.0';

// Re-export the entire core public surface
export * from './core/index.js';

// Adapter factory — wired here so core never imports it (ADR-004)
export { createSqliteGraphStore } from './adapters/storage/sqlite/factory.js';

// Schema extraction adapter factories — the ONLY composition-root join points (ADR-004, US-026)
export { createSqliteSchemaAdapter } from './adapters/engines/sqlite/factory.js';
export { createMssqlSchemaAdapter } from './adapters/engines/mssql/factory.js';
