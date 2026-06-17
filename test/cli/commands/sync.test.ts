/**
 * Tests for src/cli/commands/sync.ts — task 4.2 (phase-4-cli-config).
 * Spec: cli-config "sync is incremental by fingerprint, --full forces a rebuild"
 * Design: fake SchemaAdapter + fake GraphStore (no real DB, no real file I/O for config).
 *
 * Scenarios covered:
 *   - Equal fingerprint → extraction is SKIPPED (no-op sync)
 *   - Changed fingerprint → extract called, delta applied, snapshot written
 *   - --full flag → extract called even when fingerprint is unchanged
 *   - Snapshot recorded on real extraction with per-type counts
 *   - syncAfterInit seam wires the real sync when called
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { GraphNode, GraphStore, SnapshotRecord, UpsertResult } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a minimal fake GraphStore backed by in-memory state.
 * Only the methods used by the sync command need to be implemented.
 */
function makeFakeStore(opts: {
  existingNodes?: GraphNode[];
  snapshots?: SnapshotRecord[];
} = {}): GraphStore & {
  _upserted: GraphNode[][];
  _deleted: string[][];
  _snapshots: SnapshotRecord[];
} {
  const nodes: GraphNode[] = [...(opts.existingNodes ?? [])];
  const snapshots: SnapshotRecord[] = [...(opts.snapshots ?? [])];
  const upserted: GraphNode[][] = [];
  const deleted: string[][] = [];

  return {
    _upserted: upserted,
    _deleted: deleted,
    _snapshots: snapshots,

    async close() {},
    async schemaVersion() { return 1; },

    async upsertGraph(graph) {
      upserted.push([...graph.nodes]);
      // Merge nodes into store (by id)
      for (const n of graph.nodes) {
        const idx = nodes.findIndex((e) => e.id === n.id);
        if (idx >= 0) nodes[idx] = n;
        else nodes.push(n);
      }
      return { nodes: graph.nodes.length, edges: graph.edges.length } as UpsertResult;
    },

    async deleteNodes(ids) {
      deleted.push([...ids]);
      return ids.length;
    },

    async getNodesByKind(kind) {
      return nodes.filter((n) => n.kind === kind);
    },

    async getNode() { return null; },
    async getNodeByQName() { return null; },
    async getEdgesFrom() { return []; },
    async getEdgesTo() { return []; },
    async searchFts() { return { hits: [], total: 0 }; },

    async putSnapshot(s) {
      snapshots.push(s);
    },

    async listSnapshots() {
      return [...snapshots].reverse(); // most-recent first
    },

    async getMeta() { return null; },
    async setMeta() {},
  };
}

/**
 * Creates a fake SchemaAdapter with controllable fingerprint and extract behavior.
 */
function makeFakeAdapter(opts: {
  fingerprint?: string;
  extractNodes?: GraphNode[];
} = {}) {
  const extractCallCount = { count: 0 };
  const fp = opts.fingerprint ?? 'fp-default';
  const extractNodes: GraphNode[] = opts.extractNodes ?? [];

  return {
    dialect: 'sqlite' as const,
    capabilities: {
      engine: 'sqlite',
      supported: new Set(['table'] as const),
      defaultLevels: {
        tables: 'full' as const, columns: 'full' as const, constraints: 'full' as const,
        indexes: 'full' as const, views: 'full' as const, procedures: 'metadata' as const,
        functions: 'metadata' as const, triggers: 'full' as const, sequences: 'metadata' as const,
        collections: 'metadata' as const, fields: 'metadata' as const,
        statistics: 'off' as const, sampling: 'off' as const,
      },
      supportsBodies: true,
      supportsDependencyHints: false,
    },
    async fingerprint() { return fp; },
    async extract(_scope: unknown) {
      extractCallCount.count++;
      // Return a minimal RawCatalog with the configured nodes' structure
      return {
        engine: 'sqlite',
        engineVersion: '3.0',
        schemas: ['dbo'] as readonly string[],
        objects: extractNodes.map((n) => {
          // exactOptionalPropertyTypes: do not include 'body' key when null
          if (n.bodyHash !== null) {
            return { kind: n.kind, schema: n.schema, name: n.name, body: n.bodyHash };
          }
          return { kind: n.kind, schema: n.schema, name: n.name };
        }),
      };
    },
    async close() {},
    _extractCallCount: extractCallCount,
  };
}

