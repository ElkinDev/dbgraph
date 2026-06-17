/**
 * Tests for src/cli/commands/status.ts — task 4.3 (phase-4-cli-config).
 * Spec: cli-config "status reports counts, last snapshot and live drift"
 * Design: status gathers data from GraphStore (getNodesByKind + listSnapshots)
 *   + live adapter.fingerprint() → assembles StatusView → passes to formatStatus.
 *
 * Tests use fake adapter + fake store (no real DB, no file I/O).
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import type { GraphNode, GraphStore, SnapshotRecord, UpsertResult } from '../../../src/index.js';
import { runStatus } from '../../../src/cli/commands/status.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(id: string, kind: GraphNode['kind'] = 'table'): GraphNode {
  return {
    id,
    kind,
    schema: 'dbo',
    name: id,
    qname: `dbo.${id}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: 'hash-abc',
    payload: {},
  };
}

function makeFakeStore(opts: {
  nodesByKind?: Partial<Record<GraphNode['kind'], GraphNode[]>>;
  snapshots?: SnapshotRecord[];
} = {}): GraphStore {
  const nodesByKind = opts.nodesByKind ?? {};
  const snapshots = opts.snapshots ?? [];

  return {
    async close() {},
    async schemaVersion() { return 1; },
    async upsertGraph() { return { nodes: 0, edges: 0 } as UpsertResult; },
    async deleteNodes() { return 0; },
    async getNodesByKind(kind) { return nodesByKind[kind] ?? []; },
    async getNode() { return null; },
    async getNodeByQName() { return null; },
    async getEdgesFrom() { return []; },
    async getEdgesTo() { return []; },
    async searchFts() { return { hits: [], total: 0 }; },
    async putSnapshot() {},
    async listSnapshots() { return [...snapshots].reverse(); },
    async getMeta() { return null; },
    async setMeta() {},
  };
}

function makeFakeAdapter(fingerprint: string = 'fp-live') {
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
    async fingerprint() { return fingerprint; },
    async extract() {
      return { engine: 'sqlite', schemas: [] as readonly string[], objects: [] };
    },
    async close() {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runStatus — core behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('runStatus — output contains kind counts', () => {
  it('shows table count in output when tables are present', async () => {
    const store = makeFakeStore({
      nodesByKind: { table: [makeNode('t1'), makeNode('t2'), makeNode('t3')] },
      snapshots: [],
    });
    const adapter = makeFakeAdapter('fp-any');

    const result = await runStatus({ adapter, store });

    expect(result.type).toBe('success');
    expect(result.output).toContain('table');
    expect(result.output).toContain('3');
  });

  it('shows view count in output', async () => {
    const store = makeFakeStore({
      nodesByKind: { view: [makeNode('v1', 'view'), makeNode('v2', 'view')] },
      snapshots: [],
    });
    const adapter = makeFakeAdapter('fp-any');

    const result = await runStatus({ adapter, store });

    expect(result.output).toContain('view');
    expect(result.output).toContain('2');
  });
});

describe('runStatus — last snapshot info', () => {
  it('shows snapshot timestamp when a snapshot exists', async () => {
    const store = makeFakeStore({
      snapshots: [{
        id: 'snap-1',
        takenAt: '2024-06-17T12:00:00.000Z',
        engine: 'sqlite',
        fingerprint: 'fp-stored',
        counts: { table: 3 },
      }],
    });
    const adapter = makeFakeAdapter('fp-stored');

    const result = await runStatus({ adapter, store });

    expect(result.output).toContain('2024-06-17');
  });

  it('shows "never synced" when no snapshots exist', async () => {
    const store = makeFakeStore({ snapshots: [] });
    const adapter = makeFakeAdapter('fp-any');

    const result = await runStatus({ adapter, store });

    expect(result.output.toLowerCase()).toMatch(/never synced|no snapshot/);
  });
});

describe('runStatus — drift detection', () => {
  it('shows DRIFT when live fingerprint differs from stored', async () => {
    const store = makeFakeStore({
      snapshots: [{
        id: 'snap-1',
        takenAt: '2024-01-01T00:00:00.000Z',
        engine: 'sqlite',
        fingerprint: 'fp-old',
        counts: {},
      }],
    });
    const adapter = makeFakeAdapter('fp-new-different');

    const result = await runStatus({ adapter, store });

    expect(result.output.toUpperCase()).toContain('DRIFT');
  });

  it('does NOT show DRIFT when fingerprints match', async () => {
    const fp = 'fp-same';
    const store = makeFakeStore({
      snapshots: [{
        id: 'snap-1',
        takenAt: '2024-01-01T00:00:00.000Z',
        engine: 'sqlite',
        fingerprint: fp,
        counts: {},
      }],
    });
    const adapter = makeFakeAdapter(fp);

    const result = await runStatus({ adapter, store });

    expect(result.output.toUpperCase()).not.toContain('DRIFT');
  });

  it('does NOT show DRIFT when no snapshots exist (nothing to compare)', async () => {
    const store = makeFakeStore({ snapshots: [] });
    const adapter = makeFakeAdapter('fp-any');

    const result = await runStatus({ adapter, store });

    expect(result.output.toUpperCase()).not.toContain('DRIFT');
  });
});

describe('runStatus — return type', () => {
  it('returns HandlerOutcome type: success with output string', async () => {
    const store = makeFakeStore({ snapshots: [] });
    const adapter = makeFakeAdapter('fp-test');

    const result = await runStatus({ adapter, store });

    expect(result.type).toBe('success');
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
  });
});
