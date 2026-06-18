/**
 * createMssqlSchemaAdapter — factory for the SQL Server schema extraction adapter.
 * Design §factory.ts "lazy import('mssql'), pool connect, wire driver, map errors".
 *
 * Responsibilities:
 *   1. Lazy dynamic import of mssql (optionalDependency, ADR-006).
 *      Missing mssql → ConnectionError naming "npm i mssql".
 *   2. Construct mssql.ConnectionPool from MssqlAdapterConfig.
 *   3. Connect the pool; map connect failures through error-mapper.
 *   4. Wrap the connected pool in MssqlReadonlyDriver.
 *   5. Return MssqlSchemaAdapter wrapping the driver.
 *
 * US-027 (SQL Server adapter), ADR-006 (lazy optional import), ADR-004 (seam).
 */

import type { SchemaAdapter } from '../../../core/ports/schema-adapter.js';
import type { MssqlAdapterConfig } from '../../../core/ports/schema-adapter.js';
import { ConnectionError } from '../../../core/errors.js';
import { createMssqlReadonlyDriver } from './driver.js';
import { mapMssqlError } from './error-mapper.js';
import { MssqlSchemaAdapter } from './mssql-schema-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a SQL Server connection pool and returns a SchemaAdapter.
 * The adapter is already-connected — no open() call is needed.
 *
 * @param config - MssqlAdapterConfig: server/database/authentication/TLS options.
 * @throws ConnectionError if mssql is not installed (npm i mssql).
 * @throws ConnectionError if the pool cannot connect (credentials, network, TLS, Kerberos).
 * @throws PermissionError if the login lacks VIEW DEFINITION (error 229).
 */
export async function createMssqlSchemaAdapter(
  config: MssqlAdapterConfig,
): Promise<SchemaAdapter> {
  // ── Step 1: Lazy import mssql (ADR-006 — optional dependency) ────────────
  // mssql 12.x does not ship bundled type declarations; import as unknown and
  // cast to the duck-typed interface we define locally (mirrors node:sqlite pattern).
  let mssqlMod: { ConnectionPool: new(cfg: unknown) => MssqlPool };
  try {
    mssqlMod = await import('mssql' as string) as unknown as typeof mssqlMod;
  } catch (cause) {
    throw new ConnectionError(
      "Required driver 'mssql' is not installed. Run: npm i mssql",
      cause,
    );
  }

  // ── Step 2: Build the pool config from MssqlAdapterConfig ────────────────
  const poolConfig = buildPoolConfig(config);

  // ── Step 3: Connect the pool; map errors ─────────────────────────────────
  let pool: MssqlPool;
  try {
    const { ConnectionPool } = mssqlMod;
    const instance = new ConnectionPool(poolConfig);
    pool = await instance.connect();
  } catch (cause) {
    throw mapMssqlError(cause);
  }

  // ── Step 4: Wrap in driver seam ──────────────────────────────────────────
  const driver = createMssqlReadonlyDriver(pool);

  // ── Step 5: Return adapter ────────────────────────────────────────────────
  return new MssqlSchemaAdapter(driver);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool config builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the mssql ConnectionPool config object from MssqlAdapterConfig.
 * Maps authentication.type 'sql' and 'ntlm' to the mssql config shape.
 * exactOptionalPropertyTypes: conditional spread for optional fields.
 */
function buildPoolConfig(config: MssqlAdapterConfig): Record<string, unknown> {
  const auth = config.authentication;

  const baseConfig: Record<string, unknown> = {
    server: config.server,
    database: config.database,
    options: {
      ...(config.port !== undefined ? { port: config.port } : {}),
      ...(config.encrypt !== undefined ? { encrypt: config.encrypt } : { encrypt: true }),
      ...(config.trustServerCertificate !== undefined
        ? { trustServerCertificate: config.trustServerCertificate }
        : {}),
    },
  };

  if (auth.type === 'sql') {
    baseConfig['user'] = auth.user;
    baseConfig['password'] = auth.password;
  } else if (auth.type === 'ntlm') {
    baseConfig['domain'] = auth.domain;
    baseConfig['user'] = auth.user;
    baseConfig['password'] = auth.password;
  }
  // integrated: no credentials — the strategy registry (Batch C) handles this path

  return baseConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duck-typed pool interface (avoids importing mssql types at module level)
// ─────────────────────────────────────────────────────────────────────────────

interface MssqlPool {
  connect(): Promise<this>;
  request(): {
    query(sql: string): Promise<{ recordset: Record<string, unknown>[] }>;
  };
  close(): Promise<void>;
}
