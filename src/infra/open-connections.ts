/**
 * open-connections — composition-root utility (phase-5-mcp-server task 2.1).
 *
 * Relocated from src/cli/config/open-connections.ts to a NEUTRAL composition
 * layer so both the CLI and MCP adapter can consume it through the barrel
 * (src/index.ts) without either side importing the other's layer.
 *
 * Design Decision 4 (phase-5-mcp-server): infra MAY import adapter/store
 * factories — it is the composition seam. Both CLI and MCP import the barrel;
 * the barrel re-exports this module.
 *
 * ADR-004: imports from the barrel (../../index.js) for adapter/store factories;
 * config helpers imported from ./config/ (src/infra/config/) — NEVER from
 * src/cli/** (that direction violates the cli↔mcp decoupling, ADR-004).
 * Security: resolved secrets are NEVER logged; the resolved config is ephemeral.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseConfig } from './config/parse-config.js';
import { resolveSecrets } from './config/resolve-secrets.js';
import {
  createSqliteSchemaAdapter,
  createMssqlSchemaAdapter,
  createPgSchemaAdapter,
  createMysqlSchemaAdapter,
  createMongodbSchemaAdapter,
  createSqliteGraphStore,
} from '../index.js';
import type { Logger } from '../core/ports/logger.js';
import { noopLogger } from '../core/ports/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Return types
// ─────────────────────────────────────────────────────────────────────────────

export type AdapterAndStore = {
  adapter:
    | Awaited<ReturnType<typeof createSqliteSchemaAdapter>>
    | Awaited<ReturnType<typeof createMssqlSchemaAdapter>>
    | Awaited<ReturnType<typeof createPgSchemaAdapter>>
    | Awaited<ReturnType<typeof createMysqlSchemaAdapter>>
    | Awaited<ReturnType<typeof createMongodbSchemaAdapter>>;
  store: Awaited<ReturnType<typeof createSqliteGraphStore>>;
};

/** Injectable seams for {@link openConnections} (phase-9.5c, design D2). */
export interface OpenConnectionsDeps {
  /**
   * SEA detection override — default reads `node:sea`.isSea via createRequire
   * (NOT a static node:sea import). Inside a SEA binary this is true → the local
   * store flips to `node:sqlite`; off-SEA it is false → default better-sqlite3.
   */
  readonly isSea?: () => boolean;
}

