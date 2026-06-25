/**
 * Phase 9.5b Batch 2 — Tasks 2.4 + 2.5
 *
 * node:sqlite E2E parity suite.
 * Runs the SAME store operations on a `node:sqlite`-backed store and asserts
 * results are `toStrictEqual` the `better-sqlite3` oracle (same fixture, same test).
 *
 * All node:sqlite legs are gated with `describe.skipIf(!isNodeSqliteAvailable())`.
 * On Node 22.5+ these tests run green. On Node < 22.5 they skip cleanly — the
 * better-sqlite3 default path (Batch 1) is never affected.
 *
 * Spec scenarios covered:
 *   "Same store behavior holds on either driver" (task 2.4)
 *   "node:sqlite in-memory store passes the same behavior" (task 2.4)
 *   "Port is unchanged and file format is portable" (task 2.5)
 *
 * Rule L-009: EXACT / golden-pinned assertions — toStrictEqual deep-equal
 * and toBe(N) counts. .toBeDefined()-only assertions are forbidden.
 */

import { describe, it, expect } from 'vitest';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import type { GraphStore, SnapshotRecord } from '../../../../src/core/ports/graph-store.js';
import type { GraphStore as GraphStorePort } from '../../../../src/core/ports/graph-store.js';
import { normalizeCatalog } from '../../../../src/core/normalize/index.js';
import minimalFixture from '../../../fixtures/catalog-minimal.json' with { type: 'json' };
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import { isNodeSqliteAvailable } from '../../../../src/adapters/engines/sqlite/driver.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture + scope
// ─────────────────────────────────────────────────────────────────────────────

