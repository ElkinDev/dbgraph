/**
 * open-connections — task 7.6 cleanup (phase-4-cli-config).
 *
 * Extracts the duplicated config-loading, secret-resolution, adapter creation,
 * and store creation logic that was previously copied between:
 *   - syncAfterInit (src/cli/commands/init.ts)
 *   - openAdapterAndStore (src/cli/dispatch.ts)
 *
 * This module is the SINGLE source for "read config → resolve secrets → open
 * adapter + store". Both callers are routed through it.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + node builtins.
 * No adapter imports, no process.exit.
 * Security: resolved secrets are NEVER logged; the resolved config is ephemeral.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { parseConfig } from './parse-config.js';
import { resolveSecrets } from './resolve-secrets.js';
import {
  createSqliteSchemaAdapter,
  createMssqlSchemaAdapter,
  createSqliteGraphStore,
} from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Return types
// ─────────────────────────────────────────────────────────────────────────────

export type AdapterAndStore = {
  adapter:
    | Awaited<ReturnType<typeof createSqliteSchemaAdapter>>
    | Awaited<ReturnType<typeof createMssqlSchemaAdapter>>;
  store: Awaited<ReturnType<typeof createSqliteGraphStore>>;
};

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
 * Throws ConfigError if:
 *   - dbgraph.config.json is missing or malformed
 *   - any ${env:VAR} reference is unresolved
 */
export async function openConnections(projectRoot: string): Promise<AdapterAndStore> {
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
    | Awaited<ReturnType<typeof createMssqlSchemaAdapter>>;

  if (resolved.dialect === 'sqlite') {
    adapter = await createSqliteSchemaAdapter({
      file: resolved.source.file,
      ...(resolved.driver !== undefined ? { driver: resolved.driver } : {}),
    });
  } else {
    // mssql
    const src = resolved.source;
    adapter = await createMssqlSchemaAdapter({
      server: src.server,
      ...(src.port !== undefined ? { port: parseInt(src.port, 10) } : {}),
      database: src.database,
      authentication:
        src.domain !== undefined
          ? { type: 'ntlm', domain: src.domain, user: src.user, password: src.password }
          : { type: 'sql', user: src.user, password: src.password },
    });
  }

  // Open graph store
  const storePath = join(dbgraphDir, 'dbgraph.db');
  const store = await createSqliteGraphStore({ path: storePath });

  return { adapter, store };
}
