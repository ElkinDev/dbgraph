/**
 * Barrel for the SQLite GraphStore adapter.
 * Design §2 (module layout) — re-exports the factory and supporting types.
 * Adapter lives under src/adapters/storage/sqlite/ and is EXEMPT from the
 * write-verb security scan (design §1 exemption comment in factory.ts).
 */

export { createSqliteGraphStore } from './factory.js';
export type { SqliteGraphStoreOptions } from './factory.js';