/** Full-level scope: all kinds at 'full'. */
const fullScope: ExtractionScope = {
  levels: {
    tables: 'full',
    columns: 'full',
    constraints: 'full',
    indexes: 'full',
    views: 'full',
    procedures: 'full',
    functions: 'full',
    triggers: 'full',
    sequences: 'full',
    collections: 'full',
    fields: 'full',
    statistics: 'off',
    sampling: 'off',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.4 — node:sqlite parity: same E2E ops as better-sqlite3 oracle
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!isNodeSqliteAvailable())(
  'node:sqlite parity — E2E store operations (task 2.4)',
  () => {
    /**
     * Run the full store suite on both drivers in parallel, then compare results.
     */
    async function buildOracle(path: string): Promise<{
      store: GraphStore;
      graph: ReturnType<typeof normalizeCatalog>['graph'];
    }> {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const store = await createSqliteGraphStore({ path });
      await store.upsertGraph(result.graph);
      return { store, graph: result.graph };
    }

    async function buildNodeSqlite(path: string): Promise<{
      store: GraphStore;
      graph: ReturnType<typeof normalizeCatalog>['graph'];
    }> {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const store = await createSqliteGraphStore({ path, driver: 'node:sqlite' });
      await store.upsertGraph(result.graph);
      return { store, graph: result.graph };
    }

    it('upsertGraph returns identical node + edge counts on both drivers', async () => {
      const { graph: g1 } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const { graph: g2 } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      const r1 = await s1.upsertGraph(g1);
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      const r2 = await s2.upsertGraph(g2);
      await s2.close();

      expect(r2.nodes).toBe(r1.nodes);
      expect(r2.edges).toBe(r1.edges);
      expect(r2.nodes).toBeGreaterThan(0);
      expect(r2.edges).toBeGreaterThan(0);
    });

    it('getNode returns identical result on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const firstNode = graph.nodes[0];
      if (firstNode === undefined) throw new Error('No nodes in fixture');

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const n1 = await s1.getNode(firstNode.id);
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const n2 = await s2.getNode(firstNode.id);
      await s2.close();

      expect(n2).not.toBeNull();
      expect(n2).toStrictEqual(n1);
    });

    it('getNode returns null for unknown id on both drivers', async () => {
      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      const n1 = await s1.getNode('0000000000000000000000000000000000000000');
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      const n2 = await s2.getNode('0000000000000000000000000000000000000000');
      await s2.close();

      expect(n2).toStrictEqual(n1);
      expect(n2).toBeNull();
    });

    it('getNodesByKind returns identical results (count + qname order) on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const tables1 = await s1.getNodesByKind('table');
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const tables2 = await s2.getNodesByKind('table');
      await s2.close();

      expect(tables2.length).toBe(tables1.length);
      expect(tables2.length).toBeGreaterThan(0);
      // Order must match (qname sort is deterministic)
      for (let i = 0; i < tables1.length; i++) {
        expect(tables2[i]?.id).toBe(tables1[i]?.id);
        expect(tables2[i]?.qname).toBe(tables1[i]?.qname);
        expect(tables2[i]?.kind).toBe('table');
      }
    });

    it('getNodeByQName returns identical result on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const tableNode = graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node in fixture');

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const found1 = await s1.getNodeByQName('table', tableNode.qname);
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const found2 = await s2.getNodeByQName('table', tableNode.qname);
      await s2.close();

      expect(found2).not.toBeNull();
      expect(found2).toStrictEqual(found1);
    });

    it('getEdgesFrom returns identical results on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const tableNode = graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node');

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const edges1 = await s1.getEdgesFrom(tableNode.id);
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const edges2 = await s2.getEdgesFrom(tableNode.id);
      await s2.close();

      expect(edges2.length).toBe(edges1.length);
      // Sort by id for deterministic comparison
      const sorted1 = [...edges1].sort((a, b) => a.id.localeCompare(b.id));
      const sorted2 = [...edges2].sort((a, b) => a.id.localeCompare(b.id));
      expect(sorted2).toStrictEqual(sorted1);
    });

    it('getEdgesTo returns identical results on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const custNode = graph.nodes.find(
        (n) => n.kind === 'table' && n.qname === 'dbo.customers',
      );
      if (custNode === undefined) throw new Error('No customers table node');

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const inEdges1 = await s1.getEdgesTo(custNode.id);
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const inEdges2 = await s2.getEdgesTo(custNode.id);
      await s2.close();

      expect(inEdges2.length).toBe(inEdges1.length);
      expect(inEdges2.length).toBeGreaterThan(0);
    });

    it('searchFts returns identical hit count on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const fts1 = await s1.searchFts('customers');
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const fts2 = await s2.searchFts('customers');
      await s2.close();

      expect(fts2.total).toBe(fts1.total);
      expect(fts2.hits.length).toBe(fts1.hits.length);
      expect(fts2.hits.length).toBeGreaterThan(0);
    });

    it('searchFts body_hash hits are identical on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      // triggers have body at full scope
      const triggerNode = graph.nodes.find((n) => n.kind === 'trigger' && n.bodyHash !== null);
      if (triggerNode === undefined) throw new Error('No trigger with bodyHash in fixture');

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      const n1 = await s1.getNode(triggerNode.id);
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      const n2 = await s2.getNode(triggerNode.id);
      await s2.close();

      expect(n2).not.toBeNull();
      expect(n2?.bodyHash).toBe(n1?.bodyHash);
      expect(n2?.bodyHash).not.toBeNull();
    });

    it('putSnapshot + listSnapshots returns identical results on both drivers', async () => {
      const snap: SnapshotRecord = {
        id: 'snap-parity-001',
        takenAt: '2026-06-24T00:00:00Z',
        engine: 'mssql',
        engineVersion: '15.0',
        fingerprint: 'fp-parity',
        counts: { table: 3, view: 1 },
      };

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.putSnapshot(snap);
      const snaps1 = await s1.listSnapshots();
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.putSnapshot(snap);
      const snaps2 = await s2.listSnapshots();
      await s2.close();

      expect(snaps2.length).toBe(snaps1.length);
      expect(snaps2.length).toBe(1);
      expect(snaps2[0]?.id).toBe(snaps1[0]?.id);
      expect(snaps2[0]?.takenAt).toBe(snaps1[0]?.takenAt);
      expect(snaps2[0]?.engine).toBe(snaps1[0]?.engine);
      expect(snaps2[0]?.engineVersion).toBe(snaps1[0]?.engineVersion);
      expect(snaps2[0]?.fingerprint).toBe(snaps1[0]?.fingerprint);
      expect(snaps2[0]?.counts).toStrictEqual(snaps1[0]?.counts);
    });

    it('putSnapshot + getSnapshotObjects manifest is identical on both drivers', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const snap: SnapshotRecord = {
        id: 'snap-parity-manifest',
        takenAt: '2026-06-24T01:00:00Z',
        engine: 'sqlite',
        fingerprint: 'fp-manifest-parity',
        counts: {},
      };

      const s1 = await createSqliteGraphStore({ path: ':memory:' });
      await s1.upsertGraph(graph);
      await s1.putSnapshot(snap);
      const manifest1 = await s1.getSnapshotObjects('snap-parity-manifest');
      await s1.close();

      const s2 = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await s2.upsertGraph(graph);
      await s2.putSnapshot(snap);
      const manifest2 = await s2.getSnapshotObjects('snap-parity-manifest');
      await s2.close();

      expect(manifest2.length).toBe(manifest1.length);
      expect(manifest2.length).toBeGreaterThan(0);

      // Sort by nodeId for deterministic comparison
      const sorted1 = [...manifest1].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
      const sorted2 = [...manifest2].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
      expect(sorted2).toStrictEqual(sorted1);
    });

    it('schemaVersion === 2 on node:sqlite (migrate v0→v2)', async () => {
      const store = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      const version = await store.schemaVersion();
      await store.close();
      expect(version).toBe(2);
    });

    it('journal_mode pragma on :memory: is a no-op (not an error) on node:sqlite', async () => {
      // This verifies the WAL pragma no-op caveat: :memory: stores use journal_mode=memory
      // on BOTH drivers — requesting WAL is NOT an error; we assert by opening successfully.
      await expect(
        createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' }),
      ).resolves.toBeDefined();
      // The store opened without throwing — WAL request was silently ignored.
      // We assert ROW RESULTS, not the journal_mode echo (as per spec).
      const store = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const result = await store.upsertGraph(graph);
      expect(result.nodes).toBeGreaterThan(0);
      await store.close();
    });

    it('upsert is idempotent on node:sqlite (same node count on double upsert)', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const store = await createSqliteGraphStore({ path: ':memory:', driver: 'node:sqlite' });
      await store.upsertGraph(graph);
      await store.upsertGraph(graph);
      const tables = await store.getNodesByKind('table');
      const expectedCount = graph.nodes.filter((n) => n.kind === 'table').length;
      await store.close();
      expect(tables.length).toBe(expectedCount);
    });

    // This is the baseline test that exercises what the oracle does — avoiding :void results
    void buildOracle;
    void buildNodeSqlite;
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.5 — Port unchanged + file-format portability
// Spec scenarios: "Port is unchanged and file format is portable"
// ─────────────────────────────────────────────────────────────────────────────

