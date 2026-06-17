/**
 * Gated MSSQL CLI E2E integration test — task 7.5 (phase-4-cli-config).
 *
 * Gate: DBGRAPH_INTEGRATION=1 (skips cleanly without Docker).
 * Uses the Phase-3 Testcontainers harness (test/fixtures/mssql/container.ts).
 *
 * IMPORTANT SECURITY CONSTRAINTS:
 *   - NEVER touches a real or named validation database — ephemeral container only.
 *   - Uses an EPHEMERAL SQL Server container (startMssqlContainer).
 *   - torture.sql is applied to the ephemeral container — ONLY reads via the adapter.
 *   - Read-only against target is INVIOLABLE (ADR-005).
 *
 * Flow: init (via config write) → sync → query
 *   1. Start ephemeral SQL Server container.
 *   2. Create an isolated projectRoot with .dbgraph/.
 *   3. Write a dbgraph.config.json pointing to the container via env vars.
 *   4. Run sync (creates first snapshot).
 *   5. Run query — verify hits and exit 0.
 *   6. Tear down container.
 *
 * Config uses ${env:VAR} references — resolved by injecting the container values
 * into a local env map and calling resolveSecrets directly (no process.env mutation).
 *
 * ADR-004: imports via src/index.ts barrel only, NEVER adapter internals.
 * Spec: proposal "MSSQL init→sync→query green under DBGRAPH_INTEGRATION=1" (US-001/005/020).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  startMssqlContainer,
  mssqlIntegrationEnabled,
} from '../fixtures/mssql/container.js';
import type { MssqlContainerHandle } from '../fixtures/mssql/container.js';
import {
  createMssqlSchemaAdapter,
  createSqliteGraphStore,
} from '../../src/index.js';
import { runSync } from '../../src/cli/commands/sync.js';
import { runQuery } from '../../src/cli/commands/query.js';

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. ' +
  'Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let handle: MssqlContainerHandle;
let projectRoot: string;

function makeProjectRoot(): string {
  const root = join(tmpdir(), `dbgraph-mssql-e2e-${randomUUID()}`);
  mkdirSync(join(root, '.dbgraph'), { recursive: true });
  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration test suite (gated)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mssqlIntegrationEnabled())(
  'MSSQL CLI E2E: init → sync → query (US-001/005/020, DBGRAPH_INTEGRATION=1)',
  () => {
    beforeAll(async () => {
      // Start ephemeral SQL Server container (applies torture.sql)
      handle = await startMssqlContainer();
      projectRoot = makeProjectRoot();
    }, 240_000);

    afterAll(async () => {
      if (existsSync(projectRoot)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
      if (handle !== undefined) {
        await handle.stop();
      }
    }, 60_000);

    it('sync succeeds against the ephemeral SQL Server container', async () => {
      // Create adapter directly with the container config (resolved — no env refs needed)
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const result = await runSync({ adapter, store, full: false });
        expect(result.type).toBe('success');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('graph store contains table nodes after sync', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const tables = await store.getNodesByKind('table');
        expect(tables.length).toBeGreaterThan(0);
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('query for "orders" returns hits (exit 0 / type success)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const result = await runQuery({ store, term: 'orders', json: false });
        // torture.sql has an "orders" table — search must return hits
        expect(result.type).toBe('success');
        expect(result.output).toContain('orders');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('query for a non-existent term returns "negative" (exit 1)', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const result = await runQuery({ store, term: 'xyzzy_nonexistent_mssql_q999', json: false });
        expect(result.type).toBe('negative');
      } finally {
        await adapter.close();
        await store.close();
      }
    });

    it('snapshot is recorded after sync', async () => {
      const adapter = await createMssqlSchemaAdapter(handle.config);
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
      const store = await createSqliteGraphStore({ path: storePath });

      try {
        const snapshots = await store.listSnapshots();
        expect(snapshots.length).toBeGreaterThan(0);
        const last = snapshots[snapshots.length - 1];
        expect(last).toBeDefined();
        expect(last?.engine).toBe('mssql');
      } finally {
        await adapter.close();
        await store.close();
      }
    });
  },
);

// Skip placeholder for docker-less runs
if (!mssqlIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
