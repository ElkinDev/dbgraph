/**
 * Testcontainers harness for SQL Server integration tests.
 * Design §container.ts "start, apply torture.sql, teardown, skip helper".
 *
 * Wait strategy: polls SELECT 1 over a TDS connection until success (NOT port-open).
 * SQL Server accepts TDS 20-40s AFTER the port opens; a port-open probe is insufficient.
 * Per-suite hookTimeout must be >= 240000 (240s) — container cold start + first image
 * pull (~1.5 GB) can take several minutes on a fresh runner.
 *
 * Gate: suites use describe.skipIf(!process.env.DBGRAPH_INTEGRATION) so the unit matrix
 * and Docker-less contributors stay green.
 *
 * US-027 (torture fixture materialised via Testcontainers).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { MssqlAdapterConfig } from '../../../src/core/ports/schema-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MSSQL_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest';
const MSSQL_PORT = 1433;
// Strong SA password: >= 8 chars, upper/lower/digit/symbol (SQL Server policy)
const SA_PASSWORD = 'DbGr@ph2024!';
// Poll SELECT 1 every 2s, for up to 120s (SQL Server TDS readiness after port open)
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface MssqlContainerHandle {
  /** MssqlAdapterConfig pre-built for the running container. */
  readonly config: MssqlAdapterConfig;
  /** Stop the container (call in afterAll). */
  stop(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when DBGRAPH_INTEGRATION=1 is set.
 * Integration suites use:
 *   describe.skipIf(!mssqlIntegrationEnabled())('...', () => { ... });
 * so Docker-less contributors and the unit matrix both stay green.
 */
export function mssqlIntegrationEnabled(): boolean {
  return process.env['DBGRAPH_INTEGRATION'] === '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// TDS readiness polling (wait strategy: SELECT 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls SELECT 1 via a real TDS connection until success or timeout.
 * Uses a dynamic import of mssql to avoid mandatory runtime dependency.
 */
async function waitForTds(config: MssqlAdapterConfig): Promise<void> {
  let mssqlMod: {
    ConnectionPool: new (cfg: unknown) => {
      connect(): Promise<{ request(): { query(sql: string): Promise<unknown> }; close(): Promise<void> }>;
    };
  };
  try {
    mssqlMod = await import('mssql' as string) as unknown as typeof mssqlMod;
  } catch {
    throw new Error(
      'mssql package is not installed. Run: npm i mssql',
    );
  }

  const poolCfg = {
    server: config.server,
    port: config.port,
    database: 'master',
    user: (config.authentication as { user: string }).user,
    password: (config.authentication as { password: string }).password,
    options: {
      encrypt: config.encrypt ?? true,
      trustServerCertificate: config.trustServerCertificate ?? true,
    },
  };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    let pool: { request(): { query(sql: string): Promise<unknown> }; close(): Promise<void> } | null = null;
    try {
      pool = await new mssqlMod.ConnectionPool(poolCfg).connect();
      await pool.request().query('SELECT 1 AS ok');
      await pool.close();
      return; // SQL Server is ready
    } catch (err) {
      lastError = err;
      if (pool !== null) {
        try { await pool.close(); } catch { /* ignore */ }
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `SQL Server TDS readiness poll timed out after ${POLL_TIMEOUT_MS}ms. Last error: ${msg}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply torture.sql
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies torture.sql to the running container via separate statements.
 * SQL Server does not support multiple statements in a single EXEC — we split on GO.
 */
async function applyTortureSql(config: MssqlAdapterConfig): Promise<void> {
  let mssqlMod: {
    ConnectionPool: new (cfg: unknown) => {
      connect(): Promise<{
        request(): { query(sql: string): Promise<unknown> };
        close(): Promise<void>;
      }>;
    };
  };
  try {
    mssqlMod = await import('mssql' as string) as unknown as typeof mssqlMod;
  } catch {
    throw new Error('mssql package is not installed. Run: npm i mssql');
  }

  const sqlPath = join(__dirname, 'torture.sql');
  const sqlContent = readFileSync(sqlPath, 'utf-8');

  // Split on GO (batch separator), filter empty batches
  const batches = sqlContent
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const poolCfg = {
    server: config.server,
    port: config.port,
    database: 'master',
    user: (config.authentication as { user: string }).user,
    password: (config.authentication as { password: string }).password,
    options: {
      encrypt: config.encrypt ?? true,
      trustServerCertificate: config.trustServerCertificate ?? true,
      // Multiple active result sets needed for batched execution
    },
  };

  const pool = await new mssqlMod.ConnectionPool(poolCfg).connect();
  try {
    for (const batch of batches) {
      await pool.request().query(batch);
    }
  } finally {
    await pool.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main harness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts an ephemeral SQL Server container, waits for TDS readiness,
 * applies torture.sql, and returns a handle with config + stop().
 *
 * IMPORTANT: the caller's beforeAll hook MUST set hookTimeout >= 240000:
 *   beforeAll(async () => { handle = await startMssqlContainer(); }, 240_000);
 *
 * The per-suite hookTimeout is intentionally set on the hook (not via global vitest.config),
 * because container cold starts need their own ceiling separate from unit test hooks.
 */
export async function startMssqlContainer(): Promise<MssqlContainerHandle> {
  const container: StartedTestContainer = await new GenericContainer(MSSQL_IMAGE)
    .withEnvironment({
      ACCEPT_EULA: 'Y',
      MSSQL_SA_PASSWORD: SA_PASSWORD,
    })
    .withExposedPorts(MSSQL_PORT)
    // Use port-open as initial signal (fast), then poll TDS below (required)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(240_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(MSSQL_PORT);

  const config: MssqlAdapterConfig = {
    server: host,
    port,
    database: 'master',
    authentication: {
      type: 'sql',
      user: 'sa',
      password: SA_PASSWORD,
    },
    encrypt: true,
    trustServerCertificate: true,
  };

  // Wait for actual TDS readiness (port open != TDS ready on SQL Server)
  await waitForTds(config);

  // Apply torture.sql fixture
  await applyTortureSql(config);

  return {
    config,
    stop: async () => {
      await container.stop();
    },
  };
}