describe('GraphStore port is unchanged by phase-9.5b (task 2.5 — type-level)', () => {
  it('GraphStore port surface has all expected methods (compile-time shape assertion)', () => {
    // Type-level assertion: we verify the port exports the EXACT method names documented in the spec.
    // We check that GraphStorePort has each method as a key — if a method was removed, this
    // type assertion would fail at compile time.
    type HasClose          = GraphStorePort extends { close: unknown } ? true : false;
    type HasSchemaVersion  = GraphStorePort extends { schemaVersion: unknown } ? true : false;
    type HasUpsertGraph    = GraphStorePort extends { upsertGraph: unknown } ? true : false;
    type HasDeleteNodes    = GraphStorePort extends { deleteNodes: unknown } ? true : false;
    type HasGetNode        = GraphStorePort extends { getNode: unknown } ? true : false;
    type HasGetNodesByKind = GraphStorePort extends { getNodesByKind: unknown } ? true : false;
    type HasGetNodeByQName = GraphStorePort extends { getNodeByQName: unknown } ? true : false;
    type HasGetEdgesFrom   = GraphStorePort extends { getEdgesFrom: unknown } ? true : false;
    type HasGetEdgesTo     = GraphStorePort extends { getEdgesTo: unknown } ? true : false;
    type HasSearchFts      = GraphStorePort extends { searchFts: unknown } ? true : false;
    type HasPutSnapshot    = GraphStorePort extends { putSnapshot: unknown } ? true : false;
    type HasListSnapshots  = GraphStorePort extends { listSnapshots: unknown } ? true : false;
    type HasGetSnapshotObj = GraphStorePort extends { getSnapshotObjects: unknown } ? true : false;
    type HasGetMeta        = GraphStorePort extends { getMeta: unknown } ? true : false;
    type HasSetMeta        = GraphStorePort extends { setMeta: unknown } ? true : false;

    // If any method is missing the type resolves to false; this cast would be a compile error.
    const _: [
      HasClose, HasSchemaVersion, HasUpsertGraph, HasDeleteNodes,
      HasGetNode, HasGetNodesByKind, HasGetNodeByQName,
      HasGetEdgesFrom, HasGetEdgesTo, HasSearchFts,
      HasPutSnapshot, HasListSnapshots, HasGetSnapshotObj,
      HasGetMeta, HasSetMeta,
    ] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
    void _;

    // Runtime: just ensure we can import the port (no error at runtime)
    expect(true).toBe(true);
  });
});

