/**
 * Testcontainers harness for MySQL integration tests.
 * Design §container.ts "start mysql:8, apply torture.sql, teardown, skip helper".
 *
 * Wait strategy: polls SELECT 1 over a real mysql2 connection (NOT port-open alone).
 * MySQL accepts connections several seconds after the port opens; a port-open
 * probe alone is insufficient on slow CI runners.
 *
 * Gate: suites use describe.skipIf(!mysqlIntegrationEnabled()) so the unit matrix
 * and Docker-less contributors stay green.
 *
 * Torture SQL is applied with multipleStatements: true on a dedicated seed
 * connection (never exposed to the adapter under test, which uses a standard connection).
 *
 * US-029 (torture fixture materialised via Testcontainers), ADR-006 (lazy mysql2 import).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { MysqlAdapterConfig } from '../../../src/core/ports/schema-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MYSQL_IMAGE = 'mysql:8';
const MYSQL_PORT = 3306;
const MYSQL_ROOT_PASSWORD = 'DbGr@ph2024!';
const MYSQL_DATABASE = 'app';
const MYSQL_USER = 'root';

/**
 * Poll SELECT 1 every 2000ms, up to 120 seconds.
 * MySQL is slower than pg to accept connections after port-open.
 * 2s interval significantly reduces connection churn when multiple test files
 * run parallel containers (avoids ER_CON_COUNT_ERROR on the other container).
 */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface MysqlContainerHandle {
  /** MysqlAdapterConfig pre-built for the running container (password already resolved). */
  readonly config: MysqlAdapterConfig;
  /** Stop the container (call in afterAll). */
  stop(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when DBGRAPH_INTEGRATION=1 is set.
 * Integration suites use:
 *   describe.skipIf(!mysqlIntegrationEnabled())('...', () => { ... });
 * so Docker-less contributors and the unit matrix both stay green.
 */
export function mysqlIntegrationEnabled(): boolean {
  return process.env['DBGRAPH_INTEGRATION'] === '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// MySQL readiness polling (wait strategy: SELECT 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls SELECT 1 via a real mysql2 connection until success or timeout.
 * Uses a dynamic import of mysql2/promise to avoid mandatory runtime dependency (ADR-006).
 *
 * Port-open is insufficient: MySQL accepts TCP connections but rejects queries
 * for several seconds while it initialises the grant tables and starts up InnoDB.
 */
// ─────────────────────────────────────────────────────────────────────────────
// mysql2/promise connection type helper (avoid importing types at top level)
// mysql2/promise: createConnection() returns Promise<Connection>
// Connection has: query(), end() — NO .connect() method (auto-connected).
// ─────────────────────────────────────────────────────────────────────────────

interface Mysql2PromiseMod {
  createConnection(cfg: Record<string, unknown>): Promise<{
    query(sql: string, params?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  }>;
}

async function waitForMysql(host: string, port: number): Promise<void> {
  // Dynamic import — mysql2 is an optional dep (ADR-006)
  let mysql2Mod: Mysql2PromiseMod;

  try {
    mysql2Mod = await import('mysql2/promise' as string) as Mysql2PromiseMod;
  } catch {
    throw new Error('mysql2 package is not installed. Run: npm i mysql2');
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    // Sleep BEFORE attempting — avoids connection storms on first-available-port
    await sleep(POLL_INTERVAL_MS);

    let conn: { query(sql: string): Promise<unknown>; end(): Promise<void> } | undefined;
    try {
      // mysql2/promise: createConnection returns Promise<Connection> (auto-connected)
      conn = await mysql2Mod.createConnection({
        host,
        port,
        user: MYSQL_USER,
        password: MYSQL_ROOT_PASSWORD,
        database: MYSQL_DATABASE,
        connectTimeout: 2000,
      });
      await conn.query('SELECT 1 AS ok');
      await conn.end();
      return; // MySQL is ready
    } catch (err) {
      lastError = err;
      if (conn !== undefined) {
        try { await conn.end(); } catch { /* ignore — connection may not be usable */ }
      }
      // No additional sleep — the POLL_INTERVAL_MS at the top handles pacing
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `MySQL readiness poll timed out after ${POLL_TIMEOUT_MS}ms. Last error: ${msg}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply torture.sql
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies torture.sql to the running container.
 * Uses multipleStatements: true on a DEDICATED seed connection (never reused).
 * The procedure/function/trigger bodies contain BEGIN...END blocks and embedded
 * semicolons — multipleStatements handles them correctly in one call.
 */
async function applyTortureSql(host: string, port: number): Promise<void> {
  let mysql2Mod: Mysql2PromiseMod;

  try {
    mysql2Mod = await import('mysql2/promise' as string) as Mysql2PromiseMod;
  } catch {
    throw new Error('mysql2 package is not installed. Run: npm i mysql2');
  }

  const sqlPath = join(__dirname, 'torture.sql');
  const sqlContent = readFileSync(sqlPath, 'utf-8');

  // Seed connection with multipleStatements: true — allows the full DDL file
  // (including procedure/function bodies with embedded semicolons) in one call.
  // mysql2/promise: createConnection() returns Promise<Connection> (auto-connected).
  const conn = await mysql2Mod.createConnection({
    host,
    port,
    user: MYSQL_USER,
    password: MYSQL_ROOT_PASSWORD,
    database: MYSQL_DATABASE,
    multipleStatements: true,
  });

  try {
    await conn.query(sqlContent);
  } finally {
    await conn.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main harness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts an ephemeral MySQL container, waits for readiness,
 * applies torture.sql, and returns a handle with config + stop().
 *
 * IMPORTANT: the caller beforeAll hook MUST set hookTimeout >= 120000:
 *   beforeAll(async () => { handle = await startMysqlContainer(); }, 120_000);
 *
 * The per-suite hookTimeout is intentionally set on the hook (not via global vitest.config),
 * because container cold starts need their own ceiling separate from unit test hooks.
 */
export async function startMysqlContainer(): Promise<MysqlContainerHandle> {
  const container: StartedTestContainer = await new GenericContainer(MYSQL_IMAGE)
    .withEnvironment({
      MYSQL_ROOT_PASSWORD: MYSQL_ROOT_PASSWORD,
      MYSQL_DATABASE: MYSQL_DATABASE,
    })
    .withExposedPorts(MYSQL_PORT)
    // Raise max_connections to avoid ER_CON_COUNT_ERROR when multiple test files
    // run parallel containers and each polls with its own readiness connection loop.
    // mysql:8 accepts mysqld options as CMD arguments after the image name.
    .withCommand(['--max_connections=500'])
    // Use port-open as initial signal (fast), then poll mysql below (required for correctness)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(MYSQL_PORT);

  // Wait for actual MySQL readiness (port open does NOT mean query-ready)
  await waitForMysql(host, port);

  // Apply torture.sql fixture
  await applyTortureSql(host, port);

  const config: MysqlAdapterConfig = {
    host,
    port,
    database: MYSQL_DATABASE,
    user: MYSQL_USER,
    password: MYSQL_ROOT_PASSWORD,
  };

  return {
    config,
    stop: async () => {
      await container.stop();
    },
  };
}
