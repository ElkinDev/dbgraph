/**
 * dbgraph_status drift integration test — task 3.6 (phase-5-mcp-server).
 * Spec: Live fingerprint detects drift when connected.
 *
 * INTEGRATION-ONLY: Gated behind DBGRAPH_INTEGRATION=1 environment variable.
 * This test requires an actual database connection to compute a live fingerprint.
 * It should NOT run in the default unit test suite (npm test).
 *
 * Run with: DBGRAPH_INTEGRATION=1 npm run test:integration
 *
 * Strategy:
 *   1. Materialize the torture fixture into a temp SQLite file.
 *   2. Sync the graph store from the fixture.
 *   3. Mutate the source SQLite file (add a column via a new temp table).
 *   4. Open a fresh connection to the MUTATED fixture.
 *   5. Call dbgraph_status — the live fingerprint should differ → drift detected.
 *
 * Note: the tool in this test receives a live adapter (not the fixture store alone),
 * so it must be constructed differently than the connectionless tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

import { materializeTorture } from '../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../fixtures/sqlite/materialize.js';
import {
  createSqliteSchemaAdapter,
  createSqliteGraphStore,
  type GraphStore,
} from '../../src/index.js';
import { runSync } from '../../src/cli/commands/sync.js';
import { runStatusTool } from '../../src/mcp/tools/status.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guard: skip entirely unless DBGRAPH_INTEGRATION=1
// ─────────────────────────────────────────────────────────────────────────────

const INTEGRATION = process.env['DBGRAPH_INTEGRATION'] === '1';

// ─────────────────────────────────────────────────────────────────────────────
// Test state
// ─────────────────────────────────────────────────────────────────────────────

let mat: MaterializedDb;
let projectRoot: string;
let store: GraphStore;

beforeAll(async () => {
  if (!INTEGRATION) return;

  mat = materializeTorture();
  projectRoot = join(tmpdir(), `dbgraph-drift-test-${randomUUID()}`);
  mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });

  const adapter = await createSqliteSchemaAdapter({ file: mat.path });
  const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');
  store = await createSqliteGraphStore({ path: storePath });

  try {
    // Initial sync — fingerprint stored in snapshot
    await runSync({ adapter, store, full: false });
  } finally {
    await adapter.close();
  }

  // Mutate the source SQLite: add a new table to change the fingerprint
  const db = new Database(mat.path);
  db.exec(`CREATE TABLE drift_test_table (id INTEGER PRIMARY KEY, note TEXT);`);
  db.close();
}, 60_000);

afterAll(async () => {
  if (!INTEGRATION) return;

  if (store !== undefined) await store.close();
  mat?.cleanup();
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration test: live drift detection
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_status — live drift detection (INTEGRATION)', () => {
  it.skipIf(!INTEGRATION)('detects drift when source schema changed since last sync', async () => {
    // Open a fresh adapter to the MUTATED fixture (new table added)
    const adapter = await createSqliteSchemaAdapter({ file: mat.path });

    try {
      // Verify the raw fingerprint diff to confirm the test setup is correct
      const liveFp = await adapter.fingerprint();
      const snapshots = await store.listSnapshots();
      const lastSnapshot = snapshots[0];
      expect(lastSnapshot).toBeDefined();
      expect(liveFp).not.toBe(lastSnapshot?.fingerprint);

      // W-1 fix: run the tool WITH the live adapter — it must compute drift and report it
      const result = await runStatusTool(store, { detail: 'full' }, adapter);
      const text = (result.content[0] as { text: string }).text;
      // The tool must report drift detected (not "could not be checked live")
      expect(text).toContain('detected (schema changed since last sync)');
      expect(text).not.toContain('could not be checked live');
    } finally {
      await adapter.close();
    }
  });

  it.skipIf(!INTEGRATION)('reports no-drift when schema unchanged since last sync', async () => {
    // Re-open the adapter to the same store (no mutation since initial sync)
    // We need a fresh materialized db in its original state for this test
    const mat2 = materializeTorture();
    const adapter2 = await createSqliteSchemaAdapter({ file: mat2.path });
    const projectRoot2 = join(tmpdir(), `dbgraph-drift-nodrift-${randomUUID()}`);
    mkdirSync(join(projectRoot2, '.dbgraph'), { recursive: true });
    const storePath2 = join(projectRoot2, '.dbgraph', 'dbgraph.db');
    const store2 = await createSqliteGraphStore({ path: storePath2 });

    try {
      await runSync({ adapter: adapter2, store: store2, full: false });

      // Re-open a second adapter to the same (un-mutated) db
      const adapter2b = await createSqliteSchemaAdapter({ file: mat2.path });
      try {
        const result = await runStatusTool(store2, { detail: 'full' }, adapter2b);
        const text = (result.content[0] as { text: string }).text;
        // No mutation → none detected
        expect(text).toContain('none detected');
        expect(text).not.toContain('could not be checked live');
        expect(text).not.toContain('detected (schema changed');
      } finally {
        await adapter2b.close();
      }
    } finally {
      await adapter2.close();
      await store2.close();
      mat2.cleanup();
      if (existsSync(projectRoot2)) rmSync(projectRoot2, { recursive: true, force: true });
    }
  });
});
