/**
 * Testcontainers harness for MongoDB integration tests.
 * Design §container.ts "start mongo:7, apply torture.ts seed, teardown, skip helper".
 *
 * Wait strategy: polls db.command({ping:1}) over a real mongodb connection
 * (port-open alone is INSUFFICIENT — MongoDB accepts TCP but rejects commands
 * for several seconds while it initialises the storage engine).
 *
 * Gate: suites use describe.skipIf(!mongodbIntegrationEnabled()) so the unit
 * matrix and Docker-less contributors stay green.
 *
 * Seeding uses a DEDICATED seed connection (never reused by the adapter under test).
 * The seed applies torture.ts programmatically — no binary dump, fully reviewable.
 *
 * US-030 (torture fixture materialised via Testcontainers), ADR-006 (lazy mongodb import).
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { MongodbAdapterConfig } from '../../../src/core/ports/schema-adapter.js';
import { applyTortureSeed } from './torture.js';

const __filename = fileURLToPath(import.meta.url);
// dirname is referenced to satisfy the module pattern (unused at runtime — seed is programmatic)
void dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MONGO_IMAGE = 'mongo:7';
const MONGO_PORT = 27017;
const MONGO_DATABASE = 'dbgraph_test';

/** Poll db.command({ping:1}) every 1000ms, up to 120 seconds. */
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface MongodbContainerHandle {
  /** MongodbAdapterConfig pre-built for the running container (URI already resolved). */
  readonly config: MongodbAdapterConfig;
  /** Stop the container (call in afterAll). */
  stop(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when DBGRAPH_INTEGRATION=1 is set.
 * Integration suites use:
 *   describe.skipIf(!mongodbIntegrationEnabled())('...', () => { ... });
 * so Docker-less contributors and the unit matrix both stay green.
 */
export function mongodbIntegrationEnabled(): boolean {
  return process.env['DBGRAPH_INTEGRATION'] === '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB driver type helpers (inline — avoid top-level mongodb import, ADR-006)
// ─────────────────────────────────────────────────────────────────────────────

interface MongoDbInterface {
  collection: (name: string) => {
    insertMany: (docs: Record<string, unknown>[]) => Promise<unknown>;
    createIndex: (
      keys: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  command: (cmd: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createCollection: (
    name: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}

interface MongoClientInterface {
  connect(): Promise<void>;
  db(name: string): MongoDbInterface;
  close(): Promise<void>;
}

interface MongodbModule {
  MongoClient: new (uri: string, options?: Record<string, unknown>) => MongoClientInterface;
}

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB readiness polling (wait strategy: db.command({ping:1}))
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls db.command({ping:1}) via a real mongodb connection until success or timeout.
 * Uses a dynamic import of mongodb to avoid mandatory runtime dependency (ADR-006).
 *
 * Port-open is insufficient: MongoDB accepts TCP connections but rejects commands
 * for several seconds while it initialises the storage engine.
 */
async function waitForMongodb(host: string, port: number): Promise<void> {
  let mongoMod: MongodbModule;
  try {
    mongoMod = await import('mongodb' as string) as MongodbModule;
  } catch {
    throw new Error('mongodb package is not installed. Run: npm i mongodb');
  }

  const uri = `mongodb://${host}:${port}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const client = new mongoMod.MongoClient(uri);
    try {
      await client.connect();
      await client.db('admin').command({ ping: 1 });
      await client.close();
      return; // MongoDB is ready
    } catch (err) {
      lastError = err;
      try { await client.close(); } catch { /* ignore */ }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `MongoDB readiness poll timed out after ${POLL_TIMEOUT_MS}ms. Last error: ${msg}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply torture seed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts the torture dataset into the running container via a dedicated seed connection.
 * The seed connection is NEVER reused by the adapter under test.
 */
async function applyMongoTortureSeed(host: string, port: number): Promise<void> {
  let mongoMod: MongodbModule;
  try {
    mongoMod = await import('mongodb' as string) as MongodbModule;
  } catch {
    throw new Error('mongodb package is not installed. Run: npm i mongodb');
  }

  const uri = `mongodb://${host}:${port}`;
  const client = new mongoMod.MongoClient(uri);

  await client.connect();
  try {
    const db = client.db(MONGO_DATABASE);
    await applyTortureSeed(db);
  } finally {
    await client.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main harness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts an ephemeral MongoDB container, waits for readiness via ping,
 * applies the torture.ts seed, and returns a handle with config + stop().
 *
 * IMPORTANT: the caller's beforeAll hook MUST set hookTimeout >= 120000:
 *   beforeAll(async () => { handle = await startMongodbContainer(); }, 120_000);
 *
 * The per-suite hookTimeout is intentionally set on the hook (not via global vitest.config),
 * because container cold starts need their own ceiling separate from unit test hooks.
 */
export async function startMongodbContainer(): Promise<MongodbContainerHandle> {
  const container: StartedTestContainer = await new GenericContainer(MONGO_IMAGE)
    .withExposedPorts(MONGO_PORT)
    // Use port-open as initial signal (fast), then poll mongodb below (required for correctness)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(MONGO_PORT);

  // Wait for actual MongoDB readiness (port open ≠ accept commands)
  await waitForMongodb(host, port);

  // Apply torture seed via dedicated seed connection
  await applyMongoTortureSeed(host, port);

  const uri = `mongodb://${host}:${port}`;

  const config: MongodbAdapterConfig = {
    uri,
    database: MONGO_DATABASE,
    sampleSize: 100, // explicit for tests — $sample(100) >= 8 docs = full dataset
  };

  return {
    config,
    stop: async () => {
      await container.stop();
    },
  };
}
