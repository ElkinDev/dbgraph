/**
 * Tests for src/cli/commands/query.ts — task 5.3 (phase-4-cli-config).
 * Spec: cli-config "query is backed by core search with a stable JSON contract"
 * Design: search(store, {term}) → formatQueryText | formatQueryJson.
 *   Zero results → outcome.type = 'negative' (exit code 1 via exitCodeFor, US-020).
 *   --json → deterministic JSON output (ADR-008).
 *
 * Tests use fake GraphStore (no real DB, no file I/O).
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR.
 */

import { describe, it, expect } from 'vitest';
import type {
  GraphNode,
  GraphStore,
  SearchHit,
  SnapshotRecord,
  UpsertResult,
} from '../../../src/index.js';
import { runQuery } from '../../../src/cli/commands/query.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fake helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeStore(opts: {
  ftsHits?: SearchHit[];
  ftsTotals?: number;
  nodes?: GraphNode[];
} = {}): GraphStore {
  const hits = opts.ftsHits ?? [];
  const total = opts.ftsTotals ?? hits.length;
  const nodes = opts.nodes ?? [];

  return {
    async close() {},
    async schemaVersion() { return 1; },
    async upsertGraph() { return { nodes: 0, edges: 0 } as UpsertResult; },
    async deleteNodes() { return 0; },
    async getNodesByKind(kind) { return nodes.filter((n) => n.kind === kind); },
    async getNode() { return null; },
    async getNodeByQName() { return null; },
    async getEdgesFrom() { return []; },
    async getEdgesTo() { return []; },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async searchFts(_q, _opts) { return { hits, total }; },
    async putSnapshot() {},
    async listSnapshots() { return [] as readonly SnapshotRecord[]; },
    async getSnapshotObjects() { return []; },
    async getMeta() { return null; },
    async setMeta() {},
  };
}

const ORDERS_HIT: SearchHit = {
  id: 'node-orders',
  kind: 'table',
  qname: 'dbo.orders',
  column: 'qname',
  score: 0.9,
};

const ITEMS_HIT: SearchHit = {
  id: 'node-items',
  kind: 'table',
  qname: 'dbo.order_items',
  column: 'qname',
  score: 0.7,
};

// ─────────────────────────────────────────────────────────────────────────────
// runQuery — text output (default)
// ─────────────────────────────────────────────────────────────────────────────

describe('runQuery — text output (default)', () => {
  it('returns success outcome when hits exist', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT] });
    const result = await runQuery({ store, term: 'orders', json: false });

    expect(result.type).toBe('success');
  });

  it('output contains kind and qname for each hit', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT] });
    const result = await runQuery({ store, term: 'orders', json: false });

    expect(result.output).toContain('table');
    expect(result.output).toContain('dbo.orders');
  });

  it('output contains multiple hits', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT, ITEMS_HIT] });
    const result = await runQuery({ store, term: 'orders', json: false });

    expect(result.output).toContain('dbo.orders');
    expect(result.output).toContain('dbo.order_items');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runQuery — zero results → exit 1 (US-020)
// ─────────────────────────────────────────────────────────────────────────────

describe('runQuery — zero results exits 1 (US-020)', () => {
  it('returns negative outcome when there are zero hits', async () => {
    const store = makeFakeStore({ ftsHits: [] });
    const result = await runQuery({ store, term: 'noexist', json: false });

    expect(result.type).toBe('negative');
  });

  it('negative outcome still provides output (message about zero results)', async () => {
    const store = makeFakeStore({ ftsHits: [] });
    const result = await runQuery({ store, term: 'noexist', json: false });

    // Must have some kind of output string (even if negative)
    expect(typeof result.output).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runQuery — JSON mode (--json)
// ─────────────────────────────────────────────────────────────────────────────

describe('runQuery — JSON mode (--json)', () => {
  it('emits valid JSON when json=true', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT] });
    const result = await runQuery({ store, term: 'orders', json: true });

    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  it('JSON output includes kind and qname', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT] });
    const result = await runQuery({ store, term: 'orders', json: true });
    const parsed = JSON.parse(result.output) as { hits: { kind: string; qname: string }[] };

    expect(parsed.hits[0]!.kind).toBe('table');
    expect(parsed.hits[0]!.qname).toBe('dbo.orders');
  });

  it('returns negative outcome for zero hits even in JSON mode (US-020)', async () => {
    const store = makeFakeStore({ ftsHits: [] });
    const result = await runQuery({ store, term: 'noexist', json: true });

    expect(result.type).toBe('negative');
  });

  it('JSON output is deterministic (ADR-008)', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT, ITEMS_HIT] });
    const result1 = await runQuery({ store, term: 'orders', json: true });
    const result2 = await runQuery({ store, term: 'orders', json: true });

    expect(result1.output).toBe(result2.output);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return type
// ─────────────────────────────────────────────────────────────────────────────

describe('runQuery — return type', () => {
  it('returns { type, output } shape', async () => {
    const store = makeFakeStore({ ftsHits: [ORDERS_HIT] });
    const result = await runQuery({ store, term: 'orders', json: false });

    expect(typeof result.output).toBe('string');
    expect(['success', 'negative']).toContain(result.type);
  });
});
