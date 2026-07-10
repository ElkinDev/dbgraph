/**
 * Tests for src/cli/commands/object.ts — explore-payloads C.3 + C.6 (design D5/D6).
 * Spec: cli-config "object CLI command mirrors dbgraph_object".
 *
 * `runObject({ store, qname, detail })` is a THIN wrapper over the EXISTING formatObject
 * presenter (ZERO new rendering logic): resolve qname via the D3-corrected loop (prefer a
 * real node over a phantom stub) → getNeighbors → formatObject(view, detail) → ExploreOutcome.
 * NO --json (the MCP dbgraph_object tool has none — parity + minimal). It imports ONLY the
 * public barrel (src/index.ts) + Node builtins — NEVER src/adapters/** (ADR-004); the
 * existing test/cli/boundaries.test.ts scan enforces that.
 *
 * C.3 uses a fake GraphStore (no DB). C.6 asserts BYTE PARITY against the EXISTING
 * (Batch-B re-blessed) object-tool-*.txt goldens using the real torture fixture store —
 * NO duplicate object golden set (ruling 4).
 *
 * TDD: RED (module absent) → GREEN → TRIANGULATE → PARITY.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GraphNode,
  GraphStore,
  SnapshotRecord,
  UpsertResult,
  GraphEdge,
  SearchHit,
} from '../../../src/index.js';
import { runObject, type ObjectOptions } from '../../../src/cli/commands/object.js';
import { openFixtureStore, type FixtureStore } from '../../mcp/fixture.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake helpers (mirror test/cli/commands/explore.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  kind: GraphNode['kind'] = 'table',
  qname?: string,
): GraphNode {
  return {
    id,
    kind,
    schema: 'dbo',
    name: id,
    qname: qname ?? `dbo.${id}`,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: `hash-${id}`,
    payload: {},
  };
}

function makeFakeStore(opts: { nodes?: GraphNode[]; edges?: GraphEdge[] } = {}): GraphStore {
  const nodes = opts.nodes ?? [];
  const edges = opts.edges ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeByQname = new Map(nodes.map((n) => [n.qname, n]));

  return {
    async close() {},
    async schemaVersion() { return 1; },
    async upsertGraph() { return { nodes: 0, edges: 0 } as UpsertResult; },
    async deleteNodes() { return 0; },
    async getNodesByKind(kind) { return nodes.filter((n) => n.kind === kind); },
    async getNode(id) { return nodeById.get(id) ?? null; },
    async getNodeByQName(kind, qname) {
      const n = nodeByQname.get(qname);
      return n?.kind === kind ? n : null;
    },
    async getEdgesFrom(nodeId) { return edges.filter((e) => e.src === nodeId); },
    async getEdgesTo(nodeId) { return edges.filter((e) => e.dst === nodeId); },
    async getAllNodes() { return nodes; },
    async getAllEdges() { return edges; },
    async searchFts() { return { hits: [] as readonly SearchHit[], total: 0 }; },
    async putSnapshot() {},
    async listSnapshots() { return [] as readonly SnapshotRecord[]; },
    async getSnapshotObjects() { return []; },
    async getMeta() { return null; },
    async setMeta() {},
  };
}

const ORDERS = makeNode('orders', 'table', 'dbo.orders');

// ─────────────────────────────────────────────────────────────────────────────
// C.3 — runObject resolves qname and returns formatObject bytes
// ─────────────────────────────────────────────────────────────────────────────

describe('runObject — resolves qname and formats via formatObject', () => {
  it('returns { type: success, output } with the qname and kind rendered', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ObjectOptions = { store, qname: 'dbo.orders', detail: 'normal' };

    const result = await runObject(opts);

    expect(result.type).toBe('success');
    expect(typeof result.output).toBe('string');
    expect(result.output).toContain('dbo.orders');
    expect(result.output).toContain('[table]');
  });

  it('same store + qname + detail → byte-identical output on two calls (ADR-008)', async () => {
    const store = makeFakeStore({ nodes: [ORDERS] });
    const opts: ObjectOptions = { store, qname: 'dbo.orders', detail: 'full' };

    const run1 = await runObject(opts);
    const run2 = await runObject(opts);

    expect(run1.output).toBe(run2.output);
  });

  it('throws NotFoundError when the qname resolves to no node', async () => {
    const store = makeFakeStore({ nodes: [] });
    const opts: ObjectOptions = { store, qname: 'dbo.nonexistent', detail: 'normal' };

    await expect(runObject(opts)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.3 — D3 [view] resolution: prefer the real view over a phantom table stub with
// the same qname (runObject consumes the SAME corrected resolution loop as runExplore).
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_QNAME = 'main.active_departments';

function makeViewStubStore(): GraphStore {
  const realView: GraphNode = {
    ...makeNode('active_departments', 'view', VIEW_QNAME),
    id: 'real-view',
    schema: 'main',
    missing: false,
  };
  const phantomTable: GraphNode = {
    ...makeNode('active_departments', 'table', VIEW_QNAME),
    id: 'phantom-table',
    schema: 'main',
    missing: true,
  };
  return {
    ...makeFakeStore(),
    async getNodeByQName(kind, qname) {
      if (qname !== VIEW_QNAME) return null;
      if (kind === 'table') return phantomTable; // NODE_KINDS visits 'table' before 'view'
      if (kind === 'view') return realView;
      return null;
    },
  };
}

describe('runObject — D3 [view] resolution (explore-payloads D5)', () => {
  it('prefers the real view over the phantom table stub → header reads [view]', async () => {
    const store = makeViewStubStore();
    const result = await runObject({ store, qname: VIEW_QNAME, detail: 'brief' });

    expect(result.output).toContain(`${VIEW_QNAME}  [view]`);
    expect(result.output).not.toContain('[table]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.6 — PARITY: runObject bytes === the EXISTING object-tool-*.txt goldens (ruling 4).
// Same source (formatObject), same golden — proving the CLI wrapper adds nothing. The
// goldens are the (Batch-B re-blessed) files the MCP dbgraph_object tool also pins.
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, '../../mcp/golden');

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), 'utf-8');
}

describe('runObject — byte parity with the MCP object-tool goldens (C.6, ruling 4)', () => {
  let fx: FixtureStore;

  beforeAll(async () => {
    fx = await openFixtureStore();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  for (const detail of ['brief', 'normal', 'full'] as const) {
    it(`object main.employees --detail ${detail} is byte-identical to object-tool-${detail}.txt`, async () => {
      const result = await runObject({ store: fx.store, qname: 'main.employees', detail });
      const golden = readGolden(`object-tool-${detail}.txt`);
      expect(result.output).toBe(golden);
    });
  }

  it('full detail carries the payload facts a CLI-only agent needs (salary default, unique index)', async () => {
    const result = await runObject({ store: fx.store, qname: 'main.employees', detail: 'full' });
    expect(result.output).toContain('  salary  REAL  [NN]  DEFAULT 0.0');
    expect(result.output).toContain('  idx_emp_email  UNIQUE (email)');
  });
});
