/**
 * Testcontainers harness for PostgreSQL integration tests.
 * Design §container.ts "start postgres:16, apply torture.sql, teardown, skip helper".
 *
 * Wait strategy: polls `SELECT 1` over a real pg connection (NOT port-open alone).
 * PostgreSQL accepts connections a few seconds after the port opens; a port-open
 * probe alone is insufficient on slow CI runners.
 *
 * Gate: suites use describe.skipIf(!pgIntegrationEnabled()) so the unit matrix
 * and Docker-less contributors stay green.
 *
 * US-028 (torture fixture materialised via Testcontainers), ADR-006 (lazy pg import).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { PgAdapterConfig } from '../../../src/core/ports/schema-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PG_IMAGE = 'postgres:16';
const PG_PORT = 5432;
const PG_PASSWORD = 'DbGr@ph2024!';
const PG_DATABASE = 'dbgraph_test';
const PG_USER = 'postgres';

/** Poll SELECT 1 every 500ms, up to 60 seconds (pg is fast). */
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PgContainerHandle {
  /** PgAdapterConfig pre-built for the running container (password already resolved). */
  readonly config: PgAdapterConfig;
  /** Stop the container (call in afterAll). */
  stop(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when DBGRAPH_INTEGRATION=1 is set.
 * Integration suites use:
 *   describe.skipIf(!pgIntegrationEnabled())('...', () => { ... });
 * so Docker-less contributors and the unit matrix both stay green.
 */
export function pgIntegrationEnabled(): boolean {
  return process.env['DBGRAPH_INTEGRATION'] === '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// pg readiness polling (wait strategy: SELECT 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls SELECT 1 via a real pg connection until success or timeout.
 * Uses a dynamic import of pg to avoid mandatory runtime dependency (ADR-006).
 */
async function waitForPg(host: string, port: number): Promise<void> {
  // Dynamic import — pg is an optional dep (ADR-006)
  let pgMod: { Client: new (cfg: unknown) => { connect(): Promise<void>; query(sql: string): Promise<unknown>; end(): Promise<void> } };
  try {
    pgMod = await import('pg' as string) as typeof pgMod;
  } catch {
    throw new Error('pg package is not installed. Run: npm i pg');
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new pgMod.Client({
      host,
      port,
      user: PG_USER,
      password: PG_PASSWORD,
      database: PG_DATABASE,
    });
    try {
      await client.connect();
      await client.query('SELECT 1 AS ok');
      await client.end();
      return; // PostgreSQL is ready
    } catch (err) {
      lastError = err;
      try { await client.end(); } catch { /* ignore */ }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `PostgreSQL readiness poll timed out after ${POLL_TIMEOUT_MS}ms. Last error: ${msg}`,
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
 * PostgreSQL supports multiple DDL statements in a single query call.
 * We run the entire file as one batch — the pg driver supports multi-statement
 * queries separated by semicolons (unlike SQL Server which uses GO batches).
 * The $$ dollar-quoted function bodies are handled correctly by the server.
 */
async function applyTortureSql(host: string, port: number): Promise<void> {
  let pgMod: { Client: new (cfg: unknown) => { connect(): Promise<void>; query(sql: string): Promise<unknown>; end(): Promise<void> } };
  try {
    pgMod = await import('pg' as string) as typeof pgMod;
  } catch {
    throw new Error('pg package is not installed. Run: npm i pg');
  }

  const sqlPath = join(__dirname, 'torture.sql');
  const sqlContent = readFileSync(sqlPath, 'utf-8');

  const client = new pgMod.Client({
    host,
    port,
    user: PG_USER,
    password: PG_PASSWORD,
    database: PG_DATABASE,
  });

  await client.connect();
  try {
    // Run the entire torture.sql as one query — PostgreSQL supports multi-statement
    // batches with $$ dollar-quoted bodies correctly in a single pg.Client.query() call.
    await client.query(sqlContent);
  } finally {
    await client.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main harness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts an ephemeral PostgreSQL container, waits for readiness,
 * applies torture.sql, and returns a handle with config + stop().
 *
 * IMPORTANT: the caller's beforeAll hook MUST set hookTimeout >= 120000:
 *   beforeAll(async () => { handle = await startPgContainer(); }, 120_000);
 *
 * The per-suite hookTimeout is intentionally set on the hook (not via global vitest.config),
 * because container cold starts need their own ceiling separate from unit test hooks.
 */
export async function startPgContainer(): Promise<PgContainerHandle> {
  const container: StartedTestContainer = await new GenericContainer(PG_IMAGE)
    .withEnvironment({
      POSTGRES_PASSWORD: PG_PASSWORD,
      POSTGRES_DB: PG_DATABASE,
      POSTGRES_USER: PG_USER,
    })
    .withExposedPorts(PG_PORT)
    // Use port-open as initial signal (fast), then poll pg below (required for correctness)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(PG_PORT);

  // Wait for actual pg readiness (port open ≠ accept connections)
  await waitForPg(host, port);

  // Apply torture.sql fixture
  await applyTortureSql(host, port);

  const config: PgAdapterConfig = {
    host,
    port,
    database: PG_DATABASE,
    user: PG_USER,
    password: PG_PASSWORD,
  };

  return {
    config,
    stop: async () => {
      await container.stop();
    },
  };
}
