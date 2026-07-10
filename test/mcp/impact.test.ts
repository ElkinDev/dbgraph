/**
 * dbgraph_impact tool test — task 4.2 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_impact read/write blast radius; depth truncation + dynamic-SQL warn.
 * Design: getImpact + formatImpact with node-id→qname resolver.
 *
 * TDD: RED (stub returns "not implemented") → GREEN (real handler wired) → golden pinned.
 * ADR-008: byte-identical on re-run.
 *
 * Torture fixture impact:
 *   employees is FK'd to by assignments (references edge).
 *   employees has 4 triggers (fires_on) that write into audit_log.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDbgraphServer } from '../../src/mcp/server.js';
import { createHarness, type McpTestHarness } from './harness.js';
import { openFixtureStore, type FixtureStore } from './fixture.js';
import { runImpactTool } from '../../src/mcp/tools/impact.js';
import type { GraphStore } from '../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../src/core/model/node.js';
import type { GraphEdge } from '../../src/core/model/edge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenDir = resolve(__dirname, 'golden');

let fx: FixtureStore;
let harness: McpTestHarness;

beforeAll(async () => {
  fx = await openFixtureStore();
  const server = createDbgraphServer(fx.store);
  harness = await createHarness(server);
});

afterAll(async () => {
  await harness.close();
  await fx.cleanup();
});

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), 'utf-8');
}

function captureGolden(name: string, content: string): void {
  writeFileSync(join(goldenDir, name), content, 'utf-8');
}

const CAPTURE = process.env['GOLDEN_CAPTURE'] === '1';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: impact × detail levels (golden)
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — detail levels (golden)', () => {
  for (const detail of ['brief', 'normal', 'full'] as const) {
    const goldenFile = `impact-tool-${detail}.txt`;

    it(`impact main.employees at detail=${detail} matches golden`, async () => {
      const text = await harness.callTool('dbgraph_impact', {
        qname: 'main.employees',
        detail,
      });

      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);

      if (CAPTURE) {
        captureGolden(goldenFile, text);
        return;
      }

      const golden = readGolden(goldenFile);
      expect(text).toBe(golden);
    });

    it(`impact main.employees at detail=${detail} is byte-identical on re-run (ADR-008)`, async () => {
      if (CAPTURE) return;

      const run1 = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail });
      const run2 = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail });
      expect(run1).toBe(run2);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: impact content assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — content assertions', () => {
  it('output includes the node qname', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('employees');
  });

  it('normal detail includes IMPACT header', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('IMPACT');
  });

  it('normal detail shows READ IMPACT and WRITE IMPACT sections', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'normal' });
    expect(text).toContain('READ IMPACT');
    expect(text).toContain('WRITE IMPACT');
  });

  it('brief detail shows count summary', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.departments', detail: 'brief' });
    expect(text).toContain('departments');
    expect(text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: impact not found
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — not found', () => {
  it('returns error text for unknown qname', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'xyzzy_phantom_99' });
    expect(text).toContain('xyzzy_phantom_99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: default depth
// ─────────────────────────────────────────────────────────────────────────────

describe('dbgraph_impact — default depth', () => {
  it('returns result without depth parameter (defaults to 3)', async () => {
    const text = await harness.callTool('dbgraph_impact', { qname: 'main.employees', detail: 'brief' });
    expect(text.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOG-4 (task 7.2) — the impact tool resolves degraded node ids to QNAMES in the
// named block. `result.degradedNodeIds` is added to the pre-cache set so every degraded
// id resolves (design D1 wiring). The SQLite fixture has no dynamic SQL, so this uses a
// synthetic fake store with neutral acme_* names. Asserts the QNAME (not the raw id) shows.
// ─────────────────────────────────────────────────────────────────────────────

function synNode(id: string, kind: GraphNode['kind'], qname: string, hasDynamicSql = false): GraphNode {
  return {
    id,
    kind,
    schema: 'acme',
    name: qname.split('.').pop() ?? qname,
    qname,
    level: 'metadata',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: hasDynamicSql ? { hasDynamicSql: true } : {},
  };
}

function synEdge(id: string, kind: GraphEdge['kind'], src: string, dst: string): GraphEdge {
  return { id, kind, src, dst, confidence: 'declared', score: null, attrs: {} };
}

function makeDynFakeStore(nodes: GraphNode[], edgesTo: Record<string, GraphEdge[]>): GraphStore {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byQname = new Map(nodes.map((n) => [n.qname, n]));
  return {
    close: async () => {},
    schemaVersion: async () => 1,
    upsertGraph: async () => ({ nodes: 0, edges: 0 }),
    deleteNodes: async () => 0,
    getNode: async (id) => byId.get(id) ?? null,
    getNodesByKind: async () => [],
    getNodeByQName: async (kind, qname) => {
      const n = byQname.get(qname);
      return n && n.kind === kind ? n : null;
    },
    getEdgesFrom: async () => [],
    getEdgesTo: async (id) => edgesTo[id] ?? [],
    getAllNodes: async () => nodes,
    getAllEdges: async () => [],
    searchFts: async () => ({ hits: [], total: 0 }),
    putSnapshot: async () => {},
    listSnapshots: async () => [],
    getSnapshotObjects: async () => [],
    getMeta: async () => null,
    setMeta: async () => {},
  };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('');
}

describe('dbgraph_impact — degraded qname resolution (DOG-4 task 7.2)', () => {
  // Pivot table acme.orders; dynamic proc acme.run_report (id n-dyn) reads it (inbound).
  const nOrders = synNode('n-orders', 'table', 'acme.orders');
  const nDyn = synNode('n-dyn', 'procedure', 'acme.run_report', true);

  function store(): GraphStore {
    return makeDynFakeStore(
      [nOrders, nDyn],
      { 'n-orders': [synEdge('e-dyn', 'reads_from', 'n-dyn', 'n-orders')] },
    );
  }

  it('names the degraded routine by QNAME (not the raw node id) in the block', async () => {
    const result = await runImpactTool(store(), { qname: 'acme.orders', detail: 'normal' });
    const text = textOf(result);
    expect(text).toContain('acme.run_report  [DYNAMIC SQL]');
    expect(text).not.toContain('n-dyn');
    // blanket warning preserved alongside the named block
    expect(text).toContain('Impact possibly incomplete');
  });

  it('NEGATIVE: a graph with no dynamic routine names none', async () => {
    const plain = makeDynFakeStore(
      [nOrders, synNode('n-plain', 'view', 'acme.order_summary')],
      { 'n-orders': [synEdge('e-plain', 'reads_from', 'n-plain', 'n-orders')] },
    );
    const text = textOf(await runImpactTool(plain, { qname: 'acme.orders', detail: 'normal' }));
    expect(text).not.toContain('[DYNAMIC SQL]');
  });
});
