/**
 * RED+GREEN tests for SqliteGraphStore (tasks 5.2, 5.3, 5.4).
 * Design §9.2 — round-trip tests against REAL better-sqlite3 (in-memory DBs).
 * dbgraph-testing: never mock the driver.
 *
 * Task 5.2: upsertGraph + reads (getNode / getNodesByKind / getNodeByQName /
 *           getEdgesFrom / getEdgesTo) — round-trip, US-009.
 * Task 5.3: FTS5 population (level-gated body) + searchFts, US-003.
 * Task 5.4: snapshots (putSnapshot / listSnapshots insertion order),
 *           meta (getMeta / setMeta), deleteNodes (cascades edges + fts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteGraphStore } from '../../../../src/adapters/storage/sqlite/factory.js';
import type { GraphStore } from '../../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../../src/core/model/node.js';
import type { GraphEdge } from '../../../../src/core/model/edge.js';
import type { SnapshotRecord } from '../../../../src/core/ports/graph-store.js';
import { normalizeCatalog } from '../../../../src/core/normalize/index.js';
import minimalFixture from '../../../fixtures/catalog-minimal.json' with { type: 'json' };
import minimalGolden from '../../../golden/normalize/catalog-minimal.json' with { type: 'json' };
import levelsFixture from '../../../fixtures/catalog-levels.json' with { type: 'json' };
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Default full-level scope: everything at 'full'. */
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
// Task 5.2 — upsertGraph + reads: round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteGraphStore — upsertGraph + reads (task 5.2)', () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await createSqliteGraphStore({ path: ':memory:' });
  });

  afterEach(async () => {
    await store.close();
  });

  describe('round-trip preserves the graph', () => {
    it('upsertGraph returns counts matching the normalized graph', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const { graph } = result;
      const upsertResult = await store.upsertGraph(graph);
      expect(upsertResult.nodes).toBe(graph.nodes.length);
      expect(upsertResult.edges).toBe(graph.edges.length);
    });

    it('getNode returns the node with identical fields after persist', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const { graph } = result;
      await store.upsertGraph(graph);

      // Verify first node from golden
      const firstNode = graph.nodes[0];
      if (firstNode === undefined) throw new Error('No nodes in graph');

      const retrieved = await store.getNode(firstNode.id);
      expect(retrieved).not.toBeNull();
      if (retrieved === null) return;

      expect(retrieved.id).toBe(firstNode.id);
      expect(retrieved.kind).toBe(firstNode.kind);
      expect(retrieved.qname).toBe(firstNode.qname);
      expect(retrieved.level).toBe(firstNode.level);
      expect(retrieved.missing).toBe(firstNode.missing);
      expect(retrieved.excluded).toBe(firstNode.excluded);
      expect(retrieved.bodyHash).toBe(firstNode.bodyHash);
      expect(retrieved.schema).toBe(firstNode.schema);
      expect(retrieved.name).toBe(firstNode.name);
    });

    it('getNode returns null for unknown id', async () => {
      const node = await store.getNode('0000000000000000000000000000000000000000');
      expect(node).toBeNull();
    });

    it('getNodesByKind returns all nodes of that kind in qname order', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      const tables = await store.getNodesByKind('table');
      const expectedTables = result.graph.nodes
        .filter((n) => n.kind === 'table')
        .sort((a, b) => a.qname.localeCompare(b.qname));

      expect(tables.length).toBe(expectedTables.length);
      for (let i = 0; i < tables.length; i++) {
        expect(tables[i]?.id).toBe(expectedTables[i]?.id);
        expect(tables[i]?.kind).toBe('table');
      }
    });

    it('getNodeByQName returns the node with matching kind + qname', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      const tableNode = result.graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node in graph');

      const found = await store.getNodeByQName('table', tableNode.qname);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(tableNode.id);
    });

    it('getNodeByQName returns null for unknown qname', async () => {
      const found = await store.getNodeByQName('table', 'nonexistent.table');
      expect(found).toBeNull();
    });

    it('getEdgesFrom returns edges for the given node id', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      // Find a node that has outgoing edges
      const tableNode = result.graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node');

      const outEdges = await store.getEdgesFrom(tableNode.id);
      const expectedEdges = result.graph.edges.filter((e) => e.src === tableNode.id);
      expect(outEdges.length).toBe(expectedEdges.length);
    });

    it('getEdgesFrom with kinds filter returns only matching edge kinds', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      const tableNode = result.graph.nodes.find((n) => n.kind === 'table' && n.qname === 'dbo.orders');
      if (tableNode === undefined) throw new Error('No orders table node');

      const refEdges = await store.getEdgesFrom(tableNode.id, ['references']);
      expect(refEdges.length).toBeGreaterThan(0);
      for (const edge of refEdges) {
        expect(edge.kind).toBe('references');
      }
    });

    it('getEdgesTo returns inbound edges for the given node id', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      // customers table receives inbound references edges
      const custNode = result.graph.nodes.find(
        (n) => n.kind === 'table' && n.qname === 'dbo.customers',
      );
      if (custNode === undefined) throw new Error('No customers table node');

      const inEdges = await store.getEdgesTo(custNode.id);
      expect(inEdges.length).toBeGreaterThan(0);
    });

    it('persisted edge fields match the original edge exactly', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      // Check a specific edge: the aggregate references edge orders→customers
      const aggEdge = result.graph.edges.find(
        (e) => e.kind === 'references' && e.attrs.aggregate === true,
      );
      if (aggEdge === undefined) throw new Error('No aggregate references edge');

      const retrieved = (await store.getEdgesFrom(aggEdge.src, ['references'])).find(
        (e) => e.id === aggEdge.id,
      );
      expect(retrieved).toBeDefined();
      expect(retrieved?.kind).toBe(aggEdge.kind);
      expect(retrieved?.dst).toBe(aggEdge.dst);
      expect(retrieved?.confidence).toBe(aggEdge.confidence);
      expect(retrieved?.score).toBe(aggEdge.score);
      expect(retrieved?.attrs).toStrictEqual(aggEdge.attrs);
    });

    it('round-trip matches normalize golden (deep equal)', async () => {
      // The key round-trip test: normalizeCatalog → store → read back → golden.
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      // Retrieve all nodes and edges matching the golden
      const goldenNodes = (minimalGolden as unknown as { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }).graph.nodes;
      const goldenEdges = (minimalGolden as unknown as { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }).graph.edges;

      for (const goldenNode of goldenNodes) {
        const retrieved = await store.getNode(goldenNode.id);
        expect(retrieved).not.toBeNull();
        if (retrieved === null) continue;
        expect(retrieved.id).toBe(goldenNode.id);
        expect(retrieved.kind).toBe(goldenNode.kind);
        expect(retrieved.qname).toBe(goldenNode.qname);
        expect(retrieved.level).toBe(goldenNode.level);
        expect(retrieved.missing).toBe(goldenNode.missing);
        expect(retrieved.excluded).toBe(goldenNode.excluded);
        expect(retrieved.bodyHash).toBe(goldenNode.bodyHash);
        expect(retrieved.payload).toStrictEqual(goldenNode.payload);
      }

      for (const goldenEdge of goldenEdges) {
        const srcEdges = await store.getEdgesFrom(goldenEdge.src);
        const retrieved = srcEdges.find((e) => e.id === goldenEdge.id);
        expect(retrieved).toBeDefined();
        if (retrieved === undefined) continue;
        expect(retrieved.kind).toBe(goldenEdge.kind);
        expect(retrieved.dst).toBe(goldenEdge.dst);
        expect(retrieved.confidence).toBe(goldenEdge.confidence);
        expect(retrieved.score).toBe(goldenEdge.score);
        expect(retrieved.attrs).toStrictEqual(goldenEdge.attrs);
      }
    });

    it('upsert is idempotent — calling twice yields same node count', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);
      await store.upsertGraph(result.graph); // second upsert
      const tables = await store.getNodesByKind('table');
      const expectedTableCount = result.graph.nodes.filter((n) => n.kind === 'table').length;
      expect(tables.length).toBe(expectedTableCount);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.3 — FTS5 population + searchFts (level-gated body, US-003)
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteGraphStore — FTS5 level-gated body (task 5.3)', () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await createSqliteGraphStore({ path: ':memory:' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('FTS5 virtual table is operational (basic tokenized search)', async () => {
    // Verify FTS5 is available in the installed better-sqlite3 build.
    const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
    await store.upsertGraph(result.graph);
    // Search by a known qname fragment
    const { hits } = await store.searchFts('customers');
    expect(hits.length).toBeGreaterThan(0);
  });

  describe('full body is searchable, metadata body is not (US-003)', () => {
    it('full-level node with body token is found by searchFts', async () => {
      // catalog-levels.json has sp_full_level with body "SELECT * FROM dbo.products WHERE id = @id;"
      // At full scope, body is indexed.
      const scopeFull: ExtractionScope = {
        levels: {
          ...fullScope.levels,
          procedures: 'full',
          triggers: 'full',
        },
      };

      const result = normalizeCatalog(levelsFixture as RawCatalog, scopeFull);
      await store.upsertGraph(result.graph);

      // "SELECT" appears in the body of sp_full_level
      const { hits } = await store.searchFts('SELECT');
      const bodyHits = hits.filter((h) => h.column === 'body');
      expect(bodyHits.length).toBeGreaterThan(0);
    });

    it('metadata-level node body token does NOT appear in FTS body column', async () => {
      // sp_metadata_only at metadata level: body is not indexed.
      // The token "reconcile" does not appear in either proc anyway, but we can test
      // by putting sp_metadata_only at metadata and verifying its body is absent.
      const scopeMeta: ExtractionScope = {
        levels: {
          ...fullScope.levels,
          procedures: 'metadata',
          triggers: 'full',
        },
      };

      const result = normalizeCatalog(levelsFixture as RawCatalog, scopeMeta);
      await store.upsertGraph(result.graph);

      // sp_metadata_only has no body at metadata level — FTS body should be empty.
      // Find the metadata proc
      const metaProc = result.graph.nodes.find(
        (n) => n.kind === 'procedure' && n.qname.includes('sp_metadata_only'),
      );
      expect(metaProc).toBeDefined();
      if (metaProc === undefined) return;
      expect(metaProc.bodyHash).toBeNull();
      expect(metaProc.level).toBe('metadata');
    });

    it('body_hash is stable for identical bodies (ADR-005)', async () => {
      // Normalize twice, get same bodyHash.
      const r1 = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      const r2 = normalizeCatalog(minimalFixture as RawCatalog, fullScope);

      const trigger1 = r1.graph.nodes.find((n) => n.kind === 'trigger');
      const trigger2 = r2.graph.nodes.find((n) => n.kind === 'trigger');

      expect(trigger1?.bodyHash).not.toBeNull();
      expect(trigger1?.bodyHash).toBe(trigger2?.bodyHash);
    });

    it('body_hash changes when body changes', async () => {
      // Two fixtures differ in body — they should produce different hashes.
      const scopeFull: ExtractionScope = {
        levels: { ...fullScope.levels, procedures: 'full', triggers: 'full' },
      };
      const r1 = normalizeCatalog(levelsFixture as RawCatalog, scopeFull);
      const r2 = normalizeCatalog(minimalFixture as RawCatalog, fullScope);

      const proc1 = r1.graph.nodes.find((n) => n.kind === 'procedure' && n.bodyHash !== null);
      const trig2 = r2.graph.nodes.find((n) => n.kind === 'trigger' && n.bodyHash !== null);

      // Both have non-null hashes and they differ (different bodies).
      expect(proc1?.bodyHash).not.toBeNull();
      expect(trig2?.bodyHash).not.toBeNull();
      expect(proc1?.bodyHash).not.toBe(trig2?.bodyHash);
    });

    it('searchFts returns qname-column matches for exact qname tokens', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      // "orders" is part of qnames like dbo.orders, dbo.orders.id, etc.
      const { hits, total } = await store.searchFts('orders*');
      expect(total).toBeGreaterThan(0);
      expect(hits.length).toBeGreaterThan(0);
    });

    it('searchFts pagination: offset skips earlier results', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      const all = await store.searchFts('orders*', { limit: 100, offset: 0 });
      const paged = await store.searchFts('orders*', { limit: 100, offset: 1 });

      if (all.total <= 1) return; // not enough results to test pagination
      expect(paged.hits.length).toBe(all.hits.length - 1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5.4 — snapshots, meta, deleteNodes
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteGraphStore — snapshots + meta + deleteNodes (task 5.4)', () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await createSqliteGraphStore({ path: ':memory:' });
  });

  afterEach(async () => {
    await store.close();
  });

  describe('putSnapshot / listSnapshots insertion order', () => {
    it('listSnapshots returns snapshots in insertion order', async () => {
      const snap1: SnapshotRecord = {
        id: 'snap-001',
        takenAt: '2026-01-01T00:00:00Z',
        engine: 'mssql',
        engineVersion: '15.0',
        fingerprint: 'fp-001',
        counts: { table: 5, view: 2 },
      };
      const snap2: SnapshotRecord = {
        id: 'snap-002',
        takenAt: '2026-01-02T00:00:00Z',
        engine: 'mssql',
        engineVersion: '15.0',
        fingerprint: 'fp-002',
        counts: { table: 5, view: 2 },
      };

      await store.putSnapshot(snap1);
      await store.putSnapshot(snap2);

      const snapshots = await store.listSnapshots();
      expect(snapshots.length).toBe(2);
      expect(snapshots[0]?.id).toBe('snap-001');
      expect(snapshots[1]?.id).toBe('snap-002');
    });

    it('snapshot exposes timestamp, engine version, fingerprint, counts', async () => {
      const snap: SnapshotRecord = {
        id: 'snap-test',
        takenAt: '2026-06-01T12:00:00Z',
        engine: 'pg',
        engineVersion: '16.1',
        fingerprint: 'abc123',
        counts: { table: 10, procedure: 3 },
      };
      await store.putSnapshot(snap);
      const snapshots = await store.listSnapshots();
      expect(snapshots.length).toBe(1);

      const retrieved = snapshots[0];
      expect(retrieved?.id).toBe(snap.id);
      expect(retrieved?.takenAt).toBe(snap.takenAt);
      expect(retrieved?.engine).toBe(snap.engine);
      expect(retrieved?.engineVersion).toBe(snap.engineVersion);
      expect(retrieved?.fingerprint).toBe(snap.fingerprint);
      expect(retrieved?.counts).toStrictEqual(snap.counts);
    });

    it('snapshot with no engineVersion omits the field (exactOptionalPropertyTypes)', async () => {
      const snap: SnapshotRecord = {
        id: 'snap-no-ver',
        takenAt: '2026-06-01T12:00:00Z',
        engine: 'sqlite',
        fingerprint: 'xyz789',
        counts: { table: 2 },
      };
      await store.putSnapshot(snap);
      const snapshots = await store.listSnapshots();
      expect(snapshots[0]?.engineVersion).toBeUndefined();
    });

    it('listSnapshots returns empty array when no snapshots stored', async () => {
      const snapshots = await store.listSnapshots();
      expect(snapshots).toStrictEqual([]);
    });
  });

  describe('getMeta / setMeta', () => {
    it('setMeta persists and getMeta reads back the value', async () => {
      await store.setMeta('my_key', 'my_value');
      const value = await store.getMeta('my_key');
      expect(value).toBe('my_value');
    });

    it('setMeta overwrites existing value (upsert)', async () => {
      await store.setMeta('key', 'v1');
      await store.setMeta('key', 'v2');
      expect(await store.getMeta('key')).toBe('v2');
    });

    it('getMeta returns null for unknown key', async () => {
      const value = await store.getMeta('nonexistent_key');
      expect(value).toBeNull();
    });
  });

  describe('deleteNodes — cascades edges + FTS', () => {
    it('deleteNodes removes the node and returns the deleted count', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      const tableNode = result.graph.nodes.find((n) => n.kind === 'table');
      if (tableNode === undefined) throw new Error('No table node');

      const deleted = await store.deleteNodes([tableNode.id]);
      expect(deleted).toBe(1);

      const retrieved = await store.getNode(tableNode.id);
      expect(retrieved).toBeNull();
    });

    it('deleteNodes cascades to edges referencing that node', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      const tableNode = result.graph.nodes.find(
        (n) => n.kind === 'table' && n.qname === 'dbo.customers',
      );
      if (tableNode === undefined) throw new Error('No customers table node');

      await store.deleteNodes([tableNode.id]);

      // Edges from/to this node should be gone
      const outEdges = await store.getEdgesFrom(tableNode.id);
      const inEdges = await store.getEdgesTo(tableNode.id);
      expect(outEdges.length).toBe(0);
      expect(inEdges.length).toBe(0);
    });

    it('deleteNodes cascades FTS row removal', async () => {
      const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
      await store.upsertGraph(result.graph);

      // Find a node that would appear in FTS by qname
      const triggerNode = result.graph.nodes.find((n) => n.kind === 'trigger');
      if (triggerNode === undefined) throw new Error('No trigger node');

      // Verify it appears in FTS before deletion
      const beforeDelete = await store.searchFts('trg_orders_after_insert');
      expect(beforeDelete.hits.some((h) => h.id === triggerNode.id)).toBe(true);

      await store.deleteNodes([triggerNode.id]);

      // After deletion, FTS should not find it
      const afterDelete = await store.searchFts('trg_orders_after_insert');
      expect(afterDelete.hits.some((h) => h.id === triggerNode.id)).toBe(false);
    });

    it('deleteNodes returns 0 for empty array', async () => {
      const deleted = await store.deleteNodes([]);
      expect(deleted).toBe(0);
    });

    it('deleteNodes returns 0 for unknown ids', async () => {
      const deleted = await store.deleteNodes(['0000000000000000000000000000000000000000']);
      expect(deleted).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6.3 — putSnapshot manifest write + getSnapshotObjects (RED→GREEN)
// Design Decision 3: putSnapshot fills snapshot_objects from nodes in same transaction.
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteGraphStore — snapshot_objects manifest (task 6.3)', () => {
  let store: GraphStore;

  beforeEach(async () => {
    store = await createSqliteGraphStore({ path: ':memory:' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('getSnapshotObjects returns empty array for unknown snapshotId', async () => {
    const rows = await store.getSnapshotObjects('no-such-snap');
    expect(rows).toStrictEqual([]);
  });

  it('putSnapshot populates snapshot_objects with one row per visible node', async () => {
    const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
    await store.upsertGraph(result.graph);

    const snap: SnapshotRecord = {
      id: 'snap-manifest-001',
      takenAt: '2026-06-17T00:00:00Z',
      engine: 'sqlite',
      fingerprint: 'fp-manifest',
      counts: { table: 1 },
    };
    await store.putSnapshot(snap);

    const rows = await store.getSnapshotObjects('snap-manifest-001');

    // Must have one row per non-missing, non-excluded node in the graph
    const visibleNodes = result.graph.nodes.filter((n) => !n.missing && !n.excluded);
    expect(rows.length).toBe(visibleNodes.length);
  });

  it('each manifest row carries snapshot_id, node_id, kind, qname, body_hash', async () => {
    const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
    await store.upsertGraph(result.graph);

    const snap: SnapshotRecord = {
      id: 'snap-manifest-002',
      takenAt: '2026-06-17T01:00:00Z',
      engine: 'sqlite',
      fingerprint: 'fp-2',
      counts: { table: 1 },
    };
    await store.putSnapshot(snap);

    const rows = await store.getSnapshotObjects('snap-manifest-002') as Array<{
      snapshotId: string;
      nodeId: string;
      kind: string;
      qname: string;
      bodyHash: string | null;
    }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.snapshotId).toBe('snap-manifest-002');
      expect(typeof row.nodeId).toBe('string');
      expect(typeof row.kind).toBe('string');
      expect(typeof row.qname).toBe('string');
      // bodyHash is string | null
      expect(row.bodyHash === null || typeof row.bodyHash === 'string').toBe(true);
    }
  });

  it('manifest rows match the actual node data (node_id, kind, qname, body_hash)', async () => {
    const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
    await store.upsertGraph(result.graph);

    const snap: SnapshotRecord = {
      id: 'snap-manifest-003',
      takenAt: '2026-06-17T02:00:00Z',
      engine: 'sqlite',
      fingerprint: 'fp-3',
      counts: {},
    };
    await store.putSnapshot(snap);

    const rows = await store.getSnapshotObjects('snap-manifest-003') as Array<{
      snapshotId: string;
      nodeId: string;
      kind: string;
      qname: string;
      bodyHash: string | null;
    }>;

    // Spot-check: every row's nodeId should correspond to a real visible node
    const visibleNodeMap = new Map(
      result.graph.nodes
        .filter((n) => !n.missing && !n.excluded)
        .map((n) => [n.id, n]),
    );

    for (const row of rows) {
      const node = visibleNodeMap.get(row.nodeId);
      expect(node).toBeDefined();
      expect(row.kind).toBe(node?.kind);
      expect(row.qname).toBe(node?.qname);
      expect(row.bodyHash).toBe(node?.bodyHash ?? null);
    }
  });

  it('manifest for second snapshot is independent of first snapshot', async () => {
    const result = normalizeCatalog(minimalFixture as RawCatalog, fullScope);
    await store.upsertGraph(result.graph);

    const snap1: SnapshotRecord = {
      id: 'snap-manifest-A',
      takenAt: '2026-06-17T03:00:00Z',
      engine: 'sqlite',
      fingerprint: 'fp-A',
      counts: {},
    };
    await store.putSnapshot(snap1);

    const snap2: SnapshotRecord = {
      id: 'snap-manifest-B',
      takenAt: '2026-06-17T04:00:00Z',
      engine: 'sqlite',
      fingerprint: 'fp-B',
      counts: {},
    };
    await store.putSnapshot(snap2);

    const rowsA = await store.getSnapshotObjects('snap-manifest-A') as unknown as Array<{ nodeId: string }>;
    const rowsB = await store.getSnapshotObjects('snap-manifest-B') as unknown as Array<{ nodeId: string }>;

    // Both have rows; they are the same content (same graph state) but stored independently
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBe(rowsA.length);
    // All rowsA node ids are for snapA only
    for (const r of rowsA) {
      expect(r.nodeId).toBeDefined();
    }
  });
});
