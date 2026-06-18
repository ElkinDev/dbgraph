/**
 * Shared MCP test fixture — creates a pre-synced GraphStore over the SQLite torture fixture.
 *
 * Used by Batch C/D/E tool tests so each test file doesn't need to re-implement
 * the materialize → sync → store open lifecycle.
 *
 * Usage:
 *   const fx = await openFixtureStore();
 *   // ... run tests using fx.store and fx.server ...
 *   await fx.cleanup();
 */

import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { materializeTorture } from '../fixtures/sqlite/materialize.js';
import type { MaterializedDb } from '../fixtures/sqlite/materialize.js';
import {
  createSqliteSchemaAdapter,
  createSqliteGraphStore,
  type GraphStore,
} from '../../src/index.js';
import { runSync } from '../../src/cli/commands/sync.js';

// ─────────────────────────────────────────────────────────────────────────────
// FixtureStore — owns the lifecycle of a synced store
// ─────────────────────────────────────────────────────────────────────────────

export interface FixtureStore {
  readonly store: GraphStore;
  cleanup(): Promise<void>;
}

/**
 * Materializes the SQLite torture fixture, runs a full sync into a temp store,
 * and returns the opened GraphStore.
 *
 * The returned `cleanup()` closes the store and removes temp files.
 * Call it in afterAll() to avoid open handles.
 */
export async function openFixtureStore(): Promise<FixtureStore> {
  const mat: MaterializedDb = materializeTorture();

  const projectRoot = join(tmpdir(), `dbgraph-mcp-fixture-${randomUUID()}`);
  mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
  const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');

  const adapter = await createSqliteSchemaAdapter({ file: mat.path });
  const store = await createSqliteGraphStore({ path: storePath });

  try {
    await runSync({ adapter, store, full: false });
  } finally {
    await adapter.close();
  }

  return {
    store,
    async cleanup(): Promise<void> {
      await store.close();
      mat.cleanup();
      if (existsSync(projectRoot)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  };
}
