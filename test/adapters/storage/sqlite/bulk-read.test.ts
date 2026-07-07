/**
 * Tasks 2.2–2.4 — RED→GREEN: SQLite bulk read-only whole-graph seam.
 *
 * `getAllNodes()` (ORDER BY qname, id) and `getAllEdges()` (ORDER BY kind, src_id, dst_id,
 * id) — one prepared statement each, read-only, deterministic order. Over the torture
 * fixture: returns every node + edge (2.2); BOUNDED to exactly 2 whole-graph reads with no
 * per-node storm + DETERMINISTIC order + strictly READ-ONLY (2.3); IDENTICAL across
 * better-sqlite3 and node:sqlite (2.4).
 *
 * Spec `graph-storage`: "whole-graph read uses a bounded number of queries", "bulk read
 * ordering is deterministic", "bulk read is strictly read-only", "bulk seam is
 * driver-agnostic". L-009: toStrictEqual / toBe(N), no `.toBeDefined()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { openFixtureStore, type FixtureStore } from '../../../mcp/fixture.js';
import { CountingStore } from '../../../helpers/counting-store.js';
import { betterSqliteHandle } from '../../../../src/adapters/storage/sqlite/handle.js';
import { SqliteGraphStore } from '../../../../src/adapters/storage/sqlite/sqlite-graph-store.js';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import { runSync } from '../../../../src/cli/commands/sync.js';
import { createSqliteSchemaAdapter } from '../../../../src/adapters/engines/sqlite/factory.js';
import { materializeTorture } from '../../../fixtures/sqlite/materialize.js';
import { isNodeSqliteAvailable } from '../../../../src/adapters/engines/sqlite/driver.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

let fx: FixtureStore;

beforeAll(async () => {
  fx = await openFixtureStore();
});

afterAll(async () => {
  await fx.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.2 — returns everything, deterministic ORDER BY
// ─────────────────────────────────────────────────────────────────────────────

describe('bulk seam — getAllNodes / getAllEdges return the whole graph (task 2.2)', () => {
  it('getAllNodes returns every node in ORDER BY qname, id', async () => {
    const all = await fx.store.getAllNodes();
    // union of per-kind reads is the same SET as the bulk read (returns-everything)
    const NODE_KINDS = [
      'database', 'schema', 'table', 'column', 'constraint', 'index', 'view',
      'procedure', 'function', 'trigger', 'sequence', 'collection', 'field',
    ] as const;
    const perKind: string[] = [];
    for (const k of NODE_KINDS) {
      const kn = await fx.store.getNodesByKind(k);
      for (const n of kn) perKind.push(n.id);
    }
    expect(all.length).toBe(perKind.length);
    expect(new Set(all.map((n) => n.id))).toStrictEqual(new Set(perKind));
    expect(all.length).toBeGreaterThan(0);

    // ORDER BY qname, id — assert the returned sequence is sorted
    const sorted = [...all].sort((a, b) => {
      const c = a.qname < b.qname ? -1 : a.qname > b.qname ? 1 : 0;
      return c !== 0 ? c : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    expect(all.map((n) => n.id)).toStrictEqual(sorted.map((n) => n.id));
  });

  it('getAllEdges returns every edge in ORDER BY kind, src_id, dst_id, id', async () => {
    const all = await fx.store.getAllEdges();
    const nodes = await fx.store.getAllNodes();
    const unionFromFrom: string[] = [];
    for (const n of nodes) {
      const e = await fx.store.getEdgesFrom(n.id);
      for (const edge of e) unionFromFrom.push(edge.id);
    }
    expect(all.length).toBe(unionFromFrom.length);
    expect(new Set(all.map((e) => e.id))).toStrictEqual(new Set(unionFromFrom));
    expect(all.length).toBeGreaterThan(0);

    const sorted = [...all].sort((a, b) => {
      const byKind = a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
      if (byKind !== 0) return byKind;
      const bySrc = a.src < b.src ? -1 : a.src > b.src ? 1 : 0;
      if (bySrc !== 0) return bySrc;
      const byDst = a.dst < b.dst ? -1 : a.dst > b.dst ? 1 : 0;
      if (byDst !== 0) return byDst;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    expect(all.map((e) => e.id)).toStrictEqual(sorted.map((e) => e.id));
  });

  it('records the real torture-fixture node/edge counts (documented anchor)', async () => {
    const nodes = await fx.store.getAllNodes();
    const edges = await fx.store.getAllEdges();
    // The torture graph is ~53 nodes / ~64 edges — pin as a lower bound so a future
    // fixture shrink is caught, without hard-coding a brittle exact count here.
    expect(nodes.length).toBeGreaterThanOrEqual(40);
    expect(edges.length).toBeGreaterThanOrEqual(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.3 — bounded (exactly 2 whole-graph reads, no storm) + deterministic + read-only
// ─────────────────────────────────────────────────────────────────────────────

describe('bulk seam — bounded, deterministic, read-only (task 2.3)', () => {
  it('reads the whole graph in EXACTLY 2 store reads, independent of node count', async () => {
    const counting = new CountingStore(fx.store);
    const nodes = await counting.getAllNodes();
    const edges = await counting.getAllEdges();

    // exactly 2 whole-graph reads; NO per-node/per-edge storm
    expect(counting.counts.getAllNodes).toBe(1);
    expect(counting.counts.getAllEdges).toBe(1);
    expect(counting.totalReads).toBe(2);
    expect(counting.counts.getNode).toBe(0);
    expect(counting.counts.getNodesByKind).toBe(0);
    expect(counting.counts.getEdgesFrom).toBe(0);
    expect(counting.counts.getEdgesTo).toBe(0);

    // "independent of node count": 2 reads yielded MANY nodes (no N-per-node reads)
    expect(nodes.length).toBeGreaterThan(counting.totalReads);
    expect(edges.length).toBeGreaterThan(counting.totalReads);
  });

  it('two bulk reads of the same graph return an identical, stable order', async () => {
    const a1 = await fx.store.getAllNodes();
    const a2 = await fx.store.getAllNodes();
    expect(a2).toStrictEqual(a1);
    const e1 = await fx.store.getAllEdges();
    const e2 = await fx.store.getAllEdges();
    expect(e2).toStrictEqual(e1);
  });

  it('is strictly READ-ONLY — succeeds over a readonly connection to the same file', async () => {
    // Persist the torture graph to a file, then reopen it READONLY. A readonly
    // better-sqlite3 connection physically cannot execute a write/DDL/DML; if either
    // bulk method issued one it would throw. That both succeed proves SELECT-only.
    const projectRoot = join(tmpdir(), `dbgraph-bulk-ro-${randomUUID()}`);
    mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
    const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');

    const mat = materializeTorture();
    const adapter = await createSqliteSchemaAdapter({ file: mat.path });
    const writer = await createSqliteGraphStore({ path: storePath });
    try {
      await runSync({ adapter, store: writer, full: false });
    } finally {
      await adapter.close();
    }
    const writtenNodes = await writer.getAllNodes();
    const writtenEdges = await writer.getAllEdges();
    await writer.close();

    // Reopen READONLY — no migrations (tables already exist), just SELECTs.
    const roDb = new Database(storePath, { readonly: true });
    const roStore = new SqliteGraphStore(betterSqliteHandle(roDb));
    const roNodes = await roStore.getAllNodes();
    const roEdges = await roStore.getAllEdges();
    await roStore.close();

    mat.cleanup();
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });

    expect(roNodes).toStrictEqual(writtenNodes);
    expect(roEdges).toStrictEqual(writtenEdges);
    expect(roNodes.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.4 — driver-agnostic parity (better-sqlite3 vs node:sqlite)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!isNodeSqliteAvailable())(
  'bulk seam — driver-agnostic parity (task 2.4)',
  () => {
    it('getAllNodes/getAllEdges are identical (value + order) across drivers', async () => {
      const projectRoot = join(tmpdir(), `dbgraph-bulk-drv-${randomUUID()}`);
      mkdirSync(join(projectRoot, '.dbgraph'), { recursive: true });
      const storePath = join(projectRoot, '.dbgraph', 'dbgraph.db');

      // Write ONE persisted graph with better-sqlite3.
      const mat = materializeTorture();
      const adapter = await createSqliteSchemaAdapter({ file: mat.path });
      const writer = await createSqliteGraphStore({ path: storePath });
      try {
        await runSync({ adapter, store: writer, full: false });
      } finally {
        await adapter.close();
      }
      const betterNodes = await writer.getAllNodes();
      const betterEdges = await writer.getAllEdges();
      await writer.close();

      // Read the SAME file via node:sqlite.
      const nodeStore = await createSqliteGraphStore({ path: storePath, driver: 'node:sqlite' });
      const nodeNodes = await nodeStore.getAllNodes();
      const nodeEdges = await nodeStore.getAllEdges();
      await nodeStore.close();

      mat.cleanup();
      if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });

      expect(nodeNodes).toStrictEqual(betterNodes);
      expect(nodeEdges).toStrictEqual(betterEdges);
      expect(nodeNodes.length).toBeGreaterThan(0);
      expect(nodeEdges.length).toBeGreaterThan(0);
    });
  },
);