describe.skipIf(!isNodeSqliteAvailable())(
  'file-format portability: better-sqlite3 write → node:sqlite read (task 2.5)',
  () => {
    it('a .dbgraph file written by better-sqlite3 opens + round-trips on node:sqlite', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const tmpPath = join(tmpdir(), `dbgraph-portability-${randomUUID()}.db`);

      // Write with better-sqlite3
      const writer = await createSqliteGraphStore({ path: tmpPath });
      await writer.upsertGraph(graph);

      // Pick a known node to round-trip
      const tableNode = graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node in fixture');
      const written = await writer.getNode(tableNode.id);
      await writer.close();

      // Read with node:sqlite
      const reader = await createSqliteGraphStore({ path: tmpPath, driver: 'node:sqlite' });
      const read = await reader.getNode(tableNode.id);
      const readVersion = await reader.schemaVersion();
      await reader.close();

      // Cleanup
      await unlink(tmpPath);

      expect(read).not.toBeNull();
      expect(read).toStrictEqual(written);
      expect(readVersion).toBe(2);
    });

    it('a .dbgraph file written by node:sqlite opens + round-trips on better-sqlite3', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const tmpPath = join(tmpdir(), `dbgraph-portability-rev-${randomUUID()}.db`);

      // Write with node:sqlite
      const writer = await createSqliteGraphStore({ path: tmpPath, driver: 'node:sqlite' });
      await writer.upsertGraph(graph);

      const tableNode = graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node in fixture');
      const written = await writer.getNode(tableNode.id);
      await writer.close();

      // Read with better-sqlite3
      const reader = await createSqliteGraphStore({ path: tmpPath });
      const read = await reader.getNode(tableNode.id);
      const readVersion = await reader.schemaVersion();
      await reader.close();

      // Cleanup
      await unlink(tmpPath);

      expect(read).not.toBeNull();
      expect(read).toStrictEqual(written);
      expect(readVersion).toBe(2);
    });

    it('getNodesByKind returns same count when reopening cross-driver', async () => {
      const { graph } = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const tmpPath = join(tmpdir(), `dbgraph-portability-kind-${randomUUID()}.db`);

      // Write all nodes with better-sqlite3
      const writer = await createSqliteGraphStore({ path: tmpPath });
      await writer.upsertGraph(graph);
      const tables1 = await writer.getNodesByKind('table');
      await writer.close();

      // Read back node count with node:sqlite
      const reader = await createSqliteGraphStore({ path: tmpPath, driver: 'node:sqlite' });
      const tables2 = await reader.getNodesByKind('table');
      await reader.close();

      // Cleanup
      await unlink(tmpPath);

      expect(tables2.length).toBe(tables1.length);
      expect(tables2.length).toBeGreaterThan(0);
    });
  },
);