function defaultIsSea(): boolean {
  try {
    const sea = createRequire(import.meta.url)('node:sea') as { isSea?: () => boolean };
    return typeof sea.isSea === 'function' ? sea.isSea() : false;
  } catch {
    // node:sea unavailable (older Node) → treat as not-a-SEA (npm/dev path).
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// openConnections — public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads dbgraph.config.json from projectRoot, resolves ${env:VAR} secrets,
 * creates the appropriate schema adapter, ensures .dbgraph/ exists, and
 * opens the SQLite graph store.
 *
 * Callers are responsible for calling adapter.close() and store.close() in a
 * finally block after use.
 *
 * @param projectRoot - The directory containing dbgraph.config.json.
 * @param logger      - Optional Logger for strategy-selection transparency.
 *                      Defaults to noopLogger (back-compat — existing callers
 *                      that do not pass a logger are unaffected).
 *
 * Throws ConfigError if:
 *   - dbgraph.config.json is missing or malformed
 *   - any ${env:VAR} reference is unresolved
 */
export async function openConnections(
  projectRoot: string,
  logger: Logger = noopLogger,
  deps: OpenConnectionsDeps = {},
): Promise<AdapterAndStore> {
  const isSea = deps.isSea ?? defaultIsSea;
  // Read and parse config
  const configPath = join(projectRoot, 'dbgraph.config.json');
  const rawJson: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
  const cfg = parseConfig(rawJson);

  // Resolve ${env:VAR} references — security: never log the resolved object
  const resolved = resolveSecrets(cfg);

  // Ensure .dbgraph/ directory exists
  const dbgraphDir = join(projectRoot, '.dbgraph');
  mkdirSync(dbgraphDir, { recursive: true });

  // Open adapter based on dialect
  let adapter:
    | Awaited<ReturnType<typeof createSqliteSchemaAdapter>>
    | Awaited<ReturnType<typeof createMssqlSchemaAdapter>>
    | Awaited<ReturnType<typeof createPgSchemaAdapter>>
    | Awaited<ReturnType<typeof createMysqlSchemaAdapter>>
    | Awaited<ReturnType<typeof createMongodbSchemaAdapter>>;

  if (resolved.dialect === 'sqlite') {
    adapter = await createSqliteSchemaAdapter({
      file: resolved.source.file,
      ...(resolved.driver !== undefined ? { driver: resolved.driver } : {}),
    });
  } else if (resolved.dialect === 'pg') {
    // Wire the PgSchemaAdapter via its factory (Batch 5, task 5.2).
    // resolved.source is PgSource (all ${env:VAR} already resolved by resolveSecrets).
    const src = resolved.source;
    adapter = await createPgSchemaAdapter({
      host: src.host,
      ...(src.port !== undefined ? { port: parseInt(src.port, 10) } : {}),
      database: src.database,
      user: src.user,
      password: src.password,
      ...(src.ssl !== undefined ? { ssl: src.ssl === 'true' } : {}),
      ...(src.schema !== undefined ? { schema: src.schema } : {}),
    });
  } else if (resolved.dialect === 'mysql') {
    // Wire the MysqlSchemaAdapter via its factory (Batch 5, task 5.1).
    // resolved.source is MysqlSource (all ${env:VAR} already resolved by resolveSecrets).
    const src = resolved.source;
    adapter = await createMysqlSchemaAdapter({
      host: src.host,
      ...(src.port !== undefined ? { port: parseInt(src.port, 10) } : {}),
      database: src.database,
      user: src.user,
      password: src.password,
      ...(src.ssl !== undefined ? { ssl: src.ssl === 'true' } : {}),
    });
  } else if (resolved.dialect === 'mongodb') {
    // Wire the MongodbSchemaAdapter via its factory (Batch 5, task 5.1).
    // resolved.source is MongodbSource (all ${env:VAR} already resolved by resolveSecrets).
    const src = resolved.source;
    adapter = await createMongodbSchemaAdapter({
      uri: src.uri,
      database: src.database,
      ...(src.sampleSize !== undefined ? { sampleSize: src.sampleSize } : {}),
      ...(src.tls !== undefined ? { tls: src.tls } : {}),
    });
  } else {
    // mssql
    const src = resolved.source;
    // Build the authentication union based on the resolved auth discriminant (A1.5/A1.6).
    let authentication: import('../core/ports/schema-adapter.js').MssqlAdapterConfig['authentication'];
    if (src.auth === 'integrated') {
      authentication = { type: 'integrated' };
    } else if (src.domain !== undefined) {
      // ntlm — credentials guaranteed present after resolveSecrets
      authentication = {
        type: 'ntlm',
        domain: src.domain,
        user: src.user as string,
        password: src.password as string,
      };
    } else {
      // sql — credentials guaranteed present after resolveSecrets
      authentication = {
        type: 'sql',
        user: src.user as string,
        password: src.password as string,
      };
    }
    adapter = await createMssqlSchemaAdapter(
      {
        server: src.server,
        ...(src.port !== undefined ? { port: parseInt(src.port, 10) } : {}),
        database: src.database,
        authentication,
      },
      { logger },
    );
  }

  // Open graph store. Under a SEA binary the local store MUST use the in-binary
  // node:sqlite driver (better-sqlite3's native module is absent in a no-node_modules
  // binary); off-SEA the default stays better-sqlite3 — byte-identical (ADR-008, D2).
  // Conditional spread respects exactOptionalPropertyTypes (key absent when off-SEA).
  const storePath = join(dbgraphDir, 'dbgraph.db');
  const store = await createSqliteGraphStore({
    path: storePath,
    ...(isSea() ? { driver: 'node:sqlite' as const } : {}),
  });

  return { adapter, store };
}