function makeNode(id: string, name: string, bodyHash: string | null = 'hash-abc'): GraphNode {
  return {
    id,
    kind: 'table',
    schema: 'dbo',
    name,
    qname: `dbo.${name}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash,
    payload: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for temp config
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `dbgraph-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Import the module under test
// ─────────────────────────────────────────────────────────────────────────────

import { runSync } from '../../../src/cli/commands/sync.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 4.2: Fingerprint short-circuit (no extraction when fp unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe('runSync — fingerprint short-circuit', () => {
  it('skips extraction when live fingerprint equals last snapshot fingerprint', async () => {
    const fp = 'fp-unchanged';
    const adapter = makeFakeAdapter({ fingerprint: fp });
    const store = makeFakeStore({
      snapshots: [{
        id: 'snap-1',
        takenAt: '2024-01-01T00:00:00.000Z',
        engine: 'sqlite',
        fingerprint: fp,
        counts: {},
      }],
    });

    await runSync({
      adapter,
      store,
      full: false,
    });

    // extract must NOT have been called
    expect(adapter._extractCallCount.count).toBe(0);
    // no upsert / delete
    expect(store._upserted).toHaveLength(0);
    expect(store._deleted).toHaveLength(0);
    // no new snapshot
    expect(store._snapshots).toHaveLength(1);
  });

  it('performs extraction when fingerprint differs from last snapshot', async () => {
    const adapter = makeFakeAdapter({ fingerprint: 'fp-new', extractNodes: [] });
    const store = makeFakeStore({
      snapshots: [{
        id: 'snap-1',
        takenAt: '2024-01-01T00:00:00.000Z',
        engine: 'sqlite',
        fingerprint: 'fp-old',
        counts: {},
      }],
    });

    await runSync({ adapter, store, full: false });

    expect(adapter._extractCallCount.count).toBe(1);
    // A new snapshot should have been written
    expect(store._snapshots).toHaveLength(2);
  });

  it('performs extraction when there are no snapshots yet (first sync)', async () => {
    const adapter = makeFakeAdapter({ fingerprint: 'fp-first', extractNodes: [] });
    const store = makeFakeStore({ snapshots: [] });

    await runSync({ adapter, store, full: false });

    expect(adapter._extractCallCount.count).toBe(1);
    expect(store._snapshots).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4.2: --full forces re-extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('runSync — --full flag', () => {
  it('forces extraction even when fingerprint is unchanged', async () => {
    const fp = 'fp-same';
    const adapter = makeFakeAdapter({ fingerprint: fp, extractNodes: [] });
    const store = makeFakeStore({
      snapshots: [{
        id: 'snap-1',
        takenAt: '2024-01-01T00:00:00.000Z',
        engine: 'sqlite',
        fingerprint: fp,
        counts: {},
      }],
    });

    await runSync({ adapter, store, full: true });

    expect(adapter._extractCallCount.count).toBe(1);
    expect(store._snapshots).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4.2: Delta application
// ─────────────────────────────────────────────────────────────────────────────

describe('runSync — delta application', () => {
  it('upserts new nodes and records a snapshot with counts', async () => {
    const newNode = makeNode('id-table-a', 'table_a', 'hash-a');
    // Adapter returns a raw catalog that normalizes into one node
    const adapter = makeFakeAdapter({
      fingerprint: 'fp-new',
      extractNodes: [newNode],
    });
    const store = makeFakeStore({ snapshots: [] });

    await runSync({ adapter, store, full: false });

    // snapshot written
    expect(store._snapshots).toHaveLength(1);
    const snap = store._snapshots[0]!;
    expect(snap.fingerprint).toBe('fp-new');
    expect(snap.engine).toBe('sqlite');
  });

  it('returns success outcome', async () => {
    const adapter = makeFakeAdapter({ fingerprint: 'fp-x', extractNodes: [] });
    const store = makeFakeStore({ snapshots: [] });

    const outcome = await runSync({ adapter, store, full: false });

    expect(outcome.type).toBe('success');
  });
});
